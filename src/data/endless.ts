/**
 * Endless Adventure: chapters after the hand-made four, generated deterministically from the
 * chapter number (same number → same chapter, on every device, forever). Each has an original
 * name, 8 stages in the hand-made rhythm (normal stages, an elite at 4 — and at 6 deeper down —
 * and a boss at 8), a level curve that continues chapter 4's and slowly flattens, waves drawn
 * from the whole enemy roster with growing variety and density, elite affixes that stack with
 * depth, arenas drawn from every arena there is, and rewards that grow with depth.
 */
import { mulberry32 } from '../core/random';
import { AFFIX_IDS, type AffixId } from './affixes';
import { ARENAS, type ArenaId } from './arenas';
import type { BossId } from './bosses';
import { ENEMIES, type EnemyId } from './enemies';
import { buildChapter, type ChapterDef, type StageSpec } from './stages';

export const ENDLESS_CONFIG = {
  /** First generated chapter (after the hand-made ones). */
  firstChapter: 5,
  /** Highest chapter number a save may reach (keeps ids and numbers bounded). */
  maxChapter: 999,
  /** Level curve: chapter 5 starts here and climbs `slope` levels per chapter... */
  startLevel: 33,
  slope: 8,
  /** ...for this many chapters, then flattens: slope × knee / (knee + chapters past it). */
  linearChapters: 1,
  knee: 6,
  /** Waves: enemy "weight" per wave (heavy enemies weigh more), growing with depth. */
  waveWeight: { base: 7, perDepth: 0.5, max: 14 },
  /** Distinct enemy types per wave: base + depth / perType, capped. */
  waveTypes: { base: 2, perType: 4, max: 4 },
  /** Elite affixes on wave enemies (every `enemyEvery` chapters of depth) and on bosses. */
  affixes: { enemyEvery: 3, enemyMax: 3, bossBase: 1, bossEvery: 3, bossMax: 4 },
  /**
   * Depth pressure on top of the level. Gear outgrows enemy damage past the hero level cap, so
   * enemy ATK climbs per chapter of depth (capped); stacking affixes already make bosses
   * tougher, so base HP eases off a little instead (HP ÷ (1 + hpEase × depth)).
   */
  pressure: { hpEase: 0.01, atkPerDepth: 0.17, atkMax: 10 },
  /** First-clear gems for elite / boss stages: base + perDepth × depth, capped. */
  gems: {
    miniboss: { base: 6, perDepth: 1, max: 30 },
    boss: { base: 15, perDepth: 2, max: 60 },
  },
  /** A second elite stage (index 5) from this depth on. */
  secondEliteDepth: 3,
  /** The chapters that introduce the newer bosses (elite at stage 4, boss at stage 8). */
  intros: {
    5: { miniboss: 'hollow_twin', boss: 'headsman' },
    6: { boss: 'bone_cantor' },
    7: { boss: 'twin_maw' },
    8: { boss: 'ossuary_queen' },
  } as Readonly<Record<number, { readonly miniboss?: BossId; readonly boss: BossId }>>,
  /** Every boss appears in one of these pools (tested). */
  elitePool: [
    'gaoler',
    'seer_exalted',
    'penitent',
    'ash_behemoth',
    'brood_weaver',
    'hollow_twin',
  ] satisfies readonly BossId[],
  lordPool: [
    'hollow_warden',
    'mother_of_ash',
    'bound_king',
    'cinder_wyrm',
    'headsman',
    'bone_cantor',
    'twin_maw',
    'ossuary_queen',
  ] satisfies readonly BossId[],
} as const;

const C = ENDLESS_CONFIG;

/** Chapters past the hand-made ones (chapter 5 = depth 1). */
export function endlessDepth(chapter: number): number {
  return Math.max(0, chapter - C.firstChapter + 1);
}

/**
 * Enemy level of stage `index` (0..7) of a generated chapter: chapter 4's +8 per chapter for
 * the first few, then a gently flattening curve (never decreasing).
 */
export function endlessLevel(chapter: number, index: number): number {
  const x = chapter - C.firstChapter + index / 8;
  const lin = C.linearChapters;
  if (x <= lin) return Math.floor(C.startLevel + C.slope * x);
  // Past the knee the slope is slope × knee / (knee + t); once that falls to one level per
  // chapter it stays there (the curve keeps climbing, smoothly, forever).
  const t = x - lin;
  const flat = C.slope * C.knee - C.knee;
  const bend = C.slope * C.knee * Math.log(1 + Math.min(t, flat) / C.knee);
  return Math.floor(C.startLevel + C.slope * lin + bend + Math.max(0, t - flat));
}

/** Extra enemy HP / ATK multipliers for a chapter's depth (on top of its level). */
export function endlessPressure(chapter: number): { hp: number; atk: number } {
  const d = Math.max(0, endlessDepth(chapter) - 1);
  return {
    hp: 1 / (1 + C.pressure.hpEase * d),
    atk: Math.min(C.pressure.atkMax, 1 + C.pressure.atkPerDepth * d),
  };
}

