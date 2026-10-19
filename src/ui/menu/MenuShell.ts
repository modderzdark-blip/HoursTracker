import type { Currency } from '../../data/economy';
import type { Wallet } from '../../progression/wallet';
import { el, onTap } from '../dom';
import { fmtInt, View } from './View';

const CURRENCY_LABELS: readonly { c: Currency; icon: string; title: string }[] = [
  { c: 'gold', icon: '◉', title: 'Gold' },
  { c: 'gems', icon: '◆', title: 'Gems' },
  { c: 'souls', icon: '✧', title: 'Souls' },
  { c: 'materials', icon: '⚒', title: 'Upgrade materials' },
  { c: 'tickets', icon: '✉', title: 'Reward tickets' },
];

/**
 * Frame shared by every menu screen: a top bar (back, title, currencies) and a body the active
 * screen renders into. One instance; screens swap its contents.
 */
export class MenuShell {
  readonly root: HTMLElement;
  readonly body: HTMLElement;
  readonly view: View;
  private readonly title: HTMLElement;
  private readonly back: HTMLElement;
  private readonly currencies = new Map<Currency, HTMLElement>();
  private onBack: (() => void) | null = null;
  private readonly disposeBack: () => void;
  private readonly modalRoot: HTMLElement;
  readonly modal: View;

  constructor(
    container: HTMLElement,
    private readonly wallet: Wallet,
    onUiTap: () => void,
  ) {
    this.root = el('div', 'menu is-hidden');
    this.root.dataset['testid'] = 'menu';
    const top = el('div', 'menu-top');
    this.back = el('div', 'menu-back', '‹');
    this.back.setAttribute('role', 'button');
    this.back.setAttribute('aria-label', 'Back');
    this.back.dataset['testid'] = 'menu-back';
    this.disposeBack = onTap(this.back, () => {
      onUiTap();
      this.onBack?.();
    });
    this.title = el('div', 'menu-title', '');
    const bar = el('div', 'currency-bar');
    for (const { c, icon, title } of CURRENCY_LABELS) {
      const chip = el('div', `currency currency-${c}`);
      chip.title = title;
      const v = el('span', 'currency-val', '0');
      chip.append(el('span', 'currency-icon', icon), v);
      bar.append(chip);
      this.currencies.set(c, v);
    }
    top.append(this.back, this.title, bar);
    this.body = el('div', 'menu-body');
    this.view = new View(this.body);
    this.modalRoot = el('div', 'modal is-hidden');
    this.modal = new View(el('div', 'panel modal-panel'));
    this.modalRoot.append(this.modal.root);
    this.root.append(top, this.body, this.modalRoot);
    container.append(this.root);
  }

  /** Starts a new screen: clears the body and sets the title / back action. */
  begin(title: string, onBack: (() => void) | null, screenId: string): View {
    this.closeModal();
    this.view.reset();
    this.title.textContent = title;
    this.onBack = onBack;
    this.back.classList.toggle('is-hidden', onBack === null);
    this.root.dataset['screen'] = screenId;
    this.refreshCurrencies();
    return this.view;
  }

  refreshCurrencies(): void {
    for (const [c, node] of this.currencies) node.textContent = fmtInt(this.wallet.get(c));
  }

  openModal(cls = ''): View {
    this.modal.reset();
    this.modal.root.className = `panel modal-panel ${cls}`;
    this.modalRoot.classList.remove('is-hidden');
    return this.modal;
  }

  closeModal(): void {
    this.modal.reset();
    this.modalRoot.classList.add('is-hidden');
  }

  get modalOpen(): boolean {
    return !this.modalRoot.classList.contains('is-hidden');
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-hidden', !visible);
    if (!visible) this.closeModal();
  }

  get visible(): boolean {
    return !this.root.classList.contains('is-hidden');
  }

  get screen(): string {
    return this.root.dataset['screen'] ?? '';
  }

  dispose(): void {
    this.view.reset();
    this.modal.reset();
    this.disposeBack();
    this.root.remove();
  }
}
