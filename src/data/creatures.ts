/**
 * Non-humanoid bodies (bosses and some enemies): a body plan (spider, beast, wyrm) plus size and
 * colours. The plan decides the skeleton, the mesh and the procedural animation
 * (src/anim/creatures/); this file only holds look data.
 */

export type BodyPlan = 'spider' | 'beast' | 'wyrm' | 'wisp' | 'bat';

/** Animation an attack plays on a creature (attacks pick one with `motion`). */
export type CreatureMotion =
  | 'bite'
  | 'claw'
  | 'stab'
  | 'spit'
  | 'pounce'
  | 'charge'
  | 'howl'
  | 'breath'
  | 'stomp'
  | 'tailSwipe'
  | 'burrow'
  | 'summon';

export interface CreatureDef {
  readonly id: string;
  readonly plan: BodyPlan;
  /** Uniform scale of the whole body (1 = the plan's base size, about man-sized). */
  readonly scale: number;
  readonly colors: {
    /** Main hide / chitin. */
    readonly body: number;
    /** Plates, spikes, horns, claws. */
    readonly plates: number;
    /** Belly / underside. */
    readonly belly: number;
    /** Glowing eyes. */
    readonly eyes: number;
    /** Glowing markings, cracks, mouth. */
    readonly glow: number;
    /** Fresnel rim. */
    readonly rim: number;
  };
}

export type CreatureId =
  | 'brood_weaver'
  | 'broodling'
  | 'ash_behemoth'
  | 'ash_hound'
  | 'cinder_wyrm'
  | 'ember_wisp'
  | 'hex_wisp'
  | 'gloom_bat';

export const CREATURES: Readonly<Record<CreatureId, CreatureDef>> = {
  brood_weaver: {
    id: 'brood_weaver',
    plan: 'spider',
    scale: 2.3,
    colors: {
      body: 0x2a2030,
      plates: 0x6a5a70,
      belly: 0x3a2a34,
      eyes: 0x8ae04a,
      glow: 0x4aa82a,
      rim: 0x7ad05a,
    },
  },
  broodling: {
    id: 'broodling',
    plan: 'spider',
    scale: 0.75,
    colors: {
      body: 0x3a2a30,
      plates: 0x7a6a6a,
      belly: 0x4a3434,
      eyes: 0x9ae05a,
      glow: 0x5ab03a,
      rim: 0x8ad06a,
    },
  },
  ash_behemoth: {
    id: 'ash_behemoth',
    plan: 'beast',
    scale: 2.4,
    colors: {
      body: 0x3a2a26,
      plates: 0x8a7a6a,
      belly: 0x5a4034,
      eyes: 0xffb030,
      glow: 0xff6a1a,
      rim: 0xff8a3a,
    },
  },
  ash_hound: {
    id: 'ash_hound',
    plan: 'beast',
    scale: 0.95,
    colors: {
      body: 0x3a3030,
      plates: 0x7a6e66,
      belly: 0x504040,
      eyes: 0xff8a2a,
      glow: 0xff5a1a,
      rim: 0xff7a3a,
    },
  },
  ember_wisp: {
    id: 'ember_wisp',
    plan: 'wisp',
    scale: 1,
    colors: {
      body: 0x2a1a16,
      plates: 0x8a6a58,
      belly: 0x3a2420,
      eyes: 0xfff0a0,
      glow: 0xff7a1a,
      rim: 0xff9a4a,
    },
  },
  hex_wisp: {
    id: 'hex_wisp',
    plan: 'wisp',
    scale: 1.15,
    colors: {
      body: 0x1c1626,
      plates: 0x6a5a80,
      belly: 0x2a2036,
      eyes: 0xf0d0ff,
      glow: 0xb050ff,
      rim: 0xc080ff,
    },
  },
  gloom_bat: {
    id: 'gloom_bat',
    plan: 'bat',
    scale: 1.25,
    colors: {
      body: 0x4a3a44,
      plates: 0x7a6a72,
      belly: 0x6a4450,
      eyes: 0xff4a5a,
      glow: 0xff3a5a,
      rim: 0xff6a7a,
    },
  },
  cinder_wyrm: {
    id: 'cinder_wyrm',
    plan: 'wyrm',
    scale: 2.1,
    colors: {
      body: 0x3a1c1a,
      plates: 0x9a7a5a,
      belly: 0x8a5a3a,
      eyes: 0xffe060,
      glow: 0xff7a1a,
      rim: 0xffa04a,
    },
  },
};
