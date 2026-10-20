import type { DifficultyId } from '../data/difficulty';
import { DEFAULT_HERO, HEROES, type HeroId } from '../data/heroes';
import { GEAR_CONFIG, GEAR_SLOTS, GEAR_STATS, RARITIES, type GearSlot } from '../data/items';
import { XP_CONFIG } from '../data/progression';
import { ACHIEVEMENTS, BLESSING_CONFIG, DAILY_QUESTS } from '../data/goals';
import type { GearItem, StatRoll } from './gear';
import { createDailyState, type DailyState } from './goals';
import type { PityState } from './loot';

/** Per-hero progress as stored in the save. */
export interface HeroProgress {
  unlocked: boolean;
  level: number;
  xp: number;
  /** Equipped item uids by slot. */
  equipped: Partial<Record<GearSlot, number>>;
  /** Skill-tree ranks by node id. */
  skills: Record<string, number>;
}

export interface DungeonState {
  entries: number;
  /** Epoch ms of the last refill tick (entries refill over real time). */
  refillAtMs: number;
  runs: number;
  bestRooms: number;
}

export interface TowerState {
  /** Highest floor cleared (0 = none). */
  bestFloor: number;
  /** Milestone floors whose reward was claimed. */
  claimed: number[];
}

export interface HuntState {
  /** Local day of the board the `won` list belongs to. */
  day: number;
  /** Hunt ids (`day:slot`) won today. */
  won: string[];
  /** Hunts won in total (sets the hunt rank). */
  completed: number;
}

export interface ArenaState {
  rating: number;
  bestRating: number;
  wins: number;
  losses: number;
  streak: number;
  season: number;
  seasonStartMs: number;
  /** Seed for the current opponent list (re-rolled after each fight). */
  opponentSeed: number;
}

export interface LifetimeStats {
  kills: number;
  bossKills: number;
  battles: number;
  victories: number;
  perfectDodges: number;
  upgrades: number;
  /** Highest upgrade level ever reached (kept after salvage). */
  bestPlus: number;
}

export interface HearthState {
  /** Epoch ms since rewards started building up. */
  sinceMs: number;
}

export interface ProfileData {
  selectedHero: HeroId;
  heroes: Record<HeroId, HeroProgress>;
  items: GearItem[];
  nextUid: number;
  pity: PityState;
  /** Last difficulty picked on the stage map. */
  difficulty: DifficultyId;
  dungeon: DungeonState;
  tower: TowerState;
  /** Highest boss-challenge tier cleared per boss id. */
  challenge: Record<string, number>;
  hunts: HuntState;
  arena: ArenaState;
  lifetime: LifetimeStats;
  daily: DailyState;
  hearth: HearthState;
  /** Achievement tiers claimed, by achievement id. */
  achievements: Record<string, number>;
  /** Ember Blessing stacks by stage record key (`stageId:difficulty`). */
  blessings: Record<string, number>;
}

export const ARENA_START_RATING = 1000;
export const DUNGEON_MAX_ENTRIES = 5;

export function defaultHeroProgress(unlocked: boolean): HeroProgress {
  return { unlocked, level: 1, xp: 0, equipped: {}, skills: {} };
}

export function createDefaultProfile(nowMs = Date.now()): ProfileData {
  const heroes = {} as Record<HeroId, HeroProgress>;
  for (const id of Object.keys(HEROES) as HeroId[]) {
    heroes[id] = defaultHeroProgress(HEROES[id].unlock === null);
  }
  return {
    selectedHero: DEFAULT_HERO,
    heroes,
    items: [],
    nextUid: 1,
    pity: { sinceEpic: 0, sinceLegendary: 0 },
    difficulty: 'normal',
    dungeon: { entries: DUNGEON_MAX_ENTRIES, refillAtMs: nowMs, runs: 0, bestRooms: 0 },
    tower: { bestFloor: 0, claimed: [] },
    challenge: {},
    hunts: { day: 0, won: [], completed: 0 },
    arena: {
      rating: ARENA_START_RATING,
      bestRating: ARENA_START_RATING,
      wins: 0,
      losses: 0,
      streak: 0,
      season: 1,
      seasonStartMs: nowMs,
      opponentSeed: 1,
    },
    lifetime: {
      kills: 0,
      bossKills: 0,
      battles: 0,
      victories: 0,
      perfectDodges: 0,
      upgrades: 0,
      bestPlus: 0,
    },
    daily: createDailyState(),
    hearth: { sinceMs: nowMs },
    achievements: {},
    blessings: {},
  };
}

// ------------------------------------------------------------------ sanitising

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function int(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return list.find((x) => x === v) ?? fallback;
}

