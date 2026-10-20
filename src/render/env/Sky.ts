import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';

export interface SkyLook {
  readonly zenith: number;
  readonly horizon: number;
  /** Moon / sun disc colour and its direction (the arena's key light direction). */
  readonly moon: number;
  readonly moonDir: readonly [number, number, number];
  /** 0..1 */
  readonly stars: number;
  /** 0..1 cloud cover. */
  readonly clouds: number;
  readonly cloudColor: number;
}

const vertexShader = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uMoon;
uniform vec3 uMoonDir;
uniform float uStars;
uniform float uClouds;
uniform vec3 uCloudColor;
uniform float uTime;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
                 mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
                 mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);
  // Horizon band, deepening to the zenith.
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.05, 0.6, up));
  // Stars, fading toward the hazy horizon.
  vec3 sp = d * 220.0;
  float st = step(0.9975, hash(floor(sp))) * smoothstep(0.05, 0.4, up);
  st *= 0.6 + 0.4 * sin(uTime * 2.0 + hash(floor(sp) + 3.0) * 30.0);
  col += vec3(st) * uStars;
  // Moon disc + halo.
  float md = max(dot(d, normalize(uMoonDir)), 0.0);
  col += uMoon * (smoothstep(0.9993, 0.9996, md) * 1.6 + pow(md, 64.0) * 0.35 + pow(md, 8.0) * 0.08);
  // Drifting clouds lit from the moon side.
  vec2 cp = d.xz / max(d.y + 0.25, 0.08);
  float c = fbm(vec3(cp * 0.6 + vec2(uTime * 0.004, 0.0), uTime * 0.002));
  float cover = smoothstep(1.0 - uClouds, 1.0 - uClouds + 0.35, c) * smoothstep(-0.02, 0.25, up);
  vec3 cloud = mix(uCloudColor * 0.5, uCloudColor, pow(md, 3.0));
  col = mix(col, cloud, cover * 0.85);
  // Low haze matches the fog colour so distant geometry melts into the sky.
  col = mix(col, uHorizon, smoothstep(0.18, -0.05, up));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Sky dome: horizon-to-zenith gradient matched to the fog, stars, a moon (or a bloody sun) in the
 * key light's direction with a halo, and slowly drifting moonlit clouds. Drawn behind everything
 * (depth at the far plane), never fogged.
 */
export class Sky {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(look: SkyLook, radius = 400) {
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uZenith: { value: new Color(look.zenith) },
        uHorizon: { value: new Color(look.horizon) },
        uMoon: { value: new Color(look.moon) },
        uMoonDir: { value: new Vector3(...look.moonDir).normalize() },
        uStars: { value: look.stars },
        uClouds: { value: look.clouds },
        uCloudColor: { value: new Color(look.cloudColor) },
        uTime: { value: 0 },
      },
      side: BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new Mesh(new SphereGeometry(radius, 48, 24), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
  }

  update(dtSec: number, center: Vector3): void {
    const t = this.material.uniforms['uTime'];
    if (t !== undefined) t.value = ((t.value as number) + dtSec) % 10_000;
    this.mesh.position.copy(center);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
