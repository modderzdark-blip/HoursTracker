#!/usr/bin/env node
// Level calibration: for each level in a range, run greedy-bot games (300 by default) and random-bot games (100) and
// binary-search the move count (or the time limit) until the greedy win rate lands within the tolerance of the level's
// target (8 points, tighter for hard levels: LEVELS.calibrationTolerance). Generated levels whose goals are too small
// for a comfortable number of moves get bigger goals; ones that still cannot get there are regenerated with the next
// variant (up to 20). Star thresholds are set from the winning scores. Writes the level packs
// (www/levels/pack-NNNN.js), the manifest, and the difficulty report (docs/difficulty/difficulty.csv + difficulty.svg).
// Runs in parallel worker threads; seeded, so results are reproducible.
//
// Usage:
//   node scripts/calibrate.js --from 1 --to 60                    calibrate and write packs + report
//   node scripts/calibrate.js --from 61 --to 80 --emit shard.json calibrate a shard only (CI matrix job)
//   node scripts/calibrate.js --merge a.json b.json ...           merge shards into packs + report
// Options: --games 300 --random-games 100 --workers <cpus> --out www/levels --report docs/difficulty
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const ROOT = path.resolve(__dirname, '..');
const LOGIC = require(path.join(ROOT, 'www/js/logic.js'));
const LEVELS = require(path.join(ROOT, 'www/js/levels.js'));
const GENERATOR = require(path.join(ROOT, 'scripts/levels/generator.js'));
const AUTHORED = require(path.join(ROOT, 'scripts/levels/authored.js'));

const TOLERANCE = LEVELS.calibrationTolerance;
const MAX_VARIANTS = 20;
const MOVE_RANGE = [10, 40]; // never fewer than 10 moves (stingy), never more than 40 (a layout needing more is replaced)
const TIME_RANGE = [30, 240];

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

function floor500(value) {
  return Math.max(500, Math.floor(value / 500) * 500);
}

function round500(value) {
  return Math.max(500, Math.round(value / 500) * 500);
}

function candidateFor(level_number, variant) {
  if (level_number <= AUTHORED.length) return JSON.parse(JSON.stringify(AUTHORED[level_number - 1]));
  return GENERATOR.generateLevel(level_number, variant);
}

function withParameter(level, value) {
  const copy = JSON.parse(JSON.stringify(level));
  if (copy.time) copy.time = value;
  else copy.moves = value;
  return copy;
}

/**
 * Plays `games` bot games. Without `first_attempt` the boards alternate between two far-apart ranges (attempts 0, 1, 2 ...
 * and 100,000 + 0, 1, 2 ...), so a level is tuned to its typical boards rather than to one lucky or unlucky run of seeds.
 */
function runGames(level, games, policy, first_attempt) {
  const results = [];
  for (let index = 0; index < games; index += 1) {
    const attempt = first_attempt !== undefined ? first_attempt + index : (index % 2 === 0 ? index / 2 : 100000 + (index - 1) / 2);
    results.push(LOGIC.playBotGame(level, { attempt, policy }));
  }
  const wins = results.filter((result) => result.won);
  return {
    games,
    wins: wins.length,
    win_rate: wins.length / games,
    win_final_scores: wins.map((result) => result.final_score),
    end_scores: results.map((result) => result.score_at_end),
    win_moves: wins.map((result) => result.moves_used),
  };
}

/**
 * Stars: 1 star = goal met (the score target, or the near-minimum winning score); the spec's 1.6x / 2.4x of that
 * one-star score for 2 and 3 stars, capped so an ordinary win still earns 3 stars (3 stars at most the 20th percentile
 * of greedy wins and the 10th of random wins; owner feedback: 3 stars must not feel out of reach).
 */
function starThresholds(level, greedy, random) {
  const score_goal = level.goals.find((goal) => goal.type === 'score');
  const winners = greedy.win_final_scores;
  const one_star = score_goal ? score_goal.target : floor500(percentile(winners, 0.02) * 0.9);
  let two_star = round500(one_star * 1.6);
  let three_star = round500(one_star * 2.4);
  const random_ok = random.win_final_scores.length >= 20;
  const cap_three = Math.min(floor500(percentile(winners, 0.2)), random_ok ? floor500(percentile(random.win_final_scores, 0.1)) : Infinity);
  const cap_two = Math.min(floor500(percentile(winners, 0.05)), random_ok ? floor500(percentile(random.win_final_scores, 0.02)) : Infinity);
  if (Number.isFinite(cap_three)) three_star = Math.min(three_star, cap_three);
  if (Number.isFinite(cap_two)) two_star = Math.min(two_star, cap_two);
  if (two_star <= one_star) two_star = one_star + 500;
  if (three_star <= two_star) three_star = two_star + 500;
  return [one_star, two_star, three_star];
}

