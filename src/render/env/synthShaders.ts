/**
 * GLSL for tileable PBR material synthesis. Every material is a height field plus colour and
 * roughness rules; the albedo, normal and ORM (occlusion, roughness, emissive mask) maps are
 * rendered from it in three passes. All noise is periodic over the unit square, so maps tile seamlessly.
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
vec3 voronoiR(vec2 p, vec2 rep, float jitter) {
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
vec3 voronoi(vec2 p, float rep, float jitter) {
  return voronoiR(p, vec2(rep), jitter);
}
`;

/**
 * Material programs. Each defines a height `hX(vec2 uv)` (0..1) and
 * `sX(vec2 uv, float h, out vec3 albedo, out float rough, out float glow)`.
 * uColorA = main tone, uColorB = secondary tone (moss, ash, soot), uColorC = accent (grout,
 * crack). `glow` (0..1) is an emissive mask (lava, magma, inlays, fungus) stored in the ORM
 * blue channel; uGlow scales it and is 0 for surfaces that never glow.
 */
const MATERIALS = /* glsl */ `
// 0: flagstones — irregular cut slabs (0.4–0.9 m at the arena scale), uneven joints, per-stone
// tilt and tone, chipped edges, cracks, worn tops, grit in the joints, sunken and missing stones
// (packed earth).
// Returns x = distance to the joint (stone-size units), y = stone id, z/w = position in stone.
vec4 paver(vec2 uv) {
  // Irregular slabs: a jittered cell grid, wider than deep (about 0.7 × 0.5 m at arena scale),
  // so stones are cut polygons of varied size with no continuous joint lines.
  vec2 w = uv + vec2(fbm(uv, 6.0, 3), fbm(uv + 0.31, 6.0, 3)) * 0.006;
  vec2 rep = vec2(11.0, 16.0);
  vec2 q = w * rep;
  vec2 n = floor(q);
  vec2 f = fract(q);
  vec2 mr = vec2(0.0);
  vec2 mg = vec2(0.0);
  float md = 8.0;
  float id = 0.0;
  for (int j = -1; j <= 1; j++)
  for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 cell = mod(n + g, rep);
    vec2 o = 0.5 + (hash22(cell) - 0.5) * 0.8;
    vec2 r = (g + o - f) * vec2(1.0, 0.7);
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; id = hash12(cell * 1.37 + 0.71); }
  }
  float border = 8.0;
  for (int j = -2; j <= 2; j++)
  for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 cell = mod(n + g, rep);
    vec2 o = 0.5 + (hash22(cell) - 0.5) * 0.8;
    vec2 r = (g + o - f) * vec2(1.0, 0.7);
    if (dot(mr - r, mr - r) > 0.00001) border = min(border, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  // Joint width varies from stone to stone.
  float edge = border * 0.55 - hash12(vec2(id * 91.0, 3.0)) * 0.02;
  return vec4(edge, id, 0.5 - mr.x * 0.9, 0.5 - mr.y * 1.2);
}
float flagCrack(vec2 uv, vec4 p) {
  return smoothstep(0.95, 0.99, ridgedFbm(uv + p.y * 3.1, 6.0, 4)) * step(0.4, p.y);
}
float hFlag(vec2 uv) {
  vec4 p = paver(uv);
  float chip = fbm(uv + p.y, 32.0, 3) * 0.06;
  float bevel = smoothstep(0.0, 0.03 + chip, p.x);
  // Each stone sits tilted its own way, its centre worn by footsteps.
  float tilt = (p.z - 0.5) * (fract(p.y * 3.7) - 0.5) * 0.3 +
               (p.w - 0.5) * (fract(p.y * 7.3) - 0.5) * 0.24;
  float wear = -smoothstep(0.1, 0.5, 0.5 - length(p.zw - 0.5)) * 0.025;
  float top = 0.78 + tilt + wear + (p.y - 0.5) * 0.06 + fbm(uv + p.y, 24.0, 4) * 0.04;
  float pits = smoothstep(0.62, 0.85, fbm(uv, 80.0, 2)) * 0.04;
  if (p.y < 0.035) return 0.28 + fbm(uv, 48.0, 3) * 0.08;
  if (p.y > 0.94) top -= 0.1;
  return mix(0.08, top - flagCrack(uv, p) * 0.28 - pits, bevel);
}
void sFlag(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  vec4 p = paver(uv);
  // Strong per-stone variation: tone, hue, and a weathering wash (soot, lichen) of its own.
  float tone = 0.42 + p.y * 0.8 + fbm(uv + p.y, 28.0, 4) * 0.22;
  vec3 hue = mix(vec3(1.12, 0.98, 0.86), vec3(0.88, 0.96, 1.08), fract(p.y * 5.17));
  vec3 stone = uColorA * tone * hue;
  float wash = smoothstep(0.35, 0.8, fbm(uv * 1.0 + p.y * 4.0, 12.0, 4)) * step(0.35, fract(p.y * 3.3));
  stone = mix(stone, uColorB * 1.4, wash * 0.45);
  // Worn tops are lighter and smoother; dirt collects along the edges and in the joints.
  float worn = smoothstep(0.76, 0.86, h);
  stone *= 1.0 + worn * 0.16;
  float joint = 1.0 - smoothstep(0.0, 0.018, p.x);
  float edgeDirt = (1.0 - smoothstep(0.01, 0.14, p.x)) * 0.45;
  float grime = smoothstep(0.2, 0.85, fbm(uv, 4.0, 5)) * 0.35;
  float stain = smoothstep(0.55, 0.85, fbm(uv + p.y * 2.0, 10.0, 3)) * 0.4 * step(0.6, fract(p.y * 9.1));
  albedo = mix(stone, uColorB, clamp(edgeDirt + grime + stain, 0.0, 0.85));
  // Joints hold grit and ash rather than pure black.
  vec3 grit = mix(uColorC, uColorB * 1.3, 0.35 + 0.5 * smoothstep(0.2, 0.8, fbm(uv, 48.0, 3)));
  albedo = mix(albedo, grit, joint);
  float crack = flagCrack(uv, p);
  albedo *= (0.72 + 0.28 * smoothstep(0.1, 0.85, h)) * (1.0 - crack * 0.65);
  rough = mix(0.7, 0.96, joint) - worn * 0.14;
  // Lava seeps up through networks of joints and cracks (patches across the tile).
  float seep = smoothstep(0.4, 0.62, fbm(uv + 2.7, 3.0, 4));
  glow = (joint + crack) * seep;
  if (p.y < 0.035) {
    albedo = mix(uColorA * 0.45, uColorB, 0.5) * (0.8 + fbm(uv, 30.0, 3) * 0.45);
    rough = 0.95;
    glow = smoothstep(0.5, 0.75, fbm(uv, 40.0, 3)) * seep;
  }
  albedo *= 1.0 - glow * uGlow * 0.6;
  glow *= uGlow;
}

// 1: rock — layered strata, fractures, lichen.
float hRock(vec2 uv) {
  // Horizontal strata: three times the frequency down as across (periods still divide 1).
  float strata = ridgedFbm(vec2(uv.x, uv.y * 3.0) + fbm(uv, 3.0, 3) * 0.12, 2.0, 5);
  float big = fbm(uv, 3.0, 5) * 0.5 + 0.5;
  float frac = smoothstep(0.9, 0.99, ridgedFbm(uv + 0.5, 5.0, 4));
  return clamp(big * 0.55 + strata * 0.45 - frac * 0.3, 0.0, 1.0);
}
void sRock(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  float tone = 0.75 + fbm(uv, 10.0, 5) * 0.25 + h * 0.3;
  albedo = uColorA * tone;
  float lichen = smoothstep(0.25, 0.65, fbm(uv + 3.3, 7.0, 5)) * smoothstep(0.45, 0.8, h);
  albedo = mix(albedo, uColorB, lichen * 0.55);
  albedo *= 0.7 + 0.3 * h;
  rough = 0.82 + fbm(uv, 30.0, 3) * 0.1;
  // Hot fissures in the deepest fractures (volcanic rock only).
  glow = smoothstep(0.93, 0.99, ridgedFbm(uv + 0.5, 5.0, 4)) * uGlow;
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
void sMason(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
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
  glow = 0.0;
}

// 3: cracked earth — dry plates split by deep cracks, pebbles, ash, and branching magma veins
// that glow in the deepest cracks.
vec3 earthCells(vec2 uv) {
  return voronoi(uv * 9.0 + vec2(fbm(uv, 6.0, 3), fbm(uv + 0.5, 6.0, 3)) * 0.35, 9.0, 0.9);
}
float earthVein(vec2 uv) {
  return smoothstep(0.83, 0.95, ridgedFbm(uv + fbm(uv + 4.1, 4.0, 3) * 0.05, 3.0, 5));
}
float hEarth(vec2 uv) {
  vec3 v = earthCells(uv);
  float crack = smoothstep(0.0, 0.05, v.y);
  float plate = 0.6 + fbm(uv + v.z, 12.0, 4) * 0.12 + v.z * 0.08;
  vec3 pv = voronoi(uv * 40.0, 40.0, 1.0);
  float pebble = (1.0 - smoothstep(0.0, 0.22, pv.x)) * step(0.82, pv.z) * 0.25;
  return clamp(mix(0.05, plate, crack) + pebble - earthVein(uv) * 0.35, 0.0, 1.0);
}
void sEarth(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  vec3 v = earthCells(uv);
  float tone = 0.8 + fbm(uv, 6.0, 5) * 0.3 + (v.z - 0.5) * 0.12;
  albedo = uColorA * tone;
  float ash = smoothstep(0.1, 0.7, fbm(uv + 7.7, 3.0, 5));
  albedo = mix(albedo, uColorB, ash * 0.6);
  float crack = 1.0 - smoothstep(0.0, 0.04, v.y);
  float vein = earthVein(uv);
  // Plates scorch black around the hot veins.
  albedo *= 1.0 - smoothstep(0.0, 1.0, vein + crack * 0.4) * 0.55 * min(1.0, uGlow * 2.0);
  albedo = mix(uColorC, albedo, smoothstep(0.04, 0.2, h));
  rough = 0.9;
  float hot = smoothstep(0.45, 0.7, fbm(uv + 3.3, 2.0, 4));
  glow = max(vein, crack * hot * 0.7) * uGlow;
}

// 4: wet cave floor — stepped slate slabs split by moss-filled cracks, damp hollows and
// clusters of glowing fungus and crystal flecks.
vec3 caveCells(vec2 uv) {
  vec2 w = uv + vec2(fbm(uv, 4.0, 3), fbm(uv + 0.7, 4.0, 3)) * 0.03;
  return voronoi(w * 8.0, 8.0, 0.95);
}
float hCave(vec2 uv) {
  vec3 v = caveCells(uv);
  float plate = 0.55 + v.z * 0.18 + fbm(uv + v.z, 10.0, 4) * 0.07;
  float strata = ridgedFbm(uv + v.z, 12.0, 3) * 0.04;
  float lip = smoothstep(0.0, 0.06, v.y);
  return clamp(mix(0.2 + fbm(uv, 30.0, 3) * 0.05, plate + strata, lip), 0.0, 1.0);
}
void sCave(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  vec3 v = caveCells(uv);
  float tone = 0.65 + v.z * 0.4 + fbm(uv, 18.0, 4) * 0.2;
  albedo = uColorA * tone;
  float crack = 1.0 - smoothstep(0.0, 0.1, v.y);
  float mossy = smoothstep(0.35, 0.7, fbm(uv + 1.9, 5.0, 5));
  float moss = clamp(crack * 0.9 + mossy * (1.0 - smoothstep(0.5, 0.7, h)), 0.0, 1.0);
  albedo = mix(albedo, uColorB, moss * 0.7);
  // Damp hollows: darker and glossier (not mirror-like; real puddles are separate meshes).
  float damp = 1.0 - smoothstep(0.45, 0.6, h);
  albedo *= 1.0 - damp * 0.35;
  rough = mix(0.82, 0.38, damp);
  // Fungus clusters grow in the mossy cracks; crystal flecks sparkle on the slabs.
  vec3 f = voronoi(uv * 90.0, 90.0, 1.0);
  float cluster = smoothstep(0.55, 0.8, fbm(uv + 8.8, 6.0, 3));
  float cap = (1.0 - smoothstep(0.05, 0.3, f.x)) * step(0.55, f.z) * cluster * moss;
  vec3 c = voronoi(uv * 140.0, 140.0, 1.0);
  float fleck = (1.0 - smoothstep(0.0, 0.12, c.x)) * step(0.97, c.z) * (1.0 - moss);
  albedo = mix(albedo, uColorC, cap);
  glow = clamp(cap + fleck * 0.6, 0.0, 1.0) * uGlow;
}

// 5: cobbles — rounded setts (about 0.3 m) bedded in grit and blackened by soot, half buried by
// drifts of ash in which embers smoulder.
vec3 cobble(vec2 uv) {
  vec2 w = uv + vec2(fbm(uv, 8.0, 3), fbm(uv + 0.4, 8.0, 3)) * 0.006;
  return voronoi(w * 26.0, 26.0, 0.75);
}
// x = stone height, y = ash surface height.
vec2 cobbleH(vec2 uv) {
  vec3 v = cobble(uv);
  float dome = sqrt(clamp(v.y * 3.2, 0.0, 1.0));
  float top = 0.55 + dome * 0.3 + v.z * 0.06 + fbm(uv + v.z, 40.0, 3) * 0.03;
  float base = 0.3 + fbm(uv, 60.0, 2) * 0.03;
  float stone = v.z < 0.04 ? base : mix(base, top, smoothstep(0.02, 0.08, v.y));
  float drift = smoothstep(-0.05, 0.45, fbm(uv + 5.3, 3.0, 5) + 0.15 * fbm(uv, 12.0, 3));
  return vec2(stone, drift * 0.95 + fbm(uv, 24.0, 3) * 0.02 * drift);
}
float hCobble(vec2 uv) {
  vec2 c = cobbleH(uv);
  return max(c.x, c.y);
}
void sCobble(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  vec3 v = cobble(uv);
  vec2 c = cobbleH(uv);
  float inAsh = smoothstep(-0.01, 0.02, c.y - c.x);
  float tone = 0.6 + v.z * 0.55 + fbm(uv + v.z, 30.0, 3) * 0.2;
  vec3 stone = uColorA * tone;
  float soot = smoothstep(0.2, 0.75, fbm(uv + 9.1, 5.0, 4));
  stone *= 1.0 - soot * 0.65;
  float joint = 1.0 - smoothstep(0.02, 0.07, v.y);
  albedo = mix(stone, uColorC, joint * 0.9);
  vec3 ashCol = uColorB * (0.8 + fbm(uv, 50.0, 3) * 0.35);
  albedo = mix(albedo, ashCol, inAsh);
  rough = mix(0.78, 0.97, max(joint, inAsh));
  vec3 e = voronoi(uv * 70.0, 70.0, 1.0);
  glow = (1.0 - smoothstep(0.0, 0.18, e.x)) * step(0.93, e.z) * inAsh * uGlow;
}

// 6: polished marble — square slabs in two tones with cloudy veins, thin inlaid metal joints,
// a rune medallion on the dark slabs, a few cracked slabs. The inlays carry the glow.
float marbleRune(vec2 f) {
  vec2 q = f - 0.5;
  float r = length(q);
  float ring = abs(r - 0.3);
  float diamond = abs(abs(q.x) + abs(q.y) - 0.3);
  float a = atan(q.y, q.x) / 6.2832 * 8.0;
  float spoke = abs(fract(a) - 0.5) * 6.2832 / 8.0 * r;
  spoke = max(spoke, abs(r - 0.36) - 0.05);
  float d = min(min(ring, diamond), spoke);
  return 1.0 - smoothstep(0.005, 0.012, d);
}
// x = joint distance, y = slab id, z = dark slab (0/1), w = rune line.
vec4 marbleSlab(vec2 uv) {
  vec2 g = uv * 6.0;
  vec2 c = floor(g);
  vec2 f = fract(g);
  vec2 cid = mod(c, 6.0);
  vec2 e = min(f, 1.0 - f);
  float dark = mod(cid.x + cid.y, 2.0);
  float rune = dark * step(0.5, mod(cid.x, 4.0)) * step(mod(cid.y, 2.0), 0.5);
  return vec4(min(e.x, e.y), hash12(cid + 4.0), dark, marbleRune(f) * rune);
}
float hMarble(vec2 uv) {
  vec4 s = marbleSlab(uv);
  float bevel = smoothstep(0.0, 0.02, s.x);
  float crack = smoothstep(0.955, 0.99, ridgedFbm(uv + s.y * 2.3, 4.0, 4)) * step(0.75, s.y);
  float top = 0.8 + (s.y - 0.5) * 0.02 + fbm(uv, 16.0, 3) * 0.006;
  return mix(0.62, top - crack * 0.2 - s.w * 0.04, bevel);
}
void sMarble(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  vec4 s = marbleSlab(uv);
  vec2 w = uv + vec2(fbm(uv + s.y, 3.0, 4), fbm(uv + 1.7, 3.0, 4)) * 0.08;
  float veins = smoothstep(0.82, 0.97, ridgedFbm(w, 4.0, 5));
  float cloud = fbm(uv + s.y * 3.0, 8.0, 4) * 0.5 + 0.5;
  vec3 base = uColorA * mix(1.0, 0.55, s.z) * (0.85 + cloud * 0.3 + (s.y - 0.5) * 0.1);
  albedo = mix(base, uColorB, veins * 0.75);
  float joint = 1.0 - smoothstep(0.004, 0.012, s.x);
  float crack = smoothstep(0.955, 0.99, ridgedFbm(uv + s.y * 2.3, 4.0, 4)) * step(0.75, s.y);
  albedo = mix(albedo, uColorC, max(joint, s.w) * 0.85);
  albedo *= 1.0 - crack * 0.7;
  rough = mix(0.22, 0.5, max(joint, crack)) + cloud * 0.08;
  glow = max(joint, s.w) * uGlow;
}

float height(vec2 uv) {
  if (uMat == 0) return hFlag(uv);
  if (uMat == 1) return hRock(uv);
  if (uMat == 2) return hMason(uv);
  if (uMat == 3) return hEarth(uv);
  if (uMat == 4) return hCave(uv);
  if (uMat == 5) return hCobble(uv);
  return hMarble(uv);
}
void surface(vec2 uv, float h, out vec3 albedo, out float rough, out float glow) {
  if (uMat == 0) sFlag(uv, h, albedo, rough, glow);
  else if (uMat == 1) sRock(uv, h, albedo, rough, glow);
  else if (uMat == 2) sMason(uv, h, albedo, rough, glow);
  else if (uMat == 3) sEarth(uv, h, albedo, rough, glow);
  else if (uMat == 4) sCave(uv, h, albedo, rough, glow);
  else if (uMat == 5) sCobble(uv, h, albedo, rough, glow);
  else sMarble(uv, h, albedo, rough, glow);
}
`;

export const SYNTH_FRAGMENT = /* glsl */ `
precision highp float;
uniform int uMat;
uniform int uPass;
uniform float uSeed;
uniform float uSize;
uniform float uNormalStrength;
uniform float uGlow;
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
    float glow;
    surface(uv, h, albedo, rough, glow);
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
    float glow;
    surface(uv, h, albedo, rough, glow);
    // R occlusion, G roughness, B emissive mask.
    gl_FragColor = vec4(ao, clamp(rough, 0.04, 1.0), clamp(glow, 0.0, 1.0), 1.0);
  }
}`;

/** Material program ids (uMat). */
export const SYNTH_MATERIAL = {
  flagstone: 0,
  rock: 1,
  masonry: 2,
  earth: 3,
  cave: 4,
  cobble: 5,
  marble: 6,
} as const;

export type SynthMaterialId = keyof typeof SYNTH_MATERIAL;
