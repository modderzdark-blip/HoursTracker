// LOGIC: pure, deterministic, DOM-free match-3 rules.
// Every move is computed instantly and returns an ordered event list; the renderer only animates that list.
// Cells are addressed by index = row * cols + col (reading order).
//
// Blockers and board features are MECHANIC PLUGINS behind one interface (see MECHANICS below); the core only knows
// candies, specials, matches, gravity and goals and asks the plugins at fixed points.
(function attachLogic(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');
  const rngNext = UTIL.rngNext;

  const KIND = Object.freeze({ CANDY: 'candy', CHERRY: 'cherry', HAZELNUT: 'hazelnut', FROSTING: 'frosting', COCOA: 'cocoa' });
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
  const MAX_FROSTING_LAYERS = 5;
  const SETTLE_STEP_CAP = 4000;
  const RESOLVE_LOOP_CAP = 400;
  const BELT_DIRECTIONS = Object.freeze({ '>': 1, '<': 2, '^': 3, v: 4 });
  const COCOA_MAX_SHARE = 0.5; // Cocoa Creep stops spreading at half of the board's cells

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
    COCOA: 150,
    CAGE: 100,
    END_BONUS_PER_MOVE: 300,
    CASCADE_STEP: 0.5,
    CASCADE_CAP: 4,
    TIME_BONUS_PER_SPECIAL: 2, // seconds added in timed levels for every special candy created
    FINALE_MAX_STRIKES_TIMED: 25, // Sweet Finale strikes for leftover seconds (one per second, capped)
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

  function isIngredient(piece) {
    return !!piece && (piece.kind === KIND.CHERRY || piece.kind === KIND.HAZELNUT);
  }

  function isBlocker(piece) {
    return !!piece && (piece.kind === KIND.FROSTING || piece.kind === KIND.COCOA);
  }

  // ------------------------------------------------------------------ mechanic plugins
  //
  // Interface (every hook is optional):
  //   id                                  unique mechanic name (the renderer draws it under the same id)
  //   symbols                             { layoutCharacter: description }
  //   parseCell(parsed, index, symbol)    record a layout cell
  //   validateLayout(level, parsed)       -> array of problems
  //   populate(state, parsed, index)      create the starting piece or overlay before the random fill
  //   afterFill(state, parsed, index)     decorate the randomly filled candy (cages, fuses)
  //   blocksSwap(state, cell)             -> true when the piece in the cell may not be swapped
  //   blocksFall(state, cell)             -> true when the piece in the cell may not move
  //   absorbHit(ctx, stage, cell, cause)  -> true when the mechanic took the hit (the default clear is skipped)
  //   onCleared(ctx, stage, cell)         a candy in the cell was cleared or fired
  //   onAdjacentMatch(ctx, stage, cell)   a match touched the cell from a side
  //   fallTarget(state, cell)             -> cell a piece here drops into when it cannot fall straight down, or -1
  //   spawnsAt(state, cell)               -> false to stop the top cell of a column from spawning
  //   onMoveEnd(ctx)                      after a player move's cascades (belts, fuses, cocoa), unless already won
  //   goalProgress(state, goal)           -> progress for goal types the mechanic owns, or null
  //   orderCounter                        name of the order counter the mechanic feeds ('frosting', 'cocoa', 'cage')

  function damageBlocker(ctx, stage, cell, counter, points, event_type) {
    if (stage.blocker_hit.has(cell)) return;
    const state = ctx.state;
    const piece = state.cells[cell];
    stage.blocker_hit.add(cell);
    piece.layers -= 1;
    state.order[counter] += 1;
    if (event_type === 'cocoa') ctx.cocoa_cleared += 1;
    emit(ctx, { type: event_type, cell, piece_id: piece.id, layers: piece.layers, wave: stage.wave });
    if (piece.layers <= 0) state.cells[cell] = null;
    addScore(ctx, points, event_type, cell);
  }

  const JELLY = {
    id: 'jelly',
    symbols: { j: 'single jelly', J: 'double jelly' },
    parseCell(parsed, index, symbol) {
      parsed.jelly[index] = symbol === 'J' ? 2 : 1;
    },
    onCleared(ctx, stage, cell) {
      if (stage.jelly_hit.has(cell)) return;
      stage.jelly_hit.add(cell);
      const state = ctx.state;
      if (state.jelly[cell] === 0) return;
      state.jelly[cell] -= 1;
      emit(ctx, { type: 'jelly', cell, layers: state.jelly[cell], wave: stage.wave });
      addScore(ctx, SCORING.JELLY_LAYER, 'jelly', cell);
    },
    goalProgress(state, goal) {
      if (goal.type !== 'jelly') return null;
      let layers = 0;
      let cells = 0;
      for (let index = 0; index < state.jelly.length; index += 1) {
        layers += state.jelly[index];
        if (state.jelly[index] > 0) cells += 1;
      }
      return { type: 'jelly', target: state.jelly_total, current: state.jelly_total - layers, remaining_cells: cells, done: layers === 0 };
    },
  };

  const FROSTING = {
    id: 'frosting',
    symbols: { 1: 'frosting (1 layer)', 2: 'frosting (2 layers)', 3: 'frosting (3 layers)', 4: 'frosting (4 layers)', 5: 'frosting (5 layers)' },
    orderCounter: 'frosting',
    parseCell(parsed, index, symbol) {
      parsed.frosting[index] = Number(symbol);
    },
    populate(state, parsed, index) {
      if (parsed.frosting[index]) state.cells[index] = newPiece(state, KIND.FROSTING, -1, SPECIAL.NONE, parsed.frosting[index]);
    },
    absorbHit(ctx, stage, cell) {
      const piece = ctx.state.cells[cell];
      if (!piece || piece.kind !== KIND.FROSTING) return false;
      damageBlocker(ctx, stage, cell, 'frosting', SCORING.FROSTING_LAYER, 'frosting');
      return true;
    },
    onAdjacentMatch(ctx, stage, cell) {
      const piece = ctx.state.cells[cell];
      if (piece && piece.kind === KIND.FROSTING) damageBlocker(ctx, stage, cell, 'frosting', SCORING.FROSTING_LAYER, 'frosting');
    },
  };

  const CAGE = {
    id: 'cage',
    symbols: { k: 'Sugar Cage (a locked candy)' },
    orderCounter: 'cage',
    parseCell(parsed, index) {
      parsed.cage[index] = 1;
    },
    afterFill(state, parsed, index) {
      if (parsed.cage[index]) state.cage[index] = 1;
    },
    blocksSwap(state, cell) {
      return state.cage[cell] === 1;
    },
    blocksFall(state, cell) {
      return state.cage[cell] === 1;
    },
    absorbHit(ctx, stage, cell) {
      const state = ctx.state;
      if (!state.cage[cell]) return false;
      state.cage[cell] = 0;
      state.order.cage += 1;
      const piece = state.cells[cell];
      emit(ctx, { type: 'cage', cell, piece_id: piece ? piece.id : -1, wave: stage.wave });
      addScore(ctx, SCORING.CAGE, 'cage', cell);
      return true;
    },
  };

  const COCOA = {
    id: 'cocoa',
    symbols: { o: 'Cocoa Creep (spreads after a move that clears none)' },
    orderCounter: 'cocoa',
    parseCell(parsed, index) {
      parsed.cocoa[index] = 1;
    },
    populate(state, parsed, index) {
      if (parsed.cocoa[index]) state.cells[index] = newPiece(state, KIND.COCOA, -1, SPECIAL.NONE, 1);
    },
    absorbHit(ctx, stage, cell) {
      const piece = ctx.state.cells[cell];
      if (!piece || piece.kind !== KIND.COCOA) return false;
      damageBlocker(ctx, stage, cell, 'cocoa', SCORING.COCOA, 'cocoa');
      return true;
    },
    onAdjacentMatch(ctx, stage, cell) {
      const piece = ctx.state.cells[cell];
      if (piece && piece.kind === KIND.COCOA) damageBlocker(ctx, stage, cell, 'cocoa', SCORING.COCOA, 'cocoa');
    },
    /**
     * After a move in which no Cocoa was cleared, one Cocoa cell converts one adjacent regular candy (seeded choice).
     * It stops growing once it covers half of the board, so it can never smother every candy.
     */
    onMoveEnd(ctx) {
      const state = ctx.state;
      if (ctx.cocoa_cleared > 0) return;
      let cocoa_cells = 0;
      let active_cells = 0;
      state.cells.forEach((piece, cell) => {
        if (state.holes[cell]) return;
        active_cells += 1;
        if (piece && piece.kind === KIND.COCOA) cocoa_cells += 1;
      });
      if (cocoa_cells >= Math.floor(active_cells * COCOA_MAX_SHARE)) return;
      const options = [];
      state.cells.forEach((piece, cell) => {
        if (!piece || piece.kind !== KIND.COCOA) return;
        orthogonalNeighbors(state, cell).forEach((neighbor) => {
          const target = state.cells[neighbor];
          if (isRegularCandy(target) && !state.cage[neighbor] && !state.belt[neighbor] && target.fuse === undefined) options.push({ from: cell, to: neighbor });
        });
      });
      if (options.length === 0) return;
      const choice = options[Math.floor(rngNext(state) * options.length)];
      const old_piece = state.cells[choice.to];
      const cocoa_piece = newPiece(state, KIND.COCOA, -1, SPECIAL.NONE, 1);
      state.cells[choice.to] = cocoa_piece;
      beginPhase(ctx, 'cocoa', {});
      emit(ctx, { type: 'cocoa_spread', from: choice.from, cell: choice.to, old_piece_id: old_piece.id, piece: clonePiece(cocoa_piece) });
    },
  };

  const FUSE = {
    id: 'fuse',
    symbols: { b: 'Fuse Candy (countdown from meta.fuse)' },
    parseCell(parsed, index) {
      parsed.fuse[index] = 1;
    },
    validateLayout(level, parsed) {
      const has_fuse = parsed.fuse.some((value) => value);
      const countdown = level.meta && level.meta.fuse;
      if (has_fuse && !(Number.isInteger(countdown) && countdown >= 3 && countdown <= 40)) return ['Fuse Candy needs meta.fuse between 3 and 40'];
      return [];
    },
    afterFill(state, parsed, index) {
      if (parsed.fuse[index]) state.cells[index].fuse = state.fuse_start;
    },
    /** Every fuse drops by one after each move; a fuse that reaches zero loses the level. */
    onMoveEnd(ctx) {
      const state = ctx.state;
      const ticking = [];
      state.cells.forEach((piece, cell) => {
        if (piece && piece.fuse !== undefined) ticking.push(cell);
      });
      if (ticking.length === 0) return;
      beginPhase(ctx, 'fuse', {});
      ticking.forEach((cell) => {
        const piece = state.cells[cell];
        piece.fuse -= 1;
        emit(ctx, { type: 'fuse', cell, piece_id: piece.id, fuse: piece.fuse });
        if (piece.fuse <= 0 && state.status === 'playing') {
          state.status = 'lost';
          state.loss_reason = 'fuse';
          emit(ctx, { type: 'fuse_out', cell, piece_id: piece.id });
        }
      });
    },
  };

  const INGREDIENTS = {
    id: 'ingredients',
    symbols: { c: 'cherry (ingredient)', h: 'hazelnut (ingredient)', x: 'exit tray (ingredients resting here are collected)' },
    parseCell(parsed, index, symbol) {
      if (symbol === 'x') parsed.exits[index] = 1;
      else parsed.ingredients[index] = symbol === 'c' ? 1 : 2;
    },
    validateLayout(level, parsed) {
      const problems = [];
      const count = parsed.ingredients.reduce((sum, value) => sum + (value ? 1 : 0), 0);
      const exits = parsed.exits.reduce((sum, value) => sum + value, 0);
      if (count > 0 && exits === 0) problems.push('ingredients need at least one exit tray');
      (level.goals || []).forEach((goal) => {
        if (goal.type === 'ingredients' && goal.count > count) problems.push(`goal needs ${goal.count} ingredients but the board has ${count}`);
      });
      return problems;
    },
    populate(state, parsed, index) {
      if (!parsed.ingredients[index]) return;
      state.cells[index] = newPiece(state, parsed.ingredients[index] === 1 ? KIND.CHERRY : KIND.HAZELNUT, -1, SPECIAL.NONE, 0);
      state.ingredients_total += 1;
    },
    absorbHit(ctx, stage, cell) {
      return isIngredient(ctx.state.cells[cell]); // ingredients are never destroyed
    },
    goalProgress(state, goal) {
      if (goal.type !== 'ingredients') return null;
      return { type: 'ingredients', target: goal.count, current: Math.min(state.ingredients_collected, goal.count), done: state.ingredients_collected >= goal.count };
    },
  };

  const PORTALS = {
    id: 'portals',
    symbols: { p: 'portal entrance (pairs in meta.portals)', P: 'portal exit (pairs in meta.portals)' },
    parseCell(parsed, index, symbol) {
      parsed.portal_marks[index] = symbol === 'p' ? 1 : 2;
    },
    validateLayout(level, parsed) {
      const problems = [];
      const pairs = (level.meta && level.meta.portals) || [];
      const marked = parsed.portal_marks.reduce((sum, value) => sum + (value ? 1 : 0), 0);
      if (marked !== pairs.length * 2) problems.push(`portal marks (${marked}) must match meta.portals pairs (${pairs.length})`);
      pairs.forEach((pair, pair_index) => {
        const entrance = pair.in[0] * parsed.cols + pair.in[1];
        const exit = pair.out[0] * parsed.cols + pair.out[1];
        if (parsed.portal_marks[entrance] !== 1) problems.push(`portal ${pair_index}: entrance ${pair.in} is not marked 'p'`);
        if (parsed.portal_marks[exit] !== 2) problems.push(`portal ${pair_index}: exit ${pair.out} is not marked 'P'`);
        if (pair.out[0] <= pair.in[0]) problems.push(`portal ${pair_index}: the exit must be on a lower row than the entrance`);
      });
      return problems;
    },
    populate(state, parsed) {
      if (state.portals_linked) return;
      state.portals_linked = true;
      parsed.portals.forEach((pair) => {
        state.portal_to[pair.entrance] = pair.exit;
        state.portal_from[pair.exit] = pair.entrance;
      });
    },
    /** A piece in an entrance that cannot fall straight down drops out of the paired exit. */
    fallTarget(state, cell) {
      return state.portal_to[cell];
    },
    spawnsAt(state, cell) {
      return state.portal_from[cell] < 0;
    },
  };

  const BELT = {
    id: 'belt',
    symbols: { '>': 'Sugar Belt moving right', '<': 'Sugar Belt moving left', '^': 'Sugar Belt moving up', v: 'Sugar Belt moving down' },
    parseCell(parsed, index, symbol) {
      parsed.belt[index] = BELT_DIRECTIONS[symbol];
    },
    validateLayout(level, parsed) {
      return parsed.belts.filter((belt) => belt.cells.length < 2).map((belt) => `Sugar Belt at cell ${belt.cells[0]} must be at least 2 cells long`);
    },
    /** Pieces on every belt shift one cell in the arrow direction (wrapping from the last cell to the first). */
    onMoveEnd(ctx) {
      const state = ctx.state;
      if (state.belts.length === 0) return;
      const moves = [];
      state.belts.forEach((belt) => {
        const pieces = belt.cells.map((cell) => state.cells[cell]);
        belt.cells.forEach((cell, position) => {
          const source_position = (position - 1 + pieces.length) % pieces.length;
          const piece = pieces[source_position];
          state.cells[cell] = piece;
          if (piece) moves.push({ piece_id: piece.id, from: belt.cells[source_position], to: cell });
        });
      });
      beginPhase(ctx, 'belt', {});
      emit(ctx, { type: 'belt', moves });
      ctx.resolve();
    },
  };

  /** Registry order matters for onMoveEnd: belts shift first, then fuses tick, then cocoa spreads. */
  const MECHANICS = [JELLY, FROSTING, CAGE, COCOA, INGREDIENTS, PORTALS, BELT, FUSE];
  const MECHANIC_BY_SYMBOL = {};
  MECHANICS.forEach((mechanic) => Object.keys(mechanic.symbols).forEach((symbol) => {
    MECHANIC_BY_SYMBOL[symbol] = mechanic;
  }));
  const MOVE_END_ORDER = [BELT, FUSE, COCOA];

  const LAYOUT_LEGEND = Object.freeze(Object.assign({ '.': 'normal cell', '#': 'hole' }, ...MECHANICS.map((mechanic) => mechanic.symbols)));

  const HOOKS = {};
  ['validateLayout', 'populate', 'afterFill', 'blocksSwap', 'blocksFall', 'absorbHit', 'onCleared', 'onAdjacentMatch', 'fallTarget', 'spawnsAt', 'goalProgress'].forEach((hook) => {
    HOOKS[hook] = MECHANICS.filter((mechanic) => typeof mechanic[hook] === 'function');
  });

  // ------------------------------------------------------------------ layout parsing

  /** Belts: maximal runs of the same arrow in a row (> <) or a column (^ v); cells listed in travel order. */
  function collectBelts(parsed) {
    const belts = [];
    const used = new Uint8Array(parsed.rows * parsed.cols);
    for (let index = 0; index < used.length; index += 1) {
      const direction = parsed.belt[index];
      if (!direction || used[index]) continue;
      const horizontal = direction === 1 || direction === 2;
      let cursor_row = Math.floor(index / parsed.cols);
      let cursor_col = index % parsed.cols;
      const cells = [];
      while (cursor_row < parsed.rows && cursor_col < parsed.cols && parsed.belt[cursor_row * parsed.cols + cursor_col] === direction) {
        cells.push(cursor_row * parsed.cols + cursor_col);
        used[cursor_row * parsed.cols + cursor_col] = 1;
        if (horizontal) cursor_col += 1;
        else cursor_row += 1;
      }
      if (direction === 2 || direction === 3) cells.reverse(); // left- and up-moving belts travel against reading order
      belts.push({ direction, cells });
    }
    return belts;
  }

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
      cage: new Uint8Array(cell_count),
      cocoa: new Uint8Array(cell_count),
      fuse: new Uint8Array(cell_count),
      ingredients: new Uint8Array(cell_count),
      exits: new Uint8Array(cell_count),
      portal_marks: new Uint8Array(cell_count),
      belt: new Uint8Array(cell_count),
      portals: [],
      belts: [],
    };
    level.layout.forEach((row_text, row) => {
      if (typeof row_text !== 'string' || row_text.length !== cols) {
        throw new Error(`Level ${level.id}: layout row ${row} must have ${cols} characters`);
      }
      for (let col = 0; col < cols; col += 1) {
        const symbol = row_text[col];
        const index = row * cols + col;
        if (symbol === '.') continue;
        if (symbol === '#') {
          parsed.holes[index] = 1;
          continue;
        }
        const mechanic = MECHANIC_BY_SYMBOL[symbol];
        if (!mechanic) throw new Error(`Level ${level.id}: unknown layout symbol '${symbol}' at ${row},${col}`);
        mechanic.parseCell(parsed, index, symbol);
      }
    });
    ((level.meta && level.meta.portals) || []).forEach((pair) => {
      parsed.portals.push({ entrance: pair.in[0] * cols + pair.in[1], exit: pair.out[0] * cols + pair.out[1] });
    });
    parsed.belts = collectBelts(parsed);
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
    if (!piece) return null;
    const copy = { id: piece.id, kind: piece.kind, color: piece.color, special: piece.special, layers: piece.layers };
    if (piece.fuse !== undefined) copy.fuse = piece.fuse;
    return copy;
  }

  function cloneState(state) {
    const copy = Object.assign({}, state);
    copy.cells = state.cells.map(clonePiece);
    copy.jelly = Uint8Array.from(state.jelly);
    copy.cage = Uint8Array.from(state.cage);
    copy.collected = state.collected.slice();
    copy.order = Object.assign({}, state.order);
    return copy;
  }

  function buildEmptyState(level, layout, palette, seed) {
    const cell_count = layout.rows * layout.cols;
    const timed = Number.isFinite(level.time) && level.time > 0;
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
      cage: new Uint8Array(cell_count),
      exits: layout.exits,
      belt: layout.belt,
      belts: layout.belts,
      portal_to: new Int16Array(cell_count).fill(-1),
      portal_from: new Int16Array(cell_count).fill(-1),
      portals_linked: false,
      spawn_cells: [],
      goals: level.goals,
      stars: level.stars,
      timed,
      time_limit: timed ? level.time : 0,
      time_bonus: 0,
      fuse_start: (level.meta && level.meta.fuse) || 0,
      score: 0,
      moves_left: timed ? Infinity : level.moves,
      moves_made: 0,
      collected: new Array(MAX_COLORS).fill(0),
      order: { striped: 0, wrapped: 0, bomb: 0, frosting: 0, cocoa: 0, cage: 0 },
      ingredients_collected: 0,
      ingredients_total: 0,
      jelly_total: 0,
      status: 'playing',
      loss_reason: null,
    };
    for (let index = 0; index < cell_count; index += 1) {
      HOOKS.populate.forEach((mechanic) => mechanic.populate(state, layout, index));
      state.jelly_total += layout.jelly[index];
    }
    // The topmost non-hole cell of each column spawns new candies, unless a mechanic feeds it (portal exits).
    for (let col = 0; col < layout.cols; col += 1) {
      let spawn_cell = -1;
      for (let row = 0; row < layout.rows; row += 1) {
        const index = row * layout.cols + col;
        if (!layout.holes[index]) {
          spawn_cell = HOOKS.spawnsAt.every((mechanic) => mechanic.spawnsAt(state, index)) ? index : -1;
          break;
        }
      }
      state.spawn_cells.push(spawn_cell);
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

  /** A piece that gravity may move: candies and ingredients, unless a mechanic holds it (cages). */
  function canMoveAt(state, cell) {
    const piece = state.cells[cell];
    if (!piece || !(piece.kind === KIND.CANDY || isIngredient(piece))) return false;
    for (let index = 0; index < HOOKS.blocksFall.length; index += 1) if (HOOKS.blocksFall[index].blocksFall(state, cell)) return false;
    return true;
  }

  /** A candy the player may swap: not an armed wrapped candy and not held by a mechanic (cages). */
  function isSwappableAt(state, cell) {
    const piece = state.cells[cell];
    if (!piece || piece.kind !== KIND.CANDY || piece.special === SPECIAL.WRAPPED_ARMED || piece.special === SPECIAL.WRAPPED_BIG_ARMED) return false;
    for (let index = 0; index < HOOKS.blocksSwap.length; index += 1) if (HOOKS.blocksSwap[index].blocksSwap(state, cell)) return false;
    return true;
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

  /**
   * Fills the board: preset candies first (meta.preset rows, digits 0-5 = candy color, '.' = random), then seeded random
   * candies that never complete a line of three, then pre-placed specials (meta.specials) and mechanic decorations.
   */
  function fillInitialBoard(state, layout, level) {
    const meta = (level && level.meta) || {};
    (meta.preset || []).forEach((row_text, row) => {
      for (let col = 0; col < state.cols; col += 1) {
        const symbol = row_text[col];
        const index = row * state.cols + col;
        if (symbol >= '0' && symbol <= '5' && !state.holes[index] && !state.cells[index]) {
          state.cells[index] = newPiece(state, KIND.CANDY, Number(symbol), SPECIAL.NONE, 0);
        }
      }
    });
    for (let index = 0; index < state.cells.length; index += 1) {
      if (state.holes[index] || state.cells[index]) continue;
      const forbidden = colorsForbiddenAt(state, index);
      const candidates = state.palette.filter((color) => forbidden.indexOf(color) < 0);
      const color = candidates[Math.floor(rngNext(state) * candidates.length)];
      state.cells[index] = newPiece(state, KIND.CANDY, color, SPECIAL.NONE, 0);
    }
    (meta.specials || []).forEach((placement) => {
      const piece = state.cells[placement.at[0] * state.cols + placement.at[1]];
      if (!piece || piece.kind !== KIND.CANDY) return;
      piece.special = placement.special;
      if (placement.special === SPECIAL.BOMB) piece.color = -1;
      else if (Number.isInteger(placement.color)) piece.color = placement.color;
    });
    for (let index = 0; index < state.cells.length; index += 1) {
      HOOKS.afterFill.forEach((mechanic) => mechanic.afterFill(state, layout, index));
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
      fillInitialBoard(state, layout, level);
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

  function scanRun(state, row, col, direction) {
    const cols = state.cols;
    const color = matchColorAt(state, row * cols + col);
    if (color < 0) return null;
    if (direction === 'h') {
      let left = col;
      while (left > 0 && matchColorAt(state, row * cols + left - 1) === color) left -= 1;
      let right = col;
      while (right < cols - 1 && matchColorAt(state, row * cols + right + 1) === color) right += 1;
      if (right - left + 1 < 3) return null;
      const cells = [];
      for (let run_col = left; run_col <= right; run_col += 1) cells.push(row * cols + run_col);
      return { direction: 'h', color, cells, key: `h${row}:${left}` };
    }
    let top = row;
    while (top > 0 && matchColorAt(state, (top - 1) * cols + col) === color) top -= 1;
    let bottom = row;
    while (bottom < state.rows - 1 && matchColorAt(state, (bottom + 1) * cols + col) === color) bottom += 1;
    if (bottom - top + 1 < 3) return null;
    const cells = [];
    for (let run_row = top; run_row <= bottom; run_row += 1) cells.push(run_row * cols + col);
    return { direction: 'v', color, cells, key: `v${col}:${top}` };
  }

  /**
   * Finds every horizontal and vertical run of 3+ same-colored matchable candies and merges runs that share
   * cells into groups (L, T and + shapes). Holes, blockers, ingredients, bombs and empty cells break runs.
   */
  function findMatchGroups(state) {
    // Each run is read once, from its first cell (leftmost / topmost), in the same order a full scan would find it.
    const runs = [];
    const rows = state.rows;
    const cols = state.cols;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        const color = matchColorAt(state, index);
        if (color < 0) continue;
        if (col === 0 || matchColorAt(state, index - 1) !== color) {
          let right = col;
          while (right < cols - 1 && matchColorAt(state, index + (right - col) + 1) === color) right += 1;
          if (right - col + 1 >= 3) {
            const cells = [];
            for (let run_col = col; run_col <= right; run_col += 1) cells.push(row * cols + run_col);
            runs.push({ direction: 'h', color, cells, key: `h${row}:${col}` });
          }
        }
        if (row === 0 || matchColorAt(state, index - cols) !== color) {
          let bottom = row;
          while (bottom < rows - 1 && matchColorAt(state, (bottom + 1) * cols + col) === color) bottom += 1;
          if (bottom - row + 1 >= 3) {
            const cells = [];
            for (let run_row = row; run_row <= bottom; run_row += 1) cells.push(run_row * cols + col);
            runs.push({ direction: 'v', color, cells, key: `v${col}:${row}` });
          }
        }
      }
    }
    return groupRuns(runs);
  }

  /** Merges runs that share cells into groups (L, T and + shapes) sorted by their first cell. */
  function groupRuns(runs) {
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
      group.runs.push({ direction: run.direction, color: run.color, cells: run.cells });
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

  /**
   * Match groups through specific cells only. On a board that was stable before a swap, every new match passes through
   * a swapped cell, so this equals findMatchGroups() at a fraction of the cost (used to evaluate candidate moves).
   */
  function findMatchGroupsAt(state, focus_cells) {
    const runs = [];
    const seen = new Set();
    const addRun = (run) => {
      if (run && !seen.has(run.key)) {
        seen.add(run.key);
        runs.push(run);
      }
    };
    focus_cells.forEach((cell) => {
      const row = rowOf(state, cell);
      const col = colOf(state, cell);
      ['h', 'v'].forEach((direction) => {
        const run = scanRun(state, row, col, direction);
        if (!run) return;
        addRun(run);
        // A run through the focus cell can cross a perpendicular run that does not pass through it (L/T shapes).
        run.cells.forEach((crossing_cell) => addRun(scanRun(state, rowOf(state, crossing_cell), colOf(state, crossing_cell), direction === 'h' ? 'v' : 'h')));
      });
    });
    return groupRuns(runs);
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
    return !!(scanRun(state, rowOf(state, index), colOf(state, index), 'h') || scanRun(state, rowOf(state, index), colOf(state, index), 'v'));
  }

  // ------------------------------------------------------------------ move validity

  function isValidSwap(state, from_cell, to_cell) {
    if (!Number.isInteger(from_cell) || !Number.isInteger(to_cell)) return false;
    if (from_cell < 0 || to_cell < 0 || from_cell >= state.cells.length || to_cell >= state.cells.length) return false;
    if (state.holes[from_cell] || state.holes[to_cell] || !areAdjacent(state, from_cell, to_cell)) return false;
    if (!isSwappableAt(state, from_cell) || !isSwappableAt(state, to_cell)) return false;
    const from_piece = state.cells[from_cell];
    const to_piece = state.cells[to_cell];
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
      if (colOf(state, index) + 1 < state.cols && isValidSwap(state, index, index + 1)) moves.push({ from: index, to: index + 1 });
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

  const ORDER_ITEMS = Object.freeze(['striped', 'wrapped', 'bomb', 'frosting', 'cocoa', 'cage']);

  function goalProgress(state) {
    return state.goals.map((goal) => {
      if (goal.type === 'score') return { type: 'score', target: goal.target, current: Math.min(state.score, goal.target), done: state.score >= goal.target };
      if (goal.type === 'collect') {
        const current = state.collected[goal.color];
        return { type: 'collect', color: goal.color, target: goal.count, current: Math.min(current, goal.count), done: current >= goal.count };
      }
      if (goal.type === 'order') {
        const current = state.order[goal.item];
        return { type: 'order', item: goal.item, target: goal.count, current: Math.min(current, goal.count), done: current >= goal.count };
      }
      for (let index = 0; index < HOOKS.goalProgress.length; index += 1) {
        const progress = HOOKS.goalProgress[index].goalProgress(state, goal);
        if (progress) return progress;
      }
      throw new Error(`Unknown goal type ${goal.type}`);
    });
  }

  function goalsMet(state) {
    return goalProgress(state).every((progress) => progress.done);
  }

  /**
   * Fraction (0..1) of every goal completed, summed. Score goals are left out unless `include_score`: every move scores,
   * so for the hint they would drown the real objectives (specials and match size already reward score).
   */
  function goalCompletion(state, include_score) {
    return goalProgress(state).reduce((sum, progress) => {
      if (progress.type === 'score' && !include_score) return sum;
      return sum + (progress.target > 0 ? progress.current / progress.target : progress.done ? 1 : 0);
    }, 0);
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
    const ctx = {
      state,
      events: [],
      phase: 0,
      cascade_depth: 0,
      cocoa_cleared: 0,
      stats: { cascades: 0, specials_created: { stripe: 0, wrapped: 0, bomb: 0 }, combos: [], activations: 0, candies_cleared: 0, shuffles: 0, largest_match: 0 },
    };
    ctx.resolve = () => resolveBoard(ctx);
    return ctx;
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
    return { hit: new Set(), blocker_hit: new Set(), jelly_hit: new Set(), next_wave: [], wave: 0, multiplier: cascadeMultiplier(Math.max(1, ctx.cascade_depth)) };
  }

  /** Order-goal counters for specials that fire (first activation only). */
  function countSpecialUse(state, special) {
    if (special === SPECIAL.STRIPE_ROW || special === SPECIAL.STRIPE_COL) state.order.striped += 1;
    else if (special === SPECIAL.WRAPPED) state.order.wrapped += 1;
    else if (special === SPECIAL.BOMB) state.order.bomb += 1;
  }

  function removePiece(ctx, stage, cell, cause) {
    const state = ctx.state;
    const piece = state.cells[cell];
    state.cells[cell] = null;
    if (piece.kind === KIND.CANDY && piece.color >= 0) state.collected[piece.color] += 1;
    ctx.stats.candies_cleared += 1;
    emit(ctx, { type: 'clear', cell, piece_id: piece.id, color: piece.color, special: piece.special, cause, wave: stage.wave });
  }

  function notifyCleared(ctx, stage, cell) {
    HOOKS.onCleared.forEach((mechanic) => mechanic.onCleared(ctx, stage, cell));
  }

  /** Hits a cell once per stage. Returns 1 if a regular candy was cleared by a blast (for activation scoring). */
  function hitCell(ctx, stage, cell, cause) {
    if (stage.hit.has(cell)) return 0;
    stage.hit.add(cell);
    if (!ctx.state.cells[cell] && !ctx.state.cage[cell]) return 0;
    for (let index = 0; index < HOOKS.absorbHit.length; index += 1) {
      if (HOOKS.absorbHit[index].absorbHit(ctx, stage, cell, cause)) return 0;
    }
    const piece = ctx.state.cells[cell];
    if (!piece) return 0;
    notifyCleared(ctx, stage, cell);
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
    if (is_first_activation) countSpecialUse(state, special);
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
      if (state.timed) {
        state.time_bonus += SCORING.TIME_BONUS_PER_SPECIAL;
        emit(ctx, { type: 'time_bonus', seconds: SCORING.TIME_BONUS_PER_SPECIAL, cell, total: state.time_bonus });
      }
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
      ctx.stats.largest_match = Math.max(ctx.stats.largest_match, group.cells.length);
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
          HOOKS.onAdjacentMatch.forEach((mechanic) => mechanic.onAdjacentMatch(ctx, stage, neighbor));
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
      notifyCleared(ctx, stage, cell);
    });
    let cleared_count = 0;
    const hitArea = (area) => area.forEach((cell) => {
      cleared_count += hitCell(ctx, stage, cell, 'blast');
    });
    const removeSpecial = (cell) => {
      countSpecialUse(state, state.cells[cell].special);
      removePiece(ctx, stage, cell, 'combo');
    };

    if (combo === 'bomb_bomb') {
      removeSpecial(from_cell);
      removeSpecial(to_cell);
      const area = allActiveCells(state);
      emit(ctx, { type: 'activate', cell: center, special: SPECIAL.BOMB, kind: 'board', area, wave: 0 });
      hitArea(area);
    } else if (combo === 'bomb_stripe' || combo === 'bomb_wrapped') {
      const bomb_cell = moved_piece.special === SPECIAL.BOMB ? to_cell : from_cell;
      const partner_cell = bomb_cell === to_cell ? from_cell : to_cell;
      const partner_piece = state.cells[partner_cell];
      const target_color = partner_piece.color;
      removeSpecial(bomb_cell);
      const targets = cellsWithColor(state, target_color).filter((cell) => !state.cage[cell]);
      emit(ctx, { type: 'activate', cell: bomb_cell, special: SPECIAL.BOMB, kind: combo === 'bomb_stripe' ? 'bomb_to_stripes' : 'bomb_to_wrapped', target_color, area: targets, wave: 0 });
      targets.forEach((cell) => {
        const piece = state.cells[cell];
        if (piece.special === SPECIAL.NONE) {
          piece.special = combo === 'bomb_wrapped' ? SPECIAL.WRAPPED : (rngNext(state) < 0.5 ? SPECIAL.STRIPE_ROW : SPECIAL.STRIPE_COL);
          emit(ctx, { type: 'transform', cell, piece_id: piece.id, special: piece.special, color: piece.color, wave: 0 });
        }
        if (!stage.hit.has(cell)) {
          stage.hit.add(cell);
          notifyCleared(ctx, stage, cell);
        }
        stage.next_wave.push({ cell, piece_id: piece.id, cause: 'combo' });
      });
    } else if (combo === 'stripe_stripe' || combo === 'wrapped_stripe') {
      removeSpecial(from_cell);
      removeSpecial(to_cell);
      const area = combo === 'stripe_stripe' ? bandCells(state, center, 0) : bandCells(state, center, 1);
      emit(ctx, { type: 'activate', cell: center, special: SPECIAL.STRIPE_ROW, kind: combo === 'stripe_stripe' ? 'cross' : 'big_cross', area, wave: 0 });
      hitArea(area);
    } else if (combo === 'wrapped_wrapped') {
      removeSpecial(from_cell);
      countSpecialUse(state, SPECIAL.WRAPPED);
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
    notifyCleared(ctx, stage, bomb_cell);
    const bomb_piece = state.cells[bomb_cell];
    countSpecialUse(state, SPECIAL.BOMB);
    emit(ctx, { type: 'activate', cell: bomb_cell, piece_id: bomb_piece.id, special: SPECIAL.BOMB, kind: 'bomb', target_color, area: cellsWithColor(state, target_color), wave: 0 });
    removePiece(ctx, stage, bomb_cell, 'activate');
    let cleared_count = 0;
    cellsWithColor(state, target_color).forEach((cell) => {
      cleared_count += hitCell(ctx, stage, cell, 'blast');
    });
    addScore(ctx, (SCORING.ACTIVATION_PER_SPECIAL + SCORING.ACTIVATION_PER_CANDY * cleared_count) * stage.multiplier, 'activation', bomb_cell);
    runWaves(ctx, stage);
  }

  /** Second blast of armed wrapped candies once the board has settled (also used by the Sweet Finale and the hammer). */
  function runDetonationStage(ctx, armed_cells, source) {
    const state = ctx.state;
    const stage = createStage(ctx);
    beginPhase(ctx, 'clear', { depth: ctx.cascade_depth, multiplier: stage.multiplier, source: source || 'detonation' });
    armed_cells.forEach((cell) => {
      stage.hit.add(cell);
      notifyCleared(ctx, stage, cell);
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

  /** True when nothing can drop into `cell` from straight above (a hole, a blocker, a caged candy or the board edge). */
  function isSealedAbove(state, cell) {
    if (cell < 0) return true;
    if (state.holes[cell]) return true;
    const piece = state.cells[cell];
    return !!piece && !canMoveAt(state, cell);
  }

  /**
   * Gravity rule (deterministic, simulated in steps where every piece moves at most one cell):
   *  1. Vertical: candies and ingredients fall straight down into empty cells (bottom-up, so whole columns move together).
   *     A piece in a portal entrance that cannot fall (a hole or the board edge below) drops out of the paired exit.
   *  2. Spawn: the topmost non-hole cell of each column spawns a new seeded-random candy when empty (not portal exits).
   *  3. Exits: an ingredient resting on an exit tray cell is collected.
   *  4. Diagonal: only when nothing can fall or spawn, each empty cell sealed from above (hole, blocker, cage) takes a piece
   *     sliding diagonally from the upper-left (preferred) or upper-right neighbor. Scan: bottom row first, left to right.
   * Repeats until nothing moves. Portal exits are always lower than their entrances, so pieces only ever move downward
   * overall and it always terminates.
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
    // Points reached through a portal carry a 4th element (1) so the renderer fades the piece across instead of sliding.
    const recordMove = (track, step, row, col, through_portal) => {
      const last_point = track.path[track.path.length - 1];
      if (last_point[0] < step) track.path.push([step, last_point[1], last_point[2]]);
      track.path.push(through_portal ? [step + 1, row, col, 1] : [step + 1, row, col]);
    };
    let step = 0;
    let guard = 0;
    while (true) {
      guard += 1;
      if (guard > SETTLE_STEP_CAP) throw new Error('Gravity did not settle');
      let moved = false;
      for (let row = rows - 1; row >= 0; row -= 1) {
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          if (!canMoveAt(state, index)) continue;
          const piece = cells[index];
          const below = row + 1 < rows ? index + cols : -1;
          if (below >= 0 && !state.holes[below]) {
            if (cells[below] !== null) continue;
            const track = trackPiece(piece, step, index, false);
            cells[below] = piece;
            cells[index] = null;
            recordMove(track, step, row + 1, col, false);
            moved = true;
            continue;
          }
          const portal_exit = state.portal_to[index];
          if (portal_exit >= 0 && cells[portal_exit] === null) {
            const track = trackPiece(piece, step, index, false);
            cells[portal_exit] = piece;
            cells[index] = null;
            recordMove(track, step, rowOf(state, portal_exit), colOf(state, portal_exit), true);
            moved = true;
          }
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
        if (!state.exits[index] || !isIngredient(piece)) continue;
        const below = index + cols;
        const can_fall = below < cells.length && !state.holes[below] && cells[below] === null;
        if (can_fall) continue;
        const track = trackPiece(piece, step, index, false);
        track.collected = true;
        cells[index] = null;
        state.ingredients_collected += 1;
        collected_events.push({ piece_id: piece.id, kind: piece.kind, cell: index, step: step + 1 });
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
          if (state.holes[index] || cells[index] !== null || used_cells.has(index) || state.portal_from[index] >= 0) continue;
          if (!isSealedAbove(state, index - cols)) continue;
          for (const col_offset of [-1, 1]) {
            const source_col = col + col_offset;
            if (source_col < 0 || source_col >= cols) continue;
            const source = (row - 1) * cols + source_col;
            if (state.holes[source] || used_cells.has(source) || !canMoveAt(state, source)) continue;
            const piece = cells[source];
            const track = trackPiece(piece, step, source, false);
            cells[index] = piece;
            cells[source] = null;
            used_cells.add(source);
            used_cells.add(index);
            recordMove(track, step, row, col, false);
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
      emit(ctx, { type: 'collect', piece_id: collected.piece_id, kind: collected.kind, cell: collected.cell, step: collected.step });
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

  /** Regular candies that may be shuffled (specials, blockers, ingredients, caged candies and jelly stay put). */
  function shufflableCells(state) {
    const found = [];
    state.cells.forEach((piece, index) => {
      if (isRegularCandy(piece) && !state.cage[index]) found.push(index);
    });
    return found;
  }

  /**
   * Reshuffles regular candies until there are no matches and at least one valid move: up to 50 permutations, then up
   * to 50 recolorings, then (only for pathological boards) one regular candy next to another swappable candy becomes a
   * color bomb, which is always a valid move.
   */
  function shuffleBoard(ctx, reason) {
    const state = ctx.state;
    const shuffle_cells = shufflableCells(state);
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
      const has_swappable_neighbor = orthogonalNeighbors(state, cell).some((neighbor) => isSwappableAt(state, neighbor));
      if (has_swappable_neighbor) {
        const piece = state.cells[cell];
        piece.special = SPECIAL.BOMB;
        piece.color = -1;
        delete piece.fuse;
        emit(ctx, { type: 'transform', cell, piece_id: piece.id, special: SPECIAL.BOMB, color: -1 });
        if (findMatchGroups(state).length === 0 && hasValidMove(state)) return;
      }
    }
  }

  // ------------------------------------------------------------------ public move API

  /** After a player move: unless the goals are already met, belts shift, fuses tick and cocoa spreads, then win/lose. */
  function finishMove(ctx, options) {
    const state = ctx.state;
    const run_move_end = !(options && options.skip_move_end);
    if (run_move_end) {
      for (const mechanic of MOVE_END_ORDER) {
        if (goalsMet(state) || state.status !== 'playing') break;
        mechanic.onMoveEnd(ctx);
      }
    }
    if (goalsMet(state)) {
      state.status = 'won';
      state.loss_reason = null;
    } else if (state.status === 'playing' && !state.timed && state.moves_left <= 0) {
      state.status = 'lost';
      state.loss_reason = 'moves';
    }
    if (state.status === 'playing' && !hasValidMove(state)) {
      shuffleBoard(ctx, 'no_moves');
      // Only a board with almost nothing left to swap (blockers everywhere) gets here: the level ends instead of hanging.
      if (!hasValidMove(state)) {
        state.status = 'lost';
        state.loss_reason = 'no_moves';
      }
    }
    emit(ctx, { type: 'end', status: state.status, score: state.score, moves_left: state.moves_left, reason: state.loss_reason });
  }

  function runSwapStages(ctx, from_cell, to_cell) {
    const state = ctx.state;
    const moved_piece = state.cells[to_cell];
    const other_piece = state.cells[from_cell];
    if (isActivatable(moved_piece) && isActivatable(other_piece)) {
      runComboStage(ctx, from_cell, to_cell);
    } else if (moved_piece.special === SPECIAL.BOMB) {
      runBombSwapStage(ctx, to_cell, from_cell);
    } else if (other_piece.special === SPECIAL.BOMB) {
      runBombSwapStage(ctx, from_cell, to_cell);
    } else {
      const groups = findMatchGroups(state);
      if (groups.length > 0) runMatchStage(ctx, groups, [to_cell, from_cell]);
    }
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
    if (!state.timed) state.moves_left -= 1;
    state.moves_made += 1;
    emit(ctx, { type: 'swap', from: from_cell, to: to_cell, from_piece_id: from_piece.id, to_piece_id: to_piece.id, moves_left: state.moves_left });
    ctx.cascade_depth = 1;
    emit(ctx, { type: 'cascade', depth: 1, multiplier: 1 });
    runSwapStages(ctx, from_cell, to_cell);
    resolveBoard(ctx);
    finishMove(ctx);
    return { valid: true, state, events: ctx.events, stats: ctx.stats };
  }

  /**
   * Sweet Finale after a win: each remaining move (or, in timed levels, each remaining second up to a cap) turns a
   * random regular candy into a striped candy that fires immediately (+300 each plus normal clear points), one by one,
   * with cascades resolved after each.
   */
  function applyEndBonus(state_in, options) {
    const state = cloneState(state_in);
    const ctx = createContext(state);
    const strikes = state.timed
      ? Math.min(SCORING.FINALE_MAX_STRIKES_TIMED, Math.max(0, Math.floor((options && options.seconds_left) || 0)))
      : Math.max(0, state.moves_left);
    for (let strike = 0; strike < strikes; strike += 1) {
      if (!state.timed) state.moves_left -= 1;
      beginPhase(ctx, 'bonus', { moves_left: state.timed ? strikes - strike - 1 : state.moves_left });
      ctx.cascade_depth = 1;
      addScore(ctx, SCORING.END_BONUS_PER_MOVE, 'bonus', -1);
      const candidates = [];
      state.cells.forEach((piece, index) => {
        if (isRegularCandy(piece) && !state.cage[index]) candidates.push(index);
      });
      if (candidates.length === 0) continue;
      const cell = candidates[Math.floor(rngNext(state) * candidates.length)];
      const piece = state.cells[cell];
      piece.special = rngNext(state) < 0.5 ? SPECIAL.STRIPE_ROW : SPECIAL.STRIPE_COL;
      emit(ctx, { type: 'transform', cell, piece_id: piece.id, special: piece.special, color: piece.color, bonus: true });
      runDetonationStage(ctx, [cell], 'bonus');
      resolveBoard(ctx);
    }
    if (!state.timed) state.moves_left = 0;
    emit(ctx, { type: 'end', status: state.status, score: state.score, moves_left: 0, bonus_moves: strikes });
    return { state, events: ctx.events, stats: ctx.stats };
  }

  /** Timed levels: the clock ran out while the board was at rest. */
  function expireTime(state_in) {
    if (state_in.status !== 'playing') return state_in;
    const state = cloneState(state_in);
    if (goalsMet(state)) state.status = 'won';
    else {
      state.status = 'lost';
      state.loss_reason = 'time';
    }
    return state;
  }

  // ------------------------------------------------------------------ boosters (no move is spent)

  function finishBoosterMove(ctx) {
    resolveBoard(ctx);
    finishMove(ctx, { skip_move_end: true });
  }

  /** Sweet Hammer: removes one candy (a special fires), takes one layer off a blocker, or breaks a cage. */
  function applyHammer(state_in, cell) {
    const target = state_in.cells[cell];
    const usable = state_in.status === 'playing' && Number.isInteger(cell) && cell >= 0 && cell < state_in.cells.length &&
      !state_in.holes[cell] && !!target && !isIngredient(target);
    if (!usable) return { valid: false, state: state_in, events: [], stats: null };
    const state = cloneState(state_in);
    const ctx = createContext(state);
    ctx.cascade_depth = 1;
    const stage = createStage(ctx);
    beginPhase(ctx, 'clear', { depth: 1, multiplier: 1, source: 'hammer' });
    emit(ctx, { type: 'booster', booster: 'hammer', cell });
    hitCell(ctx, stage, cell, 'hammer');
    runWaves(ctx, stage);
    finishBoosterMove(ctx);
    return { valid: true, state, events: ctx.events, stats: ctx.stats };
  }

  /** Free Swap: swaps any two adjacent candies (no match needed) without spending a move; matches it makes resolve. */
  function applyFreeSwap(state_in, from_cell, to_cell) {
    const usable = state_in.status === 'playing' && Number.isInteger(from_cell) && Number.isInteger(to_cell) &&
      from_cell >= 0 && to_cell >= 0 && from_cell < state_in.cells.length && to_cell < state_in.cells.length &&
      areAdjacent(state_in, from_cell, to_cell) && isSwappableAt(state_in, from_cell) && isSwappableAt(state_in, to_cell);
    if (!usable) return { valid: false, state: state_in, events: [], stats: null };
    const state = cloneState(state_in);
    const ctx = createContext(state);
    beginPhase(ctx, 'swap', { booster: 'free_swap' });
    const from_piece = state.cells[from_cell];
    const to_piece = state.cells[to_cell];
    state.cells[from_cell] = to_piece;
    state.cells[to_cell] = from_piece;
    emit(ctx, { type: 'swap', from: from_cell, to: to_cell, from_piece_id: from_piece.id, to_piece_id: to_piece.id, moves_left: state.moves_left, booster: 'free_swap' });
    ctx.cascade_depth = 1;
    emit(ctx, { type: 'cascade', depth: 1, multiplier: 1 });
    runSwapStages(ctx, from_cell, to_cell);
    finishBoosterMove(ctx);
    return { valid: true, state, events: ctx.events, stats: ctx.stats };
  }

  /** Candy Whirl: shuffles the regular candies (guaranteeing a valid move and no ready-made matches). */
  function applyWhirl(state_in) {
    if (state_in.status !== 'playing') return { valid: false, state: state_in, events: [], stats: null };
    const state = cloneState(state_in);
    const ctx = createContext(state);
    emit(ctx, { type: 'booster', booster: 'whirl', cell: -1 });
    shuffleBoard(ctx, 'whirl');
    finishMove(ctx, { skip_move_end: true });
    return { valid: true, state, events: ctx.events, stats: ctx.stats };
  }

  /**
   * Pre-level boosters on a fresh board: lucky (one striped and one wrapped candy), rainbow (one color bomb),
   * head_start (+3 moves, or +10 seconds in timed levels). Seeded, so a retry with the same seed is identical.
   */
  function applyStartBoosters(state_in, boosters) {
    const state = cloneState(state_in);
    const ctx = createContext(state);
    const wanted = boosters || {};
    const pickCell = () => {
      const candidates = [];
      state.cells.forEach((piece, index) => {
        if (isRegularCandy(piece) && !state.cage[index] && piece.fuse === undefined) candidates.push(index);
      });
      return candidates.length ? candidates[Math.floor(rngNext(state) * candidates.length)] : -1;
    };
    const transform = (special) => {
      const cell = pickCell();
      if (cell < 0) return;
      const piece = state.cells[cell];
      piece.special = special;
      if (special === SPECIAL.BOMB) piece.color = -1;
      emit(ctx, { type: 'transform', cell, piece_id: piece.id, special, color: piece.color, booster: true });
    };
    if (wanted.lucky) {
      transform(rngNext(state) < 0.5 ? SPECIAL.STRIPE_ROW : SPECIAL.STRIPE_COL);
      transform(SPECIAL.WRAPPED);
    }
    if (wanted.rainbow) transform(SPECIAL.BOMB);
    if (wanted.head_start) {
      if (state.timed) state.time_limit += 10;
      else state.moves_left += 3;
      emit(ctx, { type: 'booster', booster: 'head_start', cell: -1, moves_left: state.moves_left, time_limit: state.time_limit });
    }
    return { state, events: ctx.events };
  }

  /** +5 Moves after running out (or +15 seconds in timed levels): the level continues. */
  function addMoves(state_in, count) {
    const state = cloneState(state_in);
    if (state.timed) state.time_limit += 15;
    else state.moves_left += count || 5;
    if (state.status === 'lost' && (state.loss_reason === 'moves' || state.loss_reason === 'time')) {
      state.status = 'playing';
      state.loss_reason = null;
    }
    return state;
  }

  // ------------------------------------------------------------------ hints and bots

  const COMBO_VALUES = Object.freeze({ bomb_bomb: 10000, bomb_wrapped: 9000, bomb_stripe: 8500, wrapped_wrapped: 8000, wrapped_stripe: 7500, stripe_stripe: 7000 });

  function goalWants(state) {
    const wants = { colors: new Set(), jelly: false, ingredients: false, order: new Set() };
    goalProgress(state).forEach((progress) => {
      if (progress.done) return;
      if (progress.type === 'collect') wants.colors.add(progress.color);
      if (progress.type === 'jelly') wants.jelly = true;
      if (progress.type === 'ingredients') wants.ingredients = true;
      if (progress.type === 'order') wants.order.add(progress.item);
    });
    return wants;
  }

  /**
   * Cheap greedy evaluation of a valid move without resolving it (used by the bots that calibrate levels): combos and
   * bombs first, then specials, then match size, plus goal relevance (jelly, wanted colors, cells under ingredients,
   * order items, blockers next to the match, cages, fuses close to zero).
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
    const groups = findMatchGroupsAt(state, [move.from, move.to]);
    state.cells[move.from] = from_piece;
    state.cells[move.to] = to_piece;
    const wants = goalWants(state);
    let value = 0;
    groups.forEach((group) => {
      const plan = planCreation(group, [move.to, move.from]);
      if (plan) {
        value += plan.special === SPECIAL.BOMB ? 5000 : plan.special === SPECIAL.WRAPPED ? 3000 : 2000;
        if ((plan.special === SPECIAL.BOMB && wants.order.has('bomb')) || (plan.special === SPECIAL.WRAPPED && wants.order.has('wrapped')) ||
          ((plan.special === SPECIAL.STRIPE_ROW || plan.special === SPECIAL.STRIPE_COL) && wants.order.has('striped'))) value += 500;
      }
      value += group.cells.length * 10;
      group.cells.forEach((cell) => {
        const original_piece = cell === move.from ? to_piece : cell === move.to ? from_piece : state.cells[cell];
        if (isTriggerable(original_piece)) value += 400;
        if (original_piece && original_piece.fuse !== undefined) value += Math.max(0, 80 - 10 * original_piece.fuse);
        if (state.cage[cell]) value += wants.order.has('cage') ? 40 : 15;
        if (wants.jelly && state.jelly[cell] > 0) value += 15 * state.jelly[cell];
        if (wants.colors.has(group.color)) value += 12;
        orthogonalNeighbors(state, cell).forEach((neighbor) => {
          const neighbor_piece = state.cells[neighbor];
          if (neighbor_piece && neighbor_piece.kind === KIND.COCOA) value += 30;
          if (neighbor_piece && neighbor_piece.kind === KIND.FROSTING) value += wants.order.has('frosting') ? 30 : 12;
        });
        if (wants.ingredients) {
          for (let above = cell - state.cols; above >= 0; above -= state.cols) {
            if (isIngredient(state.cells[above])) {
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

  function urgentFuses(state) {
    const found = new Set();
    state.cells.forEach((piece) => {
      if (piece && piece.fuse !== undefined && piece.fuse <= 3) found.add(piece.id);
    });
    return found;
  }

  /**
   * Ranks every valid move for the hint by resolving it in full. Rank (compared left to right, higher is better):
   *  [wins the level now, goal progress (with relief for fuses about to expire and for Cocoa Creep),
   *   specials created + fired + 2 per combo, the largest match, the lowest row, then the leftmost column].
   * Returns [{ move: {from, to}, rank }] in listValidMoves order.
   */
  function hintRanks(state) {
    const completion_before = goalCompletion(state);
    const urgent = urgentFuses(state);
    const cocoa_present = state.cells.some((piece) => piece && piece.kind === KIND.COCOA);
    return listValidMoves(state).map((move) => {
      const result = applySwap(state, move.from, move.to);
      const after = result.state;
      let progress = goalCompletion(after) - completion_before;
      if (urgent.size > 0) {
        const remaining = new Set();
        after.cells.forEach((piece) => {
          if (piece) remaining.add(piece.id);
        });
        urgent.forEach((piece_id) => {
          if (!remaining.has(piece_id)) progress += 1;
        });
      }
      if (cocoa_present && after.order.cocoa > state.order.cocoa) progress += 0.5;
      const stats = result.stats;
      const rank = [
        after.status === 'won' ? 1 : 0,
        Math.round(progress * 100) / 100,
        stats.specials_created.stripe + stats.specials_created.wrapped + stats.specials_created.bomb + stats.activations + 2 * stats.combos.length,
        stats.largest_match,
        Math.max(rowOf(state, move.from), rowOf(state, move.to)),
        -Math.min(colOf(state, move.from), colOf(state, move.to)),
      ];
      return { move, rank };
    });
  }

  /** The hint: the best-ranked valid move (see hintRanks), the first in reading order on a tie; null when none exists. */
  function findHint(state) {
    let best = null;
    hintRanks(state).forEach((entry) => {
      if (!best || compareRanks(entry.rank, best.rank) > 0) best = entry;
    });
    return best ? { from: best.move.from, to: best.move.to } : null;
  }

  function compareRanks(first, second) {
    for (let index = 0; index < first.length; index += 1) {
      if (first[index] !== second[index]) return first[index] > second[index] ? 1 : -1;
    }
    return 0;
  }

  /**
   * What a hint shows: { from, to, cells }. `from` is the candy whose move makes the match (it nudges toward `to`),
   * `cells` are every candy of that match where they sit now, before the swap.
   */
  function hintFor(state, move) {
    const result = applySwap(state, move.from, move.to);
    const first_match = result.valid ? result.events.find((event) => event.type === 'match') : null;
    if (!first_match) return { from: move.from, to: move.to, cells: [move.from, move.to] };
    // After the swap the two candies have traded cells, so map the match back to the board as it is now.
    const now_cell = (cell) => (cell === move.to ? move.from : cell === move.from ? move.to : cell);
    const cells = first_match.cells.map(now_cell);
    const mover_is_from = first_match.cells.includes(move.to);
    return mover_is_from ? { from: move.from, to: move.to, cells } : { from: move.to, to: move.from, cells };
  }

  /**
   * Plays one whole game with a bot (used by the simulator, the level calibrator and the in-game self-test).
   * options: { attempt (seed = level.seed + attempt * 7919, like retries in the game), policy 'greedy'|'random',
   *            rng_seed, seconds_per_move (timed levels: the bot's virtual clock), move_cap, on_move(state_after, result) }.
   * Returns { won, score_at_end, final_score, moves_used, loss_reason, shuffles }.
   */
  function playBotGame(level, options) {
    const opts = options || {};
    const attempt = opts.attempt || 0;
    let state = createGame(level, { seed: level.seed + attempt * 7919 });
    const rng = UTIL.createRng(opts.rng_seed === undefined ? level.seed * 31 + attempt : opts.rng_seed);
    const seconds_per_move = opts.seconds_per_move || 3.5; // a relaxed human pace, so timed levels are tuned for people, not for a fast bot
    const move_cap = opts.move_cap || 400;
    let clock = 0;
    let moves_used = 0;
    let shuffles = 0;
    while (state.status === 'playing' && moves_used < move_cap) {
      if (state.timed && clock >= state.time_limit + state.time_bonus) {
        state = expireTime(state);
        break;
      }
      const move = opts.policy === 'random' ? chooseRandomMove(state, rng) : chooseGreedyMove(state, rng);
      if (!move) break;
      const result = applySwap(state, move.from, move.to);
      if (!result.valid) break;
      shuffles += result.stats.shuffles;
      state = result.state;
      if (opts.on_move) opts.on_move(state, result);
      moves_used += 1;
      clock += seconds_per_move;
    }
    if (state.status === 'playing' && state.timed) state = expireTime(state);
    const won = state.status === 'won';
    const seconds_left = state.timed ? Math.max(0, state.time_limit + state.time_bonus - clock) : 0;
    const final_score = won ? applyEndBonus(state, { seconds_left }).state.score : state.score;
    return { won, score_at_end: state.score, final_score, moves_used, loss_reason: state.loss_reason, shuffles };
  }

  function chooseRandomMove(state, rng) {
    const moves = listValidMoves(state);
    if (moves.length === 0) return null;
    const move = moves[Math.floor(rng() * moves.length)];
    return rng() < 0.5 ? move : { from: move.to, to: move.from };
  }

  // ------------------------------------------------------------------ invariants and replay

  /** Returns a list of invariant violations for a board at rest (empty when healthy). */
  /**
   * Cells that gravity can still feed on the current board: from the spawn cells, straight down, through portals and
   * diagonally into cells sealed from above, never through a hole or a piece that cannot move (blockers, cages). An empty
   * cell outside this set is legitimately sealed off (e.g. under a row of Cocoa Creep) until the blocker is cleared.
   */
  function refillableCells(state) {
    const rows = state.rows;
    const cols = state.cols;
    const reachable = new Uint8Array(rows * cols);
    const passable = (index) => !state.holes[index] && (state.cells[index] === null || canMoveAt(state, index));
    const queue = [];
    const mark = (index) => {
      if (index >= 0 && !reachable[index] && passable(index)) {
        reachable[index] = 1;
        queue.push(index);
      }
    };
    state.spawn_cells.forEach((cell) => {
      if (cell >= 0) mark(cell);
    });
    while (queue.length > 0) {
      const index = queue.shift();
      const row = rowOf(state, index);
      const col = colOf(state, index);
      const below = row + 1 < rows ? index + cols : -1;
      if (below >= 0 && !state.holes[below]) mark(below);
      else if (state.portal_to[index] >= 0) mark(state.portal_to[index]);
      if (row + 1 >= rows) continue;
      [-1, 1].forEach((offset) => {
        const target_col = col + offset;
        if (target_col < 0 || target_col >= cols) return;
        const target = (row + 1) * cols + target_col;
        if (!state.holes[target] && state.portal_from[target] < 0 && isSealedAbove(state, row * cols + target_col)) mark(target);
      });
    }
    return reachable;
  }

  function checkBoardInvariants(state) {
    const problems = [];
    const seen_ids = new Set();
    let refillable = null;
    state.cells.forEach((piece, index) => {
      if (state.holes[index]) {
        if (piece) problems.push(`piece in hole at ${index}`);
        if (state.jelly[index]) problems.push(`jelly in hole at ${index}`);
        if (state.cage[index]) problems.push(`cage in hole at ${index}`);
        return;
      }
      if (!piece) {
        if (!refillable) refillable = refillableCells(state);
        if (refillable[index]) problems.push(`empty cell at ${index}`);
        if (state.cage[index]) problems.push(`empty cage at ${index}`);
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
        if (piece.fuse !== undefined && piece.fuse < 1 && state.status === 'playing') problems.push(`spent fuse while playing at ${index}`);
      } else if (piece.fuse !== undefined) {
        problems.push(`fuse on a non-candy at ${index}`);
      }
      if (piece.kind === KIND.FROSTING && (piece.layers < 1 || piece.layers > MAX_FROSTING_LAYERS)) problems.push(`bad frosting layers at ${index}`);
      if (piece.kind === KIND.COCOA && piece.layers !== 1) problems.push(`bad cocoa at ${index}`);
      if (state.cage[index] && piece.kind !== KIND.CANDY) problems.push(`cage on a non-candy at ${index}`);
      if (state.jelly[index] > 2) problems.push(`bad jelly at ${index}`);
    });
    if (findMatchGroups(state).length > 0) problems.push('unresolved match on board at rest');
    if (state.status === 'playing' && !hasValidMove(state)) problems.push('no valid move while playing');
    if (state.moves_left < 0) problems.push('negative moves');
    return problems;
  }

  function boardSignature(state) {
    const cell_text = state.cells.map((piece) => (piece ? `${piece.id}:${piece.kind[0]}${piece.color}${piece.special}${piece.layers}${piece.fuse === undefined ? '' : `f${piece.fuse}`}` : '_')).join(',');
    return `${cell_text}|${Array.from(state.jelly).join('')}|${Array.from(state.cage).join('')}|${state.score}|${state.collected.join('.')}|${state.ingredients_collected}|${state.time_bonus}`;
  }

  /** Re-applies an event list to a starting state (renderer semantics). Used by the replay invariant test. */
  function replayEvents(start_state, events) {
    const state = cloneState(start_state);
    const cells = state.cells;
    let index = 0;
    const assertPiece = (cell, piece_id, label) => {
      if (!cells[cell] || cells[cell].id !== piece_id) throw new Error(`replay: ${label} expected piece ${piece_id} at ${cell}`);
    };
    const moveTogether = (moves, label) => {
      const moving = moves.map((move) => {
        assertPiece(move.from, move.piece_id, label);
        return { piece: cells[move.from], to: move.to };
      });
      moves.forEach((move) => {
        cells[move.from] = null;
      });
      moving.forEach((move) => {
        if (cells[move.to]) throw new Error(`replay: ${label} target ${move.to} occupied`);
        cells[move.to] = move.piece;
      });
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
          if (batch_event.type === 'collect') state.ingredients_collected += 1;
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
          if (!event.booster) state.moves_made += 1;
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
          if (event.special === SPECIAL.BOMB) delete cells[event.cell].fuse;
          break;
        case 'create':
          if (cells[event.cell]) throw new Error(`replay: create target ${event.cell} occupied`);
          cells[event.cell] = clonePiece(event.piece);
          break;
        case 'jelly':
          state.jelly[event.cell] = event.layers;
          break;
        case 'cage':
          state.cage[event.cell] = 0;
          break;
        case 'frosting':
        case 'cocoa':
          assertPiece(event.cell, event.piece_id, event.type);
          if (event.layers <= 0) cells[event.cell] = null;
          else cells[event.cell].layers = event.layers;
          break;
        case 'cocoa_spread':
          assertPiece(event.cell, event.old_piece_id, 'cocoa_spread');
          cells[event.cell] = clonePiece(event.piece);
          break;
        case 'fuse':
          assertPiece(event.cell, event.piece_id, 'fuse');
          cells[event.cell].fuse = event.fuse;
          break;
        case 'belt':
          moveTogether(event.moves, 'belt');
          break;
        case 'shuffle':
          moveTogether(event.moves, 'shuffle');
          break;
        case 'recolor':
          assertPiece(event.cell, event.piece_id, 'recolor');
          cells[event.cell].color = event.color;
          break;
        case 'time_bonus':
          state.time_bonus = event.total;
          break;
        case 'score':
          state.score += event.points;
          break;
        default:
          break;
      }
      index += 1;
    }
    return state;
  }

  // ------------------------------------------------------------------ level validation

  /** Cells that can ever receive a falling piece with every blocker and cage intact (layout validation). */
  function fallReachableCells(level) {
    const layout = parseLayout(level);
    const rows = layout.rows;
    const cols = layout.cols;
    const reachable = new Uint8Array(rows * cols);
    const portal_to = new Int16Array(rows * cols).fill(-1);
    const portal_from = new Int16Array(rows * cols).fill(-1);
    layout.portals.forEach((pair) => {
      portal_to[pair.entrance] = pair.exit;
      portal_from[pair.exit] = pair.entrance;
    });
    const isBlocked = (index) => layout.holes[index] || layout.frosting[index] || layout.cocoa[index] || layout.cage[index];
    const sealedAbove = (index) => index < 0 || layout.holes[index] || layout.frosting[index] || layout.cocoa[index] || layout.cage[index];
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < rows; row += 1) {
        const index = row * cols + col;
        if (layout.holes[index]) continue;
        if (!isBlocked(index) && portal_from[index] < 0) reachable[index] = 1;
        break;
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      const mark = (index) => {
        if (index >= 0 && !reachable[index] && !isBlocked(index)) {
          reachable[index] = 1;
          changed = true;
        }
      };
      for (let index = 0; index < reachable.length; index += 1) {
        if (!reachable[index]) continue;
        const row = Math.floor(index / cols);
        const col = index % cols;
        const below = row + 1 < rows ? index + cols : -1;
        if (below >= 0 && !layout.holes[below]) mark(below);
        else if (portal_to[index] >= 0) mark(portal_to[index]);
        if (row + 1 < rows) {
          [-1, 1].forEach((offset) => {
            const target_col = col + offset;
            if (target_col < 0 || target_col >= cols) return;
            const target = (row + 1) * cols + target_col;
            if (!layout.holes[target] && portal_from[target] < 0 && sealedAbove(row * cols + target_col)) mark(target);
          });
        }
      }
    }
    return { layout, reachable };
  }

  const GOAL_TYPES = Object.freeze(['score', 'collect', 'jelly', 'ingredients', 'order']);

  /** Everything that makes a level unplayable or malformed; an empty list means the level is valid. */
  function validateLevel(level) {
    const problems = [];
    let layout;
    try {
      layout = parseLayout(level);
      resolvePalette(level);
    } catch (parse_error) {
      return [parse_error.message];
    }
    const timed = Number.isFinite(level.time) && level.time > 0;
    if (timed) {
      if (level.time < 20 || level.time > 300) problems.push('time must be 20-300 seconds');
    } else if (!Number.isInteger(level.moves) || level.moves < 5 || level.moves > 99) {
      problems.push('moves must be 5-99 (or set time for a timed level)');
    }
    if (!Array.isArray(level.goals) || level.goals.length === 0) problems.push('at least one goal is required');
    (level.goals || []).forEach((goal) => {
      if (GOAL_TYPES.indexOf(goal.type) < 0) problems.push(`unknown goal type ${goal.type}`);
      if (goal.type === 'score' && !(goal.target > 0)) problems.push('score goal needs a positive target');
      if (goal.type === 'collect' && resolvePalette(level).indexOf(goal.color) < 0) problems.push(`collect goal color ${goal.color} never spawns`);
      if ((goal.type === 'collect' || goal.type === 'order' || goal.type === 'ingredients') && !(goal.count > 0)) problems.push(`${goal.type} goal needs a positive count`);
      if (goal.type === 'order' && ORDER_ITEMS.indexOf(goal.item) < 0) problems.push(`unknown order item ${goal.item}`);
      if (goal.type === 'jelly' && !layout.jelly.some((value) => value)) problems.push('jelly goal without jelly on the board');
      if (goal.type === 'order' && goal.item === 'frosting' && !layout.frosting.some((value) => value)) problems.push('frosting order without frosting');
      if (goal.type === 'order' && goal.item === 'cocoa' && !layout.cocoa.some((value) => value)) problems.push('cocoa order without cocoa');
      if (goal.type === 'order' && goal.item === 'cage' && !layout.cage.some((value) => value)) problems.push('cage order without cages');
    });
    const meta = level.meta || {};
    if (meta.preset) {
      if (!Array.isArray(meta.preset) || meta.preset.length !== layout.rows || meta.preset.some((row_text) => typeof row_text !== 'string' || row_text.length !== layout.cols)) {
        problems.push('meta.preset must have the same shape as the layout');
      } else {
        const palette = resolvePalette(level);
        meta.preset.forEach((row_text, row) => {
          for (let col = 0; col < layout.cols; col += 1) {
            const symbol = row_text[col];
            if (symbol === '.') continue;
            const index = row * layout.cols + col;
            if (!(symbol >= '0' && symbol <= '5') || palette.indexOf(Number(symbol)) < 0) problems.push(`preset ${row},${col}: '${symbol}' is not a palette color`);
            else if (layout.holes[index] || layout.frosting[index] || layout.cocoa[index] || layout.ingredients[index]) problems.push(`preset ${row},${col} sits on a hole or a non-candy cell`);
          }
        });
      }
    }
    (meta.specials || []).forEach((placement) => {
      const index = placement.at[0] * layout.cols + placement.at[1];
      if ([SPECIAL.STRIPE_ROW, SPECIAL.STRIPE_COL, SPECIAL.WRAPPED, SPECIAL.BOMB].indexOf(placement.special) < 0) problems.push(`unknown pre-placed special ${placement.special}`);
      if (layout.holes[index] || layout.frosting[index] || layout.cocoa[index] || layout.ingredients[index] || layout.cage[index]) problems.push(`special at ${placement.at} must sit on a free candy cell`);
    });
    if (!Array.isArray(level.stars) || level.stars.length !== 3 || !(level.stars[0] < level.stars[1] && level.stars[1] < level.stars[2])) {
      problems.push('stars must be three rising thresholds');
    }
    MECHANICS.forEach((mechanic) => {
      if (mechanic.validateLayout) problems.push(...mechanic.validateLayout(level, layout));
    });
    const reach = fallReachableCells(level);
    for (let index = 0; index < reach.reachable.length; index += 1) {
      const blocked = layout.holes[index] || layout.frosting[index] || layout.cocoa[index] || layout.cage[index];
      if (!blocked && !reach.reachable[index]) problems.push(`cell ${Math.floor(index / layout.cols)},${index % layout.cols} can never be refilled`);
    }
    if (problems.length === 0) {
      try {
        createGame(level);
      } catch (create_error) {
        problems.push(create_error.message);
      }
    }
    return problems;
  }

  const LOGIC = {
    KIND,
    SPECIAL,
    SCORING,
    LAYOUT_LEGEND,
    MECHANICS,
    ORDER_ITEMS,
    GOAL_TYPES,
    MAX_COLORS,
    MAX_FROSTING_LAYERS,
    matchPoints,
    cascadeMultiplier,
    parseLayout,
    validateLevel,
    createGame,
    cloneState,
    findMatchGroups,
    findMatchGroupsAt,
    planCreation,
    isValidSwap,
    isSwappableAt,
    listValidMoves,
    hasValidMove,
    applySwap,
    applyEndBonus,
    applyHammer,
    applyFreeSwap,
    applyWhirl,
    applyStartBoosters,
    addMoves,
    expireTime,
    goalProgress,
    goalsMet,
    goalCompletion,
    starsForScore,
    evaluateMove,
    chooseGreedyMove,
    chooseRandomMove,
    playBotGame,
    findHint,
    hintRanks,
    compareRanks,
    hintFor,
    checkBoardInvariants,
    refillableCells,
    boardSignature,
    replayEvents,
    fallReachableCells,
    mostCommonColor,
    isActivatable,
    isRegularCandy,
    isIngredient,
    isBlocker,
    // Low-level pieces exposed for tests and the self-test panel.
    internals: { newPiece, buildEmptyState, settleBoard, createContext, resolveBoard, shuffleBoard, runMatchStage, finishMove, fillInitialBoard },
  };
  SC.LOGIC = LOGIC;
  if (typeof module === 'object' && module.exports) module.exports = LOGIC;
})(typeof window !== 'undefined' ? window : globalThis);
