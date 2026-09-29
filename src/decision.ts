import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { rankSkills, type DecisionOptions } from "./picker.ts";
import { reportDecisionUsage } from "./usage-log.ts";
import { withPickerStatus } from "./status.ts";
import { readSettings } from "./settings.ts";

/** One Decisions pipeline for task matching and project-wide importance scoring. */
export function decideSkills(
  ctx: ExtensionContext, task: string, candidates: Skill[], alreadySent: Skill[],
  options: Pick<DecisionOptions, "threshold" | "maxNew" | "globalImportance" | "topicSearch" | "signal"> & {
    requireKey?: boolean;
    /** The allowlist overlay renders its own loading state; do not update the underlying Pi UI. */
    showStatus?: boolean;
  },
) {
  const operation = async () => {
    const settings = readSettings();
    if (options.signal?.aborted) throw options.signal.reason;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Custom servers may be unauthenticated. Never leak Pi's OpenRouter key to them.
    let keyRequest = settings.apiToken !== undefined || settings.apiBaseUrl !== undefined
      ? Promise.resolve(settings.apiToken ?? "")
      : ctx.modelRegistry.getApiKeyForProvider("openrouter");
    if (options.requireKey) {
      // Auth providers may refresh credentials; do not leave a dialog stuck indefinitely.
      keyRequest = Promise.race([keyRequest, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("OpenRouter authentication timed out")), 10_000);
      })]);
    }
    let apiKey: string;
    try {
      apiKey = await (options.signal
        ? Promise.race([keyRequest, new Promise<never>((_, reject) => {
            const abort = () => reject(options.signal!.reason);
            options.signal!.addEventListener("abort", abort, { once: true });
            keyRequest.then(
              () => options.signal!.removeEventListener("abort", abort),
              () => options.signal!.removeEventListener("abort", abort),
            );
          })])
        : keyRequest) ?? "";
    } finally { if (timer) clearTimeout(timer); }
    if (options.requireKey && !apiKey && !settings.apiBaseUrl) throw new Error("OpenRouter authentication is required for relevance sorting");
    return rankSkills(task, candidates, alreadySent, {
      ...options,
      apiKey,
      apiBaseUrl: settings.apiBaseUrl,
      model: settings.model ?? process.env.PI_SKILL_PICKER_MODEL,
      onUsage: (usage) => reportDecisionUsage(ctx.sessionManager as unknown as Parameters<typeof reportDecisionUsage>[0], usage),
    });
  };
  return options.showStatus === false ? operation() : withPickerStatus(ctx, operation);
}
