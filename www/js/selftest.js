// SELFTEST: the logic test suite shared by `node tests/logic.test.js` (with node:assert) and the in-game
// "Run self-test" panel (with a tiny built-in assert). Pure and DOM-free.
(function attachSelfTest(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');
  const LOGIC = SC.LOGIC || require('./logic.js');
  const LEVELS = SC.LEVELS || require('./levels.js');
  const STORAGE = SC.STORAGE || require('./storage.js');
  const META = SC.META || require('./meta.js');
  const CONFIG = SC.CONFIG || require('./config.js');
  const { SPECIAL, KIND } = LOGIC;

  // ---------------------------------------------------------------- test board builder
  // Tokens: '.' filler candy (colors 3/4/5, never forms a run)  '#' hole  '_' empty  'B' color bomb
  //         '0'-'5' candy, optionally followed by: 'h' horizontal stripes (clears row), 'v' vertical stripes (clears column),
  //         'w' wrapped, 'k' in a Sugar Cage, 'b<n>' Fuse Candy at n (e.g. '2b3', '0hk')
  //         'c' cherry  'n' hazelnut  'f' / 'F' / 'f1'-'f5' frosting with 1 / 2 / n layers  'o' Cocoa Creep
  // options: moves, time, seed, goals, jelly (digit rows), exits ([[r, c]]), exit_row, layout (layout rows, used for
  //          belts and portals instead of the token-derived layout), meta (level meta, e.g. portals)
  function fillerColor(row, col) {
    return 3 + ((row + col) % 3);
  }

  function makeTestState(token_rows, options) {
    const opts = options || {};
    const grid = token_rows.map((row_text) => row_text.trim().split(/\s+/));
    const rows = grid.length;
    const cols = grid[0].length;
    const exit_cells = new Set((opts.exits || []).map((pair) => pair[0] * cols + pair[1]));
    if (opts.exit_row !== undefined) for (let col = 0; col < cols; col += 1) exit_cells.add(opts.exit_row * cols + col);
    const layout = opts.layout || grid.map((row_tokens, row) => row_tokens.map((token, col) => (token === '#' ? '#' : exit_cells.has(row * cols + col) ? 'x' : '.')).join(''));
    const level = {
      id: 'test', name: 'test', colors: 6, seed: opts.seed === undefined ? 4242 : opts.seed,
      rows, cols, layout, goals: opts.goals || [{ type: 'score', target: 99999999 }], stars: [1, 2, 3],
    };
    if (opts.time) level.time = opts.time;
    else level.moves = opts.moves === undefined ? 20 : opts.moves;
    if (opts.meta) level.meta = opts.meta;
    const parsed = LOGIC.parseLayout(level);
    const state = LOGIC.internals.buildEmptyState(level, parsed, [0, 1, 2, 3, 4, 5], level.seed);
    const piece = (kind, color, special, layers) => LOGIC.internals.newPiece(state, kind, color, special, layers);
    grid.forEach((row_tokens, row) => {
      row_tokens.forEach((token, col) => {
        const index = row * cols + col;
        state.cells[index] = null;
        if (token === '#' || token === '_') return;
        if (token === '.') state.cells[index] = piece(KIND.CANDY, fillerColor(row, col), SPECIAL.NONE, 0);
        else if (token === 'B') state.cells[index] = piece(KIND.CANDY, -1, SPECIAL.BOMB, 0);
        else if (token === 'c' || token === 'n') {
          state.cells[index] = piece(token === 'c' ? KIND.CHERRY : KIND.HAZELNUT, -1, SPECIAL.NONE, 0);
          state.ingredients_total += 1;
        } else if (token === 'o') state.cells[index] = piece(KIND.COCOA, -1, SPECIAL.NONE, 1);
        else if (token[0] === 'f' || token[0] === 'F') {
          const layers = token === 'f' ? 1 : token === 'F' ? 2 : parseInt(token.slice(1), 10);
          if (!(layers >= 1 && layers <= LOGIC.MAX_FROSTING_LAYERS)) throw new Error(`bad token ${token}`);
          state.cells[index] = piece(KIND.FROSTING, -1, SPECIAL.NONE, layers);
        } else {
          const parsed_token = /^([0-5])([hvw]?)(k?)(?:b(\d+))?$/.exec(token);
          if (!parsed_token) throw new Error(`bad token ${token}`);
          const special = { h: SPECIAL.STRIPE_ROW, v: SPECIAL.STRIPE_COL, w: SPECIAL.WRAPPED }[parsed_token[2]] || SPECIAL.NONE;
          const candy = piece(KIND.CANDY, Number(parsed_token[1]), special, 0);
          if (parsed_token[4]) candy.fuse = Number(parsed_token[4]);
          state.cells[index] = candy;
          if (parsed_token[3]) state.cage[index] = 1;
        }
      });
    });
    if (opts.jelly) {
      state.jelly_total = 0;
      opts.jelly.forEach((row_text, row) => {
        for (let col = 0; col < cols; col += 1) {
          state.jelly[row * cols + col] = parseInt(row_text[col], 10);
          state.jelly_total += state.jelly[row * cols + col];
        }
      });
    }
    return state;
  }

  /** Every level that ships in this build (the in-game panel loads the packs first, see prepare()). */
  function shippedLevels() {
    const list = [];
    for (let level_number = 1; level_number <= LEVELS.shippedCount(); level_number += 1) {
      const level = LEVELS.getLevel(level_number);
      if (level) list.push(level);
    }
    return list;
  }

  function prepare() {
    return LEVELS.ensureRange(1, LEVELS.shippedCount());
  }

  const at = (state, row, col) => row * state.cols + col;

  function phaseGroups(events) {
    const phases = [];
    events.forEach((event) => {
      if (event.type === 'phase') phases.push({ header: event, events: [] });
      else if (phases.length) phases[phases.length - 1].events.push(event);
    });
    return phases;
  }

  function firstClearPhase(events) {
    return phaseGroups(events).find((phase) => phase.header.kind === 'clear');
  }

  function phaseScore(phase) {
    return phase.events.filter((event) => event.type === 'score').reduce((sum, event) => sum + event.points, 0);
  }

  function runStageOnBoard(state, swap_cells) {
    const ctx = LOGIC.internals.createContext(state);
    ctx.cascade_depth = 1;
    LOGIC.internals.runMatchStage(ctx, LOGIC.findMatchGroups(state), swap_cells || null);
    return ctx;
  }

  /**
   * Speed of a piece of work in ms: the median of three timed runs. A single sample on a phone (or a CI emulator without
   * a GPU) can include a garbage-collection pause or the first JIT compile, which is not the speed of the code itself.
   */
  function medianMs(work) {
    const clock = typeof performance !== 'undefined' && performance.now ? () => performance.now() : () => Date.now();
    const times = [];
    for (let run = 0; run < 3; run += 1) {
      const started = clock();
      work();
      times.push(clock() - started);
    }
    times.sort((a, b) => a - b);
    return Math.round(times[1] * 10) / 10;
  }

  function sortedNumbers(values) {
    return values.slice().sort((a, b) => a - b);
  }

  function countKind(state, kind) {
    return state.cells.filter((piece) => piece && piece.kind === kind).length;
  }

  // ---------------------------------------------------------------- tests
  const TESTS = [];
  function test(group, name, run) {
    TESTS.push({ group, name, run });
  }

  // 1. RNG
  test('rng', 'mulberry32 is deterministic and seed-dependent', (assert) => {
    const first = UTIL.createRng(12345);
    const second = UTIL.createRng(12345);
    const other = UTIL.createRng(54321);
    const sequence_first = Array.from({ length: 64 }, () => first());
    const sequence_second = Array.from({ length: 64 }, () => second());
    const sequence_other = Array.from({ length: 64 }, () => other());
    assert.deepStrictEqual(sequence_first, sequence_second);
    assert.notDeepStrictEqual(sequence_first, sequence_other);
    assert.ok(sequence_first.every((value) => value >= 0 && value < 1));
    assert.strictEqual(UTIL.createRng(1)(), 0.6270739405881613, 'mulberry32 reference value for seed 1');
    const holder = { rng_state: 12345 };
    assert.strictEqual(UTIL.rngNext(holder), sequence_first[0]);
  });

  test('rng', 'same seed + same swaps => identical events and board', (assert) => {
    const level = LEVELS.getLevel(3);
    const play = () => {
      let state = LOGIC.createGame(level);
      const event_log = [];
      for (let move_index = 0; move_index < 15 && state.status === 'playing'; move_index += 1) {
        const move = LOGIC.findHint(state);
        const result = LOGIC.applySwap(state, move.from, move.to);
        event_log.push(JSON.stringify(result.events));
        state = result.state;
      }
      return { signature: LOGIC.boardSignature(state), event_log };
    };
    const first_play = play();
    const second_play = play();
    assert.strictEqual(first_play.signature, second_play.signature);
    assert.deepStrictEqual(first_play.event_log, second_play.event_log);
  });

  // 2. Initial boards
  test('initial', 'all shipped levels: valid, no matches, a valid move, palette colors, mechanics placed', (assert) => {
    const levels = shippedLevels();
    assert.ok(levels.length >= 60, `at least 60 levels ship (found ${levels.length})`);
    levels.forEach((level, index) => {
      assert.strictEqual(level.id, index + 1, 'levels are numbered 1..n in order');
      assert.deepStrictEqual(LOGIC.validateLevel(level), [], `level ${level.id} validates`);
      const layout = LOGIC.parseLayout(level);
      const palette = level.palette || Array.from({ length: level.colors }, (unused, color) => color);
      for (let variant = 0; variant < 6; variant += 1) {
        const state = LOGIC.createGame(level, { seed: level.seed + variant * 7919 });
        assert.strictEqual(LOGIC.findMatchGroups(state).length, 0, `level ${level.id} starts with a match`);
        assert.ok(LOGIC.hasValidMove(state), `level ${level.id} has no valid move`);
        assert.deepStrictEqual(LOGIC.checkBoardInvariants(state), [], `level ${level.id} invariants`);
        state.cells.forEach((piece, cell) => {
          assert.strictEqual(!!state.holes[cell], !!layout.holes[cell], `hole mismatch L${level.id}@${cell}`);
          assert.strictEqual(state.jelly[cell], layout.jelly[cell], `jelly mismatch L${level.id}@${cell}`);
          assert.strictEqual(state.cage[cell], layout.cage[cell], `cage mismatch L${level.id}@${cell}`);
          if (layout.holes[cell]) return;
          if (layout.frosting[cell]) {
            assert.strictEqual(piece.kind, KIND.FROSTING);
            assert.strictEqual(piece.layers, layout.frosting[cell]);
          } else if (layout.cocoa[cell]) {
            assert.strictEqual(piece.kind, KIND.COCOA);
          } else if (layout.ingredients[cell]) {
            assert.strictEqual(piece.kind, layout.ingredients[cell] === 1 ? KIND.CHERRY : KIND.HAZELNUT);
          } else {
            assert.strictEqual(piece.kind, KIND.CANDY);
            assert.strictEqual(piece.fuse, layout.fuse[cell] ? level.meta.fuse : undefined, `fuse L${level.id}@${cell}`);
            if (piece.special === SPECIAL.BOMB) return;
            assert.ok(palette.indexOf(piece.color) >= 0, `color ${piece.color} outside palette on level ${level.id}`);
          }
        });
        if (level.time) {
          assert.ok(state.timed && state.moves_left === Infinity && state.time_limit === level.time, `level ${level.id} is timed`);
        } else {
          assert.strictEqual(state.moves_left, level.moves);
        }
      }
      assert.ok(level.goals.length > 0 && level.goals.length <= 3, `level ${level.id} has 1-3 goals`);
      assert.ok(level.stars[0] < level.stars[1] && level.stars[1] < level.stars[2], `level ${level.id} star thresholds must rise`);
      assert.ok(LEVELS.ROLES.indexOf(level.role) >= 0, `level ${level.id} has a role`);
    });
  });

  test('initial', 'all shipped levels: every refillable cell is reachable; ingredients can reach a tray', (assert) => {
    shippedLevels().forEach((level) => {
      const reach = LOGIC.fallReachableCells(level);
      const layout = reach.layout;
      for (let index = 0; index < reach.reachable.length; index += 1) {
        if (layout.holes[index] || layout.frosting[index] || layout.cocoa[index] || layout.cage[index]) continue;
        assert.ok(reach.reachable[index], `level ${level.id} cell ${index} unreachable`);
      }
      const ingredient_goal = level.goals.find((goal) => goal.type === 'ingredients');
      if (!ingredient_goal) return;
      const ingredient_count = Array.from(layout.ingredients).filter((value) => value).length;
      assert.ok(ingredient_count >= ingredient_goal.count, `level ${level.id}: enough ingredients for the goal`);
      for (let index = 0; index < layout.ingredients.length; index += 1) {
        if (!layout.ingredients[index]) continue;
        // Straight down (or through a portal) until a tray: blockers below are cleared during play, holes are not.
        let cursor = index;
        let guard = 0;
        while (!layout.exits[cursor] && guard < 200) {
          guard += 1;
          const below = cursor + level.cols;
          if (below < layout.holes.length && !layout.holes[below]) cursor = below;
          else {
            const pair = layout.portals.find((portal) => portal.entrance === cursor);
            if (!pair) break;
            cursor = pair.exit;
          }
        }
        assert.ok(layout.exits[cursor], `level ${level.id}: ingredient at ${index} cannot fall to a tray`);
      }
    });
  });

  // 3. Match detection
  test('match', 'lines of 3, 4 and 5 (horizontal and vertical)', (assert) => {
    let state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0 0 . .', '. . . . . .', '. . . . . .']);
    let groups = LOGIC.findMatchGroups(state);
    assert.strictEqual(groups.length, 1);
    assert.deepStrictEqual(groups[0].cells, [13, 14, 15]);
    assert.strictEqual(LOGIC.planCreation(groups[0], null), null);
    state = makeTestState(['. . . . . .', '0 0 0 0 . .', '. . . . . .', '. . . . . .']);
    groups = LOGIC.findMatchGroups(state);
    assert.strictEqual(groups[0].cells.length, 4);
    assert.deepStrictEqual(LOGIC.planCreation(groups[0], null), { cell: 6, special: SPECIAL.STRIPE_COL, color: 0 });
    state = makeTestState(['. 1 . . . .', '. 1 . . . .', '. 1 . . . .', '. 1 . . . .', '. . . . . .']);
    groups = LOGIC.findMatchGroups(state);
    assert.deepStrictEqual(groups[0].cells, [1, 7, 13, 19]);
    assert.strictEqual(LOGIC.planCreation(groups[0], null).special, SPECIAL.STRIPE_ROW);
    state = makeTestState(['. . . . . .', '2 2 2 2 2 .', '. . . . . .', '. . . . . .']);
    groups = LOGIC.findMatchGroups(state);
    assert.strictEqual(groups[0].cells.length, 5);
    assert.deepStrictEqual(LOGIC.planCreation(groups[0], null), { cell: 6, special: SPECIAL.BOMB, color: -1 });
  });

  test('match', 'L, T and + shapes merge into one group with an intersection', (assert) => {
    const shapes = {
      L: { rows: ['0 . . . .', '0 . . . .', '0 0 0 . .', '. . . . .', '. . . . .'], cells: [0, 5, 10, 11, 12], intersection: 10 },
      T: { rows: ['0 0 0 . .', '. 0 . . .', '. 0 . . .', '. . . . .', '. . . . .'], cells: [0, 1, 2, 6, 11], intersection: 1 },
      plus: { rows: ['. 0 . . .', '0 0 0 . .', '. 0 . . .', '. . . . .', '. . . . .'], cells: [1, 5, 6, 7, 11], intersection: 6 },
    };
    Object.keys(shapes).forEach((shape_name) => {
      const shape = shapes[shape_name];
      const groups = LOGIC.findMatchGroups(makeTestState(shape.rows));
      assert.strictEqual(groups.length, 1, shape_name);
      assert.deepStrictEqual(groups[0].cells, shape.cells, shape_name);
      assert.deepStrictEqual(groups[0].intersections, [shape.intersection], shape_name);
      assert.deepStrictEqual(LOGIC.planCreation(groups[0], null), { cell: shape.intersection, special: SPECIAL.WRAPPED, color: 0 }, shape_name);
    });
  });

  test('match', 'two matches in one pass, board edges', (assert) => {
    const state = makeTestState(['0 0 0 . .', '. . . . .', '. . . . .', '. . . . 1', '. . . . 1', '. . 2 2 1']);
    const groups = LOGIC.findMatchGroups(state);
    assert.deepStrictEqual(groups.map((group) => group.cells), [[0, 1, 2], [19, 24, 29]], 'top-left edge run and right/bottom edge run');
  });

  test('match', 'runs are broken by holes, frosting, cocoa, ingredients, bombs and empty cells; caged candies match', (assert) => {
    ['0 0 # 0 0', '0 0 f 0 0', '0 0 f5 0 0', '0 0 o 0 0', '0 0 c 0 0', '0 0 n 0 0', '0 0 B 0 0', '0 0 _ 0 0'].forEach((row_text) => {
      const state = makeTestState(['. . . . .', row_text, '. . . . .']);
      assert.strictEqual(LOGIC.findMatchGroups(state).length, 0, row_text);
    });
    const vertical = makeTestState(['. 0 . .', '. 0 . .', '. # . .', '. 0 . .', '. . . .']);
    assert.strictEqual(LOGIC.findMatchGroups(vertical).length, 0);
    const caged = makeTestState(['. . . . .', '0 0k 0 . .', '. . . . .']);
    assert.deepStrictEqual(LOGIC.findMatchGroups(caged).map((group) => group.cells), [[5, 6, 7]], 'a caged candy still counts in a match');
    const fused = makeTestState(['. . . . .', '1b4 1 1 . .', '. . . . .']);
    assert.strictEqual(LOGIC.findMatchGroups(fused).length, 1, 'a Fuse Candy matches like its color');
  });

  // 4. Valid moves
  test('moves', 'valid and invalid swaps', (assert) => {
    const state = makeTestState([
      '0 0 1 0 . .',
      '. . . . . .',
      '. c . f . .',
      '. 2 . # . .',
      '. . . . 0h 1w',
      'B 2 . . . .',
    ]);
    assert.ok(LOGIC.isValidSwap(state, 2, 3), 'swap that completes 0 0 0');
    assert.ok(!LOGIC.isValidSwap(state, 2, 8), 'swap that matches nothing');
    assert.ok(!LOGIC.isValidSwap(state, at(state, 2, 1), at(state, 3, 1)), 'cherry cannot be swapped');
    assert.ok(!LOGIC.isValidSwap(state, at(state, 2, 3), at(state, 2, 2)), 'frosting cannot be swapped');
    assert.ok(!LOGIC.isValidSwap(state, at(state, 3, 3), at(state, 3, 2)), 'hole cannot be swapped');
    assert.ok(!LOGIC.isValidSwap(state, 0, 2), 'non-adjacent');
    assert.ok(!LOGIC.isValidSwap(state, 0, 7), 'diagonal');
    assert.ok(LOGIC.isValidSwap(state, at(state, 4, 4), at(state, 4, 5)), 'two specials always combine');
    assert.ok(LOGIC.isValidSwap(state, at(state, 5, 0), at(state, 5, 1)), 'color bomb with any candy');
    const result = LOGIC.applySwap(state, 2, 8);
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.state, state, 'invalid swap returns the same state');
    assert.strictEqual(result.state.moves_left, 20, 'invalid swap does not use a move');
    assert.strictEqual(result.events[0].type, 'invalid_swap');
    const moves = LOGIC.listValidMoves(state);
    moves.forEach((move) => assert.ok(LOGIC.isValidSwap(state, move.from, move.to)));
    assert.ok(moves.some((move) => move.from === 2 && move.to === 3));
  });

  // 5. Specials
  test('specials', 'creation: type, orientation and position (swap and cascade)', (assert) => {
    const cases = [
      { rows: ['. . . . . .', '. . 0 . . .', '0 0 1 0 . .', '. . . . . .', '. . . . . .'], from: [1, 2], to: [2, 2], special: SPECIAL.STRIPE_COL, cell: [2, 2] },
      { rows: ['. . 0 . . .', '. . 0 . . .', '. 0 1 . . .', '. . 0 . . .', '. . . . . .'], from: [2, 1], to: [2, 2], special: SPECIAL.STRIPE_ROW, cell: [2, 2] },
      { rows: ['. . 0 . . .', '. . 0 . . .', '0 0 1 . . .', '. . 0 . . .', '. . . . . .'], from: [3, 2], to: [2, 2], special: SPECIAL.WRAPPED, cell: [2, 2] },
      { rows: ['. . . . . .', '. . 0 . . .', '0 0 1 0 0 .', '. . . . . .', '. . . . . .'], from: [1, 2], to: [2, 2], special: SPECIAL.BOMB, cell: [2, 2] },
    ];
    cases.forEach((test_case, case_index) => {
      const state = makeTestState(test_case.rows);
      const result = LOGIC.applySwap(state, at(state, test_case.from[0], test_case.from[1]), at(state, test_case.to[0], test_case.to[1]));
      assert.ok(result.valid, `case ${case_index} valid`);
      const create_event = firstClearPhase(result.events).events.find((event) => event.type === 'create');
      assert.ok(create_event, `case ${case_index} created a special`);
      assert.strictEqual(create_event.piece.special, test_case.special, `case ${case_index} special`);
      assert.strictEqual(create_event.cell, at(state, test_case.cell[0], test_case.cell[1]), `case ${case_index} position`);
    });
    const cascade_state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0 0 0 .', '. . . . . .']);
    const ctx = runStageOnBoard(cascade_state, null);
    const created = ctx.events.find((event) => event.type === 'create');
    assert.strictEqual(created.cell, at(cascade_state, 2, 1), 'cascade special appears at the first cell of the match');
  });

  test('specials', 'activation: striped row/column, wrapped double blast, color bomb', (assert) => {
    let state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0h 0 . .', '. . . . . .', '. . . . . .']);
    let ctx = runStageOnBoard(state, null);
    let activation = ctx.events.find((event) => event.type === 'activate');
    assert.strictEqual(activation.kind, 'row');
    assert.deepStrictEqual(activation.area, [12, 13, 14, 15, 16, 17]);
    [12, 13, 14, 15, 16, 17].forEach((cell) => assert.strictEqual(state.cells[cell], null, `row cell ${cell} cleared`));

    state = makeTestState(['. . . . .', '. . . . .', '. 0 0v 0 .', '. . . . .', '. . . . .', '. . . . .']);
    ctx = runStageOnBoard(state, null);
    activation = ctx.events.find((event) => event.type === 'activate');
    assert.strictEqual(activation.kind, 'col');
    assert.deepStrictEqual(activation.area, [2, 7, 12, 17, 22, 27]);
    [2, 7, 12, 17, 22, 27].forEach((cell) => assert.strictEqual(state.cells[cell], null));

    state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0w 0 . .', '. . . . . .', '. . . . . .', '. . . . . .']);
    const wrapped_id = state.cells[14].id;
    ctx = runStageOnBoard(state, null);
    activation = ctx.events.find((event) => event.type === 'activate');
    assert.strictEqual(activation.kind, 'wrapped');
    assert.deepStrictEqual(activation.area, [7, 8, 9, 13, 14, 15, 19, 20, 21]);
    assert.strictEqual(state.cells[14].special, SPECIAL.WRAPPED_ARMED, 'wrapped survives its first blast, armed');
    [7, 8, 9, 13, 15, 19, 20, 21].forEach((cell) => assert.strictEqual(state.cells[cell], null));
    LOGIC.internals.resolveBoard(ctx);
    const second = ctx.events.filter((event) => event.type === 'activate' && event.piece_id === wrapped_id && event.kind === 'wrapped_second');
    assert.strictEqual(second.length, 1, 'second 3x3 blast after settling');
    assert.ok(ctx.events.some((event) => event.type === 'clear' && event.piece_id === wrapped_id), 'wrapped removed after second blast');
    assert.ok(!state.cells.some((piece) => piece && piece.special === SPECIAL.WRAPPED_ARMED));

    state = makeTestState(['1 . . 1 . .', '. . . . . .', '. . B 2 . .', '. 1 . . . 1', '. . . . . .']);
    const result = LOGIC.applySwap(state, at(state, 2, 2), at(state, 2, 3));
    const clears = firstClearPhase(result.events).events.filter((event) => event.type === 'clear' && event.color === 2);
    assert.strictEqual(clears.length, 1, 'only one candy of color 2 on the board');
    const result_ones = LOGIC.applySwap(makeTestState(['1 . . 1 . .', '. . . . . .', '. . B 1 . .', '. 1 . . . 1', '. . . . . .']), 14, 15);
    const cleared_ones = firstClearPhase(result_ones.events).events.filter((event) => event.type === 'clear' && event.color === 1);
    assert.strictEqual(cleared_ones.length, 5, 'bomb + candy clears every candy of that color');
  });

  test('specials', 'chains are breadth-first, reading order, deterministic and terminate', (assert) => {
    const rows = ['. . . . . . .', '. . . . 1h . .', '. . . . . . .', '. 0 0h 0 2v . .', '. . . . . . .', '. . . . 3v . .', '. . . . . . .'];
    const run_once = () => {
      const state = makeTestState(rows);
      const ctx = runStageOnBoard(state, null);
      return ctx.events;
    };
    const events = run_once();
    const activations = events.filter((event) => event.type === 'activate');
    assert.deepStrictEqual(activations.map((event) => [event.kind, event.wave, event.cell]), [['row', 1, 23], ['col', 2, 25], ['row', 3, 11], ['col', 3, 39]]);
    assert.strictEqual(JSON.stringify(run_once()), JSON.stringify(events), 'identical on re-run');
  });

  // 6. Combos
  test('combos', 'striped + striped clears a cross; striped + wrapped clears 3 rows and 3 columns', (assert) => {
    let state = makeTestState(['. . . . . .', '. . . . . .', '. . 0h 1v . .', '. . . . . .', '. . . . . .']);
    let result = LOGIC.applySwap(state, at(state, 2, 2), at(state, 2, 3));
    let phase = firstClearPhase(result.events);
    let activation = phase.events.find((event) => event.type === 'activate');
    assert.strictEqual(activation.kind, 'cross');
    assert.deepStrictEqual(activation.area, sortedNumbers([12, 13, 14, 15, 16, 17, 3, 9, 21, 27]));
    state = makeTestState(['. . . . . .', '. . . . . .', '. . 0w 1v . .', '. . . . . .', '. . . . . .', '. . . . . .']);
    result = LOGIC.applySwap(state, at(state, 2, 2), at(state, 2, 3));
    phase = firstClearPhase(result.events);
    activation = phase.events.find((event) => event.type === 'activate');
    assert.strictEqual(activation.kind, 'big_cross');
    const expected = new Set();
    [1, 2, 3].forEach((row) => [0, 1, 2, 3, 4, 5].forEach((col) => expected.add(row * 6 + col)));
    [2, 3, 4].forEach((col) => [0, 1, 2, 3, 4, 5].forEach((row) => expected.add(row * 6 + col)));
    assert.deepStrictEqual(activation.area, sortedNumbers(Array.from(expected)));
    const cleared = new Set(phase.events.filter((event) => event.type === 'clear').map((event) => event.cell));
    expected.forEach((cell) => assert.ok(cleared.has(cell), `cell ${cell} cleared by the 3x3 band`));
  });

  test('combos', 'wrapped + wrapped: 5x5 blast, then a second 5x5 after settling', (assert) => {
    const state = makeTestState(['. . . . . . .', '. . . . . . .', '. . . . . . .', '. . . 0w 1w . .', '. . . . . . .', '. . . . . . .', '. . . . . . .']);
    const result = LOGIC.applySwap(state, at(state, 3, 3), at(state, 3, 4));
    const activations = result.events.filter((event) => event.type === 'activate');
    assert.strictEqual(activations[0].kind, 'wrapped_big');
    assert.strictEqual(activations[0].area.length, 25);
    const second = activations.find((event) => event.kind === 'wrapped_big_second');
    assert.ok(second, 'second big blast');
    const second_row = Math.floor(second.cell / 7);
    const second_col = second.cell % 7;
    const expected_area = [];
    for (let row = second_row - 2; row <= second_row + 2; row += 1) {
      for (let col = second_col - 2; col <= second_col + 2; col += 1) if (row >= 0 && row < 7 && col >= 0 && col < 7) expected_area.push(row * 7 + col);
    }
    assert.deepStrictEqual(second.area, expected_area, '5x5 around where it landed (clipped at the board edge)');
    assert.ok(second_row > 3, 'it fell after the first blast');
    assert.deepStrictEqual(LOGIC.checkBoardInvariants(result.state).filter((problem) => problem.indexOf('armed') >= 0), []);
  });

  test('combos', 'color bomb + striped / wrapped transforms every candy of that color, then all activate', (assert) => {
    let state = makeTestState(['1 . . . 1 .', '. . . . . .', '. . B 1h . .', '. . . . . .', '1 . . . . 1']);
    let result = LOGIC.applySwap(state, at(state, 2, 2), at(state, 2, 3));
    let phase = firstClearPhase(result.events);
    let transforms = phase.events.filter((event) => event.type === 'transform');
    assert.strictEqual(transforms.length, 4, 'the four plain color-1 candies become striped');
    transforms.forEach((event) => assert.ok(event.special === SPECIAL.STRIPE_ROW || event.special === SPECIAL.STRIPE_COL));
    const stripe_activations = phase.events.filter((event) => event.type === 'activate' && (event.kind === 'row' || event.kind === 'col'));
    assert.strictEqual(stripe_activations.length, 5, 'all five striped candies fire');

    state = makeTestState(['1 . . . 1 .', '. . . . . .', '. . B 1w . .', '. . . . . .', '1 . . . . .', '. . . . . .']);
    result = LOGIC.applySwap(state, at(state, 2, 2), at(state, 2, 3));
    phase = firstClearPhase(result.events);
    transforms = phase.events.filter((event) => event.type === 'transform' && event.special === SPECIAL.WRAPPED);
    assert.strictEqual(transforms.length, 3);
    const first_blasts = result.events.filter((event) => event.type === 'activate' && event.kind === 'wrapped');
    const second_blasts = result.events.filter((event) => event.type === 'activate' && event.kind === 'wrapped_second');
    assert.ok(first_blasts.length >= 4, 'each wrapped explodes');
    assert.strictEqual(second_blasts.length, first_blasts.length, 'and explodes again after settling');
  });

  test('combos', 'color bomb + color bomb clears the whole board; cherries survive; frosting takes one hit', (assert) => {
    const state = makeTestState(['. . c . .', '. F . . .', '. . B B .', '. f . . .', '. . . . .'], { jelly: ['00000', '00000', '20000', '00000', '00011'] });
    const cherry_id = state.cells[2].id;
    const result = LOGIC.applySwap(state, at(state, 2, 2), at(state, 2, 3));
    const phase = firstClearPhase(result.events);
    assert.strictEqual(phase.events.find((event) => event.type === 'activate').kind, 'board');
    const cleared_cells = new Set(phase.events.filter((event) => event.type === 'clear').map((event) => event.cell));
    for (let index = 0; index < 25; index += 1) {
      const original = state.cells[index];
      if (original.kind === KIND.CANDY) assert.ok(cleared_cells.has(index), `candy at ${index} cleared`);
    }
    assert.ok(!phase.events.some((event) => event.type === 'clear' && event.piece_id === cherry_id), 'cherry not destroyed');
    const frosting_events = phase.events.filter((event) => event.type === 'frosting');
    assert.deepStrictEqual(frosting_events.map((event) => [event.cell, event.layers]), [[6, 1], [16, 0]]);
    const jelly_events = phase.events.filter((event) => event.type === 'jelly');
    assert.deepStrictEqual(jelly_events.map((event) => [event.cell, event.layers]).sort((a, b) => a[0] - b[0]), [[10, 1], [23, 0], [24, 0]]);
  });

  // 7. Gravity
  test('gravity', 'falls, spawns and diagonal fills leave no gaps, no overlaps, nothing in holes', (assert) => {
    const state = makeTestState([
      '. # . . . .',
      '. . f . # .',
      '_ _ _ _ _ .',
      '_ . _ . _ .',
      '. . _ . . .',
    ]);
    const ctx = LOGIC.internals.createContext(state);
    LOGIC.internals.settleBoard(ctx);
    const problems = LOGIC.checkBoardInvariants(state).filter((problem) => problem.indexOf('match') < 0 && problem.indexOf('valid move') < 0);
    assert.deepStrictEqual(problems, []);
    const falls = ctx.events.filter((event) => event.type === 'fall' || event.type === 'spawn');
    const diagonal = falls.some((event) => event.path.some((point, index) => index > 0 && point[2] !== event.path[index - 1][2]));
    assert.ok(diagonal, 'the pocket under the frosting is filled diagonally');
    falls.forEach((event) => {
      for (let index = 1; index < event.path.length; index += 1) {
        assert.ok(event.path[index][1] >= event.path[index - 1][1], 'pieces never move up');
        assert.ok(Math.abs(event.path[index][2] - event.path[index - 1][2]) <= 1);
      }
    });
    assert.strictEqual(state.cells[at(state, 0, 1)], null, 'hole stays empty');
  });

  test('gravity', 'random clears on every level always refill completely and deterministically', (assert) => {
    shippedLevels().forEach((level) => {
      for (let variant = 0; variant < 4; variant += 1) {
        const state = LOGIC.createGame(level, { seed: level.seed + variant });
        const rng = UTIL.createRng(variant + level.id * 1000);
        state.cells.forEach((piece, index) => {
          if (piece && piece.kind === KIND.CANDY && rng() < 0.35) state.cells[index] = null;
        });
        const twin = LOGIC.cloneState(state);
        LOGIC.internals.settleBoard(LOGIC.internals.createContext(state));
        LOGIC.internals.settleBoard(LOGIC.internals.createContext(twin));
        assert.strictEqual(LOGIC.boardSignature(state), LOGIC.boardSignature(twin), 'deterministic refill');
        const problems = LOGIC.checkBoardInvariants(state).filter((problem) => problem.indexOf('match') < 0 && problem.indexOf('valid move') < 0);
        assert.deepStrictEqual(problems, [], `level ${level.id} variant ${variant}`);
      }
    });
  });

  // 8. Cascades, multiplier, replay
  test('cascade', 'multiplier sequence 1, 1.5, 2, 2.5 ... capped at 4', (assert) => {
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 12].map(LOGIC.cascadeMultiplier), [1, 1.5, 2, 2.5, 3, 3.5, 4, 4, 4]);
  });

  test('cascade', 'falling candies form a second match scored at x1.5', (assert) => {
    const state = makeTestState(['. . . . .', '. . . . .', '. . . . .', '. 1 1 . .', '0 0 0 1 .']);
    const ctx = runStageOnBoard(state, null);
    LOGIC.internals.resolveBoard(ctx);
    const phases = phaseGroups(ctx.events);
    const cascade_phase = phases.find((phase) => phase.header.kind === 'clear' && phase.header.depth === 2);
    assert.ok(cascade_phase, 'a depth-2 cascade happened');
    assert.strictEqual(cascade_phase.header.multiplier, 1.5);
    const cascade_match = cascade_phase.events.find((event) => event.type === 'match' && event.cells.join() === '21,22,23');
    assert.ok(cascade_match, 'the 1-1-1 cascade match');
    const match_score = cascade_phase.events.find((event) => event.type === 'score' && event.reason === 'match' && event.cell === 22);
    assert.strictEqual(match_score.points, 90);
  });

  test('cascade', 'event replay reproduces the final board exactly (500 random moves)', (assert) => {
    let replayed_moves = 0;
    let game_index = 0;
    const levels = shippedLevels();
    while (replayed_moves < 500) {
      const level = levels[(game_index * 7) % levels.length];
      const rng = UTIL.createRng(9000 + game_index);
      let state = LOGIC.createGame(level, { seed: level.seed + game_index * 13 });
      while (state.status === 'playing' && replayed_moves < 500) {
        const move = LOGIC.chooseRandomMove(state, rng);
        const result = LOGIC.applySwap(state, move.from, move.to);
        const replayed = LOGIC.replayEvents(state, result.events);
        assert.strictEqual(LOGIC.boardSignature(replayed), LOGIC.boardSignature(result.state), `replay mismatch at move ${replayed_moves}`);
        state = result.state;
        replayed_moves += 1;
      }
      if (state.status === 'won') {
        const bonus = LOGIC.applyEndBonus(state);
        assert.strictEqual(LOGIC.boardSignature(LOGIC.replayEvents(state, bonus.events)), LOGIC.boardSignature(bonus.state), 'bonus replay');
      }
      game_index += 1;
    }
    assert.strictEqual(replayed_moves, 500);
  });

  // 9. Ingredients
  test('ingredients', 'a cherry reaching an exit is collected exactly once (+500)', (assert) => {
    const state = makeTestState(['. . . . .', '. . . . .', '. . . . .', '. . c . .', '. 0 0 0 .'], { exit_row: 4, goals: [{ type: 'ingredients', count: 1 }] });
    const cherry_id = state.cells[at(state, 3, 2)].id;
    const ctx = runStageOnBoard(state, null);
    LOGIC.internals.resolveBoard(ctx);
    const collects = ctx.events.filter((event) => event.type === 'collect');
    assert.strictEqual(collects.length, 1);
    assert.strictEqual(collects[0].piece_id, cherry_id);
    assert.strictEqual(state.ingredients_collected, 1);
    assert.ok(!state.cells.some((piece) => piece && piece.id === cherry_id), 'cherry left the board');
    assert.ok(ctx.events.some((event) => event.type === 'score' && event.reason === 'ingredient' && event.points === 500));
    assert.ok(LOGIC.goalsMet(state));
  });

  test('ingredients', 'blasts never destroy cherries', (assert) => {
    const state = makeTestState(['. . . . . .', '. . . . . .', 'c 0 0h 0 . c', '. . . . . .']);
    const ctx = runStageOnBoard(state, null);
    assert.strictEqual(state.cells[12].kind, KIND.CHERRY);
    assert.strictEqual(state.cells[17].kind, KIND.CHERRY);
    assert.ok(!ctx.events.some((event) => event.type === 'clear' && (event.cell === 12 || event.cell === 17)));
  });

  // 10. Frosting and jelly
  test('blockers', 'frosting loses one layer per stage even when touched twice; blasts crack it; removal refills', (assert) => {
    const state = makeTestState(['. . 0 . .', '. F 0 . .', '0 0 0 . .', '. . . . .', '. . . . .']);
    const ctx = runStageOnBoard(state, null);
    const frosting_events = ctx.events.filter((event) => event.type === 'frosting');
    assert.strictEqual(frosting_events.length, 1, 'one hit despite two adjacent matched cells');
    assert.strictEqual(state.cells[6].layers, 1);
    assert.ok(ctx.events.some((event) => event.type === 'score' && event.reason === 'frosting' && event.points === 150));
    const blast_state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0h 0 f F', '. . . . . .']);
    const blast_ctx = runStageOnBoard(blast_state, null);
    assert.deepStrictEqual(blast_ctx.events.filter((event) => event.type === 'frosting').map((event) => [event.cell, event.layers]), [[16, 0], [17, 1]]);
    assert.strictEqual(blast_state.cells[16], null, 'cracked-through frosting leaves an empty cell');
    LOGIC.internals.resolveBoard(blast_ctx);
    assert.ok(blast_state.cells[16] && blast_state.cells[16].kind === KIND.CANDY, 'and it refills');
  });

  test('blockers', 'jelly: double takes two stages, one blast + match on the same cell counts once', (assert) => {
    let state = makeTestState(['. . . . .', '. 0 0 0 .', '. . . . .'], { jelly: ['00000', '02100', '00000'] });
    let ctx = runStageOnBoard(state, null);
    assert.deepStrictEqual(Array.from(state.jelly), [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert.strictEqual(ctx.events.filter((event) => event.type === 'jelly').length, 2);
    assert.strictEqual(ctx.events.filter((event) => event.type === 'score' && event.reason === 'jelly').reduce((sum, event) => sum + event.points, 0), 200);
    state = makeTestState(['. . . . . .', '. 0 0h 0 . .', '. . . . . .'], { jelly: ['000000', '220022', '000000'] });
    ctx = runStageOnBoard(state, null);
    assert.deepStrictEqual(Array.from(state.jelly).slice(6, 12), [1, 1, 0, 0, 1, 1], 'each cell loses one layer even though match and blast both cover it');
  });

  // 11. Goals
  test('goals', 'every goal type and combinations', (assert) => {
    const state = makeTestState(['. . . .', '. . . .', '. . . .'], {
      goals: [{ type: 'score', target: 1000 }, { type: 'collect', color: 2, count: 3 }, { type: 'jelly' }, { type: 'ingredients', count: 1 }],
      jelly: ['0100', '0000', '0000'],
    });
    assert.ok(!LOGIC.goalsMet(state));
    state.score = 1000;
    state.collected[2] = 3;
    state.ingredients_collected = 1;
    assert.ok(!LOGIC.goalsMet(state), 'jelly still there');
    state.jelly[1] = 0;
    assert.ok(LOGIC.goalsMet(state));
    const progress = LOGIC.goalProgress(state);
    assert.deepStrictEqual(progress.map((goal) => goal.done), [true, true, true, true]);
  });

  test('goals', 'win only after cascades end; lose only at 0 moves; last-move win', (assert) => {
    let state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .', '. . . . .'], { goals: [{ type: 'score', target: 50 }], moves: 5 });
    let result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.strictEqual(result.state.status, 'won');
    const end_events = result.events.filter((event) => event.type === 'end');
    assert.strictEqual(end_events.length, 1);
    assert.strictEqual(result.events[result.events.length - 1].type, 'end', 'status decided after everything resolved');
    assert.ok(result.events.some((event) => event.type === 'phase' && event.kind === 'settle'), 'the board still settled before the win');
    assert.strictEqual(LOGIC.applySwap(result.state, 0, 1).valid, false, 'no moves after the level ended');

    state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . 1 . .', '. 1 . . .'], { goals: [{ type: 'score', target: 999999 }], moves: 2 });
    result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.strictEqual(result.state.status, 'playing', 'not lost with a move left');
    const hint = LOGIC.findHint(result.state);
    result = LOGIC.applySwap(result.state, hint.from, hint.to);
    assert.strictEqual(result.state.moves_left, 0);
    assert.strictEqual(result.state.status, 'lost', 'lost at 0 moves with the goal unmet');

    state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .', '. . . . .'], { goals: [{ type: 'score', target: 50 }], moves: 1 });
    result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.strictEqual(result.state.moves_left, 0);
    assert.strictEqual(result.state.status, 'won', 'a final move that completes the goal wins');
  });

  // 12. No moves, shuffle, hints
  test('shuffle', 'no-moves board reshuffles: specials, blockers, cherries and jelly stay; result has a move and no match', (assert) => {
    const state = makeTestState(['1 3 0 3 2', '1 3h 1 f 0', '0 2 1 1 3', '3 c 0 2 3', '3 3 2 1 1'], { jelly: ['00000', '00200', '00000', '01000', '00000'] });
    assert.ok(!LOGIC.hasValidMove(state), 'precondition: no valid move');
    assert.strictEqual(LOGIC.findMatchGroups(state).length, 0, 'precondition: no match');
    const fixed_before = state.cells.map((piece) => (piece && (piece.kind !== KIND.CANDY || piece.special !== SPECIAL.NONE) ? piece.id : null));
    const colors_before = state.cells.filter(LOGIC.isRegularCandy).map((piece) => piece.color).sort();
    const jelly_before = Array.from(state.jelly);
    const ctx = LOGIC.internals.createContext(state);
    LOGIC.internals.finishMove(ctx);
    assert.ok(ctx.events.some((event) => event.type === 'shuffle' || event.type === 'recolor'), 'shuffle happened');
    assert.ok(LOGIC.hasValidMove(state));
    assert.strictEqual(LOGIC.findMatchGroups(state).length, 0);
    const fixed_after = state.cells.map((piece) => (piece && (piece.kind !== KIND.CANDY || piece.special !== SPECIAL.NONE) ? piece.id : null));
    assert.deepStrictEqual(fixed_after, fixed_before);
    assert.deepStrictEqual(Array.from(state.jelly), jelly_before);
    if (ctx.events.some((event) => event.type === 'shuffle')) {
      assert.deepStrictEqual(state.cells.filter(LOGIC.isRegularCandy).map((piece) => piece.color).sort(), colors_before, 'a shuffle only moves candies');
    }
    assert.strictEqual(LOGIC.boardSignature(LOGIC.replayEvents(makeTestState(['1 3 0 3 2', '1 3h 1 f 0', '0 2 1 1 3', '3 c 0 2 3', '3 3 2 1 1'], { jelly: ['00000', '00200', '00000', '01000', '00000'] }), ctx.events)), LOGIC.boardSignature(state));
  });

  test('shuffle', 'hint finds a valid move and prefers one that makes a special', (assert) => {
    const state = makeTestState([
      '. . . . . .',
      '. . 0 . . .',
      '0 0 1 0 . .',
      '. . . . . .',
      '. . . . 2 .',
      '. . . 2 . 2',
    ]);
    const hint = LOGIC.findHint(state);
    assert.ok(LOGIC.isValidSwap(state, hint.from, hint.to));
    assert.deepStrictEqual([hint.from, hint.to].sort((a, b) => a - b), [at(state, 1, 2), at(state, 2, 2)], 'the 4-match (striped) beats the plain 3-match');
    shippedLevels().forEach((level) => {
      const level_state = LOGIC.createGame(level);
      const level_hint = LOGIC.findHint(level_state);
      assert.ok(level_hint && LOGIC.isValidSwap(level_state, level_hint.from, level_hint.to), `hint valid on level ${level.id}`);
      // What the hint highlights: the moving candy plus the candies it lines up with, as they sit now.
      const shown = LOGIC.hintFor(level_state, level_hint);
      assert.ok(shown.cells.length >= 3 && shown.cells.includes(shown.from), `hint highlights the whole match on level ${level.id}`);
      assert.ok(!shown.cells.includes(shown.to) || shown.cells.length >= 4, `hint target is not part of a plain 3-match on level ${level.id}`);
    });
    // The mover is found whichever way round the swap is given.
    const simple = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .', '. . . . .']);
    [[at(simple, 2, 2), at(simple, 1, 2)], [at(simple, 1, 2), at(simple, 2, 2)]].forEach(([from, to]) => {
      const shown = LOGIC.hintFor(simple, { from, to });
      assert.strictEqual(shown.from, at(simple, 1, 2), 'the red candy above is the one that moves');
      assert.strictEqual(shown.to, at(simple, 2, 2));
      assert.deepStrictEqual(shown.cells.slice().sort((a, b) => a - b), [at(simple, 1, 2), at(simple, 2, 0), at(simple, 2, 1)]);
    });
  });

  // 13. Scoring
  test('scoring', 'exact points for matches, specials, jelly, frosting, ingredients and the end bonus', (assert) => {
    assert.deepStrictEqual([3, 4, 5, 6, 7].map(LOGIC.matchPoints), [60, 120, 180, 240, 300]);
    const scored = (rows, from, to) => {
      const state = makeTestState(rows);
      return phaseScore(firstClearPhase(LOGIC.applySwap(state, at(state, from[0], from[1]), at(state, to[0], to[1])).events));
    };
    assert.strictEqual(scored(['. . . . . .', '. . 0 . . .', '0 0 1 . . .', '. . . . . .'], [1, 2], [2, 2]), 60, 'match of 3');
    assert.strictEqual(scored(['. . . . . .', '. . 0 . . .', '0 0 1 0 . .', '. . . . . .'], [1, 2], [2, 2]), 240, 'match of 4 + striped');
    assert.strictEqual(scored(['. . . . . .', '. . 0 . . .', '0 0 1 0 0 .', '. . . . . .'], [1, 2], [2, 2]), 480, 'match of 5 + color bomb');
    assert.strictEqual(scored(['. . 0 . . .', '. . 0 . . .', '0 0 1 . . .', '. . 0 . . .', '. . . . . .'], [3, 2], [2, 2]), 380, 'L of 5 + wrapped');
    const stripe_state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0h 0 . .', '. . . . . .']);
    assert.strictEqual(phaseScore({ events: runStageOnBoard(stripe_state, null).events }), 340, '3-match (60) + striped: 100 + 3 x 60');
    const won_state = LOGIC.createGame(LEVELS.getLevel(1));
    won_state.status = 'won';
    won_state.moves_left = 3;
    const bonus = LOGIC.applyEndBonus(won_state);
    const bonus_points = bonus.events.filter((event) => event.type === 'score' && event.reason === 'bonus');
    assert.deepStrictEqual(bonus_points.map((event) => event.points), [300, 300, 300]);
    assert.strictEqual(bonus.state.moves_left, 0);
    assert.ok(bonus.state.score > won_state.score + 900, 'plus the normal clear points');
    assert.deepStrictEqual([0, 1499, 1500, 3000, 4600].map((score) => LOGIC.starsForScore(score, [1500, 3000, 4500], true)), [1, 1, 1, 2, 3]);
    assert.strictEqual(LOGIC.starsForScore(5000, [1500, 3000, 4500], false), 0);
  });

  // 14. Mechanics (Tier 1 plugins)
  test('mechanics', 'every layout symbol belongs to exactly one mechanic plugin', (assert) => {
    const symbols = Object.keys(LOGIC.LAYOUT_LEGEND).sort();
    assert.deepStrictEqual(symbols, ['#', '.', '1', '2', '3', '4', '5', '<', '>', 'J', 'P', '^', 'b', 'c', 'h', 'j', 'k', 'o', 'p', 'v', 'x'].sort());
    const ids = LOGIC.MECHANICS.map((mechanic) => mechanic.id);
    assert.deepStrictEqual(ids, ['jelly', 'frosting', 'cage', 'cocoa', 'ingredients', 'portals', 'belt', 'fuse']);
  });

  test('mechanics', 'frosting 1-5 layers: one layer per stage from a match beside it or a blast', (assert) => {
    const state = makeTestState(['. . . . .', '. f5 . . .', '0 0 0 . .', '. . . . .']);
    const ctx = runStageOnBoard(state, null);
    assert.deepStrictEqual(ctx.events.filter((event) => event.type === 'frosting').map((event) => [event.cell, event.layers]), [[6, 4]]);
    assert.strictEqual(state.cells[6].layers, 4);
    assert.strictEqual(state.order.frosting, 1, 'each layer counts toward a frosting order');
    const level = { id: 'f', rows: 3, cols: 3, colors: 4, seed: 1, moves: 10, layout: ['...', '.5.', '...'], goals: [{ type: 'score', target: 100 }], stars: [1, 2, 3] };
    const created = LOGIC.createGame(level);
    assert.strictEqual(created.cells[4].kind, KIND.FROSTING);
    assert.strictEqual(created.cells[4].layers, 5, "layout '5' is five layers");
  });

  test('mechanics', 'Sugar Cage: no swapping, no falling; a match or blast breaks it and the candy stays', (assert) => {
    let state = makeTestState(['. . . . .', '. 0 . . .', '0 1k 0 . .', '. . . . .', '. . . . .']);
    assert.ok(!LOGIC.isValidSwap(state, at(state, 1, 1), at(state, 2, 1)), 'a caged candy cannot be swapped');
    state = makeTestState(['. . . . .', '. . 0 . .', '0 0k 1 . .', '. . . . .']);
    const caged_id = state.cells[at(state, 2, 1)].id;
    const result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.ok(result.valid, 'a swap that matches through a caged candy is valid');
    const phase = firstClearPhase(result.events);
    assert.ok(phase.events.some((event) => event.type === 'cage' && event.cell === at(state, 2, 1)), 'the cage breaks');
    assert.ok(!phase.events.some((event) => event.type === 'clear' && event.piece_id === caged_id), 'the candy inside is not cleared');
    assert.ok(result.state.cells.some((piece) => piece && piece.id === caged_id), 'the candy is still on the board');
    assert.strictEqual(result.state.cage[at(state, 2, 1)], 0);
    assert.strictEqual(result.state.order.cage, 1);
    const blast = makeTestState(['. . . . .', '. 0 0h 0 2k', '. . . . .']);
    const blast_ctx = runStageOnBoard(blast, null);
    assert.ok(blast_ctx.events.some((event) => event.type === 'cage' && event.cell === 9), 'a striped blast breaks the cage');
    assert.ok(blast.cells[9] && blast.cells[9].color === 2 && blast.cage[9] === 0);
    const hold = makeTestState(['. . .', '. 1k .', '. _ .', '. . .']);
    const held_id = hold.cells[4].id;
    const settle_ctx = LOGIC.internals.createContext(hold);
    LOGIC.internals.settleBoard(settle_ctx);
    assert.strictEqual(hold.cells[4].id, held_id, 'the caged candy does not fall');
    assert.ok(hold.cells[7] && hold.cells[7].kind === KIND.CANDY, 'the cell below fills diagonally');
    assert.deepStrictEqual(LOGIC.checkBoardInvariants(hold).filter((problem) => problem.indexOf('match') < 0 && problem.indexOf('valid move') < 0), []);
  });

  test('mechanics', 'Cocoa Creep: a match beside it clears it; it spreads one cell after a move that clears none', (assert) => {
    const state = makeTestState(['. . . . .', '. o . . .', '0 0 0 . .', '. . . . .']);
    const ctx = runStageOnBoard(state, null);
    assert.strictEqual(ctx.events.filter((event) => event.type === 'cocoa').length, 1);
    assert.strictEqual(state.cells[at(state, 1, 1)], null);
    assert.strictEqual(state.order.cocoa, 1);
    assert.ok(ctx.events.some((event) => event.type === 'score' && event.reason === 'cocoa' && event.points === 150));
    const spreading = makeTestState(['o . . . . .', '. . . . . .', '. . . . . .', '. . . . 1 .', '. . . 1 0 1']);
    const spread = LOGIC.applySwap(spreading, at(spreading, 3, 4), at(spreading, 4, 4));
    assert.ok(spread.valid);
    const spread_event = spread.events.find((event) => event.type === 'cocoa_spread');
    assert.ok(spread_event, 'cocoa spread after a move that cleared none');
    assert.strictEqual(spread_event.from, 0);
    assert.ok(spread_event.cell === 1 || spread_event.cell === 6, 'into an orthogonal neighbor');
    assert.strictEqual(countKind(spread.state, KIND.COCOA), 2);
    assert.strictEqual(LOGIC.boardSignature(LOGIC.replayEvents(spreading, spread.events)), LOGIC.boardSignature(spread.state), 'spread replays');
    const sealed = makeTestState(['. . . .', 'o o o o', '. _ . .', '. . . .']);
    LOGIC.internals.settleBoard(LOGIC.internals.createContext(sealed));
    assert.strictEqual(sealed.cells[at(sealed, 2, 1)], null, 'a cell under a full row of cocoa cannot be refilled');
    assert.deepStrictEqual(LOGIC.checkBoardInvariants(sealed).filter((problem) => problem.indexOf('valid move') < 0), [], 'and that is not a broken board');
    sealed.cells[at(sealed, 1, 1)] = null;
    LOGIC.internals.settleBoard(LOGIC.internals.createContext(sealed));
    assert.ok(sealed.cells[at(sealed, 2, 1)] && sealed.cells[at(sealed, 1, 1)], 'clearing the cocoa above lets candies fall in');
    const half = makeTestState(['o o o o', 'o o o o', '. . 0 .', '0 0 1 .']);
    const capped = LOGIC.applySwap(half, at(half, 2, 2), at(half, 3, 2));
    assert.ok(capped.valid && !capped.events.some((event) => event.type === 'cocoa_spread'), 'cocoa stops spreading at half of the board');
    const smothered = makeTestState(['o o o', 'o 0 o', 'o o o']);
    const smothered_ctx = LOGIC.internals.createContext(smothered);
    LOGIC.internals.finishMove(smothered_ctx);
    assert.strictEqual(smothered.status, 'lost', 'a board with no possible move at all ends the level');
    assert.strictEqual(smothered.loss_reason, 'no_moves');
    assert.strictEqual(LOGIC.addMoves(smothered, 5).status, 'lost', '+5 Moves cannot revive it');
    const cleaning = makeTestState(['. . . . .', 'o . 0 . .', '0 0 1 . .', '. . . . .']);
    const cleaned = LOGIC.applySwap(cleaning, at(cleaning, 1, 2), at(cleaning, 2, 2));
    assert.ok(!cleaned.events.some((event) => event.type === 'cocoa_spread'), 'no spread after a move that cleared cocoa');
  });

  test('mechanics', 'Fuse Candy: ticks down after every move, loses the level at zero, defused by clearing it', (assert) => {
    let state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .', '2b2 . . . .']);
    let result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    const tick = result.events.find((event) => event.type === 'fuse');
    assert.ok(tick, 'the fuse ticks');
    assert.strictEqual(tick.fuse, 1);
    assert.strictEqual(result.state.status, 'playing');
    state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .', '2b1 . . . .']);
    result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.ok(result.events.some((event) => event.type === 'fuse_out'), 'a fuse reaching zero goes off');
    assert.strictEqual(result.state.status, 'lost');
    assert.strictEqual(result.state.loss_reason, 'fuse');
    state = makeTestState(['. . 1 . .', '1b1 1 0 . .', '. . . . .', '. . . . .']);
    result = LOGIC.applySwap(state, at(state, 0, 2), at(state, 1, 2));
    assert.ok(!result.events.some((event) => event.type === 'fuse_out'), 'matching the Fuse Candy defuses it');
    assert.strictEqual(result.state.status, 'playing');
    state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .', '2b1 . . . .'], { goals: [{ type: 'score', target: 50 }] });
    result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.strictEqual(result.state.status, 'won', 'a move that wins does not tick fuses');
  });

  test('mechanics', 'Sugar Belt: pieces shift one cell along the arrows after each move, wrapping around', (assert) => {
    const rows = ['. . . . .', '. . . . .', '. . . . .', '. . 0 . .', '0 0 1 . .'];
    const state = makeTestState(rows, { layout: ['.....', '>>>>>', '.....', '.....', '.....'] });
    const before = [5, 6, 7, 8, 9].map((cell) => state.cells[cell].id);
    const ctx = LOGIC.internals.createContext(state);
    LOGIC.internals.finishMove(ctx);
    const after = [5, 6, 7, 8, 9].map((cell) => state.cells[cell].id);
    assert.deepStrictEqual(after, [before[4], before[0], before[1], before[2], before[3]], 'rightward belt rotates right');
    const belt_event = ctx.events.find((event) => event.type === 'belt');
    assert.strictEqual(belt_event.moves.length, 5);
    const left = makeTestState(rows, { layout: ['.....', '<<<<<', '.....', '.....', '.....'] });
    const left_before = [5, 6, 7, 8, 9].map((cell) => left.cells[cell].id);
    LOGIC.internals.finishMove(LOGIC.internals.createContext(left));
    assert.deepStrictEqual([5, 6, 7, 8, 9].map((cell) => left.cells[cell].id), [left_before[1], left_before[2], left_before[3], left_before[4], left_before[0]], 'leftward belt rotates left');
    const level = { id: 'b', rows: 5, cols: 5, colors: 4, seed: 3, moves: 10, layout: ['.....', '.v...', '.v...', '.....', '.....'], goals: [{ type: 'score', target: 100 }], stars: [1, 2, 3] };
    assert.deepStrictEqual(LOGIC.validateLevel(level), []);
    assert.ok(LOGIC.validateLevel(Object.assign({}, level, { layout: ['.....', '.v...', '.....', '.....', '.....'] })).some((problem) => problem.indexOf('at least 2 cells') >= 0), 'a one-cell belt is rejected');
  });

  test('mechanics', 'Portals: a piece that cannot fall drops out of the paired exit; exits never spawn', (assert) => {
    const tokens = ['. . . . .', '. # . . .', '. _ . . .', '. . . . .'];
    const state = makeTestState(tokens, { layout: ['.p...', '.#...', '.P...', '.....'], meta: { portals: [{ in: [0, 1], out: [2, 1] }] } });
    const traveller = state.cells[1].id;
    const ctx = LOGIC.internals.createContext(state);
    LOGIC.internals.settleBoard(ctx);
    const fall = ctx.events.find((event) => event.type === 'fall' && event.piece_id === traveller);
    assert.ok(fall, 'the piece in the entrance moved');
    assert.strictEqual(fall.to, at(state, 2, 1), 'out of the exit');
    assert.ok(fall.path.some((point) => point[3] === 1), 'the path marks the teleport');
    assert.ok(state.cells[1] && state.cells[1].kind === KIND.CANDY, 'the entrance refills from above');
    assert.strictEqual(state.spawn_cells[1], 1, 'the column spawns at the top, not at the exit');
    const bad = { id: 'p', rows: 4, cols: 5, colors: 4, seed: 1, moves: 10, layout: ['.P...', '.#...', '.p...', '.....'], meta: { portals: [{ in: [2, 1], out: [0, 1] }] }, goals: [{ type: 'score', target: 100 }], stars: [1, 2, 3] };
    assert.ok(LOGIC.validateLevel(bad).some((problem) => problem.indexOf('lower row') >= 0), 'an exit above its entrance is rejected');
  });

  test('mechanics', 'hazelnuts are ingredients: collected at a tray, never destroyed', (assert) => {
    const state = makeTestState(['. . . . .', '. . . . .', '. . n . .', '. 0 0 0 .'], { exit_row: 3, goals: [{ type: 'ingredients', count: 1 }] });
    const ctx = runStageOnBoard(state, null);
    LOGIC.internals.resolveBoard(ctx);
    const collect = ctx.events.find((event) => event.type === 'collect');
    assert.ok(collect && collect.kind === KIND.HAZELNUT);
    assert.strictEqual(state.ingredients_collected, 1);
    assert.ok(LOGIC.goalsMet(state));
    const blast = makeTestState(['. . . . . .', 'n 0 0h 0 . c', '. . . . . .']);
    runStageOnBoard(blast, null);
    assert.strictEqual(blast.cells[6].kind, KIND.HAZELNUT);
    assert.strictEqual(blast.cells[11].kind, KIND.CHERRY);
  });

  // 15. Modes
  test('modes', 'timed: no moves are spent, specials add 2 seconds, the clock decides; +15 s revives', (assert) => {
    const state = makeTestState(['. . . . . .', '. . 0 . . .', '0 0 1 0 . .', '. . . . . .'], { time: 60, goals: [{ type: 'score', target: 100000 }] });
    assert.ok(state.timed);
    assert.strictEqual(state.moves_left, Infinity);
    const result = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2));
    assert.strictEqual(result.state.moves_left, Infinity, 'timed moves are free');
    assert.strictEqual(result.state.moves_made, 1);
    const bonus = result.events.filter((event) => event.type === 'time_bonus');
    assert.ok(bonus.length >= 1 && bonus.every((event) => event.seconds === 2), 'each special adds 2 seconds');
    assert.strictEqual(result.state.time_bonus, 2 * bonus.length);
    const expired = LOGIC.expireTime(result.state);
    assert.strictEqual(expired.status, 'lost');
    assert.strictEqual(expired.loss_reason, 'time');
    const revived = LOGIC.addMoves(expired, 5);
    assert.strictEqual(revived.status, 'playing');
    assert.strictEqual(revived.time_limit, 75);
    const met = LOGIC.cloneState(result.state);
    met.score = 100000;
    assert.strictEqual(LOGIC.expireTime(met).status, 'won', 'the goal met when the clock ends is a win');
    met.status = 'won';
    const finale = LOGIC.applyEndBonus(met, { seconds_left: 40 });
    assert.strictEqual(finale.events.filter((event) => event.type === 'score' && event.reason === 'bonus').length, LOGIC.SCORING.FINALE_MAX_STRIKES_TIMED, 'Sweet Finale strikes are capped in timed levels');
  });

  test('modes', 'moves: +5 Moves revives a level lost on moves, not one lost to a fuse', (assert) => {
    const state = makeTestState(['. . . . .', '. . 0 . .', '0 0 1 . .', '. . . . .'], { moves: 1, goals: [{ type: 'score', target: 999999 }] });
    const lost = LOGIC.applySwap(state, at(state, 1, 2), at(state, 2, 2)).state;
    assert.strictEqual(lost.status, 'lost');
    const revived = LOGIC.addMoves(lost, 5);
    assert.strictEqual(revived.status, 'playing');
    assert.strictEqual(revived.moves_left, 5);
    const fused = LOGIC.cloneState(lost);
    fused.loss_reason = 'fuse';
    assert.strictEqual(LOGIC.addMoves(fused, 5).status, 'lost');
  });

  test('modes', 'every goal mode and the order items count what they say', (assert) => {
    assert.deepStrictEqual(LOGIC.GOAL_TYPES.slice().sort(), ['collect', 'ingredients', 'jelly', 'order', 'score']);
    assert.deepStrictEqual(LOGIC.ORDER_ITEMS.slice().sort(), ['bomb', 'cage', 'cocoa', 'frosting', 'striped', 'wrapped']);
    const state = makeTestState(['. . . . . .', '. . . . . .', '. 0 0h 0 . .', '. . . . . .'], { goals: [{ type: 'order', item: 'striped', count: 1 }] });
    runStageOnBoard(state, null);
    assert.strictEqual(state.order.striped, 1, 'a striped candy counts when it fires');
    assert.ok(LOGIC.goalsMet(state));
    const progress = LOGIC.goalProgress(state)[0];
    assert.deepStrictEqual([progress.type, progress.item, progress.current, progress.target, progress.done], ['order', 'striped', 1, 1, true]);
  });

  // 16. Hint
  test('hint', 'the hint is the best move by [win now, goal progress, specials, largest match, lowest row, leftmost]', (assert) => {
    assert.strictEqual(LOGIC.compareRanks([1, 0, 0, 3, 0, 0], [0, 9, 9, 9, 9, 0]), 1, 'winning now beats everything');
    assert.strictEqual(LOGIC.compareRanks([0, 0.5, 0, 3, 0, 0], [0, 0.4, 5, 5, 9, 0]), 1, 'goal progress beats specials');
    assert.strictEqual(LOGIC.compareRanks([0, 0, 1, 3, 0, 0], [0, 0, 0, 5, 9, 0]), 1, 'specials beat a bigger match');
    assert.strictEqual(LOGIC.compareRanks([0, 0, 0, 3, 5, -2], [0, 0, 0, 3, 4, 0]), 1, 'lower row first');
    assert.strictEqual(LOGIC.compareRanks([0, 0, 0, 3, 5, -1], [0, 0, 0, 3, 5, -2]), 1, 'then left to right');
    const board = ['. . . . . .', '. . 0 . . .', '0 0 1 0 . .', '. . . . . .', '. . . . 2 .', '. . . 2 . 2'];
    // Collect goal: the 2-2-2 move wins at once, so it beats the striped candy.
    let state = makeTestState(board, { goals: [{ type: 'collect', color: 2, count: 3 }] });
    let hint = LOGIC.findHint(state);
    assert.deepStrictEqual(sortedNumbers([hint.from, hint.to]), [at(state, 4, 4), at(state, 5, 4)], 'win now');
    // Score goal only: the striped candy (a special) is the best.
    state = makeTestState(board);
    hint = LOGIC.findHint(state);
    assert.deepStrictEqual(sortedNumbers([hint.from, hint.to]), [at(state, 1, 2), at(state, 2, 2)], 'specials first on a score level');
    // The chosen hint is never outranked by another move.
    shippedLevels().filter((level, index) => index % 5 === 0).forEach((level) => {
      const level_state = LOGIC.createGame(level);
      const ranks = LOGIC.hintRanks(level_state);
      const chosen = LOGIC.findHint(level_state);
      const chosen_rank = ranks.find((entry) => entry.move.from === chosen.from && entry.move.to === chosen.to).rank;
      ranks.forEach((entry) => assert.ok(LOGIC.compareRanks(entry.rank, chosen_rank) <= 0, `level ${level.id}: a better move than the hint`));
    });
  });

  test('hint', 'the hint saves a Fuse Candy about to go off and is fast (under 50 ms)', (assert) => {
    const state = makeTestState(['. . 1 . . .', '1b2 1 0 . . .', '. . . . . .', '. . . . . .', '. . 2 . . .', '2 2 0 2 . .']);
    const hint = LOGIC.findHint(state);
    assert.deepStrictEqual(sortedNumbers([hint.from, hint.to]), [at(state, 0, 2), at(state, 1, 2)], 'clear the fuse rather than make a bigger match');
    let slowest = 0;
    shippedLevels().forEach((level) => {
      const level_state = LOGIC.createGame(level);
      slowest = Math.max(slowest, medianMs(() => LOGIC.findHint(level_state)));
    });
    assert.ok(slowest < 50, `slowest hint took ${slowest} ms`);
  });

  // 17. Boosters
  test('boosters', 'Sweet Hammer: clears a candy, fires a special, cracks a layer, breaks a cage; ingredients refuse; no move spent', (assert) => {
    let state = makeTestState(['. . . . .', '. . . . .', '. . 0 . .', '. . . . .']);
    let result = LOGIC.applyHammer(state, at(state, 2, 2));
    assert.ok(result.valid);
    assert.ok(result.events.some((event) => event.type === 'clear' && event.cell === at(state, 2, 2)));
    assert.strictEqual(result.state.moves_left, state.moves_left);
    assert.deepStrictEqual(LOGIC.checkBoardInvariants(result.state).filter((problem) => problem.indexOf('valid move') < 0), []);
    state = makeTestState(['. . . . .', '. . . . .', '. . 0h . .', '. . . . .']);
    result = LOGIC.applyHammer(state, at(state, 2, 2));
    assert.ok(result.events.some((event) => event.type === 'activate' && event.kind === 'row'), 'a special fires');
    state = makeTestState(['0 0 . 0 .', '. . F . .', '. . 1k . .', '. . c . .']);
    result = LOGIC.applyHammer(state, at(state, 1, 2));
    assert.strictEqual(result.state.cells[at(state, 1, 2)].layers, 1, 'one frosting layer');
    result = LOGIC.applyHammer(state, at(state, 2, 2));
    assert.strictEqual(result.state.cage[at(state, 2, 2)], 0, 'the cage breaks');
    assert.strictEqual(result.state.cells[at(state, 2, 2)].id, state.cells[at(state, 2, 2)].id, 'the candy stays');
    assert.strictEqual(LOGIC.applyHammer(state, at(state, 3, 2)).valid, false, 'ingredients cannot be hammered');
  });

  test('boosters', 'Free Swap, Candy Whirl, pre-level boosters and +5 Moves', (assert) => {
    let state = makeTestState(['. . . . .', '. . . . .', '. 0h 1 . .', '. . . . .']);
    let result = LOGIC.applyFreeSwap(state, at(state, 0, 0), at(state, 0, 1));
    assert.ok(result.valid, 'free swap needs no match');
    assert.strictEqual(result.state.cells[at(state, 0, 1)].id, state.cells[at(state, 0, 0)].id);
    assert.strictEqual(result.state.moves_left, state.moves_left, 'no move spent');
    const caged = makeTestState(['. 0k . . .', '. . . . .', '. . . . .']);
    assert.strictEqual(LOGIC.applyFreeSwap(caged, 0, 1).valid, false, 'caged candies cannot be free-swapped');
    const whirled = LOGIC.applyWhirl(state);
    assert.ok(whirled.valid && LOGIC.hasValidMove(whirled.state) && LOGIC.findMatchGroups(whirled.state).length === 0);
    assert.ok(whirled.state.cells.some((piece) => piece && piece.special === SPECIAL.STRIPE_ROW), 'specials stay');
    assert.strictEqual(whirled.state.moves_left, state.moves_left);
    const level = LEVELS.getLevel(4);
    const fresh = LOGIC.createGame(level);
    const boosted = LOGIC.applyStartBoosters(fresh, { lucky: true, rainbow: true, head_start: true }).state;
    const specials = boosted.cells.filter((piece) => piece && piece.special !== SPECIAL.NONE).map((piece) => (piece.special === SPECIAL.STRIPE_COL ? SPECIAL.STRIPE_ROW : piece.special));
    assert.deepStrictEqual(specials.sort(), [SPECIAL.BOMB, SPECIAL.STRIPE_ROW, SPECIAL.WRAPPED].sort(), 'Lucky Start + Rainbow Start');
    assert.strictEqual(boosted.moves_left, fresh.moves_left + 3, 'Head Start adds 3 moves');
    assert.strictEqual(LOGIC.boardSignature(LOGIC.applyStartBoosters(fresh, { lucky: true, rainbow: true }).state), LOGIC.boardSignature(LOGIC.applyStartBoosters(fresh, { lucky: true, rainbow: true }).state), 'deterministic');
    assert.deepStrictEqual(LOGIC.checkBoardInvariants(boosted).filter((problem) => problem.indexOf('match') < 0), []);
  });

  // 18. Level registry
  test('levels', 'packs of 100, getLevel for 1-99,999, roles, the difficulty curve and episodes', (assert) => {
    assert.deepStrictEqual([1, 100, 101, 20000, 99999].map(LEVELS.packOf), [1, 1, 2, 200, 1000]);
    assert.strictEqual(LEVELS.packFileName(7), 'pack-0007.js');
    assert.strictEqual(LEVELS.getLevel(0), null);
    assert.strictEqual(LEVELS.getLevel(LEVELS.shippedCount() + 1), null, 'levels past the shipped count do not exist yet');
    assert.strictEqual(LEVELS.getLevel(100000), null);
    assert.strictEqual(LEVELS.getLevel(1.5), null);
    for (let level_number = 1; level_number <= LEVELS.shippedCount(); level_number += 1) assert.strictEqual(LEVELS.getLevel(level_number).id, level_number);
    assert.deepStrictEqual([30, 31, 45, 46, 150, 151, 225, 27, 33].map(LEVELS.scheduledRole), ['hard', 'breather', 'hard', 'breather', 'superhard', 'breather', 'superhard', 'breather', 'normal']);
    const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} vs ${expected}`);
    close(LEVELS.baseWinRate(400), 0.95 - 0.6 * (1 - Math.exp(-1)), 'target(400)');
    close(LEVELS.baseWinRate(20000), 0.95 - 0.6 * (1 - Math.exp(-50)), 'target(20000)');
    assert.ok(LEVELS.baseWinRate(99999) >= 0.3 && LEVELS.baseWinRate(1) <= 0.95, 'clamped to 0.30-0.95');
    close(LEVELS.targetWinRate(400, 'breather'), Math.min(0.9, LEVELS.baseWinRate(400) + 0.15), 'breather +0.15');
    close(LEVELS.targetWinRate(400, 'hard'), LEVELS.baseWinRate(400) - 0.15, 'hard -0.15');
    close(LEVELS.targetWinRate(20000, 'superhard'), Math.max(0.1, LEVELS.baseWinRate(20000) - 0.25), 'superhard -0.25');
    assert.deepStrictEqual([1, 15, 16, 20000].map(LEVELS.episodeOf), [1, 1, 2, 1334]);
    assert.deepStrictEqual(LEVELS.episodeRange(2), { first: 16, last: 30 });
    assert.strictEqual(LEVELS.SCENERY_FAMILIES.length, 12);
    const families = new Set();
    for (let episode = 1; episode <= 12; episode += 1) families.add(LEVELS.sceneryOf(episode).family);
    assert.strictEqual(families.size, 12, 'twelve episodes, twelve scenery families');
    assert.strictEqual(LEVELS.episodeName(77), LEVELS.episodeName(77), 'names are deterministic');
    assert.ok(/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(LEVELS.episodeName(1234)));
  });

  // 19. Meta game
  test('meta', 'hearts: one refills every 30 minutes, at most 5, a loss costs one, the clock moving back awards nothing', (assert) => {
    const save = STORAGE.defaultSave();
    const start = Date.UTC(2026, 0, 1, 12, 0, 0);
    const minutes = (count) => count * 60 * 1000;
    META.refreshHearts(save.meta, start);
    assert.strictEqual(save.meta.hearts, 5);
    assert.ok(META.spendHeart(save, start), 'a loss costs a heart');
    assert.ok(META.spendHeart(save, start + minutes(1)));
    assert.strictEqual(save.meta.hearts, 3);
    assert.strictEqual(META.nextHeartIn(save.meta, start + minutes(10)), minutes(20));
    META.refreshHearts(save.meta, start + minutes(29));
    assert.strictEqual(save.meta.hearts, 3, 'not yet');
    META.refreshHearts(save.meta, start + minutes(30));
    assert.strictEqual(save.meta.hearts, 4, 'one heart after 30 minutes');
    META.refreshHearts(save.meta, start + minutes(500));
    assert.strictEqual(save.meta.hearts, 5, 'never above 5');
    // Clock tampering: spend down, move the clock back a day, then forward to the old time: nothing extra.
    for (let spent = 0; spent < 5; spent += 1) META.spendHeart(save, start + minutes(600));
    assert.strictEqual(save.meta.hearts, 0);
    assert.ok(!META.canPlay(save, start + minutes(601)), 'no hearts, no play');
    META.refreshHearts(save.meta, start + minutes(600) - minutes(24 * 60));
    assert.strictEqual(save.meta.hearts, 0, 'moving the clock back awards nothing');
    META.refreshHearts(save.meta, start + minutes(600) - minutes(24 * 60) + minutes(31));
    assert.strictEqual(save.meta.hearts, 1, 'refilling restarts from the new time');
    save.settings.unlimited_hearts = true;
    assert.ok(META.canPlay(save, start), 'Unlimited hearts lets you always play');
    assert.strictEqual(META.spendHeart(save, start), false, 'and never costs one');
  });

  test('meta', 'Gold Drops, boosters, the Daily Wheel once per local day, Sweet Streak and the Star Chest', (assert) => {
    const save = STORAGE.defaultSave();
    const now = new Date(2026, 4, 3, 10, 0, 0).getTime();
    assert.strictEqual(save.meta.gold, 100);
    assert.ok(META.useBooster(save.meta, 'hammer'));
    assert.strictEqual(save.meta.boosters.hammer, 2);
    assert.ok(META.buy(save.meta, 'hammer'), 'buy a hammer for 60 drops');
    assert.strictEqual(save.meta.gold, 40);
    assert.strictEqual(save.meta.boosters.hammer, 3);
    assert.ok(!META.buy(save.meta, 'rainbow'), 'not enough drops');
    save.meta.boosters.whirl = 0;
    assert.ok(!META.useBooster(save.meta, 'whirl'), 'none left');
    const spin = META.spinWheel(save.meta, now);
    assert.ok(spin && META.WHEEL[spin.index] === spin.reward);
    assert.strictEqual(META.spinWheel(save.meta, now + 3600 * 1000), null, 'one spin per day');
    assert.ok(!META.canSpin(save.meta, now + 3600 * 1000));
    assert.ok(META.canSpin(save.meta, new Date(2026, 4, 4, 0, 5, 0).getTime()), 'again after local midnight');
    save.meta.streak = 0;
    const lucky_before = save.meta.boosters.lucky;
    META.recordOutcome(save, { won: true, new_stars: 3 }, 3);
    META.recordOutcome(save, { won: true, new_stars: 0 }, 3);
    const third = META.recordOutcome(save, { won: true, new_stars: 1 }, 4);
    assert.strictEqual(third.streak_reward, 'lucky', 'every third win in a row grants a pre-level booster');
    assert.strictEqual(save.meta.boosters.lucky, lucky_before + 1);
    assert.strictEqual(third.gold, 15, '5 drops per win plus 10 per new star');
    META.recordOutcome(save, { won: false }, 4);
    assert.strictEqual(save.meta.streak, 0, 'a loss resets the streak');
    assert.ok(!META.chestReady(save.meta, 24));
    assert.ok(META.chestReady(save.meta, 25));
    const prize = META.openChest(save.meta, 26, now);
    assert.ok(prize && META.CHEST.indexOf(prize) >= 0);
    assert.strictEqual(META.openChest(save.meta, 26, now), null, 'the next chest needs 25 more stars');
    assert.strictEqual(META.chestProgress(save.meta, 40), 15);
  });

  test('hint', 'auto hint: Instant shows within 400 ms of idle, 3 s and 8 s wait, Off never; the button is immediate (fake timers)', (assert) => {
    let clock = 0;
    let queue = [];
    let next_handle = 1;
    const timers = {
      set(run, ms) {
        const handle = next_handle;
        next_handle += 1;
        queue.push({ handle, at: clock + ms, run });
        return handle;
      },
      clear(handle) {
        queue = queue.filter((entry) => entry.handle !== handle);
      },
    };
    const advance = (ms) => {
      const until = clock + ms;
      queue.sort((a, b) => a.at - b.at);
      while (queue.length && queue[0].at <= until) {
        const entry = queue.shift();
        clock = entry.at;
        entry.run();
      }
      clock = until;
    };
    const shown = [];
    const scheduler = META.createHintScheduler(timers, CONFIG.AUTO_HINT_DELAYS, (source) => shown.push({ source, at: clock }));
    scheduler.setMode('instant');
    scheduler.idle();
    advance(399);
    assert.strictEqual(shown.length, 1, 'Instant: shown within 400 ms of the board settling');
    assert.strictEqual(shown[0].source, 'auto');
    scheduler.setMode('3s');
    scheduler.idle();
    advance(2999);
    assert.strictEqual(shown.length, 1);
    advance(1);
    assert.strictEqual(shown.length, 2, 'after 3 s');
    scheduler.setMode('8s');
    scheduler.idle();
    advance(5000);
    scheduler.touch();
    advance(10000);
    assert.strictEqual(shown.length, 2, 'touching the board drops the pending hint');
    scheduler.setMode('off');
    scheduler.idle();
    advance(60000);
    assert.strictEqual(shown.length, 2, 'Off never shows by itself');
    scheduler.button();
    assert.strictEqual(shown.length, 3, 'the Hint button shows at once');
    assert.strictEqual(shown[2].source, 'button');
    // The button's work (finding the move) is well under 50 ms on every shipped level's opening board.
    shippedLevels().forEach((level) => {
      const state = LOGIC.createGame(level);
      const elapsed = medianMs(() => LOGIC.hintFor(state, LOGIC.findHint(state)));
      assert.ok(elapsed < 50, `level ${level.id} hint took ${elapsed} ms`);
    });
    assert.strictEqual(LOGIC.findHint(makeTestState(['o o o', 'o 0 o', 'o o o'])), null, 'no hint when no move exists');
  });

  // 20. Storage
  test('storage', 'round-trip, corrupted JSON fallback, v1-v3 migration, defaults for missing keys', (assert) => {
    const save = STORAGE.defaultSave();
    save.player_name = 'Florin';
    save.settings.theme = 'hard';
    save.meta.boosters.hammer = 7;
    STORAGE.recordResult(save, 1, { won: true, score: 4005, stars: 2 });
    STORAGE.recordResult(save, 2, { won: false, score: 900, stars: 0 });
    const round_trip = STORAGE.parseSave(STORAGE.serializeSave(save));
    assert.strictEqual(round_trip.recovered, false);
    assert.deepStrictEqual(round_trip.save, STORAGE.normalizeSave(save));
    assert.strictEqual(round_trip.save.unlocked, 2);
    assert.deepStrictEqual(STORAGE.levelBest(round_trip.save, 1), { stars: 2, score: 4000 }, 'best scores are kept to the ten');
    assert.deepStrictEqual(STORAGE.levelBest(round_trip.save, 2), { stars: 0, score: 0 }, 'a loss records nothing');
    assert.strictEqual(round_trip.save.meta.boosters.hammer, 7);
    assert.strictEqual(round_trip.save.meta.total_attempts, 2);
    ['{not json', '[1,2,3]', 'null', '"text"'].forEach((corrupt_text) => {
      const parsed = STORAGE.parseSave(corrupt_text);
      assert.strictEqual(parsed.recovered, true, corrupt_text);
      assert.deepStrictEqual(parsed.save, STORAGE.defaultSave());
    });
    const bad_progress = STORAGE.parseSave(JSON.stringify({ version: 4, unlocked: 3, progress: '!!not base64!!' }));
    assert.deepStrictEqual(bad_progress.save.progress, { stars: [], scores: [] }, 'a damaged progress string falls back to empty');
    assert.strictEqual(bad_progress.save.unlocked, 3);
    const migrated = STORAGE.parseSave(JSON.stringify({ version: 1, sound: false, music: true, unlocked: 4, name: 'Ana', best: { 1: { score: 2000, stars: 3 }, 3: { score: 9000, stars: 1 } } })).save;
    assert.strictEqual(migrated.version, STORAGE.SAVE_VERSION);
    assert.strictEqual(migrated.unlocked, 4);
    assert.strictEqual(migrated.player_name, 'Ana');
    assert.strictEqual(migrated.settings.sound_on, false);
    assert.deepStrictEqual(STORAGE.levelBest(migrated, 3), { stars: 1, score: 9000 });
    const v3 = STORAGE.parseSave(JSON.stringify({ version: 3, unlocked: 3, settings: { theme: 'classic', sfx_on: true, sfx_volume: 1, music_volume: 1 }, levels: { 2: { best_score: 5000, best_stars: 3, attempts: 4, wins: 1 } } })).save;
    assert.strictEqual(v3.settings.theme, 'gummy', 'the retired Classic theme maps to Gummy');
    assert.strictEqual(v3.settings.master_volume, 0.7, 'old loud volumes reset to the gentle defaults');
    assert.strictEqual(v3.settings.effects_volume, 0.6);
    assert.strictEqual(v3.settings.music_volume, 0.35);
    assert.deepStrictEqual(STORAGE.levelBest(v3, 2), { stars: 3, score: 5000 });
    assert.strictEqual(STORAGE.defaultSave().settings.theme, 'gummy');
    assert.strictEqual(STORAGE.defaultSave().settings.auto_hint, 'instant');
    assert.strictEqual(STORAGE.defaultSave().settings.soft_sounds, true);
    assert.deepStrictEqual(STORAGE.IN_LEVEL_BOOSTERS.map((booster) => STORAGE.defaultSave().meta.boosters[booster]), [3, 3, 3], 'three of each in-level booster to start');
    const partial = STORAGE.parseSave(JSON.stringify({ version: 4, settings: { theme: 'sprinkle', effects_volume: 7, accent: 'neon', auto_hint: 'sometimes' }, meta: { hearts: 99, gold: -5 } })).save;
    assert.strictEqual(partial.settings.theme, 'sprinkle');
    assert.strictEqual(partial.settings.effects_volume, 1, 'clamped');
    assert.strictEqual(partial.settings.accent, 'bubblegum', 'unknown accent falls back');
    assert.strictEqual(partial.settings.auto_hint, 'instant', 'unknown hint mode falls back');
    assert.strictEqual(partial.settings.music_on, true, 'missing key gets its default');
    assert.strictEqual(partial.meta.hearts, STORAGE.MAX_HEARTS);
    assert.strictEqual(partial.meta.gold, 0);
    assert.strictEqual(STORAGE.cleanText('<b>Hi</b>\n', 16), 'bHi/b');
  });

  test('storage', 'a save with 20,000 completed levels is under 100 KB and loads in under 50 ms', (assert) => {
    const save = STORAGE.defaultSave();
    for (let level_number = 1; level_number <= 20000; level_number += 1) {
      STORAGE.recordResult(save, level_number, { won: true, score: 18000 + ((level_number * 7919) % 60000), stars: 1 + (level_number % 3) });
    }
    const text = STORAGE.serializeSave(save);
    assert.ok(text.length < 100 * 1024, `save is ${text.length} bytes`);
    // Building that save leaves a lot of garbage behind, so time the load as a median of three (see medianMs).
    let loaded = null;
    const elapsed = medianMs(() => {
      loaded = STORAGE.parseSave(text).save;
    });
    assert.ok(elapsed < 50, `load took ${elapsed} ms`);
    assert.strictEqual(loaded.unlocked, 20001);
    assert.strictEqual(STORAGE.totalStars(loaded), STORAGE.totalStars(save));
    assert.deepStrictEqual(STORAGE.levelBest(loaded, 12345), STORAGE.levelBest(save, 12345));
  });

  test('storage', 'store falls back to memory when the backend fails', (assert, done) => {
    const failing_backend = { name: 'broken', get: () => Promise.reject(new Error('io')), set: () => Promise.reject(new Error('full')), remove: () => Promise.reject(new Error('io')) };
    const store = STORAGE.createStore(failing_backend);
    return store.load().then((parsed) => {
      assert.deepStrictEqual(parsed.save, STORAGE.defaultSave());
      store.save.player_name = 'Kai';
      return store.persist();
    }).then(() => {
      assert.strictEqual(store.backendName(), 'memory');
      return store.load();
    }).then((parsed) => {
      assert.strictEqual(parsed.save.player_name, 'Kai', 'progress survives on the memory fallback');
    });
  });

  // ---------------------------------------------------------------- runners

  /** Minimal assert for the in-page self-test (same method names as node:assert). */
  function createBrowserAssert() {
    const fail = (message) => {
      throw new Error(message || 'assertion failed');
    };
    const deepEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);
    return {
      ok: (value, message) => { if (!value) fail(message); },
      strictEqual: (actual, expected, message) => { if (actual !== expected) fail(`${message || 'strictEqual'}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`); },
      deepStrictEqual: (actual, expected, message) => { if (!deepEqual(actual, expected)) fail(`${message || 'deepStrictEqual'}: ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}`); },
      notDeepStrictEqual: (actual, expected, message) => { if (deepEqual(actual, expected)) fail(message || 'values should differ'); },
      notStrictEqual: (actual, expected, message) => { if (actual === expected) fail(`${message || 'notStrictEqual'}: ${JSON.stringify(actual)}`); },
      throws: (run, message) => {
        try {
          run();
        } catch (error) {
          return;
        }
        fail(message || 'expected an exception');
      },
    };
  }

  /** Runs one test; resolves {name, group, passed, error, ms}. */
  function runTest(entry, assert) {
    const started = Date.now();
    return Promise.resolve().then(() => entry.run(assert)).then(
      () => ({ group: entry.group, name: entry.name, passed: true, ms: Date.now() - started }),
      (error) => ({ group: entry.group, name: entry.name, passed: false, error: String(error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error), ms: Date.now() - started }),
    );
  }

  /** Greedy-bot simulation of `games` games spread over the shipped levels; yields between games so the UI stays responsive. */
  function runBotSimulation(games, rng_seed, yield_between_games) {
    const levels = shippedLevels();
    const per_level = levels.map((level) => ({ id: level.id, name: level.name, games: 0, wins: 0, scores: [], errors: 0 }));
    let game_index = 0;
    const playOne = () => {
      const level_index = game_index % levels.length;
      const stats = per_level[level_index];
      try {
        const result = LOGIC.playBotGame(levels[level_index], {
          attempt: 50 + Math.floor(game_index / levels.length),
          rng_seed: rng_seed + game_index * 7,
          on_move: (state) => {
            const problems = LOGIC.checkBoardInvariants(state);
            if (problems.length) throw new Error(problems.join('; '));
          },
        });
        if (result.won) stats.wins += 1;
        stats.scores.push(result.final_score);
      } catch (error) {
        stats.errors += 1;
      }
      stats.games += 1;
      game_index += 1;
    };
    const finish = () => per_level;
    if (!yield_between_games) {
      while (game_index < games) playOne();
      return Promise.resolve(finish());
    }
    return new Promise((resolve) => {
      const step = () => {
        const slice_started = Date.now();
        while (game_index < games && Date.now() - slice_started < 12) playOne();
        if (game_index >= games) resolve(finish());
        else yield_between_games(step);
      };
      step();
    });
  }

  const SELFTEST = { TESTS, makeTestState, shippedLevels, prepare, runTest, createBrowserAssert, runBotSimulation };
  SC.SELFTEST = SELFTEST;
  if (typeof module === 'object' && module.exports) module.exports = SELFTEST;
})(typeof window !== 'undefined' ? window : globalThis);
