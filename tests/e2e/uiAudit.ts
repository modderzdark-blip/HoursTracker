import type { Page } from '@playwright/test';

/** One layout problem found on a screen. */
export interface AuditIssue {
  readonly kind:
    | 'overlap'
    | 'button-overlap'
    | 'clipped'
    | 'spill'
    | 'offscreen'
    | 'scroll-blocked'
    | 'h-scroll'
    | 'tap-target'
    | 'safe-area'
    | 'under-top-bar'
    | 'tiny-text'
    | 'toast'
    | 'hidden-action';
  readonly detail: string;
}

export interface AuditOptions {
  /** Roots whose content is checked (the topmost layer of the screen). */
  readonly scope: readonly string[];
  /** Subtrees that are skipped (decoration, transient effects). */
  readonly ignore?: readonly string[];
  /** Safe-area insets (px) that content must stay clear of. */
  /** Elements (e.g. a screen's main buttons) that must be fully on screen without scrolling. */
  readonly mustSee?: readonly string[];
  readonly insets: {
    readonly l: number;
    readonly r: number;
    readonly t: number;
    readonly b: number;
  };
}

export interface AuditResult {
  readonly issues: AuditIssue[];
  /** Text intentionally cut with an ellipsis (reported, not failed). */
  readonly ellipsized: string[];
  /** Visible text elements checked (sanity: a screen with 0 is a broken test). */
  readonly textCount: number;
}

/**
 * Layout audit that runs inside the page. Self-contained: Playwright serialises the function, so
 * it must not reference anything outside its own body.
 */
