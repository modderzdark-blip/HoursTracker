// RENDER (art): procedural candy art. Every candy is painted with the 8-layer "Juicy Gloss" recipe:
//   1 ground shadow, 2 base body, 3 rim light, 4 inner glow, 5 subsurface tint, 6 main specular, 7 secondary glint, 8 outline.
// Three materials (Gummy, Hard Candy, Sugar Sprinkle) share shapes and colors. No image files are used anywhere.
(function attachArt(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;
  const UTIL = SC.UTIL;

  // ---------------------------------------------------------------- color helpers
  function hexToRgb(hex) {
    const value = parseInt(hex.replace('#', ''), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function rgba(hex, alpha) {
    const [red, green, blue] = hexToRgb(hex);
    return `rgba(${red},${green},${blue},${alpha})`;
  }

  function mix(first_hex, second_hex, amount) {
    const first = hexToRgb(first_hex);
    const second = hexToRgb(second_hex);
    const mixed = first.map((channel, index) => Math.round(channel + (second[index] - channel) * amount));
    return '#' + mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------- shapes (centered on 0,0, radius r)
  function heartPath(r) {
    const path = new Path2D();
    path.moveTo(0, r * 0.9);
    path.bezierCurveTo(-r * 0.18, r * 0.78, -r * 0.98, r * 0.32, -r * 0.97, -r * 0.22);
    path.bezierCurveTo(-r * 0.96, -r * 0.74, -r * 0.42, -r * 0.98, 0, -r * 0.56);
    path.bezierCurveTo(r * 0.42, -r * 0.98, r * 0.96, -r * 0.74, r * 0.97, -r * 0.22);
    path.bezierCurveTo(r * 0.98, r * 0.32, r * 0.18, r * 0.78, 0, r * 0.9);
    path.closePath();
    return path;
  }

  function wedgePath(r) {
    // Orange slice: flat rounded top edge, deep half-moon belly.
    const path = new Path2D();
    const top = -r * 0.5;
    const half_width = r * 0.98;
    const belly = r * 1.38;
    const corner = r * 0.2;
    path.moveTo(-half_width + corner, top);
    path.lineTo(half_width - corner, top);
    path.quadraticCurveTo(half_width, top, half_width, top + corner * 0.9);
    path.ellipse(0, top + corner * 0.9, half_width, belly - corner * 0.9, 0, 0, Math.PI, false);
    path.quadraticCurveTo(-half_width, top, -half_width + corner, top);
    path.closePath();
    return path;
  }

  function diamondPath(r) {
    const path = new Path2D();
    const width = r * 0.9;
    const height = r * 0.98;
    const bulge = 0.2;
    const corner = 0.16;
    const points = [[0, -height], [width, 0], [0, height], [-width, 0]];
    const lerpPoint = (from, to, t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    for (let index = 0; index < 4; index += 1) {
      const point = points[index];
      const next = points[(index + 1) % 4];
      const previous = points[(index + 3) % 4];
      const start = lerpPoint(point, previous, corner);
      const end = lerpPoint(point, next, corner);
      if (index === 0) path.moveTo(start[0], start[1]);
      path.quadraticCurveTo(point[0], point[1], end[0], end[1]);
      const edge_end = lerpPoint(next, point, corner);
      const middle = lerpPoint(point, next, 0.5);
      const outward = [middle[0] * (1 + bulge), middle[1] * (1 + bulge)];
      path.quadraticCurveTo(outward[0], outward[1], edge_end[0], edge_end[1]);
    }
    path.closePath();
    return path;
  }

  function roundedRectPath(path, x, y, width, height, radius) {
    path.moveTo(x + radius, y);
    path.lineTo(x + width - radius, y);
    path.quadraticCurveTo(x + width, y, x + width, y + radius);
    path.lineTo(x + width, y + height - radius);
    path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    path.lineTo(x + radius, y + height);
    path.quadraticCurveTo(x, y + height, x, y + height - radius);
    path.lineTo(x, y + radius);
    path.quadraticCurveTo(x, y, x + radius, y);
    path.closePath();
    return path;
  }

  function cubePath(r) {
    const side = r * 1.62;
    return roundedRectPath(new Path2D(), -side / 2, -side / 2, side, side, r * 0.36);
  }

  function orbPath(r) {
    // Circle with a small leaf notch at the top.
    const path = new Path2D();
    const radius = r * 0.92;
    const notch = 0.2;
    path.moveTo(Math.sin(notch) * radius, -Math.cos(notch) * radius + r * 0.04);
    path.arc(0, r * 0.04, radius, -Math.PI / 2 + notch, -Math.PI / 2 - notch + Math.PI * 2, false);
    path.quadraticCurveTo(0, -radius + r * 0.2, Math.sin(notch) * radius, -Math.cos(notch) * radius + r * 0.04);
    path.closePath();
    return path;
  }

  function starPath(r) {
    const path = new Path2D();
    const outer = r * 1.0;
    const inner = r * 0.56;
    const points = [];
    for (let index = 0; index < 10; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      const radius = index % 2 === 0 ? outer : inner;
      points.push([Math.cos(angle) * radius, Math.sin(angle) * radius + r * 0.06]);
    }
    const softness = 0.26;
    for (let index = 0; index < 10; index += 1) {
      const point = points[index];
      const previous = points[(index + 9) % 10];
      const next = points[(index + 1) % 10];
      const amount = index % 2 === 0 ? softness : softness * 0.6;
      const start = [point[0] + (previous[0] - point[0]) * amount, point[1] + (previous[1] - point[1]) * amount];
      const end = [point[0] + (next[0] - point[0]) * amount, point[1] + (next[1] - point[1]) * amount];
      if (index === 0) path.moveTo(start[0], start[1]);
      else path.lineTo(start[0], start[1]);
      path.quadraticCurveTo(point[0], point[1], end[0], end[1]);
    }
    path.closePath();
    return path;
  }

  const SHAPES = { heart: heartPath, wedge: wedgePath, diamond: diamondPath, cube: cubePath, orb: orbPath, star: starPath };

  // ---------------------------------------------------------------- materials
  const MATERIALS = {
    gummy: { specular: 0.88, specular_size: 1.0, subsurface: 0.6, rim: 0.35, outline: 0.7, inner_glow: 0.85, bubbles: true, swirl: false, sugar: false, body_highlight_stop: 0.42, core_glow: 0.28 },
    hard: { specular: 1.0, specular_size: 0.78, subsurface: 0.22, rim: 0.75, outline: 0.95, inner_glow: 0.95, bubbles: false, swirl: true, sugar: false, body_highlight_stop: 0.26, core_glow: 0 },
    sprinkle: { specular: 0.38, specular_size: 1.15, subsurface: 0.2, rim: 0.2, outline: 0.65, inner_glow: 0.5, bubbles: false, swirl: false, sugar: true, body_highlight_stop: 0.55, core_glow: 0 },
  };

  function seededRandom(seed) {
    return UTIL.createRng(seed);
  }

  // ---------------------------------------------------------------- candy painter
  /**
   * Paints one candy centered at (cx, cy) with radius r. `options`: { theme, special, colorblind, scale (sprite px per css px),
   * decorate(ctx, r) for overlays inside the body clip, skip_shadow }.
   */
  function paintCandy(ctx, cx, cy, r, candy, options) {
    const material = MATERIALS[options.theme] || MATERIALS.gummy;
    const pixel = options.scale || 2;
    const shape = SHAPES[candy.shape](r);
    ctx.save();
    ctx.translate(cx, cy);

    // 1. Ground shadow: soft dark ellipse under the candy (25%).
    if (!options.skip_shadow) {
      ctx.save();
      ctx.translate(0, r * 0.86);
      ctx.scale(1, 0.32);
      const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
      ground.addColorStop(0, 'rgba(60,10,40,0.25)');
      ground.addColorStop(0.6, 'rgba(60,10,40,0.14)');
      ground.addColorStop(1, 'rgba(60,10,40,0)');
      ctx.fillStyle = ground;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.clip(shape);
    // 2. Base body: radial gradient, bright center-top offset to the upper left, deeper edges.
    const body = ctx.createRadialGradient(-r * 0.32, -r * 0.42, r * 0.04, -r * 0.08, -r * 0.08, r * 1.3);
    body.addColorStop(0, mix(candy.highlight, '#ffffff', 0.25));
    body.addColorStop(material.body_highlight_stop * 0.5, candy.highlight);
    body.addColorStop(material.body_highlight_stop, candy.base);
    body.addColorStop(0.82, mix(candy.base, candy.shadow, 0.55));
    body.addColorStop(1, candy.shadow);
    ctx.fillStyle = body;
    ctx.fillRect(-r * 1.6, -r * 1.6, r * 3.2, r * 3.2);

    // Shape-specific body details (orange segments, cube bevel, star ridges, blueberry crown).
    paintShapeDetails(ctx, r, candy, material, pixel);

    // 3. Rim light: thin light stroke on the lower-right edge (bounce light from the board).
    const rim = ctx.createLinearGradient(-r, -r, r, r);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.55, 'rgba(255,255,255,0)');
    rim.addColorStop(1, `rgba(255,255,255,${material.rim})`);
    ctx.strokeStyle = rim;
    ctx.lineWidth = 2 * pixel * 2;
    ctx.stroke(shape);

    // 4. Inner glow: an inner shadow in a saturated darker hue along the lower edge (plump volume).
    const ring = new Path2D();
    ring.rect(-r * 4, -r * 4, r * 8, r * 8);
    ring.addPath(shape);
    ctx.save();
    ctx.shadowColor = rgba(mix(candy.shadow, '#000000', 0.15), material.inner_glow);
    ctx.shadowBlur = r * 0.32;
    ctx.shadowOffsetY = -r * 0.14;
    ctx.shadowOffsetX = -r * 0.05;
    ctx.fillStyle = candy.shadow;
    ctx.fill(ring, 'evenodd');
    ctx.restore();

    // 5. Subsurface tint: warmer, lighter blob in the lower third (translucent gummy look).
    const subsurface = ctx.createRadialGradient(r * 0.08, r * 0.5, 0, r * 0.08, r * 0.5, r * 0.62);
    subsurface.addColorStop(0, rgba(candy.warm, material.subsurface));
    subsurface.addColorStop(1, rgba(candy.warm, 0));
    ctx.fillStyle = subsurface;
    ctx.fillRect(-r * 1.5, -r * 1.5, r * 3, r * 3);

    if (material.core_glow > 0) {
      // Gummy translucency: light passing through the middle of the candy.
      const core = ctx.createRadialGradient(r * 0.05, r * 0.12, 0, r * 0.05, r * 0.12, r * 0.55);
      core.addColorStop(0, rgba(mix(candy.highlight, '#ffffff', 0.4), material.core_glow));
      core.addColorStop(1, rgba(candy.highlight, 0));
      ctx.fillStyle = core;
      ctx.fillRect(-r * 1.5, -r * 1.5, r * 3, r * 3);
    }

    paintMaterialTexture(ctx, r, candy, material, options, pixel);
    if (options.decorate) options.decorate(ctx, r, shape);

    // 6. Main specular: large curved white highlight in the top-left.
    ctx.save();
    ctx.translate(-r * 0.24, -r * 0.4);
    ctx.rotate(-0.55);
    const specular_width = r * 0.5 * material.specular_size;
    const specular_height = r * 0.25 * material.specular_size;
    const specular = ctx.createLinearGradient(0, -specular_height, 0, specular_height);
    specular.addColorStop(0, `rgba(255,255,255,${material.specular * 0.92})`);
    specular.addColorStop(0.55, `rgba(255,255,255,${material.specular * 0.4})`);
    specular.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = specular;
    ctx.beginPath();
    ctx.ellipse(0, 0, specular_width, specular_height, 0, Math.PI * 1.02, Math.PI * 1.98, false);
    ctx.ellipse(0, -specular_height * 0.1, specular_width * 0.92, specular_height * 0.45, 0, Math.PI * 1.98, Math.PI * 1.02, true);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, specular_height * 0.05, specular_width * 0.86, specular_height * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 7. Secondary glint: small bright oval near the specular, and a tiny sparkle dot on the opposite side.
    ctx.fillStyle = `rgba(255,255,255,${Math.min(1, material.specular + 0.1)})`;
    ctx.beginPath();
    ctx.ellipse(-r * 0.6, -r * 0.02, r * 0.085, r * 0.05, -1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.55 + material.specular * 0.3})`;
    ctx.beginPath();
    ctx.arc(r * 0.46, r * 0.4, r * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore(); // end body clip

    // 8. Outline: 2 px darker outline in the shadow color, slightly inset.
    ctx.save();
    ctx.scale(0.985, 0.985);
    ctx.strokeStyle = rgba(mix(candy.shadow, '#2a0020', 0.25), material.outline);
    ctx.lineWidth = 2 * pixel;
    ctx.stroke(shape);
    ctx.restore();

    if (options.colorblind) paintColorblindGlyph(ctx, r, candy, pixel);
    ctx.restore();
  }

  function paintShapeDetails(ctx, r, candy, material, pixel) {
    if (candy.shape === 'wedge') {
      // Rind band along the belly and pulp segment lines.
      const top = -r * 0.5;
      ctx.save();
      ctx.strokeStyle = rgba('#fff3d6', 0.55);
      ctx.lineWidth = r * 0.1;
      ctx.beginPath();
      ctx.ellipse(0, top + r * 0.18, r * 0.86, r * 1.18, 0, 0.05, Math.PI - 0.05, false);
      ctx.stroke();
      ctx.strokeStyle = rgba('#fff6e0', 0.6);
      ctx.lineWidth = Math.max(1.5 * pixel, r * 0.035);
      ctx.lineCap = 'round';
      [-0.62, -0.2, 0.2, 0.62].forEach((angle_offset) => {
        const angle = Math.PI / 2 + angle_offset * 1.15;
        ctx.beginPath();
        ctx.moveTo(0, top + r * 0.12);
        ctx.lineTo(Math.cos(angle) * r * 0.7, top + r * 0.12 + Math.sin(angle) * r * 0.86);
        ctx.stroke();
      });
      ctx.restore();
    } else if (candy.shape === 'cube') {
      // Bevel: lighter top-left inner edge, darker bottom-right inner edge.
      const side = r * 1.62;
      const inset = r * 0.16;
      const bevel = roundedRectPath(new Path2D(), -side / 2 + inset, -side / 2 + inset, side - inset * 2, side - inset * 2, r * 0.24);
      const bevel_light = ctx.createLinearGradient(-r, -r, r, r);
      bevel_light.addColorStop(0, 'rgba(255,255,255,0.55)');
      bevel_light.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      bevel_light.addColorStop(1, rgba(candy.shadow, 0.45));
      ctx.strokeStyle = bevel_light;
      ctx.lineWidth = Math.max(2 * pixel, r * 0.06);
      ctx.stroke(bevel);
    } else if (candy.shape === 'star') {
      ctx.save();
      ctx.strokeStyle = rgba(candy.highlight, 0.35);
      ctx.lineWidth = Math.max(1.2 * pixel, r * 0.03);
      for (let index = 0; index < 5; index += 1) {
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
        ctx.beginPath();
        ctx.moveTo(0, r * 0.06);
        ctx.lineTo(Math.cos(angle) * r * 0.72, Math.sin(angle) * r * 0.72 + r * 0.06);
        ctx.stroke();
      }
      ctx.restore();
    } else if (candy.shape === 'orb') {
      // Blueberry crown: a tiny five-lobed calyx at the notch, plus a small leaf.
      ctx.save();
      ctx.translate(0, -r * 0.66);
      ctx.fillStyle = rgba(candy.shadow, 0.55);
      for (let index = 0; index < 5; index += 1) {
        ctx.rotate((Math.PI * 2) / 5);
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.07, r * 0.035, r * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (candy.shape === 'diamond') {
      ctx.save();
      ctx.strokeStyle = rgba('#ffffff', 0.28);
      ctx.lineWidth = Math.max(1.2 * pixel, r * 0.03);
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(0, r * 0.7);
      ctx.lineTo(-r * 0.5, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    } else if (candy.shape === 'heart') {
      ctx.save();
      const lobe = ctx.createRadialGradient(r * 0.48, -r * 0.42, 0, r * 0.48, -r * 0.42, r * 0.36);
      lobe.addColorStop(0, rgba(candy.highlight, 0.55));
      lobe.addColorStop(1, rgba(candy.highlight, 0));
      ctx.fillStyle = lobe;
      ctx.fillRect(0, -r, r, r);
      ctx.restore();
    }
  }

  function paintMaterialTexture(ctx, r, candy, material, options, pixel) {
    const random = seededRandom(candy.id * 97 + 13);
    if (material.bubbles) {
      // Gummy: tiny internal bubbles.
      for (let index = 0; index < 5; index += 1) {
        const bubble_x = (random() - 0.5) * r * 1.0;
        const bubble_y = (random() - 0.2) * r * 0.9;
        const bubble_r = r * (0.025 + random() * 0.04);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.beginPath();
        ctx.arc(bubble_x, bubble_y, bubble_r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = Math.max(0.8 * pixel, r * 0.012);
        ctx.beginPath();
        ctx.arc(bubble_x, bubble_y, bubble_r, Math.PI * 1.1, Math.PI * 1.8);
        ctx.stroke();
      }
    }
    if (material.swirl) {
      // Hard candy: a two-tone swirl inside the glass, crisp bright edges and a deep saturated core.
      ctx.save();
      const depth = ctx.createRadialGradient(r * 0.1, r * 0.15, 0, r * 0.1, r * 0.15, r * 0.7);
      depth.addColorStop(0, rgba(mix(candy.base, candy.shadow, 0.35), 0.45));
      depth.addColorStop(1, rgba(candy.base, 0));
      ctx.fillStyle = depth;
      ctx.fillRect(-r * 1.5, -r * 1.5, r * 3, r * 3);
      ctx.lineCap = 'round';
      const swirlPath = () => {
        ctx.beginPath();
        for (let step = 0; step <= 64; step += 1) {
          const angle = step * 0.2;
          const radius = r * 0.04 + step * r * 0.0105;
          const point_x = Math.cos(angle) * radius;
          const point_y = Math.sin(angle) * radius * 0.92 + r * 0.06;
          if (step === 0) ctx.moveTo(point_x, point_y);
          else ctx.lineTo(point_x, point_y);
        }
      };
      swirlPath();
      ctx.strokeStyle = rgba('#ffffff', 0.38);
      ctx.lineWidth = r * 0.075;
      ctx.stroke();
      ctx.translate(r * 0.03, r * 0.03);
      swirlPath();
      ctx.strokeStyle = rgba(candy.shadow, 0.25);
      ctx.lineWidth = r * 0.03;
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const edge = ctx.createRadialGradient(-r * 0.05, -r * 0.05, r * 0.6, 0, 0, r * 1.05);
      edge.addColorStop(0, 'rgba(255,255,255,0)');
      edge.addColorStop(1, 'rgba(255,255,255,0.35)');
      ctx.fillStyle = edge;
      ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
      ctx.restore();
    }
    if (material.sugar) {
      // Sugar sprinkle: matte sugar coat with crystals; glitter specks twinkle at runtime.
      ctx.save();
      const coat = ctx.createLinearGradient(0, -r, 0, r);
      coat.addColorStop(0, 'rgba(255,255,255,0.32)');
      coat.addColorStop(1, 'rgba(255,255,255,0.1)');
      ctx.fillStyle = coat;
      ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
      for (let index = 0; index < 120; index += 1) {
        const speck_x = (random() - 0.5) * r * 1.9;
        const speck_y = (random() - 0.5) * r * 1.9;
        const speck_size = r * (0.018 + random() * 0.03);
        ctx.save();
        ctx.translate(speck_x, speck_y);
        ctx.rotate(random() * Math.PI);
        ctx.fillStyle = random() < 0.7 ? 'rgba(255,255,255,0.85)' : rgba(candy.shadow, 0.4);
        ctx.fillRect(-speck_size / 2, -speck_size / 2, speck_size, speck_size);
        ctx.restore();
      }
      ctx.restore();
    }
  }

  const GLYPHS = ['S', 'O', 'L', 'M', 'B', 'G'];
  function paintColorblindGlyph(ctx, r, candy, pixel) {
    ctx.save();
    ctx.font = `900 ${Math.round(r * 0.62)}px system-ui, -apple-system, Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3 * pixel, r * 0.12);
    ctx.strokeStyle = 'rgba(30,0,25,0.85)';
    const glyph_y = candy.shape === 'wedge' ? -r * 0.02 : r * 0.08;
    ctx.strokeText(GLYPHS[candy.id], 0, glyph_y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(GLYPHS[candy.id], 0, glyph_y);
    ctx.restore();
  }

  // ---------------------------------------------------------------- specials
  function stripeDecorator(direction) {
    return (ctx, r) => {
      ctx.save();
      if (direction === 'col') ctx.rotate(Math.PI / 2);
      const band = r * 0.17;
      [-0.52, 0, 0.52].forEach((offset) => {
        const center_y = offset * r;
        const stripe = ctx.createLinearGradient(0, center_y - band, 0, center_y + band);
        stripe.addColorStop(0, 'rgba(255,255,255,0.98)');
        stripe.addColorStop(0.6, 'rgba(255,255,255,0.86)');
        stripe.addColorStop(1, 'rgba(255,240,250,0.7)');
        ctx.fillStyle = stripe;
        ctx.beginPath();
        ctx.rect(-r * 1.4, center_y - band / 2, r * 2.8, band);
        ctx.fill();
        ctx.fillStyle = 'rgba(80,0,50,0.16)';
        ctx.fillRect(-r * 1.4, center_y + band / 2, r * 2.8, band * 0.16);
      });
      ctx.restore();
    };
  }

  function paintWrapped(ctx, cx, cy, r, candy, options) {
    const pixel = options.scale || 2;
    ctx.save();
    ctx.translate(cx, cy);
    // Twisted wrapper ends (bow-tie), drawn behind the candy.
    [-1, 1].forEach((side) => {
      ctx.save();
      ctx.scale(side, 1);
      const end = new Path2D();
      end.moveTo(r * 0.55, -r * 0.16);
      end.quadraticCurveTo(r * 0.78, -r * 0.3, r * 1.05, -r * 0.52);
      end.quadraticCurveTo(r * 0.96, -r * 0.2, r * 1.07, -r * 0.02);
      end.quadraticCurveTo(r * 0.96, r * 0.2, r * 1.05, r * 0.52);
      end.quadraticCurveTo(r * 0.8, r * 0.3, r * 0.55, r * 0.16);
      end.closePath();
      const end_fill = ctx.createLinearGradient(r * 0.55, -r * 0.6, r * 1.05, r * 0.6);
      end_fill.addColorStop(0, mix(candy.highlight, '#ffffff', 0.45));
      end_fill.addColorStop(0.5, candy.base);
      end_fill.addColorStop(1, candy.shadow);
      ctx.fillStyle = end_fill;
      ctx.fill(end);
      ctx.strokeStyle = rgba(mix(candy.shadow, '#2a0020', 0.3), 0.85);
      ctx.lineWidth = 1.6 * pixel;
      ctx.stroke(end);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.3 * pixel;
      ctx.lineCap = 'round';
      [[-0.36, -0.12], [0.0, 0.02], [0.34, 0.14]].forEach(([from_y, slope]) => {
        ctx.beginPath();
        ctx.moveTo(r * 0.66, from_y * r * 0.6);
        ctx.lineTo(r * 1.0, (from_y + slope) * r * 1.25);
        ctx.stroke();
      });
      // Pinched knot where the twist meets the candy.
      ctx.fillStyle = candy.shadow;
      ctx.beginPath();
      ctx.ellipse(r * 0.6, 0, r * 0.07, r * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();
    paintCandy(ctx, cx, cy, r * 0.8, candy, Object.assign({}, options, { skip_shadow: true }));
    // Crinkled translucent film hugging the candy.
    ctx.save();
    ctx.translate(cx, cy);
    const film = roundedRectPath(new Path2D(), -r * 0.72, -r * 0.78, r * 1.44, r * 1.56, r * 0.55);
    const film_fill = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.8);
    film_fill.addColorStop(0, 'rgba(255,255,255,0.32)');
    film_fill.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    film_fill.addColorStop(1, rgba(candy.highlight, 0.22));
    ctx.fillStyle = film_fill;
    ctx.fill(film);
    const film_edge = ctx.createLinearGradient(0, -r * 0.8, 0, r * 0.8);
    film_edge.addColorStop(0, 'rgba(255,255,255,0.95)');
    film_edge.addColorStop(1, rgba(mix(candy.highlight, '#ffffff', 0.3), 0.75));
    ctx.strokeStyle = film_edge;
    ctx.lineWidth = 2 * pixel;
    ctx.stroke(film);
    ctx.save();
    ctx.clip(film);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.2 * pixel;
    ctx.lineCap = 'round';
    const random = seededRandom(candy.id + 300);
    for (let index = 0; index < 8; index += 1) {
      const start_x = (random() - 0.5) * r * 1.3;
      const start_y = (random() - 0.5) * r * 1.4;
      ctx.beginPath();
      ctx.moveTo(start_x, start_y);
      ctx.lineTo(start_x + r * (0.1 + random() * 0.14), start_y + r * (random() - 0.5) * 0.22);
      ctx.lineTo(start_x + r * (0.2 + random() * 0.16), start_y + r * (random() - 0.5) * 0.28);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.32, -r * 0.5, r * 0.24, r * 0.09, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  function paintBomb(ctx, cx, cy, r, options) {
    const pixel = options.scale || 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.save();
    ctx.translate(0, r * 0.86);
    ctx.scale(1, 0.32);
    const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.9);
    ground.addColorStop(0, 'rgba(40,10,0,0.3)');
    ground.addColorStop(1, 'rgba(40,10,0,0)');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const sphere = new Path2D();
    sphere.arc(0, 0, r * 0.9, 0, Math.PI * 2);
    ctx.save();
    ctx.clip(sphere);
    const chocolate = ctx.createRadialGradient(-r * 0.3, -r * 0.38, r * 0.05, 0, 0, r * 1.0);
    chocolate.addColorStop(0, '#9a5a32');
    chocolate.addColorStop(0.35, '#6a3519');
    chocolate.addColorStop(0.8, '#3a1a0a');
    chocolate.addColorStop(1, '#1f0c04');
    ctx.fillStyle = chocolate;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    const random = seededRandom(777);
    const candies = CONFIG.CANDIES;
    for (let index = 0; index < 18; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random()) * r * 0.74;
      ctx.save();
      ctx.translate(Math.cos(angle) * distance, Math.sin(angle) * distance);
      ctx.rotate(random() * Math.PI);
      const sprinkle = roundedRectPath(new Path2D(), -r * 0.11, -r * 0.035, r * 0.22, r * 0.07, r * 0.035);
      const sprinkle_color = candies[index % candies.length];
      ctx.fillStyle = sprinkle_color.base;
      ctx.fill(sprinkle);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(-r * 0.08, -r * 0.03, r * 0.14, r * 0.018);
      ctx.restore();
    }
    const ring = new Path2D();
    ring.rect(-r * 4, -r * 4, r * 8, r * 8);
    ring.addPath(sphere);
    ctx.shadowColor = 'rgba(10,3,0,0.9)';
    ctx.shadowBlur = r * 0.3;
    ctx.shadowOffsetY = -r * 0.12;
    ctx.fillStyle = '#000';
    ctx.fill(ring, 'evenodd');
    ctx.shadowColor = 'transparent';
    ctx.save();
    ctx.translate(-r * 0.26, -r * 0.42);
    ctx.rotate(-0.55);
    const specular = ctx.createLinearGradient(0, -r * 0.22, 0, r * 0.22);
    specular.addColorStop(0, 'rgba(255,255,255,0.85)');
    specular.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = specular;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.42, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(-r * 0.62, -r * 0.02, r * 0.07, r * 0.045, -1.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.45, r * 0.45, r * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(20,6,0,0.9)';
    ctx.lineWidth = 2 * pixel;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.89, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- blockers, ingredients, glaze
  function paintFrosting(ctx, cx, cy, size, layers, pixel) {
    ctx.save();
    ctx.translate(cx, cy);
    const half = size * 0.47;
    const block = roundedRectPath(new Path2D(), -half, -half, half * 2, half * 2, size * 0.16);
    ctx.save();
    ctx.shadowColor = 'rgba(90,20,60,0.3)';
    ctx.shadowBlur = size * 0.08;
    ctx.shadowOffsetY = size * 0.04;
    const cake = ctx.createLinearGradient(0, -half, 0, half);
    cake.addColorStop(0, '#fff7fb');
    cake.addColorStop(1, layers >= 2 ? '#ffc4e1' : '#ffe0ef');
    ctx.fillStyle = cake;
    ctx.fill(block);
    ctx.restore();
    ctx.save();
    ctx.clip(block);
    if (layers >= 2) {
      ctx.fillStyle = '#ff7fbf';
      ctx.fillRect(-half, half * 0.18, half * 2, half * 0.26);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(-half, half * 0.18, half * 2, half * 0.06);
      ctx.fillStyle = '#ffb3d9';
      ctx.fillRect(-half, half * 0.44, half * 2, half * 0.56);
    } else {
      ctx.fillStyle = '#ffd1e8';
      ctx.fillRect(-half, half * 0.3, half * 2, half * 0.7);
    }
    // Icing drips.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-half, -half);
    ctx.lineTo(half, -half);
    const drip_base = layers >= 2 ? half * 0.02 : -half * 0.18;
    const drips = [0.85, 0.55, 0.3, 0.05, -0.25, -0.5, -0.8];
    ctx.lineTo(half, drip_base);
    drips.forEach((position, index) => {
      const depth = index % 2 === 0 ? half * 0.28 : half * 0.1;
      ctx.quadraticCurveTo(position * half + half * 0.12, drip_base + depth * 1.6, position * half, drip_base + depth * 0.4);
    });
    ctx.lineTo(-half, drip_base);
    ctx.closePath();
    ctx.fill();
    const gloss = ctx.createLinearGradient(0, -half, 0, 0);
    gloss.addColorStop(0, 'rgba(255,255,255,0.95)');
    gloss.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gloss;
    ctx.beginPath();
    ctx.ellipse(-half * 0.25, -half * 0.62, half * 0.55, half * 0.16, -0.15, 0, Math.PI * 2);
    ctx.fill();
    const random = seededRandom(layers * 31 + 5);
    for (let index = 0; index < 9; index += 1) {
      ctx.fillStyle = CONFIG.CANDIES[index % 6].base;
      ctx.save();
      ctx.translate((random() - 0.5) * half * 1.5, -half * 0.55 + random() * half * 0.5);
      ctx.rotate(random() * Math.PI);
      ctx.fillRect(-size * 0.03, -size * 0.008, size * 0.06, size * 0.016);
      ctx.restore();
    }
    if (layers === 1) {
      // Visible crack after the first hit.
      ctx.strokeStyle = 'rgba(140,40,90,0.75)';
      ctx.lineWidth = 2 * pixel;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-half * 0.9, -half * 0.5);
      ctx.lineTo(-half * 0.35, -half * 0.15);
      ctx.lineTo(-half * 0.45, half * 0.2);
      ctx.lineTo(half * 0.1, half * 0.45);
      ctx.lineTo(half * 0.05, half * 0.9);
      ctx.moveTo(-half * 0.35, -half * 0.15);
      ctx.lineTo(half * 0.35, -half * 0.35);
      ctx.lineTo(half * 0.85, -half * 0.1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(200,90,150,0.6)';
    ctx.lineWidth = 2 * pixel;
    ctx.stroke(block);
    ctx.restore();
  }

  function paintCherry(ctx, cx, cy, r, pixel) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.save();
    ctx.translate(0, r * 0.86);
    ctx.scale(1, 0.3);
    const ground = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    ground.addColorStop(0, 'rgba(60,0,20,0.28)');
    ground.addColorStop(1, 'rgba(60,0,20,0)');
    ctx.fillStyle = ground;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Stems and leaf.
    ctx.strokeStyle = '#5a7d1a';
    ctx.lineWidth = Math.max(2.5 * pixel, r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.05);
    ctx.quadraticCurveTo(-r * 0.25, -r * 0.55, r * 0.08, -r * 0.82);
    ctx.moveTo(r * 0.45, r * 0.12);
    ctx.quadraticCurveTo(r * 0.3, -r * 0.45, r * 0.08, -r * 0.82);
    ctx.stroke();
    ctx.save();
    ctx.translate(r * 0.12, -r * 0.8);
    ctx.rotate(-0.5);
    const leaf = ctx.createLinearGradient(0, -r * 0.15, r * 0.5, r * 0.1);
    leaf.addColorStop(0, '#9be15d');
    leaf.addColorStop(1, '#3f9a2b');
    ctx.fillStyle = leaf;
    ctx.beginPath();
    ctx.ellipse(r * 0.26, 0, r * 0.28, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    [[-0.42, 0.32, 0.46], [0.45, 0.38, 0.44]].forEach(([offset_x, offset_y, radius_scale]) => {
      const radius = r * radius_scale;
      ctx.save();
      ctx.translate(offset_x * r, offset_y * r);
      const berry = ctx.createRadialGradient(-radius * 0.35, -radius * 0.4, radius * 0.05, 0, 0, radius * 1.05);
      berry.addColorStop(0, '#ff8a9a');
      berry.addColorStop(0.35, '#f0163f');
      berry.addColorStop(1, '#8a0020');
      ctx.fillStyle = berry;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(-radius * 0.35, -radius * 0.38, radius * 0.3, radius * 0.15, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(radius * 0.38, radius * 0.4, radius * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90,0,20,0.8)';
      ctx.lineWidth = 2 * pixel;
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.98, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }

  function paintJelly(ctx, x, y, size, layers, pixel) {
    const inset = size * 0.05;
    const glaze = roundedRectPath(new Path2D(), x + inset, y + inset, size - inset * 2, size - inset * 2, size * 0.2);
    ctx.save();
    const fill = ctx.createLinearGradient(x, y, x, y + size);
    if (layers >= 2) {
      fill.addColorStop(0, 'rgba(255,110,200,0.92)');
      fill.addColorStop(1, 'rgba(200,30,150,0.95)');
    } else {
      fill.addColorStop(0, 'rgba(255,165,222,0.8)');
      fill.addColorStop(1, 'rgba(255,100,195,0.8)');
    }
    ctx.fillStyle = fill;
    ctx.fill(glaze);
    ctx.strokeStyle = layers >= 2 ? 'rgba(255,235,250,0.95)' : 'rgba(255,240,250,0.8)';
    ctx.lineWidth = (layers >= 2 ? 2.5 : 1.5) * pixel;
    ctx.stroke(glaze);
    ctx.clip(glaze);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath();
    ctx.ellipse(x + size * 0.35, y + size * 0.18, size * 0.3, size * 0.08, -0.2, 0, Math.PI * 2);
    ctx.fill();
    if (layers >= 2) {
      const inner = roundedRectPath(new Path2D(), x + size * 0.17, y + size * 0.17, size * 0.66, size * 0.66, size * 0.14);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2 * pixel;
      ctx.stroke(inner);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- sprite cache
  function createCanvas(width, height) {
    if (typeof OffscreenCanvas !== 'undefined' && !SC.ART_FORCE_DOM_CANVAS) return new OffscreenCanvas(width, height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  /** Sprite cache: draws each candy once at 2x the target cell size (max 256 px) and reuses it. */
  function createSpriteCache() {
    const sprites = new Map();
    let sprite_px = 128;
    let cell_px = 64;
    let theme = 'gummy';
    let colorblind = false;
    const cache = {
      configure(next_cell_px, next_theme, next_colorblind, device_ratio) {
        const next_sprite_px = Math.min(256, Math.max(48, Math.round(next_cell_px * Math.max(2, Math.min(3, device_ratio || 2)))));
        if (next_sprite_px !== sprite_px || next_theme !== theme || next_colorblind !== colorblind) sprites.clear();
        sprite_px = next_sprite_px;
        cell_px = next_cell_px;
        theme = next_theme;
        colorblind = next_colorblind;
      },
      get spritePx() {
        return sprite_px;
      },
      /** kind: 'candy' | 'frosting' | 'cherry' | 'jelly'; returns a canvas sprite_px square. */
      get(kind, color, special, layers) {
        const key = `${kind}:${color}:${special}:${layers}`;
        let sprite = sprites.get(key);
        if (sprite) return sprite;
        sprite = createCanvas(sprite_px, sprite_px);
        const ctx = sprite.getContext('2d');
        const pixel = sprite_px / Math.max(1, cell_px);
        const center = sprite_px / 2;
        const radius = sprite_px * 0.42;
        if (kind === 'candy') paintSpecial(ctx, center, center, radius, color, special, { theme, colorblind, scale: pixel });
        else if (kind === 'frosting') paintFrosting(ctx, center, center, sprite_px, layers, pixel);
        else if (kind === 'cherry') paintCherry(ctx, center, center, radius, pixel);
        else if (kind === 'jelly') paintJelly(ctx, 0, 0, sprite_px, layers, pixel);
        sprites.set(key, sprite);
        return sprite;
      },
      clear() {
        sprites.clear();
      },
    };
    return cache;
  }

  function paintSpecial(ctx, cx, cy, r, color, special, options) {
    if (special === 'bomb') {
      paintBomb(ctx, cx, cy, r, options);
      return;
    }
    const candy = CONFIG.CANDIES[color];
    if (special === 'wrapped' || special === 'wrapped_armed' || special === 'wrapped_big_armed') {
      paintWrapped(ctx, cx, cy, r, candy, options);
      return;
    }
    const decorate = special === 'stripe_row' ? stripeDecorator('row') : special === 'stripe_col' ? stripeDecorator('col') : null;
    paintCandy(ctx, cx, cy, r, candy, Object.assign({}, options, { decorate }));
  }

  const ART = { hexToRgb, rgba, mix, SHAPES, MATERIALS, paintCandy, paintSpecial, paintWrapped, paintBomb, paintFrosting, paintCherry, paintJelly, roundedRectPath, createCanvas, createSpriteCache };
  SC.ART = ART;
})(typeof window !== 'undefined' ? window : globalThis);
