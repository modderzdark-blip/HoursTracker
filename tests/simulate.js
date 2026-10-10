// Fuzz and bot simulations (CI job "logic").
//  - Fuzz: random-valid-move games per shipped level (500 by default); board invariants checked after every move and
//    after the Sweet Finale; iteration caps.
//  - Greedy bot: games per level (200 by default) on seeds the calibrator never used, so the check is not circular.
// Fails on any exception or invariant break, if a level is never won, if the greedy win rate drifts more than 15 points
// from the level's target (the calibrator holds it within 8 on its own seeds), or if Level 1 is not near-certain.
// Usage: node tests/simulate.js [--fuzz 500] [--bot 200] [--report sim-report.json]
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const WWW = path.join(__dirname, '..', 'www', 'js');
const MOVE_CAP = 400;
const DRIFT_LIMIT = 0.15;
const FRESH_SEEDS = 100000; // attempts the calibrator (0-299) never plays

function loadGame() {
  const UTIL = require(path.join(WWW, 'util.js'));
  const LOGIC = require(path.join(WWW, 'logic.js'));
  const LEVELS = require(path.join(WWW, 'levels.js'));
  return { LOGIC, LEVELS, UTIL };
}

function playGame(LOGIC, level, mode, game_index) {
  const invariant_problems = [];
  let moves = 0;
  const result = LOGIC.playBotGame(level, {
    attempt: FRESH_SEEDS + game_index,
    policy: mode === 'fuzz' ? 'random' : 'greedy',
    rng_seed: (mode === 'fuzz' ? 1000003 : 2000003) + level.id * 100000 + game_index,
    move_cap: MOVE_CAP,
    on_move: (state) => {
      moves += 1;
      const problems = LOGIC.checkBoardInvariants(state).filter((problem) => state.status === 'playing' || problem.indexOf('valid move') < 0);
      if (problems.length) invariant_problems.push(`move ${moves}: ${problems.join('; ')}`);
    },
  });
  if (moves >= MOVE_CAP) throw new Error('game exceeded the move cap');
  return Object.assign(result, { invariant_problems });
}

function runTask(task) {
  const { LOGIC, LEVELS } = loadGame();
  const level = LEVELS.getLevel(task.level_id);
  const summary = { level_id: task.level_id, mode: task.mode, games: 0, wins: 0, moves_played: 0, exceptions: [], invariant_failures: [], win_final_scores: [], end_scores: [], win_moves: [] };
  for (let game_index = task.first_game; game_index < task.first_game + task.game_count; game_index += 1) {
    summary.games += 1;
    try {
      const outcome = playGame(LOGIC, level, task.mode, game_index);
      summary.moves_played += outcome.moves_used;
      summary.end_scores.push(outcome.score_at_end);
      if (outcome.won) {
        summary.wins += 1;
        summary.win_final_scores.push(outcome.final_score);
        summary.win_moves.push(outcome.moves_used);
      }
      if (outcome.invariant_problems.length) summary.invariant_failures.push(`game ${game_index}: ${outcome.invariant_problems[0]}`);
    } catch (error) {
      summary.exceptions.push(`game ${game_index}: ${error && error.stack ? error.stack.split('\n').slice(0, 2).join(' ') : error}`);
    }
  }
  return summary;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
}

