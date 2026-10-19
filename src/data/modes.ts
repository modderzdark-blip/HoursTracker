/**
 * Game-mode unlock rules and labels. Each mode's own tunables live with the mode (dungeon,
 * tower, challenge, arena sections below are filled in as the modes are added).
 */
export type ModeId = 'adventure' | 'dungeon' | 'tower' | 'challenge' | 'arena';

export interface ModeInfo {
  readonly id: ModeId;
  readonly name: string;
  readonly blurb: string;
  /** Stage id that must be cleared (any difficulty) to unlock; null = always open. */
  readonly requiresStage: string | null;
  readonly requiresLabel: string;
}

export const MODES: Readonly<Record<ModeId, ModeInfo>> = {
  adventure: {
    id: 'adventure',
    name: 'Adventure',
    blurb: 'Fight through the fallen lands, chapter by chapter.',
    requiresStage: null,
    requiresLabel: '',
  },
  dungeon: {
    id: 'dungeon',
    name: 'Dungeon',
    blurb: 'Delve through random chambers for richer spoils.',
    requiresStage: 'c1s8',
    requiresLabel: 'Clear Chapter 1',
  },
  challenge: {
    id: 'challenge',
    name: 'Boss Challenge',
    blurb: 'Face defeated bosses again at higher tiers.',
    requiresStage: 'c1s4',
    requiresLabel: 'Defeat The Gaoler (1-4)',
  },
  arena: {
    id: 'arena',
    name: 'Arena',
    blurb: 'Duel other hunters’ shades for rank and glory.',
    requiresStage: 'c1s8',
    requiresLabel: 'Clear Chapter 1',
  },
  tower: {
    id: 'tower',
    name: 'Demon Tower',
    blurb: 'Climb endless floors. A tyrant waits every tenth.',
    requiresStage: 'c2s8',
    requiresLabel: 'Clear Chapter 2',
  },
};

export const MODE_ORDER: readonly ModeId[] = [
  'adventure',
  'dungeon',
  'challenge',
  'arena',
  'tower',
];
