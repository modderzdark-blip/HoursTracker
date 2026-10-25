// MAPART: the level map's painted world in a clean cartoon style (our own art): flat colours, one dark outline,
// flat highlights, no noise. It paints
//   - an episode's ground: a smooth plateau in the land's colour with a few big flat hills and grass tufts,
//   - the road: a pale path with a darker rim,
//   - the "door" between two episodes: a cliff with wooden stairs, a river with stepping stones, a chasm with a plank
//     bridge, or a candy fence with a gate arch,
//   - set pieces (big unique buildings and trees, a few per episode, never the same one twice in an episode) and small
//     props (lamp posts beside the road, bushes, flowers, stones), which the map stands upright on its curved world.
// Coordinates are map pixels; (x, y) of a standing thing is where it touches the ground.
(function attachMapArt(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL;
  const SCENERY = SC.SCENERY;

  const INK = '#4a2445'; // the one outline colour
  const SHADOW = 'rgba(40, 14, 48, 0.2)';
  const CANDY = { pink: '#ff4f9a', red: '#f0283c', orange: '#ff8a1f', yellow: '#ffcc1a', mint: '#1fcf8a', sky: '#2f9bff', purple: '#8f4fff', cream: '#fff0d6', white: '#ffffff', wood: '#c97a3a', woodDark: '#8a4a22', choco: '#74391c' };
  const shade = (hex, amount) => SCENERY.shade(hex, amount);

  function mix(first, second, amount) {
    const a = parseInt(first.slice(1), 16);
    const b = parseInt(second.slice(1), 16);
    const channel = (shift) => Math.round(((a >> shift) & 255) * (1 - amount) + ((b >> shift) & 255) * amount);
    return `#${((1 << 24) | (channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).slice(1)}`;
  }

  /** A land's colours for the map (ground, road, rim, cliff, water ...). */
  function paletteOf(land) {
    return {
      ground: land.ground,
      light: land.light,
      dark: land.dark,
      road: land.night ? mix(land.light, '#e9dcff', 0.55) : mix(land.light, '#fff4dc', 0.6),
      rim: shade(land.dark, -0.14),
      cliff: land.night ? shade(land.dark, -0.2) : mix(shade(land.dark, -0.22), '#c9773f', 0.42),
      water: land.water || '#5fc8f2',
      tree: land.tree || '#4cbf55',
      night: !!land.night,
    };
  }

  function lineFor(size) {
    return Math.max(1.3, size * 0.028);
  }

  /** Fills a path and outlines it in ink. */
  function ink(ctx, size, fill, build, outline) {
    ctx.beginPath();
    build();
    ctx.fillStyle = fill;
    ctx.fill();
    if (outline === false) return;
    ctx.lineWidth = lineFor(size);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = outline || INK;
    ctx.stroke();
  }

  /** A flat shape with no outline (highlights and shading). */
  function flat(ctx, fill, build) {
    ctx.beginPath();
    build();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** Overlapping circles filled as one blob with a single outline around the outside. */
  function blob(ctx, size, fill, circles) {
    ctx.lineWidth = lineFor(size) * 2;
    ctx.strokeStyle = INK;
    circles.forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.fillStyle = fill;
    circles.forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function groundShadow(ctx, x, y, width) {
    flat(ctx, SHADOW, () => ctx.ellipse(x, y, width * 0.5, width * 0.13, 0, 0, Math.PI * 2));
  }

  function roundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.arcTo(x + width, y, x + width, y + r, r);
    ctx.lineTo(x + width, y + height - r);
    ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
    ctx.lineTo(x + r, y + height);
    ctx.arcTo(x, y + height, x, y + height - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function archDoor(ctx, s, cx, base, width, height, color) {
    ink(ctx, s, color, () => {
      ctx.moveTo(cx - width / 2, base);
      ctx.lineTo(cx - width / 2, base - height + width / 2);
      ctx.arc(cx, base - height + width / 2, width / 2, Math.PI, 0);
      ctx.lineTo(cx + width / 2, base);
      ctx.closePath();
    });
    flat(ctx, 'rgba(255,255,255,0.25)', () => ctx.ellipse(cx - width * 0.18, base - height * 0.62, width * 0.1, height * 0.2, 0, 0, Math.PI * 2));
    flat(ctx, CANDY.yellow, () => ctx.arc(cx + width * 0.25, base - height * 0.4, Math.max(1, width * 0.08), 0, Math.PI * 2));
  }

  function roundWindow(ctx, s, cx, cy, radius, frame) {
    ink(ctx, s, frame || CANDY.white, () => ctx.arc(cx, cy, radius * 1.22, 0, Math.PI * 2));
    ink(ctx, s, '#8fd8ff', () => ctx.arc(cx, cy, radius, 0, Math.PI * 2));
    ctx.lineWidth = lineFor(s) * 0.8;
    ctx.strokeStyle = frame || CANDY.white;
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx, cy + radius);
    ctx.stroke();
    flat(ctx, 'rgba(255,255,255,0.55)', () => ctx.ellipse(cx - radius * 0.38, cy - radius * 0.4, radius * 0.22, radius * 0.14, -0.6, 0, Math.PI * 2));
  }

  function gumdrop(ctx, s, cx, base, radius, color) {
    ink(ctx, s, color, () => {
      ctx.moveTo(cx - radius, base);
      ctx.quadraticCurveTo(cx - radius, base - radius * 1.5, cx, base - radius * 1.5);
      ctx.quadraticCurveTo(cx + radius, base - radius * 1.5, cx + radius, base);
      ctx.closePath();
    });
    flat(ctx, 'rgba(255,255,255,0.5)', () => ctx.ellipse(cx - radius * 0.35, base - radius * 0.95, radius * 0.18, radius * 0.3, -0.4, 0, Math.PI * 2));
  }

  function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
  }

  // ---------------------------------------------------------------- set pieces (s: about their height)

  const SET_PIECES = {
    /** A pastry cottage under a frosting dome dotted with gumdrops. */
    domeCottage(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 1.1);
      const wall = pal.night ? '#efe6ff' : pick(rng, ['#fff1e0', '#e8f6ff', '#fde4ef']);
      const roof = pal.night ? '#8f7bff' : pick(rng, [CANDY.yellow, '#ffb84d', CANDY.pink, CANDY.mint]);
      const width = s * 0.86;
      const wall_h = s * 0.46;
      ink(ctx, s, wall, () => roundRect(ctx, x - width / 2, y - wall_h, width, wall_h, s * 0.04));
      flat(ctx, shade(wall, -0.1), () => ctx.rect(x - width / 2 + lineFor(s) / 2, y - s * 0.07, width - lineFor(s), s * 0.06));
      // The dome with a scalloped frosting rim.
      ink(ctx, s, roof, () => {
        ctx.moveTo(x - width * 0.6, y - wall_h);
        ctx.bezierCurveTo(x - width * 0.6, y - s * 1.12, x + width * 0.6, y - s * 1.12, x + width * 0.6, y - wall_h);
        ctx.closePath();
      });
      flat(ctx, shade(roof, 0.18), () => ctx.ellipse(x - width * 0.2, y - s * 0.86, width * 0.2, s * 0.08, -0.3, 0, Math.PI * 2));
      for (let bump = 0; bump < 7; bump += 1) {
        const bx = x - width * 0.6 + (bump + 0.5) * (width * 1.2 / 7);
        ink(ctx, s, roof, () => ctx.arc(bx, y - wall_h, width * 1.2 / 14, 0, Math.PI));
      }
      [[-0.28, -0.74, CANDY.red], [0.05, -0.92, CANDY.orange], [0.3, -0.72, CANDY.red], [-0.05, -0.66, CANDY.mint]].forEach(([dx, dy, color]) => {
        gumdrop(ctx, s, x + width * dx, y + s * dy + s * 0.06, s * 0.06, color);
      });
      archDoor(ctx, s, x + width * 0.18, y, width * 0.24, wall_h * 0.78, CANDY.choco);
      roundWindow(ctx, s, x - width * 0.22, y - wall_h * 0.52, s * 0.085);
    },

    /** A mushroom house: a spotted cap over a cream stem with a door. */
    mushroomHouse(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.9);
      const cap = pal.night ? '#c48bff' : pick(rng, [CANDY.red, '#ff5d8f', '#b06cff', CANDY.orange]);
      ink(ctx, s, CANDY.cream, () => {
        ctx.moveTo(x - s * 0.22, y);
        ctx.quadraticCurveTo(x - s * 0.27, y - s * 0.3, x - s * 0.2, y - s * 0.55);
        ctx.lineTo(x + s * 0.2, y - s * 0.55);
        ctx.quadraticCurveTo(x + s * 0.27, y - s * 0.3, x + s * 0.22, y);
        ctx.closePath();
      });
      flat(ctx, shade(CANDY.cream, -0.12), () => ctx.ellipse(x + s * 0.12, y - s * 0.28, s * 0.05, s * 0.2, 0, 0, Math.PI * 2));
      archDoor(ctx, s, x - s * 0.04, y, s * 0.17, s * 0.3, CANDY.choco);
      roundWindow(ctx, s, x + s * 0.12, y - s * 0.4, s * 0.05);
      ink(ctx, s, shade(cap, -0.25), () => ctx.ellipse(x, y - s * 0.58, s * 0.5, s * 0.1, 0, 0, Math.PI * 2));
      ink(ctx, s, cap, () => {
        ctx.moveTo(x - s * 0.54, y - s * 0.6);
        ctx.bezierCurveTo(x - s * 0.56, y - s * 1.2, x + s * 0.56, y - s * 1.2, x + s * 0.54, y - s * 0.6);
        ctx.quadraticCurveTo(x, y - s * 0.52, x - s * 0.54, y - s * 0.6);
        ctx.closePath();
      });
      [[-0.3, -0.78, 0.07], [0.02, -0.98, 0.09], [0.3, -0.8, 0.065], [-0.08, -0.72, 0.05], [0.18, -0.66, 0.045]].forEach(([dx, dy, r]) => {
        flat(ctx, CANDY.white, () => ctx.ellipse(x + s * dx, y + s * dy, s * r, s * r * 0.8, 0, 0, Math.PI * 2));
      });
      flat(ctx, 'rgba(255,255,255,0.35)', () => ctx.ellipse(x - s * 0.22, y - s * 0.95, s * 0.12, s * 0.05, -0.5, 0, Math.PI * 2));
    },

    /** A round fruit tree. */
    fruitTree(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.8);
      ink(ctx, s, CANDY.wood, () => {
        ctx.moveTo(x - s * 0.07, y);
        ctx.lineTo(x - s * 0.04, y - s * 0.42);
        ctx.lineTo(x + s * 0.04, y - s * 0.42);
        ctx.lineTo(x + s * 0.08, y);
        ctx.closePath();
      });
      const leaves = pal.night ? '#5b4fd6' : shade(pal.tree, -0.02);
      const circles = [[x, y - s * 0.72, s * 0.3], [x - s * 0.25, y - s * 0.55, s * 0.22], [x + s * 0.25, y - s * 0.56, s * 0.22], [x - s * 0.12, y - s * 0.9, s * 0.2], [x + s * 0.14, y - s * 0.9, s * 0.19]];
      blob(ctx, s, leaves, circles);
      flat(ctx, shade(leaves, -0.16), () => ctx.ellipse(x, y - s * 0.48, s * 0.36, s * 0.08, 0, 0, Math.PI * 2));
      flat(ctx, shade(leaves, 0.2), () => ctx.ellipse(x - s * 0.12, y - s * 0.92, s * 0.12, s * 0.07, -0.4, 0, Math.PI * 2));
      const fruit = pal.night ? '#ffd23f' : pick(rng, [CANDY.red, CANDY.orange, CANDY.yellow]);
      [[-0.2, -0.62], [0.16, -0.7], [-0.02, -0.82], [0.27, -0.52], [-0.3, -0.5]].forEach(([dx, dy]) => {
        ink(ctx, s * 0.6, fruit, () => ctx.arc(x + s * dx, y + s * dy, s * 0.05, 0, Math.PI * 2));
        flat(ctx, 'rgba(255,255,255,0.6)', () => ctx.arc(x + s * dx - s * 0.015, y + s * dy - s * 0.015, s * 0.014, 0, Math.PI * 2));
      });
    },

    /** A cotton-candy tree on a thin striped stick. */
    cottonTree(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.6);
      ink(ctx, s, CANDY.white, () => ctx.rect(x - s * 0.035, y - s * 0.5, s * 0.07, s * 0.5));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - s * 0.035, y - s * 0.5, s * 0.07, s * 0.5);
      ctx.clip();
      ctx.strokeStyle = CANDY.pink;
      ctx.lineWidth = s * 0.03;
      for (let band = 0; band < 8; band += 1) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.05, y - band * s * 0.07);
        ctx.lineTo(x + s * 0.05, y - band * s * 0.07 - s * 0.05);
        ctx.stroke();
      }
      ctx.restore();
      const fluff = pal.night ? '#ff8fe0' : pick(rng, ['#ffb3dc', '#d7b8ff', '#9fe3ff']);
      blob(ctx, s, fluff, [[x, y - s * 0.75, s * 0.27], [x - s * 0.24, y - s * 0.62, s * 0.18], [x + s * 0.24, y - s * 0.64, s * 0.19], [x - s * 0.08, y - s * 0.95, s * 0.17], [x + s * 0.13, y - s * 0.92, s * 0.15]]);
      flat(ctx, shade(fluff, 0.22), () => ctx.ellipse(x - s * 0.1, y - s * 0.88, s * 0.13, s * 0.07, -0.3, 0, Math.PI * 2));
      flat(ctx, shade(fluff, -0.1), () => ctx.ellipse(x + s * 0.06, y - s * 0.55, s * 0.24, s * 0.06, 0, 0, Math.PI * 2));
    },

    /** A layered pine, frosted with snow in cold lands. */
    pineTree(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.7);
      ink(ctx, s, CANDY.woodDark, () => ctx.rect(x - s * 0.05, y - s * 0.2, s * 0.1, s * 0.2));
      const green = pal.night ? '#3f4fb8' : '#2fa96b';
      const snowy = pal.ground && SCENERY.shade(pal.ground, 0) && /^#(e|f|d)/i.test(pal.ground);
      [[0.18, 0.46, 0.42], [0.42, 0.36, 0.36], [0.64, 0.26, 0.3]].forEach(([base, half, height]) => {
        ink(ctx, s, green, () => {
          ctx.moveTo(x - s * half, y - s * base);
          ctx.quadraticCurveTo(x, y - s * (base + height * 1.25), x + s * half, y - s * base);
          ctx.quadraticCurveTo(x, y - s * (base - 0.05), x - s * half, y - s * base);
          ctx.closePath();
        });
        if (snowy) {
          flat(ctx, CANDY.white, () => {
            ctx.moveTo(x - s * half * 0.45, y - s * (base + height * 0.62));
            ctx.quadraticCurveTo(x, y - s * (base + height * 1.2), x + s * half * 0.45, y - s * (base + height * 0.62));
            ctx.quadraticCurveTo(x, y - s * (base + height * 0.5), x - s * half * 0.45, y - s * (base + height * 0.62));
          });
        } else {
          flat(ctx, shade(green, 0.15), () => ctx.ellipse(x - s * half * 0.35, y - s * (base + height * 0.45), s * half * 0.22, s * 0.035, -0.3, 0, Math.PI * 2));
        }
      });
    },

    /** A candy windmill with lollipop sails. */
    windmill(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.7);
      const body = pal.night ? '#e6dcff' : pick(rng, ['#fff1e0', '#ffe3ef', '#e7f7ff']);
      ink(ctx, s, body, () => {
        ctx.moveTo(x - s * 0.26, y);
        ctx.lineTo(x - s * 0.15, y - s * 0.7);
        ctx.lineTo(x + s * 0.15, y - s * 0.7);
        ctx.lineTo(x + s * 0.26, y);
        ctx.closePath();
      });
      flat(ctx, shade(body, -0.12), () => {
        ctx.moveTo(x + s * 0.1, y);
        ctx.lineTo(x + s * 0.06, y - s * 0.7);
        ctx.lineTo(x + s * 0.15, y - s * 0.7);
        ctx.lineTo(x + s * 0.26, y);
      });
      const roof = pick(rng, [CANDY.red, CANDY.pink, CANDY.purple]);
      ink(ctx, s, roof, () => {
        ctx.moveTo(x - s * 0.21, y - s * 0.68);
        ctx.quadraticCurveTo(x, y - s * 0.98, x + s * 0.21, y - s * 0.68);
        ctx.closePath();
      });
      archDoor(ctx, s, x, y, s * 0.15, s * 0.26, CANDY.choco);
      roundWindow(ctx, s, x, y - s * 0.46, s * 0.05);
      const hub_x = x;
      const hub_y = y - s * 0.72;
      const sail_colors = [CANDY.pink, CANDY.white, CANDY.sky, CANDY.white];
      for (let sail = 0; sail < 4; sail += 1) {
        const angle = Math.PI / 4 + sail * (Math.PI / 2) + 0.15;
        ctx.save();
        ctx.translate(hub_x, hub_y);
        ctx.rotate(angle);
        ink(ctx, s, sail_colors[sail], () => roundRect(ctx, s * 0.05, -s * 0.06, s * 0.42, s * 0.12, s * 0.05));
        ctx.restore();
      }
      ink(ctx, s, CANDY.yellow, () => ctx.arc(hub_x, hub_y, s * 0.055, 0, Math.PI * 2));
    },

    /** A cupcake house: a striped paper base and a swirl of frosting with a cherry on top. */
    cupcakeHouse(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.9);
      const paper = pick(rng, [CANDY.sky, CANDY.pink, CANDY.mint, CANDY.purple]);
      ink(ctx, s, paper, () => {
        ctx.moveTo(x - s * 0.3, y);
        ctx.lineTo(x - s * 0.4, y - s * 0.42);
        ctx.lineTo(x + s * 0.4, y - s * 0.42);
        ctx.lineTo(x + s * 0.3, y);
        ctx.closePath();
      });
      ctx.strokeStyle = shade(paper, 0.25);
      ctx.lineWidth = s * 0.03;
      for (let stripe = -3; stripe <= 3; stripe += 1) {
        ctx.beginPath();
        ctx.moveTo(x + stripe * s * 0.085, y - s * 0.02);
        ctx.lineTo(x + stripe * s * 0.11, y - s * 0.4);
        ctx.stroke();
      }
      const frosting = pal.night ? '#ffd0f0' : pick(rng, [CANDY.white, '#ffd6e8', '#fff0b8']);
      [[0.44, 0.47, 0.17], [0.34, 0.65, 0.15], [0.22, 0.82, 0.13]].forEach(([half, top, height]) => {
        ink(ctx, s, frosting, () => {
          ctx.moveTo(x - s * half, y - s * (top - 0.04));
          ctx.quadraticCurveTo(x - s * half * 1.05, y - s * (top + height), x, y - s * (top + height));
          ctx.quadraticCurveTo(x + s * half * 1.05, y - s * (top + height), x + s * half, y - s * (top - 0.04));
          ctx.quadraticCurveTo(x, y - s * (top - 0.1), x - s * half, y - s * (top - 0.04));
          ctx.closePath();
        });
      });
      ink(ctx, s, CANDY.red, () => ctx.arc(x, y - s * 1.0, s * 0.07, 0, Math.PI * 2));
      flat(ctx, 'rgba(255,255,255,0.6)', () => ctx.arc(x - s * 0.02, y - s * 1.02, s * 0.02, 0, Math.PI * 2));
      archDoor(ctx, s, x, y, s * 0.17, s * 0.3, CANDY.choco);
      roundWindow(ctx, s, x - s * 0.17, y - s * 0.6, s * 0.045, CANDY.yellow);
      roundWindow(ctx, s, x + s * 0.17, y - s * 0.6, s * 0.045, CANDY.yellow);
    },

    /** A tall striped candy tower with a cone roof and a pennant. */
    candyTower(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.55);
      const stripe = pal.night ? '#ff7fd0' : pick(rng, [CANDY.red, CANDY.pink, CANDY.purple, CANDY.mint]);
      const width = s * 0.32;
      ink(ctx, s, CANDY.white, () => roundRect(ctx, x - width / 2, y - s * 0.85, width, s * 0.85, s * 0.02));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - width / 2, y - s * 0.85, width, s * 0.85);
      ctx.clip();
      ctx.fillStyle = stripe;
      for (let band = 0; band < 9; band += 1) {
        ctx.beginPath();
        ctx.moveTo(x - width, y - band * s * 0.12);
        ctx.lineTo(x + width, y - band * s * 0.12 - s * 0.14);
        ctx.lineTo(x + width, y - band * s * 0.12 - s * 0.19);
        ctx.lineTo(x - width, y - band * s * 0.12 - s * 0.05);
        ctx.fill();
      }
      ctx.restore();
      ctx.lineWidth = lineFor(s);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      roundRect(ctx, x - width / 2, y - s * 0.85, width, s * 0.85, s * 0.02);
      ctx.stroke();
      flat(ctx, 'rgba(0,0,0,0.1)', () => ctx.rect(x + width * 0.18, y - s * 0.85, width * 0.32, s * 0.85));
      ink(ctx, s, CANDY.white, () => roundRect(ctx, x - width * 0.68, y - s * 0.9, width * 1.36, s * 0.08, s * 0.02));
      const roof = pick(rng, [CANDY.sky, CANDY.yellow, CANDY.purple, CANDY.orange]);
      ink(ctx, s, roof, () => {
        ctx.moveTo(x - width * 0.72, y - s * 0.9);
        ctx.quadraticCurveTo(x - width * 0.2, y - s * 1.05, x, y - s * 1.36);
        ctx.quadraticCurveTo(x + width * 0.2, y - s * 1.05, x + width * 0.72, y - s * 0.9);
        ctx.closePath();
      });
      ctx.lineWidth = lineFor(s);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 1.36);
      ctx.lineTo(x, y - s * 1.5);
      ctx.stroke();
      ink(ctx, s, CANDY.yellow, () => {
        ctx.moveTo(x, y - s * 1.5);
        ctx.lineTo(x + s * 0.16, y - s * 1.46);
        ctx.lineTo(x, y - s * 1.41);
        ctx.closePath();
      });
      roundWindow(ctx, s, x, y - s * 0.62, s * 0.05, CANDY.yellow);
      archDoor(ctx, s, x, y, width * 0.46, s * 0.24, CANDY.choco);
    },

    /** A teapot house with a spout, a handle and a lid. */
    teapotHouse(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 1);
      const body = pal.night ? '#7fe0ff' : pick(rng, [CANDY.mint, CANDY.sky, '#ff9fc6', '#ffd27a']);
      ctx.lineWidth = s * 0.07;
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.arc(x - s * 0.42, y - s * 0.38, s * 0.14, Math.PI * 0.5, Math.PI * 1.5);
      ctx.stroke();
      ctx.lineWidth = s * 0.045;
      ctx.strokeStyle = shade(body, -0.15);
      ctx.stroke();
      ink(ctx, s, body, () => {
        ctx.moveTo(x + s * 0.3, y - s * 0.32);
        ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.32, x + s * 0.6, y - s * 0.62);
        ctx.lineTo(x + s * 0.66, y - s * 0.6);
        ctx.quadraticCurveTo(x + s * 0.58, y - s * 0.22, x + s * 0.3, y - s * 0.16);
        ctx.closePath();
      });
      ink(ctx, s, body, () => ctx.ellipse(x, y - s * 0.35, s * 0.42, s * 0.35, 0, 0, Math.PI * 2));
      flat(ctx, shade(body, -0.14), () => ctx.ellipse(x + s * 0.08, y - s * 0.12, s * 0.3, s * 0.08, 0, 0, Math.PI * 2));
      flat(ctx, shade(body, 0.22), () => ctx.ellipse(x - s * 0.2, y - s * 0.5, s * 0.1, s * 0.06, -0.5, 0, Math.PI * 2));
      ink(ctx, s, CANDY.white, () => ctx.ellipse(x, y - s * 0.69, s * 0.25, s * 0.06, 0, 0, Math.PI * 2));
      ink(ctx, s, CANDY.pink, () => {
        ctx.moveTo(x - s * 0.2, y - s * 0.7);
        ctx.quadraticCurveTo(x, y - s * 0.92, x + s * 0.2, y - s * 0.7);
        ctx.closePath();
      });
      ink(ctx, s, CANDY.yellow, () => ctx.arc(x, y - s * 0.86, s * 0.06, 0, Math.PI * 2));
      archDoor(ctx, s, x - s * 0.04, y - s * 0.01, s * 0.17, s * 0.27, CANDY.choco);
      roundWindow(ctx, s, x + s * 0.2, y - s * 0.4, s * 0.055);
    },

    /** A hill of three big gumdrops. */
    gumdropHill(ctx, x, y, s, rng) {
      groundShadow(ctx, x, y, s * 1.2);
      const colors = [CANDY.red, CANDY.mint, CANDY.yellow, CANDY.purple, CANDY.orange, CANDY.pink];
      const first = Math.floor(rng() * colors.length);
      gumdrop(ctx, s, x + s * 0.3, y, s * 0.26, colors[(first + 2) % colors.length]);
      gumdrop(ctx, s, x - s * 0.3, y, s * 0.3, colors[(first + 4) % colors.length]);
      gumdrop(ctx, s, x, y + s * 0.02, s * 0.4, colors[first]);
    },

    /** A palm tree with a curved trunk and full fronds. */
    palmTree(ctx, x, y, s, rng) {
      groundShadow(ctx, x, y, s * 0.6);
      const lean = rng() < 0.5 ? -1 : 1;
      const top_x = x + lean * s * 0.2;
      const top_y = y - s * 0.86;
      ink(ctx, s, CANDY.wood, () => {
        ctx.moveTo(x - s * 0.08, y);
        ctx.quadraticCurveTo(x - s * 0.06 + lean * s * 0.02, y - s * 0.5, top_x - s * 0.04, top_y);
        ctx.lineTo(top_x + s * 0.04, top_y);
        ctx.quadraticCurveTo(x + s * 0.06 + lean * s * 0.04, y - s * 0.5, x + s * 0.08, y);
        ctx.closePath();
      });
      ctx.strokeStyle = shade(CANDY.wood, -0.22);
      ctx.lineWidth = lineFor(s) * 0.8;
      for (let ring = 1; ring < 6; ring += 1) {
        const t = ring / 6;
        const cx = x + (top_x - x) * t * t;
        const cy = y - s * 0.86 * t;
        const half = s * (0.075 - t * 0.035);
        ctx.beginPath();
        ctx.moveTo(cx - half, cy + 2);
        ctx.quadraticCurveTo(cx, cy - 2, cx + half, cy + 2);
        ctx.stroke();
      }
      const leaf = (angle, length, color) => {
        ctx.save();
        ctx.translate(top_x, top_y);
        ctx.rotate(angle);
        ink(ctx, s, color, () => {
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(length * 0.45, -length * 0.32, length, length * 0.12);
          ctx.quadraticCurveTo(length * 0.5, length * 0.02, 0, 0);
          ctx.closePath();
        });
        ctx.restore();
      };
      [[-2.75, 0.5, '#2e9c58'], [-0.4, 0.5, '#2e9c58'], [-2.1, 0.46, '#3cb86a'], [-1.05, 0.46, '#3cb86a'], [-1.57, 0.4, '#4fcc7a'], [0.25, 0.4, '#3cb86a'], [-3.4, 0.4, '#3cb86a']].forEach(([angle, length, color]) => leaf(angle, s * length, color));
      ink(ctx, s, CANDY.woodDark, () => ctx.arc(top_x - s * 0.05, top_y + s * 0.04, s * 0.05, 0, Math.PI * 2));
      ink(ctx, s, CANDY.woodDark, () => ctx.arc(top_x + s * 0.05, top_y + s * 0.05, s * 0.05, 0, Math.PI * 2));
    },

    /** A snow igloo with an arched entrance. */
    iglooHouse(ctx, x, y, s) {
      groundShadow(ctx, x, y, s * 1.1);
      ink(ctx, s, '#f4fbff', () => {
        ctx.moveTo(x - s * 0.5, y);
        ctx.bezierCurveTo(x - s * 0.5, y - s * 0.72, x + s * 0.5, y - s * 0.72, x + s * 0.5, y);
        ctx.closePath();
      });
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.5, y);
      ctx.bezierCurveTo(x - s * 0.5, y - s * 0.72, x + s * 0.5, y - s * 0.72, x + s * 0.5, y);
      ctx.closePath();
      ctx.clip();
      ctx.strokeStyle = '#b9dcf2';
      ctx.lineWidth = lineFor(s) * 0.8;
      for (let row = 1; row < 4; row += 1) {
        ctx.beginPath();
        ctx.moveTo(x - s * 0.6, y - row * s * 0.14);
        ctx.lineTo(x + s * 0.6, y - row * s * 0.14);
        ctx.stroke();
        for (let col = -3; col <= 3; col += 1) {
          const bx = x + (col + (row % 2) * 0.5) * s * 0.18;
          ctx.beginPath();
          ctx.moveTo(bx, y - row * s * 0.14);
          ctx.lineTo(bx, y - (row - 1) * s * 0.14);
          ctx.stroke();
        }
      }
      flat(ctx, 'rgba(160,200,230,0.35)', () => ctx.ellipse(x + s * 0.25, y - s * 0.12, s * 0.26, s * 0.2, 0, 0, Math.PI * 2));
      ctx.restore();
      ink(ctx, s, '#e8f6ff', () => {
        ctx.moveTo(x - s * 0.15, y);
        ctx.lineTo(x - s * 0.15, y - s * 0.16);
        ctx.arc(x, y - s * 0.16, s * 0.15, Math.PI, 0);
        ctx.lineTo(x + s * 0.15, y);
        ctx.closePath();
      });
      flat(ctx, '#5a6fa8', () => {
        ctx.moveTo(x - s * 0.09, y);
        ctx.lineTo(x - s * 0.09, y - s * 0.14);
        ctx.arc(x, y - s * 0.14, s * 0.09, Math.PI, 0);
        ctx.lineTo(x + s * 0.09, y);
      });
    },

    /** A striped carnival tent with a flag. */
    carouselTent(ctx, x, y, s, rng) {
      groundShadow(ctx, x, y, s * 1);
      const stripe = pick(rng, [CANDY.red, CANDY.purple, CANDY.sky]);
      ink(ctx, s, CANDY.white, () => ctx.rect(x - s * 0.36, y - s * 0.42, s * 0.72, s * 0.42));
      ctx.fillStyle = stripe;
      for (let band = 0; band < 4; band += 1) ctx.fillRect(x - s * 0.36 + (band * 2 + 0.5) * s * 0.09, y - s * 0.42 + lineFor(s) / 2, s * 0.09, s * 0.42 - lineFor(s));
      ctx.lineWidth = lineFor(s);
      ctx.strokeStyle = INK;
      ctx.strokeRect(x - s * 0.36, y - s * 0.42, s * 0.72, s * 0.42);
      ink(ctx, s, CANDY.choco, () => {
        ctx.moveTo(x - s * 0.1, y);
        ctx.lineTo(x, y - s * 0.24);
        ctx.lineTo(x + s * 0.1, y);
        ctx.closePath();
      });
      ink(ctx, s, CANDY.white, () => {
        ctx.moveTo(x - s * 0.46, y - s * 0.42);
        ctx.lineTo(x, y - s * 0.95);
        ctx.lineTo(x + s * 0.46, y - s * 0.42);
        ctx.closePath();
      });
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x - s * 0.46, y - s * 0.42);
      ctx.lineTo(x, y - s * 0.95);
      ctx.lineTo(x + s * 0.46, y - s * 0.42);
      ctx.closePath();
      ctx.clip();
      ctx.fillStyle = stripe;
      for (let band = -3; band <= 3; band += 2) {
        ctx.beginPath();
        ctx.moveTo(x, y - s * 0.95);
        ctx.lineTo(x + band * s * 0.13, y - s * 0.4);
        ctx.lineTo(x + (band + 1) * s * 0.13, y - s * 0.4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.lineWidth = lineFor(s);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.46, y - s * 0.42);
      ctx.lineTo(x, y - s * 0.95);
      ctx.lineTo(x + s * 0.46, y - s * 0.42);
      ctx.closePath();
      ctx.stroke();
      for (let bump = 0; bump < 6; bump += 1) ink(ctx, s, bump % 2 ? stripe : CANDY.white, () => ctx.arc(x - s * 0.4 + bump * s * 0.16, y - s * 0.42, s * 0.08, 0, Math.PI));
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.95);
      ctx.lineTo(x, y - s * 1.12);
      ctx.stroke();
      ink(ctx, s, CANDY.yellow, () => {
        ctx.moveTo(x, y - s * 1.12);
        ctx.lineTo(x + s * 0.15, y - s * 1.07);
        ctx.lineTo(x, y - s * 1.02);
        ctx.closePath();
      });
    },

    /** A striped lighthouse with a glowing lamp room. */
    lighthouse(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.6);
      const band = pick(rng, [CANDY.red, CANDY.sky, CANDY.purple]);
      const tower = () => {
        ctx.moveTo(x - s * 0.2, y);
        ctx.lineTo(x - s * 0.13, y - s * 0.95);
        ctx.lineTo(x + s * 0.13, y - s * 0.95);
        ctx.lineTo(x + s * 0.2, y);
        ctx.closePath();
      };
      ink(ctx, s, CANDY.white, tower);
      ctx.save();
      ctx.beginPath();
      tower();
      ctx.clip();
      ctx.fillStyle = band;
      for (let ring = 0; ring < 4; ring += 1) ctx.fillRect(x - s * 0.3, y - s * (0.2 + ring * 0.24), s * 0.6, s * 0.12);
      flat(ctx, 'rgba(0,0,0,0.1)', () => ctx.rect(x + s * 0.04, y - s * 0.95, s * 0.2, s * 0.95));
      ctx.restore();
      ctx.lineWidth = lineFor(s);
      ctx.strokeStyle = INK;
      ctx.beginPath();
      tower();
      ctx.stroke();
      ink(ctx, s, shade(band, -0.15), () => roundRect(ctx, x - s * 0.2, y - s * 1.0, s * 0.4, s * 0.07, s * 0.02));
      ink(ctx, s, pal.night ? '#fff07a' : '#ffe680', () => ctx.rect(x - s * 0.11, y - s * 1.17, s * 0.22, s * 0.17));
      if (pal.night) flat(ctx, 'rgba(255,240,140,0.25)', () => ctx.arc(x, y - s * 1.09, s * 0.3, 0, Math.PI * 2));
      ink(ctx, s, band, () => {
        ctx.moveTo(x - s * 0.15, y - s * 1.17);
        ctx.quadraticCurveTo(x, y - s * 1.36, x + s * 0.15, y - s * 1.17);
        ctx.closePath();
      });
      archDoor(ctx, s, x, y, s * 0.13, s * 0.2, CANDY.choco);
    },

    /** A layered caramel rock with flat terraces. */
    mesa(ctx, x, y, s) {
      groundShadow(ctx, x, y, s * 1.3);
      const tones = ['#d9853f', '#e99a52', '#f5b46b'];
      ink(ctx, s, tones[0], () => {
        ctx.moveTo(x - s * 0.62, y);
        ctx.lineTo(x - s * 0.5, y - s * 0.42);
        ctx.lineTo(x - s * 0.28, y - s * 0.5);
        ctx.lineTo(x - s * 0.22, y - s * 0.8);
        ctx.lineTo(x + s * 0.18, y - s * 0.84);
        ctx.lineTo(x + s * 0.26, y - s * 0.52);
        ctx.lineTo(x + s * 0.5, y - s * 0.46);
        ctx.lineTo(x + s * 0.64, y);
        ctx.closePath();
      });
      flat(ctx, tones[1], () => {
        ctx.moveTo(x - s * 0.22, y - s * 0.8);
        ctx.lineTo(x + s * 0.18, y - s * 0.84);
        ctx.lineTo(x + s * 0.2, y - s * 0.72);
        ctx.lineTo(x - s * 0.2, y - s * 0.68);
      });
      flat(ctx, tones[1], () => {
        ctx.moveTo(x - s * 0.5, y - s * 0.42);
        ctx.lineTo(x - s * 0.28, y - s * 0.5);
        ctx.lineTo(x - s * 0.27, y - s * 0.4);
        ctx.lineTo(x - s * 0.48, y - s * 0.34);
      });
      flat(ctx, 'rgba(90,30,10,0.18)', () => {
        ctx.moveTo(x + s * 0.06, y - s * 0.84);
        ctx.lineTo(x + s * 0.18, y - s * 0.84);
        ctx.lineTo(x + s * 0.26, y - s * 0.52);
        ctx.lineTo(x + s * 0.5, y - s * 0.46);
        ctx.lineTo(x + s * 0.64, y);
        ctx.lineTo(x + s * 0.2, y);
      });
      ctx.strokeStyle = 'rgba(90,30,10,0.35)';
      ctx.lineWidth = lineFor(s) * 0.8;
      [[-0.4, -0.2, -0.05], [0.1, -0.3, 0.02], [0.4, -0.18, 0.06]].forEach(([dx, dy, tilt]) => {
        ctx.beginPath();
        ctx.moveTo(x + s * (dx - 0.1), y + s * dy);
        ctx.lineTo(x + s * (dx + 0.1), y + s * (dy + tilt));
        ctx.stroke();
      });
    },

    /** The gate in a candy fence where the road crosses into the next episode. */
    gateArch(ctx, x, y, s, rng, pal) {
      const stripe = pal.night ? '#ff7fd0' : CANDY.red;
      const pillar = (px) => {
        ink(ctx, s, CANDY.white, () => roundRect(ctx, px - s * 0.07, y - s * 0.62, s * 0.14, s * 0.62, s * 0.03));
        ctx.save();
        ctx.beginPath();
        ctx.rect(px - s * 0.07, y - s * 0.62, s * 0.14, s * 0.62);
        ctx.clip();
        ctx.fillStyle = stripe;
        for (let band = 0; band < 6; band += 1) {
          ctx.beginPath();
          ctx.moveTo(px - s * 0.1, y - band * s * 0.11);
          ctx.lineTo(px + s * 0.1, y - band * s * 0.11 - s * 0.08);
          ctx.lineTo(px + s * 0.1, y - band * s * 0.11 - s * 0.12);
          ctx.lineTo(px - s * 0.1, y - band * s * 0.11 - s * 0.04);
          ctx.fill();
        }
        ctx.restore();
        ctx.lineWidth = lineFor(s);
        ctx.strokeStyle = INK;
        ctx.beginPath();
        roundRect(ctx, px - s * 0.07, y - s * 0.62, s * 0.14, s * 0.62, s * 0.03);
        ctx.stroke();
        ink(ctx, s, CANDY.yellow, () => ctx.arc(px, y - s * 0.68, s * 0.08, 0, Math.PI * 2));
      };
      // The arch: a thick candy band over the road.
      ink(ctx, s, CANDY.pink, () => {
        ctx.moveTo(x - s * 0.62, y - s * 0.5);
        ctx.quadraticCurveTo(x, y - s * 1.05, x + s * 0.62, y - s * 0.5);
        ctx.lineTo(x + s * 0.5, y - s * 0.46);
        ctx.quadraticCurveTo(x, y - s * 0.88, x - s * 0.5, y - s * 0.46);
        ctx.closePath();
      });
      flat(ctx, 'rgba(255,255,255,0.45)', () => {
        ctx.moveTo(x - s * 0.4, y - s * 0.62);
        ctx.quadraticCurveTo(x, y - s * 0.93, x + s * 0.4, y - s * 0.62);
        ctx.quadraticCurveTo(x, y - s * 0.88, x - s * 0.4, y - s * 0.62);
      });
      [-0.36, -0.12, 0.12, 0.36].forEach((dx, index) => {
        const ax = x + s * dx;
        const ay = y - s * (0.6 + 0.24 * (1 - (dx / 0.62) * (dx / 0.62)));
        ink(ctx, s * 0.7, [CANDY.yellow, CANDY.mint, CANDY.sky, CANDY.orange][index], () => ctx.arc(ax, ay, s * 0.045, 0, Math.PI * 2));
      });
      pillar(x - s * 0.56);
      pillar(x + s * 0.56);
    },
  };

  // ---------------------------------------------------------------- small props (s: about their height)

  const SMALL_PROPS = {
    lampPost(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.4);
      ink(ctx, s, '#5b4a7a', () => roundRect(ctx, x - s * 0.04, y - s * 0.95, s * 0.08, s * 0.95, s * 0.03));
      ink(ctx, s, '#5b4a7a', () => roundRect(ctx, x - s * 0.1, y - s * 0.1, s * 0.2, s * 0.1, s * 0.03));
      if (pal.night) flat(ctx, 'rgba(255,236,140,0.3)', () => ctx.arc(x, y - s * 1.04, s * 0.26, 0, Math.PI * 2));
      ink(ctx, s, '#fff2a8', () => roundRect(ctx, x - s * 0.1, y - s * 1.14, s * 0.2, s * 0.2, s * 0.06));
      flat(ctx, '#ffd23f', () => ctx.arc(x, y - s * 1.04, s * 0.05, 0, Math.PI * 2));
      ink(ctx, s, CANDY.pink, () => {
        ctx.moveTo(x - s * 0.15, y - s * 1.13);
        ctx.quadraticCurveTo(x, y - s * 1.3, x + s * 0.15, y - s * 1.13);
        ctx.closePath();
      });
    },
    bush(ctx, x, y, s, rng, pal) {
      groundShadow(ctx, x, y, s * 0.9);
      const leaves = pal.night ? '#4a55c9' : shade(pal.tree, 0.04);
      blob(ctx, s, leaves, [[x - s * 0.22, y - s * 0.2, s * 0.22], [x + s * 0.2, y - s * 0.2, s * 0.24], [x, y - s * 0.34, s * 0.27]]);
      flat(ctx, shade(leaves, 0.2), () => ctx.ellipse(x - s * 0.06, y - s * 0.44, s * 0.12, s * 0.06, -0.3, 0, Math.PI * 2));
      if (rng() < 0.6) {
        const berry = pick(rng, [CANDY.red, CANDY.pink, CANDY.yellow]);
        [[-0.18, -0.26], [0.14, -0.32], [0.02, -0.18]].forEach(([dx, dy]) => flat(ctx, berry, () => ctx.arc(x + s * dx, y + s * dy, s * 0.04, 0, Math.PI * 2)));
      }
    },
    flowerPatch(ctx, x, y, s, rng, pal) {
      flat(ctx, shade(pal.ground, -0.08), () => ctx.ellipse(x, y - s * 0.02, s * 0.45, s * 0.12, 0, 0, Math.PI * 2));
      const colors = [CANDY.pink, CANDY.yellow, CANDY.white, CANDY.purple, CANDY.sky];
      [[-0.25, -0.1], [0.05, -0.2], [0.28, -0.08], [-0.06, -0.02]].forEach(([dx, dy]) => {
        const fx = x + s * dx;
        const fy = y + s * dy;
        ctx.strokeStyle = '#3d9b58';
        ctx.lineWidth = Math.max(1, s * 0.03);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(fx, fy - s * 0.16);
        ctx.stroke();
        const petal = pick(rng, colors);
        for (let leaf = 0; leaf < 5; leaf += 1) {
          const angle = (leaf / 5) * Math.PI * 2;
          ink(ctx, s * 0.5, petal, () => ctx.arc(fx + Math.cos(angle) * s * 0.06, fy - s * 0.2 + Math.sin(angle) * s * 0.06, s * 0.045, 0, Math.PI * 2));
        }
        flat(ctx, CANDY.yellow, () => ctx.arc(fx, fy - s * 0.2, s * 0.035, 0, Math.PI * 2));
      });
    },
    stone(ctx, x, y, s, rng, pal) {
      const color = pal.night ? '#7d72b8' : mix(shade(pal.dark, -0.1), '#b7a6c9', 0.45);
      ink(ctx, s, color, () => {
        ctx.moveTo(x - s * 0.36, y);
        ctx.quadraticCurveTo(x - s * 0.34, y - s * 0.3, x - s * 0.05, y - s * 0.34);
        ctx.quadraticCurveTo(x + s * 0.3, y - s * 0.32, x + s * 0.36, y);
        ctx.closePath();
      });
      flat(ctx, shade(color, 0.2), () => ctx.ellipse(x - s * 0.1, y - s * 0.24, s * 0.12, s * 0.05, -0.2, 0, Math.PI * 2));
    },
    smallMushroom(ctx, x, y, s, rng) {
      ink(ctx, s, CANDY.cream, () => roundRect(ctx, x - s * 0.07, y - s * 0.3, s * 0.14, s * 0.3, s * 0.04));
      const cap = pick(rng, [CANDY.red, CANDY.orange, CANDY.purple]);
      ink(ctx, s, cap, () => {
        ctx.moveTo(x - s * 0.24, y - s * 0.28);
        ctx.bezierCurveTo(x - s * 0.24, y - s * 0.6, x + s * 0.24, y - s * 0.6, x + s * 0.24, y - s * 0.28);
        ctx.closePath();
      });
      flat(ctx, CANDY.white, () => ctx.arc(x - s * 0.08, y - s * 0.4, s * 0.04, 0, Math.PI * 2));
      flat(ctx, CANDY.white, () => ctx.arc(x + s * 0.09, y - s * 0.45, s * 0.035, 0, Math.PI * 2));
    },
    lollipop(ctx, x, y, s, rng) {
      ink(ctx, s, CANDY.white, () => ctx.rect(x - s * 0.03, y - s * 0.62, s * 0.06, s * 0.62));
      const color = pick(rng, [CANDY.pink, CANDY.sky, CANDY.yellow, CANDY.mint]);
      ink(ctx, s, color, () => ctx.arc(x, y - s * 0.78, s * 0.2, 0, Math.PI * 2));
      ctx.strokeStyle = CANDY.white;
      ctx.lineWidth = s * 0.05;
      ctx.beginPath();
      ctx.arc(x, y - s * 0.78, s * 0.11, 0.4, Math.PI * 1.7);
      ctx.stroke();
    },
    cactus(ctx, x, y, s) {
      const green = '#4cb86a';
      ink(ctx, s, green, () => roundRect(ctx, x - s * 0.09, y - s * 0.8, s * 0.18, s * 0.8, s * 0.09));
      ink(ctx, s, green, () => roundRect(ctx, x - s * 0.3, y - s * 0.55, s * 0.13, s * 0.3, s * 0.065));
      ink(ctx, s, green, () => roundRect(ctx, x + s * 0.17, y - s * 0.62, s * 0.13, s * 0.28, s * 0.065));
      flat(ctx, '#ff7fb6', () => ctx.arc(x, y - s * 0.82, s * 0.06, 0, Math.PI * 2));
    },
    snowPine(ctx, x, y, s, rng, pal) {
      SET_PIECES.pineTree(ctx, x, y, s, rng, Object.assign({}, pal, { ground: '#f4fbff' }));
    },
  };

  // ---------------------------------------------------------------- what stands in which land

  /** Each land family's set pieces (three or four are picked per episode) and small props. */
  const FAMILY_ART = {
    gumdrop_meadow: { pieces: ['domeCottage', 'mushroomHouse', 'fruitTree', 'windmill', 'gumdropHill', 'cottonTree'], small: ['bush', 'flowerPatch', 'stone', 'smallMushroom'] },
    lollipop_forest: { pieces: ['cottonTree', 'mushroomHouse', 'candyTower', 'gumdropHill', 'cupcakeHouse', 'fruitTree'], small: ['lollipop', 'bush', 'flowerPatch', 'smallMushroom'] },
    frosted_peaks: { pieces: ['pineTree', 'iglooHouse', 'candyTower', 'domeCottage', 'cottonTree'], small: ['snowPine', 'stone', 'lollipop'] },
    caramel_canyon: { pieces: ['mesa', 'windmill', 'cupcakeHouse', 'palmTree', 'candyTower'], small: ['cactus', 'stone', 'bush'] },
    starlight_sky: { pieces: ['lighthouse', 'mushroomHouse', 'candyTower', 'cottonTree', 'domeCottage'], small: ['smallMushroom', 'stone', 'flowerPatch'] },
    jelly_lagoon: { pieces: ['palmTree', 'lighthouse', 'domeCottage', 'gumdropHill', 'teapotHouse'], small: ['bush', 'stone', 'flowerPatch'] },
    cookie_town: { pieces: ['domeCottage', 'cupcakeHouse', 'teapotHouse', 'windmill', 'fruitTree', 'candyTower'], small: ['bush', 'flowerPatch', 'lollipop'] },
    sorbet_desert: { pieces: ['mesa', 'palmTree', 'teapotHouse', 'candyTower', 'gumdropHill'], small: ['cactus', 'stone', 'lollipop'] },
    midnight_carnival: { pieces: ['carouselTent', 'candyTower', 'lighthouse', 'cottonTree', 'teapotHouse'], small: ['lollipop', 'smallMushroom', 'stone'] },
    cloud_kitchen: { pieces: ['cupcakeHouse', 'teapotHouse', 'cottonTree', 'domeCottage', 'gumdropHill'], small: ['lollipop', 'flowerPatch', 'bush'] },
    glacier_gelato: { pieces: ['iglooHouse', 'pineTree', 'candyTower', 'teapotHouse', 'cottonTree'], small: ['snowPine', 'stone', 'lollipop'] },
    sunrise_orchard: { pieces: ['fruitTree', 'windmill', 'domeCottage', 'mushroomHouse', 'cupcakeHouse'], small: ['bush', 'flowerPatch', 'smallMushroom'] },
  };

  function artOf(family) {
    return FAMILY_ART[family] || FAMILY_ART.gumdrop_meadow;
  }

  // Sizes (map px) the sprite atlas draws each kind at; the map scales them on its curve.
  const PIECE_SIZE = 150;
  const SMALL_SIZE = 64;
  // Atlas cells: wide and tall enough for every kind, with the ground point at (anchor_x, anchor_y).
  const CELL = { w: 1.5, h: 1.62, anchor_x: 0.75, anchor_y: 1.52 };

  /**
   * Paints a family's set pieces, small props and the gate arch once into one atlas canvas (ratio: canvas pixels per
   * map pixel). Returns { canvas, cells: { kind: { sx, sy, sw, sh, size } }, anchor_x, anchor_y } (cell numbers in
   * canvas pixels; anchor as a share of the cell).
   */
  function buildAtlas(family, land, ratio, createCanvas) {
    const pal = paletteOf(land);
    const art = artOf(family);
    const kinds = art.pieces.map((kind) => ({ kind, size: PIECE_SIZE, paint: SET_PIECES[kind] }))
      .concat([{ kind: 'gateArch', size: PIECE_SIZE * 1.3, paint: SET_PIECES.gateArch }])
      .concat(art.small.concat(['lampPost']).map((kind) => ({ kind, size: SMALL_SIZE, paint: SMALL_PROPS[kind] })));
    const columns = 4;
    let x = 0;
    let y = 0;
    let row_h = 0;
    let width = 0;
    const placed = kinds.map((entry, index) => {
      const cell_w = Math.ceil(entry.size * CELL.w);
      const cell_h = Math.ceil(entry.size * CELL.h);
      if (index > 0 && (index % columns === 0 || (entry.size !== kinds[index - 1].size && x > 0))) {
        x = 0;
        y += row_h;
        row_h = 0;
      }
      const spot = { entry, x, y, cell_w, cell_h };
      x += cell_w;
      row_h = Math.max(row_h, cell_h);
      width = Math.max(width, x);
      return spot;
    });
    const height = y + row_h;
    const canvas = createCanvas(Math.ceil(width * ratio), Math.ceil(height * ratio));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.scale(ratio, ratio);
    const cells = {};
    placed.forEach(({ entry, x: cx, y: cy, cell_w, cell_h }, index) => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx, cy, cell_w, cell_h);
      ctx.clip();
      entry.paint(ctx, cx + cell_w * (CELL.anchor_x / CELL.w), cy + cell_h * (CELL.anchor_y / CELL.h), entry.size, UTIL.createRng(index * 7919 + 13), pal);
      ctx.restore();
      cells[entry.kind] = { sx: cx * ratio, sy: cy * ratio, sw: cell_w * ratio, sh: cell_h * ratio, size: entry.size, w: cell_w, h: cell_h };
    });
    return { canvas, cells, anchor_x: CELL.anchor_x / CELL.w, anchor_y: CELL.anchor_y / CELL.h };
  }

  // ---------------------------------------------------------------- ground, road and the episode doors

  /** The plateau: the land's colour, a few big flat hills well away from the road and some grass tufts. */
  function paintGround(ctx, width, height, land, road, rng) {
    const pal = paletteOf(land);
    ctx.fillStyle = pal.ground;
    ctx.fillRect(0, 0, width, height);
    const far = (x, y, margin) => {
      const at = road(y);
      return !at || Math.abs(x - at.x) > at.half + margin;
    };
    // Big flat hills: a lighter top over a darker foot, each a smooth shape.
    for (let hill = 0; hill < Math.round(height / 420) + 1; hill += 1) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const rx = 70 + rng() * 80;
        const x = rng() * width;
        const y = 140 + rng() * (height - 280);
        if (!far(x, y, rx + 30)) continue;
        flat(ctx, shade(pal.ground, -0.07), () => ctx.ellipse(x, y + 10, rx, rx * 0.36, 0, 0, Math.PI * 2));
        flat(ctx, shade(pal.ground, 0.06), () => ctx.ellipse(x, y, rx * 0.94, rx * 0.3, 0, 0, Math.PI * 2));
        break;
      }
    }
    // Grass tufts (a few, crisp).
    ctx.strokeStyle = shade(pal.ground, -0.2);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    for (let tuft = 0; tuft < Math.round((width * height) / 26000); tuft += 1) {
      const x = rng() * width;
      const y = 60 + rng() * (height - 120);
      if (!far(x, y, 16)) continue;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 7);
      ctx.lineTo(x - 2, y);
      ctx.lineTo(x, y - 10);
      ctx.lineTo(x + 2, y);
      ctx.lineTo(x + 6, y - 6);
      ctx.stroke();
    }
  }

  /** The road from y_from to y_to (y_from < y_to): edges from road(y) = { x, half }. */
  function paintRoad(ctx, y_from, y_to, land, road) {
    const pal = paletteOf(land);
    const left = [];
    const right = [];
    for (let y = y_from; y <= y_to + 0.01; y += 6) {
      const at = road(Math.min(y, y_to));
      if (!at) continue;
      left.push([at.x - at.half, Math.min(y, y_to)]);
      right.push([at.x + at.half, Math.min(y, y_to)]);
    }
    if (left.length < 2) return;
    const outline = () => {
      ctx.beginPath();
      left.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      for (let index = right.length - 1; index >= 0; index -= 1) ctx.lineTo(right[index][0], right[index][1]);
      ctx.closePath();
    };
    const side = (points, offset, color, line_width) => {
      ctx.beginPath();
      points.forEach(([x, y], index) => (index ? ctx.lineTo(x + offset, y) : ctx.moveTo(x + offset, y)));
      ctx.strokeStyle = color;
      ctx.lineWidth = line_width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'butt';
      ctx.stroke();
    };
    outline();
    ctx.fillStyle = pal.road;
    ctx.fill();
    // A darker inner edge (the path's gentle camber), then the rim along both sides only, so road pieces painted one
    // after another join without a line across the road.
    ctx.save();
    outline();
    ctx.clip();
    side(left, 0, shade(pal.road, -0.08), 14);
    side(right, 0, shade(pal.road, -0.08), 14);
    ctx.restore();
    side(left, -3, pal.rim, 7);
    side(right, 3, pal.rim, 7);
  }

  /** The kinds of door between two episodes, in turn. */
  const DOORS = ['stairs', 'river', 'bridge', 'gate'];

  /**
   * The door between the lower episode (below seam_y) and the upper one (above it): a band across the land from
   * seam_y - 14 to seam_y + 96 (map px, canvas y). Painted the same in both episodes' canvases, each showing its part.
   * Returns standing items (the gate arch) for the caller's billboards.
   */
  function paintDoor(ctx, width, seam_y, kind, lower_land, upper_land, road, rng) {
    const lower = paletteOf(lower_land);
    const upper = paletteOf(upper_land);
    const top = seam_y - 14;
    const bottom = seam_y + 96;
    const middle = (top + bottom) / 2;
    const wave = (x, phase, amount) => Math.sin(x * 0.045 + phase) * amount + Math.sin(x * 0.11 + phase * 2) * amount * 0.4;
    const across = (y_of) => {
      for (let x = -10; x <= width + 10; x += 8) ctx.lineTo(x, y_of(x));
    };
    const fillBetween = (fill, y_top_of, y_bottom_of) => {
      ctx.beginPath();
      ctx.moveTo(-10, y_top_of(-10));
      across(y_top_of);
      for (let x = width + 10; x >= -10; x -= 8) ctx.lineTo(x, y_bottom_of(x));
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    const at = road(middle) || { x: width / 2, half: 90 };
    const standing = [];
    // The upper land's ground and road reach down to the door's top edge.
    const lip_y = (x) => top + 6 + wave(x, 1.3, 4);
    fillBetween(upper.ground, () => seam_y - 140, lip_y);
    paintRoad(ctx, seam_y - 140, top + 8, upper_land, road);
    if (kind === 'stairs') {
      // A cliff face below the upper plateau; wooden stairs climb it along the road.
      const foot_y = (x) => bottom - 8 + wave(x, 4.1, 3);
      fillBetween(upper.cliff, lip_y, foot_y);
      fillBetween(shade(upper.cliff, -0.16), (x) => foot_y(x) - 18, foot_y);
      ctx.strokeStyle = shade(upper.cliff, -0.28);
      ctx.lineWidth = 2.5;
      for (let crack = 0; crack < Math.round(width / 70); crack += 1) {
        const x = rng() * width;
        if (Math.abs(x - at.x) < at.half + 20) continue;
        ctx.beginPath();
        ctx.moveTo(x, lip_y(x) + 10);
        ctx.lineTo(x + (rng() - 0.5) * 14, lip_y(x) + 30 + rng() * 30);
        ctx.stroke();
      }
      ctx.strokeStyle = upper.light;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-10, lip_y(-10));
      across(lip_y);
      ctx.stroke();
      fillBetween(shade(lower.ground, -0.12), foot_y, (x) => foot_y(x) + 14);
      // Stairs: planks from the foot up to the lip, a little narrower towards the top.
      const steps = 6;
      for (let step = 0; step < steps; step += 1) {
        const t0 = step / steps;
        const y0 = foot_y(at.x) - t0 * (foot_y(at.x) - lip_y(at.x));
        const y1 = foot_y(at.x) - ((step + 1) / steps) * (foot_y(at.x) - lip_y(at.x));
        const half = at.half * (0.78 - t0 * 0.12);
        ink(ctx, 40, step % 2 ? CANDY.wood : shade(CANDY.wood, 0.1), () => roundRect(ctx, at.x - half, y1 - 2, half * 2, (y0 - y1) + 2, 5));
        flat(ctx, shade(CANDY.wood, -0.2), () => ctx.rect(at.x - half + 3, y0 - 4, half * 2 - 6, 3));
      }
    } else if (kind === 'river') {
      // A river across the land; stepping stones carry the road over it.
      const bank_top = (x) => lip_y(x) + 4;
      const water_top = (x) => top + 18 + wave(x, 2.2, 5);
      const water_bottom = (x) => bottom - 16 + wave(x, 5.3, 5);
      fillBetween(shade(upper.ground, -0.22), lip_y, water_top);
      fillBetween(lower.water, water_top, water_bottom);
      fillBetween(shade(lower.water, 0.12), water_top, (x) => water_top(x) + 8);
      fillBetween(mix(lower.ground, '#fff4dc', 0.5), water_bottom, (x) => water_bottom(x) + 12);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let ripple = 0; ripple < Math.round(width / 45); ripple += 1) {
        const x = rng() * width;
        const y = water_top(x) + 14 + rng() * Math.max(4, water_bottom(x) - water_top(x) - 28);
        ctx.beginPath();
        ctx.moveTo(x - 12, y);
        ctx.quadraticCurveTo(x, y - 5, x + 12, y);
        ctx.stroke();
      }
      void bank_top;
      const stones = 4;
      for (let stone = 0; stone < stones; stone += 1) {
        const t = (stone + 0.5) / stones;
        const y = water_bottom(at.x) - t * (water_bottom(at.x) - water_top(at.x));
        const x = at.x + (stone % 2 ? 1 : -1) * at.half * 0.22;
        const rx = at.half * 0.42;
        flat(ctx, 'rgba(20,60,110,0.25)', () => ctx.ellipse(x + 3, y + 5, rx, 9, 0, 0, Math.PI * 2));
        ink(ctx, 40, mix(lower.road, '#e3c39a', 0.4), () => ctx.ellipse(x, y, rx, 9.5, 0, 0, Math.PI * 2));
        flat(ctx, 'rgba(255,255,255,0.4)', () => ctx.ellipse(x - rx * 0.3, y - 3, rx * 0.35, 3, 0, 0, Math.PI * 2));
      }
    } else if (kind === 'bridge') {
      // A deep chasm; a plank bridge with rope rails spans it along the road.
      const near_lip = (x) => bottom - 12 + wave(x, 3.3, 4);
      fillBetween(upper.cliff, lip_y, (x) => lip_y(x) + 26);
      fillBetween(lower.night ? '#24185a' : mix(shade(upper.cliff, -0.3), '#3b2b70', 0.55), (x) => lip_y(x) + 26, near_lip);
      fillBetween('rgba(255,255,255,0.08)', (x) => lip_y(x) + 26, (x) => lip_y(x) + 40);
      fillBetween(shade(lower.ground, -0.18), (x) => near_lip(x) - 8, near_lip);
      ctx.strokeStyle = lower.light;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, near_lip(-10));
      across(near_lip);
      ctx.stroke();
      const y_low = near_lip(at.x) + 6;
      const y_high = lip_y(at.x) - 2;
      const half = at.half * 0.62;
      const planks = 7;
      for (let plank = 0; plank < planks; plank += 1) {
        const y0 = y_low - (plank / planks) * (y_low - y_high);
        const y1 = y_low - ((plank + 1) / planks) * (y_low - y_high);
        ink(ctx, 40, plank % 2 ? CANDY.wood : shade(CANDY.wood, 0.12), () => roundRect(ctx, at.x - half, y1 + 1, half * 2, y0 - y1 - 1, 3));
      }
      [-1, 1].forEach((side) => {
        ctx.strokeStyle = CANDY.woodDark;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(at.x + side * (half + 4), y_low);
        ctx.lineTo(at.x + side * (half + 4), y_high);
        ctx.stroke();
        [y_low, y_high].forEach((post_y) => ink(ctx, 40, CANDY.woodDark, () => roundRect(ctx, at.x + side * (half + 4) - 5, post_y - 22, 10, 26, 3)));
      });
    } else {
      // A candy fence across the land with a gate arch over the road.
      const fence_y = (x) => middle + wave(x, 0.7, 2);
      fillBetween(upper.ground, lip_y, fence_y);
      fillBetween(shade(upper.ground, -0.1), (x) => fence_y(x) - 10, fence_y);
      paintRoad(ctx, top, middle, upper_land, road);
      paintRoad(ctx, middle, bottom + 30, lower_land, road);
      const post = upper.night ? '#ff8fe0' : CANDY.pink;
      for (let x = 6; x < width; x += 22) {
        if (Math.abs(x - at.x) < at.half + 20) continue;
        const y = fence_y(x);
        ink(ctx, 40, CANDY.white, () => roundRect(ctx, x - 4, y - 30, 8, 30, 3));
        flat(ctx, post, () => ctx.rect(x - 4 + 1, y - 22, 6, 5));
        flat(ctx, post, () => ctx.rect(x - 4 + 1, y - 10, 6, 5));
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      [-22, -12].forEach((dy) => {
        [[-10, at.x - at.half - 20], [at.x + at.half + 20, width + 10]].forEach(([x0, x1]) => {
          ctx.beginPath();
          ctx.moveTo(x0, fence_y(x0) + dy);
          ctx.lineTo(x1, fence_y(x1) + dy);
          ctx.stroke();
        });
      });
      standing.push({ kind: 'gateArch', x: at.x, y: fence_y(at.x) + 2, size: at.half * 2 / (0.62 * 2) * 1.0, big: true, seed: 0.5 });
    }
    return standing;
  }

  // ---------------------------------------------------------------- an episode's land

  /**
   * Paints one episode's land into ctx (map px; the caller scales for sharpness) and returns the things that stand
   * on it, sorted far to near: { kind, x, y, size, seed }.
   *   width, height: the land's size; land / family: its colours and art; road(y): the road's middle and half width at
   *   canvas y (or null); episode: its number (picks the set pieces and the doors); lower/upper: the neighbouring
   *   episodes' lands for the doors at the bottom (seam at y = height) and top (seam at y = 0); doors: { bottom, top }
   *   kinds or null; unit: a prop size for the screen.
   */
  function paintEpisode(ctx, options) {
    const { width, height, land, family, road, episode, unit } = options;
    const rng = UTIL.createRng((episode + 101) * 7919 + 17);
    const pal = paletteOf(land);
    const art = artOf(family);
    paintGround(ctx, width, height, land, road, rng);
    const clear_top = options.doors && options.doors.top ? 125 : 0;
    const clear_bottom = options.doors && options.doors.bottom ? height - 40 : height;
    paintRoad(ctx, Math.max(-40, clear_top - 30), Math.min(height + 40, clear_bottom + 30), land, road);
    const standing = [];
    // (The bottom door's gate stands in the episode below, which draws it: keep only what stands on this land.)
    if (options.doors && options.doors.bottom) standing.push(...paintDoor(ctx, width, height, options.doors.bottom, options.lower || land, land, road, UTIL.createRng(episode * 31 + 5)).filter((item) => item.y < height));
    if (options.doors && options.doors.top) standing.push(...paintDoor(ctx, width, 0, options.doors.top, land, options.upper || land, road, UTIL.createRng((episode + 1) * 31 + 5)));
    // Set pieces: every one of the land's, once each, up the episode on alternating sides, close to the road and big
    // (the screen's edges cut into them, like the original's map).
    const order = art.pieces.slice();
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(rng() * (index + 1));
      [order[index], order[swap]] = [order[swap], order[index]];
    }
    const pieces = order.slice(0, Math.min(6, order.length));
    const low = clear_top + 30;
    const high = clear_bottom - 60;
    let side = rng() < 0.5 ? -1 : 1;
    const placed = [];
    pieces.forEach((kind, index) => {
      const y = high - ((index + 0.5) / pieces.length) * (high - low) + (rng() - 0.5) * 50;
      const at = road(y);
      if (!at) return;
      const size = unit * (4.3 + rng() * 0.8);
      const x = at.x + side * (at.half + 8 + size * 0.36 + rng() * unit * 0.8);
      side = -side;
      placed.push({ kind, x, y, size, seed: rng(), big: true });
    });
    // Clumps of the land's small things along the road's edges, between the set pieces (a different kind each time).
    const clump_kinds = art.small.slice().sort(() => rng() - 0.5);
    for (let clump = 0; clump < 6; clump += 1) {
      const clump_kind = clump_kinds[clump % clump_kinds.length];
      const y = low + ((clump + 0.5) / 6) * (high - low) + (rng() - 0.5) * 60;
      const at = road(y);
      if (!at) continue;
      const dir = clump % 2 ? 1 : -1;
      for (let bush = 0; bush < 2; bush += 1) {
        const bx = at.x + dir * (at.half + 10 + bush * unit * 0.9 + rng() * unit * 0.4);
        const by = y + (bush - 0.5) * unit * 0.5;
        if (placed.some((item) => item.big && Math.hypot(item.x - bx, (item.y - by) * 1.6) < item.size * 0.55)) continue;
        placed.push({ kind: clump_kind, x: bx, y: by, size: unit * (1.2 + rng() * 0.4), seed: rng(), big: false });
      }
    }
    // A second, distant ring of trees far out to the sides (seen near the horizon).
    const far_kinds = art.pieces.filter((kind) => /Tree|pine|cotton/i.test(kind));
    if (far_kinds.length) {
      for (let tree = 0; tree < 3; tree += 1) {
        const y = low + rng() * (high - low);
        const at = road(y);
        if (!at) continue;
        const dir = rng() < 0.5 ? -1 : 1;
        const x = at.x + dir * (at.half + unit * (6.5 + rng() * 3));
        if (x < unit || x > width - unit) continue;
        placed.push({ kind: far_kinds[Math.floor(rng() * far_kinds.length)], x, y, size: unit * (2.6 + rng() * 0.6), seed: rng(), big: true });
      }
    }
    // Lamp posts in pairs beside the road, and a few small props.
    for (let pair = 0; pair < 3; pair += 1) {
      const y = low + ((pair + 0.5) / 3) * (high - low) + (rng() - 0.5) * 40;
      const at = road(y);
      if (!at) continue;
      [-1, 1].forEach((dir) => placed.push({ kind: 'lampPost', x: at.x + dir * (at.half + 12), y, size: unit * 1.15, seed: rng(), big: false }));
    }
    for (let prop = 0; prop < 12; prop += 1) {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const y = low + rng() * (high - low);
        const at = road(y);
        if (!at) break;
        const dir = rng() < 0.5 ? -1 : 1;
        const x = at.x + dir * (at.half + unit * (0.9 + rng() * 4.5));
        const size = unit * (0.9 + rng() * 0.4);
        if (x < 0 || x > width) continue;
        if (placed.some((item) => Math.hypot(item.x - x, (item.y - y) * 1.6) < (item.big ? item.size * 0.7 : unit * 1.2))) continue;
        placed.push({ kind: art.small[Math.floor(rng() * art.small.length)], x, y, size, seed: rng(), big: false });
        break;
      }
    }
    standing.push(...placed);
    standing.sort((first, second) => first.y - second.y);
    void pal;
    return standing;
  }

  const MAPART = { SET_PIECES, SMALL_PROPS, FAMILY_ART, DOORS, PIECE_SIZE, SMALL_SIZE, paletteOf, buildAtlas, paintGround, paintRoad, paintDoor, paintEpisode };
  SC.MAPART = MAPART;
  if (typeof module === 'object' && module.exports) module.exports = MAPART;
})(typeof window !== 'undefined' ? window : globalThis);
