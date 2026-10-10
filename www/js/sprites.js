// SPRITES: the per-pixel candy shader and the sprite atlas.
// Every candy, special, blocker and icon is shaded pixel by pixel in plain JavaScript (no libraries), once per theme:
//   signed-distance shape -> plump "pillow" height field -> normals -> warm key + tinted fill light with wrap-around
//   diffuse -> two Blinn-Phong lobes (tight ~60, wide ~8) -> studio-panorama reflection with Fresnel -> subsurface
//   glow -> theme detail (gummy bubbles, hard-candy swirl, sugar glitter) -> contact shadow, inset outline, tone map,
//   gamma and saturation.
// shadeSprite() is pure (works in Node for tests and for the icon generator); createSpriteCache() wraps it in canvases.
(function attachSprites(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  // ---------------------------------------------------------------- palette: the classic candy-shop set
  // Jelly bean, lozenge, lemon drop, gum square, gumball and jujube cluster: each with its own color AND silhouette.
  const CANDIES = Object.freeze([
    { id: 0, name: 'Cherry Bean', shape: 'bean', base: '#ff2e4f', highlight: '#ff9aa8', shadow: '#a80d2c', symbol: 'heart' },
    { id: 1, name: 'Orange Lozenge', shape: 'lozenge', base: '#ff8a12', highlight: '#ffc77a', shadow: '#c25300', symbol: 'wedge' },
    { id: 2, name: 'Lemon Drop', shape: 'lemon', base: '#ffd92e', highlight: '#fff6a8', shadow: '#c49a00', symbol: 'diamond' },
    { id: 3, name: 'Mint Square', shape: 'chiclet', base: '#2fd36b', highlight: '#a3f5bd', shadow: '#0f8a3c', symbol: 'square' },
    { id: 4, name: 'Blueberry Ball', shape: 'ball', base: '#2f8cff', highlight: '#a8d4ff', shadow: '#1450b8', symbol: 'circle' },
    { id: 5, name: 'Grape Cluster', shape: 'cluster', base: '#a64dff', highlight: '#dcb5ff', shadow: '#5a1aa8', symbol: 'star' },
  ]);
  // The jujube cluster: a centre gummy and six around it (x, y, radius), shared by its shape and its height detail.
  const CLUSTER_GUMMIES = Object.freeze([[0, 0, 0.44]].concat([0, 1, 2, 3, 4, 5].map((index) => {
    const angle = (index * Math.PI) / 3 + Math.PI / 6;
    return [Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, 0.35];
  })));

  // Material themes: same shapes and colors, different shader parameters (Section 4.2).
  const THEMES = Object.freeze({
    gummy: { id: 'gummy', name: 'Gummy', spec_power: 60, spec_tight: 1.3, spec_wide: 0.18, env: 0.6, fresnel0: 0.05, subsurface: 1.0, translucency: 0.55, saturation: 1.22, detail: 'bubbles', height: 0.95 },
    hard: { id: 'hard', name: 'Hard Candy', spec_power: 110, spec_tight: 1.8, spec_wide: 0.1, env: 1.0, fresnel0: 0.08, subsurface: 0.55, translucency: 0.35, saturation: 1.26, detail: 'swirl', height: 0.85 },
    sprinkle: { id: 'sprinkle', name: 'Sugar Sprinkle', spec_power: 22, spec_tight: 0.38, spec_wide: 0.12, env: 0.16, fresnel0: 0.03, subsurface: 0.35, translucency: 0.15, saturation: 1.14, detail: 'sugar', height: 1.0 },
  });
  const THEME_IDS = Object.freeze(['gummy', 'hard', 'sprinkle']);

  // ---------------------------------------------------------------- small math helpers
  const clamp = (value, low, high) => (value < low ? low : value > high ? high : value);
  const mix = (a, b, t) => a + (b - a) * t;
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  function hexToLinear(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => Math.pow(channel / 255, 2.2));
  }

  function hash2(x, y, seed) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function seededRandom(seed) {
    let state = seed >>> 0 || 1;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------- signed distance shapes (negative inside, y down)
  function sdCircle(x, y, radius) {
    return Math.sqrt(x * x + y * y) - radius;
  }

  function sdRoundBox(x, y, half_w, half_h, radius) {
    const qx = Math.abs(x) - half_w + radius;
    const qy = Math.abs(y) - half_h + radius;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - radius;
  }

  function sdRhombus(x, y, half_w, half_h) {
    const px = Math.abs(x);
    const py = Math.abs(y);
    const ndot = (half_w - 2 * px) * half_w - (half_h - 2 * py) * half_h;
    const h = clamp(ndot / (half_w * half_w + half_h * half_h), -1, 1);
    const dx = px - 0.5 * half_w * (1 - h);
    const dy = py - 0.5 * half_h * (1 + h);
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance * Math.sign(px * half_h + py * half_w - half_w * half_h);
  }

  // Heart (Inigo Quilez's exact heart), in a space with y up and the point at the origin.
  function sdHeartRaw(x, y) {
    const px = Math.abs(x);
    if (y + px > 1) {
      const dx = px - 0.25;
      const dy = y - 0.75;
      return Math.sqrt(dx * dx + dy * dy) - Math.SQRT2 / 4;
    }
    const ax = px;
    const ay = y - 1;
    const m = 0.5 * Math.max(px + y, 0);
    const bx = px - m;
    const by = y - m;
    return Math.sqrt(Math.min(ax * ax + ay * ay, bx * bx + by * by)) * Math.sign(px - y);
  }

  function sdStar5(x, y, radius, inner) {
    const k1x = 0.809016994375;
    const k1y = -0.587785252292;
    const k2x = -k1x;
    const k2y = k1y;
    let px = Math.abs(x);
    let py = y;
    let dot = Math.max(k1x * px + k1y * py, 0);
    px -= 2 * dot * k1x;
    py -= 2 * dot * k1y;
    dot = Math.max(k2x * px + k2y * py, 0);
    px -= 2 * dot * k2x;
    py -= 2 * dot * k2y;
    px = Math.abs(px);
    py -= radius;
    const bax = inner * -k1y - 0;
    const bay = inner * k1x - 1;
    const h = clamp((px * bax + py * bay) / (bax * bax + bay * bay), 0, radius);
    const dx = px - bax * h;
    const dy = py - bay * h;
    return Math.sqrt(dx * dx + dy * dy) * Math.sign(py * bax - px * bay);
  }

  function sdCapsule(x, y, ax, ay, bx, by, radius) {
    const pax = x - ax;
    const pay = y - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1);
    const dx = pax - bax * h;
    const dy = pay - bay * h;
    return Math.sqrt(dx * dx + dy * dy) - radius;
  }

  function smoothUnion(a, b, k) {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
    return mix(b, a, h) - k * h * (1 - h);
  }

  function smoothSubtract(a, b, k) {
    // removes b from a
    const h = clamp(0.5 - (0.5 * (a + b)) / k, 0, 1);
    return mix(a, -b, h) + k * h * (1 - h);
  }

  /** Rounded intersection of two distance fields (used by the wedge). */
  function roundIntersect(a, b, radius) {
    const ux = Math.max(a + radius, 0);
    const uy = Math.max(b + radius, 0);
    return Math.sqrt(ux * ux + uy * uy) + Math.min(Math.max(a + radius, b + radius), 0) - radius;
  }

  /** A capsule between a circle of radius r1 at the origin and one of radius r2 at height h (y pointing up). */
  function sdUnevenCapsule(x, y, r1, r2, h) {
    const px = Math.abs(x);
    const b = (r1 - r2) / h;
    const a = Math.sqrt(1 - b * b);
    const k = -b * px + a * y;
    if (k < 0) return Math.sqrt(px * px + y * y) - r1;
    if (k > a * h) return Math.sqrt(px * px + (y - h) * (y - h)) - r2;
    return px * a + y * b - r1;
  }

  const BEAN_TILT = (24 * Math.PI) / 180;

  const SHAPE_SDF = {
    // ---- the six candies
    bean(x, y) {
      // Kidney-shaped jelly bean, tilted as if tossed onto the board: a fat capsule with a soft dent along its back.
      const lx = x * Math.cos(BEAN_TILT) - y * Math.sin(BEAN_TILT);
      const ly = x * Math.sin(BEAN_TILT) + y * Math.cos(BEAN_TILT);
      const body = sdCapsule(lx, ly, -0.4, 0.05, 0.4, 0.05, 0.6);
      return smoothSubtract(body, sdCircle(lx, ly + 0.98, 0.56), 0.22);
    },
    lozenge(x, y) {
      // Cushion lozenge: wider than tall with softly squared sides.
      return sdRoundBox(x, y, 0.9, 0.7, 0.4);
    },
    lemon(x, y) {
      // Lemon drop: a plump round bottom rising to a soft point.
      return sdUnevenCapsule(x, -(y - 0.22), 0.69, 0.12, 1.0) - 0.04;
    },
    chiclet(x, y) {
      return sdRoundBox(x, y, 0.78, 0.78, 0.22);
    },
    ball(x, y) {
      return sdCircle(x, y, 0.84);
    },
    cluster(x, y) {
      let distance = Infinity;
      CLUSTER_GUMMIES.forEach(([cx, cy, radius]) => {
        distance = smoothUnion(distance === Infinity ? sdCircle(x - cx, y - cy, radius) : distance, sdCircle(x - cx, y - cy, radius), 0.08);
      });
      return distance;
    },
    // ---- icons, specials and blockers
    heart(x, y) {
      const scale = 1.16;
      return sdHeartRaw(x * scale, (-y + 0.74) * scale) / scale - 0.08;
    },
    wedge(x, y) {
      const circle = sdCircle(x, y - 0.3, 0.82);
      const flat = y - 0.3;
      return roundIntersect(circle, flat, 0.14) - 0.02;
    },
    diamond(x, y) {
      return sdRhombus(x, y, 0.76, 0.86) - 0.1;
    },
    cube(x, y) {
      return sdRoundBox(x, y, 0.72, 0.72, 0.24);
    },
    orb(x, y) {
      const body = sdCircle(x, y + 0.02, 0.78);
      return smoothSubtract(body, sdCircle(x, y + 0.86, 0.17), 0.09);
    },
    star(x, y) {
      return sdStar5(x, -y + 0.06, 0.8, 0.58) - 0.1;
    },
    bomb(x, y) {
      return sdCircle(x, y, 0.78);
    },
    square(x, y) {
      return sdRoundBox(x, y, 0.84, 0.84, 0.2);
    },
    tile(x, y) {
      return sdRoundBox(x, y, 0.94, 0.94, 0.2);
    },
    drop(x, y) {
      // Gold Drop icon: a teardrop with the point at the top.
      const body = sdCircle(x, y - 0.2, 0.62);
      const tip = Math.max(Math.abs(x) * 0.84 + (y + 0.05) * 0.54, -y - 0.86);
      return smoothUnion(body, tip, 0.12);
    },
    nut(x, y) {
      return smoothUnion(sdCircle(x, y - 0.12, 0.66), sdCircle(x, y + 0.58, 0.16), 0.42);
    },
    gumdrop(x, y) {
      const dome = sdCircle(x / 0.86, (y - 0.12) / 0.92, 0.82) * 0.86;
      return roundIntersect(dome, y - 0.6, 0.12);
    },
  };

  // ---------------------------------------------------------------- the studio panorama (reflections)
  function environment(rx, ry, rz) {
    // Stereographic coordinates of the reflected ray; y is down.
    const denominator = 1 + Math.max(rz, -0.95);
    const u = rx / denominator;
    const v = ry / denominator;
    let light = 0.04 + 0.16 * clamp(-ry, 0, 1);
    // Big softbox window up-left, with four panes (the crisp "window" highlight).
    const window_x = smoothstep(-0.78, -0.7, u) * (1 - smoothstep(-0.12, -0.05, u));
    const window_y = smoothstep(-0.8, -0.72, v) * (1 - smoothstep(-0.16, -0.09, v));
    const bar = 1 - 0.8 * ((1 - smoothstep(0.0, 0.022, Math.abs(u + 0.41))) + (1 - smoothstep(0.0, 0.022, Math.abs(v + 0.44))));
    light += 4.6 * window_x * window_y * clamp(bar, 0, 1);
    // A dim strip light on the right for a second, softer rim.
    light += 0.9 * smoothstep(0.55, 0.7, u) * (1 - smoothstep(0.85, 0.98, u)) * smoothstep(-0.6, -0.4, v) * (1 - smoothstep(0.3, 0.5, v));
    return light;
  }

  // ---------------------------------------------------------------- the shader

  /**
   * Shades one sprite. spec: { shape, base, highlight, shadow, theme, special?, colorblind?, seed?, kind? }.
   * Returns { width, height, data: Uint8ClampedArray (RGBA, not premultiplied) }.
   */
  function shadeSprite(spec, size) {
    const theme = THEMES[spec.theme] || THEMES.gummy;
    const width = size;
    const height = size;
    const pixel = 2 / size;
    const data = new Uint8ClampedArray(width * height * 4);
    const sdf = typeof spec.shape === 'function' ? spec.shape : SHAPE_SDF[spec.shape];
    const base = hexToLinear(spec.base);
    const high = hexToLinear(spec.highlight || spec.base);
    const deep = hexToLinear(spec.shadow || spec.base);
    const seed = spec.seed || 7;
    const detail = spec.detail || theme.detail;
    const material = Object.assign({}, theme, spec.material || {});
    const bevel = spec.bevel || 0.42;
    const height_scale = (spec.height_scale || 0.62) * material.height;
    const distances = new Float32Array(width * height);
    const heights = new Float32Array(width * height);

    // Pass 1: distance and pillow height.
    for (let row = 0; row < height; row += 1) {
      const y = -1 + (row + 0.5) * pixel;
      for (let col = 0; col < width; col += 1) {
        const x = -1 + (col + 0.5) * pixel;
        const index = row * width + col;
        const distance = sdf(x, y);
        distances[index] = distance;
        if (distance < 0) {
          const t = Math.min(-distance / bevel, 1);
          let h = Math.sqrt(1 - (1 - t) * (1 - t));
          h = h * 0.84 + 0.16 * Math.max(0, 1 - (x * x + y * y) * 0.9);
          if (spec.height_detail) h += spec.height_detail(x, y, -distance);
          heights[index] = h;
        }
      }
    }

    // Soften the height field (removes creases along the shape's medial axis, so a diamond stays a rounded diamond).
    const blur_radius = Math.max(1, Math.round(size * (spec.smooth === undefined ? 0.035 : spec.smooth)));
    if (spec.smooth !== 0) {
      for (let iteration = 0; iteration < 2; iteration += 1) boxBlur(heights, width, height, blur_radius, distances);
    }

    // Studio lights (y down): warm key from upper-left, colored fill from lower-right.
    const key = normalize3(-0.55, -0.7, 0.75);
    const fill = normalize3(0.6, 0.55, 0.45);
    const half_key = normalize3(key[0], key[1], key[2] + 1);
    const glitter = seededRandom(seed * 31 + 5);
    const bubbles = [];
    if (detail === 'bubbles') {
      for (let index = 0; index < 7; index += 1) bubbles.push({ x: (glitter() - 0.5) * 1.0, y: (glitter() - 0.3) * 0.9, r: 0.035 + glitter() * 0.05 });
    }

    // Pass 2: lighting.
    for (let row = 0; row < height; row += 1) {
      const y = -1 + (row + 0.5) * pixel;
      for (let col = 0; col < width; col += 1) {
        const x = -1 + (col + 0.5) * pixel;
        const index = row * width + col;
        const out = index * 4;
        const distance = distances[index];
        const coverage = clamp(0.5 - distance / pixel, 0, 1);
        if (coverage <= 0) {
          // Contact shadow: the shape's distance field, offset down and blurred.
          if (!spec.no_shadow) {
            const shadow_distance = sdf(x * 0.97, (y - 0.09) * 0.97);
            const shadow = 0.34 * Math.exp(-Math.max(0, shadow_distance) / 0.07) * smoothstep(-0.2, 0.5, y);
            if (shadow > 0.004) {
              data[out] = 46;
              data[out + 1] = 14;
              data[out + 2] = 52;
              data[out + 3] = Math.round(shadow * 255);
            }
          }
          continue;
        }
        const left = heights[row * width + Math.max(0, col - 1)];
        const right = heights[row * width + Math.min(width - 1, col + 1)];
        const up = heights[Math.max(0, row - 1) * width + col];
        const down = heights[Math.min(height - 1, row + 1) * width + col];
        const h = heights[index];
        let nx = (-(right - left) / (2 * pixel)) * height_scale;
        let ny = (-(down - up) / (2 * pixel)) * height_scale;
        let nz = 1;
        const normal_length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= normal_length;
        ny /= normal_length;
        nz /= normal_length;

        // Albedo: thin (edge) regions lighter and more saturated, thick regions deeper (subsurface look).
        const thickness = h;
        const thick = smoothstep(0.1, 0.95, thickness);
        let ar = mix(mix(base[0], high[0], 0.28), mix(base[0], deep[0], 0.38), thick);
        let ag = mix(mix(base[1], high[1], 0.28), mix(base[1], deep[1], 0.38), thick);
        let ab = mix(mix(base[2], high[2], 0.28), mix(base[2], deep[2], 0.38), thick);
        let spec_scale = 1;
        let paint = null;
        if (spec.albedo) {
          paint = spec.albedo(x, y, -distance, h);
          if (paint) {
            ar = mix(ar, paint[0], paint[3]);
            ag = mix(ag, paint[1], paint[3]);
            ab = mix(ab, paint[2], paint[3]);
            if (paint.length > 4) spec_scale = paint[4];
          }
        }
        // Theme surface detail.
        if (detail === 'swirl') {
          const angle = Math.atan2(y, x);
          const radius = Math.sqrt(x * x + y * y);
          const swirl = 0.5 + 0.5 * Math.sin(angle * 3 + radius * 9 + seed);
          const amount = 0.16 * smoothstep(0.55, 1, swirl) * smoothstep(0.05, 0.4, -distance);
          ar = mix(ar, high[0], amount);
          ag = mix(ag, high[1], amount);
          ab = mix(ab, high[2], amount);
        } else if (detail === 'sugar') {
          const grain = hash2(col, row, seed);
          const sugar = 0.1 + 0.12 * grain;
          ar = mix(ar, 1, sugar * 0.6);
          ag = mix(ag, 1, sugar * 0.6);
          ab = mix(ab, 1, sugar * 0.6);
        } else if (detail === 'bubbles') {
          for (let bubble_index = 0; bubble_index < bubbles.length; bubble_index += 1) {
            const bubble = bubbles[bubble_index];
            const bx = x - bubble.x;
            const by = y - bubble.y;
            const bubble_distance = Math.sqrt(bx * bx + by * by);
            if (bubble_distance < bubble.r && -distance > 0.12) {
              const ring = smoothstep(bubble.r * 0.55, bubble.r, bubble_distance);
              ar = mix(ar, high[0], 0.35 * ring);
              ag = mix(ag, high[1], 0.35 * ring);
              ab = mix(ab, high[2], 0.35 * ring);
              if (bx < -bubble.r * 0.2 && by < -bubble.r * 0.2) {
                ar += 0.25;
                ag += 0.25;
                ab += 0.25;
              }
            }
          }
        }

        // Diffuse: wrap-around key, tinted fill, ambient.
        const key_dot = nx * key[0] + ny * key[1] + nz * key[2];
        const fill_dot = nx * fill[0] + ny * fill[1] + nz * fill[2];
        const key_light = clamp((key_dot + 0.4) / 1.4, 0, 1);
        const fill_light = clamp((fill_dot + 0.6) / 1.6, 0, 1) * 0.3;
        const ambient = 0.1 + 0.06 * (1 - clamp(ny, -1, 1));
        let r = ar * (key_light * 1.0 + ambient) + fill_light * mix(ar, high[0], 0.35);
        let g = ag * (key_light * 0.96 + ambient) + fill_light * mix(ag, high[1], 0.35);
        let b = ab * (key_light * 0.9 + ambient) + fill_light * mix(ab, high[2], 0.35);

        // Subsurface glow in the lower third and through thin edges.
        const glow = material.subsurface * (0.3 * smoothstep(0.05, 0.8, y) * (1 - 0.55 * thickness) + material.translucency * 0.22 * (1 - thickness));
        r += mix(base[0], high[0], 0.5) * glow;
        g += mix(base[1], high[1], 0.5) * glow * 0.9;
        b += mix(base[2], high[2], 0.5) * glow * 0.78;

        // Specular: tight wet highlight and a wide sheen, then the studio reflection with Fresnel.
        const half_dot = Math.max(0, nx * half_key[0] + ny * half_key[1] + nz * half_key[2]);
        const tight = Math.pow(half_dot, material.spec_power) * material.spec_tight * spec_scale;
        const wide = Math.pow(half_dot, 8) * material.spec_wide * spec_scale;
        const fresnel = material.fresnel0 + (1 - material.fresnel0) * Math.pow(1 - clamp(nz, 0, 1), 5);
        const rx = 2 * nz * nx;
        const ry = 2 * nz * ny;
        const rz = 2 * nz * nz - 1;
        const reflection = environment(rx, ry, rz) * (material.env * 0.4 + fresnel * 1.1) * spec_scale;
        r += tight + wide + reflection;
        g += tight + wide + reflection * 0.98;
        b += tight * 0.97 + wide + reflection * 0.95;

        // Sugar glitter specks catch the light.
        if (detail === 'sugar' && hash2(col * 3 + 1, row * 7 + 2, seed) > 0.985 && -distance > 0.05) {
          const sparkle = 0.6 + 1.4 * half_dot;
          r += sparkle;
          g += sparkle;
          b += sparkle * 0.95;
        }

        // Ambient occlusion near the rim and an inset darker outline.
        const outline_width = spec.colorblind ? 0.11 : 0.055;
        const rim = smoothstep(0, outline_width, -distance);
        const darken = (spec.colorblind ? 0.55 : 0.7) + (spec.colorblind ? 0.45 : 0.3) * rim;
        r *= darken;
        g *= darken;
        b *= darken;

        // Tone map (soft shoulder), saturation and gamma.
        r = 1 - Math.exp(-r * 1.25);
        g = 1 - Math.exp(-g * 1.25);
        b = 1 - Math.exp(-b * 1.25);
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = luma + (r - luma) * material.saturation;
        g = luma + (g - luma) * material.saturation;
        b = luma + (b - luma) * material.saturation;
        let alpha = coverage * (spec.opacity === undefined ? 1 : spec.opacity(x, y, -distance, h));
        // Blend the anti-aliased edge over the contact shadow.
        data[out] = Math.round(255 * Math.pow(clamp(r, 0, 1), 1 / 2.2));
        data[out + 1] = Math.round(255 * Math.pow(clamp(g, 0, 1), 1 / 2.2));
        data[out + 2] = Math.round(255 * Math.pow(clamp(b, 0, 1), 1 / 2.2));
        if (alpha < 1 && !spec.no_shadow) {
          const shadow_distance = sdf(x * 0.97, (y - 0.09) * 0.97);
          const shadow = 0.34 * Math.exp(-Math.max(0, shadow_distance) / 0.07) * smoothstep(-0.2, 0.5, y);
          alpha = alpha + shadow * (1 - alpha);
        }
        data[out + 3] = Math.round(255 * clamp(alpha, 0, 1));
      }
    }
    return { width, height, data };
  }

  /** Separable box blur of the interior heights (pixels outside the shape keep height 0). */
  function boxBlur(values, width, height, radius, distances) {
    const scratch = new Float32Array(values.length);
    const window_size = radius * 2 + 1;
    for (let row = 0; row < height; row += 1) {
      let sum = 0;
      const offset = row * width;
      for (let col = -radius; col <= radius; col += 1) sum += values[offset + Math.min(width - 1, Math.max(0, col))];
      for (let col = 0; col < width; col += 1) {
        scratch[offset + col] = sum / window_size;
        sum += values[offset + Math.min(width - 1, col + radius + 1)] - values[offset + Math.max(0, col - radius)];
      }
    }
    for (let col = 0; col < width; col += 1) {
      let sum = 0;
      for (let row = -radius; row <= radius; row += 1) sum += scratch[Math.min(height - 1, Math.max(0, row)) * width + col];
      for (let row = 0; row < height; row += 1) {
        const index = row * width + col;
        values[index] = distances[index] < 0 ? sum / window_size : 0;
        sum += scratch[Math.min(height - 1, row + radius + 1) * width + col] - scratch[Math.max(0, row - radius) * width + col];
      }
    }
  }

  function normalize3(x, y, z) {
    const length = Math.sqrt(x * x + y * y + z * z);
    return [x / length, y / length, z / length];
  }

  // ---------------------------------------------------------------- sprite recipes

  function lin(hex) {
    return hexToLinear(hex);
  }

  function paintOf(hex, amount, spec_scale) {
    const color = lin(hex);
    return spec_scale === undefined ? [color[0], color[1], color[2], amount] : [color[0], color[1], color[2], amount, spec_scale];
  }

  /** Shape details painted into the albedo: the gum square's bevelled top face. */
  function candyAlbedo(candy) {
    if (candy.shape === 'chiclet') {
      const high = lin(candy.highlight);
      return (x, y) => {
        const face = sdRoundBox(x, y, 0.5, 0.5, 0.16);
        return face < 0 ? [high[0], high[1], high[2], 0.14 * smoothstep(0, 0.06, -face)] : null;
      };
    }
    return null;
  }

  /** Shape details in the height field: the square's raised face and the gumball's pressed seam. */
  function candyHeightDetail(candy) {
    if (candy.shape === 'chiclet') {
      return (x, y) => 0.06 * smoothstep(0.02, -0.06, sdRoundBox(x, y, 0.52, 0.52, 0.16));
    }
    if (candy.shape === 'ball') {
      return (x, y) => -0.025 * (1 - smoothstep(0, 0.035, Math.abs(y + 0.02))) * smoothstep(0.75, 0.55, Math.abs(x));
    }
    return null;
  }

  function stripeAlbedo(direction, inner) {
    const white = [1, 1, 1];
    return (x, y, depth, h) => {
      const inherited = inner ? inner(x, y, depth, h) : null;
      const along = direction === 'row' ? y : x;
      const band = Math.abs(((along * 3.1 + 10.5) % 1) - 0.5);
      const stripe = 1 - smoothstep(0.17, 0.24, band);
      if (stripe > 0.01 && depth > 0.02) return [white[0], white[1], white[2], 0.82 * stripe, 1.15];
      return inherited;
    };
  }

  function stripeHeight(direction, inner) {
    return (x, y, depth) => {
      const base = inner ? inner(x, y, depth) : 0;
      const along = direction === 'row' ? y : x;
      const band = Math.abs(((along * 3.1 + 10.5) % 1) - 0.5);
      return base + 0.05 * (1 - smoothstep(0.15, 0.26, band)) * smoothstep(0, 0.12, depth);
    };
  }

  /** Every sprite recipe for a theme: { key: spec } (all keys used by the renderer and the UI). */
  function recipes(theme_id, colorblind) {
    const list = {};
    CANDIES.forEach((candy) => {
      const albedo = candyAlbedo(candy);
      const height_detail = candyHeightDetail(candy);
      const common = { shape: candy.shape, base: candy.base, highlight: candy.highlight, shadow: candy.shadow, theme: theme_id, seed: 11 + candy.id * 17, colorblind, symbol: colorblind ? candy.symbol : null };
      // The cluster's lobes would each catch the studio window as a separate glint; a smoother surface gives one shine.
      if (candy.shape === 'cluster') common.smooth = 0.09;
      list[`candy:${candy.id}`] = Object.assign({}, common, { albedo, height_detail });
      list[`stripe_row:${candy.id}`] = Object.assign({}, common, { albedo: stripeAlbedo('row', albedo), height_detail: stripeHeight('row', height_detail) });
      list[`stripe_col:${candy.id}`] = Object.assign({}, common, { albedo: stripeAlbedo('col', albedo), height_detail: stripeHeight('col', height_detail) });
      list[`wrapped:${candy.id}`] = wrappedRecipe(candy, theme_id, colorblind);
    });
    list.bomb = bombRecipe(theme_id);
    for (let layers = 1; layers <= 5; layers += 1) list[`frosting:${layers}`] = frostingRecipe(layers, theme_id);
    list.cocoa = cocoaRecipe(theme_id);
    list.cherry = cherryRecipe(theme_id);
    list.hazelnut = hazelnutRecipe(theme_id);
    list.cage = cageRecipe();
    list.swirl = swirlRecipe(theme_id);
    list.gift = giftRecipe(theme_id);
    for (let layers = 1; layers <= 3; layers += 1) list[`popcorn:${layers}`] = popcornRecipe(layers, theme_id);
    list['chest:1'] = chestRecipe(1, theme_id);
    list['chest:2'] = chestRecipe(2, theme_id);
    list.mixer = mixerRecipe(theme_id);
    list['jelly:1'] = jellyRecipe(1);
    list['jelly:2'] = jellyRecipe(2);
    return list;
  }

  function wrappedRecipe(candy, theme_id, colorblind) {
    const film_base = lin(candy.base);
    const film_high = lin(candy.highlight);
    const film = [mix(film_base[0], film_high[0], 0.6), mix(film_base[1], film_high[1], 0.6), mix(film_base[2], film_high[2], 0.6)];
    const inner = SHAPE_SDF[candy.shape];
    const wrapper = (x, y) => {
      const body = sdRoundBox(x, y, 0.64, 0.6, 0.22);
      // Twisted ends: a bow-tie fan on each side.
      const ex = Math.abs(x) - 0.62;
      const fan = Math.max(Math.abs(y) - 0.08 - ex * 0.9, ex - 0.32);
      return smoothUnion(body, Math.max(fan, -ex), 0.05);
    };
    return {
      shape: wrapper, base: candy.base, highlight: candy.highlight, shadow: candy.shadow, theme: theme_id, seed: 41 + candy.id, colorblind, symbol: colorblind ? candy.symbol : null,
      bevel: 0.3,
      height_detail: (x, y) => {
        const inside = inner(x / 0.74, y / 0.74);
        const crinkle = 0.035 * Math.sin(x * 23 + Math.sin(y * 9) * 2) * Math.sin(y * 19 + x * 5);
        return (inside < 0 ? 0.18 * smoothstep(0, 0.2, -inside) : 0) + crinkle;
      },
      albedo: (x, y) => {
        const inside = inner(x / 0.74, y / 0.74);
        if (inside < 0) return null;
        const tie = Math.abs(x) > 0.58 ? 0.25 : 0;
        return [film[0], film[1], film[2], 0.72 + tie, 1.3];
      },
      opacity: (x, y) => (inner(x / 0.74, y / 0.74) < 0 ? 1 : 0.82),
    };
  }

  function bombRecipe(theme_id) {
    const sprinkle_colors = CANDIES.map((candy) => lin(candy.highlight)).concat([lin('#ffffff')]);
    const random = seededRandom(909);
    const sprinkles = [];
    for (let index = 0; index < 30; index += 1) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * 0.66;
      sprinkles.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angle: random() * Math.PI, color: sprinkle_colors[index % sprinkle_colors.length] });
    }
    const hit = (x, y) => {
      for (let index = 0; index < sprinkles.length; index += 1) {
        const sprinkle = sprinkles[index];
        const ca = Math.cos(sprinkle.angle);
        const sa = Math.sin(sprinkle.angle);
        const ax = sprinkle.x - ca * 0.06;
        const ay = sprinkle.y - sa * 0.06;
        if (sdCapsule(x, y, ax, ay, sprinkle.x + ca * 0.06, sprinkle.y + sa * 0.06, 0.028) < 0) return sprinkle;
      }
      return null;
    };
    return {
      shape: 'bomb', base: '#5b2d18', highlight: '#9a5532', shadow: '#2a1008', theme: theme_id, seed: 13, material: { subsurface: 0.15, translucency: 0.05, spec_tight: 1.6, env: 0.6, detail: 'none' }, detail: 'none',
      height_detail: (x, y) => (hit(x, y) ? 0.06 : 0),
      albedo: (x, y) => {
        const sprinkle = hit(x, y);
        return sprinkle ? [sprinkle.color[0], sprinkle.color[1], sprinkle.color[2], 1, 0.8] : null;
      },
    };
  }

  const FROSTING_COLORS = ['#fff6fa', '#ffe0ee', '#ffc6e0', '#f7add3', '#ea93c4'];

  function frostingRecipe(layers, theme_id) {
    const icing = FROSTING_COLORS[layers - 1];
    const ring_color = lin('#ffffff');
    return {
      shape: 'square', base: icing, highlight: '#ffffff', shadow: FROSTING_COLORS[Math.min(4, layers)], theme: theme_id, seed: 70 + layers,
      material: { subsurface: 0.3, translucency: 0.1, spec_power: 30, spec_tight: 0.6, env: 0.2, saturation: 1.05 }, detail: 'sugar', bevel: 0.36, smooth: 0.012,
      height_detail: (x, y) => {
        // One raised tier per layer, plus a scalloped drip at the top.
        let tiers = 0;
        for (let tier = 1; tier < layers; tier += 1) {
          const size = 0.84 - tier * 0.13;
          tiers += 0.07 * smoothstep(0.02, -0.03, sdRoundBox(x, y, size, size, 0.16));
        }
        const drip = 0.04 * smoothstep(0.02, -0.02, y + 0.5 - 0.08 * Math.cos(x * 9));
        return tiers + drip;
      },
      albedo: (x, y) => {
        for (let tier = 1; tier < layers; tier += 1) {
          const size = 0.84 - tier * 0.13;
          const edge = Math.abs(sdRoundBox(x, y, size, size, 0.16));
          if (edge < 0.018) return [ring_color[0], ring_color[1], ring_color[2], 0.45];
        }
        return null;
      },
    };
  }

  function cocoaRecipe(theme_id) {
    return {
      shape: 'square', base: '#7a4021', highlight: '#b0683a', shadow: '#3a1a0a', theme: theme_id, seed: 91,
      material: { subsurface: 0.1, translucency: 0.02, spec_power: 70, spec_tight: 1.3, env: 0.5, detail: 'none' }, detail: 'none', bevel: 0.32,
      height_detail: (x, y) => {
        const angle = Math.atan2(y, x);
        const radius = Math.sqrt(x * x + y * y);
        return 0.07 * Math.sin(angle * 2 + radius * 13) * smoothstep(0.75, 0.2, radius);
      },
    };
  }

  function cherryRecipe(theme_id) {
    const stem = lin('#5b8a2b');
    const shape = (x, y) => {
      const fruit = Math.min(sdCircle(x + 0.3, y - 0.28, 0.38), sdCircle(x - 0.3, y - 0.36, 0.38));
      const stems = Math.min(sdCapsule(x, y, -0.3, -0.06, 0.12, -0.72, 0.045), sdCapsule(x, y, 0.3, 0.02, 0.12, -0.72, 0.045));
      const leaf = sdCircle((x - 0.36) / 1.7, (y + 0.66) / 0.8, 0.13);
      return Math.min(fruit, stems, leaf);
    };
    return {
      shape, base: '#e8173e', highlight: '#ff7c93', shadow: '#8c0620', theme: theme_id, seed: 55, bevel: 0.3,
      albedo: (x, y) => {
        const fruit = Math.min(sdCircle(x + 0.3, y - 0.28, 0.38), sdCircle(x - 0.3, y - 0.36, 0.38));
        return fruit > 0 ? [stem[0], stem[1], stem[2], 1, 0.5] : null;
      },
    };
  }

  function hazelnutRecipe(theme_id) {
    const cap = lin('#d9a76a');
    return {
      shape: 'nut', base: '#9c5a2a', highlight: '#d08a4c', shadow: '#55280d', theme: theme_id, seed: 66,
      material: { subsurface: 0.15, translucency: 0.05, spec_power: 40, spec_tight: 0.8, detail: 'none' }, detail: 'none',
      albedo: (x, y) => {
        // The rough, paler scar at the base of the nut.
        const scar = smoothstep(0.42, 0.52, y + 0.06 * Math.sin(x * 11));
        if (scar <= 0) return null;
        const grain = hash2(Math.round(x * 60), Math.round(y * 60), 66);
        return [cap[0] * (0.85 + 0.3 * grain), cap[1] * (0.85 + 0.3 * grain), cap[2] * (0.85 + 0.3 * grain), scar * 0.9, 0.3];
      },
      height_detail: (x, y) => 0.025 * Math.sin(x * 7 + y * 2) * Math.sin(y * 16),
    };
  }

  /** Taffy Swirl: a chewy disc with a two-tone spiral, raised along the spiral's seam. */
  function swirlRecipe(theme_id) {
    const cream = lin('#fff4f8');
    const band = (x, y) => {
      const angle = Math.atan2(y, x);
      const radius = Math.sqrt(x * x + y * y);
      return Math.sin(angle * 2 - radius * 11);
    };
    return {
      shape: (x, y) => sdCircle(x, y, 0.8), base: '#e8337a', highlight: '#ff8fbc', shadow: '#8f0f45', theme: theme_id, seed: 77, bevel: 0.42,
      material: { subsurface: 0.35, translucency: 0.12, spec_power: 50, spec_tight: 1.1, env: 0.45, detail: 'none' }, detail: 'none',
      height_detail: (x, y) => {
        const radius = Math.sqrt(x * x + y * y);
        return 0.05 * smoothstep(0.35, 0, Math.abs(band(x, y))) * smoothstep(0.8, 0.15, radius);
      },
      albedo: (x, y) => {
        const radius = Math.sqrt(x * x + y * y);
        if (radius < 0.09) return [cream[0], cream[1], cream[2], 1, 0.7];
        const white = smoothstep(-0.12, 0.12, band(x, y));
        return white > 0 ? [cream[0], cream[1], cream[2], white, 0.7] : null;
      },
    };
  }

  /** Gift Box: a glossy teal present with a golden ribbon and bow. */
  function giftRecipe(theme_id) {
    const ribbon = lin('#ffd54a');
    const ribbon_dark = lin('#e0a01a');
    const box = (x, y) => sdRoundBox(x, y - 0.14, 0.72, 0.62, 0.14);
    const bow = (x, y) => Math.min(sdCircle((x + 0.24) / 1.25, (y + 0.56) / 0.85, 0.2), sdCircle((x - 0.24) / 1.25, (y + 0.56) / 0.85, 0.2), sdCircle(x, y + 0.5, 0.12));
    const onRibbon = (x, y) => Math.abs(x) < 0.12 || Math.abs(y + 0.18) < 0.1;
    return {
      shape: (x, y) => smoothUnion(box(x, y), bow(x, y), 0.06), base: '#18b9b0', highlight: '#7ff0e6', shadow: '#086b66', theme: theme_id, seed: 83, bevel: 0.3,
      material: { subsurface: 0.15, translucency: 0.04, spec_power: 70, spec_tight: 1.4, env: 0.7, detail: 'none' }, detail: 'none',
      height_detail: (x, y) => (box(x, y) < 0 && onRibbon(x, y) ? 0.05 : 0),
      albedo: (x, y) => {
        if (bow(x, y) < 0.01 && y < -0.32) {
          const knot = sdCircle(x, y + 0.5, 0.12) < 0;
          const tone = knot ? ribbon_dark : ribbon;
          return [tone[0], tone[1], tone[2], 1, 0.6];
        }
        if (box(x, y) < 0 && onRibbon(x, y)) return [ribbon[0], ribbon[1], ribbon[2], 1, 0.6];
        return null;
      },
    };
  }


  /**
   * Popcorn: a red-and-white striped popcorn bucket. Each hit pops more corn: the heap on top grows from a small crown
   * (3 hits left) to a big overflowing cloud (1 hit left); the next hit bursts it into a Rainbow Drop.
   */
  function popcornRecipe(layers, theme_id) {
    const puff = lin('#fff6e2');
    const butter = lin('#ffc93a');
    const red = lin('#e8263f');
    const white = lin('#fff8f4');
    const heap_scale = [1.06, 0.92, 0.78][Math.max(1, Math.min(3, layers)) - 1];
    const bucket_top = -0.02;
    const bucket_bottom = 0.86;
    const halfWidth = (y) => 0.66 - (0.18 * (y - bucket_top)) / (bucket_bottom - bucket_top);
    const bucket = (x, y) => Math.max(Math.abs(x) - halfWidth(y), bucket_top - y, y - bucket_bottom) * 0.95;
    const heap = (x, y) => {
      let distance = Infinity;
      [[0, -0.34, 0.34], [-0.38, -0.12, 0.29], [0.38, -0.12, 0.29], [-0.2, -0.52, 0.26], [0.22, -0.5, 0.27], [0, -0.04, 0.3]].forEach(([cx, cy, radius]) => {
        const circle = sdCircle(x - cx * heap_scale, y - (cy - 0.04) * heap_scale, radius * heap_scale);
        distance = distance === Infinity ? circle : smoothUnion(distance, circle, 0.08);
      });
      return distance;
    };
    return {
      shape: (x, y) => smoothUnion(bucket(x, y), heap(x, y), 0.04), base: '#fff1dc', highlight: '#ffffff', shadow: '#c9a46a', theme: theme_id, seed: 101 + layers, bevel: 0.36,
      material: { subsurface: 0.3, translucency: 0.08, spec_power: 40, spec_tight: 0.9, env: 0.45, detail: 'none' }, detail: 'none',
      height_detail: (x, y) => (heap(x, y) < 0 && bucket(x, y) > 0 ? 0.05 * Math.sin(x * 19) * Math.sin(y * 17) : 0),
      albedo: (x, y) => {
        if (bucket(x, y) < 0 && heap(x, y) > 0.0) {
          const across = x / halfWidth(y);
          const stripe = Math.floor((across + 1) * 2.5) % 2 === 0;
          const tone = stripe ? red : white;
          return [tone[0], tone[1], tone[2], 1, 1.1];
        }
        // Round butter drops: some cells of a fine grid hold a soft dot.
        const gx = x * 11;
        const gy = y * 11;
        const fleck = hash2(Math.round(gx), Math.round(gy), 31 + layers);
        const spot = Math.hypot(gx - Math.round(gx), gy - Math.round(gy));
        if (fleck > 0.72 && spot < 0.32) return [butter[0], butter[1], butter[2], 0.85 * smoothstep(0.32, 0.18, spot), 0.8];
        return [puff[0], puff[1], puff[2], 0.6, 0.5];
      },
    };
  }

  /** Sugar Chest: a berry-pink treasure box with gold bands; one big gold padlock per lock still closed. */
  function chestRecipe(locks, theme_id) {
    const gold = lin('#ffd24a');
    const gold_dark = lin('#c98a10');
    const body = (x, y) => sdRoundBox(x, y - 0.06, 0.8, 0.68, 0.16);
    const lock_centers = locks >= 2 ? [[-0.32, 0.12], [0.32, 0.12]] : [[0, 0.12]];
    const padlock = (x, y) => Math.min(...lock_centers.map(([cx, cy]) => sdRoundBox(x - cx, y - cy, 0.2, 0.17, 0.06)));
    const shackle = (x, y) => Math.min(...lock_centers.map(([cx, cy]) => Math.abs(sdCircle(x - cx, y - cy + 0.2, 0.13)) - 0.04));
    return {
      shape: (x, y) => Math.min(body(x, y), Math.max(shackle(x, y), y - 0.05)), base: '#d42a7a', highlight: '#ff8cc0', shadow: '#7a0f42', theme: theme_id, seed: 111 + locks, bevel: 0.3,
      material: { subsurface: 0.15, translucency: 0.04, spec_power: 70, spec_tight: 1.3, env: 0.6, detail: 'none' }, detail: 'none',
      height_detail: (x, y) => (padlock(x, y) < 0 ? 0.1 : Math.abs(y + 0.26) < 0.06 ? 0.04 : 0),
      albedo: (x, y) => {
        if (padlock(x, y) < 0) {
          const keyhole = Math.min(...lock_centers.map(([cx, cy]) => Math.min(sdCircle(x - cx, y - cy + 0.03, 0.05), sdRoundBox(x - cx, y - cy - 0.06, 0.02, 0.07, 0.01))));
          const tone = keyhole < 0 ? gold_dark : gold;
          return [tone[0], tone[1], tone[2], 1, 1.2];
        }
        if (shackle(x, y) < 0 && body(x, y) > 0) return [gold[0], gold[1], gold[2], 1, 1.2];
        if (Math.abs(y + 0.26) < 0.06 || Math.abs(x) > 0.66) return [gold[0], gold[1], gold[2], 1, 1.1];
        return null;
      },
    };
  }

  /** Candy Mixer: a big steel mixing bowl brimming with pink-and-cream batter, a whisk standing in it. */
  function mixerRecipe(theme_id) {
    const cream = lin('#fff1e4');
    const pink = lin('#ff8ec2');
    const steel = lin('#dfe9f5');
    const bowl = (x, y) => Math.max(sdCircle(x, y + 0.08, 0.94), -(y - 0.02));
    const batter = (x, y) => sdCircle(x / 1.02, (y - 0.02) / 0.42, 0.9);
    const whisk = (x, y) => Math.min(sdCapsule(x, y, 0.18, -0.12, 0.46, -0.86, 0.07), Math.abs(sdCircle((x - 0.2) / 0.55, (y + 0.1) / 1.0, 0.26)) - 0.035);
    return {
      shape: (x, y) => Math.min(smoothUnion(bowl(x, y), batter(x, y), 0.05), whisk(x, y)), base: '#7fa6cc', highlight: '#eef6ff', shadow: '#33506e', theme: 'hard', seed: 121, bevel: 0.32,
      material: { subsurface: 0.05, translucency: 0.02, spec_power: 90, spec_tight: 1.8, env: 1.0, detail: 'none' }, detail: 'none',
      height_detail: (x, y) => (y < 0.04 && batter(x, y) < 0 ? 0.06 * Math.sin(Math.atan2(y, x) * 3 + Math.sqrt(x * x + y * y) * 9) : 0),
      albedo: (x, y) => {
        if (whisk(x, y) < 0) return [steel[0], steel[1], steel[2], 1, 1.6];
        if (!(y < 0.04 && batter(x, y) < 0)) return null;
        const band = Math.sin(Math.atan2(y, x) * 3 + Math.sqrt(x * x + y * y) * 9);
        const tone = band > 0 ? pink : cream;
        return [tone[0], tone[1], tone[2], 1, 0.6];
      },
    };
  }

  function cageRecipe() {
    const bars = (x, y) => {
      let distance = Infinity;
      for (const offset of [-0.42, 0.42]) {
        distance = Math.min(distance, sdCapsule(x, y, offset, -0.86, offset, 0.86, 0.07));
        distance = Math.min(distance, sdCapsule(x, y, -0.86, offset, 0.86, offset, 0.07));
      }
      return distance;
    };
    return { shape: bars, base: '#f3b23a', highlight: '#ffe7a3', shadow: '#a8670b', theme: 'hard', seed: 3, bevel: 0.07, height_scale: 0.4, smooth: 0, material: { env: 0.9, spec_tight: 1.6 } };
  }

  function jellyRecipe(layers) {
    // Bright, glossy jelly that reads at a glance against the deep-blue board; thick jelly is deeper and has an inner rim.
    const deep = layers === 2;
    const rim = lin('#ffffff');
    return {
      shape: 'tile', base: deep ? '#f0329a' : '#ff74c6', highlight: '#ffe0f1', shadow: deep ? '#a3105e' : '#d8418f', theme: 'gummy', seed: 21 + layers, no_shadow: true,
      bevel: 0.3, height_scale: 0.45, detail: 'none', material: { spec_tight: 0.9, env: 0.55 },
      albedo: deep ? (x, y) => (Math.abs(sdRoundBox(x, y, 0.66, 0.66, 0.16)) < 0.035 ? [rim[0], rim[1], rim[2], 0.55] : null) : undefined,
      opacity: () => (deep ? 0.95 : 0.88),
    };
  }

  /** UI icons rendered by the same shader: heart (lives), Gold Drop, star. */
  function iconRecipe(kind) {
    if (kind === 'heart') return { shape: 'heart', base: '#ff3b6b', highlight: '#ff9db5', shadow: '#b3123f', theme: 'gummy', seed: 5 };
    if (kind === 'gold') return { shape: 'drop', base: '#ffc12e', highlight: '#fff0a6', shadow: '#c27a00', theme: 'hard', seed: 8, material: { env: 1.0, spec_tight: 1.8, subsurface: 0.3 } };
    if (kind === 'star') return { shape: 'star', base: '#ffd23f', highlight: '#fff3a8', shadow: '#d08a00', theme: 'hard', seed: 9, material: { env: 0.9, spec_tight: 1.6 } };
    if (kind === 'star_empty') return { shape: 'star', base: '#c9b8d6', highlight: '#efe6f5', shadow: '#8e7aa0', theme: 'sprinkle', seed: 10 };
    if (kind === 'pip') return { shape: 'gumdrop', base: '#46d6b4', highlight: '#b8f7e6', shadow: '#169378', theme: 'sprinkle', seed: 12, bevel: 0.5 };
    return null;
  }

  // ---------------------------------------------------------------- colour-blind symbols (white, drawn with canvas)
  function drawSymbol(context, symbol, cx, cy, radius) {
    context.save();
    context.fillStyle = 'rgba(255,255,255,0.95)';
    context.strokeStyle = 'rgba(40,10,50,0.55)';
    context.lineWidth = Math.max(1, radius * 0.18);
    context.beginPath();
    if (symbol === 'circle') context.arc(cx, cy, radius * 0.7, 0, Math.PI * 2);
    else if (symbol === 'square') context.rect(cx - radius * 0.6, cy - radius * 0.6, radius * 1.2, radius * 1.2);
    else if (symbol === 'diamond') {
      context.moveTo(cx, cy - radius);
      context.lineTo(cx + radius * 0.75, cy);
      context.lineTo(cx, cy + radius);
      context.lineTo(cx - radius * 0.75, cy);
    } else if (symbol === 'wedge') {
      context.moveTo(cx - radius, cy + radius * 0.45);
      context.arc(cx, cy + radius * 0.45, radius, Math.PI, 0);
    } else if (symbol === 'star') {
      for (let point = 0; point < 10; point += 1) {
        const angle = -Math.PI / 2 + (point * Math.PI) / 5;
        const reach = point % 2 === 0 ? radius : radius * 0.45;
        context.lineTo(cx + Math.cos(angle) * reach, cy + Math.sin(angle) * reach);
      }
    } else {
      context.moveTo(cx, cy + radius * 0.85);
      context.bezierCurveTo(cx - radius * 1.4, cy - radius * 0.2, cx - radius * 0.5, cy - radius * 1.1, cx, cy - radius * 0.35);
      context.bezierCurveTo(cx + radius * 0.5, cy - radius * 1.1, cx + radius * 1.4, cy - radius * 0.2, cx, cy + radius * 0.85);
    }
    context.closePath();
    context.stroke();
    context.fill();
    context.restore();
  }

  // ---------------------------------------------------------------- canvas side

  function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function spriteToCanvas(spec, size) {
    const shaded = shadeSprite(spec, size);
    const canvas = createCanvas(size, size);
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    image.data.set(shaded.data);
    context.putImageData(image, 0, 0);
    if (spec.symbol) drawSymbol(context, spec.symbol, size * 0.5, size * 0.52, size * 0.13);
    return canvas;
  }

  /**
   * The renderer's sprite cache. configure(cell_px, theme, colorblind, dpr) sets the resolution (at most 256 px) and the
   * material; sprites are shaded on first use, prepare(keys) shades a list now, and warm(keys) shades a list in small
   * background slices (a few milliseconds per frame) so the first special candy of a level never stalls an animation.
   */
  function createSpriteCache() {
    let sprites = {};
    let specs = {};
    let size = 0;
    let signature = '';
    let build_ms = 0;
    let queue = [];
    let warm_timer = 0;
    function configure(cell_px, theme_id, colorblind, device_ratio) {
      const next_size = Math.min(256, Math.max(48, Math.ceil((cell_px * (device_ratio || 1)) / 16) * 16));
      const theme = THEMES[theme_id] ? theme_id : 'gummy';
      const next_signature = `${next_size}|${theme}|${colorblind ? 1 : 0}`;
      if (next_signature === signature) return false;
      signature = next_signature;
      size = next_size;
      sprites = {};
      specs = recipes(theme, !!colorblind);
      queue = [];
      build_ms = 0;
      return true;
    }
    function build(key) {
      if (!sprites[key] && specs[key]) {
        const started = Date.now();
        sprites[key] = spriteToCanvas(specs[key], size);
        build_ms += Date.now() - started;
      }
      return sprites[key];
    }
    function keyFor(kind, color, special, layers) {
      if (kind === 'candy') {
        if (special === 'bomb') return 'bomb';
        if (special === 'stripe_row' || special === 'stripe_col') return `${special}:${color}`;
        if (special === 'wrapped' || special === 'wrapped_armed' || special === 'wrapped_big_armed') return `wrapped:${color}`;
        return `candy:${color}`;
      }
      if (kind === 'frosting') return `frosting:${Math.max(1, Math.min(5, layers || 1))}`;
      if (kind === 'popcorn') return `popcorn:${Math.max(1, Math.min(3, layers || 3))}`;
      if (kind === 'chest') return `chest:${layers >= 2 ? 2 : 1}`;
      if (kind === 'jelly') return `jelly:${layers >= 2 ? 2 : 1}`;
      return specs[kind] ? kind : 'candy:0';
    }
    function get(kind, color, special, layers) {
      return build(keyFor(kind, color, special, layers));
    }
    function prepare(keys) {
      keys.forEach(build);
    }
    function warm(keys) {
      keys.forEach((key) => {
        if (!sprites[key] && specs[key] && queue.indexOf(key) < 0) queue.push(key);
      });
      if (warm_timer || !queue.length) return;
      const slice = () => {
        warm_timer = 0;
        const started = Date.now();
        while (queue.length && Date.now() - started < 10) build(queue.shift());
        if (queue.length) warm_timer = setTimeout(slice, 24);
      };
      warm_timer = setTimeout(slice, 24);
    }
    return {
      configure,
      get,
      keyFor,
      prepare,
      warm,
      byKey: build,
      get buildMs() {
        return build_ms;
      },
      get size() {
        return size;
      },
      get pending() {
        return queue.length;
      },
    };
  }

  /** Atlas keys a level needs: every candy variant of its palette, plus the blockers on its board. */
  function keysForLevel(palette, kinds) {
    const keys = [];
    palette.forEach((color) => keys.push(`candy:${color}`));
    const extras = [];
    palette.forEach((color) => extras.push(`stripe_row:${color}`, `stripe_col:${color}`, `wrapped:${color}`));
    extras.push('bomb');
    (kinds || []).forEach((kind) => keys.push(kind));
    return { now: keys, later: extras };
  }

  // ---------------------------------------------------------------- small canvas helpers shared by RENDER and UI
  function hexToRgb(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgba(hex, alpha) {
    const rgb = hexToRgb(hex);
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
  }

  function mixHex(first_hex, second_hex, amount) {
    const first = hexToRgb(first_hex);
    const second = hexToRgb(second_hex);
    const channel = (index) => Math.round(first[index] + (second[index] - first[index]) * amount).toString(16).padStart(2, '0');
    return `#${channel(0)}${channel(1)}${channel(2)}`;
  }

  function roundedRectPath(path, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    path.moveTo(x + r, y);
    path.lineTo(x + width - r, y);
    path.arcTo(x + width, y, x + width, y + r, r);
    path.lineTo(x + width, y + height - r);
    path.arcTo(x + width, y + height, x + width - r, y + height, r);
    path.lineTo(x + r, y + height);
    path.arcTo(x, y + height, x, y + height - r, r);
    path.lineTo(x, y + r);
    path.arcTo(x, y, x + r, y, r);
    path.closePath();
    return path;
  }

  const icon_cache = {};
  /** A data URL of a shaded icon (heart, gold, star, star_empty, pip, or any atlas key such as 'candy:3'). */
  function iconUrl(kind, size, theme_id) {
    const cache_key = `${kind}|${size}|${theme_id || 'gummy'}`;
    if (icon_cache[cache_key]) return icon_cache[cache_key];
    const spec = iconRecipe(kind) || recipes(theme_id || 'gummy', false)[kind];
    if (!spec) return '';
    const canvas = spriteToCanvas(spec, size);
    icon_cache[cache_key] = canvas.toDataURL ? canvas.toDataURL('image/png') : '';
    return icon_cache[cache_key];
  }

  const SPRITES = { CANDIES, THEMES, THEME_IDS, SHAPE_SDF, shadeSprite, recipes, iconRecipe, drawSymbol, createSpriteCache, keysForLevel, spriteToCanvas, iconUrl, createCanvas, hexToLinear, hexToRgb, rgba, mixHex, roundedRectPath };
  SC.SPRITES = SPRITES;
  if (typeof module === 'object' && module.exports) module.exports = SPRITES;
})(typeof window !== 'undefined' ? window : globalThis);
