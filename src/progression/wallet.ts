import { CURRENCIES, ECONOMY, type Currency } from '../data/economy';

export type Balances = Record<Currency, number>;

export function emptyBalances(): Balances {
  return { gold: 0, gems: 0, souls: 0, materials: 0, tickets: 0 };
}

function validAmount(amount: number): boolean {
  return Number.isFinite(amount) && Number.isInteger(amount) && amount > 0;
}

/**
 * All currency changes go through here (kept isolated so IAP can be added later). Rules:
 * balances are integers, never negative, never above the cap; invalid amounts are rejected; a
 * spend either fully succeeds or changes nothing.
 */
export class Wallet {
  private readonly balances: Balances;

  constructor(initial: Partial<Balances> = {}) {
    this.balances = emptyBalances();
    for (const c of CURRENCIES) {
      const v = initial[c];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        this.balances[c] = Math.min(ECONOMY.maxBalance, Math.floor(v));
      }
    }
  }

  get(c: Currency): number {
    return this.balances[c];
  }

  add(c: Currency, amount: number): boolean {
    if (!validAmount(amount)) return false;
    this.balances[c] = Math.min(ECONOMY.maxBalance, this.balances[c] + amount);
    return true;
  }

  canAfford(c: Currency, amount: number): boolean {
    return validAmount(amount) && this.balances[c] >= amount;
  }

  spend(c: Currency, amount: number): boolean {
    if (!this.canAfford(c, amount)) return false;
    this.balances[c] -= amount;
    return true;
  }

  snapshot(): Balances {
    return { ...this.balances };
  }
}
