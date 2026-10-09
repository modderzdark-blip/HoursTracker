// SCENERY: procedural episode backdrops. Twelve families (gumdrop meadow, lollipop forest, frosted peaks, caramel canyon,
// starlight sky, jelly lagoon, cookie town, sorbet desert, midnight carnival, cloud kitchen, glacier gelato, sunrise orchard)
// each paint a sky and three parallax layers (far shapes, mid props, near props) seeded by the episode number. Every
// pass through the twelve families shifts the hues a little, so 1,334 episodes never repeat exactly.
(function attachScenery(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');

  // ---------------------------------------------------------------- color helpers
  function hexToHsl(hex) {
    const value = parseInt(hex.slice(1), 16);
    const r = ((value >> 16) & 255) / 255;
    const g = ((value >> 8) & 255) / 255;
    const b = (value & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return [h * 60, s, l];
  }

  function hslToHex(h, s, l) {
    const hue = ((h % 360) + 360) % 360 / 360;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const channel = (t) => {
      let k = t;
      if (k < 0) k += 1;
      if (k > 1) k -= 1;
      if (k < 1 / 6) return p + (q - p) * 6 * k;
      if (k < 1 / 2) return q;
      if (k < 2 / 3) return p + (q - p) * (2 / 3 - k) * 6;
      return p;
    };
    const toHex = (value) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
    if (s === 0) return `#${toHex(l)}${toHex(l)}${toHex(l)}`;
    return `#${toHex(channel(hue + 1 / 3))}${toHex(channel(hue))}${toHex(channel(hue - 1 / 3))}`;
  }

  function shiftHue(hex, degrees) {
    if (!degrees) return hex;
    const hsl = hexToHsl(hex);
    return hslToHex(hsl[0] + degrees, hsl[1], hsl[2]);
  }

  function shade(hex, amount) {
    const hsl = hexToHsl(hex);
    return hslToHex(hsl[0], hsl[1], Math.min(1, Math.max(0, hsl[2] + amount)));
  }

  // ---------------------------------------------------------------- families
  const FAMILIES = {
    gumdrop_meadow: { sky: ['#9fe4ff', '#e8f8ff', '#fff0f8'], sun: '#fffbe0', far: '#b6e8a8', mid: '#86d47c', near: '#5ec06c', profile: 'hills', props: ['gumdrops', 'flowers'] },
    lollipop_forest: { sky: ['#ffc4e6', '#ffe6f2', '#fff6d6'], sun: '#ffffff', far: '#e9bdf0', mid: '#cfa0ea', near: '#a77ddc', profile: 'hills', props: ['lollipops', 'lollipops'] },
    frosted_peaks: { sky: ['#a9cfff', '#dcebff', '#ffe8f6'], sun: '#ffffff', far: '#d6e2ff', mid: '#b4c6f2', near: '#f4f8ff', profile: 'peaks', props: ['canes', 'snowdrifts'] },
    caramel_canyon: { sky: ['#ffc27a', '#ffe0b0', '#fff3d6'], sun: '#fff6cc', far: '#eab06c', mid: '#d48a48', near: '#b86e34', profile: 'mesas', props: ['rocks', 'rocks'] },
    starlight_sky: { sky: ['#160f3e', '#3b2275', '#7b3fa8'], sun: '#fff5c8', night: true, far: '#3e2c80', mid: '#2c1f63', near: '#1d1548', profile: 'hills', props: ['planets', 'glowshrooms'] },
    jelly_lagoon: { sky: ['#7fdcff', '#c8f2ff', '#effcff'], sun: '#ffffff', far: '#86dcec', mid: '#55c3dd', near: '#37a7c9', profile: 'waves', props: ['palms', 'jellies'] },
    cookie_town: { sky: ['#ffd9a6', '#ffecd0', '#fff8ec'], sun: '#fff6dc', far: '#e8c093', mid: '#d6a06a', near: '#bb7f4a', profile: 'skyline', props: ['houses', 'fence'] },
    sorbet_desert: { sky: ['#ffa9c4', '#ffd2c4', '#fff0c2'], sun: '#fffbe0', far: '#ffcfaa', mid: '#ffb391', near: '#ff9a86', profile: 'dunes', props: ['cacti', 'cacti'] },
    midnight_carnival: { sky: ['#24164e', '#5a2a8a', '#a54fb0'], sun: '#ffe9b0', night: true, far: '#4a2c80', mid: '#36206a', near: '#25174f', profile: 'skyline', props: ['ferris', 'lights'] },
    cloud_kitchen: { sky: ['#cfe5ff', '#eaf3ff', '#fff6fd'], sun: '#ffffff', far: '#ffffff', mid: '#fdf3ff', near: '#ffffff', profile: 'clouds', props: ['cupcakes', 'sprinkles'] },
    glacier_gelato: { sky: ['#bdefff', '#e2f9ff', '#f8feff'], sun: '#ffffff', far: '#c4e8f7', mid: '#9fd6ee', near: '#e9f8ff', profile: 'peaks', props: ['scoops', 'snowdrifts'] },
    sunrise_orchard: { sky: ['#ff9f72', '#ffcf96', '#ffefc0'], sun: '#fff1b8', far: '#f2c08a', mid: '#a9d46c', near: '#7cbf55', profile: 'hills', props: ['trees', 'fruits'] },
  };
  const FAMILY_IDS = Object.keys(FAMILIES);

  /** The colors of one episode (family colors with the cycle's hue shift); `accent` overrides the sky for the title. */
  function colorsFor(scenery, accent_sky) {
    const family = FAMILIES[scenery.family] || FAMILIES.gumdrop_meadow;
    const shift = scenery.hue_shift || 0;
    return {
      family: scenery.family,
      sky: accent_sky || family.sky.map((hex) => shiftHue(hex, shift)),
      sun: family.sun,
      night: !accent_sky && !!family.night,
      far: shiftHue(family.far, shift),
      mid: shiftHue(family.mid, shift),
      near: shiftHue(family.near, shift),
      profile: family.profile,
      props: family.props,
    };
  }

  // ---------------------------------------------------------------- primitives
  function ridge(ctx, width, height, base_y, amplitude, rng, color, kind) {
    const phase = rng() * 10;
    const frequency = 0.8 + rng() * 0.8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    const steps = 48;
    for (let step = 0; step <= steps; step += 1) {
      const x = (step / steps) * width;
      const t = step / steps;
      let y;
      if (kind === 'peaks') {
        const saw = Math.abs(((t * 3.2 * frequency + phase) % 1) - 0.5) * 2;
        y = base_y - amplitude * (1 - saw) * (0.75 + 0.25 * Math.sin(t * 9 + phase));
      } else if (kind === 'mesas') {
        const band = Math.sin(t * Math.PI * 2.4 * frequency + phase);
        y = base_y - amplitude * (band > 0.1 ? 1 : 0.35) * (0.85 + 0.15 * Math.sin(t * 31));
      } else if (kind === 'dunes') {
        y = base_y - amplitude * (0.55 + 0.45 * Math.sin(t * Math.PI * 1.6 * frequency + phase)) * (0.8 + 0.2 * Math.sin(t * 7 + phase));
      } else if (kind === 'waves') {
        y = base_y - amplitude * 0.3 * (1 + Math.sin(t * Math.PI * 8 * frequency + phase));
      } else if (kind === 'skyline') {
        const block = Math.floor(t * 14 * frequency + phase);
        const block_rng = UTIL.createRng(block * 97 + 13);
        y = base_y - amplitude * (0.35 + 0.65 * block_rng());
      } else {
        y = base_y - amplitude * (0.5 + 0.3 * Math.sin(t * Math.PI * 2 * frequency + phase) + 0.2 * Math.sin(t * Math.PI * 5.3 + phase * 2));
      }
      if (kind === 'skyline' && step > 0) {
        const previous_x = ((step - 1) / steps) * width;
        ctx.lineTo(previous_x + (x - previous_x) * 0.02, y);
      }
      ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
    // Soft light along the ridge top.
    ctx.save();
    ctx.clip();
    const light = ctx.createLinearGradient(0, base_y - amplitude, 0, base_y + amplitude * 0.4);
    light.addColorStop(0, 'rgba(255,255,255,0.28)');
    light.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = light;
    ctx.fillRect(0, base_y - amplitude * 1.2, width, amplitude * 1.8);
    if (kind === 'peaks') {
      // Icing caps with drips on the tops.
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(0, base_y - amplitude * 1.2, width, amplitude * 0.42);
    }
    if (kind === 'mesas') {
      ctx.fillStyle = 'rgba(255,240,210,0.18)';
      for (let band = 0; band < 5; band += 1) ctx.fillRect(0, base_y - amplitude + band * amplitude * 0.28, width, amplitude * 0.08);
    }
    ctx.restore();
  }

  function cloudBank(ctx, width, base_y, size, rng, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    for (let puff = 0; puff < 14; puff += 1) {
      const x = (puff / 13) * width + (rng() - 0.5) * size;
      const radius = size * (0.6 + rng() * 0.7);
      ctx.beginPath();
      ctx.arc(x, base_y - radius * 0.3, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillRect(0, base_y, width, size * 4);
    ctx.restore();
  }

  function cloud(ctx, cx, cy, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    [[-0.9, 0.15, 0.55], [-0.35, -0.2, 0.75], [0.3, -0.1, 0.7], [0.85, 0.15, 0.5], [0, 0.25, 0.6]].forEach(([px, py, pr]) => {
      const puff = ctx.createRadialGradient(cx + px * size - pr * size * 0.3, cy + py * size - pr * size * 0.4, 0, cx + px * size, cy + py * size, pr * size);
      puff.addColorStop(0, '#ffffff');
      puff.addColorStop(1, 'rgba(250,244,255,0.9)');
      ctx.fillStyle = puff;
      ctx.beginPath();
      ctx.arc(cx + px * size, cy + py * size, pr * size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function glossyCircle(ctx, x, y, radius, color) {
    const fill = ctx.createRadialGradient(x - radius * 0.35, y - radius * 0.4, radius * 0.1, x, y, radius);
    fill.addColorStop(0, shade(color, 0.22));
    fill.addColorStop(0.7, color);
    fill.addColorStop(1, shade(color, -0.15));
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - radius * 0.35, y - radius * 0.4, radius * 0.28, radius * 0.16, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  const CANDY_COLORS = ['#ff5c8a', '#ffb347', '#ffe066', '#5fe0a8', '#6cb8ff', '#b57bff', '#ff8fd0'];

  // ---------------------------------------------------------------- props (x, ground y, size unit)
  const PROPS = {
    gumdrops(ctx, x, y, unit, rng) {
      const color = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      const radius = unit * (0.35 + rng() * 0.25);
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radius * 1.05, 0, Math.PI, 0);
      ctx.lineTo(x + radius, y);
      ctx.closePath();
      const fill = ctx.createLinearGradient(x, y - radius, x, y);
      fill.addColorStop(0, shade(color, 0.15));
      fill.addColorStop(1, shade(color, -0.12));
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      for (let dot = 0; dot < 6; dot += 1) ctx.fillRect(x - radius * 0.6 + rng() * radius * 1.2, y - radius * 0.9 + rng() * radius * 0.8, 1.5, 1.5);
      ctx.restore();
    },
    flowers(ctx, x, y, unit, rng) {
      const color = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      ctx.strokeStyle = '#3f9a4e';
      ctx.lineWidth = Math.max(1, unit * 0.06);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - unit * 0.5);
      ctx.stroke();
      for (let petal = 0; petal < 5; petal += 1) {
        const angle = (petal / 5) * Math.PI * 2;
        glossyCircle(ctx, x + Math.cos(angle) * unit * 0.12, y - unit * 0.5 + Math.sin(angle) * unit * 0.12, unit * 0.09, color);
      }
      glossyCircle(ctx, x, y - unit * 0.5, unit * 0.07, '#ffe066');
    },
    lollipops(ctx, x, y, unit, rng) {
      const height = unit * (1.2 + rng() * 1.1);
      const radius = unit * (0.42 + rng() * 0.3);
      ctx.fillStyle = '#fff8f0';
      ctx.fillRect(x - unit * 0.04, y - height, unit * 0.08, height);
      const color = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      glossyCircle(ctx, x, y - height, radius, color);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = Math.max(1, radius * 0.16);
      ctx.beginPath();
      for (let angle = 0; angle < Math.PI * 5; angle += 0.2) {
        const r = (angle / (Math.PI * 5)) * radius * 0.85;
        ctx.lineTo(x + Math.cos(angle) * r, y - height + Math.sin(angle) * r);
      }
      ctx.stroke();
    },
    canes(ctx, x, y, unit, rng) {
      const height = unit * (1 + rng() * 0.8);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = unit * 0.16;
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - height);
      ctx.arc(x + unit * 0.22, y - height, unit * 0.22, Math.PI, 0);
      ctx.stroke();
      ctx.setLineDash([unit * 0.12, unit * 0.12]);
      ctx.strokeStyle = '#ff4f6d';
      ctx.stroke();
      ctx.restore();
    },
    snowdrifts(ctx, x, y, unit) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.ellipse(x, y, unit * 0.9, unit * 0.3, 0, Math.PI, 0);
      ctx.fill();
    },
    rocks(ctx, x, y, unit, rng, colors) {
      const radius = unit * (0.3 + rng() * 0.35);
      glossyCircle(ctx, x, y - radius * 0.4, radius, shade(colors.near, -0.05));
    },
    planets(ctx, x, y, unit, rng) {
      const radius = unit * (0.25 + rng() * 0.35);
      const py = y - unit * (2 + rng() * 3);
      const color = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      glossyCircle(ctx, x, py, radius, color);
      ctx.strokeStyle = 'rgba(255,240,200,0.6)';
      ctx.lineWidth = Math.max(1, radius * 0.12);
      ctx.beginPath();
      ctx.ellipse(x, py, radius * 1.7, radius * 0.45, -0.3, 0, Math.PI * 2);
      ctx.stroke();
    },
    glowshrooms(ctx, x, y, unit, rng) {
      const radius = unit * (0.25 + rng() * 0.2);
      const glow = ctx.createRadialGradient(x, y - radius, 0, x, y - radius, radius * 3);
      glow.addColorStop(0, 'rgba(160,240,255,0.45)');
      glow.addColorStop(1, 'rgba(160,240,255,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius * 3, y - radius * 4, radius * 6, radius * 6);
      ctx.fillStyle = '#e6f8ff';
      ctx.fillRect(x - radius * 0.15, y - radius, radius * 0.3, radius);
      glossyCircle(ctx, x, y - radius, radius, '#7fe0ff');
    },
    palms(ctx, x, y, unit, rng) {
      const height = unit * (1.6 + rng());
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineWidth = unit * 0.14;
      ctx.strokeStyle = '#ffd9a0';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + unit * 0.3, y - height * 0.5, x + unit * 0.1, y - height);
      ctx.stroke();
      ctx.fillStyle = '#4fd48a';
      for (let leaf = 0; leaf < 5; leaf += 1) {
        const angle = -Math.PI / 2 + (leaf - 2) * 0.55;
        ctx.beginPath();
        ctx.ellipse(x + unit * 0.1 + Math.cos(angle) * unit * 0.45, y - height + Math.sin(angle) * unit * 0.2, unit * 0.5, unit * 0.12, angle, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },
    jellies(ctx, x, y, unit, rng) {
      const color = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      ctx.save();
      ctx.globalAlpha = 0.85;
      glossyCircle(ctx, x, y - unit * 0.15, unit * (0.25 + rng() * 0.2), color);
      ctx.restore();
    },
    houses(ctx, x, y, unit, rng) {
      const width = unit * (0.9 + rng() * 0.5);
      const height = unit * (0.8 + rng() * 0.6);
      ctx.fillStyle = '#c98a4e';
      ctx.fillRect(x - width / 2, y - height, width, height);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      for (let dot = 0; dot < 6; dot += 1) ctx.fillRect(x - width / 2 + rng() * width, y - height + rng() * height, 2, 2);
      const roof = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(x - width * 0.62, y - height);
      ctx.lineTo(x, y - height - width * 0.55);
      ctx.lineTo(x + width * 0.62, y - height);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(x - width * 0.62, y - height);
      for (let drip = 0; drip <= 6; drip += 1) ctx.lineTo(x - width * 0.62 + (drip / 6) * width * 1.24, y - height + (drip % 2 ? unit * 0.08 : 0));
      ctx.lineTo(x + width * 0.62, y - height - unit * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ffe066';
      ctx.fillRect(x - width * 0.12, y - height * 0.55, width * 0.24, height * 0.24);
    },
    fence(ctx, x, y, unit) {
      ctx.fillStyle = '#ffe2b0';
      for (let post = -2; post <= 2; post += 1) ctx.fillRect(x + post * unit * 0.3 - unit * 0.06, y - unit * 0.55, unit * 0.12, unit * 0.55);
      ctx.fillRect(x - unit * 0.7, y - unit * 0.4, unit * 1.4, unit * 0.08);
    },
    cacti(ctx, x, y, unit, rng) {
      const color = rng() < 0.5 ? '#5fe0a8' : '#ff8fd0';
      const height = unit * (0.8 + rng() * 0.8);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = color;
      ctx.lineWidth = unit * 0.28;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - height);
      ctx.moveTo(x, y - height * 0.5);
      ctx.lineTo(x - unit * 0.3, y - height * 0.5);
      ctx.lineTo(x - unit * 0.3, y - height * 0.8);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = unit * 0.06;
      ctx.beginPath();
      ctx.moveTo(x - unit * 0.05, y);
      ctx.lineTo(x - unit * 0.05, y - height);
      ctx.stroke();
      ctx.restore();
    },
    ferris(ctx, x, y, unit) {
      const radius = unit * 1.6;
      const cy = y - radius * 1.25;
      ctx.save();
      ctx.strokeStyle = 'rgba(255,220,160,0.75)';
      ctx.lineWidth = Math.max(1, unit * 0.06);
      ctx.beginPath();
      ctx.arc(x, cy, radius, 0, Math.PI * 2);
      for (let spoke = 0; spoke < 10; spoke += 1) {
        const angle = (spoke / 10) * Math.PI * 2;
        ctx.moveTo(x, cy);
        ctx.lineTo(x + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      }
      ctx.moveTo(x - radius * 0.5, y);
      ctx.lineTo(x, cy);
      ctx.lineTo(x + radius * 0.5, y);
      ctx.stroke();
      for (let car = 0; car < 10; car += 1) {
        const angle = (car / 10) * Math.PI * 2;
        glossyCircle(ctx, x + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, unit * 0.12, CANDY_COLORS[car % CANDY_COLORS.length]);
      }
      ctx.restore();
    },
    lights(ctx, x, y, unit, rng) {
      const span = unit * 3;
      const top = y - unit * (2.5 + rng());
      ctx.save();
      ctx.strokeStyle = 'rgba(255,230,180,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x - span / 2, top);
      ctx.quadraticCurveTo(x, top + unit * 0.6, x + span / 2, top);
      ctx.stroke();
      for (let bulb = 0; bulb <= 8; bulb += 1) {
        const t = bulb / 8;
        const bx = x - span / 2 + t * span;
        const by = top + unit * 0.6 * 2 * t * (1 - t);
        const glow = ctx.createRadialGradient(bx, by, 0, bx, by, unit * 0.25);
        glow.addColorStop(0, CANDY_COLORS[bulb % CANDY_COLORS.length]);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(bx - unit * 0.25, by - unit * 0.25, unit * 0.5, unit * 0.5);
      }
      ctx.restore();
    },
    cupcakes(ctx, x, y, unit, rng) {
      const width = unit * (0.7 + rng() * 0.3);
      const wrapper = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
      ctx.fillStyle = wrapper;
      ctx.beginPath();
      ctx.moveTo(x - width / 2, y - width * 0.6);
      ctx.lineTo(x + width / 2, y - width * 0.6);
      ctx.lineTo(x + width * 0.38, y);
      ctx.lineTo(x - width * 0.38, y);
      ctx.closePath();
      ctx.fill();
      for (let scoop = 0; scoop < 3; scoop += 1) glossyCircle(ctx, x, y - width * (0.75 + scoop * 0.22), width * (0.48 - scoop * 0.12), '#fff0f8');
      glossyCircle(ctx, x, y - width * 1.38, width * 0.12, '#ff3b6b');
    },
    sprinkles(ctx, x, y, unit, rng) {
      for (let sprinkle = 0; sprinkle < 6; sprinkle += 1) {
        ctx.save();
        ctx.translate(x + (rng() - 0.5) * unit * 2, y - rng() * unit * 3);
        ctx.rotate(rng() * Math.PI);
        ctx.fillStyle = CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)];
        ctx.fillRect(-unit * 0.12, -unit * 0.035, unit * 0.24, unit * 0.07);
        ctx.restore();
      }
    },
    scoops(ctx, x, y, unit, rng) {
      const radius = unit * (0.4 + rng() * 0.25);
      ctx.fillStyle = '#e8b06a';
      ctx.beginPath();
      ctx.moveTo(x - radius * 0.8, y - radius * 0.9);
      ctx.lineTo(x + radius * 0.8, y - radius * 0.9);
      ctx.lineTo(x, y + radius * 0.4);
      ctx.closePath();
      ctx.fill();
      glossyCircle(ctx, x, y - radius * 1.2, radius, ['#ffd1e8', '#c4f0ff', '#fff2b0', '#d8ffd6'][Math.floor(rng() * 4)]);
    },
    trees(ctx, x, y, unit, rng) {
      const height = unit * (1 + rng() * 0.6);
      ctx.fillStyle = '#a0683a';
      ctx.fillRect(x - unit * 0.07, y - height, unit * 0.14, height);
      glossyCircle(ctx, x, y - height - unit * 0.3, unit * (0.55 + rng() * 0.2), '#6fcf5a');
      for (let fruit = 0; fruit < 5; fruit += 1) glossyCircle(ctx, x + (rng() - 0.5) * unit * 0.8, y - height - unit * 0.3 + (rng() - 0.5) * unit * 0.6, unit * 0.08, CANDY_COLORS[Math.floor(rng() * 3)]);
    },
    fruits(ctx, x, y, unit, rng) {
      glossyCircle(ctx, x, y - unit * 0.18, unit * (0.18 + rng() * 0.1), CANDY_COLORS[Math.floor(rng() * CANDY_COLORS.length)]);
    },
  };

  // ---------------------------------------------------------------- painting

  /** Paints the sky (gradient, sun or moon, clouds or stars) into ctx. */
  function paintSky(ctx, width, height, colors, seed) {
    if (!(width >= 1 && height >= 1)) return;
    const rng = UTIL.createRng(seed * 31 + 7);
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, colors.sky[0]);
    sky.addColorStop(0.5, colors.sky[1]);
    sky.addColorStop(1, colors.sky[2]);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    const unit = Math.min(width, height);
    const sun_x = width * (0.65 + rng() * 0.25);
    const sun_y = height * (0.08 + rng() * 0.08);
    const glow = ctx.createRadialGradient(sun_x, sun_y, 0, sun_x, sun_y, unit * 0.5);
    glow.addColorStop(0, colors.night ? 'rgba(255,245,200,0.5)' : 'rgba(255,255,240,0.8)');
    glow.addColorStop(0.3, colors.night ? 'rgba(255,245,200,0.12)' : 'rgba(255,250,220,0.3)');
    glow.addColorStop(1, 'rgba(255,250,220,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    if (colors.night) {
      ctx.fillStyle = colors.sun;
      ctx.beginPath();
      ctx.arc(sun_x, sun_y, unit * 0.06, 0, Math.PI * 2);
      ctx.fill();
      for (let star = 0; star < 90; star += 1) {
        ctx.globalAlpha = 0.3 + rng() * 0.7;
        ctx.fillStyle = '#ffffff';
        const size = rng() < 0.9 ? 1.2 : 2.4;
        ctx.fillRect(rng() * width, rng() * height * 0.7, size, size);
      }
      ctx.globalAlpha = 1;
    } else {
      for (let index = 0; index < 4; index += 1) cloud(ctx, rng() * width, height * (0.08 + rng() * 0.3), unit * (0.05 + rng() * 0.05), 0.75 + rng() * 0.2);
    }
  }

  /**
   * Paints one parallax layer ('far', 'mid' or 'near') into ctx, transparent above its horizon. `seed` picks the prop
   * placements (the episode number), so a scene is identical every time it is drawn.
   */
  function paintLayer(ctx, width, height, colors, layer, seed) {
    if (!(width >= 1 && height >= 1)) return;
    const rng = UTIL.createRng(seed * 131 + (layer === 'far' ? 1 : layer === 'mid' ? 2 : 3));
    const unit = Math.min(width * 0.16, height * 0.09);
    if (layer === 'far') {
      if (colors.profile === 'clouds') cloudBank(ctx, width, height * 0.62, unit * 1.2, rng, colors.far, 0.85);
      else ridge(ctx, width, height, height * 0.66, height * 0.16, rng, colors.far, colors.profile);
      return;
    }
    if (layer === 'mid') {
      if (colors.profile === 'clouds') cloudBank(ctx, width, height * 0.74, unit * 1.0, rng, colors.mid, 0.92);
      else ridge(ctx, width, height, height * 0.77, height * 0.11, rng, colors.mid, colors.profile === 'skyline' || colors.profile === 'mesas' ? colors.profile : 'hills');
      const prop = PROPS[colors.props[0]];
      const count = colors.props[0] === 'ferris' ? 1 : 5 + Math.floor(rng() * 3);
      for (let index = 0; index < count; index += 1) {
        const x = count === 1 ? width * (0.2 + rng() * 0.6) : ((index + 0.3 + rng() * 0.4) / count) * width;
        prop(ctx, x, height * (0.74 + rng() * 0.04), unit * 0.85, rng, colors);
      }
      return;
    }
    // near: ground band with props and a soft top edge
    const ground_y = height * 0.88;
    ctx.fillStyle = colors.near;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let step = 0; step <= 24; step += 1) {
      const x = (step / 24) * width;
      ctx.lineTo(x, ground_y - Math.sin(step * 0.9 + seed) * unit * 0.25);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
    const prop = PROPS[colors.props[1]];
    const count = 6 + Math.floor(rng() * 4);
    for (let index = 0; index < count; index += 1) {
      const x = ((index + 0.2 + rng() * 0.6) / count) * width;
      prop(ctx, x, ground_y + unit * 0.15, unit * 0.8, rng, colors);
    }
  }

  const SCENERY = { FAMILIES, FAMILY_IDS, colorsFor, paintSky, paintLayer, shiftHue, shade };
  SC.SCENERY = SCENERY;
  if (typeof module === 'object' && module.exports) module.exports = SCENERY;
})(typeof window !== 'undefined' ? window : globalThis);
