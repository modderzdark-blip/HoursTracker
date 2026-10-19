import { CURRENCIES } from '../data/economy';
import {
  ACHIEVEMENTS,
  BLESSING_CONFIG,
  DAILY_CONFIG,
  DAILY_QUESTS,
  HEARTH_CONFIG,
  LOGIN_REWARDS,
  type AchievementDef,
  type GoalEvent,
  type QuestDef,
  type RewardBundle,
} from '../data/goals';
import type { Wallet } from './wallet';

export interface QuestProgress {
  id: string;
  progress: number;
  claimed: boolean;
}

/** Daily quests + login calendar as stored in the save. */
export interface DailyState {
  /** Local day number the quest list belongs to (-1 = never rolled). */
  day: number;
  quests: QuestProgress[];
  bonusClaimed: boolean;
  /** Local day of the last login reward (-1 = never). */
  loginDay: number;
  /** Login rewards claimed so far (calendar position = count mod 7). */
  loginCount: number;
}

export function createDailyState(): DailyState {
  return { day: -1, quests: [], bonusClaimed: false, loginDay: -1, loginCount: 0 };
}

const DAY_MS = 86_400_000;

/** Day number in the player's local time zone (quests reset at local midnight). */
export function localDay(nowMs: number, tzOffsetMin = new Date(nowMs).getTimezoneOffset()): number {
  return Math.floor((nowMs - tzOffsetMin * 60_000) / DAY_MS);
}

/** Small deterministic hash so a day always offers the same quests. */
function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

/** The quests offered on `day` among those whose mode is unlocked. */
export function questsForDay(day: number, modeOpen: (q: QuestDef) => boolean): QuestDef[] {
  const pool = DAILY_QUESTS.filter(modeOpen);
  const scored = pool.map((q, i) => ({ q, k: hash(day * 131 + i * 7919) }));
  scored.sort((a, b) => a.k - b.k);
  return scored.slice(0, DAILY_CONFIG.questsPerDay).map((s) => s.q);
}

/** Rolls a new quest list when the day changed. Returns true if it did. */
export function refreshDaily(
  d: DailyState,
  day: number,
  modeOpen: (q: QuestDef) => boolean,
): boolean {
  if (d.day === day && d.quests.length > 0) return false;
  d.day = day;
  d.bonusClaimed = false;
  d.quests = questsForDay(day, modeOpen).map((q) => ({ id: q.id, progress: 0, claimed: false }));
  return true;
}

export function questDef(id: string): QuestDef | undefined {
  return DAILY_QUESTS.find((q) => q.id === id);
}

/** Counts an event toward today's quests. */
export function trackQuests(d: DailyState, event: GoalEvent, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  for (const q of d.quests) {
    const def = questDef(q.id);
    if (def === undefined || def.event !== event || q.claimed) continue;
    q.progress = Math.min(def.target, q.progress + Math.floor(amount));
  }
}

export function questDone(q: QuestProgress): boolean {
  const def = questDef(q.id);
  return def !== undefined && q.progress >= def.target;
}

export function addBundle(wallet: Wallet, r: RewardBundle): void {
  for (const c of CURRENCIES) {
    const v = r[c];
    if (v !== undefined && v > 0) wallet.add(c, Math.floor(v));
  }
}

export function bundleText(r: RewardBundle): string {
  const names = {
    gold: 'gold',
    gems: 'gems',
    souls: 'souls',
    materials: 'materials',
    tickets: 'tickets',
  };
  const parts: string[] = [];
  for (const c of CURRENCIES) {
    const v = r[c];
    if (v !== undefined && v > 0)
      parts.push(`${v} ${v === 1 && c === 'tickets' ? 'ticket' : names[c]}`);
  }
  return parts.join(' + ');
}

/** Claims one finished quest. */
export function claimQuest(d: DailyState, id: string, wallet: Wallet): boolean {
  const q = d.quests.find((x) => x.id === id);
  const def = questDef(id);
  if (q === undefined || def === undefined || q.claimed || q.progress < def.target) return false;
  q.claimed = true;
  addBundle(wallet, def.reward);
  return true;
}

export function dailyBonusReady(d: DailyState): boolean {
  return !d.bonusClaimed && d.quests.length > 0 && d.quests.every((q) => q.claimed);
}

export function claimDailyBonus(d: DailyState, wallet: Wallet): boolean {
  if (!dailyBonusReady(d)) return false;
  d.bonusClaimed = true;
  addBundle(wallet, DAILY_CONFIG.allDoneBonus);
  return true;
}

// ------------------------------------------------------------------ login calendar

export function loginReady(d: DailyState, day: number): boolean {
  return d.loginDay !== day;
}

/** Today's calendar slot (0..6). */
export function loginSlot(d: DailyState): number {
  return d.loginCount % LOGIN_REWARDS.length;
}

/**
 * Claims today's login reward (once per local day; a missed day never resets the calendar).
 * Returns the reward, or null if already claimed today.
 */
export function claimLogin(d: DailyState, day: number, wallet: Wallet): RewardBundle | null {
  if (!loginReady(d, day)) return null;
  const reward = LOGIN_REWARDS[loginSlot(d)] ?? {};
  d.loginDay = day;
  d.loginCount++;
  addBundle(wallet, reward);
  return reward;
}

// ------------------------------------------------------------------ hearth

export interface HearthYield {
  readonly minutes: number;
  readonly gold: number;
  readonly xp: number;
  readonly materials: number;
  readonly full: boolean;
}

/** What the hearth holds now. A clock set backwards yields nothing (never negative). */
export function hearthYield(sinceMs: number, nowMs: number, level: number): HearthYield {
  const capMs = HEARTH_CONFIG.capHours * 3_600_000;
  const ms = Math.min(capMs, Math.max(0, nowMs - sinceMs));
  const h = ms / 3_600_000;
  const l = Math.max(1, level);
  const c = HEARTH_CONFIG;
  return {
    minutes: Math.floor(ms / 60_000),
    gold: Math.floor(h * (c.goldPerHour.base + c.goldPerHour.perLevel * l)),
    xp: Math.floor(h * (c.xpPerHour.base + c.xpPerHour.perLevel * l)),
    materials: Math.floor(h * (c.materialsPerHour.base + c.materialsPerHour.perLevel * l)),
    full: ms >= capMs,
  };
}

// ------------------------------------------------------------------ blessing

export interface Blessing {
  readonly stacks: number;
  readonly atkMult: number;
  readonly hpMult: number;
}

export function blessingFor(stacks: number): Blessing {
  const s = Math.max(0, Math.min(BLESSING_CONFIG.maxStacks, Math.floor(stacks)));
  return {
    stacks: s,
    atkMult: 1 + s * BLESSING_CONFIG.atkPerStack,
    hpMult: 1 + s * BLESSING_CONFIG.hpPerStack,
  };
}

// ------------------------------------------------------------------ achievements

export function achievementTarget(a: AchievementDef, tier: number): number | null {
  return a.tiers[tier] ?? null;
}

export function achievementText(a: AchievementDef, tier: number): string {
  const t = achievementTarget(a, Math.min(tier, a.tiers.length - 1)) ?? 0;
  return a.text.replace('{n}', String(t));
}

/** Tiers that can be claimed now (value reached, not yet claimed). */
export function claimableTiers(a: AchievementDef, claimed: number, value: number): number {
  let n = 0;
  for (let t = claimed; t < a.tiers.length; t++) {
    const target = a.tiers[t];
    if (target === undefined || value < target) break;
    n++;
  }
  return n;
}

export function achievementById(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
