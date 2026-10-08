// BOOT: wires the modules together, connects native Capacitor plugins when running as the Android app,
// and starts the game. In a plain browser everything falls back to web APIs.
(function boot(root) {
  'use strict';
  const SC = root.SC;

  /** Thin wrapper over Capacitor plugins; every call is optional and failure-safe. */
  function createNativeBridge() {
    const capacitor = root.Capacitor;
    const is_native = !!(capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform());
    const plugins = is_native && capacitor.Plugins ? capacitor.Plugins : {};
    const safe = (promise_factory) => {
      try {
        const result = promise_factory();
        if (result && result.catch) result.catch(() => {});
      } catch (call_error) {
        // plugin missing or failed: the web fallback keeps working
      }
    };
    return {
      is_native,
      plugin: (name) => plugins[name] || null,
      hideSplash: () => plugins.SplashScreen && safe(() => plugins.SplashScreen.hide({ fadeOutDuration: 300 })),
      keepAwake: (enabled) => plugins.NativeShell && safe(() => plugins.NativeShell.setKeepAwake({ enabled })),
      reapplyImmersive: () => plugins.NativeShell && safe(() => plugins.NativeShell.reapplyImmersive()),
      exitApp() {
        if (!plugins.App) return false;
        safe(() => plugins.App.exitApp());
        return true;
      },
      onBack: (handler) => plugins.App && safe(() => plugins.App.addListener('backButton', handler)),
      onPause: (handler) => plugins.App && safe(() => plugins.App.addListener('pause', handler)),
      onResume: (handler) => plugins.App && safe(() => plugins.App.addListener('resume', handler)),
      getInfo: () => (plugins.NativeShell ? plugins.NativeShell.getInfo().catch(() => null) : Promise.resolve(null)),
      applySafeArea() {
        if (!plugins.NativeShell) return Promise.resolve();
        return plugins.NativeShell.getSafeArea().then((insets) => {
          const style = document.documentElement.style;
          style.setProperty('--native-safe-top', `${insets.top}px`);
          style.setProperty('--native-safe-right', `${insets.right}px`);
          style.setProperty('--native-safe-bottom', `${insets.bottom}px`);
          style.setProperty('--native-safe-left', `${insets.left}px`);
          root.dispatchEvent(new Event('sc-safe-area'));
        }).catch(() => {});
      },
    };
  }

  function collectDom() {
    const by_id = (id) => document.getElementById(id);
    return {
      app: by_id('app'),
      bg_canvas: by_id('bg-canvas'),
      game_canvas: by_id('game-canvas'),
      photo_image: by_id('photo-image'),
      photo_input: by_id('photo-input'),
      screen_title: by_id('screen-title'),
      screen_map: by_id('screen-map'),
      screen_game: by_id('screen-game'),
      title_candies: by_id('title-candies'),
      title_greeting: by_id('title-greeting'),
      title_version: by_id('title-version'),
      btn_play: by_id('btn-play'),
      btn_title_settings: by_id('btn-title-settings'),
      btn_title_help: by_id('btn-title-help'),
      btn_map_back: by_id('btn-map-back'),
      btn_map_settings: by_id('btn-map-settings'),
      map_scroll: by_id('map-scroll'),
      map_inner: by_id('map-inner'),
      map_canvas: by_id('map-canvas'),
      map_nodes: by_id('map-nodes'),
      hud_moves: by_id('hud-moves'),
      hud_level: by_id('hud-level'),
      hud_goal_list: by_id('hud-goal-list'),
      hud_score: by_id('hud-score'),
      star_fill: by_id('star-fill'),
      star_mark_0: by_id('star-mark-0'),
      star_mark_1: by_id('star-mark-1'),
      star_mark_2: by_id('star-mark-2'),
      board_slot: by_id('board-slot'),
      banner: by_id('banner'),
      tutorial_bubble: by_id('tutorial-bubble'),
      btn_pause: by_id('btn-pause'),
      btn_hint: by_id('btn-hint'),
      btn_sound: by_id('btn-sound'),
      modal_root: by_id('modal-root'),
      modal_stack: by_id('modal-stack'),
      toast: by_id('toast'),
      live_region: by_id('live-region'),
    };
  }

  async function start() {
    document.title = SC.CONFIG.GAME_TITLE;
    const dom = collectDom();
    const native = createNativeBridge();
    native.applySafeArea();
    const store = SC.STORAGE.createStore();
    const load_result = await store.load();
    const photo = await store.loadPhoto();
    const audio = SC.AUDIO.createAudio();
    const renderer = SC.RENDER.createBoardRenderer(dom.game_canvas);
    const background = SC.RENDER.createBackgroundRenderer(dom.bg_canvas);
    const ui = SC.UI.createUi(dom, {
      sound: (name, params) => audio.play(name, params),
      haptic: (kind) => SC.game && SC.game.haptic(kind),
    });
    const game = SC.GAME.createGame({ dom, native, store, audio, renderer, background, ui, photo });
    SC.game = game;
    SC.native = native;
    // Phones only allow audio after a gesture: create/resume the AudioContext on the first tap.
    const unlockAudio = () => audio.unlock();
    document.addEventListener('pointerdown', unlockAudio, { capture: true });
    document.addEventListener('touchend', unlockAudio, { capture: true });
    game.start(load_result);
    requestAnimationFrame(() => requestAnimationFrame(() => native.hideSplash()));
    // Debug builds only: the emulator test hook ships in the debug APK's assets and nowhere else.
    if (native.is_native) {
      native.getInfo().then((info) => {
        if (!info || !info.debug) return;
        const hook = document.createElement('script');
        hook.src = 'test-hook.js';
        document.body.appendChild(hook);
      });
    }
  }

  function showFatal(error) {
    const panel = document.createElement('pre');
    panel.style.cssText = 'position:fixed;inset:20px;z-index:99;background:#fff;color:#6a1b5a;padding:16px;border-radius:16px;white-space:pre-wrap;font:14px monospace;';
    panel.textContent = `Something went wrong while starting.\n\n${error && error.stack ? error.stack : error}`;
    document.body.appendChild(panel);
    if (root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.SplashScreen) root.Capacitor.Plugins.SplashScreen.hide().catch(() => {});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => start().catch(showFatal));
  else start().catch(showFatal);
})(typeof window !== 'undefined' ? window : globalThis);
