type Handler<T> = (payload: T) => void;
type AnyHandler = (payload: unknown) => void;

/**
 * Typed synchronous event bus.
 * `emit` allocates nothing: handlers removed during an emit are nulled and compacted afterwards,
 * so iteration never needs a defensive copy.
 */
export class EventBus<E extends object> {
  private readonly handlers = new Map<keyof E, (AnyHandler | null)[]>();
  private emitDepth = 0;
  private readonly dirtyTypes = new Set<keyof E>();

  on<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    let list = this.handlers.get(type);
    if (list === undefined) {
      list = [];
      this.handlers.set(type, list);
    }
    list.push(handler as AnyHandler);
    return () => this.off(type, handler);
  }

  once<K extends keyof E>(type: K, handler: Handler<E[K]>): () => void {
    const wrapper: Handler<E[K]> = (payload) => {
      this.off(type, wrapper);
      handler(payload);
    };
    return this.on(type, wrapper);
  }

  off<K extends keyof E>(type: K, handler: Handler<E[K]>): void {
    const list = this.handlers.get(type);
    if (list === undefined) return;
    const index = list.indexOf(handler as AnyHandler);
    if (index < 0) return;
    if (this.emitDepth > 0) {
      list[index] = null;
      this.dirtyTypes.add(type);
    } else {
      list.splice(index, 1);
    }
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const list = this.handlers.get(type);
    if (list === undefined) return;
    this.emitDepth++;
    try {
      // Length captured up front: handlers added during this emit run from the next emit on.
      const count = list.length;
      for (let i = 0; i < count; i++) {
        const handler = list[i];
        if (handler !== null && handler !== undefined) handler(payload);
      }
    } finally {
      this.emitDepth--;
      if (this.emitDepth === 0 && this.dirtyTypes.size > 0) this.compact();
    }
  }

  listenerCount(type: keyof E): number {
    const list = this.handlers.get(type);
    if (list === undefined) return 0;
    let n = 0;
    for (const h of list) if (h !== null) n++;
    return n;
  }

  clear(): void {
    this.handlers.clear();
    this.dirtyTypes.clear();
  }

  private compact(): void {
    for (const type of this.dirtyTypes) {
      const list = this.handlers.get(type);
      if (list === undefined) continue;
      let write = 0;
      for (let read = 0; read < list.length; read++) {
        const h = list[read];
        if (h !== null && h !== undefined) list[write++] = h;
      }
      list.length = write;
    }
    this.dirtyTypes.clear();
  }
}