if (!isMainThread) {
  parentPort.postMessage(workerData.tasks.map(runTask));
} else {
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : fallback;
  };
  const fuzz_games = Number(argument('--fuzz', 500));
  const bot_games = Number(argument('--bot', 400));
  const report_path = argument('--report', null);
  const { LEVELS } = loadGame();
  const levels = [];
  for (let level_number = 1; level_number <= LEVELS.shippedCount(); level_number += 1) levels.push(LEVELS.getLevel(level_number));
  const tasks = [];
  const CHUNK = 50;
  levels.forEach((level) => {
    for (let first = 0; first < fuzz_games; first += CHUNK) tasks.push({ level_id: level.id, mode: 'fuzz', first_game: first, game_count: Math.min(CHUNK, fuzz_games - first) });
    for (let first = 0; first < bot_games; first += CHUNK) tasks.push({ level_id: level.id, mode: 'bot', first_game: first, game_count: Math.min(CHUNK, bot_games - first) });
  });
  const worker_count = Math.max(1, Math.min(os.cpus().length, 8));
  const buckets = Array.from({ length: worker_count }, () => []);
  tasks.forEach((task, index) => buckets[index % worker_count].push(task));
  const started = Date.now();
  Promise.all(buckets.map((bucket) => new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { tasks: bucket } });
    worker.once('message', resolve);
    worker.once('error', reject);
  }))).then((bucket_results) => {
    const merged = new Map();
    bucket_results.flat().forEach((part) => {
      const key = `${part.level_id}:${part.mode}`;
      if (!merged.has(key)) merged.set(key, { games: 0, wins: 0, moves_played: 0, exceptions: [], invariant_failures: [], win_final_scores: [], end_scores: [], win_moves: [] });
      const target = merged.get(key);
      ['games', 'wins', 'moves_played'].forEach((field) => { target[field] += part[field]; });
      ['exceptions', 'invariant_failures', 'win_final_scores', 'end_scores', 'win_moves'].forEach((field) => { target[field].push(...part[field]); });
    });
    const failures = [];
    const report = { generated: new Date().toISOString(), fuzz_games_per_level: fuzz_games, bot_games_per_level: bot_games, levels: [] };
    console.log('Level  Role       Setting   Fuzz moves  Exc  Inv  Random%  Bot%   Target%  Drift  MedianFinal(win)  Stars');
    levels.forEach((level) => {
      const fuzz = merged.get(`${level.id}:fuzz`) || { games: 0, wins: 0, moves_played: 0, exceptions: [], invariant_failures: [], win_final_scores: [] };
      const bot = merged.get(`${level.id}:bot`) || { games: 0, wins: 0, exceptions: [], invariant_failures: [], win_final_scores: [], end_scores: [], win_moves: [] };
      const random_rate = fuzz.games ? fuzz.wins / fuzz.games : 0;
      const bot_rate = bot.games ? bot.wins / bot.games : 0;
      const target = LEVELS.targetWinRate(level.id, level.role);
      const drift = bot_rate - target;
      const setting = level.time ? `${level.time}s` : `${level.moves} moves`;
      console.log(`${String(level.id).padEnd(6)} ${level.role.padEnd(10)} ${setting.padEnd(9)} ${String(fuzz.moves_played).padEnd(11)} ${String(fuzz.exceptions.length + bot.exceptions.length).padEnd(4)} ${String(fuzz.invariant_failures.length + bot.invariant_failures.length).padEnd(4)} ${(random_rate * 100).toFixed(0).padEnd(8)} ${(bot_rate * 100).toFixed(0).padEnd(6)} ${(target * 100).toFixed(0).padEnd(8)} ${(drift >= 0 ? '+' : '') + (drift * 100).toFixed(0).padEnd(5)} ${String(percentile(bot.win_final_scores, 0.5)).padEnd(17)} ${JSON.stringify(level.stars)}`);
      fuzz.exceptions.concat(bot.exceptions, fuzz.invariant_failures, bot.invariant_failures).slice(0, 3).forEach((line) => console.log(`       ! ${line}`));
      if (fuzz.exceptions.length + bot.exceptions.length) failures.push(`level ${level.id}: ${fuzz.exceptions.length + bot.exceptions.length} exceptions`);
      if (fuzz.invariant_failures.length + bot.invariant_failures.length) failures.push(`level ${level.id}: ${fuzz.invariant_failures.length + bot.invariant_failures.length} invariant failures`);
      if (bot_games > 0 && bot.wins + fuzz.wins === 0) failures.push(`level ${level.id} was never won`);
      if (bot_games >= 100 && Math.abs(drift) > DRIFT_LIMIT) failures.push(`level ${level.id}: greedy win rate ${(bot_rate * 100).toFixed(0)}% drifts from the ${(target * 100).toFixed(0)}% target`);
      report.levels.push({
        id: level.id, role: level.role, setting, fuzz_games: fuzz.games, fuzz_moves: fuzz.moves_played, exceptions: fuzz.exceptions.length + bot.exceptions.length,
        invariant_failures: fuzz.invariant_failures.length + bot.invariant_failures.length, random_win_rate: random_rate, bot_games: bot.games, bot_win_rate: bot_rate,
        target, bot_median_final_score_on_win: percentile(bot.win_final_scores, 0.5), bot_median_moves_to_win: percentile(bot.win_moves, 0.5), stars: level.stars,
      });
    });
    const level_one = report.levels[0];
    if (bot_games >= 100 && level_one && level_one.bot_win_rate < 0.9) failures.push('level 1 should be nearly impossible to fail (bot win rate >= 90%)');
    console.log('');
    console.log(`Simulated ${fuzz_games * levels.length} fuzz games and ${bot_games * levels.length} bot games over ${levels.length} levels on ${worker_count} threads in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
    report.failures = failures;
    if (report_path) fs.writeFileSync(report_path, JSON.stringify(report, null, 2));
    if (failures.length) {
      console.log('SIMULATION: FAILED');
      failures.forEach((failure) => console.log(`  - ${failure}`));
      process.exit(1);
    }
    console.log('SIMULATION: ALL CHECKS PASSED');
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
