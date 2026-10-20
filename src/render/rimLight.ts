import { Color, type MeshStandardMaterial } from 'three';

export interface RimUniforms {
  rimColor: { value: Color };
  rimPower: { value: number };
  rimStrength: { value: number };
}

/**
 * Adds a view-dependent fresnel rim to a standard/physical material by injecting into its shader.
 * Cheap (a few ALU ops) and keeps characters readable against the dark arena.
 */
export function applyRimLight(
  material: MeshStandardMaterial,
  color: number,
  power = 2.6,
  strength = 0.9,
): RimUniforms {
  const uniforms: RimUniforms = {
    rimColor: { value: new Color(color) },
    rimPower: { value: power },
    rimStrength: { value: strength },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['rimColor'] = uniforms.rimColor;
    shader.uniforms['rimPower'] = uniforms.rimPower;
    shader.uniforms['rimStrength'] = uniforms.rimStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimStrength;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float rimFactor = 1.0 - saturate(dot(normal, normalize(vViewPosition)));',
          'totalEmissiveRadiance += rimColor * pow(rimFactor, rimPower) * rimStrength;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => 'rim-v1';
  return uniforms;
}

/**
 * Procedural surface detail for characters, from 3D noise in rest-pose space (metres):
 * cloth (rough, non-metal) gets hanging folds and a coarse weave, leather (mid roughness) grain
 * and creases, metal dents and scratches; everything gathers grime toward the feet. Returns
 * x = bump height, y = albedo multiplier, z = roughness offset. Detail fades out where it would
 * be smaller than a pixel, so distant characters do not shimmer.
 */
const DETAIL_GLSL = /* glsl */ `
float dHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dHash(i), dHash(i + vec3(1, 0, 0)), f.x),
                 mix(dHash(i + vec3(0, 1, 0)), dHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(dHash(i + vec3(0, 0, 1)), dHash(i + vec3(1, 0, 1)), f.x),
                 mix(dHash(i + vec3(0, 1, 1)), dHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec4 surfaceDetail(vec3 p, vec2 surf) {
  float metal = smoothstep(0.35, 0.6, surf.y);
  float cloth = (1.0 - metal) * smoothstep(0.7, 0.85, surf.x);
  float leather = (1.0 - metal) * (1.0 - cloth);
  // Screen-space size of a centimetre: fade detail that would alias.
  float px = length(fwidth(p));
  float fine = 1.0 - smoothstep(0.004, 0.012, px);
  float mid = 1.0 - smoothstep(0.012, 0.035, px);
  // Cloth: vertical folds (stretched noise) plus a coarse weave.
  float folds = dNoise(p * vec3(9.0, 2.2, 9.0));
  folds = 1.0 - abs(folds * 2.0 - 1.0);
  float weave = (sin(p.x * 260.0 + p.z * 260.0) * sin(p.y * 260.0)) * 0.5 + 0.5;
  float hCloth = folds * 0.75 * mid + weave * 0.25 * fine;
  // Leather: grain and creases.
  float grain = dNoise(p * 70.0);
  float crease = dNoise(p * vec3(14.0, 5.0, 14.0));
  float hLeather = grain * 0.45 * fine + smoothstep(0.55, 0.8, crease) * 0.55 * mid;
  // Metal: broad dents and fine scratches.
  float dents = dNoise(p * 11.0);
  float scratch = smoothstep(0.92, 0.99, dNoise(p * vec3(120.0, 9.0, 120.0)));
  float hMetal = dents * 0.7 * mid - scratch * 0.3 * fine;
  float h = hCloth * cloth + hLeather * leather + hMetal * metal;
  // Albedo: wear, grime toward the feet, scratches catch light on metal.
  float grimeN = dNoise(p * 4.0);
  float grime = (1.0 - smoothstep(0.05, 0.75, p.y)) * (0.25 + 0.35 * grimeN);
  float albedo = 1.0 - grime * (1.0 - metal * 0.6);
  albedo *= 1.0 + (h - 0.4) * 0.22 * (cloth + leather);
  albedo += scratch * metal * 0.25 * fine;
  // Metal: smudged, unevenly polished — dull in the dents, darker where grime collects.
  float smudge = dNoise(p * 3.0);
  albedo *= 1.0 - metal * (0.25 * (1.0 - dents) + 0.15 * smudge);
  float rough = metal * (0.12 + (1.0 - dents) * 0.22 + smudge * 0.18) + grime * 0.2 - scratch * metal * 0.15;
  return vec4(h * mix(0.014, 0.03, metal), albedo, rough, 0.0);
}
vec3 detailPerturb(vec3 surfPos, vec3 surfNorm, vec2 dHdxy, float faceDir) {
  vec3 sx = dFdx(surfPos);
  vec3 sy = dFdy(surfPos);
  vec3 r1 = cross(sy, surfNorm);
  vec3 r2 = cross(surfNorm, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dHdxy.x * r1 + dHdxy.y * r2);
  return normalize(abs(det) * surfNorm - grad);
}
`;

/**
 * Character shading: the fresnel rim above plus per-vertex roughness / metalness from a `surf`
 * attribute (x = roughness, y = metalness), so one material (one draw call) can show matte
 * cloth, worn leather and polished steel side by side.
 */
export function applyCharacterShading(
  material: MeshStandardMaterial,
  color: number,
  power: number,
  strength: number,
  cameraFill = 0,
): RimUniforms {
  const uniforms: RimUniforms = {
    rimColor: { value: new Color(color) },
    rimPower: { value: power },
    rimStrength: { value: strength },
  };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['rimColor'] = uniforms.rimColor;
    shader.uniforms['rimPower'] = uniforms.rimPower;
    shader.uniforms['rimStrength'] = uniforms.rimStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 surf;\nvarying vec2 vSurf;\nvarying vec3 vDetPos;',
      )
      // Rest-pose position: surface detail stays glued to the body while it animates.
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSurf = surf;\nvDetPos = position;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimStrength;\nvarying vec2 vSurf;\nvarying vec3 vDetPos;\nconst float cameraFill = ${cameraFill.toFixed(3)};\n${DETAIL_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'vec4 det = surfaceDetail(vDetPos, vSurf);',
          'diffuseColor.rgb *= det.y;',
        ].join('\n'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          'normal = detailPerturb(-vViewPosition, normal, vec2(dFdx(det.x), dFdy(det.x)), faceDirection);',
        ].join('\n'),
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = clamp(vSurf.x + det.z, 0.04, 1.0);',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.y;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float rimFactor = 1.0 - saturate(dot(normal, normalize(vViewPosition)));',
          'totalEmissiveRadiance += rimColor * pow(rimFactor, rimPower) * rimStrength;',
          // Soft key light from above-left of the camera, for characters only (view space).
          'float camKey = 0.35 + 0.65 * saturate(dot(normal, normalize(vec3(-0.35, 0.55, 0.8))));',
          'totalEmissiveRadiance += diffuseColor.rgb * (1.0 - vSurf.y) * cameraFill * camKey;',
        ].join('\n'),
      );
  };
  material.customProgramCacheKey = () => `character-v3-${cameraFill.toFixed(3)}`;
  return uniforms;
}
