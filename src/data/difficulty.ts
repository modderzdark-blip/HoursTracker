export type DifficultyId = 'normal' | 'hard' | 'nightmare';

export interface DifficultyDef {
  readonly id: DifficultyId;
  readonly label: string;
  readonly enemyHp: number;
  /** The "difficulty modifier" in the damage formula for enemy → player damage. */
  readonly enemyDamage: number;
  readonly enemyPoise: number;
  readonly rewards: number;
  /** Simultaneous attack tokens (enemies allowed to attack the player at once). */
  readonly attackTokens: number;
}

export const DIFFICULTIES: Readonly<Record<DifficultyId, DifficultyDef>> = {
  normal: {
    id: 'normal',
    label: 'Normal',
    enemyHp: 1,
    enemyDamage: 1,
    enemyPoise: 1,
    rewards: 1,
    attackTokens: 2,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    enemyHp: 1.8,
    enemyDamage: 1.5,
    enemyPoise: 1.3,
    rewards: 1.6,
    attackTokens: 3,
  },
  nightmare: {
    id: 'nightmare',
    label: 'Nightmare',
    enemyHp: 3,
    enemyDamage: 2.2,
    enemyPoise: 1.6,
    rewards: 2.5,
    attackTokens: 3,
  },
};
