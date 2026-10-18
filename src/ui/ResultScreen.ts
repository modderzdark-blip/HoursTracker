import { el, onTap } from './dom';

export interface VictoryInfo {
  stars: number;
  timeSec: number;
  damageTaken: number;
  perfectDodges: number;
  souls: number;
  gold: number;
  gems: number;
  newBest: boolean;
}

export interface DefeatInfo {
  canRevive: boolean;
  reviveCost: number;
  gems: number;
  revivesLeft: number;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Victory (stars + rewards) and defeat (revive / retry) screens. */
export class ResultScreen {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private disposers: (() => void)[] = [];

  constructor(container: HTMLElement) {
    this.root = el('div', 'screen result-screen is-hidden');
    this.root.dataset['testid'] = 'result-screen';
    this.panel = el('div', 'panel result-panel');
    this.root.append(this.panel);
    container.append(this.root);
  }

  private reset(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.panel.replaceChildren();
  }

  private button(label: string, cls: string, testid: string, fn: () => void): HTMLElement {
    const b = el('div', cls, label);
    b.setAttribute('role', 'button');
    b.dataset['testid'] = testid;
    this.disposers.push(onTap(b, fn));
    return b;
  }

  showVictory(info: VictoryInfo, onAgain: () => void): void {
    this.reset();
    this.root.classList.remove('is-hidden');
    this.root.dataset['result'] = 'victory';
    const stars = el('div', 'result-stars');
    for (let i = 0; i < 3; i++) {
      const s = el('span', i < info.stars ? 'star is-on' : 'star', '★');
      s.style.animationDelay = `${0.25 + i * 0.25}s`;
      stars.append(s);
    }
    const rows = el('div', 'result-rows');
    const row = (k: string, v: string): void => {
      const r = el('div', 'result-row');
      r.append(el('span', '', k), el('span', 'result-val', v));
      rows.append(r);
    };
    row('Time', fmtTime(info.timeSec));
    row('Damage taken', String(Math.round(info.damageTaken)));
    row('Perfect dodges', String(info.perfectDodges));
    const loot = el('div', 'result-loot');
    loot.append(
      el('div', 'loot loot-souls', `+${info.souls} souls`),
      el('div', 'loot loot-gold', `+${info.gold} gold`),
      el('div', 'loot loot-gems', `+${info.gems} gems`),
    );
    this.panel.append(
      el('h2', 'panel-title result-title', 'Victory'),
      stars,
      info.newBest ? el('p', 'panel-note', 'New best!') : el('p', 'panel-note', ''),
      rows,
      loot,
      this.button('Play again', 'btn btn-primary', 'result-again', onAgain),
    );
  }

  showDefeat(info: DefeatInfo, onRevive: () => void, onRetry: () => void): void {
    this.reset();
    this.root.classList.remove('is-hidden');
    this.root.dataset['result'] = 'defeat';
    const revive = this.button(
      info.canRevive
        ? `Revive (${info.reviveCost} gems · you have ${info.gems})`
        : info.revivesLeft <= 0
          ? 'Revive used'
          : `Revive (${info.reviveCost} gems — not enough)`,
      `btn btn-primary${info.canRevive ? '' : ' is-disabled'}`,
      'result-revive',
      () => {
        if (info.canRevive) onRevive();
      },
    );
    this.panel.append(
      el('h2', 'panel-title result-title result-defeat', 'You have fallen'),
      el('p', 'panel-body', 'The shadow is patient. Rise again, or begin anew.'),
      revive,
      this.button('Retry from the start', 'btn', 'result-retry', onRetry),
    );
  }

  hide(): void {
    this.root.classList.add('is-hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  dispose(): void {
    this.reset();
    this.root.remove();
  }
}
