import { el } from './dom';

export interface BossCard {
  readonly name: string;
  readonly title: string;
  readonly line: string;
}

export interface ChapterCard {
  readonly numeral: string;
  readonly name: string;
  readonly subtitle: string;
  readonly lore: string;
  /** First visit: the lore line stays a little longer. */
  readonly long: boolean;
}

/**
 * Cinematic and feedback overlays of a battle, all pre-built and click-through (they never
 * block a touch): letterbox bars with the boss name card, the chapter intro card, kill
 * callouts, the low-HP heartbeat vignette, the ultimate burst, phase and VICTORY titles.
 * Each show() only swaps text and restarts a CSS animation (transform / opacity).
 */
export class BattleCallouts {
  readonly root: HTMLElement;
  private readonly bars: HTMLElement;
  private readonly bossCard: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly bossTitle: HTMLElement;
  private readonly bossLine: HTMLElement;
  private readonly chapter: HTMLElement;
  private readonly chNum: HTMLElement;
  private readonly chName: HTMLElement;
  private readonly chSub: HTMLElement;
  private readonly chLore: HTMLElement;
  private readonly kill: HTMLElement;
  private readonly killWord: HTMLElement;
  private readonly lowHp: HTMLElement;
  private readonly burst: HTMLElement;
  private readonly title: HTMLElement;
  private readonly titleMain: HTMLElement;
  private readonly titleSub: HTMLElement;
  private lowOn = false;
  private beatMs = 0;
  private chapterTimer = 0;
  private killTimer = 0;
  private titleTimer = 0;
  private readonly onAnyTouch = (): void => this.hideChapter();

  constructor(container: HTMLElement) {
    this.root = el('div', 'bfx');
    this.lowHp = el('div', 'bfx-lowhp');
    this.burst = el('div', 'bfx-burst');

    this.bars = el('div', 'bfx-bars');
    this.bars.append(el('div', 'bfx-bar bfx-bar-top'), el('div', 'bfx-bar bfx-bar-bottom'));
    this.bars.append(el('div', 'bfx-skip', 'Tap to skip'));

    this.bossCard = el('div', 'bfx-boss');
    this.bossTitle = el('div', 'bfx-boss-title');
    this.bossName = el('div', 'bfx-boss-name');
    const rule = el('div', 'bfx-boss-rule');
    this.bossLine = el('div', 'bfx-boss-line');
    this.bossCard.append(this.bossTitle, this.bossName, rule, this.bossLine);

    this.chapter = el('div', 'bfx-chapter');
    this.chNum = el('div', 'bfx-ch-num');
    this.chName = el('div', 'bfx-ch-name');
    this.chSub = el('div', 'bfx-ch-sub');
    this.chLore = el('div', 'bfx-ch-lore');
    this.chapter.append(this.chNum, this.chName, el('div', 'bfx-ch-rule'), this.chSub, this.chLore);

    this.kill = el('div', 'bfx-kill');
    this.killWord = el('div', 'bfx-kill-word');
    this.kill.append(this.killWord);

    this.title = el('div', 'bfx-title');
    this.titleMain = el('div', 'bfx-title-main');
    this.titleSub = el('div', 'bfx-title-sub');
    this.title.append(this.titleMain, this.titleSub);

    this.root.append(
      this.lowHp,
      this.burst,
      this.bars,
      this.bossCard,
      this.chapter,
      this.kill,
      this.title,
    );
    for (const n of [this.bars, this.bossCard, this.chapter, this.kill, this.title, this.burst])
      n.classList.add('is-off');
    container.append(this.root);
  }

  // ------------------------------------------------------------------ cinematic

  /** Letterbox bars + boss name card (the intro cinematic). */
  showBoss(card: BossCard, ms: number): void {
    this.bossTitle.textContent = card.title;
    this.bossName.textContent = card.name;
    this.bossLine.textContent = `“${card.line}”`;
    this.bossCard.style.setProperty('--card-ms', `${ms}ms`);
    this.restart(this.bossCard, 'is-on');
    this.letterbox(true);
  }

  hideBoss(): void {
    this.bossCard.classList.remove('is-on');
    this.bossCard.classList.add('is-off');
    this.letterbox(false);
  }

  letterbox(on: boolean): void {
    this.bars.classList.remove('is-off');
    this.bars.classList.toggle('is-on', on);
    this.root.classList.toggle('is-cinematic', on);
  }