/** Binary search on moves (or seconds) for the target win rate; returns the closest setting and its measurements. */
function tuneParameter(level, target, games) {
  const timed = !!level.time;
  const [low_bound, high_bound] = timed ? TIME_RANGE : MOVE_RANGE;
  const step = timed ? 5 : 1;
  const cache = new Map();
  const measure = (value) => {
    if (!cache.has(value)) cache.set(value, runGames(withParameter(level, value), games, 'greedy'));
    return cache.get(value);
  };
  let low = low_bound;
  let high = high_bound;
  if (measure(high).win_rate < target) {
    return { value: high, greedy: measure(high), evaluations: cache.size };
  }
  while (high - low > step) {
    const middle = low + Math.floor((high - low) / (2 * step)) * step;
    if (middle === low) break;
    if (measure(middle).win_rate >= target) high = middle;
    else low = middle;
  }
  // `high` is the smallest setting meeting the target; the one below may land closer.
  const above = measure(high);
  const below = high - step >= low_bound ? measure(high - step) : null;
  const best_value = below && Math.abs(below.win_rate - target) < Math.abs(above.win_rate - target) ? high - step : high;
  return { value: best_value, greedy: measure(best_value), evaluations: cache.size };
}

/**
 * Sanity floor for the easy roles: when the random-move bot almost never wins a tutorial, breather or normal level,
 * moves (or seconds) are added while the greedy win rate stays inside the tolerance. Hard and super hard levels have no
 * floor: like the original's, they are meant to take several tries (owner request: match the original's difficulty).
 */
const RANDOM_FLOOR = Object.freeze({ tutorial: 0.3, breather: 0.1, normal: 0.02, hard: 0, superhard: 0 });

function applyRandomFloor(level, role, target, tuned, random_games) {
  const timed = !!level.time;
  const step = timed ? 5 : 1;
  const upper = timed ? TIME_RANGE[1] : MOVE_RANGE[1];
  const floor = RANDOM_FLOOR[role] === undefined ? 0.12 : RANDOM_FLOOR[role];
  let value = tuned.value;
  let greedy = tuned.greedy;
  let random = runGames(withParameter(level, value), random_games, 'random');
  while (random.win_rate < floor && value + step <= upper) {
    const next_greedy = runGames(withParameter(level, value + step), greedy.games, 'greedy');
    if (next_greedy.win_rate > target + TOLERANCE(target)) break;
    value += step;
    greedy = next_greedy;
    random = runGames(withParameter(level, value), random_games, 'random');
  }
  return { value, greedy, random, evaluations: tuned.evaluations };
}

// Goals stay believable: at most 60 of one colour, and about 3 candies of colour goals per move once tuned.
const MAX_COLLECT = 60;
const MAX_COLLECT_PER_MOVE = 3.2;
const MIXED_FROM = 40; // the generator's own schedule: two kinds of goal in one level from level 40
// Verification: the tuned setting is replayed on boards the search never saw (attempts from 200,000). A level whose win
// rate there differs from the target by more than this was tuned to its sample, not to the level: another board is tried.
const VERIFY_FIRST_ATTEMPT = 200000;
const VERIFY_LIMIT = 0.09;

/** Whether a tuned level's goals look like a real level's (not "collect 99 in 10 moves"). */
function plausible(level) {
  const collect = level.goals.filter((goal) => goal.type === 'collect');
  const total = collect.reduce((sum, goal) => sum + goal.count, 0);
  return collect.every((goal) => goal.count <= MAX_COLLECT) && (level.time || total <= MAX_COLLECT_PER_MOVE * level.moves);
}

/**
 * A copy of the level with bigger goals (collect counts and special-candy orders grow by `factor`, within the limits
 * above). From level 40, a level whose goals are all fixed by the layout (jelly, ingredients, blocker orders) gets a
 * small collect goal beside them instead, once. Null when nothing can grow.
 */
