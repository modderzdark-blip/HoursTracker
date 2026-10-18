import {
  BoxGeometry,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import type { HeroDef, HeroVisual } from '../data/heroes';
import { applyRimLight } from '../render/rimLight';

type PlaceholderVisual = Extract<HeroVisual, { kind: 'placeholder' }>;

const STRIDE_PER_METRE = 1.55;

function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Primitive stand-in for a hero model (until real glTF characters land in M3). Built from
 * capsules/spheres, with a little procedural life — breathing, a run cycle driven by distance
 * travelled, lean into motion and an alternating placeholder blade swing — so movement can be
 * judged on a phone.
 */
export class PlaceholderHeroVisual {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly legL = new Group();
  private readonly legR = new Group();
  private readonly armL = new Group();
  private readonly armR = new Group();
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: Material[] = [];
  private readonly bodyMaterial: MeshStandardMaterial;
  private readonly flashColor = new Color(1, 1, 1);
  private flash = 0;
  private stridePhase = 0;
  private breathPhase = 0;
  private lean = 0;
  private swingT = -1;
  private swingDurationSec = 0.25;
  private swingRight = true;

  constructor(def: HeroDef) {
    if (def.visual.kind !== 'placeholder')
      throw new Error('PlaceholderHeroVisual needs placeholder data');
    const v: PlaceholderVisual = def.visual;
    this.root.name = `hero:${def.id}`;

    this.bodyMaterial = this.track(
      new MeshStandardMaterial({ color: v.bodyColor, roughness: 0.62, metalness: 0.15 }),
    );
    applyRimLight(this.bodyMaterial, v.rimColor, 3.2, 0.42);
    const trim = this.track(
      new MeshStandardMaterial({ color: v.trimColor, roughness: 0.35, metalness: 0.85 }),
    );
    const skin = this.track(
      new MeshStandardMaterial({ color: 0x8a6a5c, roughness: 0.7, metalness: 0 }),
    );
    applyRimLight(skin, v.rimColor, 3.2, 0.3);
    const blade = this.track(
      new MeshStandardMaterial({ color: v.weaponColor, roughness: 0.22, metalness: 1 }),
    );
    const eyes = this.track(
      new MeshStandardMaterial({ color: 0x000000, emissive: 0xff6a1a, emissiveIntensity: 4 }),
    );

    this.root.add(this.body);

    // Legs (pivot at hip).
    const legGeo = this.geo(new CapsuleGeometry(0.11, 0.5, 4, 10));
    for (const [pivot, x] of [
      [this.legL, -0.13],
      [this.legR, 0.13],
    ] as const) {
      pivot.position.set(x, 0.72, 0);
      const leg = this.mesh(legGeo, this.bodyMaterial);
      leg.position.y = -0.36;
      pivot.add(leg);
      this.body.add(pivot);
    }

    const torso = this.mesh(this.geo(new CapsuleGeometry(0.27, 0.42, 6, 16)), this.bodyMaterial);
    torso.position.y = 1.1;
    torso.scale.set(1, 1, 0.78);
    this.body.add(torso);

    const belt = this.mesh(this.geo(new TorusGeometry(0.255, 0.035, 6, 20)), trim);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.9;
    belt.scale.set(1, 0.8, 1);
    this.body.add(belt);

    const head = this.mesh(this.geo(new SphereGeometry(0.16, 16, 12)), skin);
    head.position.y = 1.72;
    this.body.add(head);
    const hood = this.mesh(
      this.geo(new SphereGeometry(0.185, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)),
      this.bodyMaterial,
    );
    hood.position.set(0, 1.75, -0.02);
    hood.rotation.x = -0.25;
    this.body.add(hood);

    const eyeGeo = this.geo(new SphereGeometry(0.022, 8, 6));
    for (const x of [-0.055, 0.055]) {
      const eye = this.mesh(eyeGeo, eyes);
      eye.castShadow = false;
      eye.position.set(x, 1.74, 0.145);
      this.body.add(eye);
    }

    const pauldronGeo = this.geo(
      new SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    );
    const armGeo = this.geo(new CapsuleGeometry(0.07, 0.42, 4, 10));
    const bladeGeo = this.geo(new BoxGeometry(0.035, 0.07, 0.78));
    const guardGeo = this.geo(new BoxGeometry(0.16, 0.04, 0.05));
    for (const [pivot, x] of [
      [this.armL, -0.34],
      [this.armR, 0.34],
    ] as const) {
      pivot.position.set(x, 1.42, 0);
      const pauldron = this.mesh(pauldronGeo, trim);
      pauldron.position.y = 0.04;
      pivot.add(pauldron);
      const arm = this.mesh(armGeo, this.bodyMaterial);
      arm.position.y = -0.26;
      pivot.add(arm);
      const guard = this.mesh(guardGeo, trim);
      guard.position.set(0, -0.52, 0.05);
      pivot.add(guard);
      const b = this.mesh(bladeGeo, blade);
      b.position.set(0, -0.52, 0.45);
      pivot.add(b);
      this.body.add(pivot);
    }
    this.restPose();
  }

  /** Placeholder swing (visual only). Alternates hands each call. */
  playSwing(durationMs: number): void {
    this.swingDurationSec = Math.max(durationMs, 1) / 1000;
    this.swingT = 0;
    this.swingRight = !this.swingRight;
  }

  get isSwinging(): boolean {
    return this.swingT >= 0;
  }

  /** Brief white flash (used by debug cheats now, hit reactions in M2). */
  triggerFlash(): void {
    this.flash = 1;
  }

  /**
   * @param speedRatio planar speed / max speed (0..1)
   * @param travelled metres moved this frame (drives the stride so feet don't skate)
   */
  update(dtSec: number, speedRatio: number, travelled: number): void {
    this.breathPhase += dtSec * 2.1;
    this.stridePhase += travelled * STRIDE_PER_METRE * Math.PI;
    const stride = Math.sin(this.stridePhase);
    const s = Math.min(speedRatio, 1);

    this.lean += (s * 0.16 - this.lean) * Math.min(1, dtSec * 10);
    this.body.rotation.x = this.lean;
    this.body.position.y =
      Math.abs(Math.cos(this.stridePhase)) * 0.06 * s + Math.sin(this.breathPhase) * 0.008;

    this.legL.rotation.x = stride * 0.75 * s;
    this.legR.rotation.x = -stride * 0.75 * s;

    this.restPose();
    // Arms counter-swing the legs while running.
    this.armL.rotation.x += -stride * 0.5 * s;
    this.armR.rotation.x += stride * 0.5 * s;

    if (this.swingT >= 0) {
      this.swingT += dtSec / this.swingDurationSec;
      if (this.swingT >= 1) {
        this.swingT = -1;
      } else {
        this.applySwing(this.swingT);
      }
    }

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dtSec * 6);
      this.bodyMaterial.emissive.copy(this.flashColor).multiplyScalar(this.flash * 0.8);
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
  }

  private restPose(): void {
    this.armL.rotation.set(0.35, 0, 0.12);
    this.armR.rotation.set(0.35, 0, -0.12);
  }

  private applySwing(t: number): void {
    const arm = this.swingRight ? this.armR : this.armL;
    const side = this.swingRight ? 1 : -1;
    // Wind-up (0–25%), slash (25–55%), recover (55–100%).
    let raise: number;
    let sweep: number;
    if (t < 0.25) {
      const k = easeOutCubic(t / 0.25);
      raise = 0.35 + k * 1.0;
      sweep = side * k * 0.9;
    } else if (t < 0.55) {
      const k = easeOutCubic((t - 0.25) / 0.3);
      raise = 1.35 + k * 0.15;
      sweep = side * (0.9 - k * 2.1);
    } else {
      const k = easeOutCubic((t - 0.55) / 0.45);
      raise = 1.5 - k * 1.15;
      sweep = side * (-1.2 + k * 1.2);
    }
    arm.rotation.x = raise;
    arm.rotation.y = sweep;
    this.body.rotation.y = -sweep * 0.25;
  }

  private track<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mesh(g: BufferGeometry, m: Material): Mesh {
    const mesh = new Mesh(g, m);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    return mesh;
  }
}
