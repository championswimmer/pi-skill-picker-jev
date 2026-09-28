export interface ScoredSkill {
  name: string;
  /** Jev's noul probability; null for records saved before scores were captured. */
  score: number | null;
}

export interface SkillAddition {
  turn: number;
  step: number;
  threshold: number | null;
  skills: ScoredSkill[];
}

interface BranchEntry {
  type: string;
  customType?: string;
  data?: unknown;
}

export const TURN_ENTRY = "skill-picker-turn";
export const ADDITION_ENTRY = "skill-picker-add";

const probability = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

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
    if (entry.customType !== ADDITION_ENTRY || !Number.isSafeInteger(data.turn) || (data.turn as number) <= 0 ||
      !Number.isSafeInteger(data.step) || (data.step as number) <= 0 || !Array.isArray(data.skills) || !data.skills.length) continue;
    const skills: ScoredSkill[] = [];
    for (const item of data.skills) {
      if (typeof item === "string") skills.push({ name: item, score: null }); // Older sessions
      else if (item && typeof item === "object" && typeof item.name === "string" && probability(item.score)) {
        skills.push({ name: item.name, score: item.score });
      } else break;
    }
    if (skills.length !== data.skills.length) continue;
    additions.push({ turn: data.turn as number, step: data.step as number,
      threshold: probability(data.threshold) ? data.threshold : null, skills });
  }
  return { turn, additions, selectedNames: new Set(additions.flatMap((event) => event.skills.map((s) => s.name))) };
}

function skillRow(entry: SkillAddition, skill: ScoredSkill): string {
  const phase = entry.step === 1 ? "initial" : `follow-up #${entry.step}`;
  const relevance = skill.score === null ? "score unavailable" :
    `score ${skill.score.toFixed(3)}${entry.threshold === null ? "" : ` ≥ ${entry.threshold.toFixed(3)}`}`;
  return `Turn ${entry.turn} · ${phase} · ${skill.name} (${relevance})`;
}

export interface HistorySkill extends ScoredSkill {
  step: number;
  threshold: number | null;
}

export interface TurnHistory {
  turn: number;
  skills: HistorySkill[];
}

/** Group all decisions by user turn; descriptions remain outside the session log. */
export function groupHistoryByTurn(additions: SkillAddition[]): TurnHistory[] {
  const turns = new Map<number, HistorySkill[]>();
  for (const entry of additions) {
    const skills = turns.get(entry.turn) ?? [];
    skills.push(...entry.skills.map((skill) => ({ ...skill, step: entry.step, threshold: entry.threshold })));
    turns.set(entry.turn, skills);
  }
  return [...turns].map(([turn, skills]) => ({ turn, skills }));
}

export function formatHistorySkill(turn: number, skill: HistorySkill): string {
  return skillRow({ turn, step: skill.step, threshold: skill.threshold, skills: [skill] }, skill)
    .replace(`Turn ${turn} · `, "");
}
