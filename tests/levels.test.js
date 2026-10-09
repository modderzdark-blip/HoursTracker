// Level tests (CI job "levels"): the shipped levels, the generator's rules and the difficulty curve.
//  - every shipped level validates, is numbered in order, and is won by the greedy bot
//  - one new idea per level, and no idea before its unlock level (levels 1-360: shipped + generated)
//  - the generator's unlock schedule, colour schedule, complexity budget and blocker cap
//  - 40+ board templates; no goal mode more than three times in a row
//  - the calibrated curve: every shipped level inside its tolerance of its target (8 points, tighter for hard levels)
//  - scale: 300 consecutive generated levels (61-360) plus a sample up to 20,000 validate, deterministically and fast
// Usage: node tests/levels.test.js
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const LOGIC = require(path.join(ROOT, 'www/js/logic.js'));
const LEVELS = require(path.join(ROOT, 'www/js/levels.js'));
const GENERATOR = require(path.join(ROOT, 'scripts/levels/generator.js'));
const AUTHORED = require(path.join(ROOT, 'scripts/levels/authored.js'));

const SCALE_FIRST = 61;
const SCALE_LAST = 360;
const TESTS = [];
const test = (name, run) => TESTS.push({ name, run });

const shipped = [];
for (let level_number = 1; level_number <= LEVELS.shippedCount(); level_number += 1) shipped.push(LEVELS.getLevel(level_number));

/** Levels 1..last: the shipped records, then freshly generated ones. */
const levelCache = new Map();
function levelAt(level_number) {
  if (level_number <= shipped.length) return shipped[level_number - 1];
  if (!levelCache.has(level_number)) levelCache.set(level_number, GENERATOR.generateLevel(level_number, 0));
  return levelCache.get(level_number);
}

function activeCells(level) {
  return level.layout.reduce((sum, row_text) => sum + row_text.split('').filter((symbol) => symbol !== '#').length, 0);
}

function blockerCells(level) {
  return level.layout.reduce((sum, row_text) => sum + row_text.split('').filter((symbol) => /[1-5kob]/.test(symbol)).length, 0);
}

test('shipped levels: 60+, numbered in order, valid, roles set, authored layouts untouched', () => {
  assert.ok(shipped.length >= 60, `${shipped.length} levels ship`);
  shipped.forEach((level, index) => {
    assert.strictEqual(level.id, index + 1);
    assert.deepStrictEqual(LOGIC.validateLevel(level), [], `level ${level.id}`);
    assert.ok(LEVELS.ROLES.includes(level.role), `level ${level.id} role`);
  });
  AUTHORED.forEach((authored) => {
    const level = LEVELS.getLevel(authored.id);
    assert.deepStrictEqual(level.layout, authored.layout, `level ${authored.id} layout`);
    assert.deepStrictEqual(level.goals, authored.goals, `level ${authored.id} goals`);
    assert.strictEqual(level.role, authored.role, `level ${authored.id} role`);
  });
});

test('shipped levels: every level is won by the greedy bot', () => {
  shipped.forEach((level) => {
    let wins = 0;
    for (let attempt = 0; attempt < 30 && wins === 0; attempt += 1) {
      if (LOGIC.playBotGame(level, { attempt: 5000 + attempt }).won) wins += 1;
    }
    assert.ok(wins > 0, `level ${level.id} never won`);
  });
});

test(`one new idea per level and none before its unlock (levels 1-${SCALE_LAST})`, () => {
  const seen = new Set();
  const first_seen = {};
  for (let level_number = 1; level_number <= SCALE_LAST; level_number += 1) {
    const level = levelAt(level_number);
    const ideas = GENERATOR.ideasOf(level);
    const fresh = Array.from(ideas).filter((idea) => !seen.has(idea));
    // A double layer of jelly arriving with jelly itself, or thick frosting with frosting, is one idea.
    const distinct = fresh.filter((idea) => !(idea === 'jelly2' && fresh.includes('jelly')) && !(idea === 'frosting3' && fresh.includes('frosting')) && !(idea === 'hazelnut' && fresh.includes('ingredients')));
    assert.ok(distinct.length <= 1, `level ${level_number} introduces ${fresh.join(', ')}`);
    fresh.forEach((idea) => {
      seen.add(idea);
      first_seen[idea] = level_number;
    });
  }
  Object.keys(first_seen).forEach((idea) => {
    if (GENERATOR.UNLOCKS[idea] !== undefined) assert.ok(first_seen[idea] >= GENERATOR.UNLOCKS[idea], `${idea} appears at ${first_seen[idea]}, unlocks at ${GENERATOR.UNLOCKS[idea]}`);
  });
  ['belt', 'frosting3', 'hazelnut'].forEach((idea) => assert.strictEqual(first_seen[idea], GENERATOR.UNLOCKS[idea], `${idea} is introduced exactly at its unlock level`));
});

