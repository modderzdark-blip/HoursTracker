import { INPUT_CONFIG } from '../data/config';
import { el, listen } from '../ui/dom';
import { INPUT_SOURCE, isInputAction, type InputAction } from './actions';
import type { InputState } from './InputState';
import { followOrigin, shapeStick, type StickVector } from './joystickMath';

interface ButtonBinding {
  readonly el: HTMLElement;
  readonly action: InputAction;
  pointerId: number;
  rect: DOMRect | null;
}

interface ButtonSpec {
  readonly action: InputAction;
  readonly cls: string;
  readonly label: string;
}

const BUTTONS: readonly ButtonSpec[] = [
  { action: 'attack', cls: 'tc-btn tc-attack', label: 'ATTACK' },
  { action: 'dodge', cls: 'tc-btn tc-dodge', label: 'DODGE' },
  { action: 'skill1', cls: 'tc-btn tc-skill tc-skill1', label: 'I' },
  { action: 'skill2', cls: 'tc-btn tc-skill tc-skill2', label: 'II' },
  { action: 'skill3', cls: 'tc-btn tc-skill tc-skill3', label: 'III' },
  { action: 'ultimate', cls: 'tc-btn tc-ultimate', label: 'ULT' },
];

/** Player joystick settings (Settings → Controls). */
export interface JoystickOptions {
  /** Multiplier on INPUT_CONFIG.joystick.radiusPx (thumb travel and drawn size). */
  readonly scale: number;
  /** Normalised dead zone (0..1). */
  readonly deadZone: number;
  /** 'floating' spawns under the thumb and follows it; 'fixed' stays at its resting spot. */
  readonly mode: 'floating' | 'fixed';
}

export const DEFAULT_JOYSTICK: JoystickOptions = {
  scale: 1,
  deadZone: INPUT_CONFIG.joystick.deadZone,
  mode: 'floating',
};

/** A finger may drift this far (px) outside a button before it counts as sliding off. */
const BUTTON_SLOP_PX = 14;

