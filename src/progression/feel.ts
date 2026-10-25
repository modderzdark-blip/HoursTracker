/**
 * Pure rules behind the game's feedback ("feel"): combo ranks, multi-kills and kill streaks,
 * how the XP bar fills across level-ups, the timing of the victory screen's reveal, which
 * celebrations follow a victory, and which goals were just reached. No DOM, no audio — the UI
 * and audio read these, and unit tests pin them down.
 */
import type { Rarity } from '../data/items';
import { CHAPTERS, type AdventureStageDef } from '../data/stages';
import { xpToNext } from './xp';

// ------------------------------------------------------------------ combo ranks

export interface ComboRank {
  /** Hits needed to reach the rank. */
  readonly min: number;
  readonly word: string;
}

/** Escalating combo ranks (hit counts are inclusive minimums). */
export const COMBO_RANKS: readonly ComboRank[] = [
  { min: 5, word: 'Kindled' },
  { min: 12, word: 'Searing' },
  { min: 20, word: 'Ferocious' },
  { min: 32, word: 'Ruinous' },
  { min: 50, word: 'Cataclysmic' },
  { min: 75, word: 'Unbound' },
];

/** Index into COMBO_RANKS for a hit count, or -1 below the first rank. */
export function comboRankIndex(hits: number): number {
  let r = -1;
  for (let i = 0; i < COMBO_RANKS.length; i++) {
    const rank = COMBO_RANKS[i];
    if (rank !== undefined && hits >= rank.min) r = i;
  }
  return r;
}

export function comboRankWord(hits: number): string {
  return COMBO_RANKS[comboRankIndex(hits)]?.word ?? '';
}

// ------------------------------------------------------------------ kills

/** Kills closer together than this chain into a multi-kill. */
export const MULTI_KILL_WINDOW_MS = 1500;

/** Callout for a multi-kill of `n` foes ('' for a single kill). */
export function multiKillWord(n: number): string {
  if (n < 2) return '';
  if (n === 2) return 'Double Reap';
  if (n === 3) return 'Triple Reap';
  if (n === 4) return 'Quad Reap';
  return `Carnage ×${n}`;
}

/** Kill-streak milestones: kills in a row without being hit. */
export const STREAK_MILESTONES: readonly { readonly kills: number; readonly word: string }[] = [
  { kills: 8, word: 'Bloodtide' },
  { kills: 16, word: 'Ashstorm' },
  { kills: 30, word: 'Deathless' },
];

/** Callout when a streak reaches exactly a milestone ('' otherwise). */
export function streakWord(kills: number): string {
  return STREAK_MILESTONES.find((m) => m.kills === kills)?.word ?? '';
}

export interface KillResult {
  /** Foes in the current multi-kill chain (1 = a lone kill). */
  readonly multi: number;
  /** Kills since the hero was last hit. */
  readonly streak: number;
}

/**
 * Counts multi-kills (kills inside a short window of each other) and the kill streak (kills
 * since the hero last took damage). Time is passed in so it follows game time and is testable.
 */
export class KillChain {
  private lastKillMs = -Infinity;
  private chain = 0;
  private streak = 0;
  private readonly result = { multi: 0, streak: 0 };

  /** Registers a kill. The returned object is reused; read it immediately. */
  kill(nowMs: number): KillResult {
    this.chain = nowMs - this.lastKillMs <= MULTI_KILL_WINDOW_MS ? this.chain + 1 : 1;
    this.lastKillMs = nowMs;
    this.streak++;
    this.result.multi = this.chain;
    this.result.streak = this.streak;
    return this.result;
  }

  /** The hero took damage: the streak ends. */
  hurt(): void {
    this.streak = 0;
  }

  reset(): void {
    this.lastKillMs = -Infinity;
    this.chain = 0;
    this.streak = 0;
  }
}

// ------------------------------------------------------------------ XP bar

export interface XpSegment {
  readonly level: number;
  /** Bar fill (0..1) at the start and end of this segment. */
  readonly from: number;
  readonly to: number;
  /** The bar fills up and the hero levels up at the end of this segment. */
  readonly levelUp: boolean;
}

/** How the XP bar animates from (levelBefore, xpBefore) to (levelAfter, xpAfter). */
export function xpSegments(
  levelBefore: number,
  xpBefore: number,
  levelAfter: number,
  xpAfter: number,
): XpSegment[] {
  const frac = (level: number, xp: number): number => {
    const need = xpToNext(level);
    return need > 0 ? Math.min(1, Math.max(0, xp / need)) : 1;
  };
  const out: XpSegment[] = [];
  const last = Math.max(levelBefore, levelAfter);
  for (let l = levelBefore; l <= last; l++) {
    const from = l === levelBefore ? frac(l, xpBefore) : 0;
    const levelUp = l < last;
    const to = levelUp ? 1 : frac(l, xpAfter);
    out.push({ level: l, from, to: Math.max(from, to), levelUp });
  }
  return out;
}

// ------------------------------------------------------------------ victory reveal

export type RevealKind = 'star' | 'counters' | 'xp' | 'levelUp' | 'loot' | 'firstClear' | 'done';

export interface RevealStep {
  readonly kind: RevealKind;
  /** Time from the start of the reveal. */
  readonly atMs: number;
  /** Star / loot card / XP segment index (0 for the others). */
  readonly index: number;
  /** Stars: earned this run. Loot: rare enough for a flourish. */
  readonly highlight: boolean;
}

