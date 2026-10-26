/**
 * Elite affixes: modifiers that twist enemies and bosses on deeper stages (Endless Adventure).
 * Each affix is data: stat multipliers plus optional behaviours (life drain, a damage-soaking
 * ward, a blast on death, a frenzy at low health). Several affixes stack by multiplying their
 * stats and adding their behaviours; the actors read the combined result (src/actors/Enemy.ts).
 */

export type AffixId =
  'ironclad' | 'bloodsworn' | 'cinderburst' | 'quickened' | 'warded' | 'frenzied' | 'hulking';

export interface AffixDef {
  readonly id: AffixId;
  readonly name: string;
  /** One line for the pre-battle panel. */
  readonly text: string;
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly poise: number;
  readonly speed: number;
  /** Heals this fraction of the damage it deals. */
  readonly drain?: number;
  /**
   * A barrier that soaks `absorb` of every blow until it has taken `frac` × max HP, then
   * shatters; it reforms after `reformMs` without being hit.
   */
  readonly ward?: { readonly frac: number; readonly absorb: number; readonly reformMs: number };
  /** A telegraphed blast where it dies (skill multiplier `damage`, radius in metres). */
  readonly burst?: { readonly damage: number; readonly radius: number; readonly delayMs: number };
  /** Below `belowHpFrac`: damage × `damage`, speed × `speed` for the rest of the fight. */
  readonly frenzy?: {
    readonly belowHpFrac: number;
    readonly damage: number;
    readonly speed: number;
  };
}

export const AFFIXES: Readonly<Record<AffixId, AffixDef>> = {
  ironclad: {
    id: 'ironclad',
    name: 'Ironclad',
    text: '+60% defence, hard to stagger',
    hp: 1,
    atk: 1,
    def: 1.6,
    poise: 1.6,
    speed: 1,
  },
  bloodsworn: {
    id: 'bloodsworn',
    name: 'Bloodsworn',
    text: 'Heals from the wounds it deals',
    hp: 1,
    atk: 1,
    def: 1,
    poise: 1,
    speed: 1,
    drain: 0.3,
  },
  cinderburst: {
    id: 'cinderburst',
    name: 'Cinderburst',
    text: 'Erupts where it falls — step away',
    hp: 1,
    atk: 1,
    def: 1,
    poise: 1,
    speed: 1,
    burst: { damage: 1.2, radius: 2.4, delayMs: 1000 },
  },
  quickened: {
    id: 'quickened',
    name: 'Quickened',
    text: 'Moves and strikes 15% faster',
    hp: 1,
    atk: 1,
    def: 1,
    poise: 1,
    speed: 1.15,
  },
  warded: {
    id: 'warded',
    name: 'Warded',
    text: 'A ward soaks blows until it shatters',
    hp: 1,
    atk: 1,
    def: 1,
    poise: 1,
    speed: 1,
    ward: { frac: 0.25, absorb: 0.6, reformMs: 7000 },
  },
  frenzied: {
    id: 'frenzied',
    name: 'Frenzied',
    text: 'Below 40% health: +30% damage, faster',
    hp: 1,
    atk: 1,
    def: 1,
    poise: 1,
    speed: 1,
    frenzy: { belowHpFrac: 0.4, damage: 1.3, speed: 1.12 },
  },
  hulking: {
    id: 'hulking',
    name: 'Hulking',
    text: '+40% health',
    hp: 1.4,
    atk: 1,
    def: 1,
    poise: 1.2,
    speed: 1,
  },
};

export const AFFIX_IDS = Object.keys(AFFIXES) as AffixId[];

/** The behaviours of a set of affixes, folded together (stats go into the enemy scale). */
export interface AffixEffects {
  readonly drain: number;
  readonly ward: NonNullable<AffixDef['ward']> | null;
  readonly burst: NonNullable<AffixDef['burst']> | null;
  readonly frenzy: NonNullable<AffixDef['frenzy']> | null;
}

export const NO_AFFIX_EFFECTS: AffixEffects = { drain: 0, ward: null, burst: null, frenzy: null };

export interface AffixTotals {
  readonly hp: number;
  readonly atk: number;
  readonly def: number;
  readonly poise: number;
  readonly speed: number;
  readonly effects: AffixEffects;
}

/** Stats multiply; drains add; the strongest ward / burst / frenzy wins (no duplicates). */
export function combineAffixes(ids: readonly AffixId[]): AffixTotals {
  let hp = 1;
  let atk = 1;
  let def = 1;
  let poise = 1;
  let speed = 1;
  let drain = 0;
  let ward: AffixEffects['ward'] = null;
  let burst: AffixEffects['burst'] = null;
  let frenzy: AffixEffects['frenzy'] = null;
  for (const id of new Set(ids)) {
    const a = AFFIXES[id];
    hp *= a.hp;
    atk *= a.atk;
    def *= a.def;
    poise *= a.poise;
    speed *= a.speed;
    drain += a.drain ?? 0;
    if (a.ward !== undefined && (ward === null || a.ward.frac > ward.frac)) ward = a.ward;
    if (a.burst !== undefined && (burst === null || a.burst.damage > burst.damage)) burst = a.burst;
    if (a.frenzy !== undefined && (frenzy === null || a.frenzy.damage > frenzy.damage))
      frenzy = a.frenzy;
  }
  const effects =
    drain === 0 && ward === null && burst === null && frenzy === null
      ? NO_AFFIX_EFFECTS
      : { drain, ward, burst, frenzy };
  return { hp, atk, def, poise, speed, effects };
}

/** "Ironclad · Warded" (empty for none). */
export function affixLabel(ids: readonly AffixId[] | undefined): string {
  return (ids ?? []).map((id) => AFFIXES[id].name).join(' · ');
}
