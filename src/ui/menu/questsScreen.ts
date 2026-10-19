import { ACHIEVEMENTS, DAILY_CONFIG, LOGIN_REWARDS } from '../../data/goals';
import {
  achievementTarget,
  achievementText,
  bundleText,
  localDay,
  loginSlot,
  questDef,
} from '../../progression/goals';
import { el } from '../dom';
import type { MenuContext } from './context';
import { fmtInt, type View } from './View';

function bar(frac: number): HTMLElement {
  const b = el('div', 'goal-bar');
  const f = el('div', 'goal-fill');
  f.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  b.append(f);
  return b;
}

function untilMidnight(nowMs: number): string {
  const d = new Date(nowMs);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  const min = Math.max(1, Math.ceil((next - nowMs) / 60_000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h}h ${min % 60}m` : `${min}m`;
}

/** Login calendar strip: 7 days, today's reward highlighted. */
function calendar(ctx: MenuContext, v: View, onClaim: () => void): HTMLElement {
  const p = ctx.profile;
  const ready = p.loginReady();
  const slot = loginSlot(p.data.daily);
  const row = el('div', 'login-row');
  LOGIN_REWARDS.forEach((r, i) => {
    const done = i < slot;
    const today = ready && i === slot;
    const cell = el(
      'div',
      `login-cell${today ? ' is-today' : ''}${done ? ' is-done' : ''}${i === 6 ? ' is-big' : ''}`,
    );
    cell.append(el('div', 'login-day', `Day ${i + 1}`), el('div', 'login-reward', bundleText(r)));
    if (done) cell.append(el('div', 'login-check', '✓'));
    if (today) {
      v.tap(cell, () => {
        ctx.uiTap();
        onClaim();
      });
      cell.dataset['testid'] = 'login-claim';
    }
    row.append(cell);
  });
  return row;
}

function claimLogin(ctx: MenuContext): void {
  const r = ctx.profile.claimLogin();
  if (r !== null) ctx.toast(`Daily gift: ${bundleText(r)}`);
  ctx.shell.refreshCurrencies();
}

/** Journal: daily quests, login calendar and achievements. */
export function renderQuests(ctx: MenuContext): void {
  const p = ctx.profile;
  const now = Date.now();
  p.refreshDaily(now);
  const v = ctx.shell.begin('Journal', () => ctx.nav.hub(), 'quests');
  const rerender = (): void => renderQuests(ctx);
  const wrap = el('div', 'mode-page journal');
  const left = el('div', 'mode-col');
  const right = el('div', 'mode-col');

  left.append(
    el('div', 'mode-big', 'Daily gifts'),
    calendar(ctx, v, () => {
      claimLogin(ctx);
      rerender();
    }),
    el('div', 'pb-label', `Daily quests · new in ${untilMidnight(now)}`),
  );
  const d = p.data.daily;
  for (const q of d.quests) {
    const def = questDef(q.id);
    if (def === undefined) continue;
    const row = el('div', `goal-row${q.claimed ? ' is-claimed' : ''}`);
    const body = el('div', 'goal-body');
    body.append(
      el('div', 'goal-name', def.text),
      bar(q.progress / def.target),
      el(
        'div',
        'goal-meta',
        `${fmtInt(q.progress)} / ${fmtInt(def.target)} · ${bundleText(def.reward)}`,
      ),
    );
    row.append(body);
    const done = q.progress >= def.target;
    row.append(
      v.button(
        q.claimed ? 'Done' : done ? 'Claim' : '…',
        `btn btn-small${done && !q.claimed ? ' btn-primary' : ''}`,
        () => {
          ctx.uiTap();
          if (p.claimQuest(q.id)) ctx.toast(`Quest complete: ${bundleText(def.reward)}`);
          ctx.shell.refreshCurrencies();
          rerender();
        },
        { disabled: q.claimed || !done, testid: `quest-${q.id}` },
      ),
    );
    left.append(row);
  }
  const bonusRow = el('div', `goal-row goal-bonus${d.bonusClaimed ? ' is-claimed' : ''}`);
  const allClaimed = d.quests.length > 0 && d.quests.every((q) => q.claimed);
  bonusRow.append(
    el(
      'div',
      'goal-body',
      `All quests done: ${bundleText(DAILY_CONFIG.allDoneBonus)}${d.bonusClaimed ? ' ✓' : ''}`,
    ),
    v.button(
      d.bonusClaimed ? 'Done' : 'Claim',
      `btn btn-small${p.dailyBonusReady ? ' btn-primary' : ''}`,
      () => {
        ctx.uiTap();
        if (p.claimDailyBonus()) ctx.toast(`Daily chest: ${bundleText(DAILY_CONFIG.allDoneBonus)}`);
        ctx.shell.refreshCurrencies();
        rerender();
      },
      { disabled: !allClaimed || d.bonusClaimed, testid: 'quest-bonus' },
    ),
  );
  left.append(bonusRow);

  right.append(el('div', 'mode-big', 'Achievements'));
  const list = el('div', 'goal-list');
  const rows = ACHIEVEMENTS.map((a) => {
    const tier = p.data.achievements[a.id] ?? 0;
    const value = p.achievementValue(a.stat);
    const claimable = p.achievementClaimable(a.id);
    const maxed = tier >= a.tiers.length;
    return { a, tier, value, claimable, maxed };
  });
  // Claimable first, then unfinished, then completed.
  rows.sort(
    (x, y) =>
      Number(y.claimable > 0) - Number(x.claimable > 0) || Number(x.maxed) - Number(y.maxed),
  );
  for (const { a, tier, value, claimable, maxed } of rows) {
    const target = achievementTarget(a, Math.min(tier, a.tiers.length - 1)) ?? 1;
    const row = el('div', `goal-row${maxed ? ' is-claimed' : ''}`);
    const body = el('div', 'goal-body');
    const stars = '★'.repeat(tier) + '☆'.repeat(a.tiers.length - tier);
    body.append(
      el('div', 'goal-name', `${a.name} ${stars}`),
      el('div', 'goal-meta', maxed ? 'Mastered' : achievementText(a, tier)),
      bar(maxed ? 1 : value / target),
      el(
        'div',
        'goal-meta',
        maxed
          ? `${fmtInt(value)}`
          : `${fmtInt(Math.min(value, target))} / ${fmtInt(target)} · ${a.gems[tier] ?? 0} gems`,
      ),
    );
    row.append(
      body,
      v.button(
        maxed ? 'Done' : claimable > 0 ? 'Claim' : '…',
        `btn btn-small${claimable > 0 ? ' btn-primary' : ''}`,
        () => {
          ctx.uiTap();
          const gems = p.claimAchievement(a.id);
          if (gems > 0) ctx.toast(`${a.name}: +${gems} gems`);
          ctx.shell.refreshCurrencies();
          rerender();
        },
        { disabled: claimable <= 0, testid: `ach-${a.id}` },
      ),
    );
    list.append(row);
  }
  right.append(list);
  wrap.append(left, right);
  v.root.append(wrap);
}

/** Pops the login calendar over the hub once per day (until claimed). */
export function maybeShowLoginGift(ctx: MenuContext, nowMs = Date.now()): void {
  const p = ctx.profile;
  if (!p.loginReady(nowMs) || ctx.shell.modalOpen) return;
  const m = ctx.shell.openModal('login-modal');
  const day = localDay(nowMs);
  m.root.append(
    el('div', 'pb-title', 'Daily gift'),
    el('div', 'pb-dim', 'A gift waits each day you return. Missing a day never resets it.'),
    calendar(ctx, m, () => {
      claimLogin(ctx);
      ctx.shell.closeModal();
      ctx.nav.hub();
    }),
  );
  const row = el('div', 'button-row');
  row.append(
    m.button(
      'Claim',
      'btn btn-primary',
      () => {
        ctx.uiTap();
        if (p.loginReady(nowMs) && localDay(Date.now()) === day) claimLogin(ctx);
        ctx.shell.closeModal();
        ctx.nav.hub();
      },
      { testid: 'login-modal-claim' },
    ),
  );
  m.root.append(row);
}