  /** Skip hint in the bottom bar (the boss intro can be skipped; the victory shot too). */
  setSkippable(on: boolean): void {
    this.bars.classList.toggle('can-skip', on);
  }

  // ------------------------------------------------------------------ chapter card

  showChapter(c: ChapterCard): void {
    this.chNum.textContent = `Chapter ${c.numeral}`;
    this.chName.textContent = c.name;
    this.chSub.textContent = c.subtitle;
    this.chLore.textContent = c.lore;
    const ms = c.long ? 5200 : 3600;
    this.chapter.style.setProperty('--card-ms', `${ms}ms`);
    this.restart(this.chapter, 'is-on');
    window.clearTimeout(this.chapterTimer);
    this.chapterTimer = window.setTimeout(() => this.hideChapter(), ms);
    // Any touch dismisses it (it never blocks the touch itself).
    window.addEventListener('pointerdown', this.onAnyTouch, { capture: true, passive: true });
  }

  hideChapter(): void {
    window.clearTimeout(this.chapterTimer);
    window.removeEventListener('pointerdown', this.onAnyTouch, { capture: true });
    if (!this.chapter.classList.contains('is-on')) return;
    this.chapter.classList.remove('is-on');
    this.chapter.classList.add('is-fading');
    this.chapterTimer = window.setTimeout(() => {
      this.chapter.classList.remove('is-fading');
      this.chapter.classList.add('is-off');
    }, 450);
  }

  get chapterShowing(): boolean {
    return this.chapter.classList.contains('is-on');
  }

  // ------------------------------------------------------------------ callouts

  /** Multi-kill / streak callout under the combo counter. `tier` 0-3 sets its colour. */
  showKill(word: string, tier: number): void {
    this.killWord.textContent = word;
    this.kill.dataset['tier'] = String(Math.max(0, Math.min(3, tier)));
    this.restart(this.kill, 'is-on');
    window.clearTimeout(this.killTimer);
    this.killTimer = window.setTimeout(() => {
      this.kill.classList.remove('is-on');
      this.kill.classList.add('is-off');
    }, 1300);
  }

  /** Big centre title (VICTORY, phase changes, the ultimate's name). */
  showTitle(main: string, sub: string, kind: 'victory' | 'phase' | 'ult', ms: number): void {
    this.titleMain.textContent = main;
    this.titleSub.textContent = sub;
    this.titleSub.classList.toggle('is-hidden', sub.length === 0);
    this.title.dataset['kind'] = kind;
    this.title.style.setProperty('--card-ms', `${ms}ms`);
    this.restart(this.title, 'is-on');
    window.clearTimeout(this.titleTimer);
    this.titleTimer = window.setTimeout(() => {
      this.title.classList.remove('is-on');
      this.title.classList.add('is-off');
    }, ms);
  }

  /** Radial flash for the ultimate (skipped with Reduce flashes by CSS). */
  ultBurst(color: string): void {
    this.burst.style.setProperty('--burst', color);
    this.restart(this.burst, 'is-on');
  }

  /** Low-HP heartbeat vignette; `beatMs` is the heartbeat period. */
  setLowHp(on: boolean, beatMs: number): void {
    if (on !== this.lowOn) {
      this.lowOn = on;
      this.lowHp.classList.toggle('is-on', on);
    }
    if (on && beatMs !== this.beatMs) {
      this.beatMs = beatMs;
      this.lowHp.style.setProperty('--beat', `${beatMs}ms`);
    }
  }

  private restart(node: HTMLElement, cls: string): void {
    node.classList.remove(cls, 'is-off', 'is-fading');
    void node.offsetWidth;
    node.classList.add(cls);
  }

  reset(): void {
    window.clearTimeout(this.killTimer);
    window.clearTimeout(this.titleTimer);
    this.hideChapter();
    this.chapter.classList.remove('is-fading');
    for (const n of [this.bossCard, this.chapter, this.kill, this.title, this.burst]) {
      n.classList.remove('is-on');
      n.classList.add('is-off');
    }
    this.letterbox(false);
    this.setSkippable(false);
    this.setLowHp(false, 900);
  }

  dispose(): void {
    this.reset();
    window.clearTimeout(this.chapterTimer);
    this.root.remove();
  }
}