function withBiggerGoals(level, factor) {
  let grew = false;
  const copy = JSON.parse(JSON.stringify(level));
  if (!copy.goals.some((goal) => goal.type === 'collect' || (goal.type === 'order' && ['striped', 'wrapped', 'bomb'].indexOf(goal.item) >= 0))) {
    if (copy.goals.length >= 2 || copy.id < MIXED_FROM) return null;
    const palette = copy.palette || Array.from({ length: copy.colors }, (unused, color) => color);
    copy.goals.push({ type: 'collect', color: palette[copy.id % palette.length], count: 12 });
    return copy;
  }
  copy.goals.forEach((goal) => {
    if (goal.type === 'collect' && goal.count < MAX_COLLECT) {
      goal.count = Math.min(MAX_COLLECT, Math.max(goal.count + 1, Math.round(goal.count * factor)));
      grew = true;
    } else if (goal.type === 'order' && ['striped', 'wrapped', 'bomb'].indexOf(goal.item) >= 0 && goal.count < 12) {
      goal.count = Math.min(12, Math.max(goal.count + 1, Math.round(goal.count * factor)));
      grew = true;
    }
  });
  return grew ? copy : null;
}

// Like the original's levels, a generated level should give a decent number of moves (and a big goal) rather than a
// tiny goal in a handful of moves, where luck decides everything: while the tuned setting is below this, goals grow.
const COMFORT = Object.freeze({ moves: 15, time: 45 });
const MAX_GOAL_GROWTH = 5;

function calibrateLevel(level_number, options) {
  const games = options.games;
  const random_games = options.random_games;
  const authored = level_number <= AUTHORED.length;
  let best = null;
  for (let variant = 0; variant < (authored ? 1 : MAX_VARIANTS); variant += 1) {
    let candidate = candidateFor(level_number, variant);
    const role = candidate.role || LEVELS.scheduledRole(level_number);
    const target = LEVELS.targetWinRate(level_number, role);
    let tuned = tuneParameter(candidate, target, games);
    for (let growth = 0; growth < MAX_GOAL_GROWTH; growth += 1) {
      const floor = candidate.time ? TIME_RANGE[0] : MOVE_RANGE[0];
      const too_easy_at_floor = tuned.value === floor && tuned.greedy.win_rate > target + TOLERANCE(target);
      // Authored levels keep their goals as written (edit scripts/levels/authored.js instead).
      const wants_more = !authored && (too_easy_at_floor || tuned.value < (candidate.time ? COMFORT.time : COMFORT.moves));
      const bigger = wants_more ? withBiggerGoals(candidate, 1.35) : null;
      if (!bigger) break;
      const retuned = tuneParameter(bigger, target, games);
      if (Math.abs(retuned.greedy.win_rate - target) > TOLERANCE(target) && Math.abs(tuned.greedy.win_rate - target) <= TOLERANCE(target)) break;
      candidate = bigger;
      tuned = retuned;
    }
    // A variant whose goals ended up unbelievable counts as missing the target, so another board is tried.
    const believable = plausible(withParameter(candidate, tuned.value));
    let error = Math.abs(tuned.greedy.win_rate - target) + (believable ? 0 : 1);
    if (error <= TOLERANCE(target) && !authored) {
      const fresh = runGames(withParameter(candidate, tuned.value), games, 'greedy', VERIFY_FIRST_ATTEMPT);
      if (Math.abs(fresh.win_rate - target) > VERIFY_LIMIT) error += 0.5;
    }
    if (!best || error < best.error) best = { candidate, role, target, tuned, error, variant };
    if (error <= TOLERANCE(target)) break;
  }
  const floored = applyRandomFloor(best.candidate, best.role, best.target, best.tuned, random_games);
  best.tuned = floored;
  best.error = Math.abs(floored.greedy.win_rate - best.target);
  const level = withParameter(best.candidate, floored.value);
  level.role = best.role;
  const random = floored.random;
  level.stars = starThresholds(level, floored.greedy, random);
  const problems = LOGIC.validateLevel(level);
  if (problems.length) throw new Error(`level ${level_number} invalid after calibration: ${problems.join('; ')}`);
  return {
    level,
    report: {
      id: level_number,
      role: best.role,
      target: Number(best.target.toFixed(3)),
      win_rate: Number(best.tuned.greedy.win_rate.toFixed(3)),
      random_win_rate: Number(random.win_rate.toFixed(3)),
      within_tolerance: best.error <= TOLERANCE(best.target),
      variant: best.variant,
      parameter: level.time ? `time ${level.time}s` : `moves ${level.moves}`,
      median_final: percentile(best.tuned.greedy.win_final_scores, 0.5),
      median_end: percentile(best.tuned.greedy.end_scores, 0.5),
      median_moves_to_win: percentile(best.tuned.greedy.win_moves, 0.5),
      stars: level.stars,
      new_mechanic: level.newMechanic || '',
      evaluations: best.tuned.evaluations,
    },
  };
}

