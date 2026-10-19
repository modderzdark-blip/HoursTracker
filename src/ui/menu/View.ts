import { el, onTap } from '../dom';

/**
 * A rebuildable block of DOM with its listeners. Menu screens render by clearing and rebuilding
 * (menus are not performance critical); `reset()` removes every listener added since the last
 * reset so nothing leaks between rebuilds.
 */
export class View {
  private disposers: (() => void)[] = [];

  constructor(readonly root: HTMLElement) {}

  reset(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.root.replaceChildren();
  }

  /** A tappable element (role=button). `disabled` keeps it visible but inert. */
  button(
    label: string,
    cls: string,
    fn: () => void,
    opts: { testid?: string; disabled?: boolean; title?: string } = {},
  ): HTMLElement {
    const b = el('div', `${cls}${opts.disabled === true ? ' is-disabled' : ''}`, label);
    b.setAttribute('role', 'button');
    if (opts.testid !== undefined) b.dataset['testid'] = opts.testid;
    if (opts.title !== undefined) b.title = opts.title;
    if (opts.disabled !== true) this.disposers.push(onTap(b, fn));
    return b;
  }

  /** Makes an existing element tappable. */
  tap(node: HTMLElement, fn: () => void): HTMLElement {
    node.setAttribute('role', 'button');
    this.disposers.push(onTap(node, fn));
    return node;
  }

  onDispose(fn: () => void): void {
    this.disposers.push(fn);
  }
}

export function fmtInt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
