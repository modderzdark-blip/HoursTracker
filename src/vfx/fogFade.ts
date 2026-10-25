import { UniformsLib, UniformsUtils, type IUniform } from 'three';

/**
 * Fog for additive / premultiplied effect shaders (ShaderMaterial with `fog: true`): instead of
 * mixing toward the fog colour, which would add fog-coloured light, the effect fades out with
 * distance. The vertex shader needs an `mvPosition` in scope before FOG_FADE_VERTEX, and the
 * material's uniforms must include fogUniforms() (the renderer fills them from scene.fog).
 */
export const FOG_FADE_PARS_VERTEX = /* glsl */ `#include <fog_pars_vertex>`;

export const FOG_FADE_VERTEX = /* glsl */ `#include <fog_vertex>`;

export const FOG_FADE_PARS_FRAGMENT = /* glsl */ `
#include <fog_pars_fragment>
float fogFade() {
#ifdef USE_FOG
  #ifdef FOG_EXP2
  return exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #else
  return 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
#else
  return 1.0;
#endif
}`;

/** A fresh copy of the fog uniforms three.js updates for materials with `fog: true`. */
export function fogUniforms(): Record<string, IUniform> {
  return UniformsUtils.clone(UniformsLib.fog);
}
