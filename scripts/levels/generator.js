// GENERATOR (tool-only: used by scripts/calibrate.js and the tests, never at play time).
// generateLevel(n, variant) deterministically builds level n from a seed derived from n: a board shape from the template
// library, mechanics allowed by the unlock schedule and the complexity budget, blockers placed in readable symmetric
// patterns, and goals that fit the board. scripts/calibrate.js then tunes moves (or time) and stars with bots.
(function attachGenerator(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('../../www/js/util.js');
  const LOGIC = SC.LOGIC || require('../../www/js/logic.js');
  const LEVELS = SC.LEVELS || require('../../www/js/levels.js');

  // First level that uses each idea (1-25 are hand-authored; 31, 36 and 41 are generated introductions).
  const UNLOCKS = Object.freeze({
    collect: 2, jelly: 5, ingredients: 9, order: 12, frosting: 13, jelly2: 15, timed: 17, cage: 19,
    portals: 21, cocoa: 22, fuse: 24, mixed: 25, belt: 31, frosting3: 36, hazelnut: 41,
  });
  const GENERATED_INTROS = Object.freeze({ 31: 'belt', 36: 'frosting3', 41: 'hazelnut' });
  const INTRO_TEXT = Object.freeze({
    belt: { tutorial: 'Sugar Belts slide every candy on them one step after each move.', tip: 'Line up matches that the belt will finish for you.' },
    frosting3: { tutorial: 'Thick frosting has up to five layers. Keep cracking!', tip: 'Special candy blasts take a layer off each time.' },
    hazelnut: { tutorial: 'Hazelnuts are ingredients too: bring them down to the trays!', tip: 'Clear the column under a hazelnut to drop it.' },
  });
  const BLOCKER_TYPES = Object.freeze(['frosting', 'cage', 'cocoa', 'fuse']);

  const NAME_FIRST = Object.freeze(['Toffee', 'Gummy', 'Caramel', 'Sprinkle', 'Marzipan', 'Nougat', 'Fudge', 'Praline', 'Licorice', 'Butterscotch',
    'Bonbon', 'Truffle', 'Meringue', 'Sherbet', 'Taffy', 'Brittle', 'Cocoa', 'Vanilla', 'Maple', 'Honey', 'Pistachio', 'Cinnamon', 'Mint', 'Berry']);
  const NAME_SECOND = Object.freeze(['Twirl', 'Hollow', 'Bridge', 'Garden', 'Cove', 'Path', 'Puzzle', 'Parade', 'Party', 'Stream', 'Corner', 'Swirl',
    'Steps', 'Square', 'Valley', 'Crossing', 'Spiral', 'Plaza', 'Drift', 'Patch', 'Tower', 'Ripple', 'Nook', 'Lane']);

  // ---------------------------------------------------------------- board shape templates (hand-designed)
  // '.' cell, '#' hole. Every template must refill completely on its own (tests/levels.test.js checks it): a cell under a
  // hole is fed diagonally from the row above, so hole areas must narrow, not widen, toward the bottom.
  const SHAPES = Object.freeze([
    { id: 'full9', rows: ['.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'] },
    { id: 'full8', rows: ['........', '........', '........', '........', '........', '........', '........', '........'] },
    { id: 'full7', rows: ['.......', '.......', '.......', '.......', '.......', '.......', '.......'] },
    { id: 'corners9', rows: ['#.......#', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '#.......#'] },
    { id: 'corners9_wide', rows: ['##.....##', '#.......#', '.........', '.........', '.........', '.........', '.........', '#.......#', '##.....##'] },
    { id: 'diamond9', rows: ['###...###', '##.....##', '#.......#', '.........', '.........', '.........', '#.......#', '##.....##', '###...###'] },
    { id: 'octagon9', rows: ['##.....##', '#.......#', '.........', '.........', '.........', '.........', '.........', '#.......#', '##.....##'] },
    { id: 'hourglass9', rows: ['.........', '#.......#', '##.....##', '###...###', '###...###', '##.....##', '#.......#', '.........', '.........'] },
    { id: 'cross9', rows: ['###...###', '###...###', '###...###', '.........', '.........', '.........', '###...###', '###...###', '###...###'] },
    { id: 'ring9', rows: ['.........', '.........', '.........', '...###...', '....#....', '.........', '.........', '.........', '.........'] },
    { id: 'frame9', rows: ['.........', '.........', '..#####..', '..#####..', '..#####..', '...###...', '....#....', '.........', '.........'] },
    { id: 'towers9', rows: ['.........', '.........', '..#...#..', '..#...#..', '..#...#..', '..#...#..', '.........', '.........', '.........'] },
    { id: 'tunnel9', rows: ['.........', '.........', '.........', '.........', '.##...##.', '.........', '.........', '.........', '.........'] },
    { id: 'staggered9', rows: ['.#.....#.', '.........', '.........', '#.......#', '.........', '.........', '#.......#', '.........', '.#.....#.'] },
    { id: 'stairs9', rows: ['.........', '.........', '.........', '......###', '.......##', '........#', '.........', '.........', '.........'] },
    { id: 'arch9', rows: ['.........', '.........', '.........', '..##.##..', '.#.....#.', '.........', '.........', '.........', '.........'] },
    { id: 'bowl9', rows: ['##.....##', '#.......#', '.........', '.........', '.........', '.........', '.........', '.........', '.........'] },
    { id: 'heart9', rows: ['#..###..#', '.........', '.........', '.........', '.........', '#.......#', '##.....##', '###...###', '####.####'] },
    { id: 'tee9', rows: ['.........', '.........', '.........', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##', '##.....##'] },
    { id: 'u9', rows: ['...###...', '...###...', '...###...', '...###...', '.........', '.........', '.........', '.........', '.........'] },
    { id: 'zigzag9', rows: ['.........', '.........', '#........', '.#.......', '.........', '.......#.', '........#', '.........', '.........'] },
    { id: 'pillars9', rows: ['.........', '.........', '.........', '.#.....#.', '.#.....#.', '.#.....#.', '.........', '.........', '.........'] },
    { id: 'islands9', rows: ['.........', '.##...##.', '.........', '.........', '....#....', '.........', '.........', '.##...##.', '.........'] },
    { id: 'windows9', rows: ['.........', '.##...##.', '.##...##.', '.........', '.........', '.........', '.##...##.', '.##...##.', '.........'] },
    { id: 'chevron9', rows: ['.........', '.........', '.........', '##.....##', '#.......#', '.........', '.........', '.........', '.........'] },
    { id: 'moat9', rows: ['.........', '.........', '..#...#..', '.........', '.........', '.........', '..#...#..', '.........', '.........'] },
    { id: 'comb9', rows: ['#.#.#.#.#', '.........', '.........', '.........', '.........', '.........', '.........', '.........', '.........'] },
    { id: 'sides9', rows: ['.........', '#.......#', '.........', '#.......#', '.........', '#.......#', '.........', '#.......#', '.........'] },
    { id: 'wide9x7', rows: ['.........', '.........', '.........', '.........', '.........', '.........', '.........'] },
    { id: 'tall7x9', rows: ['.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......', '.......'] },
    { id: 'donut8', rows: ['........', '........', '........', '...##...', '...##...', '........', '........', '........'] },
    { id: 'diamond8', rows: ['##....##', '#......#', '........', '........', '........', '........', '#......#', '##....##'] },
    { id: 'corners8', rows: ['#......#', '........', '........', '........', '........', '........', '........', '#......#'] },
    { id: 'cross8', rows: ['##....##', '##....##', '........', '........', '........', '........', '##....##', '##....##'] },
    { id: 'hourglass8', rows: ['........', '#......#', '##....##', '##....##', '#......#', '........', '........', '........'] },
    { id: 'towers8', rows: ['........', '........', '.#....#.', '.#....#.', '.#....#.', '........', '........', '........'] },
    { id: 'plus7', rows: ['##...##', '##...##', '.......', '.......', '.......', '##...##', '##...##'] },
    { id: 'ring7', rows: ['.......', '.......', '..#.#..', '...#...', '..#.#..', '.......', '.......'] },
    { id: 'diamond7', rows: ['##...##', '#.....#', '.......', '.......', '.......', '#.....#', '##...##'] },
    { id: 'gap9', portal: true, rows: ['.........', '.........', '.........', '.........', '#########', '##.....##', '##.....##', '##.....##', '##.....##'] },
    { id: 'gap9_low', portal: true, rows: ['.........', '.........', '.........', '.........', '.........', '#########', '#.......#', '#.......#', '#.......#'] },
    { id: 'split9', portal: true, rows: ['....#....', '....#....', '....#....', '....#....', '#########', '#.......#', '#.......#', '#.......#', '#.......#'] },
  ]);

  // ---------------------------------------------------------------- helpers

  function createRng(level_number, variant) {
    return UTIL.createRng((LEVELS.hashNumber(level_number * 977 + variant * 131 + 5) | 0) || 1);
  }

  function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
  }

  function chance(rng, probability) {
    return rng() < probability;
  }

  function between(rng, low, high) {
    return low + Math.floor(rng() * (high - low + 1));
  }

  function round500(value) {
    return Math.max(500, Math.round(value / 500) * 500);
  }

  /** Colors used by level n: 4 early, 5 in about half of levels from 20 (dominant from 80), 6 from 150 (dominant from 400). */
  function colorsFor(level_number, rng) {
    if (level_number < 20) return 4;
    if (level_number < 80) return chance(rng, 0.5) ? 5 : 4;
    if (level_number < 150) return chance(rng, 0.88) ? 5 : 4;
    if (level_number < 400) return chance(rng, 0.2 + (0.35 * (level_number - 150)) / 250) ? 6 : 5;
    return chance(rng, 0.8) ? 6 : 5;
  }

  /** How many blocker types a level may mix: 1 before 60, 2 before 200, 3 before 600, 4 after. */
  function blockerBudget(level_number) {
    if (level_number < 60) return 1;
    if (level_number < 200) return 2;
    if (level_number < 600) return 3;
    return 4;
  }

  function unlocked(idea, level_number) {
    return level_number >= UNLOCKS[idea];
  }

  /** The idea introduced by level n (generated range), and the levels that practice it right after. */
  function introAt(level_number) {
    return GENERATED_INTROS[level_number] || null;
  }

  function practiceOf(level_number) {
    for (const offset of [1, 2]) {
      const idea = GENERATED_INTROS[level_number - offset];
      if (idea) return idea;
    }
    return null;
  }

  // ---------------------------------------------------------------- goal modes (no mode more than 3 times in a row)

  const MODE_CACHE = new Map();

  function rawMode(level_number) {
    const rng = createRng(level_number, 9999);
    const mixed_weight = level_number >= 40 ? 0.2 : 0; // mixed goals from level 40
    const table = [['score', 0.14], ['collect', 0.2], ['jelly', 0.24], ['ingredients', 0.14], ['order', 0.1], ['timed', 0.06], ['mixed', mixed_weight]];
    const total = table.reduce((sum, entry) => sum + entry[1], 0);
    let roll = rng() * total;
    for (const [mode, weight] of table) {
      roll -= weight;
      if (roll < 0) return mode;
    }
    return 'jelly';
  }

  function baseModeFor(level_number) {
    const intro = introAt(level_number) || practiceOf(level_number);
    if (intro === 'hazelnut') return 'ingredients';
    if (intro === 'frosting3') return level_number === 36 ? 'order' : 'score';
    if (intro === 'belt') return level_number === 31 ? 'score' : 'collect';
    return rawMode(level_number);
  }

  /**
   * Goal mode of level n, a pure function of n. The three-in-a-row rule only looks at the three previous levels, so each
   * level replays a 40-level window behind it (its result never depends on which other levels were generated before).
   */
  function modeFor(level_number) {
    if (level_number <= 25) return null;
    if (MODE_CACHE.has(level_number)) return MODE_CACHE.get(level_number);
    const window_modes = new Map();
    for (let current = Math.max(26, level_number - 40); current <= level_number; current += 1) {
      let mode = baseModeFor(current);
      const previous = [1, 2, 3].map((offset) => window_modes.get(current - offset) || null);
      if (previous.every((earlier) => earlier === mode)) {
        const alternatives = ['jelly', 'collect', 'score', 'ingredients'].filter((option) => option !== mode);
        mode = alternatives[current % alternatives.length];
      }
      window_modes.set(current, mode);
    }
    MODE_CACHE.set(level_number, window_modes.get(level_number));
    return window_modes.get(level_number);
  }

  // ---------------------------------------------------------------- symmetric placement patterns

  function activeGrid(rows) {
    return rows.map((row_text) => row_text.split(''));
  }

  function spawnCells(grid) {
    const found = new Set();
    const cols = grid[0].length;
    for (let col = 0; col < cols; col += 1) {
      for (let row = 0; row < grid.length; row += 1) {
        if (grid[row][col] !== '#') {
          found.add(row * cols + col);
          break;
        }
      }
    }
    return found;
  }

  /** Candidate cells for a pattern, mirrored left-right so placements read as intentional. */
  function patternCells(pattern, rows, cols, rng) {
    const cells = new Set();
    const add = (row, col) => {
      if (row < 0 || col < 0 || row >= rows || col >= cols) return;
      cells.add(row * cols + col);
      cells.add(row * cols + (cols - 1 - col));
    };
    const mid_row = Math.floor(rows / 2);
    const mid_col = Math.floor(cols / 2);
    if (pattern === 'ring') {
      const radius = between(rng, 1, 2);
      for (let row = mid_row - radius; row <= mid_row + radius; row += 1) {
        for (let col = mid_col - radius; col <= mid_col + radius; col += 1) {
          if (Math.max(Math.abs(row - mid_row), Math.abs(col - mid_col)) === radius) add(row, col);
        }
      }
    } else if (pattern === 'corners') {
      [[1, 1], [1, 2], [2, 1], [rows - 2, 1], [rows - 3, 1], [rows - 2, 2]].forEach(([row, col]) => add(row, col));
    } else if (pattern === 'rows') {
      const row = between(rng, 2, rows - 3);
      for (let col = 1; col < mid_col; col += 2) add(row, col);
      if (chance(rng, 0.5)) for (let col = 0; col < mid_col; col += 2) add(Math.min(rows - 2, row + 2), col);
    } else if (pattern === 'diamond') {
      const radius = between(rng, 2, 3);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) if (Math.abs(row - mid_row) + Math.abs(col - mid_col) === radius) add(row, col);
      }
    } else if (pattern === 'cross') {
      for (let offset = -2; offset <= 2; offset += 1) {
        add(mid_row + offset, mid_col);
        add(mid_row, mid_col + offset);
      }
    } else if (pattern === 'checker') {
      for (let row = 2; row < rows - 1; row += 2) for (let col = 1; col < mid_col; col += 2) add(row, col);
    } else if (pattern === 'border') {
      for (let row = 2; row < rows - 1; row += 1) add(row, 0);
    } else if (pattern === 'block') {
      for (let row = mid_row - 1; row <= mid_row + 1; row += 1) for (let col = mid_col - 1; col <= mid_col; col += 1) add(row, col);
    } else if (pattern === 'pillars') {
      const col = between(rng, 1, Math.max(1, mid_col - 1));
      for (let row = mid_row - 1; row <= mid_row + 1; row += 1) add(row, col);
    } else if (pattern === 'full') {
      for (let row = 1; row < rows - 1; row += 1) for (let col = 1; col <= mid_col; col += 1) add(row, col);
    } else if (pattern === 'x') {
      for (let offset = -3; offset <= 3; offset += 1) {
        add(mid_row + offset, mid_col + offset);
        add(mid_row + offset, mid_col - offset);
      }
    }
    return Array.from(cells).sort((a, b) => a - b);
  }

  // ---------------------------------------------------------------- the generator

  function levelName(level_number, rng) {
    return `${pick(rng, NAME_FIRST)} ${pick(rng, NAME_SECOND)}`;
  }

  /**
   * Builds level n. `variant` (0, 1, 2 ...) gives a different but equally valid level for the same n (the calibrator moves
   * to the next variant when a candidate cannot reach its target difficulty). Pure and deterministic.
   */
  function generateLevel(level_number, variant) {
    const attempt_base = variant || 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const level = buildCandidate(level_number, attempt_base * 40 + attempt);
      if (level && LOGIC.validateLevel(level).length === 0) return level;
    }
    throw new Error(`generator: no valid candidate for level ${level_number}`);
  }

  function buildCandidate(level_number, salt) {
    const rng = createRng(level_number, salt);
    const intro = introAt(level_number);
    const practice = practiceOf(level_number);
    const role = LEVELS.scheduledRole(level_number);
    let mode = modeFor(level_number);
    const wants_portals = !intro && !practice && unlocked('portals', level_number) && chance(rng, level_number < 100 ? 0.08 : 0.12);
    const wants_belt = intro === 'belt' || practice === 'belt' || (!intro && !practice && unlocked('belt', level_number) && chance(rng, 0.1));
    const shape_pool = SHAPES.filter((shape) => (wants_portals ? shape.portal : !shape.portal));
    const shape = pick(rng, shape_pool);
    const grid = activeGrid(shape.rows);
    const rows = grid.length;
    const cols = grid[0].length;
    const spawns = spawnCells(grid);
    const reserved = new Set(spawns);
    const meta = {};
    const colors = colorsFor(level_number, rng);

    // Board features: portals (shapes with a gap) or one Sugar Belt.
    if (shape.portal) {
      const pairs = buildPortals(grid, rng);
      if (!pairs) return null;
      meta.portals = pairs;
      pairs.forEach((pair) => {
        grid[pair.in[0]][pair.in[1]] = 'p';
        grid[pair.out[0]][pair.out[1]] = 'P';
        reserved.add(pair.in[0] * cols + pair.in[1]);
        reserved.add(pair.out[0] * cols + pair.out[1]);
      });
    }
    if (wants_belt) {
      const belt_row = between(rng, 3, rows - 3);
      const direction = chance(rng, 0.5) ? '>' : '<';
      let placed = 0;
      for (let col = 0; col < cols; col += 1) {
        if (grid[belt_row][col] === '.' && !reserved.has(belt_row * cols + col)) {
          grid[belt_row][col] = direction;
          reserved.add(belt_row * cols + col);
          placed += 1;
        }
      }
      if (placed < 4) return null;
    }

    // Blockers within the complexity budget (one type before level 60; never more than about 30% of the cells).
    const allowed_blockers = BLOCKER_TYPES.filter((type) => unlocked(type, level_number));
    let blocker_types = [];
    if (intro === 'frosting3' || practice === 'frosting3') blocker_types = ['frosting'];
    else if (!intro && !practice && allowed_blockers.length) {
      const count = Math.min(blockerBudget(level_number), between(rng, level_number < 40 ? 0 : 1, blockerBudget(level_number)));
      const shuffled = allowed_blockers.slice().sort(() => rng() - 0.5);
      blocker_types = shuffled.slice(0, count);
    }
    if (mode === 'timed') blocker_types = blocker_types.filter((type) => type !== 'fuse' && type !== 'cocoa');
    const active_cells = grid.reduce((sum, row) => sum + row.filter((symbol) => symbol !== '#').length, 0);
    const blocker_cap = Math.floor(active_cells * 0.3);
    let blocker_count = 0;
    const max_frosting = unlocked('frosting3', level_number) ? (intro === 'frosting3' || practice === 'frosting3' ? 4 : Math.min(5, 2 + Math.floor(level_number / 150))) : 2;
    const placeBlocker = (symbol, pattern, limit) => {
      let placed = 0;
      patternCells(pattern, rows, cols, rng).forEach((cell) => {
        const row = Math.floor(cell / cols);
        const col = cell % cols;
        if (placed >= limit || blocker_count >= blocker_cap || grid[row][col] !== '.' || reserved.has(cell) || row === rows - 1) return;
        grid[row][col] = typeof symbol === 'function' ? symbol(row, col) : symbol;
        reserved.add(cell);
        placed += 1;
        blocker_count += 1;
      });
      return placed;
    };
    blocker_types.forEach((type) => {
      if (type === 'frosting') {
        const layers = intro === 'frosting3' ? 3 : practice === 'frosting3' ? between(rng, 3, 4) : between(rng, 1, max_frosting);
        placeBlocker(() => String(Math.min(max_frosting, Math.max(1, layers + (chance(rng, 0.25) ? 1 : 0)))), pick(rng, ['ring', 'corners', 'rows', 'diamond', 'checker', 'pillars']), between(rng, 6, 14));
      } else if (type === 'cage') {
        placeBlocker('k', pick(rng, ['block', 'cross', 'corners', 'ring', 'pillars']), between(rng, 4, 10));
      } else if (type === 'cocoa') {
        placeBlocker('o', pick(rng, ['block', 'pillars', 'corners']), between(rng, 2, 5));
      } else if (type === 'fuse') {
        placeBlocker('b', pick(rng, ['corners', 'pillars', 'rows']), between(rng, 1, 3));
        meta.fuse = between(rng, 12, 20);
      }
    });

    // Goals.
    const goals = [];
    const palette = Array.from({ length: colors }, (unused, index) => index);
    const usesJelly = mode === 'jelly' || (mode === 'mixed' && chance(rng, 0.5));
    if (usesJelly) {
      const jelly_symbol = () => (unlocked('jelly2', level_number) && chance(rng, Math.min(0.5, level_number / 400)) ? 'J' : 'j');
      let placed = 0;
      patternCells(pick(rng, ['full', 'block', 'ring', 'diamond', 'x', 'checker', 'rows', 'border']), rows, cols, rng).forEach((cell) => {
        const row = Math.floor(cell / cols);
        const col = cell % cols;
        if (grid[row][col] === '.') {
          grid[row][col] = jelly_symbol();
          placed += 1;
        }
      });
      if (placed < 4) return null;
      goals.push({ type: 'jelly' });
    }
    const usesIngredients = mode === 'ingredients' || (mode === 'mixed' && goals.length === 0) || (mode === 'mixed' && chance(rng, 0.35));
    if (usesIngredients) {
      const placed = placeIngredients(grid, reserved, rng, level_number, intro === 'hazelnut' || practice === 'hazelnut' || (unlocked('hazelnut', level_number) && chance(rng, 0.4)));
      if (placed < 2) return null;
      goals.push({ type: 'ingredients', count: placed });
    }
    if (mode === 'collect' || (mode === 'mixed' && goals.length < 2)) {
      const color_count = chance(rng, 0.5) ? 2 : 1;
      const picked = palette.slice().sort(() => rng() - 0.5).slice(0, color_count);
      picked.forEach((color) => goals.push({ type: 'collect', color, count: Math.min(45, Math.round(active_cells * 0.22 + level_number / 60 + between(rng, 0, 6))) }));
    }
    if (mode === 'order') {
      const items = ['striped', 'wrapped'];
      if (level_number >= 40) items.push('bomb');
      if (blocker_types.indexOf('frosting') >= 0) items.push('frosting');
      if (blocker_types.indexOf('cocoa') >= 0) items.push('cocoa');
      if (blocker_types.indexOf('cage') >= 0) items.push('cage');
      const item = intro === 'frosting3' ? 'frosting' : pick(rng, items);
      goals.push({ type: 'order', item, count: orderCount(item, grid, rng) });
    }
    if (mode === 'score' || mode === 'timed') {
      goals.push({ type: 'score', target: round500(active_cells * (150 + Math.min(150, level_number / 6))) });
    }
    if (goals.length === 0) goals.push({ type: 'score', target: round500(active_cells * 150) });

    const level = {
      id: level_number,
      name: levelName(level_number, rng),
      role,
      colors,
      seed: level_number * 1009 + 7,
      rows,
      cols,
      layout: grid.map((row) => row.join('')),
      goals,
      stars: [1000, 2000, 3000],
      newMechanic: intro,
    };
    if (mode === 'timed') level.time = 90;
    else level.moves = 26;
    if (Object.keys(meta).length) level.meta = meta;
    if (intro) {
      level.tutorial = INTRO_TEXT[intro].tutorial;
      level.tip = INTRO_TEXT[intro].tip;
    }
    return level;
  }

  function orderCount(item, grid, rng) {
    if (item === 'striped') return between(rng, 2, 5);
    if (item === 'wrapped') return between(rng, 1, 3);
    if (item === 'bomb') return between(rng, 1, 2);
    let total = 0;
    grid.forEach((row) => row.forEach((symbol) => {
      if (item === 'frosting' && symbol >= '1' && symbol <= '5') total += Number(symbol);
      if (item === 'cage' && symbol === 'k') total += 1;
      if (item === 'cocoa' && symbol === 'o') total += 1;
    }));
    if (item === 'cocoa') return Math.max(3, total + between(rng, 2, 6)); // cocoa grows, so the order asks for a few more
    return Math.max(1, Math.round(total * 0.8));
  }

  /** Ingredients start in the top row of columns with a clear straight drop; every bottom cell becomes an exit tray. */
  function placeIngredients(grid, reserved, rng, level_number, use_hazelnuts) {
    const rows = grid.length;
    const cols = grid[0].length;
    const clear_columns = [];
    for (let col = 0; col < cols; col += 1) {
      let top = -1;
      for (let row = 0; row < rows; row += 1) {
        if (grid[row][col] !== '#') {
          top = row;
          break;
        }
      }
      if (top < 0) continue;
      let clear = true;
      for (let row = top; row < rows; row += 1) {
        const symbol = grid[row][col];
        if (symbol === '#' || symbol === 'k' || symbol === 'o' || symbol === 'p' || symbol === 'P' || (symbol >= '1' && symbol <= '5') || '><^v'.indexOf(symbol) >= 0) {
          clear = false;
          break;
        }
      }
      if (clear && grid[top][col] === '.') clear_columns.push({ col, top });
    }
    if (clear_columns.length < 2) return 0;
    const wanted = Math.min(clear_columns.length, between(rng, 2, level_number < 100 ? 3 : 4));
    const chosen = clear_columns.sort(() => rng() - 0.5).slice(0, wanted);
    chosen.forEach((entry, index) => {
      grid[entry.top][entry.col] = use_hazelnuts && index % 2 === 0 ? 'h' : 'c';
      reserved.add(entry.top * cols + entry.col);
    });
    for (let col = 0; col < cols; col += 1) {
      const symbol = grid[rows - 1][col];
      if (symbol === '.' || symbol === 'j' || symbol === 'J') grid[rows - 1][col] = 'x';
    }
    return wanted;
  }

  /** Pairs portals across the gap of a portal shape: one entrance per lower-section column, exits on the gap's far side. */
  function buildPortals(grid, rng) {
    const rows = grid.length;
    const cols = grid[0].length;
    let gap_row = -1;
    for (let row = 1; row < rows - 1; row += 1) {
      if (grid[row].every((symbol) => symbol === '#')) {
        gap_row = row;
        break;
      }
    }
    if (gap_row < 0) return null;
    const lower_columns = [];
    for (let col = 0; col < cols; col += 1) if (grid[gap_row + 1][col] !== '#') lower_columns.push(col);
    const upper_columns = [];
    for (let col = 0; col < cols; col += 1) if (grid[gap_row - 1][col] !== '#') upper_columns.push(col);
    if (upper_columns.length < lower_columns.length) return null;
    // Spread the entrances across the upper section; cross them over for a little surprise.
    const step = upper_columns.length / lower_columns.length;
    const entrances = lower_columns.map((unused, index) => upper_columns[Math.min(upper_columns.length - 1, Math.floor(index * step + step / 2))]);
    if (chance(rng, 0.5)) entrances.reverse();
    return lower_columns.map((col, index) => ({ in: [gap_row - 1, entrances[index]], out: [gap_row + 1, col] }));
  }

  /** Ideas a level uses, for the "one new idea at a time" rule. */
  function ideasOf(level) {
    const ideas = new Set();
    level.layout.forEach((row_text) => {
      for (const symbol of row_text) {
        if (symbol === 'j') ideas.add('jelly');
        if (symbol === 'J') {
          ideas.add('jelly');
          ideas.add('jelly2');
        }
        if (symbol >= '1' && symbol <= '5') {
          ideas.add('frosting');
          if (symbol >= '3') ideas.add('frosting3');
        }
        if (symbol === 'k') ideas.add('cage');
        if (symbol === 'o') ideas.add('cocoa');
        if (symbol === 'b') ideas.add('fuse');
        if (symbol === 'c') ideas.add('ingredients');
        if (symbol === 'h') {
          ideas.add('ingredients');
          ideas.add('hazelnut');
        }
        if (symbol === 'p' || symbol === 'P') ideas.add('portals');
        if ('><^v'.indexOf(symbol) >= 0) ideas.add('belt');
      }
    });
    level.goals.forEach((goal) => {
      if (goal.type === 'collect') ideas.add('collect');
      if (goal.type === 'order') ideas.add('order');
    });
    if (level.time) ideas.add('timed');
    return ideas;
  }

  /** Blocker types a level mixes (for the complexity budget). */
  function blockerTypesOf(level) {
    const ideas = ideasOf(level);
    return BLOCKER_TYPES.filter((type) => ideas.has(type));
  }

  const GENERATOR = { UNLOCKS, GENERATED_INTROS, SHAPES, BLOCKER_TYPES, generateLevel, modeFor, colorsFor, blockerBudget, ideasOf, blockerTypesOf };
  SC.GENERATOR = GENERATOR;
  if (typeof module === 'object' && module.exports) module.exports = GENERATOR;
})(typeof window !== 'undefined' ? window : globalThis);
