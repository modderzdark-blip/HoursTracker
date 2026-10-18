import { Vector3, type Scene } from 'three';
import { Player } from '../actors/Player';
import type { FollowCamera } from '../camera/FollowCamera';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { Cooldowns } from '../combat/Cooldowns';
import { UltimateMeter } from '../combat/UltimateMeter';
import type { ArenaDef } from '../data/arenas';
import type { HeroDef } from '../data/heroes';
import type { QualityLevel, QualityPreset } from '../data/quality';
import type { InputState } from '../input/InputState';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { Atmosphere } from '../render/Atmosphere';
import type { QualityTarget } from '../render/QualityManager';
import type { RenderContext } from '../render/RenderContext';
import { BlobShadow } from '../vfx/BlobShadow';
import { EmberField } from '../vfx/EmberField';
import { ArenaBuilder } from './ArenaBuilder';

const SKILL_ACTIONS = ['skill1', 'skill2', 'skill3'] as const;
const MAX_PARTICLES = 320;

export interface TestArenaDeps {
  readonly ctx: RenderContext;
  readonly physics: PhysicsWorld;
  readonly camera: FollowCamera;
  readonly input: InputState;
  readonly bus: EventBus<GameEvents>;
  readonly arena: ArenaDef;
  readonly hero: HeroDef;
  readonly preset: QualityPreset;
}

/**
 * M1 test arena: a hero on a kinematic controller, a data-built arena, atmosphere and the follow
 * camera. Combat lands in M2; until then ATTACK plays a placeholder swing, skills start their
 * cooldown rings, and a full ultimate meter can be spent — so every HUD control is exercisable.
 */
export class TestArenaMode implements QualityTarget {
  readonly player: Player;
  readonly cooldowns: Cooldowns;
  readonly ultimate = new UltimateMeter();
  private readonly builder: ArenaBuilder;
  private readonly atmosphere: Atmosphere;
  private readonly embers: EmberField;
  private readonly blob: BlobShadow;
  private readonly move = { x: 0, y: 0 };
  private readonly worldMove = new Vector3();
  private swingCooldownMs = 0;
  attacksPerformed = 0;
  dodgesPressed = 0;

  constructor(private readonly d: TestArenaDeps) {
    const scene: Scene = d.ctx.scene;
    this.builder = new ArenaBuilder(d.arena, d.physics, d.preset);
    this.builder.addTo(scene);
    this.atmosphere = new Atmosphere(d.ctx, d.arena);
    this.player = new Player(d.hero, d.physics, scene, d.arena.spawn);
    this.blob = new BlobShadow(d.hero.body.capsuleRadius * 1.9);
    scene.add(this.blob.mesh);
    this.embers = new EmberField(MAX_PARTICLES, d.arena.palette.ember);
    scene.add(this.embers.points);
    this.cooldowns = new Cooldowns(d.hero.skills.map((s) => s.cooldownMs));
    d.camera.snap(this.player.currFeet);
  }

  get colliderCount(): number {
    return this.builder.colliderCount;
  }

  get particleCount(): number {
    return this.embers.activeCount;
  }

  applyQuality(preset: QualityPreset, _level: QualityLevel): void {
    this.atmosphere.applyQuality(preset);
    this.embers.setCount(preset.particleCount);
    this.embers.setPixelRatio(this.d.ctx.currentPixelRatio);
    this.blob.setStrength(preset.shadows ? 0.4 : 0.6);
  }

  fixedUpdate(dtSec: number): void {
    const dtMs = dtSec * 1000;
    const input = this.d.input;
    const cam = this.d.camera;

    // Camera-relative movement: stick up = away from the camera.
    input.readMove(this.move);
    this.worldMove
      .copy(cam.forwardXZ)
      .multiplyScalar(this.move.y)
      .addScaledVector(cam.rightXZ, this.move.x);
    this.player.fixedUpdate(dtSec, this.worldMove.x, this.worldMove.z);
    this.d.physics.step(dtSec);

    // Placeholder attack: consumes the buffered press when the previous swing has finished, so a
    // tap slightly before the swing ends is queued (exercises the input buffer before M2).
    this.swingCooldownMs = Math.max(0, this.swingCooldownMs - dtMs);
    if (this.swingCooldownMs <= 0 && input.consume('attack')) {
      this.player.visual.playSwing(this.d.hero.placeholderSwingMs);
      this.swingCooldownMs = this.d.hero.placeholderSwingMs;
      this.attacksPerformed++;
    }
    if (input.consume('dodge')) this.dodgesPressed++;

    this.cooldowns.tick(dtMs);
    for (let i = 0; i < SKILL_ACTIONS.length; i++) {
      const action = SKILL_ACTIONS[i];
      if (action === undefined) continue;
      if (input.consume(action) && this.cooldowns.tryUse(i)) {
        this.d.bus.emit('skill:used', {
          slot: i,
          cooldownMs: this.d.hero.skills[i]?.cooldownMs ?? 0,
        });
      }
    }
    if (input.consume('ultimate') && this.ultimate.tryConsume()) {
      this.d.bus.emit('camera:shake', { trauma: 0.7 });
      this.d.bus.emit('time:slowMotion', { scale: 0.35, ms: 500 });
      this.d.bus.emit('ultimate:charge', { value: 0 });
    }
  }

  render(alpha: number, dtSec: number): void {
    this.player.render(alpha, dtSec);
    const feet = this.player.renderFeet;
    this.blob.update(feet);
    this.d.camera.update(feet, this.player.renderVelocity, dtSec, this.d.hero.movement.moveSpeed);
    this.atmosphere.update(feet, dtSec);
    this.embers.update(dtSec, feet);
  }

  respawn(): void {
    this.player.respawn();
    this.d.camera.snap(this.player.currFeet);
    this.d.bus.emit('player:respawned', { reason: 'manual' });
  }

  dispose(): void {
    this.player.dispose();
    this.blob.dispose();
    this.embers.dispose();
    this.atmosphere.dispose();
    this.builder.dispose();
  }
}