test('no level is won by points alone: no score goals in the shipped levels or anywhere the generator reaches', () => {
  const scoreGoal = (level) => level.goals.some((goal) => goal.type === 'score');
  for (let level_number = 1; level_number <= LEVELS.shippedCount(); level_number += 1) {
    assert.ok(!scoreGoal(LEVELS.getLevel(level_number)), `shipped level ${level_number} has a score goal`);
  }
  AUTHORED.forEach((level) => assert.ok(!scoreGoal(level), `authored level ${level.id} has a score goal`));
  for (let level_number = 26; level_number <= 20000; level_number += level_number < 600 ? 1 : 97) {
    assert.ok(!scoreGoal(GENERATOR.generateLevel(level_number)), `generated level ${level_number} has a score goal`);
  }
});

test('generator schedule: colours, mixed goals, complexity budget and the 30% blocker cap', () => {
  const colourShare = (first, last, minimum) => {
    let count = 0;
    for (let level_number = first; level_number <= last; level_number += 1) if (levelAt(level_number).colors >= minimum) count += 1;
    return count / (last - first + 1);
  };
  for (let level_number = 26; level_number <= SCALE_LAST; level_number += 1) {
    const level = levelAt(level_number);
    if (level_number < 20) assert.strictEqual(level.colors, 4);
    if (level_number < 150) assert.ok(level.colors <= 5, `level ${level_number}: 6 colours before 150`);
    if (level_number < 40) assert.ok(new Set(level.goals.map((goal) => goal.type)).size === 1, `level ${level_number}: mixed goals before 40`);
    const types = GENERATOR.blockerTypesOf(level);
    assert.ok(types.length <= GENERATOR.blockerBudget(level_number), `level ${level_number}: ${types.join('+')} over the budget`);
    assert.ok(blockerCells(level) <= Math.floor(activeCells(level) * 0.3), `level ${level_number}: more than 30% blockers`);
  }
  assert.deepStrictEqual([59, 60, 199, 200, 599, 600].map(GENERATOR.blockerBudget), [1, 2, 2, 3, 3, 4]);
  assert.ok(colourShare(80, 149, 5) > 0.75, 'five colours dominate from 80');
  assert.ok(colourShare(SCALE_FIRST, 79, 5) > 0.25 && colourShare(SCALE_FIRST, 79, 5) < 0.85, 'five colours in about half of the levels before 80');
  assert.ok(colourShare(150, SCALE_LAST, 6) > 0.1, 'six colours appear from 150');
  let six_late = 0;
  for (let level_number = 400; level_number < 500; level_number += 1) if (GENERATOR.generateLevel(level_number, 0).colors === 6) six_late += 1;
  assert.ok(six_late > 60, `six colours dominate from 400 (${six_late}/100)`);
});

test('40+ board templates, all valid; no goal mode more than three times in a row (to 20,000)', () => {
  assert.ok(GENERATOR.SHAPES.length >= 40, `${GENERATOR.SHAPES.length} templates`);
  assert.strictEqual(new Set(GENERATOR.SHAPES.map((shape) => shape.id)).size, GENERATOR.SHAPES.length, 'unique ids');
  GENERATOR.SHAPES.filter((shape) => !shape.portal).forEach((shape) => {
    const level = { id: shape.id, rows: shape.rows.length, cols: shape.rows[0].length, colors: 5, seed: 7, moves: 20, layout: shape.rows, goals: [{ type: 'score', target: 1000 }], stars: [1000, 2000, 3000] };
    assert.deepStrictEqual(LOGIC.validateLevel(level), [], `template ${shape.id}`);
  });
  let run = 0;
  let previous = null;
  for (let level_number = 26; level_number <= 20000; level_number += 1) {
    const mode = GENERATOR.modeFor(level_number);
    run = mode === previous ? run + 1 : 1;
    previous = mode;
    assert.ok(run <= 3, `mode ${mode} four times in a row at level ${level_number}`);
  }
});

