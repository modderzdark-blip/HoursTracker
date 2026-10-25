import { STATUS_EFFECTS, STATUS_IDS, type StatusId } from '../data/statusEffects';
import { COMBO_RANKS, comboRankIndex } from '../progression/feel';
import { el, onTap } from './dom';

export interface PlayerHudState {
  hp: number;
  maxHp: number;
  statusStacks: Readonly<Record<StatusId, number>>;
  counterReady: boolean;
}

export interface BossHudState {
  name: string;
  title: string;
  hpFrac: number;
  breakFrac: number;
  broken: boolean;
  phaseMarks: readonly number[];
  enrageInSec: number;
  enraged: boolean;
}

/**
 * Battle HUD: player HP (with delayed "ghost" damage bar) and status chips, wave/countdown line,
 * boss bar (name, phase markers, break bar, enrage timer), combo counter and centre banners.
 * Values are cached; the DOM is only touched when something visibly changes.
 */
export class BattleHud {
  private readonly heroName: HTMLElement;
  readonly root: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly hpGhost: HTMLElement;
  private readonly hpText: HTMLElement;
  private readonly statusRow: HTMLElement;
  private readonly statusChips = new Map<StatusId, HTMLElement>();
  private readonly counterTag: HTMLElement;
  private readonly waveLine: HTMLElement;
  private readonly startBtn: HTMLElement;
  private readonly boss: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossGhost: HTMLElement;
  private readonly bossBreak: HTMLElement;
  private readonly bossTimer: HTMLElement;
  private readonly bossMarks: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly combo: HTMLElement;
  private readonly comboNum: HTMLElement;
  private readonly comboWord: HTMLElement;
  private comboRank = -1;
  private readonly disposeStart: () => void;
  private hpGhostFrac = 1;
  private bossGhostFrac = 1;
  private cache = {
    hp: -1,
    hpGhost: -1,
    boss: -1,
    bossGhost: -1,
    brk: -1,
    timer: '',
    wave: '',
    combo: -1,
    counter: false,
  };
  private bannerTimer = 0;
  private comboCount = 0;
  private comboTimer = 0;

  constructor(container: HTMLElement, onStartNow: () => void) {
    this.root = el('div', 'bhud');
    // Player panel.
    const panel = el('div', 'bhud-player');
    this.heroName = el('div', 'bhud-name', '');
    panel.append(this.heroName);
    const hpBar = el('div', 'bar bar-hp');
    this.hpGhost = el('div', 'bar-ghost');
    this.hpFill = el('div', 'bar-fill');
    this.hpText = el('div', 'bar-text', '');
    hpBar.append(this.hpGhost, this.hpFill, this.hpText);
    this.statusRow = el('div', 'bhud-status');
    for (const id of STATUS_IDS) {
      const chip = el('div', `status-chip status-${id}`, id.toUpperCase());
      chip.style.setProperty(
        '--chip',
        `#${STATUS_EFFECTS[id].color.toString(16).padStart(6, '0')}`,
      );
      chip.classList.add('is-hidden');
      this.statusRow.append(chip);
      this.statusChips.set(id, chip);
    }
    this.counterTag = el('div', 'bhud-counter is-hidden', 'COUNTER READY');
    panel.append(hpBar, this.statusRow, this.counterTag);

    // Wave line + start-now button.
    const top = el('div', 'bhud-top');
    this.waveLine = el('div', 'bhud-wave', '');
    this.startBtn = el('div', 'btn bhud-start is-hidden', 'Start now');
    this.startBtn.setAttribute('role', 'button');
    this.startBtn.dataset['testid'] = 'start-now';
    this.disposeStart = onTap(this.startBtn, onStartNow);
    top.append(this.waveLine, this.startBtn);

    // Boss bar.
    this.boss = el('div', 'bhud-boss is-hidden');
    this.boss.dataset['testid'] = 'boss-bar';
    this.bossName = el('div', 'boss-name', '');
    const bossBar = el('div', 'bar bar-boss');
    this.bossGhost = el('div', 'bar-ghost');
    this.bossFill = el('div', 'bar-fill');
    this.bossMarks = el('div', 'boss-marks');
    bossBar.append(this.bossGhost, this.bossFill, this.bossMarks);
    const breakBar = el('div', 'bar bar-break');
    this.bossBreak = el('div', 'bar-fill');
    breakBar.append(this.bossBreak);
    this.bossTimer = el('div', 'boss-timer', '');
    this.boss.append(this.bossName, bossBar, breakBar, this.bossTimer);

    this.banner = el('div', 'bhud-banner is-hidden', '');
    this.combo = el('div', 'bhud-combo is-hidden');
    this.comboNum = el('div', 'bhud-combo-num', '');
    this.comboWord = el('div', 'bhud-combo-word', '');
    this.combo.append(this.comboNum, this.comboWord);
    this.root.append(panel, top, this.boss, this.banner, this.combo);
    container.append(this.root);
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('is-hidden', !v);
  }

