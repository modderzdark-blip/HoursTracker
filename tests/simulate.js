// Fuzz and bot simulations (CI job "logic").
//  - Fuzz: 2,000 random-valid-move games per level; board invariants checked after every move; iteration caps.
//  - Greedy bot: 300 games per level (specials first, then the largest match, with goal-relevance weighting).
// Prints win rate, median score and suggested star thresholds per level (1 star = 40% of the 2-star score, only a mark on
// the HUD meter because a win always earns 1 star; 3 stars = the random-move player's median winning score and 2 stars
// its 20th percentile, end bonus included, so an ordinary win earns 3 stars; see the fallback below).
// Fails if any level is never won, if Level 1 is not near-certain, if Level 10 leaves the 30-60% target band,
// or on any exception / invariant break.
// Usage: node tests/simulate.js [--fuzz 2000] [--bot 300] [--report sim-report.json]
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const WWW = path.join(__dirname, '..', 'www', 'js');
const MAX_MOVES_PER_GAME = 500;

function loadGame() {
  require(path.join(WWW, 'util.js'));
  const LOGIC = require(path.join(WWW, 'logic.js'));
  const LEVELS = require(path.join(WWW, 'levels.js'));
  const UTIL = require(path.join(WWW, 'util.js'));
  return { LOGIC, LEVELS, UTIL };
}

function playGame(LOGIC, UTIL, level, mode, game_index) {
  const rng = UTIL.createRng((mode === 'fuzz' ? 1000003 : 2000003) + level.id * 100000 + game_index);
  let state = LOGIC.createGame(level, { seed: level.seed + (mode === 'fuzz' ? 0 : 500000) + game_index * 101 });
  let moves = 0;
  const invariant_problems = [];
  while (state.status === 'playing') {
    moves += 1;
    if (moves > MAX_MOVES_PER_GAME) throw new Error('game exceeded the move cap');
    const move = mode === 'fuzz' ? LOGIC.chooseRandomMove(state, rng) : LOGIC.chooseGreedyMove(state, rng);
    if (!move) throw new Error('no move available while playing');
    const result = LOGIC.applySwap(state, move.from, move.to);
    if (!result.valid) throw new Error('listed move was rejected');
    state = result.state;
    const problems = LOGIC.checkBoardInvariants(state);
    if (problems.length) invariant_problems.push(`move ${moves}: ${problems.join('; ')}`);
  }
  const score_at_end = state.score;
  let final_score = state.score;
  if (state.status === 'won') {
    const bonus = LOGIC.applyEndBonus(state);
    const problems = LOGIC.checkBoardInvariants(bonus.state).filter((problem) => problem.indexOf('valid move') < 0);
    if (problems.length) invariant_problems.push(`bonus: ${problems.join('; ')}`);
    final_score = bonus.state.score;
  }
  return { won: state.status === 'won', moves_used: state.moves_made, score_at_end, final_score, invariant_problems };
}

function runTask(task) {
  const { LOGIC, LEVELS, UTIL } = loadGame();
  const level = LEVELS.find((candidate) => candidate.id === task.level_id);
  const summary = { level_id: task.level_id, mode: task.mode, games: 0, wins: 0, moves_played: 0, exceptions: [], invariant_failures: [], final_scores: [], win_final_scores: [], end_scores: [], win_moves: [] };
  for (let game_index = task.first_game; game_index < task.first_game + task.game_count; game_index += 1) {
    try {
      const outcome = playGame(LOGIC, UTIL, level, task.mode, game_index);
      summary.games += 1;
      summary.moves_played += outcome.moves_used;
      summary.end_scores.push(outcome.score_at_end);
      summary.final_scores.push(outcome.final_score);
      if (outcome.won) {
        summary.wins += 1;
        summary.win_final_scores.push(outcome.final_score);
        summary.win_moves.push(outcome.moves_used);
      }
      if (outcome.invariant_problems.length) summary.invariant_failures.push(`game ${game_index}: ${outcome.invariant_problems[0]}`);
    } catch (error) {
      summary.games += 1;
      summary.exceptions.push(`game ${game_index}: ${error && error.stack ? error.stack.split('\n').slice(0, 2).join(' ') : error}`);
    }
  }
  return summary;
}

