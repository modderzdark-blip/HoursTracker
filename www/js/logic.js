// LOGIC: pure, deterministic, DOM-free match-3 rules.
// Every move is computed instantly and returns an ordered event list; the renderer only animates that list.
// Cells are addressed by index = row * cols + col (reading order).
(function attachLogic(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');
  const rngNext = UTIL.rngNext;

  const KIND = Object.freeze({ CANDY: 'candy', CHERRY: 'cherry', FROSTING: 'frosting' });
  const SPECIAL = Object.freeze({
    NONE: 'none',
    STRIPE_ROW: 'stripe_row', // horizontal stripes: clears its row (made by a vertical 4-match)
    STRIPE_COL: 'stripe_col', // vertical stripes: clears its column (made by a horizontal 4-match)
    WRAPPED: 'wrapped',
    WRAPPED_ARMED: 'wrapped_armed', // a wrapped candy between its first and second 3x3 blast
    WRAPPED_BIG_ARMED: 'wrapped_big_armed', // wrapped+wrapped combo between its two 5x5 blasts
    BOMB: 'bomb',
  });
  const MAX_COLORS = 6;
  const MAX_BOARD_SIDE = 9;
  const SETTLE_STEP_CAP = 4000;
  const RESOLVE_LOOP_CAP = 400;

  // Exact scoring table (also shown in How to Play).
  const SCORING = Object.freeze({
    MATCH_BASE: 60, // a match of 3
    MATCH_EXTRA_PER_CANDY: 60, // each candy beyond 3 in a match
    CREATE_STRIPE: 120,
    CREATE_WRAPPED: 200,
    CREATE_BOMB: 300,
    ACTIVATION_PER_CANDY: 60, // each candy cleared by a special's blast
    ACTIVATION_PER_SPECIAL: 100, // each special triggered (directly or in a chain)
    INGREDIENT: 500,
    JELLY_LAYER: 100,
    FROSTING_LAYER: 150,
    END_BONUS_PER_MOVE: 300,
    CASCADE_STEP: 0.5,
    CASCADE_CAP: 4,
  });

  const LAYOUT_LEGEND = Object.freeze({
    '.': 'normal cell',
    '#': 'hole',
    j: 'single jelly',
    J: 'double jelly',
    f: 'frosting (1 layer)',
    F: 'frosting (2 layers)',
    c: 'cherry start',
    x: 'exit tray',
  });

  /** Points for a match of `candy_count` candies: 3 = 60, 4 = 120, 5 = 180, 6 = 240 ... */
  function matchPoints(candy_count) {
    return SCORING.MATCH_BASE + SCORING.MATCH_EXTRA_PER_CANDY * Math.max(0, candy_count - 3);
  }

  /** Cascade multiplier for match wave `depth` (1 = the swap's own matches): x1, x1.5, x2, x2.5 ... capped at x4. */
  function cascadeMultiplier(depth) {
    return Math.min(1 + SCORING.CASCADE_STEP * Math.max(0, depth - 1), SCORING.CASCADE_CAP);
  }

  function creationPoints(special) {
    if (special === SPECIAL.BOMB) return SCORING.CREATE_BOMB;
    if (special === SPECIAL.WRAPPED) return SCORING.CREATE_WRAPPED;
    return SCORING.CREATE_STRIPE;
  }

  // ------------------------------------------------------------------ layout parsing

  function parseLayout(level) {
    const rows = level.rows;
    const cols = level.cols;
    if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 3 || cols < 3 || rows > MAX_BOARD_SIDE || cols > MAX_BOARD_SIDE) {
      throw new Error(`Level ${level.id}: board must be between 3x3 and 9x9`);
    }
    if (!Array.isArray(level.layout) || level.layout.length !== rows) {
      throw new Error(`Level ${level.id}: layout must have ${rows} rows`);
    }
    const cell_count = rows * cols;
    const parsed = {
      rows,
      cols,
      holes: new Uint8Array(cell_count),
      jelly: new Uint8Array(cell_count),
      frosting: new Uint8Array(cell_count),
      cherries: new Uint8Array(cell_count),
      exits: new Uint8Array(cell_count),
    };
    level.layout.forEach((row_text, row) => {
      if (typeof row_text !== 'string' || row_text.length !== cols) {
        throw new Error(`Level ${level.id}: layout row ${row} must have ${cols} characters`);
      }
      for (let col = 0; col < cols; col += 1) {
        const symbol = row_text[col];
        const index = row * cols + col;
        if (!Object.prototype.hasOwnProperty.call(LAYOUT_LEGEND, symbol)) {
          throw new Error(`Level ${level.id}: unknown layout symbol '${symbol}' at ${row},${col}`);
        }
        if (symbol === '#') parsed.holes[index] = 1;
        else if (symbol === 'j') parsed.jelly[index] = 1;
        else if (symbol === 'J') parsed.jelly[index] = 2;
        else if (symbol === 'f') parsed.frosting[index] = 1;
        else if (symbol === 'F') parsed.frosting[index] = 2;
        else if (symbol === 'c') parsed.cherries[index] = 1;
        else if (symbol === 'x') parsed.exits[index] = 1;
      }
    });
    return parsed;
  }

  function resolvePalette(level) {
    const palette = Array.isArray(level.palette) ? level.palette.slice() : Array.from({ length: level.colors }, (unused, index) => index);
    if (palette.length !== level.colors || palette.length < 3 || palette.length > MAX_COLORS) {
      throw new Error(`Level ${level.id}: palette must list exactly ${level.colors} colors (3-6)`);
    }
    palette.forEach((color) => {
      if (!Number.isInteger(color) || color < 0 || color >= MAX_COLORS) throw new Error(`Level ${level.id}: bad palette color ${color}`);
    });
    return palette;
  }

  // ------------------------------------------------------------------ pieces and state

  function newPiece(state, kind, color, special, layers) {
    const piece = { id: state.next_piece_id, kind, color, special: special || SPECIAL.NONE, layers: layers || 0 };
    state.next_piece_id += 1;
    return piece;
  }

  function clonePiece(piece) {
    return piece ? { id: piece.id, kind: piece.kind, color: piece.color, special: piece.special, layers: piece.layers } : null;
  }

  function cloneState(state) {
    const copy = Object.assign({}, state);
    copy.cells = state.cells.map(clonePiece);
    copy.jelly = Uint8Array.from(state.jelly);
    copy.collected = state.collected.slice();
    return copy;
  }

  function buildEmptyState(level, layout, palette, seed) {
    const cell_count = layout.rows * layout.cols;
    const spawn_cells = [];
    for (let col = 0; col < layout.cols; col += 1) {
      let spawn_cell = -1;
      for (let row = 0; row < layout.rows; row += 1) {
        if (!layout.holes[row * layout.cols + col]) {
          spawn_cell = row * layout.cols + col;
          break;
        }
      }
      spawn_cells.push(spawn_cell);
    }
    const state = {
      level_id: level.id,
      rows: layout.rows,
      cols: layout.cols,
      palette,
      seed,
      rng_state: seed | 0,
      next_piece_id: 1,
      cells: new Array(cell_count).fill(null),
      holes: layout.holes,
      jelly: Uint8Array.from(layout.jelly),
      exits: layout.exits,
      spawn_cells,
      goals: level.goals,
      stars: level.stars,
      score: 0,
      moves_left: level.moves,
      moves_made: 0,
      collected: new Array(MAX_COLORS).fill(0),
      cherries_collected: 0,
      cherries_total: 0,
      jelly_total: 0,
      status: 'playing',
    };
    for (let index = 0; index < cell_count; index += 1) {
      if (layout.frosting[index]) state.cells[index] = newPiece(state, KIND.FROSTING, -1, SPECIAL.NONE, layout.frosting[index]);
      else if (layout.cherries[index]) {
        state.cells[index] = newPiece(state, KIND.CHERRY, -1, SPECIAL.NONE, 0);
        state.cherries_total += 1;
      }
      state.jelly_total += layout.jelly[index];
    }
    return state;
  }

  function randomPaletteColor(state) {
    return state.palette[Math.floor(rngNext(state) * state.palette.length)];
  }

  function isMatchable(piece) {
    return !!piece && piece.kind === KIND.CANDY && piece.color >= 0 &&
      (piece.special === SPECIAL.NONE || piece.special === SPECIAL.STRIPE_ROW || piece.special === SPECIAL.STRIPE_COL || piece.special === SPECIAL.WRAPPED);
  }

  function matchColorAt(state, index) {
    const piece = state.cells[index];
    return isMatchable(piece) ? piece.color : -1;
  }

  function isMovable(piece) {
    return !!piece && (piece.kind === KIND.CANDY || piece.kind === KIND.CHERRY);
  }

  function isSwappable(piece) {
    return !!piece && piece.kind === KIND.CANDY && piece.special !== SPECIAL.WRAPPED_ARMED && piece.special !== SPECIAL.WRAPPED_BIG_ARMED;
  }

  /** Specials a player can activate by swapping (combo candidates). */
  function isActivatable(piece) {
    return !!piece && piece.kind === KIND.CANDY &&
      (piece.special === SPECIAL.STRIPE_ROW || piece.special === SPECIAL.STRIPE_COL || piece.special === SPECIAL.WRAPPED || piece.special === SPECIAL.BOMB);
  }

  /** Pieces that react (blast) when hit by a match or another blast. */
  function isTriggerable(piece) {
    return !!piece && piece.kind === KIND.CANDY && piece.special !== SPECIAL.NONE;
  }

  function isRegularCandy(piece) {
    return !!piece && piece.kind === KIND.CANDY && piece.special === SPECIAL.NONE && piece.color >= 0;
  }

  /** Colors that would complete a line of three ending at `index` (looking left and up). */
  function colorsForbiddenAt(state, index) {
    const cols = state.cols;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const forbidden = [];
    if (col >= 2) {
      const left_one = matchColorAt(state, index - 1);
      if (left_one >= 0 && left_one === matchColorAt(state, index - 2)) forbidden.push(left_one);
    }
    if (row >= 2) {
      const up_one = matchColorAt(state, index - cols);
      if (up_one >= 0 && up_one === matchColorAt(state, index - 2 * cols)) forbidden.push(up_one);
    }
    return forbidden;
  }

  function fillInitialBoard(state) {
    for (let index = 0; index < state.cells.length; index += 1) {
      if (state.holes[index] || state.cells[index]) continue;
      const forbidden = colorsForbiddenAt(state, index);
      const candidates = state.palette.filter((color) => forbidden.indexOf(color) < 0);
      const color = candidates[Math.floor(rngNext(state) * candidates.length)];
      state.cells[index] = newPiece(state, KIND.CANDY, color, SPECIAL.NONE, 0);
    }
  }

  /**
   * Creates the starting state for a level: seeded fill with no matches and at least one valid move.
   * If a seed produces no valid move, the next derived seed is tried (deterministically).
   */
  function createGame(level, options) {
    const seed_base = options && Number.isInteger(options.seed) ? options.seed : level.seed;
    const layout = parseLayout(level);
    const palette = resolvePalette(level);
    for (let attempt = 0; attempt < 500; attempt += 1) {
      const state = buildEmptyState(level, layout, palette, (seed_base + attempt * 7919) | 0);
      fillInitialBoard(state);
      if (findMatchGroups(state).length === 0 && hasValidMove(state)) {
        state.generation_attempts = attempt + 1;
        return state;
      }
    }
    throw new Error(`Level ${level.id}: could not generate a playable board`);
  }

  // ------------------------------------------------------------------ geometry helpers

  function rowOf(state, index) {
    return Math.floor(index / state.cols);
  }

  function colOf(state, index) {
    return index % state.cols;
  }

  function isActiveCell(state, row, col) {
    return row >= 0 && col >= 0 && row < state.rows && col < state.cols && !state.holes[row * state.cols + col];
  }

  function orthogonalNeighbors(state, index) {
    const row = rowOf(state, index);
    const col = colOf(state, index);
    const neighbors = [];
    if (isActiveCell(state, row - 1, col)) neighbors.push(index - state.cols);
    if (isActiveCell(state, row, col - 1)) neighbors.push(index - 1);
    if (isActiveCell(state, row, col + 1)) neighbors.push(index + 1);
    if (isActiveCell(state, row + 1, col)) neighbors.push(index + state.cols);
    return neighbors;
  }

  function areAdjacent(state, first_index, second_index) {
    const row_delta = Math.abs(rowOf(state, first_index) - rowOf(state, second_index));
    const col_delta = Math.abs(colOf(state, first_index) - colOf(state, second_index));
    return row_delta + col_delta === 1;
  }

  function rowCells(state, row) {
    const found = [];
    for (let col = 0; col < state.cols; col += 1) if (isActiveCell(state, row, col)) found.push(row * state.cols + col);
    return found;
  }

  function colCells(state, col) {
    const found = [];
    for (let row = 0; row < state.rows; row += 1) if (isActiveCell(state, row, col)) found.push(row * state.cols + col);
    return found;
  }

  function squareCells(state, center, radius) {
    const center_row = rowOf(state, center);
    const center_col = colOf(state, center);
    const found = [];
    for (let row = center_row - radius; row <= center_row + radius; row += 1) {
      for (let col = center_col - radius; col <= center_col + radius; col += 1) {
        if (isActiveCell(state, row, col)) found.push(row * state.cols + col);
      }
    }
    return found;
  }

  function bandCells(state, center, radius) {
    const center_row = rowOf(state, center);
    const center_col = colOf(state, center);
    const found = new Set();
    for (let row = center_row - radius; row <= center_row + radius; row += 1) {
      if (row >= 0 && row < state.rows) rowCells(state, row).forEach((cell) => found.add(cell));
    }
    for (let col = center_col - radius; col <= center_col + radius; col += 1) {
      if (col >= 0 && col < state.cols) colCells(state, col).forEach((cell) => found.add(cell));
    }
    return Array.from(found).sort((a, b) => a - b);
  }

  function allActiveCells(state) {
    const found = [];
    for (let index = 0; index < state.cells.length; index += 1) if (!state.holes[index]) found.push(index);
    return found;
  }

  function cellsWithColor(state, color) {
    const found = [];
    for (let index = 0; index < state.cells.length; index += 1) {
      const piece = state.cells[index];
      if (piece && piece.kind === KIND.CANDY && piece.color === color && piece.special !== SPECIAL.BOMB) found.push(index);
    }
    return found;
  }

  /** Most common candy color on the board (ties go to the lowest color id); -1 when the board has no colored candy. */
  function mostCommonColor(state) {
    const counts = new Array(MAX_COLORS).fill(0);
    state.cells.forEach((piece) => {
      if (piece && piece.kind === KIND.CANDY && piece.color >= 0) counts[piece.color] += 1;
    });
    let best_color = -1;
    let best_count = 0;
    counts.forEach((count, color) => {
      if (count > best_count) {
        best_count = count;
        best_color = color;
      }
    });
    return best_color;
  }

  // ------------------------------------------------------------------ matches

  /**
   * Finds every horizontal and vertical run of 3+ same-colored matchable candies and merges runs that share
   * cells into groups (L, T and + shapes). Holes, frosting, cherries, bombs and empty cells break runs.
   */
  function findMatchGroups(state) {
    const rows = state.rows;
    const cols = state.cols;
    const runs = [];
    for (let row = 0; row < rows; row += 1) {
      let col = 0;
      while (col < cols) {
        const color = matchColorAt(state, row * cols + col);
        if (color < 0) {
          col += 1;
          continue;
        }
        let end = col + 1;
        while (end < cols && matchColorAt(state, row * cols + end) === color) end += 1;
        if (end - col >= 3) {
          const run_cells = [];
          for (let run_col = col; run_col < end; run_col += 1) run_cells.push(row * cols + run_col);
          runs.push({ direction: 'h', color, cells: run_cells });
        }
        col = end;
      }
    }
    for (let col = 0; col < cols; col += 1) {
      let row = 0;
      while (row < rows) {
        const color = matchColorAt(state, row * cols + col);
        if (color < 0) {
          row += 1;
          continue;
        }
        let end = row + 1;
        while (end < rows && matchColorAt(state, end * cols + col) === color) end += 1;
        if (end - row >= 3) {
          const run_cells = [];
          for (let run_row = row; run_row < end; run_row += 1) run_cells.push(run_row * cols + col);
          runs.push({ direction: 'v', color, cells: run_cells });
        }
        row = end;
      }
    }
    if (runs.length === 0) return [];
    const parent = runs.map((run, index) => index);
    const findRoot = (index) => {
      let cursor = index;
      while (parent[cursor] !== cursor) {
        parent[cursor] = parent[parent[cursor]];
        cursor = parent[cursor];
      }
      return cursor;
    };
    const run_owning_cell = new Map();
    runs.forEach((run, run_index) => {
      run.cells.forEach((cell) => {
        if (run_owning_cell.has(cell)) parent[findRoot(run_index)] = findRoot(run_owning_cell.get(cell));
        else run_owning_cell.set(cell, run_index);
      });
    });
    const groups_by_root = new Map();
    runs.forEach((run, run_index) => {
      const group_root = findRoot(run_index);
      if (!groups_by_root.has(group_root)) groups_by_root.set(group_root, { color: run.color, runs: [], cell_set: new Set() });
      const group = groups_by_root.get(group_root);
      group.runs.push(run);
      run.cells.forEach((cell) => group.cell_set.add(cell));
    });
    const groups = [];
    groups_by_root.forEach((group) => {
      const horizontal_cells = new Set();
      const vertical_cells = new Set();
      group.runs.forEach((run) => run.cells.forEach((cell) => (run.direction === 'h' ? horizontal_cells : vertical_cells).add(cell)));
      const cells = Array.from(group.cell_set).sort((a, b) => a - b);
      const intersections = cells.filter((cell) => horizontal_cells.has(cell) && vertical_cells.has(cell));
      group.runs.sort((a, b) => a.cells[0] - b.cells[0]);
      groups.push({ color: group.color, runs: group.runs, cells, intersections });
    });
    groups.sort((a, b) => a.cells[0] - b.cells[0]);
    return groups;
  }

  /** Decides which special (if any) a match group creates and where. */
  function planCreation(group, swap_cells) {
    const swapped = swap_cells || [];
    const longest = group.runs.reduce((best, run) => Math.max(best, run.cells.length), 0);
    let special = null;
    let qualifying_run = null;
    if (longest >= 5) {
      special = SPECIAL.BOMB;
      qualifying_run = group.runs.find((run) => run.cells.length >= 5);
    } else if (group.intersections.length > 0) {
      special = SPECIAL.WRAPPED;
    } else if (longest === 4) {
      qualifying_run = group.runs.find((run) => run.cells.length === 4);
      special = qualifying_run.direction === 'h' ? SPECIAL.STRIPE_COL : SPECIAL.STRIPE_ROW;
    } else {
      return null;
    }
    let cell;
    if (special === SPECIAL.WRAPPED) {
      cell = swapped.find((swap_cell) => group.intersections.indexOf(swap_cell) >= 0);
      if (cell === undefined) cell = group.intersections[0];
    } else {
      cell = swapped.find((swap_cell) => qualifying_run.cells.indexOf(swap_cell) >= 0);
      if (cell === undefined) cell = swapped.find((swap_cell) => group.cells.indexOf(swap_cell) >= 0);
      if (cell === undefined) cell = qualifying_run.cells[0];
    }
    return { cell, special, color: special === SPECIAL.BOMB ? -1 : group.color };
  }

  function makesLineAt(state, index) {
    const color = matchColorAt(state, index);
    if (color < 0) return false;
    const cols = state.cols;
    const row = rowOf(state, index);
    const col = colOf(state, index);
    let horizontal = 1;
    for (let cursor = col - 1; cursor >= 0 && matchColorAt(state, row * cols + cursor) === color; cursor -= 1) horizontal += 1;
    for (let cursor = col + 1; cursor < cols && matchColorAt(state, row * cols + cursor) === color; cursor += 1) horizontal += 1;
    if (horizontal >= 3) return true;
    let vertical = 1;
    for (let cursor = row - 1; cursor >= 0 && matchColorAt(state, cursor * cols + col) === color; cursor -= 1) vertical += 1;
    for (let cursor = row + 1; cursor < state.rows && matchColorAt(state, cursor * cols + col) === color; cursor += 1) vertical += 1;
    return vertical >= 3;
  }

  // ------------------------------------------------------------------ move validity

  function isValidSwap(state, from_cell, to_cell) {
    if (!Number.isInteger(from_cell) || !Number.isInteger(to_cell)) return false;
    if (from_cell < 0 || to_cell < 0 || from_cell >= state.cells.length || to_cell >= state.cells.length) return false;
    if (state.holes[from_cell] || state.holes[to_cell] || !areAdjacent(state, from_cell, to_cell)) return false;
    const from_piece = state.cells[from_cell];
    const to_piece = state.cells[to_cell];
    if (!isSwappable(from_piece) || !isSwappable(to_piece)) return false;
    if (isActivatable(from_piece) && isActivatable(to_piece)) return true;
    if (from_piece.special === SPECIAL.BOMB || to_piece.special === SPECIAL.BOMB) return true;
    state.cells[from_cell] = to_piece;
    state.cells[to_cell] = from_piece;
    const creates_match = makesLineAt(state, from_cell) || makesLineAt(state, to_cell);
    state.cells[from_cell] = from_piece;
    state.cells[to_cell] = to_piece;
    return creates_match;
  }

  /** All valid swaps, each listed once as {from, to} with to = right or lower neighbor. */
  function listValidMoves(state) {
    const moves = [];
    for (let index = 0; index < state.cells.length; index += 1) {
      if (state.holes[index]) continue;
      const col = colOf(state, index);
      if (col + 1 < state.cols && isValidSwap(state, index, index + 1)) moves.push({ from: index, to: index + 1 });
      if (index + state.cols < state.cells.length && isValidSwap(state, index, index + state.cols)) moves.push({ from: index, to: index + state.cols });
    }
    return moves;
  }

  function hasValidMove(state) {
    for (let index = 0; index < state.cells.length; index += 1) {
      if (state.holes[index]) continue;
      if (colOf(state, index) + 1 < state.cols && isValidSwap(state, index, index + 1)) return true;
      if (index + state.cols < state.cells.length && isValidSwap(state, index, index + state.cols)) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ goals and stars

  function jellyRemaining(state) {
    let layers = 0;
    let cells = 0;
    for (let index = 0; index < state.jelly.length; index += 1) {
      layers += state.jelly[index];
      if (state.jelly[index] > 0) cells += 1;
    }
    return { layers, cells };
  }

  function goalProgress(state) {
    return state.goals.map((goal) => {
      if (goal.type === 'score') return { type: 'score', target: goal.target, current: Math.min(state.score, goal.target), done: state.score >= goal.target };
      if (goal.type === 'collect') {
        const current = state.collected[goal.color];
        return { type: 'collect', color: goal.color, target: goal.count, current: Math.min(current, goal.count), done: current >= goal.count };
      }
      if (goal.type === 'jelly') {
        const remaining = jellyRemaining(state);
        return { type: 'jelly', target: state.jelly_total, current: state.jelly_total - remaining.layers, remaining_cells: remaining.cells, done: remaining.layers === 0 };
      }
      if (goal.type === 'ingredients') {
        return { type: 'ingredients', target: goal.count, current: Math.min(state.cherries_collected, goal.count), done: state.cherries_collected >= goal.count };
      }
      throw new Error(`Unknown goal type ${goal.type}`);
    });
  }

  function goalsMet(state) {
    return goalProgress(state).every((progress) => progress.done);
  }

  function starsForScore(score, thresholds, has_won) {
    let stars = 0;
    thresholds.forEach((threshold) => {
      if (score >= threshold) stars += 1;
    });
    return has_won ? Math.max(1, stars) : 0;
  }

  // ------------------------------------------------------------------ move resolution context

  function createContext(state) {
    return {
      state,
      events: [],
      phase: 0,
      cascade_depth: 0,
      stats: { cascades: 0, specials_created: { stripe: 0, wrapped: 0, bomb: 0 }, combos: [], activations: 0, candies_cleared: 0, shuffles: 0 },
    };
  }

  function beginPhase(ctx, kind, details) {
    ctx.phase += 1;
    ctx.events.push(Object.assign({ type: 'phase', phase: ctx.phase, kind }, details || {}));
  }

  function emit(ctx, event) {
    event.phase = ctx.phase;
    ctx.events.push(event);
  }

  function addScore(ctx, points, reason, cell) {
    const rounded = Math.round(points);
    if (rounded <= 0) return;
    ctx.state.score += rounded;
    emit(ctx, { type: 'score', points: rounded, reason, cell, total: ctx.state.score });
  }

  function createStage(ctx) {
    return { hit: new Set(), frosting_hit: new Set(), jelly_hit: new Set(), next_wave: [], wave: 0, multiplier: cascadeMultiplier(Math.max(1, ctx.cascade_depth)) };
  }

  function removePiece(ctx, stage, cell, cause) {
    const state = ctx.state;
    const piece = state.cells[cell];
    state.cells[cell] = null;
    if (piece.kind === KIND.CANDY && piece.color >= 0) state.collected[piece.color] += 1;
    ctx.stats.candies_cleared += 1;
    emit(ctx, { type: 'clear', cell, piece_id: piece.id, color: piece.color, special: piece.special, cause, wave: stage.wave });
  }

  function damageJelly(ctx, stage, cell) {
    if (stage.jelly_hit.has(cell)) return;
    stage.jelly_hit.add(cell);
    const state = ctx.state;
    if (state.jelly[cell] === 0) return;
    state.jelly[cell] -= 1;
    emit(ctx, { type: 'jelly', cell, layers: state.jelly[cell], wave: stage.wave });
    addScore(ctx, SCORING.JELLY_LAYER, 'jelly', cell);
  }

  function damageFrosting(ctx, stage, cell) {
    if (stage.frosting_hit.has(cell)) return;
    const state = ctx.state;
    const piece = state.cells[cell];
    if (!piece || piece.kind !== KIND.FROSTING) return;
    stage.frosting_hit.add(cell);
    piece.layers -= 1;
    emit(ctx, { type: 'frosting', cell, piece_id: piece.id, layers: piece.layers, wave: stage.wave });
    if (piece.layers <= 0) state.cells[cell] = null;
    addScore(ctx, SCORING.FROSTING_LAYER, 'frosting', cell);
  }

  /** Hits a cell once per stage. Returns 1 if a regular candy was cleared by a blast (for activation scoring). */
  function hitCell(ctx, stage, cell, cause) {
    if (stage.hit.has(cell)) return 0;
    stage.hit.add(cell);
    const piece = ctx.state.cells[cell];
    if (!piece) return 0;
    if (piece.kind === KIND.FROSTING) {
      damageFrosting(ctx, stage, cell);
      return 0;
    }
    if (piece.kind === KIND.CHERRY) return 0; // ingredients are never destroyed
    damageJelly(ctx, stage, cell);
    if (isTriggerable(piece)) {
      stage.next_wave.push({ cell, piece_id: piece.id, cause });
      return 0;
    }
    removePiece(ctx, stage, cell, cause);
    return cause === 'match' ? 0 : 1;
  }

  function activationArea(state, cell, special) {
    if (special === SPECIAL.STRIPE_ROW) return { kind: 'row', area: rowCells(state, rowOf(state, cell)) };
    if (special === SPECIAL.STRIPE_COL) return { kind: 'col', area: colCells(state, colOf(state, cell)) };
    if (special === SPECIAL.WRAPPED) return { kind: 'wrapped', area: squareCells(state, cell, 1) };
    if (special === SPECIAL.WRAPPED_ARMED) return { kind: 'wrapped_second', area: squareCells(state, cell, 1) };
    if (special === SPECIAL.WRAPPED_BIG_ARMED) return { kind: 'wrapped_big_second', area: squareCells(state, cell, 2) };
    const color = mostCommonColor(state);
    return { kind: 'bomb', area: color >= 0 ? cellsWithColor(state, color) : [], color };
  }

  function activateSpecial(ctx, stage, trigger) {
    const state = ctx.state;
    const piece = state.cells[trigger.cell];
    if (!piece || piece.id !== trigger.piece_id) return;
    const special = piece.special;
    const activation = activationArea(state, trigger.cell, special);
    const is_first_activation = special !== SPECIAL.WRAPPED_ARMED && special !== SPECIAL.WRAPPED_BIG_ARMED;
    ctx.stats.activations += 1;
    emit(ctx, {
      type: 'activate', cell: trigger.cell, piece_id: piece.id, special, color: piece.color, kind: activation.kind,
      target_color: activation.color, area: activation.area, wave: stage.wave,
    });
    if (special === SPECIAL.WRAPPED) {
      piece.special = SPECIAL.WRAPPED_ARMED;
      emit(ctx, { type: 'transform', cell: trigger.cell, piece_id: piece.id, special: SPECIAL.WRAPPED_ARMED, color: piece.color, wave: stage.wave });
    } else {
      removePiece(ctx, stage, trigger.cell, 'activate');
    }
    let cleared_count = 0;
    activation.area.forEach((cell) => {
      cleared_count += hitCell(ctx, stage, cell, 'blast');
    });
    const own_points = trigger.cause === 'blast' ? SCORING.ACTIVATION_PER_CANDY : 0;
    const special_points = is_first_activation ? SCORING.ACTIVATION_PER_SPECIAL : 0;
    addScore(ctx, (special_points + own_points + SCORING.ACTIVATION_PER_CANDY * cleared_count) * stage.multiplier, 'activation', trigger.cell);
  }

  /** Breadth-first chain reactions; each wave is processed in reading order (row by row from the top, left to right). */
  function runWaves(ctx, stage) {
    let guard = 0;
    while (stage.next_wave.length > 0) {
      guard += 1;
      if (guard > 1000) throw new Error('Chain reaction did not terminate');
      const wave = stage.next_wave.sort((first, second) => first.cell - second.cell);
      stage.next_wave = [];
      stage.wave += 1;
      wave.forEach((trigger) => activateSpecial(ctx, stage, trigger));
    }
  }

  function applyCreations(ctx, stage, creations) {
    const state = ctx.state;
    creations.forEach((creation) => {
      let cell = creation.plan.cell;
      if (state.cells[cell] !== null) {
        const fallback_cell = creation.group.cells.find((group_cell) => state.cells[group_cell] === null);
        if (fallback_cell === undefined) return;
        cell = fallback_cell;
      }
      const piece = newPiece(state, KIND.CANDY, creation.plan.color, creation.plan.special, 0);
      state.cells[cell] = piece;
      const kind = creation.plan.special === SPECIAL.BOMB ? 'bomb' : creation.plan.special === SPECIAL.WRAPPED ? 'wrapped' : 'stripe';
      ctx.stats.specials_created[kind] += 1;
      emit(ctx, { type: 'create', cell, piece: clonePiece(piece), from_cells: creation.group.cells.slice(), wave: stage.wave });
      addScore(ctx, creationPoints(creation.plan.special) * stage.multiplier, 'create', cell);
    });
  }

  function runMatchStage(ctx, groups, swap_cells) {
    const state = ctx.state;
    const stage = createStage(ctx);
    beginPhase(ctx, 'clear', { depth: ctx.cascade_depth, multiplier: stage.multiplier, source: swap_cells ? 'swap' : 'cascade' });
    ctx.stats.cascades = Math.max(ctx.stats.cascades, ctx.cascade_depth);
    const creations = [];
    groups.forEach((group) => {
      const plan = planCreation(group, swap_cells);
      emit(ctx, {
        type: 'match', cells: group.cells.slice(), color: group.color, size: group.cells.length,
        shape: group.intersections.length ? 'cross' : 'line', creation: plan ? { cell: plan.cell, special: plan.special } : null, wave: 0,
      });
      addScore(ctx, matchPoints(group.cells.length) * stage.multiplier, 'match', group.cells[Math.floor(group.cells.length / 2)]);
      if (plan) creations.push({ plan, group });
    });
    groups.forEach((group) => {
      group.cells.forEach((cell) => {
        orthogonalNeighbors(state, cell).forEach((neighbor) => {
          const neighbor_piece = state.cells[neighbor];
          if (neighbor_piece && neighbor_piece.kind === KIND.FROSTING) damageFrosting(ctx, stage, neighbor);
        });
      });
    });
    groups.forEach((group) => group.cells.forEach((cell) => hitCell(ctx, stage, cell, 'match')));
    runWaves(ctx, stage);
    applyCreations(ctx, stage, creations);
  }

  function comboName(first_piece, second_piece) {
    const kindOf = (piece) => (piece.special === SPECIAL.BOMB ? 'bomb' : piece.special === SPECIAL.WRAPPED ? 'wrapped' : 'stripe');
    const names = [kindOf(first_piece), kindOf(second_piece)].sort((a, b) => ['bomb', 'wrapped', 'stripe'].indexOf(a) - ['bomb', 'wrapped', 'stripe'].indexOf(b));
    return names.join('_');
  }

  /** Two activatable specials swapped together (always valid). `center` is where the dragged candy landed. */
  function runComboStage(ctx, from_cell, to_cell) {
    const state = ctx.state;
    const moved_piece = state.cells[to_cell];
    const other_piece = state.cells[from_cell];
    const combo = comboName(moved_piece, other_piece);
    const stage = createStage(ctx);
    beginPhase(ctx, 'clear', { depth: ctx.cascade_depth, multiplier: stage.multiplier, source: 'combo', combo });
    ctx.stats.combos.push(combo);
    const center = to_cell;
    emit(ctx, { type: 'combo', combo, cells: [from_cell, to_cell], center, wave: 0 });
    [from_cell, to_cell].forEach((cell) => {
      stage.hit.add(cell);
      damageJelly(ctx, stage, cell);
    });
    let cleared_count = 0;
    const hitArea = (area) => area.forEach((cell) => {
      cleared_count += hitCell(ctx, stage, cell, 'blast');
    });

    if (combo === 'bomb_bomb') {
      removePiece(ctx, stage, from_cell, 'combo');
      removePiece(ctx, stage, to_cell, 'combo');
      const area = allActiveCells(state);
      emit(ctx, { type: 'activate', cell: center, special: SPECIAL.BOMB, kind: 'board', area, wave: 0 });
      hitArea(area);
    } else if (combo === 'bomb_stripe' || combo === 'bomb_wrapped') {
      const bomb_cell = moved_piece.special === SPECIAL.BOMB ? to_cell : from_cell;
      const partner_cell = bomb_cell === to_cell ? from_cell : to_cell;
      const partner_piece = state.cells[partner_cell];
      const target_color = partner_piece.color;
      removePiece(ctx, stage, bomb_cell, 'combo');
      const targets = cellsWithColor(state, target_color);
      emit(ctx, { type: 'activate', cell: bomb_cell, special: SPECIAL.BOMB, kind: combo === 'bomb_stripe' ? 'bomb_to_stripes' : 'bomb_to_wrapped', target_color, area: targets, wave: 0 });
      targets.forEach((cell) => {
        const piece = state.cells[cell];
        if (piece.special === SPECIAL.NONE) {
          piece.special = combo === 'bomb_wrapped' ? SPECIAL.WRAPPED : (rngNext(state) < 0.5 ? SPECIAL.STRIPE_ROW : SPECIAL.STRIPE_COL);
          emit(ctx, { type: 'transform', cell, piece_id: piece.id, special: piece.special, color: piece.color, wave: 0 });
        }
        if (!stage.hit.has(cell)) {
          stage.hit.add(cell);
          damageJelly(ctx, stage, cell);
        }
        stage.next_wave.push({ cell, piece_id: piece.id, cause: 'combo' });
      });
    } else if (combo === 'stripe_stripe' || combo === 'wrapped_stripe') {
      removePiece(ctx, stage, from_cell, 'combo');
      removePiece(ctx, stage, to_cell, 'combo');
      const area = combo === 'stripe_stripe' ? bandCells(state, center, 0) : bandCells(state, center, 1);
      emit(ctx, { type: 'activate', cell: center, special: SPECIAL.STRIPE_ROW, kind: combo === 'stripe_stripe' ? 'cross' : 'big_cross', area, wave: 0 });
      hitArea(area);
    } else if (combo === 'wrapped_wrapped') {
      removePiece(ctx, stage, from_cell, 'combo');
      moved_piece.special = SPECIAL.WRAPPED_BIG_ARMED;
      emit(ctx, { type: 'transform', cell: to_cell, piece_id: moved_piece.id, special: SPECIAL.WRAPPED_BIG_ARMED, color: moved_piece.color, wave: 0 });
      const area = squareCells(state, center, 2);
      emit(ctx, { type: 'activate', cell: center, special: SPECIAL.WRAPPED, kind: 'wrapped_big', area, wave: 0 });
      hitArea(area);
    } else {
      throw new Error(`Unknown combo ${combo}`);
    }
    addScore(ctx, (2 * SCORING.ACTIVATION_PER_SPECIAL + SCORING.ACTIVATION_PER_CANDY * cleared_count) * stage.multiplier, 'combo', center);
    runWaves(ctx, stage);
  }

  /** Color bomb swapped with a non-special candy: clears every candy of that candy's color. */
  function runBombSwapStage(ctx, bomb_cell, candy_cell) {
    const state = ctx.state;
    const target_color = state.cells[candy_cell].color;
    const stage = createStage(ctx);
    beginPhase(ctx, 'clear', { depth: ctx.cascade_depth, multiplier: stage.multiplier, source: 'bomb' });
    stage.hit.add(bomb_cell);
    damageJelly(ctx, stage, bomb_cell);
    const bomb_piece = state.cells[bomb_cell];
    emit(ctx, { type: 'activate', cell: bomb_cell, piece_id: bomb_piece.id, special: SPECIAL.BOMB, kind: 'bomb', target_color, area: cellsWithColor(state, target_color), wave: 0 });
    removePiece(ctx, stage, bomb_cell, 'activate');
    let cleared_count = 0;
    cellsWithColor(state, target_color).forEach((cell) => {
      cleared_count += hitCell(ctx, stage, cell, 'blast');
    });
    addScore(ctx, (SCORING.ACTIVATION_PER_SPECIAL + SCORING.ACTIVATION_PER_CANDY * cleared_count) * stage.multiplier, 'activation', bomb_cell);
    runWaves(ctx, stage);
  }

  /** Second blast of armed wrapped candies once the board has settled. */
  function runDetonationStage(ctx, armed_cells, source) {
    const state = ctx.state;
    const stage = createStage(ctx);
    beginPhase(ctx, 'clear', { depth: ctx.cascade_depth, multiplier: stage.multiplier, source: source || 'detonation' });
    armed_cells.forEach((cell) => {
      stage.hit.add(cell);
      damageJelly(ctx, stage, cell);
      stage.next_wave.push({ cell, piece_id: state.cells[cell].id, cause: source === 'bonus' ? 'bonus' : 'detonate' });
    });
    runWaves(ctx, stage);
  }

  function armedCells(state) {
    const found = [];
    state.cells.forEach((piece, index) => {
      if (piece && (piece.special === SPECIAL.WRAPPED_ARMED || piece.special === SPECIAL.WRAPPED_BIG_ARMED)) found.push(index);
    });
    return found;
  }

  // ------------------------------------------------------------------ gravity and refill

  /**
   * Gravity rule (deterministic, simulated in steps where every piece moves at most one cell):
   *  1. Vertical: candies and cherries fall straight down into empty cells (bottom-up, so whole columns move together).
   *  2. Spawn: the topmost non-hole cell of each column spawns a new seeded-random candy when empty.
   *  3. Exits: a cherry resting on an exit tray cell is collected.
   *  4. Diagonal: only when nothing can fall or spawn, each empty cell whose cell above is a hole or frosting takes a piece
   *     sliding diagonally from the upper-left (preferred) or upper-right neighbor. Scan: bottom row first, left to right.
   * Repeats until nothing moves. Pieces only ever move downward, so it always terminates.
   */
  function settleBoard(ctx) {
    const state = ctx.state;
    const rows = state.rows;
    const cols = state.cols;
    const cells = state.cells;
    const tracks = new Map();
    const track_order = [];
    const collected_events = [];
    const trackPiece = (piece, step, cell, spawned) => {
      if (!tracks.has(piece.id)) {
        tracks.set(piece.id, { piece, spawned, path: [], collected: false, start_cell: cell });
        track_order.push(piece.id);
        if (!spawned) tracks.get(piece.id).path.push([step, rowOf(state, cell), colOf(state, cell)]);
      }
      return tracks.get(piece.id);
    };
    // Appends a one-step move (step -> step + 1), inserting a hold point if the piece rested since its last move.
    const recordMove = (track, step, row, col) => {
      const last_point = track.path[track.path.length - 1];
      if (last_point[0] < step) track.path.push([step, last_point[1], last_point[2]]);
      track.path.push([step + 1, row, col]);
    };
    let step = 0;
    let guard = 0;
    while (true) {
      guard += 1;
      if (guard > SETTLE_STEP_CAP) throw new Error('Gravity did not settle');
      let moved = false;
      for (let row = rows - 2; row >= 0; row -= 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          const piece = cells[index];
          if (!isMovable(piece)) continue;
          const below = index + cols;
          if (state.holes[below] || cells[below] !== null) continue;
          const track = trackPiece(piece, step, index, false);
          cells[below] = piece;
          cells[index] = null;
          recordMove(track, step, row + 1, col);
          moved = true;
        }
      }
      for (let col = 0; col < cols; col += 1) {
        const spawn_cell = state.spawn_cells[col];
        if (spawn_cell < 0 || cells[spawn_cell] !== null) continue;
        const piece = newPiece(state, KIND.CANDY, randomPaletteColor(state), SPECIAL.NONE, 0);
        cells[spawn_cell] = piece;
        const track = trackPiece(piece, step, spawn_cell, true);
        const spawn_row = rowOf(state, spawn_cell);
        track.path.push([step, spawn_row - 1, col]);
        track.path.push([step + 1, spawn_row, col]);
        moved = true;
      }
      for (let index = 0; index < cells.length; index += 1) {
        const piece = cells[index];
        if (!state.exits[index] || !piece || piece.kind !== KIND.CHERRY) continue;
        const below = index + cols;
        const can_fall = index + cols < cells.length && !state.holes[below] && cells[below] === null;
        if (can_fall) continue;
        const track = trackPiece(piece, step, index, false);
        track.collected = true;
        cells[index] = null;
        state.cherries_collected += 1;
        collected_events.push({ piece_id: piece.id, cell: index, step: step + 1 });
        moved = true;
      }
      if (moved) {
        step += 1;
        continue;
      }
      let slid = false;
      const used_cells = new Set();
      for (let row = rows - 1; row >= 1; row -= 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          if (state.holes[index] || cells[index] !== null || used_cells.has(index)) continue;
          const above = index - cols;
          if (!state.holes[above] && cells[above] === null) continue;
          if (isMovable(cells[above])) continue;
          for (const col_offset of [-1, 1]) {
            const source_col = col + col_offset;
            if (source_col < 0 || source_col >= cols) continue;
            const source = (row - 1) * cols + source_col;
            if (state.holes[source] || used_cells.has(source)) continue;
            const piece = cells[source];
            if (!isMovable(piece)) continue;
            const track = trackPiece(piece, step, source, false);
            cells[index] = piece;
            cells[source] = null;
            used_cells.add(source);
            used_cells.add(index);
            recordMove(track, step, row, col);
            slid = true;
            break;
          }
        }
      }
      if (slid) {
        step += 1;
        continue;
      }
      break;
    }
    if (track_order.length === 0) return;
    beginPhase(ctx, 'settle', { steps: step });
    const finalCellOf = (track) => {
      const last = track.path[track.path.length - 1];
      return last[1] * cols + last[2];
    };
    track_order.forEach((piece_id) => {
      const track = tracks.get(piece_id);
      if (track.spawned) {
        emit(ctx, { type: 'spawn', piece: clonePiece(track.piece), to: finalCellOf(track), path: track.path });
      } else {
        emit(ctx, { type: 'fall', piece_id, kind: track.piece.kind, from: track.start_cell, to: finalCellOf(track), path: track.path, collected: track.collected });
      }
    });
    collected_events.forEach((collected) => {
      emit(ctx, { type: 'collect', piece_id: collected.piece_id, cell: collected.cell, step: collected.step });
      addScore(ctx, SCORING.INGREDIENT, 'ingredient', collected.cell);
    });
  }

  /** Settles, fires armed wrapped candies, and re-scans for cascades until the board is stable. */
  function resolveBoard(ctx) {
    let guard = 0;
    while (true) {
      guard += 1;
      if (guard > RESOLVE_LOOP_CAP) throw new Error('Cascade loop did not terminate');
      settleBoard(ctx);
      const armed = armedCells(ctx.state);
      if (armed.length > 0) {
        runDetonationStage(ctx, armed, 'detonation');
        continue;
      }
      const groups = findMatchGroups(ctx.state);
      if (groups.length === 0) break;
      ctx.cascade_depth += 1;
      emit(ctx, { type: 'cascade', depth: ctx.cascade_depth, multiplier: cascadeMultiplier(ctx.cascade_depth) });
      runMatchStage(ctx, groups, null);
    }
  }

  // ------------------------------------------------------------------ shuffle

  /**
   * Reshuffles regular candies (specials, blockers, ingredients and jelly stay put) until there are no matches and at
   * least one valid move: up to 50 permutations, then up to 50 recolorings, then (only for pathological boards) one
   * regular candy next to another swappable candy becomes a color bomb, which is always a valid move.
   */
  function shuffleBoard(ctx, reason) {
    const state = ctx.state;
    const shuffle_cells = [];
    state.cells.forEach((piece, index) => {
      if (isRegularCandy(piece)) shuffle_cells.push(index);
    });
    ctx.stats.shuffles += 1;
    beginPhase(ctx, 'shuffle', { reason: reason || 'no_moves' });
    const original_pieces = shuffle_cells.map((cell) => state.cells[cell]);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const order = original_pieces.slice();
      for (let index = order.length - 1; index > 0; index -= 1) {
        const swap_index = Math.floor(rngNext(state) * (index + 1));
        const held = order[index];
        order[index] = order[swap_index];
        order[swap_index] = held;
      }
      shuffle_cells.forEach((cell, index) => {
        state.cells[cell] = order[index];
      });
      if (findMatchGroups(state).length === 0 && hasValidMove(state)) {
        const moves = [];
        shuffle_cells.forEach((cell, index) => {
          const piece = order[index];
          const from = shuffle_cells[original_pieces.indexOf(piece)];
          moves.push({ piece_id: piece.id, from, to: cell });
        });
        emit(ctx, { type: 'shuffle', moves, attempt: attempt + 1 });
        return;
      }
    }
    shuffle_cells.forEach((cell, index) => {
      state.cells[cell] = original_pieces[index];
    });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      shuffle_cells.forEach((cell) => {
        const forbidden = colorsForbiddenAt(state, cell);
        const candidates = state.palette.filter((color) => forbidden.indexOf(color) < 0);
        state.cells[cell].color = candidates[Math.floor(rngNext(state) * candidates.length)];
      });
      if (findMatchGroups(state).length === 0 && hasValidMove(state)) {
        shuffle_cells.forEach((cell) => emit(ctx, { type: 'recolor', cell, piece_id: state.cells[cell].id, color: state.cells[cell].color }));
        return;
      }
    }
    shuffle_cells.forEach((cell) => emit(ctx, { type: 'recolor', cell, piece_id: state.cells[cell].id, color: state.cells[cell].color }));
    for (const cell of shuffle_cells) {
      const has_swappable_neighbor = orthogonalNeighbors(state, cell).some((neighbor) => isSwappable(state.cells[neighbor]));
      if (has_swappable_neighbor) {
        const piece = state.cells[cell];
        piece.special = SPECIAL.BOMB;
        piece.color = -1;
        emit(ctx, { type: 'transform', cell, piece_id: piece.id, special: SPECIAL.BOMB, color: -1 });
        if (findMatchGroups(state).length === 0 && hasValidMove(state)) return;
      }
    }
  }

  // ------------------------------------------------------------------ public move API

  function finishMove(ctx) {
    const state = ctx.state;
    if (goalsMet(state)) state.status = 'won';
    else if (state.moves_left <= 0) state.status = 'lost';
    if (state.status === 'playing' && !hasValidMove(state)) shuffleBoard(ctx, 'no_moves');
    emit(ctx, { type: 'end', status: state.status, score: state.score, moves_left: state.moves_left });
  }

  /**
   * Applies a swap. Invalid swaps return {valid:false} with the unchanged state and an 'invalid_swap' event (no move used).
   * Valid swaps return a NEW state plus the full event list (the input state is never mutated).
   */
  function applySwap(state_in, from_cell, to_cell) {
    if (state_in.status !== 'playing' || state_in.moves_left <= 0 || !isValidSwap(state_in, from_cell, to_cell)) {
      return { valid: false, state: state_in, events: [{ type: 'invalid_swap', phase: 0, from: from_cell, to: to_cell }], stats: null };
    }
    const state = cloneState(state_in);
    const ctx = createContext(state);
    beginPhase(ctx, 'swap', {});
    const from_piece = state.cells[from_cell];
    const to_piece = state.cells[to_cell];
    state.cells[from_cell] = to_piece;
    state.cells[to_cell] = from_piece;
    state.moves_left -= 1;
    state.moves_made += 1;
    emit(ctx, { type: 'swap', from: from_cell, to: to_cell, from_piece_id: from_piece.id, to_piece_id: to_piece.id, moves_left: state.moves_left });
    ctx.cascade_depth = 1;
    emit(ctx, { type: 'cascade', depth: 1, multiplier: 1 });
    const moved_piece = state.cells[to_cell];
    const other_piece = state.cells[from_cell];
    if (isActivatable(moved_piece) && isActivatable(other_piece)) {
      runComboStage(ctx, from_cell, to_cell);
    } else if (moved_piece.special === SPECIAL.BOMB) {
      runBombSwapStage(ctx, to_cell, from_cell);
    } else if (other_piece.special === SPECIAL.BOMB) {
      runBombSwapStage(ctx, from_cell, to_cell);
    } else {
      runMatchStage(ctx, findMatchGroups(state), [to_cell, from_cell]);
    }
    resolveBoard(ctx);
    finishMove(ctx);
    return { valid: true, state, events: ctx.events, stats: ctx.stats };
  }

  /**
   * End-of-level bonus after a win: each remaining move turns a random regular candy into a striped candy that fires
   * immediately (+300 per move plus normal clear points), one by one, with cascades resolved after each.
   */
  function applyEndBonus(state_in) {
    const state = cloneState(state_in);
    const ctx = createContext(state);
    const start_moves = state.moves_left;
    while (state.moves_left > 0) {
      state.moves_left -= 1;
      beginPhase(ctx, 'bonus', { moves_left: state.moves_left });
      ctx.cascade_depth = 1;
      addScore(ctx, SCORING.END_BONUS_PER_MOVE, 'bonus', -1);
      const candidates = [];
      state.cells.forEach((piece, index) => {
        if (isRegularCandy(piece)) candidates.push(index);
      });
      if (candidates.length === 0) continue;
      const cell = candidates[Math.floor(rngNext(state) * candidates.length)];
      const piece = state.cells[cell];
      piece.special = rngNext(state) < 0.5 ? SPECIAL.STRIPE_ROW : SPECIAL.STRIPE_COL;
      emit(ctx, { type: 'transform', cell, piece_id: piece.id, special: piece.special, color: piece.color, bonus: true });
      runDetonationStage(ctx, [cell], 'bonus');
      resolveBoard(ctx);
    }
    emit(ctx, { type: 'end', status: state.status, score: state.score, moves_left: 0, bonus_moves: start_moves });
    return { state, events: ctx.events, stats: ctx.stats };
  }

  // ------------------------------------------------------------------ hints and bots

  const COMBO_VALUES = Object.freeze({ bomb_bomb: 10000, bomb_wrapped: 9000, bomb_stripe: 8500, wrapped_wrapped: 8000, wrapped_stripe: 7500, stripe_stripe: 7000 });

  /**
   * Greedy evaluation of a valid move without resolving it: specials first (combo > bomb > wrapped > striped),
   * then match size, with a small weight for goal relevance (jelly under the match, wanted colors, cells under cherries).
   */
  function evaluateMove(state, move) {
    const from_piece = state.cells[move.from];
    const to_piece = state.cells[move.to];
    if (isActivatable(from_piece) && isActivatable(to_piece)) return COMBO_VALUES[comboName(from_piece, to_piece)];
    if (from_piece.special === SPECIAL.BOMB || to_piece.special === SPECIAL.BOMB) {
      const partner = from_piece.special === SPECIAL.BOMB ? to_piece : from_piece;
      return 6000 + 10 * cellsWithColor(state, partner.color).length;
    }
    state.cells[move.from] = to_piece;
    state.cells[move.to] = from_piece;
    const groups = findMatchGroups(state);
    state.cells[move.from] = from_piece;
    state.cells[move.to] = to_piece;
    const wanted_colors = new Set();
    let wants_jelly = false;
    let wants_cherries = false;
    state.goals.forEach((goal) => {
      if (goal.type === 'collect' && state.collected[goal.color] < goal.count) wanted_colors.add(goal.color);
      if (goal.type === 'jelly') wants_jelly = true;
      if (goal.type === 'ingredients') wants_cherries = true;
    });
    let value = 0;
    groups.forEach((group) => {
      const plan = planCreation(group, [move.to, move.from]);
      if (plan) value += plan.special === SPECIAL.BOMB ? 5000 : plan.special === SPECIAL.WRAPPED ? 3000 : 2000;
      value += group.cells.length * 10;
      group.cells.forEach((cell) => {
        const original_piece = cell === move.from ? to_piece : cell === move.to ? from_piece : state.cells[cell];
        if (isTriggerable(original_piece)) value += 400;
        if (wants_jelly && state.jelly[cell] > 0) value += 15 * state.jelly[cell];
        if (wanted_colors.has(group.color)) value += 12;
        if (wants_cherries) {
          for (let above = cell - state.cols; above >= 0; above -= state.cols) {
            const above_piece = state.cells[above];
            if (above_piece && above_piece.kind === KIND.CHERRY) {
              value += 25;
              break;
            }
          }
        }
      });
    });
    return value;
  }

  /** Best move by the greedy evaluation; ties broken by `rng` when given, otherwise the first in reading order. */
  function chooseGreedyMove(state, rng) {
    const moves = listValidMoves(state);
    if (moves.length === 0) return null;
    let best_value = -Infinity;
    let best_moves = [];
    moves.forEach((move) => {
      const value = evaluateMove(state, move);
      if (value > best_value) {
        best_value = value;
        best_moves = [move];
      } else if (value === best_value) {
        best_moves.push(move);
      }
    });
    if (!rng) return best_moves[0];
    return best_moves[Math.floor(rng() * best_moves.length)];
  }

  function findHint(state) {
    return chooseGreedyMove(state, null);
  }

  function chooseRandomMove(state, rng) {
    const moves = listValidMoves(state);
    if (moves.length === 0) return null;
    const move = moves[Math.floor(rng() * moves.length)];
    return rng() < 0.5 ? move : { from: move.to, to: move.from };
  }

  // ------------------------------------------------------------------ invariants and replay

  /** Returns a list of invariant violations for a board at rest (empty when healthy). */
  function checkBoardInvariants(state) {
    const problems = [];
    const seen_ids = new Set();
    state.cells.forEach((piece, index) => {
      if (state.holes[index]) {
        if (piece) problems.push(`piece in hole at ${index}`);
        if (state.jelly[index]) problems.push(`jelly in hole at ${index}`);
        return;
      }
      if (!piece) {
        problems.push(`empty cell at ${index}`);
        return;
      }
      if (seen_ids.has(piece.id)) problems.push(`duplicate piece id ${piece.id}`);
      seen_ids.add(piece.id);
      if (piece.kind === KIND.CANDY) {
        if (piece.special === SPECIAL.BOMB) {
          if (piece.color !== -1) problems.push(`colored bomb at ${index}`);
        } else if (state.palette.indexOf(piece.color) < 0) {
          problems.push(`color ${piece.color} not in palette at ${index}`);
        }
        if (piece.special === SPECIAL.WRAPPED_ARMED || piece.special === SPECIAL.WRAPPED_BIG_ARMED) problems.push(`armed wrapped at rest at ${index}`);
      }
      if (piece.kind === KIND.FROSTING && (piece.layers < 1 || piece.layers > 2)) problems.push(`bad frosting layers at ${index}`);
      if (state.jelly[index] > 2) problems.push(`bad jelly at ${index}`);
    });
    if (findMatchGroups(state).length > 0) problems.push('unresolved match on board at rest');
    if (state.status === 'playing' && !hasValidMove(state)) problems.push('no valid move while playing');
    if (state.moves_left < 0) problems.push('negative moves');
    return problems;
  }

  function boardSignature(state) {
    const cell_text = state.cells.map((piece) => (piece ? `${piece.id}:${piece.kind[0]}${piece.color}${piece.special}${piece.layers}` : '_')).join(',');
    return `${cell_text}|${Array.from(state.jelly).join('')}|${state.score}|${state.collected.join('.')}|${state.cherries_collected}`;
  }

  /** Re-applies an event list to a starting state (renderer semantics). Used by the replay invariant test. */
  function replayEvents(start_state, events) {
    const state = cloneState(start_state);
    const cells = state.cells;
    let index = 0;
    const assertPiece = (cell, piece_id, label) => {
      if (!cells[cell] || cells[cell].id !== piece_id) throw new Error(`replay: ${label} expected piece ${piece_id} at ${cell}`);
    };
    while (index < events.length) {
      const event = events[index];
      if (event.type === 'fall' || event.type === 'spawn' || event.type === 'collect') {
        const batch = [];
        while (index < events.length && (events[index].type === 'fall' || events[index].type === 'spawn' || events[index].type === 'collect')) {
          batch.push(events[index]);
          index += 1;
        }
        const moving = [];
        batch.forEach((batch_event) => {
          if (batch_event.type === 'fall') {
            assertPiece(batch_event.from, batch_event.piece_id, 'fall');
            moving.push({ piece: cells[batch_event.from], to: batch_event.to, collected: batch_event.collected });
            cells[batch_event.from] = null;
          }
        });
        batch.forEach((batch_event) => {
          if (batch_event.type === 'collect') state.cherries_collected += 1;
        });
        moving.forEach((move) => {
          if (move.collected) return;
          if (cells[move.to]) throw new Error(`replay: fall target ${move.to} occupied`);
          cells[move.to] = move.piece;
        });
        batch.forEach((batch_event) => {
          if (batch_event.type !== 'spawn') return;
          if (cells[batch_event.to]) throw new Error(`replay: spawn target ${batch_event.to} occupied`);
          cells[batch_event.to] = clonePiece(batch_event.piece);
        });
        continue;
      }
      switch (event.type) {
        case 'swap': {
          assertPiece(event.from, event.from_piece_id, 'swap');
          assertPiece(event.to, event.to_piece_id, 'swap');
          const held = cells[event.from];
          cells[event.from] = cells[event.to];
          cells[event.to] = held;
          state.moves_left = event.moves_left;
          state.moves_made += 1;
          break;
        }
        case 'clear':
          assertPiece(event.cell, event.piece_id, 'clear');
          if (cells[event.cell].kind === KIND.CANDY && cells[event.cell].color >= 0) state.collected[cells[event.cell].color] += 1;
          cells[event.cell] = null;
          break;
        case 'transform':
          assertPiece(event.cell, event.piece_id, 'transform');
          cells[event.cell].special = event.special;
          if (event.color !== undefined) cells[event.cell].color = event.color;
          break;
        case 'create':
          if (cells[event.cell]) throw new Error(`replay: create target ${event.cell} occupied`);
          cells[event.cell] = clonePiece(event.piece);
          break;
        case 'jelly':
          state.jelly[event.cell] = event.layers;
          break;
        case 'frosting':
          assertPiece(event.cell, event.piece_id, 'frosting');
          if (event.layers <= 0) cells[event.cell] = null;
          else cells[event.cell].layers = event.layers;
          break;
        case 'score':
          state.score += event.points;
          break;
        case 'shuffle': {
          const moving = event.moves.map((move) => {
            assertPiece(move.from, move.piece_id, 'shuffle');
            return { piece: cells[move.from], to: move.to };
          });
          event.moves.forEach((move) => {
            cells[move.from] = null;
          });
          moving.forEach((move) => {
            cells[move.to] = move.piece;
          });
          break;
        }
        case 'recolor':
          assertPiece(event.cell, event.piece_id, 'recolor');
          cells[event.cell].color = event.color;
          break;
        default:
          break;
      }
      index += 1;
    }
    return state;
  }

  /** Cells that can ever receive a falling piece with all frosting intact (layout validation). */
  function fallReachableCells(level) {
    const layout = parseLayout(level);
    const reachable = new Uint8Array(layout.rows * layout.cols);
    const isBlocked = (index) => layout.holes[index] || layout.frosting[index];
    for (let col = 0; col < layout.cols; col += 1) {
      for (let row = 0; row < layout.rows; row += 1) {
        const index = row * layout.cols + col;
        if (layout.holes[index]) continue;
        if (!layout.frosting[index]) reachable[index] = 1;
        break;
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (let row = 1; row < layout.rows; row += 1) {
        for (let col = 0; col < layout.cols; col += 1) {
          const index = row * layout.cols + col;
          if (reachable[index] || isBlocked(index)) continue;
          const above = index - layout.cols;
          let can_receive = !isBlocked(above) && reachable[above];
          if (!can_receive && isBlocked(above)) {
            can_receive = [-1, 1].some((offset) => {
              const source_col = col + offset;
              if (source_col < 0 || source_col >= layout.cols) return false;
              const source = above + offset;
              return !isBlocked(source) && reachable[source];
            });
          }
          if (can_receive) {
            reachable[index] = 1;
            changed = true;
          }
        }
      }
    }
    return { layout, reachable };
  }

  const LOGIC = {
    KIND,
    SPECIAL,
    SCORING,
    LAYOUT_LEGEND,
    MAX_COLORS,
    matchPoints,
    cascadeMultiplier,
    parseLayout,
    createGame,
    cloneState,
    findMatchGroups,
    planCreation,
    isValidSwap,
    listValidMoves,
    hasValidMove,
    applySwap,
    applyEndBonus,
    goalProgress,
    goalsMet,
    starsForScore,
    evaluateMove,
    chooseGreedyMove,
    chooseRandomMove,
    findHint,
    checkBoardInvariants,
    boardSignature,
    replayEvents,
    fallReachableCells,
    mostCommonColor,
    isActivatable,
    isRegularCandy,
    // Low-level pieces exposed for tests and the self-test panel.
    internals: { newPiece, buildEmptyState, settleBoard, createContext, resolveBoard, shuffleBoard, runMatchStage, finishMove },
  };
  SC.LOGIC = LOGIC;
  if (typeof module === 'object' && module.exports) module.exports = LOGIC;
})(typeof window !== 'undefined' ? window : globalThis);
