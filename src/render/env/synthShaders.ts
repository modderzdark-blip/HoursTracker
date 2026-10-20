/**
 * GLSL for tileable PBR material synthesis. Every material is a height field plus colour and
 * roughness rules; the albedo, normal and ORM (occlusion, roughness, metalness) maps are rendered
 * from it in three passes. All noise is periodic over the unit square, so maps tile seamlessly.
 */

export const SYNTH_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const NOISE = /* glsl */ `
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + uSeed * 0.0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed * 0.0091);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Gradient noise with integer period 'rep' (cells per tile).
float gnoise(vec2 p, float rep) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i00 = mod(i, rep);
  vec2 i10 = mod(i + vec2(1.0, 0.0), rep);
  vec2 i01 = mod(i + vec2(0.0, 1.0), rep);
  vec2 i11 = mod(i + vec2(1.0, 1.0), rep);
  vec2 g00 = hash22(i00) * 2.0 - 1.0;
  vec2 g10 = hash22(i10) * 2.0 - 1.0;
  vec2 g01 = hash22(i01) * 2.0 - 1.0;
  vec2 g11 = hash22(i11) * 2.0 - 1.0;
  float n00 = dot(g00, f);
  float n10 = dot(g10, f - vec2(1.0, 0.0));
  float n01 = dot(g01, f - vec2(0.0, 1.0));
  float n11 = dot(g11, f - vec2(1.0, 1.0));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y) * 1.4;
}

// Fractal noise over the unit square; base frequency 'freq' (an integer), ~-1..1.
float fbm(vec2 uv, float freq, int octaves) {
  float a = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  float f = freq;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += a * gnoise(uv * f, f);
    norm += a;
    a *= 0.5;
    f *= 2.0;
  }
  return sum / norm;
}

float ridgedFbm(vec2 uv, float freq, int octaves) {
  float a = 0.5;
  float sum = 0.0;
  float norm = 0.0;
  float f = freq;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(gnoise(uv * f, f));
    sum += a * n * n;
    norm += a;
    a *= 0.5;
    f *= 2.0;
  }
  return sum / norm;
}

// Periodic Voronoi: x = distance to the nearest feature point, y = distance to the nearest cell
// border, z = random id of the nearest cell. 'rep' cells per tile.
vec3 voronoi(vec2 p, float rep, float jitter) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  vec2 mg;
  vec2 mr;
  float md = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 cell = mod(n + g, rep);
    vec2 o = 0.5 + (hash22(cell) - 0.5) * jitter;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) {
      md = d;
      mr = r;
      mg = g;
      id = hash12(cell * 1.37 + 0.71);
    }
  }
  float border = 8.0;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 cell = mod(n + g, rep);
    vec2 o = 0.5 + (hash22(cell) - 0.5) * jitter;
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001)
      border = min(border, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec3(sqrt(md), border, id);
}
`;

/**
 * Material programs. Each defines `float height(vec2 uv)` (0..1) and
 * `void surface(vec2 uv, float h, out vec3 albedo, out float rough)`.
 * uColorA = main tone, uColorB = secondary tone (moss, ash, soot), uColorC = accent (grout, glow).
 */
