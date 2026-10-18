/**
 * Blocks browser gestures that break a game on mobile: page scroll, pinch/double-tap zoom,
 * pull-to-refresh, text selection, long-press context menus and the iOS magnifier.
 * CSS (`touch-action: none`, `overscroll-behavior: none`, `user-select: none`) does most of
 * the work; these listeners catch what CSS can't.
 * Elements with `data-allow-scroll` (e.g. the pause menu's scrolling panel) keep native panning.
 */
export function installGestureGuards(): () => void {
  const allowScroll = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest('[data-allow-scroll]') !== null;

  const preventTouchMove = (e: TouchEvent): void => {
    if (e.touches.length > 1 || !allowScroll(e.target)) e.preventDefault();
  };
  const prevent = (e: Event): void => e.preventDefault();
  const preventZoomWheel = (e: WheelEvent): void => {
    if (e.ctrlKey) e.preventDefault();
  };

  const opts: AddEventListenerOptions = { passive: false };
  document.addEventListener('touchmove', preventTouchMove, opts);
  document.addEventListener('contextmenu', prevent);
  document.addEventListener('selectstart', prevent);
  document.addEventListener('dblclick', prevent, opts);
  document.addEventListener('gesturestart', prevent, opts);
  document.addEventListener('gesturechange', prevent, opts);
  document.addEventListener('wheel', preventZoomWheel, opts);

  return () => {
    document.removeEventListener('touchmove', preventTouchMove, opts);
    document.removeEventListener('contextmenu', prevent);
    document.removeEventListener('selectstart', prevent);
    document.removeEventListener('dblclick', prevent, opts);
    document.removeEventListener('gesturestart', prevent, opts);
    document.removeEventListener('gesturechange', prevent, opts);
    document.removeEventListener('wheel', preventZoomWheel, opts);
  };
}

/**
 * Must be called from inside a user gesture (tap). Requests fullscreen, then tries to lock the
 * screen to landscape (Android Chrome only allows the lock while fullscreen). Failures are
 * expected on some browsers (iOS Safari has no lock) and are logged, never thrown.
 */
export async function enterFullscreenLandscape(): Promise<{
  fullscreen: boolean;
  locked: boolean;
}> {
  let fullscreen = document.fullscreenElement !== null;
  let locked = false;
  const root = document.documentElement;
  if (!fullscreen && typeof root.requestFullscreen === 'function') {
    try {
      await root.requestFullscreen({ navigationUI: 'hide' });
      fullscreen = true;
    } catch (err) {
      console.warn('[app] fullscreen request failed', err);
    }
  }
  const orientation = typeof screen !== 'undefined' ? screen.orientation : undefined;
  if (orientation !== undefined && typeof orientation.lock === 'function') {
    try {
      await orientation.lock('landscape');
      locked = true;
    } catch (err) {
      console.warn('[app] orientation lock failed', err);
    }
  }
  return { fullscreen, locked };
}
