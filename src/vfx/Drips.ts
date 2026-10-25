import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';
import type { TimeUniform } from '../render/env/propMaterials';
import {
  FOG_FADE_PARS_FRAGMENT,
  FOG_FADE_PARS_VERTEX,
  FOG_FADE_VERTEX,
  fogUniforms,
} from './fogFade';

/** Where water drips: floor point and the height it falls from. */
export interface DripSpot {
  readonly x: number;
  readonly z: number;
  readonly top: number;
}

const vertexShader = /* glsl */ `
attribute vec4 aDrip; // x, z, top, phase
attribute float aKind; // 0 falling drop, 1 ripple
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vKind;
${FOG_FADE_PARS_VERTEX}
void main() {
  float period = 2.2 + aDrip.w * 2.3;
  float c = mod(uTime + aDrip.w * 11.0, period);
  float fall = sqrt(2.0 * aDrip.z / 9.8);
  vec3 world;
  vec4 mvPosition;
  if (aKind < 0.5) {
    // A droplet streak, stretched with its speed; hidden after impact.
    float y = aDrip.z - 4.9 * c * c;
    float vis = step(c, fall);
    float len = 0.06 + min(0.5, 9.8 * c * 0.035);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    world = vec3(aDrip.x, max(y, 0.0), aDrip.y) + right * position.x * 0.025 * vis +
            vec3(0.0, (position.y + 0.5) * len * vis, 0.0);
    vAge = 0.0;
  } else {
    // Rings spreading on the puddle after each impact.
    float age = c - fall;
    float alive = step(0.0, age) * step(age, 1.4);
    world = vec3(aDrip.x + position.x * 0.9 * alive, 0.045, aDrip.y - position.y * 0.9 * alive);
    vAge = age;
  }
  mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_VERTEX}
  vUv = position.xy * 2.0;
  vKind = aKind;
}`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
varying vec2 vUv;
varying float vAge;
varying float vKind;
${FOG_FADE_PARS_FRAGMENT}
void main() {
  float a;
  if (vKind < 0.5) {
    a = (1.0 - smoothstep(0.3, 1.0, abs(vUv.x))) * 0.8;
  } else {
    float d = length(vUv);
    float r1 = 0.08 + vAge * 0.6;
    float r2 = max(0.0, vAge - 0.25) * 0.55;
    float ring = exp(-pow((d - r1) / 0.035, 2.0)) + exp(-pow((d - r2) / 0.03, 2.0)) * 0.6;
    a = ring * (1.0 - smoothstep(0.2, 1.4, vAge)) * (1.0 - smoothstep(0.85, 1.0, d)) * 0.7;
  }
  a *= fogFade();
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Water dripping from the cave roof: each spot has a falling droplet (gravity-timed streak) and
 * ripple rings on the floor when it lands, all in one instanced draw call driven by the shared
 * time uniform.
 */
export class Drips {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(spots: readonly DripSpot[], color: number, time: TimeUniform) {
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(1, 1);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const n = Math.max(1, spots.length * 2);
    const drip = new Float32Array(n * 4);
    const kind = new Float32Array(n);
    spots.forEach((s, i) => {
      const phase = (i * 0.618 + 0.21) % 1;
      for (let k = 0; k < 2; k++) {
        drip.set([s.x, s.z, s.top, phase], (i * 2 + k) * 4);
        kind[i * 2 + k] = k;
      }
    });
    geo.setAttribute('aDrip', new InstancedBufferAttribute(drip, 4));
    geo.setAttribute('aKind', new InstancedBufferAttribute(kind, 1));
    geo.instanceCount = spots.length * 2;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...fogUniforms(), uTime: time, uColor: { value: new Color(color) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.name = 'drips';
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
