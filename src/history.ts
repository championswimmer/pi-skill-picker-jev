export interface SkillAddition {
  turn: number;
  step: number;
  skills: string[];
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

export const TURN_ENTRY = "skill-picker-turn";
export const ADDITION_ENTRY = "skill-picker-add";

/** Only branch entries count: history from sibling/forked branches must not leak. */
export function restoreHistory(branch: BranchEntry[]): { turn: number; additions: SkillAddition[]; selectedNames: Set<string> } {
  let turn = 0;
  const additions: SkillAddition[] = [];
  for (const entry of branch) {
    if (entry.type !== "custom" || !entry.data || typeof entry.data !== "object") continue;
    const data = entry.data as Record<string, unknown>;
    if (entry.customType === TURN_ENTRY && Number.isSafeInteger(data.turn) && (data.turn as number) > 0) {
      turn = Math.max(turn, data.turn as number);
    }
    if (entry.customType === ADDITION_ENTRY && Number.isSafeInteger(data.turn) && (data.turn as number) > 0 &&
      Number.isSafeInteger(data.step) && (data.step as number) > 0 && Array.isArray(data.skills) &&
      data.skills.length > 0 && data.skills.every((name) => typeof name === "string")) {
      additions.push({ turn: data.turn as number, step: data.step as number, skills: data.skills as string[] });
    }
  }
  return { turn, additions, selectedNames: new Set(additions.flatMap((event) => event.skills)) };
}

export function formatAddition(entry: SkillAddition): string {
  const phase = entry.step === 1 ? "initial request" : `follow-up request #${entry.step}`;
  return `Turn ${entry.turn} · ${phase}: ${entry.skills.join(", ")}`;
}