  updatePlayer(s: PlayerHudState, dtSec: number): void {
    const frac = s.maxHp > 0 ? s.hp / s.maxHp : 0;
    this.hpGhostFrac =
      frac >= this.hpGhostFrac ? frac : Math.max(frac, this.hpGhostFrac - dtSec * 0.5);
    const f = Math.round(frac * 1000) / 1000;
    if (f !== this.cache.hp) {
      this.cache.hp = f;
      this.hpFill.style.transform = `scaleX(${f})`;
      this.hpText.textContent = `${Math.ceil(s.hp)} / ${s.maxHp}`;
      this.hpFill.parentElement?.classList.toggle('is-low', f < 0.3);
    }
    const g = Math.round(this.hpGhostFrac * 1000) / 1000;
    if (g !== this.cache.hpGhost) {
      this.cache.hpGhost = g;
      this.hpGhost.style.transform = `scaleX(${g})`;
    }
    for (const id of STATUS_IDS) {
      const chip = this.statusChips.get(id);
      const n = s.statusStacks[id];
      if (chip === undefined) continue;
      const hidden = n <= 0;
      if (chip.classList.contains('is-hidden') !== hidden)
        chip.classList.toggle('is-hidden', hidden);
      const label = n > 1 ? `${id.toUpperCase()} ×${n}` : id.toUpperCase();
      if (!hidden && chip.textContent !== label) chip.textContent = label;
    }
    if (s.counterReady !== this.cache.counter) {
      this.cache.counter = s.counterReady;
      this.counterTag.classList.toggle('is-hidden', !s.counterReady);
    }
  }

  setWaveLine(text: string, showStart: boolean): void {
    if (text !== this.cache.wave) {
      this.cache.wave = text;
      this.waveLine.textContent = text;
    }
    if (this.startBtn.classList.contains('is-hidden') === showStart)
      this.startBtn.classList.toggle('is-hidden', !showStart);
  }

  showBoss(s: BossHudState): void {
    this.boss.classList.remove('is-hidden');
    // Name and title wrap onto two lines on narrow screens rather than being cut off.
    this.bossName.replaceChildren(
      el('span', 'boss-name-main', s.name),
      document.createTextNode(' '),
      el('span', 'boss-name-title', `— ${s.title}`),
    );
    this.bossMarks.replaceChildren(
      ...s.phaseMarks.map((m) => {
        const tick = el('div', 'boss-mark');
        tick.style.left = `${m * 100}%`;
        return tick;
      }),
    );
    this.bossGhostFrac = 1;
    this.cache.boss = -1;
  }

  hideBoss(): void {
    this.boss.classList.add('is-hidden');
  }

