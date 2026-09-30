import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { normalizeBatchScores, rankSkillsWithBackend, type DecisionOptions, type RankedSkill } from "./picker.ts";

function resolveClassifierModel(model: string | undefined): { provider: string; modelId: string; fullName: string } {
  const configured = model?.trim() || process.env.PI_SKILL_PICKER_MODEL?.trim() || "jev-latest";
  if (!configured.includes("/")) return { provider: "typesafe", modelId: configured, fullName: `typesafe/${configured}` };
  const [provider, ...rest] = configured.split("/");
  const modelId = rest.join("/");
  if (!provider || !modelId) throw new Error(`Invalid classifier model: ${configured}`);
  return { provider, modelId, fullName: `${provider}/${modelId}` };
}

function nonnegativeUsageNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function reportUsage(model: string, usage: { input?: unknown; output?: unknown; cost?: { total?: unknown } } | undefined, onUsage: DecisionOptions["onUsage"]): void {
  const total = usage?.cost?.total;
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return;
  try {
    onUsage?.({ model, input: nonnegativeUsageNumber(usage?.input), output: nonnegativeUsageNumber(usage?.output), cost: total });
  } catch (error) {
    console.error("[pi-skill-picker-jev] Could not record Jev usage:", error);
  }
}

export async function rankSkillsWithClassifier(
  ctx: Pick<ExtensionContext, "modelRegistry">,
  task: string,
  candidates: Skill[],
  alreadySent: Skill[],
  options: Pick<DecisionOptions, "model" | "threshold" | "batchSize" | "maxNew" | "globalImportance" | "topicSearch" | "signal" | "onUsage">,
): Promise<RankedSkill[]> {
  const { provider, modelId, fullName } = resolveClassifierModel(options.model);
  const classifier = ctx.modelRegistry.findOfType("classifier", provider, modelId);
  if (!classifier) throw new Error(`Pi classifier model not found: ${fullName}`);
  return rankSkillsWithBackend(task, candidates, alreadySent, options, async (batch, context, threshold) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const result = await ctx.modelRegistry.classify(classifier, context, {
        signal: options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      });
      if (result.stopReason !== "stop") {
        if (result.stopReason === "aborted" && options.signal?.aborted) throw options.signal.reason;
        throw new Error(result.errorMessage || `Pi classifier request failed: ${result.stopReason}`);
      }
      reportUsage(fullName, result.usage, options.onUsage);
      return normalizeBatchScores(batch, context, result.answers, threshold);
    } finally {
      clearTimeout(timeout);
    }
  });
}
