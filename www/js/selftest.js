// SELFTEST: the logic test suite shared by `node tests/logic.test.js` (with node:assert) and the in-game
// "Run self-test" panel (with a tiny built-in assert). Pure and DOM-free.
(function attachSelfTest(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');
  const LOGIC = SC.LOGIC || require('./logic.js');
  const LEVELS = SC.LEVELS || require('./levels.js');
  const STORAGE = SC.STORAGE || require('./storage.js');
  const { SPECIAL, KIND } = LOGIC;

  // ---------------------------------------------------------------- test board builder
  // Tokens: '.' filler candy (colors 3/4/5, never forms a run)  '#' hole  '_' empty  '0'-'5' candy
  //         digit+'h' horizontal stripes (clears row)  digit+'v' vertical stripes (clears column)  digit+'w' wrapped
  //         'B' color bomb  'c' cherry  'f' / 'F' frosting with 1 / 2 layers
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
    const layout = grid.map((row_tokens, row) => row_tokens.map((token, col) => (token === '#' ? '#' : exit_cells.has(row * cols + col) ? 'x' : '.')).join(''));
    const level = {
      id: 'test', name: 'test', moves: opts.moves === undefined ? 20 : opts.moves, colors: 6, seed: opts.seed === undefined ? 4242 : opts.seed,
      rows, cols, layout, goals: opts.goals || [{ type: 'score', target: 99999999 }], stars: [1, 2, 3],
    };
    const parsed = LOGIC.parseLayout(level);
    const state = LOGIC.internals.buildEmptyState(level, parsed, [0, 1, 2, 3, 4, 5], level.seed);
    grid.forEach((row_tokens, row) => {
      row_tokens.forEach((token, col) => {
        const index = row * cols + col;
        if (token === '#' || token === '_') return;
        let piece;
        if (token === '.') piece = LOGIC.internals.newPiece(state, KIND.CANDY, fillerColor(row, col), SPECIAL.NONE, 0);
        else if (token === 'B') piece = LOGIC.internals.newPiece(state, KIND.CANDY, -1, SPECIAL.BOMB, 0);
        else if (token === 'c') {
          piece = LOGIC.internals.newPiece(state, KIND.CHERRY, -1, SPECIAL.NONE, 0);
          state.cherries_total += 1;
        } else if (token === 'f' || token === 'F') piece = LOGIC.internals.newPiece(state, KIND.FROSTING, -1, SPECIAL.NONE, token === 'f' ? 1 : 2);
        else {
          const color = parseInt(token[0], 10);
          const suffix = token.slice(1);
          const special = suffix === 'h' ? SPECIAL.STRIPE_ROW : suffix === 'v' ? SPECIAL.STRIPE_COL : suffix === 'w' ? SPECIAL.WRAPPED : SPECIAL.NONE;
          if (!(color >= 0 && color <= 5) || (suffix && special === SPECIAL.NONE)) throw new Error(`bad token ${token}`);
          piece = LOGIC.internals.newPiece(state, KIND.CANDY, color, special, 0);
        }
        state.cells[index] = piece;
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

  function sortedNumbers(values) {
    return values.slice().sort((a, b) => a - b);
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
    const level = LEVELS[2];
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
  test('initial', 'all levels: no matches, a valid move, palette colors, layout features', (assert) => {
    LEVELS.forEach((level) => {
      const layout = LOGIC.parseLayout(level);
      for (let variant = 0; variant < 12; variant += 1) {
        const state = LOGIC.createGame(level, { seed: level.seed + variant * 101 });
        assert.strictEqual(LOGIC.findMatchGroups(state).length, 0, `level ${level.id} starts with a match`);
        assert.ok(LOGIC.hasValidMove(state), `level ${level.id} has no valid move`);
        assert.deepStrictEqual(LOGIC.checkBoardInvariants(state), [], `level ${level.id} invariants`);
        const palette = level.palette || Array.from({ length: level.colors }, (unused, color) => color);
        const seen_colors = new Set();
        state.cells.forEach((piece, index) => {
          assert.strictEqual(!!state.holes[index], !!layout.holes[index], `hole mismatch L${level.id}@${index}`);
          assert.strictEqual(state.jelly[index], layout.jelly[index], `jelly mismatch L${level.id}@${index}`);
          assert.strictEqual(!!state.exits[index], !!layout.exits[index], `exit mismatch L${level.id}@${index}`);
          if (layout.holes[index]) return;
          if (layout.frosting[index]) {
            assert.strictEqual(piece.kind, KIND.FROSTING);
            assert.strictEqual(piece.layers, layout.frosting[index]);
          } else if (layout.cherries[index]) {
            assert.strictEqual(piece.kind, KIND.CHERRY);
          } else {
            assert.strictEqual(piece.kind, KIND.CANDY);
            assert.strictEqual(piece.special, SPECIAL.NONE);
            assert.ok(palette.indexOf(piece.color) >= 0, `color ${piece.color} outside palette on level ${level.id}`);
            seen_colors.add(piece.color);
          }
        });
        assert.strictEqual(seen_colors.size, level.colors, `level ${level.id} should show all ${level.colors} colors`);
        assert.strictEqual(state.moves_left, level.moves);
      }
    });
  });

  test('initial', 'all levels: every non-hole cell is reachable by a fall path; cherry columns reach exits', (assert) => {
    LEVELS.forEach((level) => {
      const reach = LOGIC.fallReachableCells(level);
      for (let index = 0; index < reach.reachable.length; index += 1) {
        if (reach.layout.holes[index] || reach.layout.frosting[index]) continue;
        assert.ok(reach.reachable[index], `level ${level.id} cell ${index} unreachable`);
      }
      if (level.goals.some((goal) => goal.type === 'ingredients')) {
        for (let index = 0; index < reach.reachable.length; index += 1) {
          if (!reach.layout.cherries[index]) continue;
          let cursor = index;
          while (cursor + level.cols < reach.reachable.length && !reach.layout.holes[cursor + level.cols] && !reach.layout.frosting[cursor + level.cols]) cursor += level.cols;
          assert.ok(reach.layout.exits[cursor], `level ${level.id}: cherry at ${index} cannot fall to an exit`);
        }
        const ingredient_goal = level.goals.find((goal) => goal.type === 'ingredients');
        const cherry_count = Array.from(reach.layout.cherries).reduce((sum, value) => sum + value, 0);
        assert.strictEqual(cherry_count, ingredient_goal.count, `level ${level.id}: cherry count must equal the goal`);
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

  test('match', 'runs are broken by holes, frosting, cherries, bombs and empty cells', (assert) => {
    ['0 0 # 0 0', '0 0 f 0 0', '0 0 c 0 0', '0 0 B 0 0', '0 0 _ 0 0'].forEach((row_text) => {
      const state = makeTestState(['. . . . .', row_text, '. . . . .']);
      assert.strictEqual(LOGIC.findMatchGroups(state).length, 0, row_text);
    });
    const vertical = makeTestState(['. 0 . .', '. 0 . .', '. # . .', '. 0 . .', '. . . .']);
    assert.strictEqual(LOGIC.findMatchGroups(vertical).length, 0);
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
    LEVELS.forEach((level) => {
      for (let variant = 0; variant < 8; variant += 1) {
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
    while (replayed_moves < 500) {
      const level = LEVELS[game_index % LEVELS.length];
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
    assert.strictEqual(state.cherries_collected, 1);
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
    state.cherries_collected = 1;
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
    LEVELS.forEach((level) => {
      const level_state = LOGIC.createGame(level);
      const level_hint = LOGIC.findHint(level_state);
      assert.ok(level_hint && LOGIC.isValidSwap(level_state, level_hint.from, level_hint.to), `hint valid on level ${level.id}`);
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
    const won_state = LOGIC.createGame(LEVELS[0]);
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

  // 14. Storage
  test('storage', 'round-trip, corrupted JSON fallback, v1 migration, defaults for missing keys', (assert) => {
    const save = STORAGE.defaultSave();
    save.player_name = 'Florin';
    save.settings.theme = 'hard';
    STORAGE.recordResult(save, 1, { won: true, score: 4000, stars: 2 });
    const round_trip = STORAGE.parseSave(STORAGE.serializeSave(save));
    assert.strictEqual(round_trip.recovered, false);
    assert.deepStrictEqual(round_trip.save, STORAGE.normalizeSave(save));
    assert.strictEqual(round_trip.save.unlocked, 2);
    assert.strictEqual(round_trip.save.levels[1].best_score, 4000);
    ['{not json', '[1,2,3]', 'null', '"text"'].forEach((corrupt_text) => {
      const parsed = STORAGE.parseSave(corrupt_text);
      assert.strictEqual(parsed.recovered, true, corrupt_text);
      assert.deepStrictEqual(parsed.save, STORAGE.defaultSave());
    });
    const migrated = STORAGE.parseSave(JSON.stringify({ version: 1, sound: false, music: true, unlocked: 4, name: 'Ana', best: { 1: { score: 2000, stars: 3 }, 3: { score: 9000, stars: 1 } } })).save;
    assert.strictEqual(migrated.version, STORAGE.SAVE_VERSION);
    assert.strictEqual(migrated.unlocked, 4);
    assert.strictEqual(migrated.player_name, 'Ana');
    assert.strictEqual(migrated.settings.sfx_on, false);
    assert.strictEqual(migrated.levels[3].best_score, 9000);
    const partial = STORAGE.parseSave(JSON.stringify({ version: 2, settings: { theme: 'sprinkle', sfx_volume: 7, accent: 'neon' }, levels: { 2: { best_score: -5, best_stars: 9 }, banana: {} } })).save;
    assert.strictEqual(partial.settings.theme, 'sprinkle');
    assert.strictEqual(partial.settings.sfx_volume, 1, 'clamped');
    assert.strictEqual(partial.settings.accent, 'bubblegum', 'unknown accent falls back');
    assert.strictEqual(partial.settings.music_on, true, 'missing key gets its default');
    assert.deepStrictEqual(partial.levels, { 2: { best_score: 0, best_stars: 3, attempts: 0, wins: 0 } });
    assert.strictEqual(STORAGE.cleanText('<b>Hi</b>\n', 16), 'bHi/b');
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

  /** Greedy-bot simulation of `games` games spread over the levels; `on_chunk` yields between games (UI stays responsive). */
  function runBotSimulation(games, rng_seed, yield_between_games) {
    const per_level = LEVELS.map((level) => ({ id: level.id, name: level.name, games: 0, wins: 0, scores: [], errors: 0 }));
    let game_index = 0;
    const playOne = () => {
      const level_index = game_index % LEVELS.length;
      const level = LEVELS[level_index];
      const stats = per_level[level_index];
      const rng = UTIL.createRng(rng_seed + game_index * 7);
      try {
        let state = LOGIC.createGame(level, { seed: level.seed + 5000 + game_index });
        let guard = 0;
        while (state.status === 'playing') {
          guard += 1;
          if (guard > 200) throw new Error('game did not end');
          const move = LOGIC.chooseGreedyMove(state, rng);
          state = LOGIC.applySwap(state, move.from, move.to).state;
          const problems = LOGIC.checkBoardInvariants(state);
          if (problems.length) throw new Error(problems.join('; '));
        }
        let final_score = state.score;
        if (state.status === 'won') {
          stats.wins += 1;
          final_score = LOGIC.applyEndBonus(state).state.score;
        }
        stats.scores.push(final_score);
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

  const SELFTEST = { TESTS, makeTestState, runTest, createBrowserAssert, runBotSimulation };
  SC.SELFTEST = SELFTEST;
  if (typeof module === 'object' && module.exports) module.exports = SELFTEST;
})(typeof window !== 'undefined' ? window : globalThis);
