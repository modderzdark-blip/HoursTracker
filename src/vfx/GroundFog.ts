import { CircleGeometry, Color, DoubleSide, Mesh, ShaderMaterial } from 'three';

const vertexShader = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
uniform float uDensity;
uniform float uRadius;
varying vec3 vWorld;
float hash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  vec2 p = vWorld.xz;
  float t = uTime;
  float n = vnoise(p * 0.11 + vec2(t * 0.05, t * 0.02)) * 0.55 +
            vnoise(p * 0.27 - vec2(t * 0.07, -t * 0.04)) * 0.3 +
            vnoise(p * 0.6 + vec2(-t * 0.1, t * 0.06)) * 0.15;
  float wisps = smoothstep(0.35, 0.85, n);
  // Thicker toward the walls, thin in the middle of the fight.
  float r = length(p) / uRadius;
  float edge = mix(0.45, 1.0, smoothstep(0.35, 0.95, r)) * (1.0 - smoothstep(1.05, 1.25, r));
  float a = wisps * uDensity * edge;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Low drifting mist: two stacked transparent layers of scrolling noise just above the floor,
 * thicker toward the walls. Gives the arena depth and softens where props meet the ground.
 */
export class GroundFog {
  readonly meshes: Mesh[] = [];
  private readonly materials: ShaderMaterial[] = [];
  private time = 0;

  constructor(radius: number, color: number, density: number) {
    const geo = new CircleGeometry(radius * 1.2, 64);
    geo.rotateX(-Math.PI / 2);
    for (const [h, d] of [
      [0.22, density],
      [0.75, density * 0.6],
    ] as const) {
      const m = new ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: h * 37 },
          uColor: { value: new Color(color) },
          uDensity: { value: d },
          uRadius: { value: radius },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const mesh = new Mesh(geo, m);
      mesh.position.y = h;
      mesh.renderOrder = 4;
      mesh.name = 'ground-fog';
      this.materials.push(m);
      this.meshes.push(mesh);
    }
  }

  update(dtSec: number): void {
    this.time = (this.time + dtSec) % 10_000;
    this.materials.forEach((m, i) => {
      const u = m.uniforms['uTime'];
      if (u !== undefined) u.value = this.time * (1 + i * 0.35) + i * 37;
    });
  }

  dispose(): void {
    for (const m of this.meshes) m.removeFromParent();
    this.meshes[0]?.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
