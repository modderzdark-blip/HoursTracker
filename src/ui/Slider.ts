import { el } from './dom';

export interface SliderOptions {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  /** Text shown next to the track (e.g. "85%"). */
  readonly format: (value: number) => string;
  /** Called with every value while dragging (cheap live preview). Optional. */
  readonly onInput?: (value: number) => void;
  /** Called once when the finger lifts or a key changes the value. */
  readonly onChange: (value: number) => void;
  readonly label: string;
  readonly testid?: string;
}

/** Snaps `v` to the slider's step grid and range (pure; exported for tests). */
export function snapSliderValue(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const clamped = Math.min(max, Math.max(min, v));
  if (step <= 0) return clamped;
  const snapped = min + Math.round((clamped - min) / step) * step;
  // Remove binary noise (0.1 + 0.2) so saved values stay tidy.
  return Math.min(max, Math.max(min, Number(snapped.toFixed(6))));
}

/** Value under a pointer at `x` on a track spanning [left, left + width]. */
export function sliderValueAt(
  x: number,
  left: number,
  width: number,
  min: number,
  max: number,
  step: number,
): number {
  const t = width > 0 ? (x - left) / width : 0;
  return snapSliderValue(min + Math.min(1, Math.max(0, t)) * (max - min), min, max, step);
}

/**
 * Touch-friendly horizontal slider (role="slider"). Pointer capture keeps the drag on the thumb
 * even when the finger leaves the track; `touch-action: pan-y` lets a vertical swipe still
 * scroll the settings list. Arrow keys / Home / End work for keyboard users.
 */
export class Slider {
  readonly root: HTMLElement;
  private readonly track: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly valueText: HTMLElement;
  private value: number;
  private dragId = -1;
  private readonly disposers: (() => void)[] = [];

  constructor(private readonly o: SliderOptions) {
    this.value = snapSliderValue(o.value, o.min, o.max, o.step);
    this.root = el('div', 'slider');
    this.track = el('div', 'slider-track');
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', o.label);
    this.track.setAttribute('aria-valuemin', String(o.min));
    this.track.setAttribute('aria-valuemax', String(o.max));
    this.track.tabIndex = 0;
    if (o.testid !== undefined) this.track.dataset['testid'] = o.testid;
    const rail = el('div', 'slider-rail');
    this.fill = el('div', 'slider-fill');
    this.thumb = el('div', 'slider-thumb');
    const lane = el('div', 'slider-lane');
    rail.append(this.fill);
    lane.append(this.thumb);
    this.track.append(rail, lane);
    this.valueText = el('span', 'slider-value');
    this.root.append(this.track, this.valueText);
    this.on(this.track, 'pointerdown', this.onDown);
    this.on(this.track, 'pointermove', this.onMove);
    this.on(this.track, 'pointerup', this.onUp);
    this.on(this.track, 'pointercancel', this.onCancel);
    this.on(this.track, 'keydown', this.onKey);
    this.render();
  }

  get current(): number {
    return this.value;
  }

  /** Sets the value without firing callbacks (external sync). */
  set(value: number): void {
    if (this.dragId !== -1) return;
    this.value = snapSliderValue(value, this.o.min, this.o.max, this.o.step);
    this.render();
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }

  private on<K extends keyof HTMLElementEventMap>(
    t: HTMLElement,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void {
    t.addEventListener(type, fn);
    this.disposers.push(() => t.removeEventListener(type, fn));
  }

  private render(): void {
    const t = (this.value - this.o.min) / (this.o.max - this.o.min || 1);
    const pct = `${(t * 100).toFixed(2)}%`;
    this.fill.style.width = pct;
    this.thumb.style.left = pct;
    const text = this.o.format(this.value);
    this.valueText.textContent = text;
    this.track.setAttribute('aria-valuenow', String(this.value));
    this.track.setAttribute('aria-valuetext', text);
  }

  private valueAt(clientX: number): number {
    const r = this.track.getBoundingClientRect();
    // The thumb centre travels inside the track's padding so it never leaves the box.
    const pad = parseFloat(getComputedStyle(this.track).paddingLeft) || 0;
    return sliderValueAt(
      clientX,
      r.left + pad,
      r.width - pad * 2,
      this.o.min,
      this.o.max,
      this.o.step,
    );
  }

  private update(v: number): void {
    if (v === this.value) return;
    this.value = v;
    this.render();
    this.o.onInput?.(v);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.dragId !== -1) return;
    this.dragId = e.pointerId;
    this.track.setPointerCapture(e.pointerId);
    this.track.classList.add('is-dragging');
    this.update(this.valueAt(e.clientX));
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.update(this.valueAt(e.clientX));
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.update(this.valueAt(e.clientX));
    this.endDrag(e.pointerId);
    this.o.onChange(this.value);
  };

  /** The browser took the gesture (vertical scroll): keep the value reached so far. */
  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.endDrag(e.pointerId);
    this.o.onChange(this.value);
  };

  private endDrag(id: number): void {
    this.dragId = -1;
    this.track.classList.remove('is-dragging');
    if (this.track.hasPointerCapture(id)) this.track.releasePointerCapture(id);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const { min, max, step } = this.o;
    let v: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = this.value - step;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = this.value + step;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    if (v === null) return;
    e.preventDefault();
    const next = snapSliderValue(v, min, max, step);
    if (next === this.value) return;
    this.value = next;
    this.render();
    this.o.onInput?.(next);
    this.o.onChange(next);
  };
}