function auditInPage(o: AuditOptions): AuditResult {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const TOL = 1.5;
  const issues: AuditIssue[] = [];
  const ellipsized: string[] = [];
  const ignore = [
    ...(o.ignore ?? []),
    '.vignette',
    '.title-embers',
    '.dmg-layer',
    '.debug-overlay',
    '.rotate-hint',
    'svg',
    'canvas',
  ].join(',');

  interface Box {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }
  const box = (r: DOMRect | Box): Box => ({
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
  });
  const intersect = (a: Box, b: Box): Box | null => {
    const r = {
      left: Math.max(a.left, b.left),
      top: Math.max(a.top, b.top),
      right: Math.min(a.right, b.right),
      bottom: Math.min(a.bottom, b.bottom),
    };
    return r.right - r.left > 0.5 && r.bottom - r.top > 0.5 ? r : null;
  };
  const overlaps = (a: Box, b: Box): boolean =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOL &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOL;

  const describe = (el: Element): string => {
    const h = el as HTMLElement;
    const cls = typeof h.className === 'string' && h.className.length > 0 ? h.className : '';
    const tid = h.dataset?.['testid'];
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim();
    const text = (own.length > 0 ? own : (h.innerText ?? '')).replace(/\s+/g, ' ').trim();
    return `${el.tagName.toLowerCase()}${cls.length > 0 ? `.${cls.trim().split(/\s+/).join('.')}` : ''}${tid !== undefined ? `[${tid}]` : ''}${text.length > 0 ? ` "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"` : ''}`;
  };
  const fmt = (b: Box): string =>
    `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.right - b.left)}×${Math.round(b.bottom - b.top)}`;

  const styleCache = new Map<Element, CSSStyleDeclaration>();
  const cs = (el: Element): CSSStyleDeclaration => {
    let s = styleCache.get(el);
    if (s === undefined) {
      s = getComputedStyle(el);
      styleCache.set(el, s);
    }
    return s;
  };
  const visible = (el: Element): boolean => {
    if (el.getClientRects().length === 0) return false;
    if (cs(el).visibility !== 'visible') return false;
    let op = 1;
    for (let n: Element | null = el; n !== null; n = n.parentElement) op *= Number(cs(n).opacity);
    return op > 0.08;
  };
  const isScroller = (el: Element, axis: 'x' | 'y'): boolean => {
    const ov = axis === 'x' ? cs(el).overflowX : cs(el).overflowY;
    return ov === 'auto' || ov === 'scroll';
  };
  const clips = (el: Element): boolean => {
    const s = cs(el);
    return s.overflowX !== 'visible' || s.overflowY !== 'visible';
  };
  /** Padding box on screen (scaled like the border box when a transform scales the element). */
  const paddingBox = (n: Element): Box => {
    const r = n.getBoundingClientRect();
    const h = n as HTMLElement;
    const sx = h.offsetWidth > 0 ? r.width / h.offsetWidth : 1;
    const sy = h.offsetHeight > 0 ? r.height / h.offsetHeight : 1;
    return {
      left: r.left + n.clientLeft * sx,
      top: r.top + n.clientTop * sy,
      right: r.left + (n.clientLeft + n.clientWidth) * sx,
      bottom: r.top + (n.clientTop + n.clientHeight) * sy,
    };
  };
  /** Visible part of an element: its box cut by every clipping ancestor and the viewport. */
  const viewport: Box = { left: 0, top: 0, right: W, bottom: H };
  const clipBoxCache = new Map<Element, Box | null>();
  const clipOf = (el: Element): Box | null => {
    if (clipBoxCache.has(el)) return clipBoxCache.get(el) ?? null;
    let c: Box | null = viewport;
    for (let n = el.parentElement; n !== null && c !== null; n = n.parentElement) {
      if (clips(n)) c = intersect(c, paddingBox(n));
    }
    clipBoxCache.set(el, c);
    return c;
  };
  const scrollAncestor = (el: Element): Element | null => {
    for (let n = el.parentElement; n !== null; n = n.parentElement) {
      if (
        (isScroller(n, 'y') && n.scrollHeight > n.clientHeight + 1) ||
        (isScroller(n, 'x') && n.scrollWidth > n.clientWidth + 1)
      )
        return n;
    }
    return null;
  };
  const hasBox = (el: Element): boolean => {
    const s = cs(el);
    if (s.display === 'inline') return false;
    const bg = s.backgroundColor;
    const transparent = bg === 'transparent' || /rgba\(.*,\s*0\)$/.test(bg);
    return (
      !transparent ||
      s.backgroundImage !== 'none' ||
      parseFloat(s.borderTopWidth) + parseFloat(s.borderLeftWidth) > 0
    );
  };

  /** Rects cut to what is actually painted (ancestors' clips, and the element's own clip). */
  const visibleRects = (el: Element, rects: Box[]): Box[] => {
    let c = clipOf(el);
    if (c !== null && clips(el)) c = intersect(c, paddingBox(el));
    if (c === null) return [];
    const cc = c;
    return rects.map((r) => intersect(r, cc)).filter((r): r is Box => r !== null);
  };

  // ---- collect
  const all: Element[] = [];
  for (const sel of o.scope) {
    for (const root of document.querySelectorAll(sel)) {
      if (!visible(root)) continue;
      all.push(root, ...root.querySelectorAll('*'));
    }
  }
  const els = [...new Set(all)].filter(
    (el) => el instanceof HTMLElement && el.closest(ignore) === null && visible(el),
  );

  interface TextEl {
    el: Element;
    rects: Box[];
  }
  const texts: TextEl[] = [];
  for (const el of els) {
    const nodes = [...el.childNodes].filter(
      (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0,
    );
    if (nodes.length === 0) continue;
    const rects: Box[] = [];
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        if (r.width > 0.5 && r.height > 0.5) rects.push(box(r));
    }
    if (rects.length > 0) texts.push({ el, rects });
  }
  const buttons = els.filter((el) => el.getAttribute('role') === 'button');
  const topBars = els.filter((el) => el.classList.contains('menu-top'));

  // ---- (g) tiny text, (b) clipping / spilling, ellipsis
  for (const t of texts) {
    const s = cs(t.el);
    const size = parseFloat(s.fontSize);
    if (size < 12) issues.push({ kind: 'tiny-text', detail: `${describe(t.el)} is ${size}px` });
    const clip = clipOf(t.el);
    const ellipsis = s.textOverflow === 'ellipsis' && clips(t.el);
    if (ellipsis && t.el.scrollWidth > t.el.clientWidth + 1) {
      ellipsized.push(describe(t.el));
      continue;
    }
    for (const r of t.rects) {
      if (clip === null) {
        if (scrollAncestor(t.el) === null)
          issues.push({ kind: 'clipped', detail: `${describe(t.el)} is fully clipped` });
        break;
      }
      const cut =
        r.left < clip.left - TOL ||
        r.right > clip.right + TOL ||
        r.top < clip.top - TOL ||
        r.bottom > clip.bottom + TOL;
      if (cut && scrollAncestor(t.el) === null) {
        issues.push({
          kind: r.right > W + TOL || r.bottom > H + TOL || r.left < -TOL ? 'offscreen' : 'clipped',
          detail: `${describe(t.el)} text ${fmt(r)} cut by ${fmt(clip)}`,
        });
        break;
      }
    }
    // Text spilling out of the nearest box (button, card, chip) it sits in.
    let owner: Element | null = t.el;
    while (owner !== null && !hasBox(owner)) owner = owner.parentElement;
    if (owner !== null && owner !== document.body && owner.id !== 'ui-root') {
      const ob = owner.getBoundingClientRect();
      for (const r of visibleRects(t.el, t.rects)) {
        if (
          r.left < ob.left - TOL ||
          r.right > ob.right + TOL ||
          r.top < ob.top - TOL ||
          r.bottom > ob.bottom + TOL
        ) {
          issues.push({
            kind: 'spill',
            detail: `${describe(t.el)} text ${fmt(r)} spills out of ${describe(owner)} ${fmt(box(ob))}`,
          });
          break;
        }
      }
    }
  }

  // ---- content clipped by overflow:hidden containers; scroll containers
  for (const el of els) {
    const s = cs(el);
    const yScroll = isScroller(el, 'y');
    const xScroll = isScroller(el, 'x');
    const overY = el.scrollHeight > el.clientHeight + 1;
    const overX = el.scrollWidth > el.clientWidth + 1;
    if ((yScroll && overY) || (xScroll && overX)) {
      if (el.closest('[data-allow-scroll]') === null)
        issues.push({
          kind: 'scroll-blocked',
          detail: `${describe(el)} scrolls but has no [data-allow-scroll]: touch can't pan it`,
        });
    }
    if (xScroll && overX && s.textOverflow !== 'ellipsis')
      issues.push({
        kind: 'h-scroll',
        detail: `${describe(el)} overflows sideways (${el.scrollWidth} > ${el.clientWidth})`,
      });
    if (
      (s.overflowX === 'hidden' || s.overflowX === 'clip') &&
      overX &&
      s.textOverflow !== 'ellipsis'
    )
      issues.push({
        kind: 'clipped',
        detail: `${describe(el)} hides overflow (${el.scrollWidth} > ${el.clientWidth} wide)`,
      });
    if ((s.overflowY === 'hidden' || s.overflowY === 'clip') && overY)
      issues.push({
        kind: 'clipped',
        detail: `${describe(el)} hides overflow (${el.scrollHeight} > ${el.clientHeight} tall)`,
      });
  }

  // ---- (c) outside the viewport (unless inside a scroll container)
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) continue;
    if (scrollAncestor(el) !== null) continue;
    if (r.left < -TOL || r.right > W + TOL || r.top < -TOL || r.bottom > H + TOL)
      issues.push({ kind: 'offscreen', detail: `${describe(el)} at ${fmt(box(r))} (${W}×${H})` });
  }

  // ---- (a) text over text, text over another button, buttons over buttons
  const vt = texts.map((t) => ({ el: t.el, rects: visibleRects(t.el, t.rects) }));
  const stickyOf = (el: Element): Element | null => {
    for (let n: Element | null = el; n !== null; n = n.parentElement)
      if (cs(n).position === 'sticky') return n;
    return null;
  };
  /** Content scrolling underneath a sticky header/footer of its own scroll container. */
  const scrollsUnder = (a: Element, b: Element): boolean => {
    for (const [x, y] of [
      [a, b],
      [b, a],
    ] as const) {
      const st = stickyOf(x);
      if (st === null || st.contains(y)) continue;
      const sc = scrollAncestor(y);
      if (sc !== null && sc.contains(st)) return true;
    }
    return false;
  };
  const related = (a: Element, b: Element): boolean =>
    a.contains(b) || b.contains(a) || scrollsUnder(a, b);
  const isBadgeOf = (a: Element, b: Element): boolean =>
    (a.classList.contains('badge') && a.parentElement === b) ||
    (b.classList.contains('badge') && b.parentElement === a);
  for (let i = 0; i < vt.length; i++) {
    const a = vt[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < vt.length; j++) {
      const b = vt[j];
      if (b === undefined || related(a.el, b.el) || isBadgeOf(a.el, b.el)) continue;
      const hit = a.rects.find((ra) => b.rects.some((rb) => overlaps(ra, rb)));
      if (hit !== undefined)
        issues.push({ kind: 'overlap', detail: `${describe(a.el)} overlaps ${describe(b.el)}` });
    }
  }
  const vb = buttons.map((el) => ({
    el,
    rects: visibleRects(el, [box(el.getBoundingClientRect())]),
  }));
  for (const t of vt) {
    for (const b of vb) {
      if (related(t.el, b.el) || isBadgeOf(t.el, b.el) || b.el.contains(t.el)) continue;
      if (
        t.el.closest('[role="button"]') !== null &&
        b.el.contains(t.el.closest('[role="button"]'))
      )
        continue;
      if (t.rects.some((r) => b.rects.some((rb) => overlaps(r, rb))))
        issues.push({
          kind: 'overlap',
          detail: `${describe(t.el)} lies over button ${describe(b.el)}`,
        });
    }
  }
  for (let i = 0; i < vb.length; i++) {
    const a = vb[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < vb.length; j++) {
      const b = vb[j];
      if (b === undefined || related(a.el, b.el)) continue;
      if (a.rects.some((ra) => b.rects.some((rb) => overlaps(ra, rb))))
        issues.push({
          kind: 'button-overlap',
          detail: `${describe(a.el)} overlaps ${describe(b.el)}`,
        });
    }
  }

  // ---- (d) tap targets
  for (const b of vb) {
    const r = b.el.getBoundingClientRect();
    if (b.rects.length === 0) continue;
    if (r.width < 40 - 0.5 || r.height < 40 - 0.5)
      issues.push({
        kind: 'tap-target',
        detail: `${describe(b.el)} is ${Math.round(r.width)}×${Math.round(r.height)}`,
      });
  }

  // ---- (e) safe areas and the top bar
  const safe: Box = {
    left: o.insets.l,
    top: o.insets.t,
    right: W - o.insets.r,
    bottom: H - o.insets.b,
  };
  const content = [...vt, ...vb];
  for (const c of content) {
    for (const r of c.rects) {
      if (
        r.left < safe.left - TOL ||
        r.right > safe.right + TOL ||
        r.top < safe.top - TOL ||
        r.bottom > safe.bottom + TOL
      ) {
        issues.push({
          kind: 'safe-area',
          detail: `${describe(c.el)} at ${fmt(r)} enters the safe-area inset`,
        });
        break;
      }
    }
    for (const bar of topBars) {
      if (bar.contains(c.el)) continue;
      const br = box(bar.getBoundingClientRect());
      if (c.rects.some((r) => overlaps(r, br))) {
        issues.push({ kind: 'under-top-bar', detail: `${describe(c.el)} is under the top bar` });
        break;
      }
    }
  }

  // ---- toasts: inside the viewport, readable, never over the top bar / title
  for (const toast of document.querySelectorAll('.hud-toast')) {
    if (!visible(toast)) continue;
    const r = box(toast.getBoundingClientRect());
    if (r.left < safe.left - TOL || r.right > safe.right + TOL || r.top < -TOL || r.bottom > H)
      issues.push({ kind: 'toast', detail: `${describe(toast)} at ${fmt(r)} leaves the screen` });
    for (const head of document.querySelectorAll('.menu-top, .menu-title')) {
      if (!visible(head)) continue;
      if (overlaps(r, box(head.getBoundingClientRect())))
        issues.push({ kind: 'toast', detail: `${describe(toast)} covers ${describe(head)}` });
    }
    if (parseFloat(cs(toast).fontSize) < 12)
      issues.push({ kind: 'toast', detail: `${describe(toast)} text is too small` });
  }

  // ---- main actions visible without scrolling
  for (const sel of o.mustSee ?? []) {
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const r = box(el.getBoundingClientRect());
      const c = clipOf(el);
      const inside =
        c !== null &&
        r.left >= c.left - TOL &&
        r.right <= c.right + TOL &&
        r.top >= c.top - TOL &&
        r.bottom <= c.bottom + TOL &&
        r.bottom <= safe.bottom + TOL;
      if (!inside)
        issues.push({
          kind: 'hidden-action',
          detail: `${describe(el)} at ${fmt(r)} needs scrolling to be seen`,
        });
    }
  }

  // De-duplicate (the same pair can be found through several rects).
  const seen = new Set<string>();
  const unique = issues.filter((i) => {
    const k = `${i.kind}|${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { issues: unique, ellipsized, textCount: texts.length };
}

/** Waits until finite CSS animations (card flips, star pops, fades) have finished. */
export async function settle(page: Page, maxMs = 6000): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .every(
            (a) =>
              a.playState !== 'running' ||
              (a.effect?.getComputedTiming().iterations ?? 1) === Infinity,
          ),
      undefined,
      { timeout: maxMs },
    )
    .catch(() => undefined);
  // Two frames so layout after the last animation tick is committed.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
}

export async function audit(page: Page, o: AuditOptions): Promise<AuditResult> {
  return page.evaluate(auditInPage, o);
}
