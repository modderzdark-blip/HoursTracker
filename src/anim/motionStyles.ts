/**
 * Movement personalities. Every humanoid shares one skeleton and one set of clip builders; the
 * style decides how those clips are shaped: a hunched shambling thrall, a twitchy scurrying
 * imp, a stomping brute, a gliding caster. Visual only: no gameplay timing lives here.
 */

/** Idle loop flavour. */
export type IdleKind =
  /** Combat-ready breathing with weight shifts (heroes). */
  | 'ready'
  /** Slow lolling sway, head drooping and twitching (the risen dead). */
  | 'sway'
  /** Quick shallow breaths and head snaps (imps, wretches). */
  | 'twitch'
  /** Deep heaving breaths, shoulders rolling (brutes, golems). */
  | 'heave'
  /** Shield up, small guarded adjustments. */
  | 'guard'
  /** Floating sway with weaving hands (casters). */
  | 'hover'
  /** Weapon low, shifting predatory weight (revenants, wardens). */
  | 'stalk';

/** Run cycle flavour (all keep the feet planted at the speed the actor moves). */
export type GaitKind =
  | 'run'
  /** Lurching uneven jog, one leg dragging, torso rolling. */
  | 'shamble'
  /** Low crouched dash, arms swept back. */
  | 'scurry'
  /** Heavy stomping run, big drop on every step. */
  | 'stomp'
  /** Upright measured march behind a shield. */
  | 'march'
  /** Smooth robed glide, upper body still. */
  | 'glide'
  /** Leaning predatory lope, blade trailing. */
  | 'prowl';

export type DeathKind = 'back' | 'crumple' | 'spin' | 'forward' | 'kneel';
export type SpawnKind = 'claw' | 'rise' | 'drop';

export interface MotionStyle {
  readonly idle: IdleKind;
  readonly gait: GaitKind;
  /** 0..1: how much the arms keep their stance while running (shields, two-handed weapons). */
  readonly holdArms: number;
  /** 0..1: telegraph exaggeration (deeper wind-ups, a tremble while holding the pose). */
  readonly windup: number;
  /** Hit reaction size (1 = normal). */
  readonly flinch: number;
  /** 0 light .. 1 heavy: deeper landings, slower settles. */
  readonly weight: number;
  /** Death animations this body picks from (by hit direction and chance). */
  readonly deaths: readonly DeathKind[];
  readonly spawn: SpawnKind;
}

const HERO_BASE: MotionStyle = {
  idle: 'ready',
  gait: 'run',
  holdArms: 0.3,
  windup: 0,
  flinch: 1,
  weight: 0.3,
  deaths: ['kneel'],
  spawn: 'rise',
};

/** Hero styles by hero id. */
export const HERO_STYLES: Readonly<Record<string, MotionStyle>> = {
  kael: { ...HERO_BASE, holdArms: 0.35, weight: 0.2 },
  brann: { ...HERO_BASE, holdArms: 0.75, weight: 0.65, flinch: 0.8 },
  lyra: { ...HERO_BASE, holdArms: 0.2, weight: 0.1 },
  garrick: { ...HERO_BASE, holdArms: 0.85, weight: 0.8, flinch: 0.7 },
  seraphine: { ...HERO_BASE, holdArms: 0.55, weight: 0.15 },
  ryn: { ...HERO_BASE, holdArms: 0.65, weight: 0.05, flinch: 1.1 },
  valka: { ...HERO_BASE, holdArms: 0.6, weight: 0.3 },
  morrow: { ...HERO_BASE, holdArms: 0.65, weight: 0.35 },
};

const DEFAULT_ENEMY: MotionStyle = {
  idle: 'sway',
  gait: 'run',
  holdArms: 0,
  windup: 0.7,
  flinch: 1,
  weight: 0.4,
  deaths: ['back', 'crumple', 'spin'],
  spawn: 'rise',
};

