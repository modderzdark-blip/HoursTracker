export type StatusId = 'bleed' | 'burn' | 'slow';

export type StackRule =
  /** Each application adds a stack (up to max) and refreshes the duration. */
  | 'add'
  /** One stack; re-application refreshes the duration. */
  | 'refresh';

export interface StatusDef {
  readonly id: StatusId;
  readonly durationMs: number;
  /** 0 = no damage over time. */
  readonly tickMs: number;
  /** Damage per tick per stack = source ATK × this (then defense applies). */
  readonly tickAtkMult: number;
  readonly maxStacks: number;
  readonly stack: StackRule;
  /** Movement speed multiplier while active (1 = none). */
  readonly speedMult: number;
  readonly color: number;
}

export const STATUS_EFFECTS: Readonly<Record<StatusId, StatusDef>> = {
  bleed: {
    id: 'bleed',
    durationMs: 4000,
    tickMs: 500,
    tickAtkMult: 0.06,
    maxStacks: 5,
    stack: 'add',
    speedMult: 1,
    color: 0xd02030,
  },
  burn: {
    id: 'burn',
    durationMs: 3000,
    tickMs: 500,
    tickAtkMult: 0.1,
    maxStacks: 1,
    stack: 'refresh',
    speedMult: 1,
    color: 0xff7a20,
  },
  slow: {
    id: 'slow',
    durationMs: 2500,
    tickMs: 0,
    tickAtkMult: 0,
    maxStacks: 1,
    stack: 'refresh',
    speedMult: 0.6,
    color: 0x6aa0ff,
  },
};

export const STATUS_IDS: readonly StatusId[] = ['bleed', 'burn', 'slow'];