test('the calibrated curve: every shipped level within its tolerance of its target', () => {
  const csv = fs.readFileSync(path.join(ROOT, 'docs/difficulty/difficulty.csv'), 'utf8').trim().split('\n');
  const header = csv[0].split(',');
  const rows = csv.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((name, index) => { row[name] = cells[index]; });
    return row;
  });
  assert.strictEqual(rows.length, shipped.length, 'one report row per shipped level');
  rows.forEach((row) => {
    const level = LEVELS.getLevel(Number(row.level));
    const target = LEVELS.targetWinRate(level.id, level.role);
    assert.ok(Math.abs(Number(row.target) - target) < 0.001, `level ${level.id}: report target ${row.target} vs ${target.toFixed(3)}`);
    assert.ok(Math.abs(Number(row.win_rate) - target) <= LEVELS.calibrationTolerance(target) + 1e-9, `level ${level.id}: ${row.win_rate} vs target ${target.toFixed(3)}`);
    assert.deepStrictEqual([Number(row.star1), Number(row.star2), Number(row.star3)], level.stars, `level ${level.id} stars match the report`);
  });
  // The Candy Crush-matched shape: normal levels ease down to about 27%, hard ones take several tries.
  let previous = 1;
  for (let level_number = 26; level_number <= 2000; level_number += 1) {
    const base = LEVELS.baseWinRate(level_number);
    assert.ok(base <= previous + 1e-12 && base >= 0.27 && base <= 0.63, `base(${level_number}) = ${base}`);
    previous = base;
    const hard = LEVELS.targetWinRate(level_number, 'hard');
    assert.ok(hard >= 0.09 && hard <= 0.23 && LEVELS.targetWinRate(level_number, 'superhard') < hard, `hard targets at ${level_number}`);
  }
});

test(`scale: levels ${SCALE_FIRST}-${SCALE_LAST} and a sample up to 20,000 generate valid, deterministic levels quickly`, () => {
  const started = Date.now();
  for (let level_number = SCALE_FIRST; level_number <= SCALE_LAST; level_number += 1) {
    const level = levelAt(level_number);
    assert.deepStrictEqual(LOGIC.validateLevel(level), [], `level ${level_number}`);
    assert.strictEqual(level.id, level_number);
  }
  const consecutive_ms = Date.now() - started;
  const sample_started = Date.now();
  let sampled = 0;
  for (let level_number = 401; level_number <= 20000; level_number += 97) {
    const level = GENERATOR.generateLevel(level_number, 0);
    assert.deepStrictEqual(LOGIC.validateLevel(level), [], `level ${level_number}`);
    assert.strictEqual(JSON.stringify(level), JSON.stringify(GENERATOR.generateLevel(level_number, 0)), `level ${level_number} is deterministic`);
    sampled += 1;
  }
  const sample_ms = Date.now() - sample_started;
  console.log(`      generated ${SCALE_LAST - SCALE_FIRST + 1} consecutive levels in ${consecutive_ms} ms and ${sampled} sampled levels in ${sample_ms} ms`);
  assert.ok(consecutive_ms < 60000, 'generation stays fast');
});

(async function runAll() {
  const started = Date.now();
  let failed = 0;
  for (const entry of TESTS) {
    const test_started = Date.now();
    try {
      await entry.run();
      console.log(`PASS  ${entry.name}  (${Date.now() - test_started} ms)`);
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${entry.name}  (${Date.now() - test_started} ms)`);
      console.log(`      ${error && error.stack ? error.stack.split('\n').slice(0, 3).join(' | ') : error}`);
    }
  }
  console.log('------------------------------------------------------------');
  console.log(`${TESTS.length - failed}/${TESTS.length} passed, ${failed} failed, ${Date.now() - started} ms`);
  process.exit(failed === 0 ? 0 : 1);
})();
