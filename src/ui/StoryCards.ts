import type { StoryCard } from '../data/story';
import { el, onTap } from './dom';
import { buildScene } from './storyScenes';

export interface StoryCardsOptions {
  /** Called once when the last card is passed or Skip is tapped. */
  readonly onDone: () => void;
  /** A page turned (sound). */
  readonly onPage?: () => void;
}

/** Delay between words as the narration appears (ms). */
const WORD_MS = 70;

/**
 * Full-screen narration (the prologue): painted scene, title and text that appears word by
 * word. A tap reveals the whole line, the next tap turns the page; Skip ends it at once.
 */
export class StoryCards {
  readonly root: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly title: HTMLElement;
  private readonly text: HTMLElement;
  private readonly dots: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly disposers: (() => void)[] = [];
  private index = -1;
  private revealTimer = 0;
  private revealed = false;
  private done = false;

  constructor(
    container: HTMLElement,
    private readonly cards: readonly StoryCard[],
    private readonly o: StoryCardsOptions,
  ) {
    this.root = el('div', 'story');
    this.root.dataset['testid'] = 'prologue';
    this.stage = el('div', 'story-stage');
    const copy = el('div', 'story-copy');
    this.title = el('div', 'story-title');
    this.text = el('p', 'story-text');
    copy.append(this.title, this.text);
    this.dots = el('div', 'story-dots');
    for (let i = 0; i < cards.length; i++) this.dots.append(el('span', 'story-dot'));
    this.hint = el('div', 'story-hint', 'Tap to continue');
    const skip = el('div', 'story-skip', 'Skip ›');
    skip.setAttribute('role', 'button');
    skip.dataset['testid'] = 'prologue-skip';
    this.disposers.push(
      onTap(skip, () => this.finish()),
      onTap(this.stage, () => this.advance()),
    );
    // Taps on the copy / hint advance too (they sit above the stage).
    copy.style.pointerEvents = 'none';
    this.root.append(this.stage, copy, this.dots, this.hint, skip);
    container.append(this.root);
    this.show(0);
  }

  private show(i: number): void {
    const card = this.cards[i];
    if (card === undefined) {
      this.finish();
      return;
    }
    this.index = i;
    this.o.onPage?.();
    const old = this.stage.querySelector('.scene');
    const scene = buildScene(card.scene);
    scene.classList.add('is-entering');
    this.stage.append(scene);
    if (old !== null) {
      old.classList.add('is-leaving');
      window.setTimeout(() => old.remove(), 900);
    }
    this.title.textContent = card.title;
    this.title.classList.remove('is-in');
    void this.title.offsetWidth;
    this.title.classList.add('is-in');
    this.text.replaceChildren();
    const words = card.text.split(' ');
    words.forEach((w, n) => {
      const span = el('span', 'story-word', w);
      span.style.animationDelay = `${300 + n * WORD_MS}ms`;
      this.text.append(span, document.createTextNode(' '));
    });
    this.revealed = false;
    this.hint.classList.remove('is-ready');
    window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => this.markRevealed(), 300 + words.length * WORD_MS);
    this.dots.querySelectorAll('.story-dot').forEach((d, n) => {
      d.classList.toggle('is-on', n === i);
    });
  }

  private markRevealed(): void {
    this.revealed = true;
    this.text.classList.add('is-revealed');
    this.hint.classList.add('is-ready');
  }

  private advance(): void {
    if (this.done) return;
    if (!this.revealed) {
      window.clearTimeout(this.revealTimer);
      this.markRevealed();
      return;
    }
    this.text.classList.remove('is-revealed');
    this.show(this.index + 1);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    window.clearTimeout(this.revealTimer);
    for (const d of this.disposers) d();
    this.root.classList.add('is-leaving');
    window.setTimeout(() => this.root.remove(), 500);
    this.o.onDone();
  }

  get active(): boolean {
    return !this.done;
  }

  dispose(): void {
    if (!this.done) {
      this.done = true;
      window.clearTimeout(this.revealTimer);
      for (const d of this.disposers) d();
    }
    this.root.remove();
  }
}
