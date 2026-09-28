# Why the local Kev benchmark was much slower than hosted Jev

Research date: 2026-09-28. Follow-up to the [Railway inventory benchmark](railway-skills-benchmark.md). This investigation inspected upstream documentation, the local serving configuration/code, and existing logs/metrics. **No new model runs, dependency changes, or performance fixes were made.** No source skills are included here.

## Conclusion

The measurements are valid for the local configuration, but they are **not evidence that Kev inherently requires tens of seconds while Jev takes milliseconds**. We ran a deliberately conservative ROCm fallback configuration with its principal serving optimizations disabled/missing. In particular, six HTTP requests did **not** mean six requests executing together on the GPU.

There are two distinct problems:

1. **Slow individual requests:** optimized Qwen3.5 kernels and Kev's fused/graph paths were unavailable or disabled.
2. **Slow whole-catalog runs:** without graphs, this Kev server processes queued requests one at a time. The six-batch catalog latency closely matches serial throughput.

This configuration should have been highlighted before interpreting the measurements as a model comparison. The prior report's deadlines and wall-clock results remain accurate for that configuration.

## 1. Upstream reports much lower Kev latency

The official [Kev Serving Performance table](https://github.com/jaredpalmer/kev#serving-performance) reports the following for **six questions and a short text**, new text / repeated text:

| Model | GPU | Published model latency |
| --- | --- | ---: |
| Kev 4B | L40S | 41.5 / 27.7 ms |
| Kev 4B | H100 | 18.1 / 12.9 ms |
| Kev 9B | L40S | 66.4 / 42.7 ms |
| Kev 9B | H100 | 24.0 / 16.6 ms |

These are upstream measurements, not independently replicated here. They are medians of 20, **model time rather than client wall time**, and use different inputs/hardware. The README says network overhead through a same-region Modal endpoint adds about 65 ms. It also reports 4B at 721 / 136 ms on an M5 for five questions about a roughly 270-token text, illustrating how much backend/hardware/cache state matter.

Therefore the table does not establish what our Strix Halo should achieve, nor can it be directly compared with 50 long skill questions. It does establish that multi-second latency is **not intrinsic to the Kev model family**. API compatibility with Jev is not a promise of identical weights, hardware, kernels, or serving architecture.

## 2. The local wrapper forces the slow configuration

`../kev-local/scripts/serve_model.sh` explicitly sets:

```bash
export KEV_FUSED=0
export KEV_CUDA_GRAPHS=0
export KEV_DTYPE=bf16
```

These assignments override values supplied outside the wrapper. Merely launching it with `KEV_FUSED=1` will not enable the path without changing the wrapper.

The local README says these settings were retained for ROCm correctness. It also records a real ROCm 7.1 crash on this chip. That is a reason for cautious validation, **not proof that every optimized path is permanently unsupported**.

The preserved server logs explicitly warn:

> `causal_conv1d_fn` is falling back to its reference PyTorch implementation because `causal_conv1d` is not installed. This is correct but much slower.

> `chunk_gated_delta_rule` is falling back to its reference PyTorch implementation because `flash-linear-attention` is not installed. This is correct but much slower.

The server was using the GPU. A reference **PyTorch fallback does not mean CPU inference**; ROCm also uses PyTorch's `cuda` device API naming. The issue is slow kernels/execution paths, not evidence that weights silently ran on the CPU.

Upstream's [server setup](https://github.com/jaredpalmer/kev/blob/3e1cd3bb588a388a06827443380befece23e68c7/kev/serve.py#L283) enables graphs by default for its CUDA path, commenting that a pass involves approximately **2,000 kernel launches** and graph replay cuts warm latency several-fold. Its [fused Qwen3.5 implementation](https://github.com/jaredpalmer/kev/blob/3e1cd3bb588a388a06827443380befece23e68c7/kev/fused_qwen35.py) specifically combines normalization, projection/gating, convolution, and related operations to reduce launch/intermediate overhead. Those benefits were not enabled in our runs.

**Confidence:** high that we used a slower fallback path. The contribution of each missing optimization has not been isolated by profiling or an A/B run.

## 3. Disabling graphs also removes cross-request batching

This is the clearest code-level explanation for the full-catalog results.

The local upstream checkout is `3e1cd3bb588a388a06827443380befece23e68c7`. Its [server documentation](https://github.com/jaredpalmer/kev/blob/3e1cd3bb588a388a06827443380befece23e68c7/kev/serve.py#L74-L79) says the single model thread runs queued requests:

> with CUDA graphs, shared state and row passes; otherwise one request at a time

The implementation in [`probs_batch`](https://github.com/jaredpalmer/kev/blob/3e1cd3bb588a388a06827443380befece23e68c7/kev/model.py#L442-L465) admits requests to a combined graphed run only when `self.graphs is not None` and the shapes fit. Other requests are evaluated by `probs_one` individually. With `KEV_CUDA_GRAPHS=0`, none enter that combined path.

This does **not** mean the 50 questions within a request are necessarily processed one at a time. The model still has question-row batching and state-prefix reuse. It means separate HTTP requests in the six-request wave are not receiving the intended combined GPU execution.

The observed numbers corroborate the code. Approximate serial extrapolation: mean time for 50 candidates × 263/50:

| Model / primitive | Serial extrapolation | Observed six-request catalog run |
| --- | ---: | ---: |
| Kev 4B / Noul | 43.504 s | 42.419 s |
| Kev 4B / Score | 51.712 s | 50.203 s |
| Kev 9B / Noul | 70.653 s | 70.875 s |
| Kev 9B / Score | 83.109 s | 82.382 s |

All are within about 3%. Candidate lengths differ between windows, so this is not an exact prediction; nevertheless, the behavior is essentially serial throughput, not six-way acceleration. Queueing/completion effects also explain why many client requests cross the 30-second deadline even though a lone 50-question request finishes in roughly 8–16 seconds.

**Confidence:** high. Both code and telemetry independently support this explanation.

## 4. Additional factors, without overclaiming

- **Hardware:** our GPU is integrated AMD Strix Halo with shared system memory, not an L40S/H100 with their compute and memory characteristics. Even with corrected kernels, matching the upstream NVIDIA table cannot be promised.
- **Payload:** real descriptions average ~395 characters. The upstream short-text/small-question example and our previous synthetic metadata are different workloads. State caching cannot remove all work in question-specific skill descriptions and rubric text.
- **Score overhead:** the real full-catalog benchmark adds about 16–18% locally. That is material but far too small to explain the overall local-versus-hosted gap. Noul is also very slow in this configuration.
- **Jev implementation:** [TypeSafe's model docs](https://docs.typesafe.ai/models) say state is ingested once and questions are evaluated in parallel. Kev also shares state within a request. I did not find sufficient official detail to attribute the remaining difference to a specific Jev parameter count, quantization scheme, GPU fleet, or proprietary kernel. It would be speculation to fill those gaps in.
- **Timing:** upstream `latency_ms`, client wall time, queueing delay, and full-catalog wall time are different metrics. Future comparisons should collect each separately.

## 5. What to validate next

1. **Establish a supported accelerated ROCm path in an isolated environment.** Current [Flash Linear Attention documentation](https://github.com/fla-org/flash-linear-attention#installation) explicitly supports AMD and provides a ROCm installation route. The earlier assumption that optimization necessarily implies NVIDIA-only is too strong. However, that does not guarantee the particular gfx1151 chip, local Torch/Triton versions, every required kernel, or Kev's graph/fused path will work unchanged.
2. **Do not blindly install CUDA wheels or replace the known-working environment.** FLA now documents backend-specific extras and warns that bare installation no longer installs Torch/Triton. The existing environment's ROCm 7.1 crash and the causal-convolution dependency require separate compatibility checks.
3. **A/B optimizations one at a time:** baseline → compatible optimized DeltaNet/convolution kernels → Kev fused path → graph capture and combined-request batching. Verify finite normalized outputs, selection/ranking agreement, and numerical tolerances on fixed synthetic fixtures before introducing real metadata. Confirm which path actually activates in logs.
4. **Measure one 6-question and one 50-question workload first.** Record input/row lengths, server model time, queue time, client time, cache hits, active batching, and GPU utilization/profiler evidence. Only then repeat the 263-skill catalog with concurrency 1 versus 6.
5. **Use the official supported NVIDIA path as a control if needed.** Reproducing a small upstream L40S/H100 workload can separate Kev implementation issues from this AMD port. That would require separately authorized hardware/cloud execution; none was performed here.
6. **Treat lower local concurrency/longer deadlines as operational workarounds, not throughput fixes.** Reducing concurrency may keep individual requests inside their deadlines, while the full catalog can remain slow. More server workers could duplicate models/memory or contend on the same GPU rather than accelerate them.

Until these experiments are done, the defensible conclusion is: **our local fallback serving stack is substantially under-optimized, and its current batching behavior explains the very high full-catalog numbers. Kev's optimized performance on this exact hardware remains unmeasured.**
