import { BOSSES } from '../../data/bosses';
import { DIFFICULTIES } from '../../data/difficulty';
import { HEROES } from '../../data/heroes';
import {
  ARENA_CONFIG,
  CHALLENGE_CONFIG,
  DUNGEON_CONFIG,
  HUNT_CONFIG,
  HUNT_OMENS,
  TOWER_CONFIG,
  type ModeId,
} from '../../data/modes';
import {
  challengeMult,
  challengeStage,
  generateOpponents,
  highestClearedLevel,
  huntMult,
  huntRank,
  huntRankProgress,
  huntRewards,
  isTowerBossFloor,
  leaderboard,
  nextRefillInMs,
  rankLabel,
  refillDungeon,
  seasonEndsInMs,
  settleSeasons,
  towerMilestone,
  towerStage,
} from '../../modes/meta';
import { DIFFICULTY_ORDER } from '../../progression/PlayerProfile';
import { el } from '../dom';
import type { MenuContext } from './context';
import { recommendedPower, stageEnemies } from './stageMapScreen';
import { fmtInt } from './View';

function fmtDuration(ms: number): string {
  const totalMin = Math.ceil(ms / 60_000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function powerLine(ctx: MenuContext, rec: number): HTMLElement {
  const power = ctx.profile.power(ctx.profile.selectedHero);
  const line = el('div', `pb-power${power >= rec ? ' is-good' : ' is-low'}`);
  line.append(
    el('span', '', `Your power ${fmtInt(power)}`),
    el('span', 'pb-dim', ` / recommended ${fmtInt(rec)}`),
  );
  return line;
}

// ------------------------------------------------------------------ Dungeon

export function renderDungeon(ctx: MenuContext): void {
  const p = ctx.profile;
  const now = Date.now();
  refillDungeon(p.data.dungeon, now);
  p.commit();
  const d = p.data.dungeon;
  const v = ctx.shell.begin('Dungeon', () => ctx.nav.hub(), 'dungeon');
  let difficulty = p.data.difficulty;
  if (!p.difficultyUnlocked(1, difficulty)) difficulty = 'normal';
  const level =
    highestClearedLevel((id) => p.stageClearedAnyDifficulty(id)) + DUNGEON_CONFIG.levelBonus;

  const wrap = el('div', 'mode-page');
  const left = el('div', 'mode-col');
  const right = el('div', 'mode-col');
  const refill = nextRefillInMs(d, now);
  left.append(
    el('div', 'mode-big', `Entries ${d.entries} / ${DUNGEON_CONFIG.maxEntries}`),
    el(
      'div',
      'pb-dim',
      d.entries >= DUNGEON_CONFIG.maxEntries
        ? 'Entries are full.'
        : `Next entry in ${fmtDuration(refill)} (one every ${DUNGEON_CONFIG.refillHours} h)`,
    ),
    el('div', 'pb-label', 'The delve'),
    el(
      'div',
      'pb-text',
      `${DUNGEON_CONFIG.roomsPerRun} chambers in random order. HP carries over between rooms. The last chamber holds an elite. Leave anytime with the gold and XP earned so far; gear waits at the end.`,
    ),
    el('div', 'pb-label', 'Record'),
    el(
      'div',
      'pb-text',
      `Runs ${d.runs} · Best ${d.bestRooms}/${DUNGEON_CONFIG.roomsPerRun} rooms`,
    ),
  );
  const seg = el('div', 'segmented');
  for (const diff of DIFFICULTY_ORDER) {
    const open = p.difficultyUnlocked(1, diff);
    seg.append(
      v.button(
        DIFFICULTIES[diff].label,
        `segment${diff === difficulty ? ' is-selected' : ''}`,
        () => {
          ctx.uiTap();
          p.data.difficulty = diff;
          p.commit();
          renderDungeon(ctx);
        },
        { disabled: !open, testid: `dungeon-diff-${diff}` },
      ),
    );
  }
  right.append(
    seg,
    el(
      'div',
      'pb-text',
      `Enemy level ${level}–${level + DUNGEON_CONFIG.roomsPerRun - 1} · ${DIFFICULTIES[difficulty].label}`,
    ),
    powerLine(ctx, recommendedPower(level + 1, difficulty)),
    el(
      'div',
      'pb-text pb-dim',
      `Full clear: ${fmtInt(Math.round(DUNGEON_CONFIG.roomGold * DUNGEON_CONFIG.roomsPerRun * DIFFICULTIES[difficulty].rewards))} gold, ${fmtInt(Math.round(DUNGEON_CONFIG.roomXp * DUNGEON_CONFIG.roomsPerRun * DIFFICULTIES[difficulty].rewards))} XP, 3+ gear and materials.`,
    ),
    v.button(
      d.entries > 0 ? 'Enter the dungeon' : 'No entries left',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        if (!ctx.actions.startDungeon(difficulty))
          ctx.toast('No entries left — they refill over time');
      },
      { disabled: d.entries <= 0, testid: 'dungeon-start' },
    ),
  );
  wrap.append(left, right);
  v.root.append(wrap);
}

// ------------------------------------------------------------------ Tower

export function renderTower(ctx: MenuContext): void {
  const p = ctx.profile;
  const t = p.data.tower;
  const v = ctx.shell.begin('Demon Tower', () => ctx.nav.hub(), 'tower');
  const next = t.bestFloor + 1;
  const stage = towerStage(next);
  const wrap = el('div', 'mode-page');
  const left = el('div', 'mode-col');
  const right = el('div', 'mode-col');
  left.append(
    el('div', 'mode-big', `Best floor ${t.bestFloor}`),
    el(
      'div',
      'pb-text',
      `Endless floors. Every ${TOWER_CONFIG.bossEvery}th floor a tyrant waits. No revives in the tower.`,
    ),
    el('div', 'pb-label', 'Milestones'),
  );
  const ms = el('div', 'milestones');
  const firstMs = Math.max(
    TOWER_CONFIG.milestoneEvery,
    Math.ceil((t.bestFloor - 4) / TOWER_CONFIG.milestoneEvery) * TOWER_CONFIG.milestoneEvery,
  );
  for (
    let f = firstMs;
    f < firstMs + TOWER_CONFIG.milestoneEvery * 4;
    f += TOWER_CONFIG.milestoneEvery
  ) {
    const m = towerMilestone(f);
    if (m === null) continue;
    const claimed = t.claimed.includes(f);
    ms.append(
      el(
        'div',
        `milestone${claimed ? ' is-claimed' : ''}`,
        `Floor ${f}: ${m.gems} gems, ${m.tickets} ticket${m.tickets > 1 ? 's' : ''}${claimed ? ' ✓' : ''}`,
      ),
    );
  }
  left.append(ms);
  right.append(
    el('div', 'mode-big', `Floor ${next}${isTowerBossFloor(next) ? ' — BOSS' : ''}`),
    el('div', 'pb-text', `Enemy level ${stage.level} · ${stageEnemies(stage).join(', ')}`),
    powerLine(ctx, Math.round(recommendedPower(stage.level, 'normal') * (1 + next * 0.01))),
    v.button(
      `Climb to floor ${next}`,
      'btn btn-primary',
      () => {
        ctx.uiTap();
        ctx.actions.startTower(next);
      },
      { testid: 'tower-start' },
    ),
  );
  if (t.bestFloor > 0) {
    right.append(
      v.button(`Replay floor ${t.bestFloor}`, 'btn', () => {
        ctx.uiTap();
        ctx.actions.startTower(t.bestFloor);
      }),
    );
  }
  wrap.append(left, right);
  v.root.append(wrap);
}

// ------------------------------------------------------------------ Boss Challenge

export function renderChallenge(ctx: MenuContext): void {
  const p = ctx.profile;
  const v = ctx.shell.begin('Boss Challenge', () => ctx.nav.hub(), 'challenge');
  const list = el('div', 'challenge-list');
  list.dataset['allowScroll'] = '';
  for (const entry of CHALLENGE_CONFIG.bosses) {
    const def = BOSSES[entry.boss];
    const open = p.stageClearedAnyDifficulty(entry.stage);
    const best = p.data.challenge[entry.boss] ?? 0;
    const card = el('div', `challenge-card${open ? '' : ' is-locked'}`);
    const info = el('div', 'challenge-info');
    info.append(
      el('div', 'challenge-name', def.name),
      el(
        'div',
        'pb-dim',
        open
          ? `${def.title} · best tier ${best}/${CHALLENGE_CONFIG.maxTier}`
          : `🔒 Defeat it in Adventure (${entry.stage.replace('c', '').replace('s', '-')})`,
      ),
    );
    card.append(info);
    if (open) {
      const tier = Math.min(CHALLENGE_CONFIG.maxTier, best + 1);
      const stage = challengeStage(entry, tier);
      const mult = challengeMult(tier);
      const rec = Math.round(
        recommendedPower(stage.level, 'normal') * Math.sqrt(mult.hp * mult.atk),
      );
      const power = p.power(p.selectedHero);
      card.append(
        el(
          'div',
          `challenge-rec${power >= rec ? ' is-good' : ' is-low'}`,
          `Tier ${tier} · rec. ${fmtInt(rec)}`,
        ),
        v.button(
          `Fight tier ${tier}`,
          'btn btn-primary btn-small',
          () => {
            ctx.uiTap();
            ctx.actions.startChallenge(entry, tier);
          },
          { testid: `challenge-${entry.boss}` },
        ),
      );
    }
    list.append(card);
  }
  v.root.append(list);
}

// ------------------------------------------------------------------ Hunts

function untilMidnight(nowMs: number): string {
  const d = new Date(nowMs);
  return fmtDuration(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - nowMs);
}

export function renderHunts(ctx: MenuContext): void {
  const p = ctx.profile;
  const now = Date.now();
  const board = p.huntBoard(now);
  const h = p.data.hunts;
  const v = ctx.shell.begin('Hunts', () => ctx.nav.hub(), 'hunts');
  const list = el('div', 'challenge-list');
  list.dataset['allowScroll'] = '';
  const rank = huntRank(h.completed);
  const prog = huntRankProgress(h.completed);
  const head = el('div', 'hunt-head');
  const bar = el('div', 'goal-bar');
  const fill = el('div', 'goal-fill');
  fill.style.width = `${Math.round((prog.done / prog.need) * 100)}%`;
  bar.append(fill);
  const rankBox = el('div', 'hunt-rank');
  rankBox.append(
    el('div', 'challenge-name', `Hunt rank ${rank}${rank >= HUNT_CONFIG.maxRank ? ' (max)' : ''}`),
    bar,
  );
  head.append(
    rankBox,
    el(
      'div',
      'pb-dim',
      `Each rank makes the marks stronger and richer. New marks in ${untilMidnight(now)}.`,
    ),
  );
  list.append(head);
  if (board.length === 0)
    list.append(el('div', 'pb-text', 'Defeat a boss in Adventure to put it on the hunt board.'));
  const power = p.power(p.selectedHero);
  for (const hunt of board) {
    const def = BOSSES[hunt.entry.boss];
    const won = h.won.includes(hunt.id);
    const m = huntMult(hunt);
    const r = huntRewards(hunt, won);
    const rec = Math.round(
      recommendedPower(hunt.level, 'normal') * Math.sqrt(m.hp * m.atk * m.speed),
    );
    const card = el('div', `challenge-card hunt-card${won ? ' is-won' : ''}`);
    const info = el('div', 'challenge-info');
    const omens = el('div', 'omen-row');
    for (const id of hunt.omens) {
      const o = HUNT_OMENS[id];
      const chip = el('span', `omen-chip omen-${id}`, o.name);
      chip.title = o.text;
      omens.append(chip, el('span', 'omen-text', o.text));
    }
    info.append(
      el('div', 'challenge-name', `${won ? '✓ ' : ''}${def.name}`),
      el('div', 'pb-dim', `${def.title} · Lv ${hunt.level}`),
      omens,
      el(
        'div',
        'pb-dim',
        `${fmtInt(r.gold)} gold · ${fmtInt(r.xp)} XP${r.gems > 0 ? ` · ${r.gems} gems` : ''} · Hard-quality loot`,
      ),
    );
    card.append(
      info,
      el('div', `challenge-rec${power >= rec ? ' is-good' : ' is-low'}`, `rec. ${fmtInt(rec)}`),
      v.button(
        won ? 'Hunt again' : 'Hunt',
        `btn btn-small${won ? '' : ' btn-primary'}`,
        () => {
          ctx.uiTap();
          ctx.actions.startHunt(hunt);
        },
        { testid: `hunt-${hunt.slot}` },
      ),
    );
    list.append(card);
  }
  v.root.append(list);
}

// ------------------------------------------------------------------ Arena

export function renderArena(ctx: MenuContext): void {
  const p = ctx.profile;
  const a = p.data.arena;
  const now = Date.now();
  const seasons = settleSeasons(a, now);
  for (const r of seasons) {
    p.wallet.add('gems', r.gems);
    p.wallet.add('tickets', r.tickets);
    ctx.toast(`Season ${r.season} ended: ${r.label} rank — +${r.gems} gems, +${r.tickets} tickets`);
  }
  if (seasons.length > 0) p.commit();
  const v = ctx.shell.begin('Arena', () => ctx.nav.hub(), 'arena');
  const wrap = el('div', 'mode-page');
  const left = el('div', 'mode-col');
  const right = el('div', 'mode-col');
  left.append(
    el('div', 'mode-big', `Rating ${a.rating} · ${rankLabel(a.rating)}`),
    el(
      'div',
      'pb-dim',
      `Season ${a.season} ends in ${fmtDuration(seasonEndsInMs(a, now))} · W ${a.wins} / L ${a.losses}${a.streak > 1 ? ` · ${a.streak} win streak` : ''}`,
    ),
    el('div', 'pb-label', 'Leaderboard'),
  );
  const board = el('div', 'leaderboard');
  board.dataset['allowScroll'] = '';
  const entries = leaderboard(a.season, a.rating);
  entries.forEach((e, i) => {
    if (i >= 8 && !e.you) return;
    const row = el('div', `lb-row${e.you ? ' is-you' : ''}`);
    row.append(
      el('span', 'lb-rank', `${i + 1}`),
      el('span', 'lb-name', e.name),
      el('span', 'lb-rating', String(e.rating)),
    );
    board.append(row);
  });
  left.append(board);

  const opponents = generateOpponents(a.opponentSeed, a.rating, p.power(p.selectedHero));
  right.append(el('div', 'pb-label', 'Challengers'));
  opponents.forEach((o, i) => {
    const card = el('div', 'opp-card');
    const info = el('div', 'challenge-info');
    info.append(
      el('div', 'challenge-name', o.name),
      el(
        'div',
        'pb-dim',
        `${HEROES[o.heroId].name} · Lv ${o.level} · Power ${fmtInt(o.power)} · ${o.rating}`,
      ),
    );
    card.append(
      info,
      v.button(
        'Duel',
        'btn btn-primary btn-small',
        () => {
          ctx.uiTap();
          ctx.actions.startArena(o);
        },
        { testid: `arena-opp-${i}` },
      ),
    );
    right.append(card);
  });
  right.append(
    v.button('New challengers', 'btn btn-small', () => {
      ctx.uiTap();
      a.opponentSeed = (a.opponentSeed * 48271 + 3) % 2147483647 || 1;
      p.commit();
      renderArena(ctx);
    }),
    el(
      'div',
      'pb-dim',
      `Win: +${ARENA_CONFIG.winGold} gold, +${ARENA_CONFIG.winGems} gems. Season rewards by final rank.`,
    ),
  );
  wrap.append(left, right);
  v.root.append(wrap);
}

export const modeScreens: Readonly<
  Record<Exclude<ModeId, 'adventure'>, (ctx: MenuContext) => void>
> = {
  dungeon: renderDungeon,
  tower: renderTower,
  challenge: renderChallenge,
  hunts: renderHunts,
  arena: renderArena,
};
