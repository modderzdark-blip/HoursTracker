import { Color } from 'three';
import type { Actor } from '../actors/Actor';
import type { EventBus } from '../core/EventBus';
import type { GameEvents, HitEvent } from '../core/events';
import type { ActionDef, FxCue } from '../data/combatTypes';
import type { RenderContext } from '../render/RenderContext';
import type { Fx } from '../vfx/Fx';
import type { Sparks } from '../vfx/Sparks';

interface Pending {
  t: number;
  readonly actor: Actor;
  readonly cue: FxCue;
  /** Repeat index (spin offset). */
  readonly n: number;
  readonly color: number;
  readonly target: { readonly x: number; readonly z: number } | null;
}

const MAX_PENDING = 160;

/**
 * Turns combat into visuals: plays the cues an action carries (or an automatic slash arc for
 * melee swings), impact flashes, death bursts and screen flashes. Cues are placed in the
 * actor's frame at the moment they fire, so they follow lunges and dashes.
 */
export class FxDirector {
  private readonly pending: Pending[] = [];
  private flash = 0;
  private readonly flashColor = new Color();
  private aberr = 0;
  /** Off with "Reduce flashes". */
  screenEffects = true;

  constructor(
    private readonly fx: Fx,
    private readonly sparks: Sparks,
    private readonly ctx: RenderContext,
    private readonly bus: EventBus<GameEvents> | null = null,
    private readonly rand: () => number = Math.random,
  ) {}

  /** An action began: schedule its cues (`speed` = action speed multiplier). */
  playAction(
    actor: Actor,
    def: ActionDef,
    speed: number,
    color: number,
    target: { readonly x: number; readonly z: number } | null = null,
  ): void {
    const cues = def.fx ?? defaultCues(def);
    const k = 1 / Math.max(0.2, speed);
    for (const cue of cues) {
      const at = cue.at ?? 'start';
      const t0 = at === 'start' ? 0 : at === 'active' ? (def.startupMs / 1000) * k : at * k;
      const reps = Math.max(1, cue.repeat ?? 1);
      for (let n = 0; n < reps; n++) {
        if (this.pending.length >= MAX_PENDING) this.pending.shift();
        const t = t0 + n * (cue.every ?? 0.1) * k;
        this.pending.push({ t, actor, cue, n, color: cue.color ?? color, target });
      }
    }
  }

  /** Drop pending cues of an actor (interrupted, killed). */
  cancel(actor: Actor): void {
    for (let i = this.pending.length - 1; i >= 0; i--)
      if (this.pending[i]?.actor === actor) this.pending.splice(i, 1);
  }

  hit(e: HitEvent): void {
    if (e.dot) return;
    const heavy = e.shake > 0.35 || e.crit || e.poiseBroken;
    const color = e.targetTeam === 'player' ? 0xff4a3a : e.crit ? 0xffd27a : 0xfff0d8;
    this.fx.spawn('flash', {
      x: e.x,
      y: e.y - 0.4,
      z: e.z,
      scale: heavy ? 1.1 : 0.65,
      color,
      life: heavy ? 0.22 : 0.14,
    });
    if (heavy && e.targetTeam !== 'player') {
      this.fx.spawn('ring', { x: e.x, y: 0, z: e.z, scale: 1.6, color: 0xffb070, life: 0.35 });
      if (e.crit) this.screen(0.12, 0xffd27a, 0.004);
    }
  }

  /** Death burst: an energy nova, embers, soot. `big` for bosses and elites. */
  death(x: number, z: number, color: number, big: boolean): void {
    const s = big ? 3.2 : 1.3;
    this.fx.spawn('nova', { x, y: 0.9, z, scale: s, color, life: big ? 0.9 : 0.5 });
    this.fx.spawn('flash', { x, y: 1, z, scale: s * 1.2, color, life: 0.3 });
    this.fx.spawn('ring', { x, y: 0, z, scale: s * 1.6, color, life: 0.6 });
    this.fx.smokeBurst(x, 0.6, z, big ? 18 : 7, big ? 2.4 : 1, 0.12);
    this.sparks.burst(x, 1, z, big ? 70 : 24, color, big ? 9 : 5, 0, 0, 0.6, 1.4, 0.3);
    if (big) this.screen(0.35, color, 0.012);
  }

  /** Brief screen flash with optional colour fringing (Medium/High only). */
  screen(amount: number, color: number, aberration = 0): void {
    if (!this.screenEffects) return;
    if (amount >= this.flash) {
      this.flash = Math.min(0.6, amount);
      this.flashColor.setHex(color);
    }
    this.aberr = Math.max(this.aberr, aberration);
  }

