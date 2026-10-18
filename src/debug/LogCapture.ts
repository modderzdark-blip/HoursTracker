export type LogLevel = 'error' | 'warn' | 'info';

export interface LogEntry {
  readonly t: number;
  readonly level: LogLevel;
  readonly message: string;
}

/** Fixed-capacity ring buffer: the newest entries win. */
export class LogRing {
  private readonly items: (LogEntry | undefined)[];
  private next = 0;
  private size = 0;
  errorCount = 0;
  warnCount = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<LogEntry | undefined>(capacity);
  }

  push(entry: LogEntry): void {
    this.items[this.next] = entry;
    this.next = (this.next + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity);
    if (entry.level === 'error') this.errorCount++;
    else if (entry.level === 'warn') this.warnCount++;
  }

  /** Oldest → newest. */
  entries(): LogEntry[] {
    const out: LogEntry[] = [];
    const start = (this.next - this.size + this.capacity) % this.capacity;
    for (let i = 0; i < this.size; i++) {
      const e = this.items[(start + i) % this.capacity];
      if (e !== undefined) out.push(e);
    }
    return out;
  }

  get length(): number {
    return this.size;
  }
}

export function stringifyArg(arg: unknown): string {
  if (arg instanceof Error)
    return `${arg.name}: ${arg.message}${arg.stack ? `\n${arg.stack}` : ''}`;
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean' || arg === null || arg === undefined) {
    return String(arg);
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return Object.prototype.toString.call(arg);
  }
}

let installed: LogRing | null = null;

/**
 * Captures console.error/warn/info, uncaught errors and unhandled promise rejections into a ring
 * buffer for the in-game "Copy debug log" button. Original console output is preserved.
 */
export function installLogCapture(capacity: number): LogRing {
  if (installed !== null) return installed;
  const ring = new LogRing(capacity);
  installed = ring;
  const t0 = performance.now();
  const record = (level: LogLevel, args: readonly unknown[]): void => {
    const message = args.map(stringifyArg).join(' ').slice(0, 4000);
    ring.push({ t: (performance.now() - t0) / 1000, level, message });
  };

  for (const level of ['error', 'warn', 'info'] as const) {
    // eslint-disable-next-line no-console -- wrapping the console is this module's purpose
    const original = console[level].bind(console);
    // eslint-disable-next-line no-console -- see above
    console[level] = (...args: unknown[]) => {
      record(level, args);
      original(...args);
    };
  }

  window.addEventListener('error', (e) => {
    const where = e.filename ? ` @ ${e.filename}:${e.lineno}:${e.colno}` : '';
    record('error', [`Uncaught ${stringifyArg(e.error ?? e.message)}${where}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    record('error', ['Unhandled rejection', e.reason]);
  });
  return ring;
}

export function getLogRing(): LogRing | null {
  return installed;
}
