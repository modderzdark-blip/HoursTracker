// RENDER: board renderer, central cancellable timeline, particles, effects and event-list playback.
// The renderer never decides game rules: it only animates the event list computed by LOGIC.
(function attachRender(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;
  const UTIL = SC.UTIL;
  const SPRITES = SC.SPRITES;
  const EASE = UTIL.EASE;
  const TIMING = CONFIG.TIMING;

  // ================================================================ TIMELINE
  /**
   * One central animation clock. Tweens advance only when the frame loop advances the clock (with a clamped delta),
   * so backgrounding the app freezes animations. cancelAll() bumps the generation and resolves every pending tween,
   * letting playback bail out cleanly (no orphaned timeouts, no stuck states).
   */
  function createTimeline() {
    let clock_ms = 0;
    let tweens = [];
    let generation = 0;
    const timeline = {
      get now() {
        return clock_ms;
      },
      get generation() {
        return generation;
      },
      get busy() {
        return tweens.length > 0;
      },
      advance(delta_ms) {
        clock_ms += delta_ms;
        if (tweens.length === 0) return;
        const finished = [];
        const active = tweens;
        tweens = [];
        active.forEach((tween) => {
          const progress = tween.duration <= 0 ? 1 : UTIL.clamp((clock_ms - tween.start) / tween.duration, 0, 1);
          if (clock_ms >= tween.start && tween.update) tween.update(progress);
          if (progress >= 1 && clock_ms >= tween.start) finished.push(tween);
          else tweens.push(tween);
        });
        finished.forEach((tween) => tween.resolve(true));
      },
      tween(duration_ms, update, delay_ms) {
        return new Promise((resolve) => {
          tweens.push({ start: clock_ms + (delay_ms || 0), duration: duration_ms, update, resolve });
        });
      },
      wait(duration_ms) {
        return timeline.tween(duration_ms, null, 0);
      },
      cancelAll() {
        generation += 1;
        const pending = tweens;
        tweens = [];
        pending.forEach((tween) => tween.resolve(false));
      },
    };
    return timeline;
  }

  // ================================================================ PARTICLES
  function createParticlePool(capacity) {
    const particles = [];
    for (let index = 0; index < capacity; index += 1) particles.push({ active: false });
    let cursor = 0;
    let active_count = 0;
    return {
      get activeCount() {
        return active_count;
      },
      spawn(fields) {
        for (let attempt = 0; attempt < capacity; attempt += 1) {
          const particle = particles[cursor];
          cursor = (cursor + 1) % capacity;
          if (!particle.active) {
            Object.assign(particle, { active: true, age: 0, rotation: 0, spin: 0, gravity: 900, drag: 0.985, size: 6, alpha: 1, kind: 'circle', color: '#ffffff' }, fields);
            active_count += 1;
            return particle;
          }
        }
        return null;
      },
      update(delta_s) {
        for (let index = 0; index < capacity; index += 1) {
          const particle = particles[index];
          if (!particle.active) continue;
          particle.age += delta_s;
          if (particle.age >= particle.life) {
            particle.active = false;
            active_count -= 1;
            continue;
          }
          particle.vy += particle.gravity * delta_s;
          particle.vx *= particle.drag;
          particle.vy *= particle.drag;
          particle.x += particle.vx * delta_s;
          particle.y += particle.vy * delta_s;
          particle.rotation += particle.spin * delta_s;
        }
      },
      draw(ctx) {
        for (let index = 0; index < capacity; index += 1) {
          const particle = particles[index];
          if (!particle.active) continue;
          const remaining = 1 - particle.age / particle.life;
          ctx.globalAlpha = Math.max(0, Math.min(1, remaining * 1.6)) * particle.alpha;
          ctx.fillStyle = particle.color;
          if (particle.kind === 'circle') {
            ctx.beginPath();
            ctx.arc(particle.x, particle.y, particle.size * (0.5 + remaining * 0.5), 0, Math.PI * 2);
            ctx.fill();
          } else if (particle.kind === 'star' || particle.kind === 'sparkle') {
            drawStar(ctx, particle.x, particle.y, particle.size * (0.6 + remaining * 0.4), particle.rotation, particle.kind === 'sparkle' ? 4 : 5);
          } else if (particle.kind === 'shard') {
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.beginPath();
            ctx.moveTo(0, -particle.size);
            ctx.lineTo(particle.size * 0.6, particle.size * 0.5);
            ctx.lineTo(-particle.size * 0.5, particle.size * 0.4);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillRect(-particle.size * 0.15, -particle.size * 0.6, particle.size * 0.2, particle.size * 0.6);
            ctx.restore();
          } else if (particle.kind === 'confetti') {
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.scale(1, Math.cos(particle.age * 9 + particle.size));
            ctx.fillRect(-particle.size, -particle.size * 0.45, particle.size * 2, particle.size * 0.9);
            ctx.restore();
          }
        }
        ctx.globalAlpha = 1;
      },
      clear() {
        particles.forEach((particle) => {
          particle.active = false;
        });
        active_count = 0;
      },
    };
  }

  function drawStar(ctx, x, y, radius, rotation, points) {
    ctx.beginPath();
    for (let index = 0; index < points * 2; index += 1) {
      const angle = rotation + (index * Math.PI) / points;
      const length = index % 2 === 0 ? radius : radius * (points === 4 ? 0.28 : 0.45);
      const point_x = x + Math.cos(angle) * length;
      const point_y = y + Math.sin(angle) * length;
      if (index === 0) ctx.moveTo(point_x, point_y);
      else ctx.lineTo(point_x, point_y);
    }
    ctx.closePath();
    ctx.fill();
  }

  // ================================================================ BOARD RENDERER
  function createBoardRenderer(game_canvas) {
    const ctx = game_canvas.getContext('2d');
    const timeline = createTimeline();
    const particles = createParticlePool(CONFIG.MAX_PARTICLES);
    const sprites = SPRITES.createSpriteCache();
    const visuals = new Map(); // piece id -> visual
    const effects = []; // beams, rings, arcs
    const popups = [];
    let board = null; // { rows, cols, holes, exits, spawn_rows }
    let display_jelly = null;
    let layout = { cell: 48, origin_x: 0, origin_y: 0, width: 0, height: 0, dpr: 1, view_w: 0, view_h: 0 };
    let static_layer = null;
    let settings = { theme: 'gummy', colorblind: false, reduced_motion: false };
    let display_cage = null;
    let level_sprite_keys = { now: [], later: [] };
    let quality = 2; // 2 high, 1 medium, 0 low (adaptive)
    let selected_cell = -1;
    let hint_move = null;
    let hint_cells = new Set(); // every candy of the suggested match (they pulse together)
    let drag = null; // { cell, dx, dy }
    let shake = { amplitude: 0, until: 0 };
    let board_visible = false;
    let playback_speed = 1;
    let idle_since = 0;
    let sheen = null; // { piece_id, start }
    let next_sheen_at = 0;
    let sheen_canvas = null;
    const board_flash = { alpha: 0 };

    function particleScale() {
      const quality_scale = quality === 2 ? 1 : quality === 1 ? 0.5 : 0.25;
      return settings.reduced_motion ? Math.min(0.25, quality_scale) : quality_scale;
    }

    // ---------------------------------------------------------------- layout
    function resizeCanvas(view_w, view_h, device_ratio) {
      const ratio = Math.min(2.5, Math.max(1, device_ratio || 1));
      layout.dpr = ratio;
      layout.view_w = view_w;
      layout.view_h = view_h;
      game_canvas.width = Math.round(view_w * ratio);
      game_canvas.height = Math.round(view_h * ratio);
      game_canvas.style.width = `${view_w}px`;
      game_canvas.style.height = `${view_h}px`;
    }

    function placeBoard(slot) {
      if (!board) return;
      // Leave room for the frosted frame around the cells (about 0.2 of a cell on each side).
      const cell = Math.max(20, Math.floor(Math.min(slot.width / (board.cols + 0.4), slot.height / (board.rows + 0.4), CONFIG.MAX_CELL_PX)));
      layout.cell = cell;
      layout.width = cell * board.cols;
      layout.height = cell * board.rows;
      layout.origin_x = Math.round(slot.left + (slot.width - layout.width) / 2);
      layout.origin_y = Math.round(slot.top + (slot.height - layout.height) / 2);
      sprites.configure(cell, settings.theme, settings.colorblind, layout.dpr);
      sprites.prepare(level_sprite_keys.now);
      sprites.warm(level_sprite_keys.later);
      buildStaticLayer();
    }

    function isActive(row, col) {
      return row >= 0 && col >= 0 && row < board.rows && col < board.cols && !board.holes[row * board.cols + col];
    }

    /**
     * Frosted-glass board following the board shape: soft drop shadow, bright rim, a translucent plum pane with an
     * inner highlight, alternating translucent cells with a subtle bevel, then exit trays, portal rings and belt tracks.
     */
    function buildStaticLayer() {
      const cell = layout.cell;
      const pad = Math.round(cell * 0.18);
      const width = layout.width + pad * 2;
      const height = layout.height + pad * 2 + Math.round(cell * 0.3);
      const ratio = layout.dpr;
      static_layer = SPRITES.createCanvas(Math.round(width * ratio), Math.round(height * ratio));
      const layer = static_layer.getContext('2d');
      layer.scale(ratio, ratio);
      layer.translate(pad, pad);
      const frame = new Path2D();
      const frame_rim = new Path2D();
      for (let row = 0; row < board.rows; row += 1) {
        for (let col = 0; col < board.cols; col += 1) {
          if (!isActive(row, col)) continue;
          SPRITES.roundedRectPath(frame, col * cell - pad, row * cell - pad, cell + pad * 2, cell + pad * 2, pad * 1.6);
          SPRITES.roundedRectPath(frame_rim, col * cell - pad - 2.5, row * cell - pad - 2.5, cell + pad * 2 + 5, cell + pad * 2 + 5, pad * 1.8);
        }
      }
      layer.save();
      layer.shadowColor = 'rgba(59,26,74,0.38)';
      layer.shadowBlur = cell * 0.45;
      layer.shadowOffsetY = cell * 0.12;
      layer.fillStyle = 'rgba(255,255,255,0.78)';
      layer.fill(frame_rim, 'nonzero');
      layer.restore();
      const pane = layer.createLinearGradient(0, -pad, 0, board.rows * cell + pad);
      pane.addColorStop(0, 'rgba(98,52,140,0.62)');
      pane.addColorStop(1, 'rgba(70,32,110,0.72)');
      layer.fillStyle = pane;
      layer.fill(frame, 'nonzero');
      layer.save();
      layer.clip(frame, 'nonzero');
      // Frosted inner highlight along the top and a soft glow at the bottom edge.
      const sheen = layer.createLinearGradient(0, -pad, 0, cell * 1.2);
      sheen.addColorStop(0, 'rgba(255,255,255,0.32)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      layer.fillStyle = sheen;
      layer.fillRect(-pad, -pad, board.cols * cell + pad * 2, cell * 1.2 + pad);
      layer.restore();
      for (let row = 0; row < board.rows; row += 1) {
        for (let col = 0; col < board.cols; col += 1) {
          if (!isActive(row, col)) continue;
          const x = col * cell;
          const y = row * cell;
          const tile = SPRITES.roundedRectPath(new Path2D(), x + 1.5, y + 1.5, cell - 3, cell - 3, cell * 0.14);
          layer.fillStyle = (row + col) % 2 === 0 ? 'rgba(255,240,255,0.24)' : 'rgba(255,230,250,0.12)';
          layer.fill(tile);
          layer.save();
          layer.clip(tile);
          const bevel = layer.createLinearGradient(x, y, x, y + cell);
          bevel.addColorStop(0, 'rgba(255,255,255,0.22)');
          bevel.addColorStop(0.18, 'rgba(255,255,255,0.04)');
          bevel.addColorStop(0.85, 'rgba(40,10,60,0.04)');
          bevel.addColorStop(1, 'rgba(40,10,60,0.2)');
          layer.fillStyle = bevel;
          layer.fillRect(x, y, cell, cell);
          layer.restore();
          if (board.exits[row * board.cols + col]) drawExitTray(layer, x, y, cell, pad);
        }
      }
      board.belts.forEach((belt) => drawBeltTrack(layer, belt, cell));
      for (let cell_index = 0; cell_index < board.portal_to.length; cell_index += 1) {
        const exit = board.portal_to[cell_index];
        if (exit < 0) continue;
        drawPortalRing(layer, cell_index, cell, '#b06cff', true);
        drawPortalRing(layer, exit, cell, '#3fd0ff', false);
      }
      static_layer.pad = pad;
      static_layer.css_w = width;
      static_layer.css_h = height;
    }

    function drawExitTray(layer, x, y, cell, pad) {
      // A small glossy candy-dish under the cell with a down arrow.
      const tray_y = y + cell + pad * 0.15;
      const tray = new Path2D();
      tray.moveTo(x + cell * 0.16, tray_y);
      tray.lineTo(x + cell * 0.84, tray_y);
      tray.quadraticCurveTo(x + cell * 0.78, tray_y + cell * 0.26, x + cell * 0.5, tray_y + cell * 0.26);
      tray.quadraticCurveTo(x + cell * 0.22, tray_y + cell * 0.26, x + cell * 0.16, tray_y);
      tray.closePath();
      const tray_fill = layer.createLinearGradient(0, tray_y, 0, tray_y + cell * 0.26);
      tray_fill.addColorStop(0, '#fff2b0');
      tray_fill.addColorStop(1, '#f0a630');
      layer.fillStyle = tray_fill;
      layer.fill(tray);
      layer.strokeStyle = 'rgba(122,62,0,0.75)';
      layer.lineWidth = 1.5;
      layer.stroke(tray);
      layer.fillStyle = 'rgba(122,62,0,0.9)';
      layer.beginPath();
      layer.moveTo(x + cell * 0.41, tray_y + cell * 0.05);
      layer.lineTo(x + cell * 0.59, tray_y + cell * 0.05);
      layer.lineTo(x + cell * 0.5, tray_y + cell * 0.18);
      layer.closePath();
      layer.fill();
    }

    function drawBeltTrack(layer, belt, cell) {
      const horizontal = belt.direction === 1 || belt.direction === 2;
      belt.cells.forEach((cell_index) => {
        const position = cellXY(cell_index);
        const x = position.col * cell;
        const y = position.row * cell;
        const track = SPRITES.roundedRectPath(new Path2D(), x + cell * 0.04, y + cell * 0.04, cell * 0.92, cell * 0.92, cell * 0.18);
        const fill = horizontal ? layer.createLinearGradient(0, y, 0, y + cell) : layer.createLinearGradient(x, 0, x + cell, 0);
        fill.addColorStop(0, 'rgba(255,214,110,0.55)');
        fill.addColorStop(0.5, 'rgba(255,170,60,0.35)');
        fill.addColorStop(1, 'rgba(200,110,20,0.55)');
        layer.fillStyle = fill;
        layer.fill(track);
        layer.strokeStyle = 'rgba(255,240,200,0.7)';
        layer.lineWidth = 1.5;
        layer.stroke(track);
      });
    }

    function drawPortalRing(layer, cell_index, cell, color, entrance) {
      const position = cellXY(cell_index);
      const cx = (position.col + 0.5) * cell;
      const cy = entrance ? (position.row + 0.94) * cell : (position.row + 0.06) * cell;
      layer.save();
      layer.lineWidth = Math.max(2, cell * 0.08);
      layer.strokeStyle = color;
      layer.shadowColor = color;
      layer.shadowBlur = cell * 0.25;
      layer.beginPath();
      layer.ellipse(cx, cy, cell * 0.4, cell * 0.11, 0, 0, Math.PI * 2);
      layer.stroke();
      layer.restore();
    }

    /** Animated board features drawn every frame: swirling portals and chevrons moving along the belts. */
    function drawBoardFeatures(now) {
      const cell = layout.cell;
      if (board.belts.length) {
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        const phase = settings.reduced_motion ? 0 : (now / 900) % 1;
        board.belts.forEach((belt) => {
          const step = { 1: [1, 0], 2: [-1, 0], 3: [0, -1], 4: [0, 1] }[belt.direction];
          belt.cells.forEach((cell_index) => {
            const center = cellCenter(cell_index);
            for (let chevron = -1; chevron <= 1; chevron += 1) {
              const offset = (chevron + phase) * cell * 0.33;
              const x = center.x + step[0] * offset;
              const y = center.y + step[1] * offset;
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(Math.atan2(step[1], step[0]));
              ctx.beginPath();
              ctx.moveTo(-cell * 0.05, -cell * 0.12);
              ctx.lineTo(cell * 0.07, 0);
              ctx.lineTo(-cell * 0.05, cell * 0.12);
              ctx.lineTo(-cell * 0.01, 0);
              ctx.closePath();
              ctx.globalAlpha = 0.35 + 0.25 * (1 - Math.abs(chevron + phase - 0.5) / 1.5);
              ctx.fill();
              ctx.restore();
            }
          });
        });
        ctx.restore();
      }
      if (quality > 0 && !settings.reduced_motion) {
        for (let cell_index = 0; cell_index < board.portal_to.length; cell_index += 1) {
          const exit = board.portal_to[cell_index];
          if (exit < 0) continue;
          [[cell_index, 0.94, '#e0b8ff'], [exit, 0.06, '#c4f2ff']].forEach(([portal_cell, offset_y, color]) => {
            const position = cellXY(portal_cell);
            const cx = layout.origin_x + (position.col + 0.5) * cell;
            const cy = layout.origin_y + (position.row + offset_y) * cell;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.8;
            ctx.lineWidth = Math.max(1, cell * 0.03);
            const spin = now / 400;
            for (let arc = 0; arc < 3; arc += 1) {
              ctx.beginPath();
              ctx.ellipse(cx, cy, cell * 0.32, cell * 0.08, 0, spin + arc * 2.1, spin + arc * 2.1 + 1.1);
              ctx.stroke();
            }
            ctx.restore();
          });
        }
      }
    }

    // ---------------------------------------------------------------- visuals
    function cellXY(cell_index) {
      return { col: cell_index % board.cols, row: Math.floor(cell_index / board.cols) };
    }

    function makeVisual(piece, cell_index) {
      const position = cellXY(cell_index);
      return {
        id: piece.id, kind: piece.kind, color: piece.color, special: piece.special, layers: piece.layers, max_layers: piece.layers, fuse: piece.fuse,
        x: position.col, y: position.row, scale_x: 1, scale_y: 1, scale: 1, alpha: 1, rotation: 0, flash: 0, lift: 0,
        wobble_seed: (piece.id * 0.618) % 1,
      };
    }

    /** Rebuilds visuals from a logic state (used at level start and as a safety net after every playback). */
    function syncToState(state) {
      const seen = new Set();
      state.cells.forEach((piece, cell_index) => {
        if (!piece) return;
        seen.add(piece.id);
        const position = cellXY(cell_index);
        let visual = visuals.get(piece.id);
        if (!visual) {
          visual = makeVisual(piece, cell_index);
          visuals.set(piece.id, visual);
        }
        Object.assign(visual, { kind: piece.kind, color: piece.color, special: piece.special, layers: piece.layers, max_layers: Math.max(visual.max_layers || 0, piece.layers), fuse: piece.fuse, x: position.col, y: position.row, scale_x: 1, scale_y: 1, scale: 1, alpha: 1, rotation: 0, flash: 0, lift: 0 });
      });
      Array.from(visuals.keys()).forEach((piece_id) => {
        if (!seen.has(piece_id)) visuals.delete(piece_id);
      });
      display_jelly = Uint8Array.from(state.jelly);
      display_cage = Uint8Array.from(state.cage);
    }

    function setLevel(state) {
      timeline.cancelAll();
      visuals.clear();
      effects.length = 0;
      popups.length = 0;
      particles.clear();
      const spawn_rows = state.spawn_cells.map((spawn_cell) => (spawn_cell < 0 ? 0 : Math.floor(spawn_cell / state.cols)));
      board = { rows: state.rows, cols: state.cols, holes: state.holes, exits: state.exits, spawn_rows, belts: state.belts || [], portal_to: state.portal_to, palette: state.palette };
      const kinds = new Set();
      state.cells.forEach((piece) => {
        if (!piece) return;
        if (piece.kind === 'frosting') kinds.add(`frosting:${piece.layers}`);
        else if (piece.kind !== 'candy') kinds.add(piece.kind);
      });
      if (Array.prototype.some.call(state.cage, (value) => value)) kinds.add('cage');
      if (Array.prototype.some.call(state.jelly, (value) => value)) kinds.add('jelly:1').add('jelly:2');
      level_sprite_keys = SPRITES.keysForLevel(state.palette, Array.from(kinds));
      selected_cell = -1;
      hint_move = null;
      drag = null;
      syncToState(state);
      board_visible = true;
    }

    function visualAtCell(cell_index) {
      const position = cellXY(cell_index);
      for (const visual of visuals.values()) {
        if (Math.abs(visual.x - position.col) < 0.01 && Math.abs(visual.y - position.row) < 0.01) return visual;
      }
      return null;
    }

    function screenOf(col, row) {
      return { x: layout.origin_x + (col + 0.5) * layout.cell, y: layout.origin_y + (row + 0.5) * layout.cell };
    }

    function cellCenter(cell_index) {
      const position = cellXY(cell_index);
      return screenOf(position.col, position.row);
    }

    // ---------------------------------------------------------------- effects helpers
    function burst(cell_index, color_hex, count, power) {
      const center = cellCenter(cell_index);
      const total = Math.max(1, Math.round(count * particleScale()));
      const palette = color_hex ? [color_hex, '#ffffff', SPRITES.mixHex(color_hex, '#ffffff', 0.5)] : ['#ffffff', '#ffe58a', '#ff9ad5'];
      for (let index = 0; index < total; index += 1) {
        const angle = Math.random() * Math.PI * 2;
        const speed = (120 + Math.random() * 260) * (power || 1);
        const kind = index % 3 === 0 ? 'star' : index % 3 === 1 ? 'circle' : 'shard';
        particles.spawn({
          x: center.x, y: center.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 140,
          life: 0.5 + Math.random() * 0.45, size: layout.cell * (0.06 + Math.random() * 0.08), color: palette[index % palette.length],
          kind, spin: (Math.random() - 0.5) * 12, gravity: 700,
        });
      }
    }

    function addPopup(cell_index, points) {
      const center = cell_index >= 0 ? cellCenter(cell_index) : { x: layout.origin_x + layout.width / 2, y: layout.origin_y + layout.height / 2 };
      const size = Math.min(layout.cell * 0.9, layout.cell * (0.36 + Math.min(0.5, points / 2000)));
      popups.push({ x: center.x, y: center.y, text: `+${points}`, size, born: timeline.now, life: 900 });
    }

    function addTextPopup(cell_index, text, color) {
      const center = cell_index >= 0 ? cellCenter(cell_index) : { x: layout.origin_x + layout.width / 2, y: layout.origin_y + layout.height / 2 };
      popups.push({ x: center.x, y: center.y - layout.cell * 0.3, text, size: layout.cell * 0.42, born: timeline.now, life: 1000, color });
    }

    function addShake(amplitude, duration_ms) {
      if (settings.reduced_motion) return;
      shake.amplitude = Math.max(shake.amplitude, amplitude);
      shake.until = timeline.now + duration_ms;
    }

    function addEffect(effect) {
      effect.born = timeline.now;
      effects.push(effect);
    }

    // ---------------------------------------------------------------- drawing
    function drawPiece(visual, now) {
      const cell = layout.cell;
      const sprite = sprites.get(visual.kind, visual.color, visual.special, visual.layers);
      if (!sprite) return;
      const center = screenOf(visual.x, visual.y);
      let alpha = visual.alpha;
      const spawn_row = board.spawn_rows[Math.round(visual.x)] || 0;
      if (visual.y < spawn_row) alpha *= UTIL.clamp(1 - (spawn_row - visual.y) * 1.1, 0, 1);
      if (alpha <= 0.01) return;
      let scale_x = visual.scale * visual.scale_x;
      let scale_y = visual.scale * visual.scale_y;
      // Idle breathing wobble, staggered across the board.
      if (visual.kind === 'candy' && !settings.reduced_motion && quality > 0 && !timeline.busy) {
        const breathing = Math.sin(now / 900 + visual.wobble_seed * 6.28 + visual.x * 0.7 + visual.y * 0.5) * 0.018;
        scale_x *= 1 + breathing;
        scale_y *= 1 - breathing;
      }
      let offset_x = 0;
      let offset_y = -visual.lift * cell * 0.06;
      // Hint: the candies of the suggested match pulse together and the one to move nudges toward its target.
      if (hint_move && !timeline.busy && visual.kind === 'candy' && !settings.reduced_motion) {
        const cell_index = Math.round(visual.y) * board.cols + Math.round(visual.x);
        if (hint_cells.has(cell_index)) {
          const pulse = 0.5 + 0.5 * Math.sin(now / 150);
          scale_x *= 1 + 0.1 * pulse;
          scale_y *= 1 + 0.1 * pulse;
          if (cell_index === hint_move.from) {
            const target = cellXY(hint_move.to);
            offset_x += (target.col - Math.round(visual.x)) * cell * 0.14 * pulse;
            offset_y += (target.row - Math.round(visual.y)) * cell * 0.14 * pulse;
          }
        }
      }
      if (drag && drag.piece_id === visual.id) {
        offset_x = drag.dx;
        offset_y += drag.dy;
      }
      const draw_x = center.x + offset_x;
      const draw_y = center.y + offset_y + (1 - scale_y) * cell * 0.4;
      // Special glows (pulsing wrapped, orbiting sparkles on the color bomb).
      if (visual.special === 'wrapped' || visual.special === 'wrapped_armed' || visual.special === 'wrapped_big_armed') {
        const armed = visual.special !== 'wrapped';
        const pulse = 0.5 + 0.5 * Math.sin(now / (armed ? 90 : 320) + visual.wobble_seed * 6);
        const glow = ctx.createRadialGradient(draw_x, draw_y, cell * 0.1, draw_x, draw_y, cell * (armed ? 0.75 : 0.62));
        const glow_color = CONFIG.CANDIES[visual.color] ? CONFIG.CANDIES[visual.color].highlight : '#ffffff';
        glow.addColorStop(0, SPRITES.rgba(armed ? '#ffffff' : glow_color, (armed ? 0.7 : 0.45) * pulse * alpha));
        glow.addColorStop(1, SPRITES.rgba(glow_color, 0));
        ctx.fillStyle = glow;
        ctx.fillRect(draw_x - cell, draw_y - cell, cell * 2, cell * 2);
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(draw_x, draw_y);
      if (visual.rotation) ctx.rotate(visual.rotation);
      ctx.scale(scale_x, scale_y);
      ctx.drawImage(sprite, -cell / 2, -cell / 2, cell, cell);
      if (visual.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * visual.flash;
        ctx.drawImage(sprite, -cell / 2, -cell / 2, cell, cell);
        ctx.globalAlpha = alpha * visual.flash * 0.35;
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, cell * 0.5);
        glow.addColorStop(0, 'rgba(255,255,255,0.95)');
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, cell * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      }
      if (visual.kind === 'frosting' && visual.max_layers > visual.layers) drawCracks(visual, cell);
      ctx.restore();
      if (visual.fuse !== undefined) drawFuse(visual, draw_x, draw_y, alpha, now);
      if (visual.special === 'bomb' && quality > 0) {
        for (let index = 0; index < 3; index += 1) {
          const angle = now / 600 + index * ((Math.PI * 2) / 3);
          ctx.fillStyle = ['#ffe14d', '#ff6fb5', '#8ee3ff'][index];
          ctx.globalAlpha = alpha * 0.9;
          drawStar(ctx, draw_x + Math.cos(angle) * cell * 0.46, draw_y + Math.sin(angle) * cell * 0.3, cell * 0.08, angle * 2, 4);
          ctx.globalAlpha = 1;
        }
      }
      if ((visual.special === 'stripe_row' || visual.special === 'stripe_col') && !settings.reduced_motion && quality > 0) {
        const phase = ((now + visual.wobble_seed * TIMING.STRIPE_SHIMMER_MS) % TIMING.STRIPE_SHIMMER_MS) / TIMING.STRIPE_SHIMMER_MS;
        if (phase < 0.22) drawSheen(sprite, draw_x, draw_y, scale_x, scale_y, phase / 0.22, alpha);
      }
      if (sheen && sheen.piece_id === visual.id) {
        const progress = (now - sheen.start) / 650;
        if (progress >= 1) sheen = null;
        else drawSheen(sprite, draw_x, draw_y, scale_x, scale_y, progress, alpha);
      }
      if (settings.theme === 'sprinkle' && visual.kind === 'candy' && quality > 0 && !settings.reduced_motion) {
        // Glitter specks twinkle on the sugar coat.
        for (let index = 0; index < 2; index += 1) {
          const twinkle = Math.sin(now / 260 + visual.wobble_seed * 40 + index * 2.1);
          if (twinkle < 0.75) continue;
          const angle = visual.wobble_seed * 20 + index * 2.4;
          ctx.globalAlpha = alpha * (twinkle - 0.75) * 4;
          ctx.fillStyle = '#ffffff';
          drawStar(ctx, draw_x + Math.cos(angle) * cell * 0.22, draw_y + Math.sin(angle) * cell * 0.2, cell * 0.07, 0, 4);
          ctx.globalAlpha = 1;
        }
      }
    }

    /** Hairline cracks on frosting that has lost layers (seeded by the piece, so they stay put). */
    function drawCracks(visual, cell) {
      const rng = UTIL.createRng(visual.id * 977 + visual.layers);
      const lost = visual.max_layers - visual.layers;
      ctx.save();
      ctx.strokeStyle = 'rgba(150,70,110,0.55)';
      ctx.lineWidth = Math.max(1, cell * 0.025);
      ctx.lineCap = 'round';
      for (let crack = 0; crack < Math.min(4, lost + 1); crack += 1) {
        let x = (rng() - 0.5) * cell * 0.5;
        let y = (rng() - 0.5) * cell * 0.5;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let segment = 0; segment < 4; segment += 1) {
          x += (rng() - 0.5) * cell * 0.28;
          y += (rng() - 0.5) * cell * 0.28;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    /** Fuse Candy countdown: a ring that drains as the fuse burns, the number of moves left, red and pulsing at 3 or less. */
    function drawFuse(visual, x, y, alpha, now) {
      const cell = layout.cell;
      const urgent = visual.fuse <= 3;
      const pulse = urgent && !settings.reduced_motion ? 0.5 + 0.5 * Math.sin(now / 120) : 0;
      const radius = cell * 0.17;
      const badge_x = x + cell * 0.27;
      const badge_y = y - cell * 0.27;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = urgent ? `rgba(${200 + 55 * pulse},40,60,0.95)` : 'rgba(59,26,74,0.9)';
      ctx.beginPath();
      ctx.arc(badge_x, badge_y, radius * (1 + 0.15 * pulse), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffe9a8';
      ctx.lineWidth = Math.max(1.5, cell * 0.035);
      ctx.beginPath();
      ctx.arc(badge_x, badge_y, radius * 1.05, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, visual.fuse / 10));
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(radius * 1.25)}px system-ui, Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(visual.fuse), badge_x, badge_y + radius * 0.05);
      ctx.restore();
    }

    /** Sugar Cages over caged candies (cages belong to cells, so they are drawn per cell). */
    function drawCages() {
      if (!display_cage) return;
      const cell = layout.cell;
      for (let cell_index = 0; cell_index < display_cage.length; cell_index += 1) {
        if (!display_cage[cell_index]) continue;
        const position = cellXY(cell_index);
        ctx.drawImage(sprites.get('cage'), layout.origin_x + position.col * cell, layout.origin_y + position.row * cell, cell, cell);
      }
    }

    /** Diagonal white sheen sweeping across a sprite (source-atop on a small scratch canvas). */
    function drawSheen(sprite, x, y, scale_x, scale_y, progress, alpha) {
      const cell = layout.cell;
      const size = Math.ceil(cell * layout.dpr);
      if (!sheen_canvas || sheen_canvas.width !== size) sheen_canvas = SPRITES.createCanvas(size, size);
      const sheen_ctx = sheen_canvas.getContext('2d');
      sheen_ctx.globalCompositeOperation = 'source-over';
      sheen_ctx.clearRect(0, 0, size, size);
      sheen_ctx.drawImage(sprite, 0, 0, size, size);
      sheen_ctx.globalCompositeOperation = 'source-in';
      const band_x = (progress * 1.8 - 0.4) * size;
      const band = sheen_ctx.createLinearGradient(band_x - size * 0.3, 0, band_x + size * 0.3, size * 0.6);
      band.addColorStop(0, 'rgba(255,255,255,0)');
      band.addColorStop(0.5, 'rgba(255,255,255,0.75)');
      band.addColorStop(1, 'rgba(255,255,255,0)');
      sheen_ctx.fillStyle = band;
      sheen_ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'lighter';
      ctx.translate(x, y);
      ctx.scale(scale_x, scale_y);
      ctx.drawImage(sheen_canvas, -cell / 2, -cell / 2, cell, cell);
      ctx.restore();
    }

    function drawEffects(now) {
      const cell = layout.cell;
      for (let index = effects.length - 1; index >= 0; index -= 1) {
        const effect = effects[index];
        const progress = (now - effect.born) / effect.duration;
        if (progress >= 1) {
          effects.splice(index, 1);
          continue;
        }
        const fade = 1 - progress;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        if (effect.type === 'beam') {
          const center = cellCenter(effect.cell);
          const thickness = cell * (0.75 - progress * 0.45);
          const reach = Math.min(1, progress * 3.2);
          const tint = effect.color || '#ffffff';
          if (effect.direction === 'row') {
            const left = UTIL.lerp(center.x, layout.origin_x - cell * 0.3, reach);
            const right = UTIL.lerp(center.x, layout.origin_x + layout.width + cell * 0.3, reach);
            const beam = ctx.createLinearGradient(0, center.y - thickness, 0, center.y + thickness);
            beam.addColorStop(0, SPRITES.rgba(tint, 0));
            beam.addColorStop(0.5, `rgba(255,255,255,${0.95 * fade})`);
            beam.addColorStop(1, SPRITES.rgba(tint, 0));
            ctx.fillStyle = beam;
            ctx.fillRect(left, center.y - thickness, right - left, thickness * 2);
          } else {
            const top = UTIL.lerp(center.y, layout.origin_y - cell * 0.3, reach);
            const bottom = UTIL.lerp(center.y, layout.origin_y + layout.height + cell * 0.3, reach);
            const beam = ctx.createLinearGradient(center.x - thickness, 0, center.x + thickness, 0);
            beam.addColorStop(0, SPRITES.rgba(tint, 0));
            beam.addColorStop(0.5, `rgba(255,255,255,${0.95 * fade})`);
            beam.addColorStop(1, SPRITES.rgba(tint, 0));
            ctx.fillStyle = beam;
            ctx.fillRect(center.x - thickness, top, thickness * 2, bottom - top);
          }
        } else if (effect.type === 'ring') {
          const center = cellCenter(effect.cell);
          const radius = cell * effect.radius * EASE.outCubic(progress);
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * fade})`;
          ctx.lineWidth = cell * 0.22 * fade + 2;
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.stroke();
          const core = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
          core.addColorStop(0, `rgba(255,240,200,${0.55 * fade})`);
          core.addColorStop(1, 'rgba(255,200,240,0)');
          ctx.fillStyle = core;
          ctx.beginPath();
          ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
          ctx.fill();
        } else if (effect.type === 'arcs') {
          const origin = cellCenter(effect.cell);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          effect.targets.forEach((target_cell, target_index) => {
            const appear = target_index / Math.max(1, effect.targets.length) * 0.45;
            if (progress < appear) return;
            const target = cellCenter(target_cell);
            const jitter_seed = Math.floor(now / 45) + target_index * 13;
            const jitter = UTIL.createRng(jitter_seed);
            ctx.strokeStyle = `rgba(190,240,255,${0.9 * fade})`;
            ctx.lineWidth = Math.max(1.5, cell * 0.05);
            ctx.beginPath();
            ctx.moveTo(origin.x, origin.y);
            const segments = 6;
            for (let segment = 1; segment < segments; segment += 1) {
              const t = segment / segments;
              const normal_x = -(target.y - origin.y);
              const normal_y = target.x - origin.x;
              const length = Math.hypot(normal_x, normal_y) || 1;
              const offset = (jitter() - 0.5) * cell * 0.5;
              ctx.lineTo(UTIL.lerp(origin.x, target.x, t) + (normal_x / length) * offset, UTIL.lerp(origin.y, target.y, t) + (normal_y / length) * offset);
            }
            ctx.lineTo(target.x, target.y);
            ctx.stroke();
            ctx.strokeStyle = `rgba(255,255,255,${fade})`;
            ctx.lineWidth = Math.max(1, cell * 0.018);
            ctx.stroke();
          });
        } else if (effect.type === 'flash') {
          ctx.fillStyle = `rgba(255,255,255,${0.55 * fade})`;
          ctx.fillRect(layout.origin_x - cell, layout.origin_y - cell, layout.width + cell * 2, layout.height + cell * 2);
        } else if (effect.type === 'transform_glow') {
          const center = cellCenter(effect.cell);
          const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, cell * 0.7);
          glow.addColorStop(0, `rgba(255,255,255,${0.8 * fade})`);
          glow.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(center.x - cell, center.y - cell, cell * 2, cell * 2);
        }
        ctx.restore();
      }
    }

    function drawPopups(now) {
      for (let index = popups.length - 1; index >= 0; index -= 1) {
        const popup = popups[index];
        const progress = (now - popup.born) / popup.life;
        if (progress >= 1) {
          popups.splice(index, 1);
          continue;
        }
        const rise = EASE.outCubic(progress) * layout.cell * 0.9;
        const pop_scale = progress < 0.15 ? EASE.outBack(progress / 0.15) : 1;
        ctx.save();
        ctx.globalAlpha = progress > 0.65 ? 1 - (progress - 0.65) / 0.35 : 1;
        ctx.translate(popup.x, popup.y - rise);
        ctx.scale(pop_scale, pop_scale);
        ctx.font = `900 ${Math.round(popup.size)}px system-ui, Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(3, popup.size * 0.2);
        ctx.strokeStyle = '#6a1b5a';
        ctx.strokeText(popup.text, 0, 0);
        const fill = ctx.createLinearGradient(0, -popup.size / 2, 0, popup.size / 2);
        fill.addColorStop(0, '#ffffff');
        fill.addColorStop(1, popup.color || '#ffe27a');
        ctx.fillStyle = fill;
        ctx.fillText(popup.text, 0, 0);
        ctx.restore();
      }
    }

    function drawHintAndSelection(now) {
      const cell = layout.cell;
      if (hint_move && !timeline.busy) {
        // A warm glow under every candy of the suggested match (steady when motion is reduced).
        const pulse = settings.reduced_motion ? 0.8 : 0.5 + 0.5 * Math.sin(now / 150);
        hint_cells.forEach((cell_index) => {
          const center = cellCenter(cell_index);
          const glow = ctx.createRadialGradient(center.x, center.y, cell * 0.1, center.x, center.y, cell * 0.78);
          glow.addColorStop(0, `rgba(255,250,200,${0.6 + 0.4 * pulse})`);
          glow.addColorStop(0.5, `rgba(255,220,100,${0.4 + 0.45 * pulse})`);
          glow.addColorStop(1, 'rgba(255,200,60,0)');
          ctx.fillStyle = glow;
          ctx.fillRect(center.x - cell, center.y - cell, cell * 2, cell * 2);
        });
      }
      if (selected_cell >= 0) {
        const center = cellCenter(selected_cell);
        const pulse = 0.5 + 0.5 * Math.sin(now / 140);
        ctx.save();
        ctx.strokeStyle = `rgba(255,255,255,${0.7 + 0.3 * pulse})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(255,120,200,0.9)';
        ctx.shadowBlur = 10;
        const half = cell * 0.47;
        ctx.stroke(SPRITES.roundedRectPath(new Path2D(), center.x - half, center.y - half, half * 2, half * 2, cell * 0.2));
        ctx.restore();
      }
    }

    /** The hint arrow: a bobbing glossy arrow over the two candies, pointing the way the hinted candy moves. */
    function drawHintArrow(now) {
      if (!hint_move || timeline.busy) return;
      const cell = layout.cell;
      const from = cellCenter(hint_move.from);
      const to = cellCenter(hint_move.to);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const bob = settings.reduced_motion ? 0 : Math.sin(now / 160) * cell * 0.08;
      const mid_x = (from.x + to.x) / 2 + Math.cos(angle) * bob;
      const mid_y = (from.y + to.y) / 2 + Math.sin(angle) * bob;
      ctx.save();
      ctx.translate(mid_x, mid_y);
      ctx.rotate(angle);
      const length = cell * 0.5;
      const head = cell * 0.24;
      const shaft = cell * 0.1;
      const arrow = new Path2D();
      arrow.moveTo(-length / 2, -shaft);
      arrow.lineTo(length / 2 - head, -shaft);
      arrow.lineTo(length / 2 - head, -head);
      arrow.lineTo(length / 2, 0);
      arrow.lineTo(length / 2 - head, head);
      arrow.lineTo(length / 2 - head, shaft);
      arrow.lineTo(-length / 2, shaft);
      arrow.closePath();
      ctx.shadowColor = 'rgba(59,26,74,0.55)';
      ctx.shadowBlur = cell * 0.12;
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, cell * 0.06);
      ctx.strokeStyle = '#3b1a4a';
      ctx.stroke(arrow);
      ctx.shadowBlur = 0;
      const fill = ctx.createLinearGradient(0, -head, 0, head);
      fill.addColorStop(0, '#fffbe0');
      fill.addColorStop(1, '#ffc93c');
      ctx.fillStyle = fill;
      ctx.fill(arrow);
      ctx.restore();
    }

    function draw(now) {
      const ratio = layout.dpr;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, layout.view_w, layout.view_h);
      if (!board_visible || !board || !static_layer) {
        particles.draw(ctx);
        return;
      }
      let shake_x = 0;
      let shake_y = 0;
      if (shake.amplitude > 0 && now < shake.until) {
        const strength = shake.amplitude * ((shake.until - now) / 400);
        shake_x = (Math.random() - 0.5) * strength;
        shake_y = (Math.random() - 0.5) * strength;
      } else {
        shake.amplitude = 0;
      }
      ctx.save();
      ctx.translate(shake_x, shake_y);
      ctx.drawImage(static_layer, layout.origin_x - static_layer.pad, layout.origin_y - static_layer.pad, static_layer.css_w, static_layer.css_h);
      const cell = layout.cell;
      for (let cell_index = 0; cell_index < display_jelly.length; cell_index += 1) {
        const layers = display_jelly[cell_index];
        if (!layers) continue;
        const position = cellXY(cell_index);
        ctx.drawImage(sprites.get('jelly', -1, 'none', layers), layout.origin_x + position.col * cell, layout.origin_y + position.row * cell, cell, cell);
      }
      drawBoardFeatures(now);
      drawHintAndSelection(now);
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.origin_x - cell * 0.5, layout.origin_y - cell * 0.2, layout.width + cell, layout.height + cell * 1.2);
      ctx.clip();
      const ordered = Array.from(visuals.values()).sort((first, second) => first.y - second.y || (first.lift || 0) - (second.lift || 0));
      ordered.forEach((visual) => drawPiece(visual, now));
      drawCages();
      ctx.restore();
      drawHintArrow(now);
      drawEffects(now);
      ctx.restore();
      particles.draw(ctx);
      drawPopups(now);
    }

    // ---------------------------------------------------------------- per-frame update
    function update(delta_ms) {
      timeline.advance(delta_ms * playback_speed);
      particles.update(delta_ms / 1000);
      const now = timeline.now;
      if (board_visible && board && !timeline.busy && !settings.reduced_motion && quality > 0) {
        if (now >= next_sheen_at) {
          const candy_ids = [];
          visuals.forEach((visual) => {
            if (visual.kind === 'candy') candy_ids.push(visual.id);
          });
          if (candy_ids.length) sheen = { piece_id: candy_ids[Math.floor(Math.random() * candy_ids.length)], start: now };
          next_sheen_at = now + TIMING.SHIMMER_EVERY_MS * (0.7 + Math.random() * 0.6);
        }
      }
      draw(now);
    }

    // ================================================================ PLAYBACK
    function groupPhases(events) {
      const phases = [];
      let current = { header: { kind: 'prelude' }, events: [] };
      events.forEach((event) => {
        if (event.type === 'phase') {
          phases.push(current);
          current = { header: event, events: [] };
        } else {
          current.events.push(event);
        }
      });
      phases.push(current);
      return phases.filter((phase) => phase.header.kind !== 'prelude' || phase.events.length);
    }

    function noop() {}

    async function playSwap(event, hooks) {
      const from_visual = visuals.get(event.from_piece_id);
      const to_visual = visuals.get(event.to_piece_id);
      const from_position = cellXY(event.from);
      const to_position = cellXY(event.to);
      hooks.sound('swap');
      hooks.haptic('tick');
      hooks.event(event);
      drag = null;
      await timeline.tween(TIMING.SWAP_MS, (t) => {
        const eased = EASE.inOutQuad(t);
        const squish = Math.sin(t * Math.PI) * 0.12;
        if (from_visual) {
          from_visual.x = UTIL.lerp(from_position.col, to_position.col, eased);
          from_visual.y = UTIL.lerp(from_position.row, to_position.row, eased);
          from_visual.scale_x = 1 + squish;
          from_visual.scale_y = 1 - squish;
          from_visual.lift = Math.sin(t * Math.PI);
        }
        if (to_visual) {
          to_visual.x = UTIL.lerp(to_position.col, from_position.col, eased);
          to_visual.y = UTIL.lerp(to_position.row, from_position.row, eased);
          to_visual.scale_x = 1 - squish * 0.6;
          to_visual.scale_y = 1 + squish * 0.6;
        }
      });
      if (from_visual) Object.assign(from_visual, { scale_x: 1, scale_y: 1, lift: 0 });
      if (to_visual) Object.assign(to_visual, { scale_x: 1, scale_y: 1 });
    }

    async function playInvalidSwap(from_cell, to_cell, hooks) {
      const generation = timeline.generation;
      const from_visual = visualAtCell(from_cell);
      const to_visual = visualAtCell(to_cell);
      const from_position = cellXY(from_cell);
      const to_position = cellXY(to_cell);
      hooks.sound('nope');
      drag = null;
      await timeline.tween(TIMING.INVALID_MS, (t) => {
        const out_and_back = t < 0.5 ? EASE.outQuad(t * 2) * 0.55 : (1 - EASE.inOutQuad((t - 0.5) * 2)) * 0.55;
        const wobble = settings.reduced_motion ? 0 : Math.sin(t * Math.PI * 6) * 0.05 * (1 - t);
        if (from_visual) {
          from_visual.x = UTIL.lerp(from_position.col, to_position.col, out_and_back) + wobble;
          from_visual.y = UTIL.lerp(from_position.row, to_position.row, out_and_back);
        }
        if (to_visual) {
          to_visual.x = UTIL.lerp(to_position.col, from_position.col, out_and_back) - wobble;
          to_visual.y = UTIL.lerp(to_position.row, from_position.row, out_and_back);
        }
      });
      if (generation !== timeline.generation) return false;
      if (from_visual) Object.assign(from_visual, { x: from_position.col, y: from_position.row });
      if (to_visual) Object.assign(to_visual, { x: to_position.col, y: to_position.row });
      return true;
    }

    function popVisual(visual, color, delay_ms, particle_count) {
      if (!visual) return Promise.resolve(true);
      const cell_index = Math.round(visual.y) * board.cols + Math.round(visual.x);
      return timeline.tween(TIMING.POP_MS, (t) => {
        visual.scale = t < 0.25 ? UTIL.lerp(1.15, 1.2, t / 0.25) : UTIL.lerp(1.2, 0, EASE.inQuad((t - 0.25) / 0.75));
        visual.alpha = t < 0.5 ? 1 : 1 - (t - 0.5) * 2;
        visual.flash = Math.max(0, 1 - t * 2);
        if (t >= 1) visuals.delete(visual.id);
      }, delay_ms || 0).then((completed) => {
        if (completed) burst(cell_index, color, particle_count || 10, 1);
        visuals.delete(visual.id);
        return completed;
      });
    }

    async function playClearPhase(phase, hooks) {
      const generation = timeline.generation;
      const depth = phase.header.depth || 1;
      const waves = new Map();
      const creates = [];
      let current_wave = 0;
      let in_creates = false;
      // Score events carry no wave: they belong to the wave (or creation) of the event just before them.
      phase.events.forEach((event) => {
        if (event.type === 'cascade' || event.type === 'end') return;
        if (event.type === 'create') {
          in_creates = true;
          creates.push(event);
          return;
        }
        if (event.type === 'score' && in_creates) {
          creates.push(event);
          return;
        }
        const wave = event.type === 'score' || event.wave === undefined ? current_wave : event.wave;
        current_wave = wave;
        if (!waves.has(wave)) waves.set(wave, []);
        waves.get(wave).push(event);
      });
      const wave_numbers = Array.from(waves.keys()).sort((a, b) => a - b);
      const merge_target = new Map(); // matched cell -> creation cell (candies slide into the new special)
      phase.events.forEach((event) => {
        if (event.type === 'match' && event.creation) event.cells.forEach((cell_index) => merge_target.set(cell_index, event.creation.cell));
      });
      for (const wave of wave_numbers) {
        if (generation !== timeline.generation) return false;
        const wave_events = waves.get(wave);
        const pending = [];
        const matches = wave_events.filter((event) => event.type === 'match');
        const activations = wave_events.filter((event) => event.type === 'activate' || event.type === 'combo');
        if (wave > 0) await timeline.wait(TIMING.WAVE_GAP_MS);
        if (generation !== timeline.generation) return false;
        if (matches.length) {
          hooks.sound('match', { depth, size: matches.reduce((sum, match) => sum + match.size, 0) });
          // Swell and glow white for 80 ms before popping.
          const swelling = [];
          matches.forEach((match) => match.cells.forEach((cell_index) => {
            const visual = visualAtCell(cell_index);
            if (visual) swelling.push(visual);
          }));
          await timeline.tween(TIMING.SWELL_MS, (t) => {
            swelling.forEach((visual) => {
              visual.scale = 1 + 0.15 * EASE.outQuad(t);
              visual.flash = t;
            });
          });
          if (generation !== timeline.generation) return false;
        }
        activations.forEach((event) => {
          if (event.type === 'combo') {
            hooks.sound('combo', { combo: event.combo });
            hooks.haptic('heavy');
            addShake(layout.cell * 0.18, 450);
            return;
          }
          playActivationEffect(event, hooks);
        });
        const wave_scores = wave_events.filter((event) => event.type === 'score' && event.reason !== 'jelly' && event.reason !== 'frosting');
        if (wave_scores.length > 4) {
          // Big chains: one large total instead of a pile of overlapping popups.
          addPopup(-1, wave_scores.reduce((sum, event) => sum + event.points, 0));
        } else {
          wave_scores.forEach((event) => addPopup(event.cell, event.points));
        }
        wave_events.forEach((event) => {
          hooks.event(event);
          if (event.type === 'clear') {
            const visual = visuals.get(event.piece_id);
            if (!visual) return;
            const color_hex = CONFIG.CANDIES[event.color] ? CONFIG.CANDIES[event.color].base : '#7a4524';
            if (merge_target.has(event.cell) && merge_target.get(event.cell) !== event.cell && wave === 0) {
              const target = cellXY(merge_target.get(event.cell));
              const start_x = visual.x;
              const start_y = visual.y;
              pending.push(timeline.tween(TIMING.POP_MS, (t) => {
                const eased = EASE.inCubic(t);
                visual.x = UTIL.lerp(start_x, target.col, eased);
                visual.y = UTIL.lerp(start_y, target.row, eased);
                visual.scale = UTIL.lerp(1.15, 0.4, eased);
                visual.alpha = 1 - t * 0.6;
              }).then(() => {
                visuals.delete(visual.id);
              }));
            } else {
              const delay = event.cause === 'blast' && event.origin_distance ? event.origin_distance * 18 : 0;
              pending.push(popVisual(visual, color_hex, delay, event.cause === 'blast' ? 6 : 10));
            }
          } else if (event.type === 'transform') {
            const visual = visuals.get(event.piece_id);
            if (visual) {
              visual.special = event.special;
              if (event.color !== undefined) visual.color = event.color;
              addEffect({ type: 'transform_glow', cell: event.cell, duration: 380 });
              pending.push(timeline.tween(260, (t) => {
                visual.scale = 1 + Math.sin(t * Math.PI) * 0.25;
                visual.flash = 1 - t;
              }));
            }
          } else if (event.type === 'jelly') {
            display_jelly[event.cell] = event.layers;
            hooks.sound('jelly');
            burst(event.cell, '#ff7fd0', 6, 0.6);
          } else if (event.type === 'cage') {
            display_cage[event.cell] = 0;
            hooks.sound('cage');
            burst(event.cell, '#ffd36e', 10, 0.8);
            addEffect({ type: 'transform_glow', cell: event.cell, duration: 300 });
          } else if (event.type === 'time_bonus') {
            hooks.timeBonus(event);
            addTextPopup(event.cell, `+${event.seconds}s`, '#bff3ff');
          } else if (event.type === 'booster') {
            if (event.cell >= 0) addEffect({ type: 'ring', cell: event.cell, radius: 0.9, duration: 320 });
            hooks.sound('hammer');
            hooks.haptic('medium');
            addShake(layout.cell * 0.1, 200);
          } else if (event.type === 'frosting' || event.type === 'cocoa') {
            const is_cocoa = event.type === 'cocoa';
            hooks.sound(is_cocoa ? 'cocoa' : 'frosting');
            burst(event.cell, is_cocoa ? '#8a4a25' : '#fff0f8', 12, 0.8);
            const visual = visuals.get(event.piece_id);
            if (visual) {
              if (event.layers <= 0) pending.push(popVisual(visual, is_cocoa ? '#b0683a' : '#ffd1e8', 0, 12));
              else {
                visual.layers = event.layers;
                pending.push(timeline.tween(200, (t) => {
                  visual.scale = 1 - Math.sin(t * Math.PI) * 0.1;
                }));
              }
            }
          }
        });
        await Promise.all(pending);
        if (generation !== timeline.generation) return false;
      }
      if (creates.length) {
        hooks.sound('create', { count: creates.filter((event) => event.type === 'create').length });
        const appearing = [];
        creates.forEach((event) => {
          hooks.event(event);
          if (event.type === 'score') {
            addPopup(event.cell, event.points);
            return;
          }
          const visual = makeVisual(event.piece, event.cell);
          visual.scale = 0;
          visuals.set(visual.id, visual);
          addEffect({ type: 'transform_glow', cell: event.cell, duration: 420 });
          burst(event.cell, '#ffffff', 8, 0.7);
          appearing.push(timeline.tween(260, (t) => {
            visual.scale = EASE.outBack(t);
          }));
        });
        await Promise.all(appearing);
      }
      return generation === timeline.generation;
    }

    function playActivationEffect(event, hooks) {
      const color_hex = CONFIG.CANDIES[event.color] ? CONFIG.CANDIES[event.color].base : '#ffffff';
      const center = cellXY(event.cell);
      if (event.kind === 'row' || event.kind === 'col') {
        addEffect({ type: 'beam', cell: event.cell, direction: event.kind, color: color_hex, duration: 420 });
        hooks.sound('striped');
        hooks.haptic('medium');
      } else if (event.kind === 'cross' || event.kind === 'big_cross') {
        const offsets = event.kind === 'cross' ? [0] : [-1, 0, 1];
        offsets.forEach((offset) => {
          const row_cell = (center.row + offset) * board.cols + center.col;
          const col_cell = center.row * board.cols + (center.col + offset);
          if (center.row + offset >= 0 && center.row + offset < board.rows) addEffect({ type: 'beam', cell: row_cell, direction: 'row', duration: 480 });
          if (center.col + offset >= 0 && center.col + offset < board.cols) addEffect({ type: 'beam', cell: col_cell, direction: 'col', duration: 480 });
        });
        hooks.sound('striped');
        addShake(layout.cell * 0.15, 380);
        hooks.haptic('heavy');
      } else if (event.kind === 'wrapped' || event.kind === 'wrapped_second') {
        addEffect({ type: 'ring', cell: event.cell, radius: 1.8, duration: 420 });
        hooks.sound('wrapped');
        addShake(layout.cell * 0.12, 320);
        hooks.haptic('heavy');
      } else if (event.kind === 'wrapped_big' || event.kind === 'wrapped_big_second') {
        addEffect({ type: 'ring', cell: event.cell, radius: 3.2, duration: 520 });
        addEffect({ type: 'flash', duration: 260 });
        hooks.sound('wrapped');
        addShake(layout.cell * 0.22, 500);
        hooks.haptic('heavy');
      } else if (event.kind === 'bomb' || event.kind === 'bomb_to_stripes' || event.kind === 'bomb_to_wrapped') {
        addEffect({ type: 'arcs', cell: event.cell, targets: event.area || [], duration: 520 });
        hooks.sound('bomb');
        addShake(layout.cell * 0.12, 380);
        hooks.haptic('heavy');
      } else if (event.kind === 'board') {
        addEffect({ type: 'flash', duration: 520 });
        addEffect({ type: 'ring', cell: event.cell, radius: 6, duration: 700 });
        hooks.sound('bomb');
        addShake(layout.cell * 0.3, 700);
        hooks.haptic('heavy');
      }
    }

    async function playSettlePhase(phase, hooks) {
      const generation = timeline.generation;
      const steps = phase.header.steps || 1;
      const movers = [];
      phase.events.forEach((event) => {
        if (event.type === 'fall') {
          const visual = visuals.get(event.piece_id);
          if (visual) movers.push({ visual, path: event.path, landed: false, collected: event.collected, event });
        } else if (event.type === 'spawn') {
          const visual = makeVisual(event.piece, event.to);
          visual.x = event.path[0][2];
          visual.y = event.path[0][1];
          visuals.set(visual.id, visual);
          movers.push({ visual, path: event.path, landed: false, collected: false, event });
        }
      });
      const total_ms = TIMING.FALL_STEP_MS * Math.sqrt(steps);
      let thuds_this_phase = 0;
      let last_thud_at = -1000;
      const collect_events = phase.events.filter((event) => event.type === 'collect');
      await timeline.tween(total_ms, (t) => {
        const elapsed = t * total_ms;
        const step_time = Math.pow(elapsed / TIMING.FALL_STEP_MS, 2);
        movers.forEach((mover) => {
          const path = mover.path;
          const last = path[path.length - 1];
          if (step_time >= last[0]) {
            mover.visual.x = last[2];
            mover.visual.y = last[1];
            if (!mover.landed) {
              mover.landed = true;
              mover.visual.scale_x = 1;
              mover.visual.scale_y = 1;
              if (!settings.reduced_motion) {
                const visual = mover.visual;
                timeline.tween(TIMING.LAND_SQUASH_MS, (squash_t) => {
                  const squash = Math.sin(squash_t * Math.PI) * 0.16 * (1 - squash_t * 0.5);
                  visual.scale_y = 1 - squash;
                  visual.scale_x = 1 + squash * 0.8;
                });
              }
              if (timeline.now - last_thud_at > 70 && thuds_this_phase < 6) {
                last_thud_at = timeline.now;
                thuds_this_phase += 1;
                hooks.sound('land');
              }
            }
            return;
          }
          let segment = 0;
          while (segment < path.length - 2 && step_time > path[segment + 1][0]) segment += 1;
          const from = path[segment];
          const to = path[segment + 1];
          const span = Math.max(0.0001, to[0] - from[0]);
          const local = UTIL.clamp((step_time - from[0]) / span, 0, 1);
          mover.visual.x = UTIL.lerp(from[2], to[2], local);
          mover.visual.y = UTIL.lerp(from[1], to[1], local);
          const moving = from[1] !== to[1] || from[2] !== to[2];
          const stretch = moving && !settings.reduced_motion ? Math.min(0.13, 0.04 + step_time * 0.01) : 0;
          mover.visual.scale_y = 1 + stretch;
          mover.visual.scale_x = 1 - stretch * 0.6;
        });
      });
      if (generation !== timeline.generation) return false;
      movers.forEach((mover) => {
        const last = mover.path[mover.path.length - 1];
        mover.visual.x = last[2];
        mover.visual.y = last[1];
      });
      collect_events.forEach((event) => {
        const mover = movers.find((candidate) => candidate.visual.id === event.piece_id);
        hooks.sound('ingredient');
        hooks.haptic('medium');
        burst(event.cell, '#ffe14d', 14, 1);
        hooks.collect(event, cellCenter(event.cell));
        if (mover) visuals.delete(mover.visual.id);
        hooks.event(event);
      });
      phase.events.filter((event) => event.type === 'score').forEach((event) => {
        hooks.event(event);
        addPopup(event.cell, event.points);
      });
      phase.events.filter((event) => event.type === 'cascade').forEach((event) => hooks.cascade(event.depth));
      await timeline.wait(settings.reduced_motion ? 30 : 70);
      return generation === timeline.generation;
    }

    async function playShufflePhase(phase, hooks) {
      const generation = timeline.generation;
      hooks.shuffle(phase.header.reason || 'no_moves');
      await timeline.wait(phase.header.reason === 'whirl' ? 250 : 650);
      if (generation !== timeline.generation) return false;
      const moves = [];
      phase.events.forEach((event) => {
        if (event.type === 'shuffle') {
          event.moves.forEach((move) => {
            const visual = visuals.get(move.piece_id);
            if (visual) moves.push({ visual, from: cellXY(move.from), to: cellXY(move.to) });
          });
        } else if (event.type === 'recolor') {
          const visual = visuals.get(event.piece_id);
          if (visual) visual.color = event.color;
          addEffect({ type: 'transform_glow', cell: event.cell, duration: 400 });
        } else if (event.type === 'transform') {
          const visual = visuals.get(event.piece_id);
          if (visual) Object.assign(visual, { special: event.special, color: event.color });
        }
      });
      hooks.sound('shuffle');
      await timeline.tween(620, (t) => {
        const eased = EASE.inOutQuad(t);
        moves.forEach((move) => {
          move.visual.x = UTIL.lerp(move.from.col, move.to.col, eased);
          move.visual.y = UTIL.lerp(move.from.row, move.to.row, eased) - Math.sin(t * Math.PI) * 0.6;
          move.visual.rotation = Math.sin(t * Math.PI) * 0.6;
        });
      });
      moves.forEach((move) => {
        move.visual.rotation = 0;
      });
      return generation === timeline.generation;
    }

    async function playBonusPhase(phase, hooks) {
      const generation = timeline.generation;
      hooks.event({ type: 'bonus_move', moves_left: phase.header.moves_left });
      for (const event of phase.events) {
        hooks.event(event);
        if (event.type === 'transform') {
          const visual = visuals.get(event.piece_id);
          if (visual) {
            visual.special = event.special;
            addEffect({ type: 'transform_glow', cell: event.cell, duration: 360 });
            hooks.sound('create', { count: 1 });
            await timeline.tween(200, (t) => {
              visual.scale = 1 + Math.sin(t * Math.PI) * 0.3;
            });
          }
        } else if (event.type === 'score') {
          hooks.bonusTick(event.points);
        }
      }
      return generation === timeline.generation;
    }

    /** Sugar Belts: every piece on a belt slides one cell; the piece at the end fades out and in at the start. */
    async function playBeltPhase(phase, hooks) {
      const generation = timeline.generation;
      const moves = [];
      phase.events.forEach((event) => {
        hooks.event(event);
        if (event.type !== 'belt') return;
        event.moves.forEach((move) => {
          const visual = visuals.get(move.piece_id);
          if (!visual) return;
          const from = cellXY(move.from);
          const to = cellXY(move.to);
          moves.push({ visual, from, to, wrap: Math.abs(from.col - to.col) + Math.abs(from.row - to.row) > 1 });
        });
      });
      if (!moves.length) return true;
      hooks.sound('belt');
      await timeline.tween(260, (t) => {
        const eased = EASE.inOutQuad(t);
        moves.forEach((move) => {
          if (move.wrap) {
            const showing_target = t >= 0.5;
            move.visual.x = showing_target ? move.to.col : move.from.col;
            move.visual.y = showing_target ? move.to.row : move.from.row;
            move.visual.alpha = showing_target ? (t - 0.5) * 2 : 1 - t * 2;
            move.visual.scale = 0.6 + 0.4 * Math.abs(t - 0.5) * 2;
          } else {
            move.visual.x = UTIL.lerp(move.from.col, move.to.col, eased);
            move.visual.y = UTIL.lerp(move.from.row, move.to.row, eased);
          }
        });
      });
      moves.forEach((move) => Object.assign(move.visual, { x: move.to.col, y: move.to.row, alpha: 1, scale: 1 }));
      return generation === timeline.generation;
    }

    /** Fuse Candies tick down after a move; one that reaches zero goes off. */
    async function playFusePhase(phase, hooks) {
      const generation = timeline.generation;
      const pending = [];
      let urgent = false;
      phase.events.forEach((event) => {
        hooks.event(event);
        const visual = visuals.get(event.piece_id);
        if (event.type === 'fuse' && visual) {
          visual.fuse = event.fuse;
          if (event.fuse <= 3) urgent = true;
          pending.push(timeline.tween(220, (t) => {
            visual.scale = 1 + Math.sin(t * Math.PI) * 0.12;
          }));
        } else if (event.type === 'fuse_out') {
          addEffect({ type: 'flash', duration: 420 });
          addEffect({ type: 'ring', cell: event.cell, radius: 2.4, duration: 520 });
          addShake(layout.cell * 0.2, 420);
          hooks.sound('fuse_out');
          hooks.haptic('heavy');
          hooks.fuseOut(event);
        }
      });
      if (urgent) hooks.sound('fuse_tick');
      await Promise.all(pending);
      return generation === timeline.generation;
    }

    /** Cocoa Creep grows into a neighboring candy. */
    async function playCocoaPhase(phase, hooks) {
      const generation = timeline.generation;
      const pending = [];
      phase.events.forEach((event) => {
        hooks.event(event);
        if (event.type !== 'cocoa_spread') return;
        const old_visual = visuals.get(event.old_piece_id);
        if (old_visual) {
          pending.push(timeline.tween(240, (t) => {
            old_visual.scale = 1 - t;
            old_visual.alpha = 1 - t;
          }).then(() => visuals.delete(old_visual.id)));
        }
        const visual = makeVisual(event.piece, event.cell);
        visual.scale = 0;
        visuals.set(visual.id, visual);
        pending.push(timeline.tween(320, (t) => {
          visual.scale = EASE.outBack(t);
        }));
        hooks.sound('cocoa_spread');
      });
      await Promise.all(pending);
      return generation === timeline.generation;
    }

    /** Plays an event list from LOGIC. Resolves true when finished, false if cancelled (restart/quit). */
    async function playEvents(events, hook_overrides) {
      const hooks = Object.assign({ sound: noop, haptic: noop, event: noop, cascade: noop, collect: noop, shuffle: noop, bonusTick: noop, timeBonus: noop, fuseOut: noop }, hook_overrides || {});
      const generation = timeline.generation;
      selected_cell = -1;
      hint_move = null;
      const phases = groupPhases(events);
      for (const phase of phases) {
        if (generation !== timeline.generation) return false;
        let completed = true;
        if (phase.header.kind === 'swap') {
          for (const event of phase.events) {
            if (event.type === 'swap') await playSwap(event, hooks);
          }
        } else if (phase.header.kind === 'clear') {
          // Ripple delays for blast clears.
          const distances = new Map();
          phase.events.forEach((event) => {
            if (event.type === 'activate' && event.area) {
              const center = cellXY(event.cell);
              event.area.forEach((cell_index) => {
                const position = cellXY(cell_index);
                distances.set(cell_index, Math.min(distances.has(cell_index) ? distances.get(cell_index) : 99, Math.abs(position.col - center.col) + Math.abs(position.row - center.row)));
              });
            }
          });
          phase.events.forEach((event) => {
            if (event.type === 'clear' && event.cause === 'blast') event.origin_distance = distances.get(event.cell) || 0;
          });
          completed = await playClearPhase(phase, hooks);
        } else if (phase.header.kind === 'settle') {
          completed = await playSettlePhase(phase, hooks);
        } else if (phase.header.kind === 'shuffle') {
          completed = await playShufflePhase(phase, hooks);
        } else if (phase.header.kind === 'bonus') {
          completed = await playBonusPhase(phase, hooks);
        } else if (phase.header.kind === 'belt') {
          completed = await playBeltPhase(phase, hooks);
        } else if (phase.header.kind === 'fuse') {
          completed = await playFusePhase(phase, hooks);
        } else if (phase.header.kind === 'cocoa') {
          completed = await playCocoaPhase(phase, hooks);
        } else {
          phase.events.forEach((event) => hooks.event(event));
        }
        if (!completed) return false;
        phase.events.filter((event) => event.type === 'end').forEach((event) => hooks.event(event));
      }
      return generation === timeline.generation;
    }

    function confetti(view_w) {
      const colors = CONFIG.CANDIES.map((candy) => candy.base).concat(['#ffffff', '#ffe27a']);
      const total = Math.round(140 * particleScale());
      for (let index = 0; index < total; index += 1) {
        particles.spawn({
          x: Math.random() * view_w, y: -20 - Math.random() * 120, vx: (Math.random() - 0.5) * 160, vy: 80 + Math.random() * 220,
          life: 2.2 + Math.random() * 1.4, size: 4 + Math.random() * 5, color: colors[index % colors.length], kind: 'confetti',
          spin: (Math.random() - 0.5) * 10, gravity: 220, drag: 0.992,
        });
      }
    }

    const renderer = {
      timeline,
      particles,
      sprites,
      resizeCanvas,
      placeBoard,
      setLevel,
      syncToState,
      update,
      playEvents,
      playInvalidSwap,
      confetti,
      burstAt(x, y, color_hex, count) {
        const total = Math.max(1, Math.round(count * particleScale()));
        for (let index = 0; index < total; index += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 80 + Math.random() * 200;
          particles.spawn({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 80, life: 0.6 + Math.random() * 0.4, size: 3 + Math.random() * 4, color: color_hex, kind: index % 2 ? 'sparkle' : 'circle', gravity: 300 });
        }
      },
      get layout() {
        return layout;
      },
      get board() {
        return board;
      },
      get quality() {
        return quality;
      },
      setSpeed(speed) {
        playback_speed = Math.max(0.1, speed);
      },
      get speed() {
        return playback_speed;
      },
      setQuality(level) {
        quality = UTIL.clamp(level, 0, 2);
      },
      setSettings(next_settings) {
        const art_changed = next_settings.theme !== settings.theme || next_settings.colorblind !== settings.colorblind;
        settings = Object.assign({}, settings, next_settings);
        if (art_changed) sprites.configure(layout.cell, settings.theme, settings.colorblind, layout.dpr);
      },
      setVisible(visible) {
        board_visible = visible;
        if (!visible) {
          selected_cell = -1;
          hint_move = null;
          drag = null;
        }
      },
      setSelected(cell_index) {
        selected_cell = cell_index;
      },
      setHint(move) {
        hint_move = move;
        hint_cells = new Set(move ? move.cells || [move.from, move.to] : []);
      },
      setDrag(cell_index, dx, dy) {
        if (cell_index < 0) {
          drag = null;
          return;
        }
        const visual = visualAtCell(cell_index);
        drag = visual ? { piece_id: visual.id, dx, dy } : null;
      },
      cellFromPoint(client_x, client_y) {
        if (!board) return -1;
        const col = Math.floor((client_x - layout.origin_x) / layout.cell);
        const row = Math.floor((client_y - layout.origin_y) / layout.cell);
        if (row < 0 || col < 0 || row >= board.rows || col >= board.cols) return -1;
        if (board.holes[row * board.cols + col]) return -1;
        return row * board.cols + col;
      },
      cellCenter,
      boardRect() {
        return { left: layout.origin_x, top: layout.origin_y, width: layout.width, height: layout.height, cell: layout.cell };
      },
      cancelAll() {
        timeline.cancelAll();
        drag = null;
      },
      clearEffects() {
        effects.length = 0;
        popups.length = 0;
        particles.clear();
      },
      get idleMs() {
        return timeline.busy ? 0 : timeline.now - idle_since;
      },
      markActivity() {
        idle_since = timeline.now;
      },
      flashBoard() {
        board_flash.alpha = 1;
      },
    };
    return renderer;
  }

  // ================================================================ BACKGROUND
  /**
   * Episode scenery behind the board (and the title screen): a sky plus far, mid and near layers painted once per size
   * and episode by SCENERY, drawn with gentle parallax drift and floating sugar sparkles (static when motion is reduced).
   */
  function createBackgroundRenderer(bg_canvas) {
    const SCENERY = SC.SCENERY;
    const ctx = bg_canvas.getContext('2d');
    let view = { width: 0, height: 0, dpr: 1 };
    let accent_sky = CONFIG.ACCENTS[0].background;
    let scenery = null; // null = the title backdrop (accent sky over a gumdrop meadow)
    let layers = null;
    let animate = true;
    let dirty = true;
    const PARALLAX = { far: 0.25, mid: 0.55, near: 1 };
    const sparkles = [];
    const random = UTIL.createRng(4711);
    for (let index = 0; index < 16; index += 1) sparkles.push({ x: random(), y: random(), size: 2.5 + random() * 4.5, phase: random() * 10, speed: 0.6 + random() * 1.2 });

    function margin() {
      return Math.round(Math.min(40, view.width * 0.06));
    }

    function rebuild() {
      if (!(view.width >= 1 && view.height >= 1)) return;
      const colors = scenery ? SCENERY.colorsFor(scenery, null) : SCENERY.colorsFor({ family: 'gumdrop_meadow', hue_shift: 0 }, accent_sky);
      const seed = scenery ? scenery.seed : 1;
      const extra = margin() * 2;
      const make = (width) => {
        const canvas = SPRITES.createCanvas(Math.max(1, Math.round(width * view.dpr)), Math.max(1, Math.round(view.height * view.dpr)));
        const layer_ctx = canvas.getContext('2d');
        layer_ctx.scale(view.dpr, view.dpr);
        return { canvas, ctx: layer_ctx };
      };
      const sky = make(view.width);
      SCENERY.paintSky(sky.ctx, view.width, view.height, colors, seed);
      layers = { sky: sky.canvas };
      ['far', 'mid', 'near'].forEach((name) => {
        const layer = make(view.width + extra);
        SCENERY.paintLayer(layer.ctx, view.width + extra, view.height, colors, name, seed);
        layers[name] = layer.canvas;
      });
      dirty = true;
    }

    function draw(time_ms) {
      if (!layers) return;
      if (!animate && !dirty) return;
      dirty = false;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layers.sky, 0, 0);
      const drift = animate ? Math.sin((time_ms / 14000) * Math.PI * 2) : 0;
      const extra = margin();
      ['far', 'mid', 'near'].forEach((name) => {
        const offset = Math.round((-extra + drift * extra * PARALLAX[name]) * view.dpr);
        ctx.drawImage(layers[name], offset, 0);
      });
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      sparkles.forEach((sparkle) => {
        const twinkle = animate ? 0.5 + 0.5 * Math.sin((time_ms / 1000) * sparkle.speed * 3 + sparkle.phase) : 0.7;
        ctx.globalAlpha = 0.2 + twinkle * 0.55;
        ctx.fillStyle = '#ffffff';
        const y = (((sparkle.y - (animate ? (time_ms / 60000) * sparkle.speed : 0)) % 1) + 1) % 1;
        drawStar(ctx, sparkle.x * view.width, y * view.height, sparkle.size * (0.6 + twinkle * 0.5), 0, 4);
      });
      ctx.globalAlpha = 1;
    }

    return {
      resize(width, height, device_ratio) {
        const next = { width, height, dpr: Math.min(2, device_ratio || 1) };
        if (next.width === view.width && next.height === view.height && next.dpr === view.dpr && layers) return;
        view = next;
        bg_canvas.width = Math.round(width * view.dpr);
        bg_canvas.height = Math.round(height * view.dpr);
        bg_canvas.style.width = `${width}px`;
        bg_canvas.style.height = `${height}px`;
        rebuild();
      },
      setPalette(next_palette) {
        accent_sky = next_palette;
        if (!scenery) rebuild();
      },
      /** The episode scenery to show ({family, hue_shift, seed} from LEVELS.sceneryOf), or null for the title backdrop. */
      setScenery(next_scenery) {
        const same = (next_scenery && scenery && next_scenery.seed === scenery.seed && next_scenery.family === scenery.family) || (!next_scenery && !scenery);
        if (same && layers) return;
        scenery = next_scenery || null;
        rebuild();
      },
      setAnimated(next_animate) {
        animate = next_animate;
        dirty = true;
      },
      draw,
    };
  }

  SC.RENDER = { createTimeline, createParticlePool, createBoardRenderer, createBackgroundRenderer, drawStar };
})(typeof window !== 'undefined' ? window : globalThis);