function sanitizeRoll(raw: unknown): StatRoll | null {
  if (!isRecord(raw)) return null;
  const stat = GEAR_STATS.find((s) => s === raw['stat']);
  const value = raw['value'];
  if (stat === undefined || typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    return null;
  return { stat, value };
}

function sanitizeItem(raw: unknown): GearItem | null {
  if (!isRecord(raw)) return null;
  const slot = GEAR_SLOTS.find((s) => s === raw['slot']);
  const rarity = RARITIES.find((r) => r === raw['rarity']);
  const main = sanitizeRoll(raw['main']);
  const uid = raw['uid'];
  if (slot === undefined || rarity === undefined || main === null) return null;
  if (typeof uid !== 'number' || !Number.isInteger(uid) || uid <= 0) return null;
  const subs: StatRoll[] = [];
  if (Array.isArray(raw['subs'])) {
    for (const s of raw['subs']) {
      const r = sanitizeRoll(s);
      if (r !== null) subs.push(r);
    }
  }
  return {
    uid,
    slot,
    rarity,
    base: int(raw['base'], 0, 99, 0),
    ilvl: int(raw['ilvl'], 1, 999, 1),
    plus: int(raw['plus'], 0, GEAR_CONFIG.maxPlus, 0),
    main,
    subs,
    locked: raw['locked'] === true,
    isNew: raw['isNew'] === true,
  };
}

function sanitizeHero(
  raw: unknown,
  unlockedByDefault: boolean,
  itemUids: Set<number>,
): HeroProgress {
  const h = defaultHeroProgress(unlockedByDefault);
  if (!isRecord(raw)) return h;
  h.unlocked = unlockedByDefault || raw['unlocked'] === true;
  h.level = int(raw['level'], 1, XP_CONFIG.maxLevel, 1);
  h.xp = int(raw['xp'], 0, 1e9, 0);
  const eq = raw['equipped'];
  if (isRecord(eq)) {
    for (const slot of GEAR_SLOTS) {
      const uid = eq[slot];
      if (typeof uid === 'number' && itemUids.has(uid)) h.equipped[slot] = uid;
    }
  }
  const sk = raw['skills'];
  if (isRecord(sk)) {
    for (const [id, r] of Object.entries(sk)) {
      const rank = int(r, 0, 20, 0);
      if (rank > 0) h.skills[id] = rank;
    }
  }
  return h;
}

/**
 * Accepts anything (older saves, corruption) and returns a valid profile: unknown items and
 * fields are dropped, an item equipped by two heroes stays only on the first, uids stay unique.
 */
export function sanitizeProfile(raw: unknown, nowMs = Date.now()): ProfileData {
  const p = createDefaultProfile(nowMs);
  if (!isRecord(raw)) return p;
  const seen = new Set<number>();
  if (Array.isArray(raw['items'])) {
    for (const r of raw['items']) {
      const item = sanitizeItem(r);
      if (item === null || seen.has(item.uid)) continue;
      seen.add(item.uid);
      p.items.push(item);
    }
  }
  const maxUid = p.items.reduce((m, i) => Math.max(m, i.uid), 0);
  p.nextUid = Math.max(maxUid + 1, int(raw['nextUid'], 1, Number.MAX_SAFE_INTEGER, 1));
  const heroes = isRecord(raw['heroes']) ? raw['heroes'] : {};
  const claimed = new Set<number>();
  for (const id of Object.keys(HEROES) as HeroId[]) {
    const h = sanitizeHero(heroes[id], HEROES[id].unlock === null, seen);
    for (const slot of GEAR_SLOTS) {
      const uid = h.equipped[slot];
      if (uid === undefined) continue;
      const item = p.items.find((i) => i.uid === uid);
      if (claimed.has(uid) || item === undefined || item.slot !== slot) delete h.equipped[slot];
      else claimed.add(uid);
    }
    p.heroes[id] = h;
  }
  const sel = (Object.keys(HEROES) as HeroId[]).find((id) => id === raw['selectedHero']);
  if (sel !== undefined && p.heroes[sel].unlocked) p.selectedHero = sel;
  if (isRecord(raw['pity'])) {
    p.pity.sinceEpic = int(raw['pity']['sinceEpic'], 0, 1000, 0);
    p.pity.sinceLegendary = int(raw['pity']['sinceLegendary'], 0, 1000, 0);
  }
  p.difficulty = oneOf(['normal', 'hard', 'nightmare'] as const, raw['difficulty'], 'normal');
  if (isRecord(raw['dungeon'])) {
    const d = raw['dungeon'];
    p.dungeon.entries = int(d['entries'], 0, DUNGEON_MAX_ENTRIES, DUNGEON_MAX_ENTRIES);
    p.dungeon.refillAtMs = Math.min(nowMs, num(d['refillAtMs'], nowMs));
    p.dungeon.runs = int(d['runs'], 0, 1e9, 0);
    p.dungeon.bestRooms = int(d['bestRooms'], 0, 1000, 0);
  }
  if (isRecord(raw['tower'])) {
    const t = raw['tower'];
    p.tower.bestFloor = int(t['bestFloor'], 0, 100_000, 0);
    if (Array.isArray(t['claimed'])) {
      const floors = new Set<number>();
      for (const f of t['claimed']) {
        const v = int(f, 0, 100_000, 0);
        if (v > 0 && v <= p.tower.bestFloor) floors.add(v);
      }
      p.tower.claimed = [...floors].sort((a, b) => a - b);
    }
  }
  if (isRecord(raw['challenge'])) {
    for (const [id, tier] of Object.entries(raw['challenge'])) {
      const t = int(tier, 0, 100, 0);
      if (t > 0) p.challenge[id] = t;
    }
  }
  if (isRecord(raw['hunts'])) {
    const h = raw['hunts'];
    p.hunts.day = int(h['day'], 0, 1e7, 0);
    p.hunts.completed = int(h['completed'], 0, 1e9, 0);
    if (Array.isArray(h['won'])) {
      const prefix = `${p.hunts.day}:`;
      p.hunts.won = [
        ...new Set(
          h['won'].filter(
            (x): x is string => typeof x === 'string' && x.startsWith(prefix) && x.length < 20,
          ),
        ),
      ];
    }
  }
  if (isRecord(raw['arena'])) {
    const a = raw['arena'];
    p.arena.rating = int(a['rating'], 0, 100_000, ARENA_START_RATING);
    p.arena.bestRating = Math.max(p.arena.rating, int(a['bestRating'], 0, 100_000, p.arena.rating));
    p.arena.wins = int(a['wins'], 0, 1e9, 0);
    p.arena.losses = int(a['losses'], 0, 1e9, 0);
    p.arena.streak = int(a['streak'], -1000, 1000, 0);
    p.arena.season = int(a['season'], 1, 1e6, 1);
    p.arena.seasonStartMs = Math.min(nowMs, num(a['seasonStartMs'], nowMs));
    p.arena.opponentSeed = int(a['opponentSeed'], 1, 2 ** 31 - 1, 1);
  }
  if (isRecord(raw['lifetime'])) {
    const l = raw['lifetime'];
    p.lifetime.kills = int(l['kills'], 0, 1e12, 0);
    p.lifetime.bossKills = int(l['bossKills'], 0, 1e12, 0);
    p.lifetime.battles = int(l['battles'], 0, 1e12, 0);
    p.lifetime.victories = int(l['victories'], 0, 1e12, 0);
    p.lifetime.perfectDodges = int(l['perfectDodges'], 0, 1e12, 0);
    p.lifetime.upgrades = int(l['upgrades'], 0, 1e12, 0);
    p.lifetime.bestPlus = int(l['bestPlus'], 0, GEAR_CONFIG.maxPlus, 0);
  }
  p.lifetime.bestPlus = p.items.reduce((m, i) => Math.max(m, i.plus), p.lifetime.bestPlus);
  if (isRecord(raw['daily'])) {
    const d = raw['daily'];
    p.daily.day = int(d['day'], -1, 1e7, -1);
    p.daily.bonusClaimed = d['bonusClaimed'] === true;
    p.daily.loginDay = int(d['loginDay'], -1, 1e7, -1);
    p.daily.loginCount = int(d['loginCount'], 0, 1e7, 0);
    if (Array.isArray(d['quests'])) {
      for (const q of d['quests']) {
        if (!isRecord(q)) continue;
        const def = DAILY_QUESTS.find((x) => x.id === q['id']);
        if (def === undefined || p.daily.quests.some((x) => x.id === def.id)) continue;
        p.daily.quests.push({
          id: def.id,
          progress: int(q['progress'], 0, def.target, 0),
          claimed: q['claimed'] === true,
        });
      }
    }
  }
  if (isRecord(raw['hearth'])) {
    p.hearth.sinceMs = Math.min(nowMs, num(raw['hearth']['sinceMs'], nowMs));
  }
  if (isRecord(raw['achievements'])) {
    for (const a of ACHIEVEMENTS) {
      const t = int(raw['achievements'][a.id], 0, a.tiers.length, 0);
      if (t > 0) p.achievements[a.id] = t;
    }
  }
  if (isRecord(raw['blessings'])) {
    for (const [key, stacks] of Object.entries(raw['blessings'])) {
      const v = int(stacks, 0, BLESSING_CONFIG.maxStacks, 0);
      if (v > 0 && /^c\d+s\d+:(normal|hard|nightmare)$/.test(key)) p.blessings[key] = v;
    }
  }
  return p;
}