// ---------------------------------------------------------------- output

function packText(pack_number, first, levels) {
  const lines = levels.map((level) => `    ${JSON.stringify(level)},`);
  return [
    `// Level pack ${pack_number} (levels ${first}-${first + levels.length - 1}). Generated by scripts/calibrate.js: edit`,
    '// scripts/levels/authored.js (levels 1-25) or scripts/levels/generator.js and re-run the calibrator instead of editing by hand.',
    '(function registerPack(root) {',
    "  'use strict';",
    `  const PACK = { pack: ${pack_number}, first: ${first}, levels: [`,
    ...lines,
    '  ] };',
    '  (root.SC_LEVEL_PACKS = root.SC_LEVEL_PACKS || {})[PACK.pack] = PACK;',
    "  if (typeof module === 'object' && module.exports) module.exports = PACK;",
    "})(typeof window !== 'undefined' ? window : globalThis);",
    '',
  ].join('\n');
}

function manifestText(count, packs) {
  return [
    '// How many levels ship and in which packs (written by scripts/calibrate.js).',
    '(function registerManifest(root) {',
    "  'use strict';",
    `  const MANIFEST = { count: ${count}, packs: ${JSON.stringify(packs)} };`,
    '  root.SC_LEVEL_MANIFEST = MANIFEST;',
    "  if (typeof module === 'object' && module.exports) module.exports = MANIFEST;",
    "})(typeof window !== 'undefined' ? window : globalThis);",
    '',
  ].join('\n');
}

function loadExistingLevels(out_dir) {
  const levels = new Map();
  if (!fs.existsSync(out_dir)) return levels;
  fs.readdirSync(out_dir).filter((name) => /^pack-\d{4}\.js$/.test(name)).forEach((name) => {
    const file = path.join(out_dir, name);
    delete require.cache[require.resolve(file)];
    const pack = require(file);
    pack.levels.forEach((level) => levels.set(level.id, level));
  });
  return levels;
}

function writePacks(out_dir, all_levels) {
  fs.mkdirSync(out_dir, { recursive: true });
  let count = 0;
  while (all_levels.has(count + 1)) count += 1;
  const packs = [];
  for (let pack_number = 1; (pack_number - 1) * LEVELS.PACK_SIZE < count; pack_number += 1) {
    const first = (pack_number - 1) * LEVELS.PACK_SIZE + 1;
    const last = Math.min(count, first + LEVELS.PACK_SIZE - 1);
    const levels = [];
    for (let id = first; id <= last; id += 1) levels.push(all_levels.get(id));
    fs.writeFileSync(path.join(out_dir, LEVELS.packFileName(pack_number)), packText(pack_number, first, levels));
    packs.push(pack_number);
  }
  fs.writeFileSync(path.join(out_dir, 'manifest.js'), manifestText(count, packs));
  return { count, packs };
}