export interface RevealInput {
  readonly stars: number;
  readonly previousStars: number;
  /** Victories without stars (dungeon interludes, arena) skip the stamps. */
  readonly showStars: boolean;
  readonly xpSegments: readonly XpSegment[];
  readonly loot: readonly Rarity[];
  readonly firstClear: boolean;
}

export const REVEAL_TIMING = {
  firstStarMs: 450,
  starGapMs: 380,
  countersMs: 900,
  xpSegmentMs: 650,
  lootGapMs: 330,
  /** Extra pause before an epic-or-better card (the flourish needs room). */
  rareLootPauseMs: 260,
} as const;

const RARE: ReadonlySet<Rarity> = new Set<Rarity>(['epic', 'legendary', 'mythic']);

/**
 * When each part of the victory screen appears: stars stamp in one by one, currency counters
 * tick, the XP bar fills (bursting at each level-up), loot cards flip one by one, then the
 * first-clear badge. Tapping the screen jumps to the end; input is never blocked.
 */
export function planReveal(i: RevealInput): RevealStep[] {
  const T = REVEAL_TIMING;
  const steps: RevealStep[] = [];
  let t = T.firstStarMs;
  if (i.showStars) {
    for (let s = 0; s < 3; s++) {
      steps.push({ kind: 'star', atMs: t, index: s, highlight: s < i.stars });
      t += T.starGapMs;
    }
  }
  steps.push({ kind: 'counters', atMs: t, index: 0, highlight: false });
  t += T.countersMs * 0.5;
  i.xpSegments.forEach((seg, n) => {
    steps.push({ kind: 'xp', atMs: t, index: n, highlight: false });
    t += T.xpSegmentMs;
    if (seg.levelUp) steps.push({ kind: 'levelUp', atMs: t, index: n, highlight: true });
  });
  if (i.xpSegments.length === 0) t += T.countersMs * 0.5;
  i.loot.forEach((rarity, n) => {
    const rare = RARE.has(rarity);
    if (rare) t += T.rareLootPauseMs;
    steps.push({ kind: 'loot', atMs: t, index: n, highlight: rare });
    t += T.lootGapMs;
  });
  if (i.firstClear) {
    steps.push({ kind: 'firstClear', atMs: t, index: 0, highlight: true });
    t += T.lootGapMs;
  }
  steps.push({ kind: 'done', atMs: t, index: 0, highlight: false });
  return steps;
}

// ------------------------------------------------------------------ unlocks & celebrations

export type UnlockEvent =
  | { readonly kind: 'mode'; readonly id: string; readonly label: string }
  | {
      readonly kind: 'difficulty';
      readonly chapter: number;
      readonly id: string;
      readonly label: string;
    }
  | { readonly kind: 'hero'; readonly id: string; readonly label: string };

export type Celebration =
  | { readonly kind: 'chapter'; readonly chapter: number }
  | { readonly kind: 'hero'; readonly id: string }
  | { readonly kind: 'mode'; readonly id: string };

/**
 * Full-screen celebrations that follow a victory, in the order they show: the chapter moment
 * first (the story beat), then new heroes, then new modes. Difficulty unlocks stay in the list.
 */
export function celebrationsFor(
  unlocks: readonly UnlockEvent[],
  chapterComplete: number | null,
): Celebration[] {
  const out: Celebration[] = [];
  if (chapterComplete !== null) out.push({ kind: 'chapter', chapter: chapterComplete });
  for (const u of unlocks) if (u.kind === 'hero') out.push({ kind: 'hero', id: u.id });
  for (const u of unlocks) if (u.kind === 'mode') out.push({ kind: 'mode', id: u.id });
  return out;
}

// ------------------------------------------------------------------ goals

export interface GoalSnapshot {
  /** Daily quests finished (claimed or not). */
  readonly quests: readonly string[];
  /** Achievement tiers reached (claimed + claimable) by id. */
  readonly achievements: Readonly<Record<string, number>>;
}

export interface GoalReached {
  readonly kind: 'quest' | 'achievement';
  readonly id: string;
  /** Tier reached (achievements), 0 for quests. */
  readonly tier: number;
}

/** Goals finished between two snapshots (for "Quest complete!" toasts). */
export function goalsReached(before: GoalSnapshot, after: GoalSnapshot): GoalReached[] {
  const out: GoalReached[] = [];
  for (const q of after.quests)
    if (!before.quests.includes(q)) out.push({ kind: 'quest', id: q, tier: 0 });
  for (const [id, tier] of Object.entries(after.achievements)) {
    const was = before.achievements[id] ?? 0;
    if (tier > was) out.push({ kind: 'achievement', id, tier });
  }
  return out;
}

// ------------------------------------------------------------------ next goal

/** First Adventure stage not yet cleared (on any difficulty), or null when all are. */
export function nextAdventureStage(
  cleared: (stageId: string) => boolean,
): AdventureStageDef | null {
  for (const c of CHAPTERS) for (const s of c.stages) if (!cleared(s.id)) return s;
  return null;
}

/** Stages cleared in a chapter (any difficulty) and its size, for progress bars. */
export function chapterProgress(
  chapter: number,
  cleared: (stageId: string) => boolean,
): { readonly cleared: number; readonly total: number } {
  const ch = CHAPTERS.find((c) => c.number === chapter);
  if (ch === undefined) return { cleared: 0, total: 0 };
  return { cleared: ch.stages.filter((s) => cleared(s.id)).length, total: ch.stages.length };
}
