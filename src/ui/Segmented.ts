import { el, onTap } from './dom';

export interface SegmentOption<T extends string | number> {
  readonly value: T;
  readonly label: string;
}

/** Row of large tappable options (bigger and more consistent on phones than a native <select>). */
export class Segmented<T extends string | number> {
  readonly root: HTMLElement;
  private readonly items = new Map<T, HTMLElement>();
  private readonly disposers: (() => void)[] = [];

  constructor(
    label: string,
    options: readonly SegmentOption<T>[],
    private value: T,
    onChange: (value: T) => void,
  ) {
    this.root = el('div', 'setting-row');
    const row = el('div', 'segmented');
    for (const opt of options) {
      const item = el('div', 'segment', opt.label);
      item.setAttribute('role', 'button');
      item.dataset['value'] = String(opt.value);
      this.disposers.push(
        onTap(item, () => {
          if (this.value === opt.value) return;
          this.set(opt.value);
          onChange(opt.value);
        }),
      );
      this.items.set(opt.value, item);
      row.append(item);
    }
    this.root.append(el('span', 'setting-label', label), row);
    this.set(value);
  }

  set(value: T): void {
    this.value = value;
    for (const [v, item] of this.items) item.classList.toggle('is-selected', v === value);
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