  updateBoss(s: BossHudState, dtSec: number): void {
    const f = Math.round(s.hpFrac * 1000) / 1000;
    this.bossGhostFrac =
      f >= this.bossGhostFrac ? f : Math.max(f, this.bossGhostFrac - dtSec * 0.35);
    if (f !== this.cache.boss) {
      this.cache.boss = f;
      this.bossFill.style.transform = `scaleX(${f})`;
    }
    const g = Math.round(this.bossGhostFrac * 1000) / 1000;
    if (g !== this.cache.bossGhost) {
      this.cache.bossGhost = g;
      this.bossGhost.style.transform = `scaleX(${g})`;
    }
    // Duels: no break bar (breakFrac < 0) and no enrage timer (enrageInSec < 0).
    this.boss.classList.toggle('no-break', s.breakFrac < 0);
    const b = Math.round(Math.max(0, s.breakFrac) * 100) / 100;
    if (b !== this.cache.brk) {
      this.cache.brk = b;
      this.bossBreak.style.transform = `scaleX(${b})`;
    }
    this.boss.classList.toggle('is-broken', s.broken);
    const timer = s.enraged
      ? 'ENRAGED'
      : s.enrageInSec < 0
        ? ''
        : `Enrage ${Math.floor(s.enrageInSec / 60)}:${String(Math.floor(s.enrageInSec % 60)).padStart(2, '0')}`;
    if (timer !== this.cache.timer) {
      this.cache.timer = timer;
      this.bossTimer.textContent = timer;
      this.bossTimer.classList.toggle('is-enraged', s.enraged);
    }
  }

  showBanner(
    text: string,
    kind: 'wave' | 'perfect' | 'break' | 'phase' | 'warn' = 'wave',
    ms = 1400,
  ): void {
    this.banner.textContent = text;
    this.banner.className = `bhud-banner banner-${kind}`;
    // Restart the CSS animation.
    void this.banner.offsetWidth;
    this.banner.classList.add('is-showing');
    this.bannerTimer = ms / 1000;
  }

  /** Counts a landed hit. Returns the combo rank just reached (index into COMBO_RANKS), or -1. */
  registerHit(): number {
    this.comboCount++;
    this.comboTimer = 2;
    const rank = comboRankIndex(this.comboCount);
    if (rank <= this.comboRank) return -1;
    this.comboRank = rank;
    this.comboWord.textContent = COMBO_RANKS[rank]?.word.toUpperCase() ?? '';
    this.combo.dataset['rank'] = String(rank);
    this.combo.classList.remove('is-rankup');
    void this.combo.offsetWidth;
    this.combo.classList.add('is-rankup');
    return rank;
  }

  tick(dtSec: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dtSec;
      if (this.bannerTimer <= 0) this.banner.classList.add('is-hidden');
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dtSec;
      if (this.comboTimer <= 0) {
        this.comboCount = 0;
        this.comboRank = -1;
        this.comboWord.textContent = '';
        delete this.combo.dataset['rank'];
      }
    }
    const c = this.comboCount >= 3 ? this.comboCount : 0;
    if (c !== this.cache.combo) {
      this.cache.combo = c;
      this.combo.classList.toggle('is-hidden', c === 0);
      if (c > 0) {
        this.comboNum.textContent = `${c} HITS`;
        this.combo.classList.remove('is-bump');
        void this.combo.offsetWidth;
        this.combo.classList.add('is-bump');
      }
    }
  }

  setHeroName(name: string): void {
    this.heroName.textContent = name.toUpperCase();
  }

  reset(): void {
    this.comboCount = 0;
    this.comboTimer = 0;
    this.comboRank = -1;
    this.comboWord.textContent = '';
    delete this.combo.dataset['rank'];
    this.hpGhostFrac = 1;
    this.hideBoss();
    this.banner.classList.add('is-hidden');
    this.cache = {
      hp: -1,
      hpGhost: -1,
      boss: -1,
      bossGhost: -1,
      brk: -1,
      timer: '',
      wave: '',
      combo: -1,
      counter: false,
    };
  }

  dispose(): void {
    this.disposeStart();
    this.root.remove();
  }
}