const MATERIALS = /* glsl */ `
// 0: flagstones — staggered courses of cut pavers with irregular joints, uneven tops, chipped
// edges, cracks, worn centres, dirt in the joints and soot stains.
// Returns x = distance to the joint (row-height units), y = stone id, z/w = position in stone.
vec4 paver(vec2 uv) {
  vec2 w = uv + vec2(fbm(uv, 8.0, 3), fbm(uv + 0.31, 8.0, 3)) * 0.0045;
  float rows = 5.0;
  float ry = w.y * rows;
  float row = mod(floor(ry), rows);
  float fy = fract(ry);
  float k = 2.0 + floor(hash12(vec2(row, 7.0)) * 3.0);
  float x = fract(w.x + hash12(vec2(row, 1.0)));
  float edge = 1.0;
  float id = 0.0;
  float lx = 0.5;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    if (fi >= k) break;
    float j0 = i == 0 ? 0.0 : (hash12(vec2(row, fi + 11.0)) - 0.5) * 0.7;
    float j1 = fi + 1.0 >= k ? 0.0 : (hash12(vec2(row, fi + 12.0)) - 0.5) * 0.7;
    float b0 = (fi + j0) / k;
    float b1 = (fi + 1.0 + j1) / k;
    if (x >= b0 && x < b1) {
      edge = min(x - b0, b1 - x) * rows;
      id = hash12(vec2(row * 13.0 + fi, 31.0));
      lx = (x - b0) / (b1 - b0);
    }
  }
  edge = min(edge, min(fy, 1.0 - fy));
  return vec4(edge, id, lx, fy);
}
float hFlag(vec2 uv) {
  vec4 p = paver(uv);
  float chip = fbm(uv * 1.0 + p.y, 24.0, 3) * 0.05;
  float bevel = smoothstep(0.012, 0.09 + chip, p.x);
  // Each stone sits slightly tilted, its centre worn by footsteps.
  float tilt = (p.z - 0.5) * (p.y - 0.5) * 0.12 + (p.w - 0.5) * (fract(p.y * 7.3) - 0.5) * 0.1;
  float wear = -smoothstep(0.15, 0.5, 0.5 - length(vec2(p.z, p.w) - 0.5)) * 0.03;
  float top = 0.8 + tilt + wear + fbm(uv + p.y, 20.0, 4) * 0.045;
  float crack = smoothstep(0.93, 0.985, ridgedFbm(uv + p.y * 3.1, 5.0, 4)) * 0.3 * step(0.45, p.y);
  float pits = smoothstep(0.6, 0.85, fbm(uv, 64.0, 2)) * 0.05;
  // A few stones are gone (packed earth and grit) or sunken.
  if (p.y < 0.04) return 0.3 + fbm(uv, 40.0, 3) * 0.08;
  if (p.y > 0.93) top -= 0.12;
  return mix(0.1, top - crack - pits, bevel);
}
void sFlag(vec2 uv, float h, out vec3 albedo, out float rough) {
  vec4 p = paver(uv);
  // Per-stone tone and a slight hue drift between neighbours.
  float tone = 0.55 + p.y * 0.6 + fbm(uv + p.y, 28.0, 4) * 0.2;
  vec3 hue = mix(vec3(1.08, 0.98, 0.9), vec3(0.92, 0.97, 1.06), fract(p.y * 5.17));
  vec3 stone = uColorA * tone * hue;
  float joint = 1.0 - smoothstep(0.012, 0.06, p.x);
  float grime = smoothstep(0.1, 0.75, fbm(uv, 3.0, 5)) * 0.6;
  float edgeDirt = (1.0 - smoothstep(0.05, 0.25, p.x)) * 0.35;
  albedo = mix(stone, uColorC, joint * 0.9);
  albedo = mix(albedo, uColorB, clamp(grime + edgeDirt, 0.0, 0.85));
  albedo *= 0.8 + 0.2 * smoothstep(0.1, 0.9, h);
  rough = mix(0.7, 0.96, joint) - smoothstep(0.8, 0.9, h) * 0.1;
  if (p.y < 0.04) {
    albedo = mix(uColorA * 0.55, uColorB, 0.35) * (0.9 + fbm(uv, 30.0, 3) * 0.4);
    rough = 0.95;
  }
}

// 1: rock — layered strata, fractures, lichen.
float hRock(vec2 uv) {
  // Horizontal strata: three times the frequency down as across (periods still divide 1).
  float strata = ridgedFbm(vec2(uv.x, uv.y * 3.0) + fbm(uv, 3.0, 3) * 0.12, 2.0, 5);
  float big = fbm(uv, 3.0, 5) * 0.5 + 0.5;
  float frac = smoothstep(0.9, 0.99, ridgedFbm(uv + 0.5, 5.0, 4));
  return clamp(big * 0.55 + strata * 0.45 - frac * 0.3, 0.0, 1.0);
}
void sRock(vec2 uv, float h, out vec3 albedo, out float rough) {
  float tone = 0.75 + fbm(uv, 10.0, 5) * 0.25 + h * 0.3;
  albedo = uColorA * tone;
  float lichen = smoothstep(0.25, 0.65, fbm(uv + 3.3, 7.0, 5)) * smoothstep(0.45, 0.8, h);
  albedo = mix(albedo, uColorB, lichen * 0.55);
  albedo *= 0.7 + 0.3 * h;
  rough = 0.82 + fbm(uv, 30.0, 3) * 0.1;
}

// 2: masonry — coursed ashlar blocks, chipped edges, mortar, streaks.
float hMason(vec2 uv) {
  float rows = 8.0;
  vec2 p = uv * vec2(4.0, rows);
  float row = floor(p.y);
  p.x += mod(row, 2.0) * 0.5 + hash12(vec2(row, 3.0)) * 0.3;
  vec2 cell = floor(p);
  vec2 f = fract(p);
  vec2 cid = vec2(mod(cell.x, 4.0), mod(cell.y, rows));
  float chip = fbm(uv + hash12(cid), 32.0, 3) * 0.06;
  // Blocks are twice as wide as tall: measure the x edge distance in row-height units.
  vec2 e = min(f, 1.0 - f);
  float edge = min(e.x * 2.0, e.y);
  float bevel = smoothstep(0.0, 0.09 + chip, edge);
  float face = 0.75 + hash12(cid + 9.1) * 0.12 + fbm(uv, 20.0, 4) * 0.05;
  return mix(0.06, face, bevel);
}
void sMason(vec2 uv, float h, out vec3 albedo, out float rough) {
  float rows = 8.0;
  vec2 p = uv * vec2(4.0, rows);
  float row = floor(p.y);
  p.x += mod(row, 2.0) * 0.5 + hash12(vec2(row, 3.0)) * 0.3;
  vec2 cid = vec2(mod(floor(p.x), 4.0), mod(floor(p.y), rows));
  float tone = 0.8 + hash12(cid + 2.2) * 0.35 + fbm(uv, 18.0, 4) * 0.15;
  albedo = uColorA * tone;
  float mortar = 1.0 - smoothstep(0.08, 0.2, h);
  albedo = mix(albedo, uColorC, mortar * 0.8);
  // Vertical rain streaks: high frequency across, low frequency down (both still tile).
  float streak = smoothstep(0.3, 0.8, fbm(vec2(uv.x * 6.0, uv.y), 2.0, 4)) * 0.45;
  albedo = mix(albedo, uColorB, streak);
  rough = mix(0.8, 0.97, mortar);
}

// 3: cracked earth / ash ground — dry plates, deep cracks, scattered pebbles.
float hEarth(vec2 uv) {
  vec3 v = voronoi(uv * 9.0 + vec2(fbm(uv, 6.0, 3), fbm(uv + 0.5, 6.0, 3)) * 0.35, 9.0, 0.9);
  float crack = smoothstep(0.0, 0.05, v.y);
  float plate = 0.6 + fbm(uv + v.z, 12.0, 4) * 0.12 + v.z * 0.08;
  vec3 pv = voronoi(uv * 40.0, 40.0, 1.0);
  float pebble = (1.0 - smoothstep(0.0, 0.22, pv.x)) * step(0.82, pv.z) * 0.25;
  return clamp(mix(0.05, plate, crack) + pebble, 0.0, 1.0);
}
void sEarth(vec2 uv, float h, out vec3 albedo, out float rough) {
  float tone = 0.8 + fbm(uv, 6.0, 5) * 0.3;
  albedo = uColorA * tone;
  float ash = smoothstep(0.1, 0.7, fbm(uv + 7.7, 3.0, 5));
  albedo = mix(albedo, uColorB, ash * 0.6);
  albedo = mix(uColorC, albedo, smoothstep(0.04, 0.2, h));
  rough = 0.9;
}

// 4: wet cave stone — smooth worn rock with puddles in the hollows.
float hCave(vec2 uv) {
  float big = fbm(uv, 3.0, 6) * 0.5 + 0.5;
  vec3 v = voronoi(uv * 6.0, 6.0, 1.0);
  float lumps = smoothstep(0.0, 0.6, v.x) * 0.15;
  return clamp(big * 0.8 + 0.1 - lumps, 0.0, 1.0);
}
void sCave(vec2 uv, float h, out vec3 albedo, out float rough) {
  float tone = 0.7 + fbm(uv, 14.0, 5) * 0.3;
  albedo = uColorA * tone;
  float moss = smoothstep(0.3, 0.7, fbm(uv + 1.9, 5.0, 5)) * smoothstep(0.35, 0.6, h);
  albedo = mix(albedo, uColorB, moss * 0.5);
  float wet = 1.0 - smoothstep(0.32, 0.4, h);
  albedo = mix(albedo, albedo * 0.45 + uColorC * 0.08, wet);
  rough = mix(0.85, 0.12, wet);
}

float height(vec2 uv) {
  if (uMat == 0) return hFlag(uv);
  if (uMat == 1) return hRock(uv);
  if (uMat == 2) return hMason(uv);
  if (uMat == 3) return hEarth(uv);
  return hCave(uv);
}
void surface(vec2 uv, float h, out vec3 albedo, out float rough) {
  if (uMat == 0) sFlag(uv, h, albedo, rough);
  else if (uMat == 1) sRock(uv, h, albedo, rough);
  else if (uMat == 2) sMason(uv, h, albedo, rough);
  else if (uMat == 3) sEarth(uv, h, albedo, rough);
  else sCave(uv, h, albedo, rough);
}
`;