/**
 * Floating joystick + action buttons, driven by Pointer Events with per-pointer tracking so any
 * number of fingers work at once. Every pointer is released on pointerup/cancel, on sliding off
 * a button, on `touchend` with no touches left, and when the page loses focus — so no input can
 * stay stuck.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly buttons: ButtonBinding[] = [];
  private readonly skillCooldown: HTMLElement[] = [];
  private readonly skillTimer: HTMLElement[] = [];
  private readonly skillCdCache = [-1, -1, -1];
  private readonly ultimate: HTMLElement;
  private readonly ultimateFill: HTMLElement;
  /** Ring that bursts out of the ULT button the moment it is ready. */
  private readonly ultimateRing: HTMLElement;
  private ultimateCache = -1;
  private readonly disposers: (() => void)[] = [];

  private joyPointer = -1;
  private originX = 0;
  private originY = 0;
  private readonly origin = new Float64Array(2);
  private readonly stick: StickVector = { x: 0, y: 0, magnitude: 0 };
  private enabled = true;
  private joy: JoystickOptions = DEFAULT_JOYSTICK;
  /** Resting centre of the stick (where a fixed joystick lives). */
  private restX = 0;
  private restY = 0;

  constructor(
    container: HTMLElement,
    private readonly input: InputState,
  ) {
    this.root = el('div', 'touch-layer');
    this.root.dataset['testid'] = 'touch-layer';
    this.zone = el('div', 'tc-joy-zone');
    this.zone.style.width = `${INPUT_CONFIG.joystick.zoneWidthFraction * 100}%`;
    this.base = el('div', 'tc-joy-base is-idle');
    this.knob = el('div', 'tc-joy-knob');
    this.base.style.setProperty('--joy-radius', `${this.radius}px`);
    this.base.append(this.knob);
    this.root.append(this.zone, this.base);

    const cluster = el('div', 'tc-cluster');
    for (const spec of BUTTONS) {
      const b = el('div', spec.cls);
      b.dataset['action'] = spec.action;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', spec.action);
      const label = el('span', 'tc-label', spec.label);
      b.append(label);
      if (spec.action.startsWith('skill')) {
        const cd = el('div', 'tc-cd');
        const timer = el('span', 'tc-cd-timer');
        b.append(cd, timer);
        this.skillCooldown.push(cd);
        this.skillTimer.push(timer);
      }
      cluster.append(b);
      this.buttons.push({ el: b, action: spec.action, pointerId: -1, rect: null });
    }
    const ult = this.buttons.find((b) => b.action === 'ultimate');
    if (ult === undefined) throw new Error('ultimate button missing');
    this.ultimate = ult.el;
    this.ultimateFill = el('div', 'tc-ult-fill');
    this.ultimate.prepend(this.ultimateFill);
    this.ultimateRing = el('div', 'tc-ult-ring');
    cluster.append(this.ultimateRing);
    this.root.append(cluster);
    container.append(this.root);

    this.resetJoystickVisual();

    this.disposers.push(
      listen(this.zone, 'pointerdown', this.onZoneDown),
      listen(cluster, 'pointerdown', this.onButtonDown),
      listen(window, 'pointermove', this.onPointerMove, { passive: true }),
      listen(window, 'pointerup', this.onPointerEnd),
      listen(window, 'pointercancel', this.onPointerEnd),
      listen(window, 'touchend', this.onTouchEnd),
      listen(window, 'touchcancel', this.onTouchEnd),
      listen(window, 'blur', this.releaseAll),
      listen(window, 'resize', this.onResize),
      listen(document, 'visibilitychange', () => {
        if (document.hidden) this.releaseAll();
      }),
    );
  }

  /** Button size / opacity and the mirrored (left-handed) layout from settings. */
  applyLayout(scale: number, opacity: number, leftHanded: boolean): void {
    this.root.style.setProperty('--btn-scale', String(scale));
    this.root.style.setProperty('--btn-opacity', String(opacity));
    this.root.classList.toggle('is-left', leftHanded);
    this.releaseAll();
    this.resetJoystickVisual();
  }

  /** Joystick size, dead zone and fixed / floating placement from settings. */
  applyJoystick(o: JoystickOptions): void {
    this.joy = o;
    this.base.style.setProperty('--joy-radius', `${this.radius.toFixed(1)}px`);
    this.root.classList.toggle('is-joy-fixed', o.mode === 'fixed');
    this.releaseAll();
    this.resetJoystickVisual();
  }

  get joystickOptions(): JoystickOptions {
    return this.joy;
  }

  /** Current thumb-travel radius in CSS px. */
  private get radius(): number {
    return INPUT_CONFIG.joystick.radiusPx * this.joy.scale;
  }

  /** Disabling (pause menu open) releases every touch and ignores new ones. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.root.classList.toggle('is-disabled', !enabled);
    if (!enabled) this.releaseAll();
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
    if (!visible) this.releaseAll();
  }

  /** fraction: 1 = just used, 0 = ready. Writes to the DOM only when the value visibly changes. */
  setSkillCooldown(slot: number, fraction: number, remainingSec: number): void {
    const q = Math.round(fraction * 200) / 200;
    if (this.skillCdCache[slot] === q) return;
    this.skillCdCache[slot] = q;
    const cd = this.skillCooldown[slot];
    const timer = this.skillTimer[slot];
    if (cd === undefined || timer === undefined) return;
    cd.style.setProperty('--cd', q.toFixed(3));
    const button = cd.parentElement;
    button?.classList.toggle('is-cooling', q > 0);
    timer.textContent = q > 0 ? Math.ceil(remainingSec).toString() : '';
  }

  setUltimateCharge(value: number): void {
    const q = Math.round(value * 100) / 100;
    if (q === this.ultimateCache) return;
    this.ultimateCache = q;
    this.ultimateFill.style.setProperty('--fill', q.toFixed(2));
    const wasReady = this.ultimate.classList.contains('is-ready');
    this.ultimate.classList.toggle('is-ready', q >= 1);
    if (q >= 1 && !wasReady) {
      // A one-off ring burst the moment it fills (CSS animation, restarted).
      this.ultimateRing.classList.remove('is-on');
      void this.ultimateRing.offsetWidth;
      this.ultimateRing.classList.add('is-on');
    } else if (q < 1) {
      this.ultimateRing.classList.remove('is-on');
    }
  }

  get joystickActive(): boolean {
    return this.joyPointer !== -1;
  }

  get activeButtonCount(): number {
    let n = 0;
    for (const b of this.buttons) if (b.pointerId !== -1) n++;
    return n;
  }

  dispose(): void {
    this.releaseAll();
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    this.root.remove();
  }

  readonly releaseAll = (): void => {
    this.endJoystick();
    for (const b of this.buttons) this.releaseButton(b);
    this.input.releaseSource(INPUT_SOURCE.touch);
  };

  private readonly onZoneDown = (e: PointerEvent): void => {
    if (!this.enabled || this.joyPointer !== -1) return;
    e.preventDefault();
    this.joyPointer = e.pointerId;
    this.base.classList.remove('is-idle');
    if (this.joy.mode === 'fixed') {
      // Fixed stick: the base stays put and the touch point already counts as a deflection.
      this.originX = this.restX;
      this.originY = this.restY;
      this.placeBase(this.originX, this.originY);
      this.updateJoystick(e.clientX, e.clientY);
      return;
    }
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.placeBase(this.originX, this.originY);
    this.placeKnob(0, 0);
  };

  private readonly onButtonDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('.tc-btn');
    if (target === null || target === undefined) return;
    const binding = this.buttons.find((b) => b.el === target);
    if (binding === undefined || binding.pointerId !== -1) return;
    const action = target.dataset['action'];
    if (action === undefined || !isInputAction(action)) return;
    e.preventDefault();
    binding.pointerId = e.pointerId;
    binding.rect = target.getBoundingClientRect();
    target.classList.add('is-pressed');
    this.input.press(binding.action, INPUT_SOURCE.touch);
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId === this.joyPointer) {
      this.updateJoystick(e.clientX, e.clientY);
      return;
    }
    for (const b of this.buttons) {
      if (b.pointerId !== e.pointerId || b.rect === null) continue;
      const r = b.rect;
      if (
        e.clientX < r.left - BUTTON_SLOP_PX ||
        e.clientX > r.right + BUTTON_SLOP_PX ||
        e.clientY < r.top - BUTTON_SLOP_PX ||
        e.clientY > r.bottom + BUTTON_SLOP_PX
      ) {
        this.releaseButton(b);
      }
    }
  };

  private readonly onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId === this.joyPointer) this.endJoystick();
    for (const b of this.buttons) if (b.pointerId === e.pointerId) this.releaseButton(b);
  };

  /** Safety net: if the browser reports no fingers on screen, nothing can still be held. */
  private readonly onTouchEnd = (e: TouchEvent): void => {
    if (e.touches.length === 0) this.releaseAll();
  };

  private readonly onResize = (): void => {
    this.releaseAll();
    this.resetJoystickVisual();
  };

  private updateJoystick(x: number, y: number): void {
    const cfg = INPUT_CONFIG.joystick;
    const radius = this.radius;
    if (cfg.baseFollows && this.joy.mode === 'floating') {
      followOrigin(this.originX, this.originY, x, y, radius, this.origin);
      if (this.origin[0] !== this.originX || this.origin[1] !== this.originY) {
        this.originX = this.origin[0] ?? this.originX;
        this.originY = this.origin[1] ?? this.originY;
        this.placeBase(this.originX, this.originY);
      }
    }
    const dx = x - this.originX;
    const dy = y - this.originY;
    shapeStick(dx, dy, radius, this.joy.deadZone, cfg.responseExponent, this.stick);
    // Screen Y grows downward; game "forward" is up the screen.
    this.input.setMove(INPUT_SOURCE.touch, this.stick.x, -this.stick.y);
    const len = Math.hypot(dx, dy);
    const k = len > radius ? radius / len : 1;
    this.placeKnob(dx * k, dy * k);
  }

  private endJoystick(): void {
    if (this.joyPointer === -1) return;
    this.joyPointer = -1;
    this.input.setMove(INPUT_SOURCE.touch, 0, 0);
    this.resetJoystickVisual();
  }

  private releaseButton(b: ButtonBinding): void {
    if (b.pointerId === -1) return;
    b.pointerId = -1;
    b.rect = null;
    b.el.classList.remove('is-pressed');
    this.input.release(b.action, INPUT_SOURCE.touch);
  }

  private resetJoystickVisual(): void {
    const r = this.radius;
    // Resting spot hints where the stick lives; a floating stick jumps to wherever the thumb
    // lands, a fixed one is always used from here.
    const inset = Math.max(r * 1.6, window.innerWidth * 0.14);
    const left = this.root.classList.contains('is-left') ? window.innerWidth - inset : inset;
    const top = window.innerHeight - r * 1.9;
    this.restX = left;
    this.restY = top;
    this.base.classList.add('is-idle');
    this.placeBase(left, top);
    this.placeKnob(0, 0);
  }

  private placeBase(x: number, y: number): void {
    this.base.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }

  private placeKnob(dx: number, dy: number): void {
    this.knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
  }
}
