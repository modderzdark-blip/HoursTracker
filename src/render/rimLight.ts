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
