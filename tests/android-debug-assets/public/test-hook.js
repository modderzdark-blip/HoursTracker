// Debug-build-only test hook. Packaged into the debug APK via a Gradle debug source set (absent from release, which CI
// verifies) and injected by Playwright in browser tests. It never changes the game; it only reports state and
// computes on-screen coordinates (CSS px) so tests can drive the game with real taps and swipes.
// On Android it logs "SCTEST {json}" every 400 ms; console output reaches logcat in debug builds.
(function installTestHook(root) {
  'use strict';
  if (root.SC_TEST) return;
  let sequence = 0;
  let window_errors = 0;
  root.addEventListener('error', () => {
    window_errors += 1;
  });
  root.addEventListener('unhandledrejection', () => {
    window_errors += 1;
  });

  function center(element) {
    const rect = element.getBoundingClientRect();
    return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.bottom > 0 && rect.top < root.innerHeight;
  }

  function activeScreen() {
    const active = document.querySelector('.screen.is-active');
    return active ? active.id.replace('screen-', '') : null;
  }

  function visibleButtons() {
    const buttons = {};
    const modal_root = document.getElementById('modal-root');
    const modal_open = modal_root && !modal_root.hidden;
    const scope = modal_open ? Array.from(document.querySelectorAll('#modal-stack .modal')).filter((modal) => modal.style.visibility !== 'hidden' && !modal.classList.contains('is-closing')).pop() : document.querySelector('.screen.is-active');
    if (!scope) return buttons;
    scope.querySelectorAll('button').forEach((button) => {
      if (!isVisible(button)) return;
      const key = button.id || button.getAttribute('aria-label') || button.textContent.trim();
      buttons[key] = center(button);
    });
    return buttons;
  }

  function mapNodes() {
    const nodes = {};
    document.querySelectorAll('#map-nodes .map-node[data-level-id]').forEach((node) => {
      if (isVisible(node)) nodes[node.dataset.levelId] = center(node);
    });
    return nodes;
  }

  /** A valid move as screen points [x1, y1, x2, y2] in CSS px (the hint move: prefers specials). */
  function nextMove() {
    const game = root.SC && root.SC.game;
    if (!game || !game.logic || game.state !== 'PLAYING') return null;
    const move = root.SC.LOGIC.findHint(game.logic);
    if (!move) return null;
    const from = game.renderer.cellCenter(move.from);
    const to = game.renderer.cellCenter(move.to);
    return { cells: [move.from, move.to], points: [Math.round(from.x), Math.round(from.y), Math.round(to.x), Math.round(to.y)] };
  }

  function snapshot() {
    const game = root.SC && root.SC.game;
    const top_modal = game ? game.ui.topModal() : null;
    const audio_state = game ? game.audio.state() : null;
    const move = nextMove();
    sequence += 1;
    return {
      seq: sequence,
      time: Date.now(),
      ready: !!game,
      state: game ? game.state : 'BOOT',
      screen: activeScreen(),
      modal: top_modal ? top_modal.id : null,
      level: game && game.level ? game.level.id : null,
      moves_left: game && game.logic ? game.logic.moves_left : null,
      score: game && game.logic ? game.logic.score : null,
      status: game && game.logic ? game.logic.status : null,
      moves_played: game ? game.movesPlayed : 0,
      unlocked: game ? game.store.save.unlocked : null,
      selected: game ? game.selected : -1,
      hint: game ? game.hintVisible : false,
      dpr: root.devicePixelRatio,
      viewport: [root.innerWidth, root.innerHeight],
      quality: game ? game.renderer.quality : null,
      timeline_now: game ? Math.round(game.renderer.timeline.now) : 0,
      busy: game ? game.renderer.timeline.busy : false,
      particles: game ? game.renderer.particles.activeCount : 0,
      audio: audio_state,
      lifecycle: game ? game.lifecycleLog.slice(-6) : [],
      errors: window_errors,
      reduced_motion: document.getElementById('app').classList.contains('reduced-motion'),
      buttons: visibleButtons(),
      map_nodes: activeScreen() === 'map' && !top_modal ? mapNodes() : {},
      selftest: (() => {
        const status = document.getElementById('selftest-status');
        const report = document.getElementById('selftest-report');
        if (!status) return null;
        const done_line = report ? (report.textContent.match(/Done in [^\n]*/) || [''])[0] : '';
        return { passed: status.classList.contains('is-pass'), failed: status.classList.contains('is-fail'), text: status.textContent, done: done_line };
      })(),
      move: move ? move.points : null,
      move_cells: move ? move.cells : null,
    };
  }

  root.SC_TEST = { snapshot, nextMove, center, visibleButtons };

  const is_native = !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  if (is_native) {
    const report = () => {
      try {
        console.log(`SCTEST ${JSON.stringify(snapshot())}`);
      } catch (report_error) {
        console.log(`SCTEST {"error":"${String(report_error).replace(/"/g, "'")}"}`);
      }
    };
    report();
    setInterval(report, 400);
  }
})(typeof window !== 'undefined' ? window : globalThis);
