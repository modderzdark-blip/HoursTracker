import { Color, DoubleSide, MeshBasicMaterial, MeshStandardMaterial } from 'three';

/** A shared seconds uniform (ArenaBuilder advances it once per frame). */
export interface TimeUniform {
  value: number;
}

const HASH = /* glsl */ `
float clHash(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float clNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(clHash(i), clHash(i + vec2(1.0, 0.0)), f.x), mix(clHash(i + vec2(0.0, 1.0)), clHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

/**
 * Banner and flag cloth (bannerClothGeometry): the vertex shader waves it in the wind (two
 * travelling sines along the hang direction, normals tilted with the slope so folds catch the
 * light); the fragment shader cuts a swallow-tailed, torn hem with a few holes and paints a
 * trim border and an emblem (ring and blade) over the vertex-colour base tint.
 */
export function createClothMaterial(
  time: TimeUniform,
  emblem: number,
  trim: number,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    side: DoubleSide,
  });
  const uniforms = {
    clTime: time,
    clEmblem: { value: new Color(emblem) },
    clTrim: { value: new Color(trim) },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aCloth;\nuniform float clTime;\nvarying vec4 vCloth;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        [
          '#include <beginnormal_vertex>',
          'vCloth = aCloth;',
          'float clFlag = step(50.0, aCloth.y);',
          'float clT = clTime * mix(1.7, 3.4, clFlag) + aCloth.y - clFlag * 100.0;',
          'float clK = mix(4.5, 7.0, clFlag);',
          'float clS = aCloth.x;',
          'float clA = mix(0.11, 0.2, clFlag) * clS;',
          'float clDisp = (sin(clT - clS * clK) + 0.35 * sin(clT * 1.7 - clS * clK * 1.9 + 1.3)) * clA;',
          'float clSlope = (-cos(clT - clS * clK) * clK - 0.665 * clK * cos(clT * 1.7 - clS * clK * 1.9 + 1.3)) * clA;',
          'vec3 clN = objectNormal;',
          // Banners hang down (-Y); flags stream away from the pole (across the normal).
          'vec3 clDir = mix(vec3(0.0, -1.0, 0.0), normalize(cross(vec3(0.0, 1.0, 0.0), clN) + 1e-4), clFlag);',
          'objectNormal = normalize(objectNormal - clDir * clSlope * 0.6);',
        ].join('\n'),
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += clN * clDisp;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform vec3 clEmblem;',
          'uniform vec3 clTrim;',
          'varying vec4 vCloth;',
          HASH,
        ].join('\n'),
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float clFlagF = step(50.0, vCloth.y);',
          // s: 0 at the fixed edge → 1 at the free edge; c: across the cloth.
          'float clSf = mix(1.0 - vCloth.w, vCloth.z, clFlagF);',
          'float clC = mix(vCloth.z, vCloth.w, clFlagF);',
          'float clSeed = floor(vCloth.y * 7.0);',
          'float clHem = 0.8 + abs(clC - 0.5) * 0.38 - clNoise(vec2(clC * 14.0, clSeed)) * 0.08;',
          'if (clSf > clHem) discard;',
          'if (clSf > 0.35 && clNoise(vCloth.zw * vec2(9.0, 15.0) + clSeed) > 0.86) discard;',
          'float clEdge = min(min(clC, 1.0 - clC), clSf) ;',
          'float clTrimMask = 1.0 - smoothstep(0.045, 0.06, clEdge);',
          'vec2 clP = vec2(clC - 0.5, (clSf - 0.4) * 1.6);',
          'float clRing = abs(length(clP) - 0.27);',
          'float clBlade = max(abs(clP.x) - 0.035, abs(clP.y + 0.02) - 0.34);',
          'float clGuard = max(abs(clP.x) - 0.16, abs(clP.y + 0.18) - 0.03);',
          'float clMark = 1.0 - smoothstep(0.0, 0.02, min(clRing - 0.03, min(clBlade, clGuard)));',
          'diffuseColor.rgb = mix(diffuseColor.rgb, clTrim, clTrimMask);',
          'diffuseColor.rgb = mix(diffuseColor.rgb, clEmblem, clMark * (1.0 - clTrimMask));',
          // Grime and scorching toward the free edge, faint weave noise.
          'diffuseColor.rgb *= (1.0 - smoothstep(0.45, 0.85, clSf) * 0.5) * (0.85 + 0.3 * clNoise(vCloth.zw * 60.0));',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'arena-cloth';
  return m;
}

/**
 * Emissive props (coals, eyes, runes, lava rock, wicks): unlit vertex colours (authored above 1
 * so they bloom) with a slow pulse that drifts across world space.
 */
export function createGlowMaterial(time: TimeUniform): MeshBasicMaterial {
  const m = new MeshBasicMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['glTime'] = time;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlowW;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvGlowW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float glTime;\nvarying vec3 vGlowW;',
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'float glPh = dot(vGlowW, vec3(0.9, 0.5, 0.7));',
          'diffuseColor.rgb *= 0.72 + 0.18 * sin(glTime * 2.1 + glPh) + 0.1 * sin(glTime * 7.3 + glPh * 3.0);',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'arena-glow';
  return m;
}

/**
 * Faceted crystal: glossy, flat-shaded, glowing from within; the glow follows the vertex colour
 * (bright tips, dim roots) and breathes slowly.
 */
export function createCrystalMaterial(time: TimeUniform, color: number): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.25),
    emissive: new Color(color),
    emissiveIntensity: 0.95,
    roughness: 0.15,
    metalness: 0.1,
    flatShading: true,
    vertexColors: true,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['crTime'] = time;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float crTime;')
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          '#if defined( USE_COLOR )',
          'totalEmissiveRadiance *= vColor.r * vColor.r * (0.82 + 0.18 * sin(crTime * 1.3 + vColor.r * 5.0));',
          '#endif',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'arena-crystal';
  return m;
}

/**
 * Wrought iron (vertex colours = tint × occlusion). Pieces with an `aSway` attribute
 * (pivot height, amplitude per metre below the pivot, phase) swing gently: hanging cages and
 * chains.
 */
export function createIronMaterial(time: TimeUniform): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.75 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms['irTime'] = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aSway;\nuniform float irTime;',
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float irD = max(0.0, aSway.x - transformed.y);',
          'float irT = irTime * 0.9 + aSway.z;',
          'transformed.xz += vec2(sin(irT), cos(irT * 0.8 + 1.3)) * aSway.y * irD;',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'arena-iron';
  return m;
}

/**
 * Standing water for cave puddles: a dark, near-mirror surface (sharp highlights from the moon
 * and fires) whose normal is rippled by drifting noise, with the cavern's glow colour mirrored
 * at grazing angles instead of the white environment.
 */
export function createPuddleMaterial(time: TimeUniform, reflect: number): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: 0x050807,
    roughness: 0.06,
    metalness: 0.1,
    envMapIntensity: 0.15,
  });
  const uniforms = { pdTime: time, pdReflect: { value: new Color(reflect) } };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPdW;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvPdW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'uniform float pdTime;',
          'uniform vec3 pdReflect;',
          'varying vec3 vPdW;',
          HASH,
        ].join('\n'),
      )
      .replace(
        '#include <normal_fragment_maps>',
        [
          '#include <normal_fragment_maps>',
          'vec2 pdP = vPdW.xz * 3.0;',
          'float pdA = clNoise(pdP + vec2(pdTime * 0.6, pdTime * 0.4));',
          'float pdB = clNoise(pdP * 1.7 - vec2(pdTime * 0.5, -pdTime * 0.7));',
          'vec3 pdN = normalize(vec3((pdA - 0.5) * 0.12, 1.0, (pdB - 0.5) * 0.12));',
          'normal = normalize((viewMatrix * vec4(pdN, 0.0)).xyz);',
        ].join('\n'),
      )
      .replace(
        '#include <emissivemap_fragment>',
        [
          '#include <emissivemap_fragment>',
          'float pdF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 5.0);',
          'float pdG = clNoise(vPdW.xz * 0.6 + normal.xz * 3.0);',
          'totalEmissiveRadiance += pdReflect * pdF * 0.16 * (0.3 + pdG);',
        ].join('\n'),
      );
  };
  m.customProgramCacheKey = () => 'arena-puddle';
  return m;
}
