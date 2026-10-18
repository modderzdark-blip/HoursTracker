import { Color, Mesh, PlaneGeometry, ShaderMaterial, type Scene } from 'three';
import type { HitShape } from '../data/combatTypes';
import type { TelegraphPort } from './telegraphPort';

const VERT = /* glsl */ `
varying vec2 vP;
void main() {
  // Local quad coordinates: x right, y forward (the plane is laid flat with +y → -Z, so flip).
  vP = vec2(uv.x * 2.0 - 1.0, -(uv.y * 2.0 - 1.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform int uMode;        // 0 = circle/arc, 1 = box, 2 = expanding ring
uniform float uHalfAngle; // radians (PI = full circle)
uniform float uProgress;  // 0..1
uniform float uOpacity;
uniform vec3 uColor;
varying vec2 vP;

void main() {
  float alpha = 0.0;
  if (uMode == 0) {
    float r = length(vP);
    if (r > 1.0) discard;
    float ang = abs(atan(vP.x, -vP.y));
    if (ang > uHalfAngle) discard;
    float rim = smoothstep(0.9, 1.0, r);
    float side = uHalfAngle < 3.1 ? smoothstep(uHalfAngle - 0.06, uHalfAngle, ang) : 0.0;
    float fill = r <= uProgress ? 0.42 : 0.12;
    alpha = max(max(rim, side) * 0.9, fill);
  } else if (uMode == 1) {
    vec2 a = abs(vP);
    if (a.x > 1.0 || a.y > 1.0) discard;
    float edge = max(smoothstep(0.92, 1.0, a.x), smoothstep(0.96, 1.0, a.y));
    float along = (-vP.y + 1.0) * 0.5;
    float fill = along <= uProgress ? 0.42 : 0.12;
    alpha = max(edge * 0.9, fill);
  } else {
    float r = length(vP);
    float w = 0.12;
    float band = smoothstep(uProgress - w, uProgress, r) * (1.0 - smoothstep(uProgress, uProgress + 0.02, r));
    alpha = band * (1.0 - uProgress);
  }
  gl_FragColor = vec4(uColor, alpha * uOpacity);
  #include <colorspace_fragment>
}
`;

interface Decal {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  active: boolean;
  ring: boolean;
  ringMs: number;
  ringDurMs: number;
  shape: HitShape | null;
}

/**
 * Pooled ground indicators for telegraphed area attacks (circle / cone / box that fill up as the
 * wind-up progresses) and expanding shockwave rings. One draw call per visible decal.
 */
export class TelegraphDecals implements TelegraphPort {
  private readonly decals: Decal[] = [];
  private readonly geometry = new PlaneGeometry(2, 2);

  constructor(scene: Scene, poolSize = 16) {
    this.geometry.rotateX(-Math.PI / 2);
    for (let i = 0; i < poolSize; i++) {
      const mat = new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uMode: { value: 0 },
          uHalfAngle: { value: Math.PI },
          uProgress: { value: 0 },
          uOpacity: { value: 1 },
          uColor: { value: new Color(0xff3a1a) },
        },
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const mesh = new Mesh(this.geometry, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.decals.push({
        mesh,
        mat,
        active: false,
        ring: false,
        ringMs: 0,
        ringDurMs: 0,
        shape: null,
      });
    }
  }

  private acquire(): number {
    for (let i = 0; i < this.decals.length; i++) if (this.decals[i]?.active === false) return i;
    return -1;
  }

  show(shape: HitShape, x: number, z: number, yaw: number, color: number): number {
    const i = this.acquire();
    const d = this.decals[i];
    if (d === undefined) return -1;
    d.active = true;
    d.ring = false;
    d.shape = shape;
    const u = d.mat.uniforms;
    (u['uColor'] as { value: Color }).value.setHex(color);
    (u['uOpacity'] as { value: number }).value = 1;
    (u['uProgress'] as { value: number }).value = 0;
    if (shape.kind === 'box') {
      (u['uMode'] as { value: number }).value = 1;
      d.mesh.scale.set(shape.width / 2, 1, shape.length / 2);
    } else {
      (u['uMode'] as { value: number }).value = 0;
      const r = shape.kind === 'arc' ? shape.range : shape.radius;
      (u['uHalfAngle'] as { value: number }).value =
        shape.kind === 'arc' ? (shape.angleDeg * Math.PI) / 360 : Math.PI;
      d.mesh.scale.set(r, 1, r);
    }
    d.mesh.visible = true;
    this.update(i, 0, x, z, yaw);
    return i;
  }

  update(handle: number, progress: number, x: number, z: number, yaw: number): void {
    const d = this.decals[handle];
    if (d === undefined || !d.active || d.shape === null) return;
    const s = d.shape;
    const fwd = s.kind === 'circle' ? s.forward : s.kind === 'box' ? s.forward + s.length / 2 : 0;
    d.mesh.position.set(x + Math.sin(yaw) * fwd, 0.04, z + Math.cos(yaw) * fwd);
    d.mesh.rotation.y = yaw;
    (d.mat.uniforms['uProgress'] as { value: number }).value = progress;
  }

  hide(handle: number): void {
    const d = this.decals[handle];
    if (d === undefined) return;
    d.active = false;
    d.mesh.visible = false;
  }

  /** Expanding shockwave ring (phase transitions, slams). */
  ring(x: number, z: number, radius: number, color: number, durationMs: number): void {
    const i = this.acquire();
    const d = this.decals[i];
    if (d === undefined) return;
    d.active = true;
    d.ring = true;
    d.ringMs = 0;
    d.ringDurMs = durationMs;
    d.shape = null;
    const u = d.mat.uniforms;
    (u['uMode'] as { value: number }).value = 2;
    (u['uColor'] as { value: Color }).value.setHex(color);
    (u['uOpacity'] as { value: number }).value = 1;
    (u['uProgress'] as { value: number }).value = 0;
    d.mesh.scale.set(radius, 1, radius);
    d.mesh.position.set(x, 0.05, z);
    d.mesh.visible = true;
  }

  /** Advances rings (real time). */
  tick(dtMs: number): void {
    for (const d of this.decals) {
      if (!d.active || !d.ring) continue;
      d.ringMs += dtMs;
      const t = d.ringMs / d.ringDurMs;
      (d.mat.uniforms['uProgress'] as { value: number }).value = Math.min(1, t);
      if (t >= 1) {
        d.active = false;
        d.mesh.visible = false;
      }
    }
  }

  hideAll(): void {
    for (const d of this.decals) {
      d.active = false;
      d.mesh.visible = false;
    }
  }

  get activeCount(): number {
    let n = 0;
    for (const d of this.decals) if (d.active) n++;
    return n;
  }

  dispose(): void {
    for (const d of this.decals) {
      d.mat.dispose();
      d.mesh.removeFromParent();
    }
    this.geometry.dispose();
  }
}
