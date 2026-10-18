/**
 * Attack-token manager: only N enemies may attack the player at once; the rest circle and
 * reposition. An enemy requests a token before telegraphing and releases it when its attack ends,
 * it is interrupted, or it dies.
 */
export class AttackTokenManager {
  private readonly holders = new Set<number>();

  constructor(private maxTokens: number) {}

  get max(): number {
    return this.maxTokens;
  }

  setMax(n: number): void {
    this.maxTokens = Math.max(0, Math.floor(n));
  }

  /** True if `id` holds (or just acquired) a token. */
  request(id: number): boolean {
    if (this.holders.has(id)) return true;
    if (this.holders.size >= this.maxTokens) return false;
    this.holders.add(id);
    return true;
  }

  release(id: number): void {
    this.holders.delete(id);
  }

  holds(id: number): boolean {
    return this.holders.has(id);
  }

  get count(): number {
    return this.holders.size;
  }

  clear(): void {
    this.holders.clear();
  }
}
