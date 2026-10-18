/** Tiny DOM helpers. The UI is plain DOM + CSS; no framework is needed at this scale. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined && className.length > 0) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Adds a listener and returns a function that removes it (collected for dispose()). */
export function listen<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  handler: (e: WindowEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void;
export function listen<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  handler: (e: DocumentEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void;
export function listen<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): () => void;
export function listen(
  target: EventTarget,
  type: string,
  handler: (e: Event) => void,
  options?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/**
 * Tap handler for menu buttons. Uses pointerup inside the element (not `click`) so it works even
 * though the game suppresses default touch behaviour, and fires only if the finger lifts on it.
 */
export function onTap(target: HTMLElement, handler: () => void): () => void {
  let activeId = -1;
  const down = (e: PointerEvent): void => {
    activeId = e.pointerId;
    target.classList.add('is-pressed');
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = -1;
    target.classList.remove('is-pressed');
    const r = target.getBoundingClientRect();
    if (
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    ) {
      handler();
    }
  };
  const cancel = (e: PointerEvent): void => {
    if (e.pointerId !== activeId) return;
    activeId = -1;
    target.classList.remove('is-pressed');
  };
  const keydown = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
  target.addEventListener('pointerdown', down);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', cancel);
  target.addEventListener('keydown', keydown);
  return () => {
    target.removeEventListener('pointerdown', down);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', cancel);
    target.removeEventListener('keydown', keydown);
  };
}
