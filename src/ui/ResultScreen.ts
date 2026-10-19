import { el, onTap } from './dom';

export interface DefeatInfo {
  canRevive: boolean;
  reviveCost: number;
  gems: number;
  revivesLeft: number;
  /** Some modes (arena, tower) don't allow revives. */
  allowRevive: boolean;
}

/** Defeat screen: revive (gems), retry from the start, or give up. */
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

  showDefeat(
    info: DefeatInfo,
    onRevive: () => void,
    onRetry: () => void,
    onGiveUp: () => void,
  ): void {
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
    const row = el('div', 'button-row');
    row.append(
      this.button('Retry', 'btn', 'result-retry', onRetry),
      this.button('Give up', 'btn', 'result-giveup', onGiveUp),
    );
    this.panel.append(
      el('h2', 'panel-title result-title result-defeat', 'You have fallen'),
      el('p', 'panel-body', 'The shadow is patient. Rise again, or begin anew.'),
    );
    if (info.allowRevive) this.panel.append(revive);
    this.panel.append(row);
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
