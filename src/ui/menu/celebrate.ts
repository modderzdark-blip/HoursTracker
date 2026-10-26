import { HEROES, type HeroId } from '../../data/heroes';
import { MODES, type ModeId } from '../../data/modes';
import { chapterDef } from '../../data/adventure';
import { chapterStory } from '../../data/story';
import type { Celebration } from '../../progression/feel';
import { el, onTap } from '../dom';
import { buildScene } from '../storyScenes';
import type { MenuContext } from './context';

/** Each celebration moves on by itself after this long (a tap moves on sooner). */
const AUTO_MS = 5200;
/** Taps are ignored this long after a card appears (no accidental skip). */
const GUARD_MS = 450;

interface CardContent {
  readonly kicker: string;
  readonly title: string;
  readonly sub: string;
  readonly body: string;
  readonly accent: string;
  readonly scene: HTMLElement | null;
  readonly sound: 'unlock' | 'chapter';
}

function contentFor(c: Celebration): CardContent | null {
  switch (c.kind) {
    case 'chapter': {
      const ch = chapterDef(c.chapter);
      if (ch === undefined) return null;
      const story = chapterStory(ch);
      const next = chapterDef(c.chapter + 1);
      return {
        kicker: `Chapter ${story.numeral} complete`,
        title: ch.name,
        sub:
          next !== undefined ? `Next: Chapter ${next.number} · ${next.name}` : 'The tale is told',
        body: story.outro,
        accent: '#ffb15e',
        scene: buildScene(story.scene),
        sound: 'chapter',
      };
    }
    case 'hero': {
      const def = HEROES[c.id as HeroId];
      if (def === undefined) return null;
      return {
        kicker: 'A new hero answers the call',
        title: def.name,
        sub: def.epithet,
        body: `${def.role} Summon them from the Heroes screen${def.unlock !== null ? ` for ${def.unlock.souls} souls` : ''}.`,
        accent: `#${def.color.toString(16).padStart(6, '0')}`,
        scene: null,
        sound: 'unlock',
      };
    }
    case 'mode': {
      const m = MODES[c.id as ModeId];
      if (m === undefined) return null;
      return {
        kicker: 'New mode unlocked',
        title: m.name,
        sub: 'Find it on the hub',
        body: m.blurb,
        accent: '#ffd27a',
        scene: null,
        sound: 'unlock',
      };
    }
  }
}

/**
 * Full-screen celebration cards (chapter complete, new hero, new mode), one after another,
 * over the menus. Each moves on by itself; a tap moves on sooner. Never traps the player.
 */
export function playCelebrations(ctx: MenuContext, list: readonly Celebration[]): void {
  const host = ctx.shell.root.parentElement;
  if (host === null || list.length === 0) return;
  host.querySelector('.celebrate')?.remove();
  const root = el('div', 'celebrate');
  root.dataset['testid'] = 'celebration';
  host.append(root);
  let index = -1;
  let timer = 0;
  let shownAt = 0;
  let disposeTap: (() => void) | null = null;

  const close = (): void => {
    window.clearTimeout(timer);
    disposeTap?.();
    root.classList.add('is-leaving');
    window.setTimeout(() => root.remove(), 400);
  };

  const show = (i: number): void => {
    const c = list[i];
    const content = c === undefined ? null : contentFor(c);
    if (c === undefined) {
      close();
      return;
    }
    if (content === null) {
      show(i + 1);
      return;
    }
    index = i;
    shownAt = performance.now();
    root.replaceChildren();
    root.dataset['kind'] = c.kind;
    root.style.setProperty('--accent', content.accent);
    if (content.scene !== null) root.append(content.scene);
    else root.append(el('div', 'celebrate-rays'), el('div', 'celebrate-glow'));
    const card = el('div', 'celebrate-card');
    card.append(
      el('div', 'celebrate-kicker', content.kicker),
      el('div', 'celebrate-title', content.title),
      el('div', 'celebrate-rule'),
      el('div', 'celebrate-sub', content.sub),
      el('div', 'celebrate-body', content.body),
    );
    const hint = el(
      'div',
      'celebrate-hint',
      i < list.length - 1 ? 'Tap for more' : 'Tap to continue',
    );
    hint.dataset['testid'] = 'celebration-continue';
    root.append(card, hint);
    ctx.stingers.play(content.sound);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => show(index + 1), AUTO_MS);
  };

  disposeTap = onTap(root, () => {
    if (performance.now() - shownAt < GUARD_MS) return;
    ctx.uiTap();
    show(index + 1);
  });
  show(0);
}