function svgChart(rows) {
  const width = 960;
  const height = 380;
  const margin = { left: 52, right: 20, top: 30, bottom: 44 };
  const plot_w = width - margin.left - margin.right;
  const plot_h = height - margin.top - margin.bottom;
  const first = rows[0].id;
  const last = rows[rows.length - 1].id;
  const x = (id) => margin.left + (last === first ? plot_w / 2 : ((id - first) / (last - first)) * plot_w);
  const y = (rate) => margin.top + (1 - rate) * plot_h;
  const role_colors = { normal: '#4a7bd8', breather: '#2fae5a', hard: '#f08a24', superhard: '#d8304c', tutorial: '#8a54d8' };
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="sans-serif" font-size="12">`);
  parts.push(`<rect width="${width}" height="${height}" fill="#fffaf4"/>`);
  parts.push(`<text x="${margin.left}" y="18" font-size="14" font-weight="bold" fill="#3b1a4a">Greedy-bot win rate per level (target line and tolerance band)</text>`);
  [0, 0.25, 0.5, 0.75, 1].forEach((rate) => {
    parts.push(`<line x1="${margin.left}" x2="${width - margin.right}" y1="${y(rate)}" y2="${y(rate)}" stroke="#e6dce8"/>`);
    parts.push(`<text x="${margin.left - 8}" y="${y(rate) + 4}" text-anchor="end" fill="#6b5874">${Math.round(rate * 100)}%</text>`);
  });
  const band_upper = rows.map((row) => `${x(row.id)},${y(Math.min(1, row.target + TOLERANCE(row.target)))}`).join(' ');
  const band_lower = rows.slice().reverse().map((row) => `${x(row.id)},${y(Math.max(0, row.target - TOLERANCE(row.target)))}`).join(' ');
  parts.push(`<polygon points="${band_upper} ${band_lower}" fill="#ffd36e" opacity="0.35"/>`);
  parts.push(`<polyline points="${rows.map((row) => `${x(row.id)},${y(row.target)}`).join(' ')}" fill="none" stroke="#c48a00" stroke-width="2"/>`);
  parts.push(`<polyline points="${rows.map((row) => `${x(row.id)},${y(row.win_rate)}`).join(' ')}" fill="none" stroke="#3b1a4a" stroke-width="1.2" opacity="0.5"/>`);
  rows.forEach((row) => {
    parts.push(`<circle cx="${x(row.id)}" cy="${y(row.win_rate)}" r="4" fill="${role_colors[row.role] || '#888'}"><title>Level ${row.id} (${row.role}): ${Math.round(row.win_rate * 100)}% vs target ${Math.round(row.target * 100)}%</title></circle>`);
  });
  const tick_every = Math.max(1, Math.ceil((last - first) / 12));
  for (let id = first; id <= last; id += tick_every) parts.push(`<text x="${x(id)}" y="${height - margin.bottom + 18}" text-anchor="middle" fill="#6b5874">${id}</text>`);
  let legend_x = margin.left;
  Object.keys(role_colors).forEach((role) => {
    parts.push(`<circle cx="${legend_x}" cy="${height - 10}" r="5" fill="${role_colors[role]}"/><text x="${legend_x + 9}" y="${height - 6}" fill="#3b1a4a">${role}</text>`);
    legend_x += 100;
  });
  parts.push('</svg>');
  return parts.join('\n');
}

function writeReport(report_dir, rows) {
  fs.mkdirSync(report_dir, { recursive: true });
  const header = 'level,role,target,win_rate,random_win_rate,within_tolerance,variant,parameter,median_final,median_end,median_moves_to_win,star1,star2,star3,new_mechanic';
  const lines = rows.map((row) => [row.id, row.role, row.target, row.win_rate, row.random_win_rate, row.within_tolerance, row.variant, row.parameter,
    row.median_final, row.median_end, row.median_moves_to_win, row.stars[0], row.stars[1], row.stars[2], row.new_mechanic].join(','));
  fs.writeFileSync(path.join(report_dir, 'difficulty.csv'), `${header}\n${lines.join('\n')}\n`);
  fs.writeFileSync(path.join(report_dir, 'difficulty.svg'), svgChart(rows));
}

function mergeAndWrite(results, options) {
  const all_levels = loadExistingLevels(options.out);
  results.forEach((result) => all_levels.set(result.level.id, result.level));
  const written = writePacks(options.out, all_levels);
  const orphans = results.filter((result) => result.level.id > written.count).map((result) => result.level.id);
  if (orphans.length) throw new Error(`levels ${orphans[0]}-${orphans[orphans.length - 1]} do not follow on from the shipped levels (1-${written.count}); calibrate the gap first`);
  const report_path = path.join(options.report, 'difficulty.csv');
  const report_rows = new Map();
  if (fs.existsSync(report_path)) {
    fs.readFileSync(report_path, 'utf8').trim().split('\n').slice(1).forEach((line) => {
      const cells = line.split(',');
      report_rows.set(Number(cells[0]), {
        id: Number(cells[0]), role: cells[1], target: Number(cells[2]), win_rate: Number(cells[3]), random_win_rate: Number(cells[4]),
        within_tolerance: cells[5] === 'true', variant: Number(cells[6]), parameter: cells[7], median_final: Number(cells[8]), median_end: Number(cells[9]),
        median_moves_to_win: Number(cells[10]), stars: [Number(cells[11]), Number(cells[12]), Number(cells[13])], new_mechanic: cells[14] || '',
      });
    });
  }
  results.forEach((result) => report_rows.set(result.report.id, result.report));
  const rows = Array.from(report_rows.values()).filter((row) => row.id <= written.count).sort((a, b) => a.id - b.id);
  if (rows.length) writeReport(options.report, rows);
  return written;
}

// ---------------------------------------------------------------- CLI and workers

function parseArgs(argv) {
  const options = { from: 1, to: 60, games: 300, random_games: 100, workers: Math.max(1, Math.min(os.cpus().length, 8)), out: path.join(ROOT, 'www/levels'), report: path.join(ROOT, 'docs/difficulty'), emit: null, merge: null };
  for (let index = 2; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name === '--from') options.from = Number(value);
    else if (name === '--to') options.to = Number(value);
    else if (name === '--games') options.games = Number(value);
    else if (name === '--random-games') options.random_games = Number(value);
    else if (name === '--workers') options.workers = Number(value);
    else if (name === '--out') options.out = path.resolve(value);
    else if (name === '--report') options.report = path.resolve(value);
    else if (name === '--emit') options.emit = path.resolve(value);
    else if (name === '--merge') {
      options.merge = [];
      while (index + 1 < argv.length && !argv[index + 1].startsWith('--')) options.merge.push(path.resolve(argv[++index]));
      continue;
    } else continue;
    index += 1;
  }
  return options;
}

function runWorkers(level_numbers, options) {
  const buckets = Array.from({ length: Math.min(options.workers, level_numbers.length) }, () => []);
  // Interleave so slow and fast levels spread evenly.
  level_numbers.forEach((level_number, index) => buckets[index % buckets.length].push(level_number));
  return Promise.all(buckets.map((bucket) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { level_numbers: bucket, games: options.games, random_games: options.random_games } });
    const results = [];
    worker.on('message', (message) => {
      if (message.done) resolve(results);
      else {
        results.push(message.result);
        const report = message.result.report;
        console.log(`level ${String(report.id).padStart(5)} ${report.role.padEnd(9)} target ${(report.target * 100).toFixed(0).padStart(3)}%  bot ${(report.win_rate * 100).toFixed(0).padStart(3)}%  random ${(report.random_win_rate * 100).toFixed(0).padStart(3)}%  ${report.parameter.padEnd(10)} stars ${JSON.stringify(report.stars)}${report.within_tolerance ? '' : '  (outside tolerance)'}`);
      }
    });
    worker.on('error', reject);
  }))).then((parts) => parts.flat().sort((a, b) => a.level.id - b.level.id));
}

if (!isMainThread && workerData && workerData.level_numbers) {
  workerData.level_numbers.forEach((level_number) => {
    parentPort.postMessage({ result: calibrateLevel(level_number, workerData) });
  });
  parentPort.postMessage({ done: true });
} else if (require.main === module) {
  const options = parseArgs(process.argv);
  const started = Date.now();
  if (options.merge) {
    const results = options.merge.flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
    const written = mergeAndWrite(results, options);
    console.log(`merged ${results.length} levels; ${written.count} levels ship in packs ${JSON.stringify(written.packs)}`);
  } else {
    const level_numbers = [];
    for (let level_number = options.from; level_number <= options.to; level_number += 1) level_numbers.push(level_number);
    runWorkers(level_numbers, options).then((results) => {
      const outside = results.filter((result) => !result.report.within_tolerance).map((result) => result.level.id);
      if (options.emit) {
        fs.mkdirSync(path.dirname(options.emit), { recursive: true });
        fs.writeFileSync(options.emit, JSON.stringify(results));
        console.log(`wrote ${results.length} calibrated levels to ${options.emit}`);
      } else {
        const written = mergeAndWrite(results, options);
        console.log(`${written.count} levels ship in packs ${JSON.stringify(written.packs)}`);
      }
      console.log(`calibrated ${results.length} levels in ${((Date.now() - started) / 1000).toFixed(1)} s on ${options.workers} threads; outside tolerance: ${outside.length ? outside.join(', ') : 'none'}`);
    }).catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }
}

module.exports = { calibrateLevel, starThresholds, tuneParameter, candidateFor, svgChart, TOLERANCE };
