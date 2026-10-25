import type { Currency } from '../../data/economy';
import type { Wallet } from '../../progression/wallet';
import { el, onTap } from '../dom';
import { PowerPop } from './PowerPop';
import { fmtInt, View } from './View';

/** Duration of the currency count-up when a balance grows. */
const COUNT_MS = 750;

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
  /** Balances as currently drawn (they count up towards the wallet). */
  private readonly shown = new Map<Currency, number>();
  private countRaf = 0;
  private readonly power: PowerPop;
  /** A balance grew (sound). */
  onGain: ((c: Currency) => void) | null = null;
  /** A new screen began (goal toasts hook). */
  onScreen: ((screenId: string) => void) | null = null;
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
    // Menu lists scroll natively; the game's gesture guard blocks panning everywhere else.
    this.body.dataset['allowScroll'] = '';
    this.view = new View(this.body);
    this.modalRoot = el('div', 'modal is-hidden');
    this.modalRoot.dataset['allowScroll'] = '';
    this.modal = new View(el('div', 'panel modal-panel'));
    this.modalRoot.append(this.modal.root);
    this.root.append(top, this.body, this.modalRoot);
    this.power = new PowerPop(this.root);
    container.append(this.root);
  }

  /** Starts a new screen: clears the body and sets the title / back action. */
  begin(title: string, onBack: (() => void) | null, screenId: string): View {
    this.closeModal();
    this.view.reset();
    this.title.textContent = title;
    this.onBack = onBack;
    this.back.classList.toggle('is-hidden', onBack === null);
    const changed = this.root.dataset['screen'] !== screenId;
    this.root.dataset['screen'] = screenId;
    // Fade / slide the new screen in.
    this.body.classList.remove('is-entering');
    void this.body.offsetWidth;
    this.body.classList.add('is-entering');
    this.refreshCurrencies();
    if (changed) this.onScreen?.(screenId);
    return this.view;
  }

  /**
   * Redraws the balances. A balance that grew counts up to its new value with a pop and a
   * floating "+N"; one that shrank (spending) updates at once.
   */
  refreshCurrencies(): void {
    const rising: { node: HTMLElement; from: number; to: number }[] = [];
    for (const [c, node] of this.currencies) {
      const to = this.wallet.get(c);
      const from = this.shown.get(c);
      this.shown.set(c, to);
      if (from === undefined || to <= from || !this.visible) {
        node.textContent = fmtInt(to);
        continue;
      }
      rising.push({ node, from, to });
      const chip = node.parentElement;
      if (chip !== null) {
        chip.classList.remove('is-gain');
        void chip.offsetWidth;
        chip.classList.add('is-gain');
        chip.querySelector('.currency-plus')?.remove();
        const plus = el('span', 'currency-plus', `+${fmtInt(to - from)}`);
        chip.append(plus);
        window.setTimeout(() => plus.remove(), 1300);
      }
      this.onGain?.(c);
    }
    if (rising.length === 0) return;
    cancelAnimationFrame(this.countRaf);
    const t0 = performance.now();
    const step = (now: number): void => {
      const k = Math.min(1, (now - t0) / COUNT_MS);
      const e = 1 - Math.pow(1 - k, 3);
      for (const r of rising) r.node.textContent = fmtInt(Math.round(r.from + (r.to - r.from) * e));
      if (k < 1) this.countRaf = requestAnimationFrame(step);
    };
    this.countRaf = requestAnimationFrame(step);
  }

  /** Power went up (or down) after gear, skills or a level: the number rolls with an arrow. */
  showPower(before: number, after: number): boolean {
    return this.power.show(before, after);
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
    cancelAnimationFrame(this.countRaf);
    this.power.dispose();
    this.view.reset();
    this.modal.reset();
    this.disposeBack();
    this.root.remove();
  }
}
