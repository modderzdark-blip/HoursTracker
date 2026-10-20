import type { Player } from '../actors/Player';
import { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { ActionDef } from '../data/combatTypes';
import type { SkillDef } from '../data/heroes';
import { INPUT_SOURCE, type InputAction } from '../input/actions';
import { InputState } from '../input/InputState';

const SKILLS = ['skill1', 'skill2', 'skill3'] as const;
const SRC = INPUT_SOURCE.keyboard;

/** Reach of a move from its data (melee shape + movement, projectile range, zone placement). */
export function actionReach(
  a: ActionDef & Partial<Pick<SkillDef, 'special' | 'targetRange'>>,
): number {
  if (a.special === 'shadowStep' || a.special === 'leap') return a.targetRange ?? 8;
  const hit = a.hits[0];
  if (hit === undefined) return 3;
  const emit = hit.emit;
  if (emit?.kind === 'projectile') return emit.projectile.rangeM * 0.7;
  if (emit?.kind === 'zone') {
    if (emit.place === 'target') return 10;
    if (emit.place === 'forward') return emit.forward + emit.zone.radius;
    return emit.zone.radius;
  }
  const sh = hit.spec.shape;
  const base =
    sh.kind === 'arc'
      ? sh.range
      : sh.kind === 'circle'
        ? sh.forward + sh.radius
        : sh.forward + sh.length;
  return base + Math.max(0, a.move?.distance ?? 0);
}

/**
 * Arena "duelist" behaviour driving a hero through its own InputState (the same Player code the
 * human uses): keeps a preferred range (close for melee, far for archers), circles, presses combo
 * inputs inside its reach, uses skills when they can land, fires the ultimate up close and
 * dodges the target's wind-ups with a reaction delay. `skill` (0..1) scales reaction speed,
 * dodge chance and aggression.
 */
export class DuelistBrain {
  /** Input the duelist hero reads (its own bus, so its presses never reach the game's UI). */
  readonly input: InputState;
  private nowMs = 0;
  private attackCdMs = 0;
  private skillCdMs = 0;
  private dodgeAtMs = -1;
  private strafe = 1;
  private strafeMs = 0;
  private holdAction: InputAction | null = null;
  private holdUntilMs = 0;
  private pendingRelease: InputAction | null = null;
  private readonly preferred: number;
  private readonly comboReach: number;
  private readonly skillReach: number[];
  private readonly reactMs: number;
  private readonly dodgeChance: number;
  private readonly aggression: number;
  private lastTargetAction: string | null = null;

  constructor(
    private readonly self: Player,
    private readonly target: Player,
    private readonly rng: () => number,
    skill: number,
  ) {
    this.input = new InputState(150, () => this.nowMs, new EventBus<GameEvents>());
    const def = self.def;
    const ranged = def.rangedCombo !== undefined;
    const melee = def.combo[0];
    this.comboReach = melee !== undefined ? actionReach(melee) : 2;
    this.preferred = ranged ? 7 : Math.max(1, this.comboReach - 0.9);
    this.skillReach = def.skills.map((s) => actionReach(s));
    const k = Math.min(1, Math.max(0, skill));
    this.reactMs = 480 - k * 300;
    this.dodgeChance = 0.25 + k * 0.5;
    this.aggression = 0.55 + k * 0.4;
  }

  private tap(a: InputAction): void {
    this.input.press(a, SRC);
    this.pendingRelease = a;
  }

  /** Called once per fixed step, before the duelist hero thinks. */
  think(dtSec: number): void {
    const dtMs = dtSec * 1000;
    this.nowMs += dtMs;
    if (this.pendingRelease !== null) {
      this.input.release(this.pendingRelease, SRC);
      this.pendingRelease = null;
    }
    const me = this.self;
    const foe = this.target;
    if (!me.alive || !foe.alive) {
      this.input.setMove(SRC, 0, 0);
      return;
    }
    this.attackCdMs -= dtMs;
    this.skillCdMs -= dtMs;
    this.strafeMs -= dtMs;
    if (this.strafeMs <= 0) {
      this.strafe = this.rng() < 0.5 ? -1 : 1;
      this.strafeMs = 900 + this.rng() * 1600;
    }

    // Charged skill: keep holding, then release.
    if (this.holdAction !== null) {
      this.input.setMove(SRC, 0, 0);
      if (this.nowMs >= this.holdUntilMs) {
        this.input.release(this.holdAction, SRC);
        this.holdAction = null;
      }
      return;
    }

    const dx = foe.currFeet.x - me.currFeet.x;
    const dz = foe.currFeet.z - me.currFeet.z;
    const dist = Math.hypot(dx, dz) || 1;
    const nx = dx / dist;
    const nz = dz / dist;
    const gap = me.gapTo(foe);

    // React to the target starting an attack (new action id) close enough to matter.
    const act = foe.actionId;
    if (act !== null && act !== this.lastTargetAction && foe.runner.phase === 'startup') {
      const threat = gap < 4.5 || foe.def.rangedCombo !== undefined;
      if (threat && this.rng() < this.dodgeChance) this.dodgeAtMs = this.nowMs + this.reactMs;
    }
    this.lastTargetAction = act;
    if (this.dodgeAtMs >= 0 && this.nowMs >= this.dodgeAtMs) {
      this.dodgeAtMs = -1;
      // Sideways / backward roll relative to the threat.
      const side = this.strafe;
      this.input.setMove(SRC, -nz * side - nx * 0.4, nx * side - nz * 0.4);
      this.tap('dodge');
      return;
    }

    const busy = me.state !== 'locomotion';
    // Ultimate when it can land.
    if (!busy && me.ultimate.isReady && gap < 5.5 && this.rng() < 0.05) {
      this.input.setMove(SRC, nx * 0.3, nz * 0.3);
      this.tap('ultimate');
      return;
    }
    // Skills: one at a time, spaced out.
    if (!busy && this.skillCdMs <= 0) {
      for (let i = 0; i < SKILLS.length; i++) {
        const reach = this.skillReach[i] ?? 3;
        const sk = me.def.skills[i];
        const action = SKILLS[i];
        if (sk === undefined || action === undefined || !me.cooldowns.isReady(i)) continue;
        // Movement skills going backward are escapes: use them when pressed.
        const escape = (sk.move?.distance ?? 0) < 0;
        const usable = escape ? gap < 2 : gap <= reach;
        if (!usable || this.rng() > 0.04 * this.aggression * 2) continue;
        this.skillCdMs = 1200 + this.rng() * 1500;
        this.input.setMove(SRC, escape ? -nx * 0.3 : nx * 0.3, escape ? -nz * 0.3 : nz * 0.3);
        if (sk.special === 'charge') {
          this.input.press(action, SRC);
          this.holdAction = action;
          this.holdUntilMs = this.nowMs + 400 + this.rng() * 700;
        } else {
          this.tap(action);
        }
        return;
      }
    }

    // Movement: hold the preferred range, circle while there.
    const want = this.preferred;
    let mx: number;
    let mz: number;
    if (gap > want + 0.6) {
      mx = nx;
      mz = nz;
    } else if (gap < want - 1.5) {
      mx = -nx;
      mz = -nz;
    } else {
      mx = -nz * this.strafe * 0.5;
      mz = nx * this.strafe * 0.5;
    }
    this.input.setMove(SRC, mx, mz);

    // Attacks: combo presses inside reach (the hero's input buffer chains them).
    const reach =
      me.def.rangedCombo !== undefined && gap > (me.def.meleeRange ?? 2.5) ? 12 : this.comboReach;
    if (gap <= reach && this.attackCdMs <= 0) {
      // Point the stick at the target so auto-aim faces it.
      this.input.setMove(SRC, nx * 0.3, nz * 0.3);
      this.tap('attack');
      // Aggressive duelists chain more; others pause between strings.
      this.attackCdMs = this.rng() < this.aggression ? 180 : 700 + this.rng() * 600;
    }
  }

  reset(): void {
    this.input.releaseAll();
    this.holdAction = null;
    this.pendingRelease = null;
    this.dodgeAtMs = -1;
  }
}
