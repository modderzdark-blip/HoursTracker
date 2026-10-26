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

/** A pool of coloured light on the floor: centre, radius, colour × intensity, flicker 0..1. */
export interface GlowPool {
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly color: number;
  readonly intensity: number;
  readonly flicker: number;
}

const vertexShader = /* glsl */ `
attribute vec4 aPool; // x, z, radius, seed
attribute vec4 aTint; // rgb, flicker
uniform float uTime;
varying vec2 vUv;
varying vec3 vTint;
${FOG_FADE_PARS_VERTEX}
void main() {
  vUv = position.xz;
  float s = aPool.w;
  float t = uTime * (7.0 + s * 5.0) + s * 40.0;
  // Fire-like flicker: two fast sines and a slow breath, scaled by the pool's flicker amount.
  float f = 0.5 + 0.25 * sin(t) + 0.25 * sin(t * 2.37 + 1.3);
  float k = 1.0 - aTint.w * (0.45 * f + 0.15 * sin(uTime * 0.7 + s * 9.0));
  vTint = aTint.rgb * k;
  vec3 world = vec3(aPool.x + position.x * aPool.z, 0.035, aPool.y + position.z * aPool.z);
  vec4 mvPosition = viewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  ${FOG_FADE_VERTEX}
}`;

const fragmentShader = /* glsl */ `
varying vec2 vUv;
varying vec3 vTint;
${FOG_FADE_PARS_FRAGMENT}
void main() {
  float d = length(vUv);
  float f = 1.0 - smoothstep(0.0, 1.0, d);
  f *= f;
  gl_FragColor = vec4(vTint * f * fogFade(), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/**
 * Soft coloured light pools on the floor under fires, candles, lava and crystals: additive
 * radial gradients that flicker in the vertex shader. They read as light spilling from the
 * source without adding real lights (the dynamic light count stays fixed). One draw call.
 */
export class GlowPools {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor(pools: readonly GlowPool[], time: TimeUniform) {
    const geo = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(2, 2);
    quad.rotateX(-Math.PI / 2);
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    const pool = new Float32Array(Math.max(1, pools.length) * 4);
    const tint = new Float32Array(Math.max(1, pools.length) * 4);
    const c = new Color();
    pools.forEach((p, i) => {
      pool.set([p.x, p.z, p.radius, (i * 0.618) % 1], i * 4);
      c.setHex(p.color).multiplyScalar(p.intensity);
      tint.set([c.r, c.g, c.b, p.flicker], i * 4);
    });
    geo.setAttribute('aPool', new InstancedBufferAttribute(pool, 4));
    geo.setAttribute('aTint', new InstancedBufferAttribute(tint, 4));
    geo.instanceCount = pools.length;
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { ...fogUniforms(), uTime: time },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: true,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'glow-pools';
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
