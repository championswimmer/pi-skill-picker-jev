import type { ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { rankSkills, type DecisionOptions } from "./picker.ts";
import { reportDecisionUsage } from "./usage-log.ts";
import { withPickerStatus } from "./status.ts";

/** One Decisions pipeline for task matching and project-wide importance scoring. */
export function decideSkills(
  ctx: ExtensionContext, task: string, candidates: Skill[], alreadySent: Skill[],
  options: Pick<DecisionOptions, "threshold" | "maxNew" | "globalImportance"> & { requireKey?: boolean },
) {
  return withPickerStatus(ctx, async () => {
    const apiKey = await ctx.modelRegistry.getApiKeyForProvider("openrouter") ?? "";
    if (options.requireKey && !apiKey) throw new Error("OpenRouter authentication is required for relevance sorting");
    return rankSkills(task, candidates, alreadySent, {
    ...options,
    apiKey,
    model: process.env.PI_SKILL_PICKER_MODEL,
    onUsage: (usage) => reportDecisionUsage(ctx.sessionManager as unknown as Parameters<typeof reportDecisionUsage>[0], usage),
    });
  });
}
