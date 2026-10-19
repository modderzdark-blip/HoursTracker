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
      .replace('#include <common>', '#include <common>\nattribute vec2 surf;\nvarying vec2 vSurf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 rimColor;\nuniform float rimPower;\nuniform float rimStrength;\nvarying vec2 vSurf;\nconst float cameraFill = ${cameraFill.toFixed(3)};`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.x;',
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
  material.customProgramCacheKey = () => `character-v2-${cameraFill.toFixed(3)}`;
  return uniforms;
}
