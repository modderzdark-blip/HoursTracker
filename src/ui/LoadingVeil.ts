import { el } from './dom';

/**
 * Short loading veil shown while a battle is built: the stage name and a lore line, over a
 * dark ember backdrop. Lets the browser paint before the heavy arena build starts, then fades.
 */
export class LoadingVeil {
  readonly root: HTMLElement;
  private readonly name: HTMLElement;
  private readonly tip: HTMLElement;
  private hideTimer = 0;

  constructor(container: HTMLElement) {
    this.root = el('div', 'veil is-off');
    this.root.dataset['testid'] = 'loading-veil';
    const box = el('div', 'veil-box');
    this.name = el('div', 'veil-name');
    const spin = el('div', 'veil-spin');
    this.tip = el('div', 'veil-tip');
    box.append(spin, this.name, this.tip);
    this.root.append(box);
    container.append(this.root);
  }

  show(name: string, tip: string): void {
    window.clearTimeout(this.hideTimer);
    this.name.textContent = name;
    this.tip.textContent = tip;
    this.root.classList.remove('is-off', 'is-leaving');
  }

  hide(): void {
    if (this.root.classList.contains('is-off')) return;
    this.root.classList.add('is-leaving');
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.root.classList.add('is-off'), 380);
  }

  dispose(): void {
    window.clearTimeout(this.hideTimer);
    this.root.remove();
  }
}