  update(dtSec: number): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i];
      if (p === undefined) continue;
      p.t -= dtSec;
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      if (p.actor.alive) this.fire(p);
    }
    this.flash = Math.max(0, this.flash - dtSec * 3.5);
    this.aberr = Math.max(0, this.aberr - dtSec * 0.08);
    const f = this.flash * this.flash;
    this.ctx.setScreenFx(
      this.flashColor.r * f,
      this.flashColor.g * f,
      this.flashColor.b * f,
      this.aberr,
    );
  }

  clear(): void {
    this.pending.length = 0;
    this.flash = 0;
    this.aberr = 0;
    this.ctx.setScreenFx(0, 0, 0, 0);
  }

  private fire(p: Pending): void {
    const a = p.actor;
    const c = p.cue;
    const yaw = a.yaw + (c.yawOffset ?? 0) + (c.spin ?? 0) * p.n;
    const fx = Math.sin(a.yaw);
    const fz = Math.cos(a.yaw);
    // Right of the facing direction (yaw 0 faces +Z, right is −X).
    const rx = -fz;
    const rz = fx;
    const [of, ou, or] = c.offset ?? [0, 0, 0];
    const onTarget = c.atTarget === true && p.target !== null;
    const base = onTarget && p.target !== null ? p.target : a.currFeet;
    let x = base.x + fx * of + rx * or;
    let z = base.z + fz * of + rz * or;
    const y = (onTarget ? 0 : a.currFeet.y) + ou;
    if (c.spread !== undefined && c.spread > 0) {
      const ang = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * c.spread;
      x += Math.cos(ang) * r;
      z += Math.sin(ang) * r;
    }
    if (c.shake !== undefined) this.bus?.emit('camera:shake', { trauma: c.shake });
    if (c.slowMoMs !== undefined) this.bus?.emit('time:slowMotion', { scale: 0.3, ms: c.slowMoMs });
    switch (c.shape) {
      case 'smoke':
        this.fx.smokeBurst(x, y, z, c.amount ?? 8, c.scale ?? 1, 0.15);
        return;
      case 'screen':
        this.screen(c.amount ?? 0.3, p.color, (c.scale ?? 0) * 0.02);
        return;
      default:
        this.fx.spawn(c.shape, {
          x,
          y,
          z,
          yaw,
          tilt: c.tilt ?? 0,
          scale: c.scale ?? 1,
          color: p.color,
          life: c.life ?? 0.4,
          mirror: c.mirror === true,
        });
    }
  }
}

/**
 * Automatic cues for actions without their own: melee arcs get a glowing slash shaped by the
 * hit area and pose (vertical for overheads and slams, mirrored for backhands), close circles a
 * shockwave, boxes a flash at the far end. Projectile / zone actions get none (they have their
 * own visuals).
 */
export function defaultCues(def: ActionDef): FxCue[] {
  const hit = def.hits[0];
  if (hit === undefined || hit.emit !== undefined) return [];
  const shape = hit.spec.shape;
  const pose = def.hitPose;
  const vertical = /OVERHEAD|SLAM|CLUB|CHOP/.test(pose);
  const mirror = /_L_|SLASH_L|BACK/.test(pose);
  switch (shape.kind) {
    case 'arc': {
      const reach = Math.min(6, Math.max(1.4, shape.range * 0.85));
      const cues: FxCue[] = [
        {
          shape: 'slash',
          at: 'active',
          offset: [vertical ? 0.2 : 0, vertical ? 0.15 : 1.05, 0],
          scale: reach,
          tilt: vertical ? Math.PI / 2 : mirror ? 0.18 : -0.18,
          mirror,
          life: 0.3,
        },
      ];
      if (vertical)
        cues.push({
          shape: 'ring',
          at: 'active',
          offset: [reach * 0.7, 0, 0],
          scale: 1.4,
          life: 0.35,
        });
      return cues;
    }
    case 'circle':
      if (shape.radius >= 1.6)
        return [
          {
            shape: 'ring',
            at: 'active',
            offset: [shape.forward, 0, 0],
            scale: shape.radius,
            life: 0.45,
          },
          {
            shape: 'flash',
            at: 'active',
            offset: [shape.forward, 0.6, 0],
            scale: shape.radius * 0.6,
            life: 0.2,
          },
        ];
      return [
        {
          shape: 'flash',
          at: 'active',
          offset: [shape.forward + 0.3, 1, 0],
          scale: 0.9,
          life: 0.18,
        },
      ];
    case 'box':
      return [
        {
          shape: 'flash',
          at: 'active',
          offset: [shape.forward + shape.length * 0.6, 1, 0],
          scale: Math.min(1.6, 0.6 + shape.width * 0.4),
          life: 0.2,
        },
      ];
  }
}
