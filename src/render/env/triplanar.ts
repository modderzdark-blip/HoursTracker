import { Color, MeshStandardMaterial } from 'three';
import type { MaterialMaps } from './TextureSynth';

export interface TriplanarOptions {
  /** Texture repeats per metre. */
  readonly scale: number;
  /** Tint multiplied into the albedo. */
  readonly tint?: number;
  /** Strength of baked vertex-colour occlusion on direct light (indirect always gets it fully). */
  readonly aoDirect?: number;
  /** Only the top-down projection (flat floors: a third of the texture reads). */
  readonly flat?: boolean;
  /** Large-scale brightness variation that breaks up visible tiling (0 = off). */
  readonly macro?: number;
  readonly normalScale?: number;
  readonly envMapIntensity?: number;
  /** Flat floors only: a second surface blended in organic patches. */
  readonly patch?: { readonly maps: MaterialMaps; readonly scale: number; readonly amount: number };
}

/**
 * MeshStandardMaterial that samples a synthesized PBR set in world space (triplanar, whiteout
 * normal blend), multiplies baked occlusion from the vertex colours, and breaks up tiling with
 * a low-frequency variation. Works with instanced meshes; the geometry needs no UVs.
 */
export function createTriplanarMaterial(
  maps: MaterialMaps,
  o: TriplanarOptions,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(o.tint ?? 0xffffff),
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: o.envMapIntensity ?? 1,
  });
  const uniforms = {
    tpAlbedo: { value: maps.albedo },
    tpNormal: { value: maps.normal },
    tpOrm: { value: maps.orm },
    tpScale: { value: o.scale },
    tpAoDirect: { value: o.aoDirect ?? 0.55 },
    tpMacro: { value: o.macro ?? 0.25 },
    tpNormalScale: { value: o.normalScale ?? 1 },
    tpPAlbedo: { value: o.patch?.maps.albedo ?? maps.albedo },
    tpPNormal: { value: o.patch?.maps.normal ?? maps.normal },
    tpPOrm: { value: o.patch?.maps.orm ?? maps.orm },
    tpPScale: { value: o.patch?.scale ?? o.scale },
    tpPAmount: { value: o.patch?.amount ?? 0 },
  };
  const flat = o.flat === true;
  const patch = flat && o.patch !== undefined;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpNormal;',
      )
      .replace(
        '#include <project_vertex>',
        [
          '#include <project_vertex>',
          'vec4 tpWorld = vec4(transformed, 1.0);',
          'vec3 tpN = objectNormal;',
          '#ifdef USE_INSTANCING',
          '  tpWorld = instanceMatrix * tpWorld;',
          '  tpN = mat3(instanceMatrix) * tpN;',
          '#endif',
          'tpWorld = modelMatrix * tpWorld;',
          'vTpPos = tpWorld.xyz;',
          'vTpNormal = normalize(mat3(modelMatrix) * tpN);',
        ].join('\n'),
      );
    const patchSample = patch
      ? [
          // Organic patch mask from two octaves of value noise in world space.
          'float tpMask = tpVNoise(vTpPos.xz * 0.09) * 0.65 + tpVNoise(vTpPos.xz * 0.27 + 7.1) * 0.35;',
          'tpMask = smoothstep(0.62 - tpPAmount * 0.3, 0.72 - tpPAmount * 0.3, tpMask);',
          'vec2 tpUvP = vTpPos.xz * tpPScale;',
          'tpA = mix(tpA, texture2D(tpPAlbedo, tpUvP), tpMask);',
          'tpO = mix(tpO, texture2D(tpPOrm, tpUvP).rgb, tpMask);',
        ]
      : ['float tpMask = 0.0;'];
    const sample = flat
      ? [
          'vec2 tpUvY = vTpPos.xz * tpScale;',
          'vec4 tpA = texture2D(tpAlbedo, tpUvY);',
          'vec3 tpO = texture2D(tpOrm, tpUvY).rgb;',
          ...patchSample,
        ]
      : [
          'vec3 tpW = pow(abs(normalize(vTpNormal)), vec3(4.0));',
          'tpW /= (tpW.x + tpW.y + tpW.z);',
          'vec2 tpUvX = vTpPos.zy * tpScale;',
          'vec2 tpUvY = vTpPos.xz * tpScale;',
          'vec2 tpUvZ = vTpPos.xy * tpScale;',
          'vec4 tpA = texture2D(tpAlbedo, tpUvX) * tpW.x + texture2D(tpAlbedo, tpUvY) * tpW.y + texture2D(tpAlbedo, tpUvZ) * tpW.z;',
          'vec3 tpO = texture2D(tpOrm, tpUvX).rgb * tpW.x + texture2D(tpOrm, tpUvY).rgb * tpW.y + texture2D(tpOrm, tpUvZ).rgb * tpW.z;',
        ];
    const normalBlend = flat
      ? [
          'vec3 tnY = texture2D(tpNormal, tpUvY).xyz * 2.0 - 1.0;',
          ...(patch
            ? ['tnY = mix(tnY, texture2D(tpPNormal, tpUvP).xyz * 2.0 - 1.0, tpMask);']
            : []),
          'tnY.xy *= tpNormalScale;',
          // Top-down projection: tangent x → world x, tangent y → world -z.
          'vec3 tpWorldN = normalize(vec3(tnY.x, tnY.z, -tnY.y));',
        ]
      : [
          'vec3 tpNw = normalize(vTpNormal);',
          'vec3 tnX = texture2D(tpNormal, tpUvX).xyz * 2.0 - 1.0;',
          'vec3 tnY = texture2D(tpNormal, tpUvY).xyz * 2.0 - 1.0;',
          'vec3 tnZ = texture2D(tpNormal, tpUvZ).xyz * 2.0 - 1.0;',
          'tnX.xy *= tpNormalScale; tnY.xy *= tpNormalScale; tnZ.xy *= tpNormalScale;',
          // Whiteout blend (Golus): swizzle each tangent normal into world space.
          'tnX = vec3(tnX.xy + tpNw.zy, abs(tnX.z) * tpNw.x);',
          'tnY = vec3(tnY.xy + tpNw.xz, abs(tnY.z) * tpNw.y);',
          'tnZ = vec3(tnZ.xy + tpNw.xy, abs(tnZ.z) * tpNw.z);',
          'vec3 tpWorldN = normalize(tnX.zyx * tpW.x + tnY.xzy * tpW.y + tnZ.xyz * tpW.z);',
        ];
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying vec3 vTpPos;',
          'varying vec3 vTpNormal;',
          'uniform sampler2D tpAlbedo;',
          'uniform sampler2D tpNormal;',
          'uniform sampler2D tpOrm;',
          'uniform float tpScale;',
          'uniform float tpAoDirect;',
          'uniform float tpMacro;',
          'uniform float tpNormalScale;',
          'uniform sampler2D tpPAlbedo;',
          'uniform sampler2D tpPNormal;',
          'uniform sampler2D tpPOrm;',
          'uniform float tpPScale;',
          'uniform float tpPAmount;',
          'float tpHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }',
          'float tpVNoise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);',
          '  return mix(mix(tpHash(i), tpHash(i + vec2(1.0, 0.0)), f.x), mix(tpHash(i + vec2(0.0, 1.0)), tpHash(i + vec2(1.0, 1.0)), f.x), f.y); }',
        ].join('\n'),
      )
      .replace(
        '#include <map_fragment>',
        [
          ...sample,
          // Low-frequency variation from a far-scaled read of the same albedo.
          'float tpVar = dot(texture2D(tpAlbedo, vTpPos.xz * tpScale * 0.073 + 0.31).rgb, vec3(0.333));',
          'diffuseColor.rgb *= tpA.rgb * mix(1.0, 0.6 + tpVar * 1.2, tpMacro);',
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )',
          'float tpBaked = vColor.r;',
          '#else',
          'float tpBaked = 1.0;',
          '#endif',
          'diffuseColor.rgb *= mix(1.0, tpBaked, tpAoDirect);',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = tpO.g;',
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          ...normalBlend,
          'normal = normalize((viewMatrix * vec4(tpWorldN, 0.0)).xyz);',
        ].join('\n'),
      )
      .replace(
        '#include <aomap_fragment>',
        [
          '#include <aomap_fragment>',
          'float tpAo = tpO.r * tpBaked;',
          'reflectedLight.indirectDiffuse *= tpAo;',
          'reflectedLight.indirectSpecular *= tpAo;',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => `triplanar-${flat ? 'flat' : 'full'}${patch ? '-patch' : ''}`;
  return m;
}