if (!isMainThread) {
  parentPort.postMessage(workerData.tasks.map(runTask));
} else {
  const argument = (name, fallback) => {
    const index = process.argv.indexOf(name);
    return index > 0 ? process.argv[index + 1] : fallback;
  };
  const fuzz_games = Number(argument('--fuzz', 2000));
  const bot_games = Number(argument('--bot', 300));
  const report_path = argument('--report', null);
  const { LEVELS } = loadGame();
  const tasks = [];
  const CHUNK = 100;
  LEVELS.forEach((level) => {
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
      if (!merged.has(key)) merged.set(key, { level_id: part.level_id, mode: part.mode, games: 0, wins: 0, moves_played: 0, exceptions: [], invariant_failures: [], final_scores: [], win_final_scores: [], end_scores: [], win_moves: [] });
      const target = merged.get(key);
      ['games', 'wins', 'moves_played'].forEach((field) => { target[field] += part[field]; });
      ['exceptions', 'invariant_failures', 'final_scores', 'win_final_scores', 'end_scores', 'win_moves'].forEach((field) => { target[field].push(...part[field]); });
    });
    const percentile = (values, fraction) => {
      if (!values.length) return 0;
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
    };
    const floor500 = (value) => Math.max(500, Math.floor(value / 500) * 500);
    const failures = [];
    const report = { generated: new Date().toISOString(), fuzz_games_per_level: fuzz_games, bot_games_per_level: bot_games, levels: [] };
    console.log('================ FUZZ (random valid moves) ================');
    console.log('Level  Name               Games  Moves    Exceptions  InvariantFails  RandomWin%  RandomFinal(win) p20/p50');
    LEVELS.forEach((level) => {
      const fuzz = merged.get(`${level.id}:fuzz`);
      console.log(`${String(level.id).padEnd(6)} ${level.name.padEnd(18)} ${String(fuzz.games).padEnd(6)} ${String(fuzz.moves_played).padEnd(8)} ${String(fuzz.exceptions.length).padEnd(11)} ${String(fuzz.invariant_failures.length).padEnd(15)} ${(100 * fuzz.wins / fuzz.games).toFixed(1).padEnd(11)} ${percentile(fuzz.win_final_scores, 0.2)}/${percentile(fuzz.win_final_scores, 0.5)}`);
      fuzz.exceptions.slice(0, 3).forEach((line) => console.log(`       ! ${line}`));
      fuzz.invariant_failures.slice(0, 3).forEach((line) => console.log(`       ! ${line}`));
      if (fuzz.exceptions.length) failures.push(`level ${level.id}: ${fuzz.exceptions.length} fuzz exceptions`);
      if (fuzz.invariant_failures.length) failures.push(`level ${level.id}: ${fuzz.invariant_failures.length} fuzz invariant failures`);
    });
    console.log('');
    console.log('================ GREEDY BOT ================');
    console.log('Level  Name               Games  Win%    MedianScore(end)  MedianFinal(win)  MedianMovesToWin  SuggestedStars        CurrentStars');
    LEVELS.forEach((level) => {
      const fuzz = merged.get(`${level.id}:fuzz`);
      const bot = merged.get(`${level.id}:bot`);
      const win_rate = bot.games ? (100 * bot.wins) / bot.games : 0;
      const score_goal = level.goals.find((goal) => goal.type === 'score');
      // Stars are set for a casual player: 3 stars = a typical win by the random-move player, 2 stars = its 20th
      // percentile. Where random play rarely wins, fall back to 80% of the bot's 8th and 25th percentiles.
      const casual = fuzz.wins >= 40;
      const suggested = [
        0,
        floor500(casual ? percentile(fuzz.win_final_scores, 0.2) : 0.8 * percentile(bot.win_final_scores, 0.08)),
        floor500(casual ? percentile(fuzz.win_final_scores, 0.5) : 0.8 * percentile(bot.win_final_scores, 0.25)),
      ];
      suggested[0] = score_goal ? score_goal.target : floor500(0.4 * suggested[1]);
      if (suggested[1] <= suggested[0]) suggested[1] = suggested[0] + 500;
      if (suggested[2] <= suggested[1]) suggested[2] = suggested[1] + 500;
      const median_end = percentile(bot.end_scores, 0.5);
      const median_final = percentile(bot.win_final_scores, 0.5);
      const median_moves = percentile(bot.win_moves, 0.5);
      console.log(`${String(level.id).padEnd(6)} ${level.name.padEnd(18)} ${String(bot.games).padEnd(6)} ${win_rate.toFixed(1).padEnd(7)} ${String(median_end).padEnd(17)} ${String(median_final).padEnd(17)} ${String(median_moves).padEnd(17)} ${JSON.stringify(suggested).padEnd(20)} ${JSON.stringify(level.stars)}`);
      bot.exceptions.slice(0, 3).forEach((line) => console.log(`       ! ${line}`));
      if (bot.exceptions.length) failures.push(`level ${level.id}: ${bot.exceptions.length} bot exceptions`);
      if (bot.invariant_failures.length) failures.push(`level ${level.id}: ${bot.invariant_failures.length} bot invariant failures`);
      if (bot.wins + fuzz.wins === 0) failures.push(`level ${level.id} was never won`);
      if (!(level.stars[0] < level.stars[1] && level.stars[1] < level.stars[2])) failures.push(`level ${level.id}: star thresholds must increase`);
      if (score_goal && level.stars[0] !== score_goal.target) failures.push(`level ${level.id}: first star must equal the score goal`);
      report.levels.push({
        id: level.id, name: level.name, fuzz_games: fuzz.games, fuzz_moves: fuzz.moves_played, fuzz_exceptions: fuzz.exceptions.length,
        fuzz_invariant_failures: fuzz.invariant_failures.length, random_win_rate: fuzz.wins / fuzz.games, bot_games: bot.games,
        bot_win_rate: bot.wins / bot.games, bot_median_score_at_end: median_end, bot_median_final_score_on_win: median_final,
        bot_median_moves_to_win: median_moves, suggested_stars: suggested, stars: level.stars,
      });
    });
    const level_one = report.levels[0];
    const level_ten = report.levels.find((entry) => entry.id === 10);
    if (level_one && level_one.bot_win_rate < 0.95) failures.push('level 1 should be nearly impossible to fail (bot win rate >= 95%)');
    if (level_ten && (level_ten.bot_win_rate < 0.3 || level_ten.bot_win_rate > 0.6)) failures.push(`level 10 bot win rate ${(level_ten.bot_win_rate * 100).toFixed(1)}% is outside the 30-60% target`);
    console.log('');
    console.log(`Simulated ${fuzz_games * LEVELS.length} fuzz games and ${bot_games * LEVELS.length} bot games on ${worker_count} threads in ${((Date.now() - started) / 1000).toFixed(1)} s.`);
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