// ------------------------------------------------------------------ names

const CH_PREFIX = [
  'Ember',
  'Ash',
  'Soot',
  'Gloam',
  'Cinder',
  'Hollow',
  'Pale',
  'Ruin',
  'Marrow',
  'Dusk',
  'Grave',
  'Kiln',
  'Thorn',
  'Veil',
  'Iron',
  'Bone',
  'Smoke',
  'Char',
] as const;
const CH_SUFFIX = [
  'reach',
  'mire',
  'hollow',
  'fell',
  'march',
  'deep',
  'wold',
  'spire',
  'barrow',
  'vale',
  'moor',
  'gate',
  'warren',
  'crag',
] as const;
const CH_FORMS = [
  (a: string, b: string, _adj: string, _of: string) => `The ${a}${b}`,
  (_a: string, b: string, adj: string, _of: string) => `The ${adj} ${capital(b)}`,
  (a: string, b: string, _adj: string, of: string) => `${a}${b} of ${of}`,
] as const;
const ADJECTIVES = [
  'Weeping',
  'Sunken',
  'Shattered',
  'Smoldering',
  'Silent',
  'Drowned',
  'Forsaken',
  'Bleeding',
  'Hollowed',
  'Ashen',
  'Nameless',
  'Unlit',
  'Chained',
  'Withered',
] as const;
const SUBTITLE_SUBJECTS = [
  'the ashes',
  'the dead',
  'the old fires',
  'the chains',
  'the bells',
  'the hungry dark',
  'the last embers',
  'forgotten oaths',
  'the drowned kings',
  'the bones',
] as const;
const SUBTITLE_VERBS = [
  'still sing',
  'keep their watch',
  'refuse to cool',
  'remember your name',
  'grow teeth',
  'never sleep',
  'wait for a crown',
  'whisper of the first fire',
  'walk in circles',
] as const;
const STAGE_PLACES = [
  'Gate',
  'Stair',
  'Nave',
  'Crossing',
  'Pit',
  'Bridge',
  'Hall',
  'Gallery',
  'Cloister',
  'Causeway',
  'Kennels',
  'Vault',
  'Terrace',
  'Well',
  'Crypt',
  'Forge',
] as const;
const STAGE_OF = [
  'Cinders',
  'Weeping',
  'Chains',
  'Ash',
  'Teeth',
  'Embers',
  'Bones',
  'Echoes',
  'Smoke',
  'Hunger',
  'Lanterns',
  'Thorns',
] as const;

function capital(s: string): string {
  return s.length > 0 ? `${(s[0] ?? '').toUpperCase()}${s.slice(1)}` : s;
}

function pick<T>(rng: () => number, list: readonly T[]): T {
  const v = list[Math.floor(rng() * list.length)];
  if (v === undefined) throw new Error('empty list');
  return v;
}

/** `n` distinct items in random order. */
function pickDistinct<T>(rng: () => number, list: readonly T[], n: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const [v] = pool.splice(Math.floor(rng() * pool.length), 1);
    if (v !== undefined) out.push(v);
  }
  return out;
}

// ------------------------------------------------------------------ waves

/** Heavier enemies count more toward a wave's size (one golem ≈ three bats). */
function enemyWeight(id: EnemyId): number {
  const hp = ENEMIES[id].stats.maxHp;
  return hp >= 1000 ? 3 : hp >= 450 ? 2 : 1;
}

/** Suicide runners are only mixed in, never a wave of their own. */
const SUPPORT_ONLY: ReadonlySet<EnemyId> = new Set<EnemyId>(['wretch', 'imp']);