export const SYNTH_FRAGMENT = /* glsl */ `
precision highp float;
uniform int uMat;
uniform int uPass;
uniform float uSeed;
uniform float uSize;
uniform float uNormalStrength;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
// 1 = write sRGB-encoded albedo (baking to image files); 0 = linear (sRGB render target).
uniform int uEncode;
varying vec2 vUv;
${NOISE}
${MATERIALS}
vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vUv;
  float h = height(uv);
  if (uPass == 0) {
    vec3 albedo;
    float rough;
    surface(uv, h, albedo, rough);
    albedo = clamp(albedo, 0.0, 1.0);
    gl_FragColor = vec4(uEncode == 1 ? toSrgb(albedo) : albedo, 1.0);
  } else if (uPass == 1) {
    float px = 1.0 / uSize;
    float hl = height(fract(uv - vec2(px, 0.0)));
    float hr = height(fract(uv + vec2(px, 0.0)));
    float hd = height(fract(uv - vec2(0.0, px)));
    float hu = height(fract(uv + vec2(0.0, px)));
    float s = uNormalStrength * uSize / 512.0;
    vec3 n = normalize(vec3((hl - hr) * s, (hd - hu) * s, 1.0));
    gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);
  } else {
    // Cavity occlusion: how far below its neighbourhood this texel sits.
    float r = 6.0 / uSize;
    float avg = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      avg += height(fract(uv + vec2(cos(a), sin(a)) * r));
    }
    avg /= 8.0;
    float ao = clamp(1.0 - max(0.0, avg - h) * 3.5, 0.25, 1.0);
    vec3 albedo;
    float rough;
    surface(uv, h, albedo, rough);
    gl_FragColor = vec4(ao, clamp(rough, 0.04, 1.0), 0.0, 1.0);
  }
}`;

/** Material program ids (uMat). */
export const SYNTH_MATERIAL = {
  flagstone: 0,
  rock: 1,
  masonry: 2,
  earth: 3,
  cave: 4,
} as const;

export type SynthMaterialId = keyof typeof SYNTH_MATERIAL;
