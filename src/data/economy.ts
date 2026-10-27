/** `stones`: Enchant Stones, rare (boss drops, tower milestones, limited shop offers). */
export type Currency = 'gold' | 'gems' | 'souls' | 'materials' | 'tickets' | 'stones';

export const CURRENCIES: readonly Currency[] = [
  'gold',
  'gems',
  'souls',
  'materials',
  'tickets',
  'stones',
];

export const ECONOMY = {
  /** One-time grant on a new save so the revive flow can be tried (gems are earned in-game only). */
  startingGems: 20,
  reviveCostGems: 10,
  maxRevivesPerRun: 1,
  /** Fraction of max HP restored on revive. */
  reviveHpFrac: 0.6,
  /** Invulnerability after reviving (ms). */
  reviveInvulnMs: 2500,
  /** Hard cap per currency (sanity guard against overflow/corruption). */
  maxBalance: 999_999_999,
} as const;