function rollWave(
  rng: () => number,
  roster: readonly EnemyId[],
  types: number,
  weight: number,
): (readonly [EnemyId, number])[] {
  const leads = roster.filter((id) => !SUPPORT_ONLY.has(id));
  const chosen = pickDistinct(rng, leads, 1);
  for (const id of pickDistinct(rng, roster, types + 2)) {
    if (chosen.length >= types) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  const counts = new Map<EnemyId, number>();
  for (const id of chosen) counts.set(id, 1);
  let left = weight - chosen.reduce((s, id) => s + enemyWeight(id), 0);
  // Fill the rest, favouring the lighter types (heavy ones stay one or two).
  for (let guard = 0; left > 0 && guard < 64; guard++) {
    const id = pick(rng, chosen);
    const w = enemyWeight(id);
    if (w > left || (w === 3 && (counts.get(id) ?? 0) >= 2)) {
      if (chosen.every((c) => enemyWeight(c) > left)) break;
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
    left -= w;
  }
  return [...counts];
}

// ------------------------------------------------------------------ chapters

function chapterName(rng: () => number): { name: string; subtitle: string } {
  const a = pick(rng, CH_PREFIX);
  const b = pick(rng, CH_SUFFIX);
  const adj = pick(rng, ADJECTIVES);
  const name = pick(rng, CH_FORMS)(a, b, adj, pick(rng, STAGE_OF));
  const subtitle = `Where ${pick(rng, SUBTITLE_SUBJECTS)} ${pick(rng, SUBTITLE_VERBS)}`;
  return { name, subtitle };
}

const BOSS_PLACES = ['Throne', 'Sanctum', 'Lair', 'Altar', 'Court', 'Pyre', 'Den'] as const;

function stageName(rng: () => number, used: Set<string>, boss: boolean): string {
  for (let i = 0; i < 12; i++) {
    const form = rng();
    const n = boss
      ? `The ${pick(rng, ADJECTIVES)} ${pick(rng, BOSS_PLACES)}`
      : form < 0.45
        ? `${pick(rng, STAGE_PLACES)} of ${pick(rng, STAGE_OF)}`
        : form < 0.8
          ? `The ${pick(rng, ADJECTIVES)} ${pick(rng, STAGE_PLACES)}`
          : `${pick(rng, CH_PREFIX)}${pick(rng, CH_SUFFIX)} ${pick(rng, STAGE_PLACES)}`;
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  return `${pick(rng, STAGE_PLACES)} ${used.size + 1}`;
}

function gemsFor(kind: 'miniboss' | 'boss', depth: number): number {
  const g = C.gems[kind];
  return Math.min(g.max, g.base + g.perDepth * depth);
}

/** Builds generated chapter `n` (n ≥ firstChapter). Pure: same n → same chapter. */
export function generateChapter(n: number): ChapterDef {
  const rng = mulberry32(0x5eed + n * 7919);
  const depth = endlessDepth(n);
  const { name, subtitle } = chapterName(rng);
  const arenas = Object.keys(ARENAS) as ArenaId[];
  const home = pick(rng, arenas);
  const roster = Object.keys(ENEMIES) as EnemyId[];
  const intro = C.intros[n];
  const lord = intro?.boss ?? pick(rng, C.lordPool);
  const elites = C.elitePool.filter((b) => b !== lord);
  const firstElite = intro?.miniboss ?? pick(rng, elites);
  const secondElite = pick(
    rng,
    elites.filter((b) => b !== firstElite),
  );
  const eliteAt = depth >= C.secondEliteDepth ? [3, 5] : [3];
  const types = Math.min(
    C.waveTypes.max,
    C.waveTypes.base + Math.floor(depth / C.waveTypes.perType),
  );
  const weight = Math.min(
    C.waveWeight.max,
    Math.round(C.waveWeight.base + C.waveWeight.perDepth * depth),
  );
  const enemyAffixes = Math.min(C.affixes.enemyMax, Math.floor(depth / C.affixes.enemyEvery));
  const bossAffixes = Math.min(
    C.affixes.bossMax,
    C.affixes.bossBase + Math.floor(depth / C.affixes.bossEvery),
  );
  const pressure = endlessPressure(n);
  const used = new Set<string>();
  const specs: StageSpec[] = [];
  for (let index = 0; index < 8; index++) {
    const boss: BossId | undefined =
      index === 7
        ? lord
        : index === eliteAt[0]
          ? firstElite
          : index === eliteAt[1]
            ? secondElite
            : undefined;
    const kind = index === 7 ? 'boss' : boss !== undefined ? 'miniboss' : 'normal';
    const waveCount = kind === 'normal' ? (depth >= 6 ? 4 : 3) : 2;
    const waves = Array.from({ length: waveCount }, () => rollWave(rng, roster, types, weight));
    const arena = rng() < 0.6 || kind === 'boss' ? home : pick(rng, arenas);
    // Later stages of a chapter carry the full set; its first stages one affix less.
    const extra = index >= 4 ? 0 : -1;
    const affixes = pickDistinct(rng, AFFIX_IDS, Math.max(0, enemyAffixes + extra));
    const bossSet: AffixId[] =
      boss === undefined
        ? []
        : pickDistinct(rng, AFFIX_IDS, Math.max(0, bossAffixes - (kind === 'miniboss' ? 1 : 0)));
    specs.push({
      name: stageName(rng, used, kind === 'boss'),
      arena,
      waves,
      kind,
      level: endlessLevel(n, index),
      pressure,
      ...(boss !== undefined ? { boss } : {}),
      ...(affixes.length > 0 ? { affixes } : {}),
      ...(bossSet.length > 0 ? { bossAffixes: bossSet } : {}),
      ...(kind === 'normal' ? {} : { gems: gemsFor(kind, depth) }),
      parTimeSec: kind === 'boss' ? 420 + waveCount * 20 : kind === 'miniboss' ? 300 : undefined,
    });
  }
  return buildChapter(n, `ch${n}`, name, subtitle, endlessLevel(n, 0), specs);
}
