// PIP: the game's original mascot, a plump mint gumdrop buddy with big glossy eyes, tiny arms and a two-leaf tuft.
// The sugar-coated body comes from the SPRITES shader; the face, arms and leaves are drawn with canvas paths.
// Expressions: idle (with blinks), blink, cheer, wow, worried, wink, pointing (at an angle) and wave.
(function attachPip(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const SPRITES = SC.SPRITES;

  const EXPRESSIONS = Object.freeze(['idle', 'blink', 'cheer', 'wow', 'worried', 'wink', 'pointing', 'wave']);
  const body_cache = new Map();

  function bodyCanvas(pixels) {
    const size = Math.max(32, Math.min(256, Math.ceil(pixels / 16) * 16));
    if (!body_cache.has(size)) body_cache.set(size, SPRITES.spriteToCanvas(SPRITES.iconRecipe('pip'), size));
    return body_cache.get(size);
  }

  function eye(ctx, x, y, radius, open, look_x, look_y) {
    if (open < 0.15) {
      ctx.strokeStyle = '#2b1238';
      ctx.lineWidth = radius * 0.32;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y - radius * 0.1, radius * 0.75, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, open);
    const iris = ctx.createRadialGradient(-radius * 0.2, -radius * 0.3, radius * 0.1, 0, 0, radius);
    iris.addColorStop(0, '#5a2a78');
    iris.addColorStop(1, '#1d0a2a');
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.ellipse(look_x * radius * 0.15, look_y * radius * 0.12, radius * 0.82, radius, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-radius * 0.28 + look_x * radius * 0.15, -radius * 0.38, radius * 0.3, radius * 0.36, -0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.arc(radius * 0.28 + look_x * radius * 0.15, radius * 0.3, radius * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function arm(ctx, x, y, size, angle, wave) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + wave);
    const fill = ctx.createLinearGradient(0, -size * 0.05, 0, size * 0.05);
    fill.addColorStop(0, '#7fe9cf');
    fill.addColorStop(1, '#22a886');
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(16,90,72,0.6)';
    ctx.lineWidth = size * 0.012;
    ctx.beginPath();
    ctx.ellipse(size * 0.1, 0, size * 0.12, size * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function leaves(ctx, cx, top, size, sway) {
    [[-1, -0.55], [1, 0.55]].forEach(([side, tilt]) => {
      ctx.save();
      ctx.translate(cx + side * size * 0.03, top + size * 0.04);
      ctx.rotate(tilt + sway);
      const fill = ctx.createLinearGradient(0, -size * 0.2, 0, 0);
      fill.addColorStop(0, '#9cf06a');
      fill.addColorStop(1, '#3fae3a');
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(size * 0.11, -size * 0.1, 0, -size * 0.22);
      ctx.quadraticCurveTo(-size * 0.11, -size * 0.1, 0, 0);
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,110,40,0.7)';
      ctx.lineWidth = size * 0.01;
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.02);
      ctx.lineTo(0, -size * 0.18);
      ctx.stroke();
      ctx.restore();
    });
  }

  /**
   * Draws Pip centred at (cx, cy) in a box `size` wide. t = time in ms (idle blinks, waving), options.angle = pointing
   * direction in radians (0 = right) for 'pointing'.
   */
  function drawPip(ctx, cx, cy, size, expression, t, options) {
    const opts = options || {};
    const time = t || 0;
    const mood = EXPRESSIONS.indexOf(expression) >= 0 ? expression : 'idle';
    const bounce = mood === 'cheer' ? Math.abs(Math.sin(time / 180)) * size * 0.06 : Math.sin(time / 700) * size * 0.012;
    const y = cy - bounce;
    const squash = mood === 'cheer' ? 1 + Math.sin(time / 90) * 0.02 : 1 + Math.sin(time / 700) * 0.012;
    // Arms behind the body.
    const arm_y = y + size * 0.12;
    let left_angle = Math.PI * 0.8;
    let right_angle = Math.PI * 0.2;
    let right_wave = 0;
    if (mood === 'cheer') {
      left_angle = -Math.PI * 0.8 + Math.sin(time / 120) * 0.25;
      right_angle = -Math.PI * 0.2 - Math.sin(time / 120) * 0.25;
    } else if (mood === 'wave') {
      right_angle = -Math.PI * 0.3;
      right_wave = Math.sin(time / 140) * 0.45;
    } else if (mood === 'pointing') {
      right_angle = opts.angle === undefined ? 0 : opts.angle;
    } else if (mood === 'worried') {
      left_angle = Math.PI * 0.55;
      right_angle = Math.PI * 0.45;
    }
    arm(ctx, cx - size * 0.3, arm_y, size, left_angle, 0);
    arm(ctx, cx + size * 0.3, arm_y, size, right_angle, right_wave);
    // Sugar-coated body from the shader.
    const body = bodyCanvas(size * (root.devicePixelRatio || 1));
    ctx.save();
    ctx.translate(cx, y + size * 0.42);
    ctx.scale(1 / squash, squash);
    ctx.drawImage(body, -size / 2, -size * 0.92, size, size);
    ctx.restore();
    leaves(ctx, cx, y - size * 0.35 * squash, size, Math.sin(time / 600) * 0.08);
    // Face.
    const eye_y = y - size * 0.02;
    const eye_dx = size * 0.15;
    const eye_r = size * (mood === 'wow' ? 0.105 : 0.085);
    const blink_phase = time % 3800;
    let open = mood === 'blink' || (mood === 'idle' && blink_phase < 130) ? 0.05 : 1;
    if (mood === 'cheer') open = 0.9;
    const look_x = mood === 'pointing' ? Math.cos(opts.angle || 0) : 0;
    const look_y = mood === 'pointing' ? Math.sin(opts.angle || 0) : mood === 'worried' ? 0.4 : 0;
    eye(ctx, cx - eye_dx, eye_y, eye_r, mood === 'wink' ? 0.05 : open, look_x, look_y);
    eye(ctx, cx + eye_dx, eye_y, eye_r, open, look_x, look_y);
    if (mood === 'worried') {
      ctx.strokeStyle = '#2b1238';
      ctx.lineWidth = size * 0.022;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - eye_dx - eye_r, eye_y - eye_r * 1.25);
      ctx.lineTo(cx - eye_dx + eye_r * 0.6, eye_y - eye_r * 1.55);
      ctx.moveTo(cx + eye_dx + eye_r, eye_y - eye_r * 1.25);
      ctx.lineTo(cx + eye_dx - eye_r * 0.6, eye_y - eye_r * 1.55);
      ctx.stroke();
    }
    // Blush.
    ctx.fillStyle = 'rgba(255,110,160,0.45)';
    [[-1], [1]].forEach(([side]) => {
      ctx.beginPath();
      ctx.ellipse(cx + side * size * 0.25, eye_y + size * 0.1, size * 0.06, size * 0.035, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    // Mouth.
    const mouth_y = eye_y + size * 0.13;
    ctx.strokeStyle = '#2b1238';
    ctx.fillStyle = '#5a1838';
    ctx.lineWidth = size * 0.02;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (mood === 'cheer') {
      ctx.moveTo(cx - size * 0.09, mouth_y - size * 0.01);
      ctx.quadraticCurveTo(cx, mouth_y + size * 0.14, cx + size * 0.09, mouth_y - size * 0.01);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff7fa8';
      ctx.beginPath();
      ctx.ellipse(cx, mouth_y + size * 0.05, size * 0.04, size * 0.022, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood === 'wow') {
      ctx.ellipse(cx, mouth_y + size * 0.02, size * 0.035, size * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (mood === 'worried') {
      ctx.moveTo(cx - size * 0.06, mouth_y + size * 0.03);
      ctx.quadraticCurveTo(cx, mouth_y - size * 0.02, cx + size * 0.06, mouth_y + size * 0.03);
      ctx.stroke();
    } else if (mood === 'wink') {
      ctx.moveTo(cx - size * 0.06, mouth_y);
      ctx.quadraticCurveTo(cx + size * 0.02, mouth_y + size * 0.07, cx + size * 0.08, mouth_y - size * 0.02);
      ctx.stroke();
    } else {
      ctx.moveTo(cx - size * 0.07, mouth_y);
      ctx.quadraticCurveTo(cx, mouth_y + size * 0.07, cx + size * 0.07, mouth_y);
      ctx.stroke();
    }
  }

  /** A self-animating Pip in a canvas element (redraws only while attached and visible). */
  function createPipView(canvas, size_px) {
    let expression = 'idle';
    let angle = 0;
    let frame = 0;
    let running = false;
    const ratio = Math.min(2.5, root.devicePixelRatio || 1);
    canvas.width = Math.round(size_px * ratio);
    canvas.height = Math.round(size_px * 1.15 * ratio);
    canvas.style.width = `${size_px}px`;
    canvas.style.height = `${size_px * 1.15}px`;
    const ctx = canvas.getContext('2d');
    const reduced = () => document.getElementById('app') && document.getElementById('app').classList.contains('reduced-motion');
    const draw = (time) => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, size_px, size_px * 1.15);
      drawPip(ctx, size_px / 2, size_px * 0.62, size_px * 0.8, expression, reduced() ? 0 : time, { angle });
    };
    const loop = (time) => {
      if (!running) return;
      if (!canvas.isConnected) {
        running = false;
        return;
      }
      draw(time);
      frame = requestAnimationFrame(loop);
    };
    const view = {
      canvas,
      set(next_expression, next_angle) {
        expression = next_expression;
        if (next_angle !== undefined) angle = next_angle;
        if (!running) {
          running = true;
          frame = requestAnimationFrame(loop);
        }
        return view;
      },
      stop() {
        running = false;
        cancelAnimationFrame(frame);
      },
    };
    draw(0);
    return view;
  }

  /** A small static PNG of Pip (for <img> in modals that do not animate). */
  function pipImageUrl(expression, size_px) {
    const canvas = SPRITES.createCanvas(size_px * 2, Math.round(size_px * 2.3));
    const ctx = canvas.getContext('2d');
    drawPip(ctx, size_px, size_px * 1.24, size_px * 1.6, expression, 0, {});
    return canvas.toDataURL ? canvas.toDataURL('image/png') : '';
  }

  SC.PIP = { EXPRESSIONS, drawPip, createPipView, pipImageUrl };
})(typeof window !== 'undefined' ? window : globalThis);