/** Enemy and boss styles by rig id. */
export const RIG_STYLES: Readonly<Record<string, MotionStyle>> = {
  thrall: {
    ...DEFAULT_ENEMY,
    idle: 'sway',
    gait: 'shamble',
    windup: 0.8,
    flinch: 1.15,
    deaths: ['back', 'crumple', 'spin', 'forward'],
    spawn: 'claw',
  },
  imp: {
    ...DEFAULT_ENEMY,
    idle: 'twitch',
    gait: 'scurry',
    windup: 0.6,
    flinch: 1.35,
    weight: 0.05,
    deaths: ['spin', 'back', 'forward'],
    spawn: 'drop',
  },
  brute: {
    ...DEFAULT_ENEMY,
    idle: 'heave',
    gait: 'stomp',
    holdArms: 0.2,
    windup: 1,
    flinch: 0.6,
    weight: 1,
    deaths: ['crumple', 'back'],
    spawn: 'claw',
  },
  gaoler: {
    ...DEFAULT_ENEMY,
    idle: 'heave',
    gait: 'stomp',
    holdArms: 0.2,
    windup: 1,
    flinch: 0.5,
    weight: 1,
    deaths: ['crumple'],
    spawn: 'rise',
  },
  bulwark: {
    ...DEFAULT_ENEMY,
    idle: 'guard',
    gait: 'march',
    holdArms: 0.85,
    windup: 0.8,
    flinch: 0.75,
    weight: 0.7,
    deaths: ['crumple', 'back'],
    spawn: 'rise',
  },
  penitent: {
    ...DEFAULT_ENEMY,
    idle: 'guard',
    gait: 'march',
    holdArms: 0.85,
    windup: 1,
    flinch: 0.5,
    weight: 0.9,
    deaths: ['kneel'],
    spawn: 'rise',
  },
  seer: {
    ...DEFAULT_ENEMY,
    idle: 'hover',
    gait: 'glide',
    holdArms: 0.5,
    windup: 0.8,
    weight: 0.2,
    deaths: ['crumple', 'spin'],
    spawn: 'rise',
  },
  seer_elder: {
    ...DEFAULT_ENEMY,
    idle: 'hover',
    gait: 'glide',
    holdArms: 0.5,
    windup: 1,
    flinch: 0.6,
    weight: 0.5,
    deaths: ['kneel'],
    spawn: 'rise',
  },
  wretch: {
    ...DEFAULT_ENEMY,
    idle: 'twitch',
    gait: 'scurry',
    windup: 0.9,
    flinch: 1.3,
    weight: 0.1,
    deaths: ['crumple', 'spin'],
    spawn: 'claw',
  },
  hexcaller: {
    ...DEFAULT_ENEMY,
    idle: 'hover',
    gait: 'glide',
    holdArms: 0.5,
    windup: 0.85,
    weight: 0.2,
    deaths: ['spin', 'crumple'],
    spawn: 'rise',
  },
  revenant: {
    ...DEFAULT_ENEMY,
    idle: 'stalk',
    gait: 'prowl',
    holdArms: 0.45,
    windup: 0.9,
    flinch: 0.85,
    weight: 0.6,
    deaths: ['back', 'forward', 'crumple'],
    spawn: 'claw',
  },
  golem: {
    ...DEFAULT_ENEMY,
    idle: 'heave',
    gait: 'stomp',
    holdArms: 0.3,
    windup: 1,
    flinch: 0.45,
    weight: 1,
    deaths: ['crumple'],
    spawn: 'rise',
  },
  mother: {
    ...DEFAULT_ENEMY,
    idle: 'heave',
    gait: 'stomp',
    windup: 1,
    flinch: 0.5,
    weight: 0.9,
    deaths: ['kneel'],
    spawn: 'rise',
  },
  king: {
    ...DEFAULT_ENEMY,
    idle: 'heave',
    gait: 'stomp',
    holdArms: 0.2,
    windup: 1,
    flinch: 0.45,
    weight: 1,
    deaths: ['kneel'],
    spawn: 'rise',
  },
  warden: {
    ...DEFAULT_ENEMY,
    idle: 'stalk',
    gait: 'prowl',
    holdArms: 0.5,
    windup: 1,
    flinch: 0.5,
    weight: 0.85,
    deaths: ['kneel'],
    spawn: 'rise',
  },
  dummy: { ...DEFAULT_ENEMY, idle: 'ready', flinch: 1.2, deaths: ['back'] },
};

export function heroStyle(heroId: string): MotionStyle {
  return HERO_STYLES[heroId] ?? HERO_BASE;
}

export function rigStyle(rigId: string): MotionStyle {
  return RIG_STYLES[rigId] ?? DEFAULT_ENEMY;
}
