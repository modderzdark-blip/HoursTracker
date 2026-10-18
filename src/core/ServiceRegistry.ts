/**
 * Minimal typed service locator. Systems receive their dependencies through constructors; the
 * registry exists for late-bound, cross-cutting services (debug tools, test hooks) so we never
 * need a god object that owns everything.
 */
export class ServiceRegistry<S extends object> {
  private readonly services = new Map<keyof S, S[keyof S]>();

  register<K extends keyof S>(key: K, service: S[K]): void {
    if (this.services.has(key)) throw new Error(`Service already registered: ${String(key)}`);
    this.services.set(key, service);
  }

  get<K extends keyof S>(key: K): S[K] {
    if (!this.services.has(key)) throw new Error(`Service not registered: ${String(key)}`);
    return this.services.get(key) as S[K];
  }

  tryGet<K extends keyof S>(key: K): S[K] | undefined {
    return this.services.get(key) as S[K] | undefined;
  }

  has(key: keyof S): boolean {
    return this.services.has(key);
  }

  unregister(key: keyof S): void {
    this.services.delete(key);
  }
}
