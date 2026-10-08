// GAME: the state machine that ties LOGIC, RENDER, UI, AUDIO, STORAGE and INPUT together.
// States: TITLE -> MAP -> INTRO -> PLAYING -> RESOLVING -> WON / LOST, plus PAUSED.
(function attachGame(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;
  const LOGIC = SC.LOGIC;
  const LEVELS = SC.LEVELS;
  const STORAGE = SC.STORAGE;
  const SELFTEST = SC.SELFTEST;

  const STATE = Object.freeze({ BOOT: 'BOOT', TITLE: 'TITLE', MAP: 'MAP', INTRO: 'INTRO', PLAYING: 'PLAYING', RESOLVING: 'RESOLVING', PAUSED: 'PAUSED', WON: 'WON', LOST: 'LOST' });
  const HAPTIC_STYLES = { tick: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
  const VIBRATE_MS = { tick: 8, medium: 18, heavy: 32 };

  function createGame(env) {
    const { dom, native, store, audio, renderer, background, ui } = env;
    let machine = STATE.BOOT;
    let paused_from = null;
    let level = null;
    let logic_state = null;
    let selected_cell = -1;
    let hint_visible = false;
    let tutorial_active = false;
    let tracker = null;
    let hud_dirty = false;
    let photo_data_url = env.photo || null;
    let app_hidden = false;
    let loop_handle = 0;
    let last_frame_time = 0;
    let slow_frame_ms = 0;
    let frame_interval_average = 16;
    let keyboard_cursor = -1;
    let keyboard_picked = false;
    let last_haptic_at = 0;
    let pause_handle = null;
    let invalid_swap_playing = false;
    let moves_played = 0;
    let lifecycle_log = [];
    const session_attempts = {};
    const system_reduced_motion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;

    const save = () => store.save;
    const settings = () => store.save.settings;
    const reducedMotion = () => settings().reduced_motion || !!(system_reduced_motion && system_reduced_motion.matches);

    // ---------------------------------------------------------------- feedback helpers
    function haptic(kind) {
      if (!settings().haptics) return;
      const now = performance.now();
      if (now - last_haptic_at < 60) return;
      last_haptic_at = now;
      const haptics_plugin = native.plugin('Haptics');
      if (haptics_plugin) {
        haptics_plugin.impact({ style: HAPTIC_STYLES[kind] || 'LIGHT' }).catch(() => {});
      } else if (navigator.vibrate) {
        try {
          navigator.vibrate(VIBRATE_MS[kind] || 10);
        } catch (vibrate_error) {
          // vibration is optional
        }
      }
    }

    function sound(name, params) {
      audio.play(name, params);
    }

    function persist() {
      store.persist().catch(() => {});
    }

    // ---------------------------------------------------------------- settings
    function applySettings() {
      const current = settings();
      audio.setSettings(current);
      renderer.setSettings({ theme: current.theme, colorblind: current.colorblind, reduced_motion: reducedMotion() });
      ui.setIconStyle(current.theme, current.colorblind);
      ui.setReducedMotion(reducedMotion());
      const accent = CONFIG.ACCENTS.find((candidate) => candidate.id === current.accent) || CONFIG.ACCENTS[0];
      ui.setAccent(accent);
      background.setPalette(accent.background);
      background.setAnimated(!reducedMotion() && renderer.quality > 0);
      dom.app.style.setProperty('--photo-brightness', String(current.photo_brightness));
      ui.setSoundButton(current.sfx_on || current.music_on);
      applyPhoto(photo_data_url);
    }

    function applyPhoto(data_url) {
      photo_data_url = data_url || null;
      dom.app.classList.toggle('has-photo', !!photo_data_url);
      dom.photo_image.style.backgroundImage = photo_data_url ? `url("${photo_data_url}")` : '';
    }

    let persist_timer = null;
    function changeSetting(key, value) {
      const current = settings();
      if (key === 'player_name') {
        save().player_name = STORAGE.cleanText(value, STORAGE.MAX_NAME_LENGTH);
        save().name_asked = true;
        ui.renderTitle(save().player_name);
      } else if (key === 'win_message') {
        current.win_message = STORAGE.cleanText(value, STORAGE.MAX_MESSAGE_LENGTH);
      } else {
        current[key] = value;
      }
      store.save.settings = STORAGE.normalizeSave(store.save).settings;
      applySettings();
      if ((key === 'theme' || key === 'colorblind') && level && logic_state) ui.setupHud(level, logic_state);
      if (key === 'theme' || key === 'colorblind') ui.renderTitle(save().player_name);
      clearTimeout(persist_timer);
      persist_timer = setTimeout(persist, 250);
    }

    function toggleSound() {
      const current = settings();
      const turn_on = !(current.sfx_on || current.music_on);
      current.sfx_on = turn_on;
      current.music_on = turn_on;
      audio.unlock();
      applySettings();
      persist();
      ui.toast(turn_on ? 'Sound on' : 'Sound off');
    }

    // ---------------------------------------------------------------- photo
    function downscaleToDataUrl(image_source, source_width, source_height) {
      const scale = Math.min(1, 1280 / Math.max(source_width, source_height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(source_width * scale));
      canvas.height = Math.max(1, Math.round(source_height * scale));
      canvas.getContext('2d').drawImage(image_source, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.82);
    }

    function pickPhotoInBrowser() {
      return new Promise((resolve) => {
        const input = dom.photo_input;
        const onChange = () => {
          input.removeEventListener('change', onChange);
          const file = input.files && input.files[0];
          input.value = '';
          if (!file) {
            resolve(null);
            return;
          }
          const object_url = URL.createObjectURL(file);
          const image = new Image();
          image.onload = () => {
            const data_url = downscaleToDataUrl(image, image.naturalWidth, image.naturalHeight);
            URL.revokeObjectURL(object_url);
            resolve(data_url);
          };
          image.onerror = () => {
            URL.revokeObjectURL(object_url);
            resolve(null);
          };
          image.src = object_url;
        };
        input.addEventListener('change', onChange);
        input.click();
      });
    }

    async function pickPhoto() {
      let data_url = null;
      try {
        const shell = native.plugin('NativeShell');
        if (shell) {
          const result = await shell.pickPhoto({ maxEdge: 1280 });
          if (!result || result.cancelled) return null;
          data_url = result.dataUrl;
        } else {
          data_url = await pickPhotoInBrowser();
        }
      } catch (pick_error) {
        ui.toast('Could not open that photo');
        return null;
      }
      if (!data_url) return null;
      applyPhoto(data_url);
      const stored = await store.savePhoto(data_url);
      ui.toast(stored ? 'Photo set as your background' : 'Storage is full: photo kept for this session only');
      return data_url;
    }

    function removePhoto() {
      applyPhoto(null);
      store.removePhoto();
      ui.toast('Photo removed');
    }

    // ---------------------------------------------------------------- layout and frame loop
    function layoutNow() {
      const width = root.innerWidth;
      const height = root.innerHeight;
      const ratio = root.devicePixelRatio || 1;
      background.resize(width, height, ratio);
      renderer.resizeCanvas(width, height, ratio);
      if (renderer.board && dom.screen_game.classList.contains('is-active')) {
        const slot = dom.board_slot.getBoundingClientRect();
        renderer.placeBoard({ left: slot.left, top: slot.top, width: slot.width, height: slot.height });
        ui.placeTutorial(renderer.boardRect(), boardHasTrays());
      }
      if (machine === STATE.MAP || (machine === STATE.INTRO && dom.screen_map.classList.contains('is-active'))) ui.renderMap(LEVELS, save(), openIntro);
    }

    let layout_pending = false;
    function scheduleLayout() {
      if (layout_pending) return;
      layout_pending = true;
      requestAnimationFrame(() => {
        layout_pending = false;
        layoutNow();
      });
    }

    function frame(time) {
      loop_handle = requestAnimationFrame(frame);
      const raw_interval = last_frame_time ? time - last_frame_time : 16;
      last_frame_time = time;
      const delta = Math.min(50, Math.max(0, raw_interval)); // clamp: returning from background never fast-forwards
      if (raw_interval < 250) {
        frame_interval_average = frame_interval_average * 0.9 + raw_interval * 0.1;
        if (frame_interval_average > CONFIG.FRAME_BUDGET_MS && renderer.quality > 0) {
          slow_frame_ms += raw_interval;
          if (slow_frame_ms > 2000) {
            renderer.setQuality(renderer.quality - 1);
            background.setAnimated(!reducedMotion() && renderer.quality > 0);
            slow_frame_ms = 0;
            frame_interval_average = 16;
          }
        } else {
          slow_frame_ms = Math.max(0, slow_frame_ms - raw_interval);
        }
      }
      background.draw(time, delta);
      renderer.update(machine === STATE.PAUSED ? 0 : delta);
      if (hud_dirty) flushHud();
      if (machine === STATE.PLAYING && !hint_visible && renderer.idleMs > CONFIG.TIMING.HINT_IDLE_MS) showHint('idle');
    }

    function startLoop() {
      if (loop_handle) return;
      last_frame_time = 0;
      loop_handle = requestAnimationFrame(frame);
    }

    function stopLoop() {
      if (loop_handle) cancelAnimationFrame(loop_handle);
      loop_handle = 0;
    }

    // ---------------------------------------------------------------- HUD tracking during playback
    function createTracker(state) {
      return { goals: state.goals, score: state.score, moves_left: state.moves_left, collected: state.collected.slice(), jelly: Uint8Array.from(state.jelly), jelly_total: state.jelly_total, cherries_collected: state.cherries_collected };
    }

    function trackEvent(event) {
      if (!tracker) return;
      if (event.type === 'swap') tracker.moves_left = event.moves_left;
      else if (event.type === 'score') tracker.score += event.points;
      else if (event.type === 'clear' && event.color >= 0) tracker.collected[event.color] += 1;
      else if (event.type === 'jelly') tracker.jelly[event.cell] = event.layers;
      else if (event.type === 'collect') tracker.cherries_collected += 1;
      else if (event.type === 'bonus_move') tracker.moves_left = event.moves_left;
      else return;
      hud_dirty = true;
    }

    function flushHud() {
      hud_dirty = false;
      if (!tracker) return;
      ui.updateHud({ moves: tracker.moves_left, score: tracker.score, progress: LOGIC.goalProgress(tracker) });
    }

    function playbackHooks() {
      return {
        sound,
        haptic,
        event: trackEvent,
        cascade(depth) {
          if (depth < 2) return;
          const text = CONFIG.CASCADE_BANNERS[depth] || CONFIG.CASCADE_BANNER_MAX;
          ui.showBanner(text, depth >= 6);
        },
        collect(event, point) {
          flyToGoal(ui.cherryImage(40), point, 'ingredients');
        },
        shuffle() {
          ui.showBanner('No more moves, shuffling!', false, true);
          ui.announce('No more moves, shuffling');
        },
        bonusTick() {
          sound('bonus');
        },
      };
    }

    function flyToGoal(image_url, from_point, goal_type) {
      const target = ui.goalElementCenter(goal_type);
      const flyer = document.createElement('img');
      flyer.src = image_url;
      flyer.alt = '';
      flyer.style.cssText = `position:absolute;left:${from_point.x - 20}px;top:${from_point.y - 20}px;width:40px;height:40px;z-index:8;pointer-events:none;`;
      dom.app.appendChild(flyer);
      const animation = flyer.animate([
        { transform: 'translate(0,0) scale(1)' },
        { transform: `translate(${(target.x - from_point.x) * 0.4}px, ${(target.y - from_point.y) * 0.4 - 60}px) scale(1.3)`, offset: 0.4 },
        { transform: `translate(${target.x - from_point.x}px, ${target.y - from_point.y}px) scale(0.6)` },
      ], { duration: reducedMotion() ? 200 : 650, easing: 'ease-in-out' });
      animation.onfinish = () => flyer.remove();
      animation.oncancel = () => flyer.remove();
    }

    // ---------------------------------------------------------------- screens
    function cancelLevel() {
      invalid_swap_playing = false;
      renderer.cancelAll();
      renderer.setSpeed(1);
      renderer.clearEffects();
      renderer.setVisible(false);
      boardInput.cancel();
      tracker = null;
      selected_cell = -1;
      hint_visible = false;
      tutorial_active = false;
      ui.tutorial(null);
      native.keepAwake(false);
    }

    function goTitle() {
      cancelLevel();
      ui.closeAllModals();
      machine = STATE.TITLE;
      level = null;
      logic_state = null;
      ui.showScreen('title');
      ui.renderTitle(save().player_name);
      audio.setMusicWanted(true);
    }

    /** options.advance = { from, to, open_next }: after a win the marker hops to the next level and, with
     *  open_next, that level's intro opens by itself (the classic map flow). */
    function goMap(options) {
      const opts = options || {};
      cancelLevel();
      ui.closeAllModals();
      machine = STATE.MAP;
      level = null;
      logic_state = null;
      ui.showScreen('map');
      audio.setMusicWanted(true);
      const advance = opts.advance || null;
      const sequence = ui.renderMap(LEVELS, save(), openIntro, { advance });
      if (!advance) return sequence;
      return sequence.then((finished) => {
        if (finished && advance.open_next && machine === STATE.MAP && !ui.topModal()) openIntro(advance.to);
        return finished;
      });
    }

    function openIntro(level_id) {
      const intro_level = LEVELS.find((candidate) => candidate.id === level_id);
      if (!intro_level) return;
      machine = STATE.INTRO;
      ui.showIntro(intro_level, save().levels[level_id], {
        play: () => startLevel(level_id),
        closed: () => {
          if (machine === STATE.INTRO) machine = STATE.MAP;
        },
      });
    }

    function startLevel(level_id) {
      const next_level = LEVELS.find((candidate) => candidate.id === level_id);
      if (!next_level) {
        goMap();
        return;
      }
      cancelLevel();
      ui.closeAllModals();
      level = next_level;
      const attempt = session_attempts[level_id] || 0;
      session_attempts[level_id] = attempt + 1;
      logic_state = LOGIC.createGame(level, { seed: level.seed + attempt * 7919 });
      ui.showScreen('game');
      renderer.setLevel(logic_state);
      layoutNow();
      ui.setupHud(level, logic_state);
      renderer.setVisible(true);
      renderer.markActivity();
      machine = STATE.PLAYING;
      paused_from = null;
      native.keepAwake(true);
      audio.setMusicWanted(true);
      if (!save().tutorials_seen[level_id] && level.tutorial) {
        tutorial_active = true;
        ui.keepTutorial(level_id === 1); // the guided Level 1 tutorial stays until the first move
        ui.tutorial(level.tutorial);
        ui.placeTutorial(renderer.boardRect(), boardHasTrays());
        if (level_id === 1) showHint('tutorial');
      }
      const goal_text = LOGIC.goalProgress(logic_state).map((progress) => `${progress.type} ${progress.target}`).join(', ');
      ui.announce(`Level ${level.id}, ${level.name}. ${level.moves} moves. Goals: ${goal_text}.`);
    }

    // ---------------------------------------------------------------- moves
    function boardHasTrays() {
      return !!(renderer.board && Array.prototype.some.call(renderer.board.exits, (exit) => exit === 1));
    }

    function select(cell) {
      if (machine !== STATE.PLAYING) return;
      selected_cell = cell;
      renderer.setSelected(cell);
      if (cell >= 0) sound('select');
    }

    function clearHint() {
      if (hint_visible) {
        hint_visible = false;
        renderer.setHint(null);
      }
    }

    function showHint(source) {
      if (machine !== STATE.PLAYING || !logic_state) return;
      const move = LOGIC.findHint(logic_state);
      if (!move) return;
      hint_visible = true;
      renderer.setHint(move);
      if (source === 'button') {
        sound('select');
        ui.announce('Hint shown on the board');
      }
    }

    async function requestSwap(from_cell, to_cell) {
      if (machine !== STATE.PLAYING || !logic_state || invalid_swap_playing) return;
      renderer.markActivity();
      const before = logic_state;
      const result = LOGIC.applySwap(before, from_cell, to_cell);
      if (!result.valid) {
        clearHint();
        haptic('tick');
        invalid_swap_playing = true;
        await renderer.playInvalidSwap(from_cell, to_cell, { sound });
        invalid_swap_playing = false;
        renderer.markActivity();
        return;
      }
      machine = STATE.RESOLVING;
      clearHint();
      select(-1);
      if (tutorial_active) {
        tutorial_active = false;
        ui.tutorial(null);
        save().tutorials_seen[level.id] = true;
        persist();
      }
      tracker = createTracker(before);
      const level_at_start = level;
      const finished = await renderer.playEvents(result.events, playbackHooks());
      if (!finished || level !== level_at_start) return; // cancelled by restart / quit
      logic_state = result.state;
      moves_played += 1;
      renderer.syncToState(logic_state);
      tracker = createTracker(logic_state);
      flushHud();
      renderer.markActivity();
      const progress = LOGIC.goalProgress(logic_state);
      ui.announce(`${logic_state.moves_left} moves left. Score ${logic_state.score}. ${progress.filter((goal) => goal.done).length} of ${progress.length} goals done.`);
      if (logic_state.status === 'won') {
        await winSequence();
      } else if (logic_state.status === 'lost') {
        await loseSequence();
      } else if (machine === STATE.PAUSED) {
        paused_from = STATE.PLAYING;
      } else {
        machine = STATE.PLAYING;
      }
    }

    async function waitWhilePaused() {
      while (machine === STATE.PAUSED) {
        const finished = await renderer.timeline.wait(50);
        if (!finished) return false;
      }
      return true;
    }

    async function winSequence() {
      if (machine === STATE.PAUSED) {
        paused_from = STATE.WON;
        if (!(await waitWhilePaused())) return;
      }
      machine = STATE.WON;
      const level_at_start = level;
      sound('win');
      haptic('heavy');
      renderer.confetti(root.innerWidth);
      ui.showBanner('Level Complete!', true);
      if (!(await renderer.timeline.wait(900)) || level !== level_at_start) return;
      if (logic_state.moves_left > 0) {
        ui.showBanner('Sugar Bonus!', true);
        if (!(await renderer.timeline.wait(500)) || level !== level_at_start) return;
        const bonus = LOGIC.applyEndBonus(logic_state);
        tracker = createTracker(logic_state);
        // The bonus plays fast, and a tap anywhere fast-forwards it.
        renderer.setSpeed(2.5);
        const fastForward = () => renderer.setSpeed(7);
        dom.app.addEventListener('pointerdown', fastForward);
        const finished = await renderer.playEvents(bonus.events, playbackHooks());
        dom.app.removeEventListener('pointerdown', fastForward);
        renderer.setSpeed(1);
        if (!finished || level !== level_at_start) return;
        logic_state = bonus.state;
        renderer.syncToState(logic_state);
        tracker = createTracker(logic_state);
        flushHud();
      }
      const stars = LOGIC.starsForScore(logic_state.score, level.stars, true);
      const outcome = STORAGE.recordResult(save(), level.id, { won: true, score: logic_state.score, stars });
      persist();
      ui.announce(`Level complete! ${stars} stars, score ${logic_state.score}.`);
      const finished_level = level;
      ui.showWin({
        score: logic_state.score, stars, is_new_best: outcome.is_new_best, player_name: save().player_name,
        win_message: settings().win_message, has_next: finished_level.id < LEVELS.length,
      }, {
        next: () => goMap({ advance: { from: finished_level.id, to: finished_level.id + 1, open_next: true } }),
        replay: () => startLevel(finished_level.id),
        map: () => goMap(finished_level.id < LEVELS.length ? { advance: { from: finished_level.id, to: finished_level.id + 1, open_next: false } } : {}),
      });
    }

    async function loseSequence() {
      if (machine === STATE.PAUSED) {
        paused_from = STATE.LOST;
        if (!(await waitWhilePaused())) return;
      }
      machine = STATE.LOST;
      const level_at_start = level;
      sound('lose');
      STORAGE.recordResult(save(), level.id, { won: false, score: logic_state.score, stars: 0 });
      persist();
      if (!(await renderer.timeline.wait(600)) || level !== level_at_start) return;
      const lost_level = level;
      ui.announce('Out of moves.');
      ui.showLose({ progress: LOGIC.goalProgress(logic_state), goals: lost_level.goals, player_name: save().player_name }, {
        retry: () => startLevel(lost_level.id),
        map: () => goMap(),
      });
    }

    // ---------------------------------------------------------------- pause, back, exit
    function openPause() {
      if (machine !== STATE.PLAYING && machine !== STATE.RESOLVING) return;
      paused_from = machine;
      machine = STATE.PAUSED;
      boardInput.cancel();
      native.keepAwake(false);
      pause_handle = ui.showPause({
        resume: resumeFromPause,
        restart: () => {
          ui.confirm({ id: 'confirm-restart', title: 'Restart level?', text: 'Your progress on this attempt will be lost.', yes: 'Restart', no: 'Keep playing' }).then((confirmed) => {
            if (confirmed) startLevel(level.id);
          });
        },
        settings: () => openSettings(),
        quit: () => {
          ui.confirm({ id: 'confirm-quit', title: 'Quit to map?', text: 'This attempt will not be saved.', yes: 'Quit', no: 'Stay' }).then((confirmed) => {
            if (confirmed) goMap();
          });
        },
        closed: () => {
          pause_handle = null;
        },
      });
    }

    function resumeFromPause() {
      if (machine !== STATE.PAUSED) return;
      machine = paused_from || STATE.PLAYING;
      paused_from = null;
      native.keepAwake(true);
      renderer.markActivity();
    }

    function confirmExit() {
      ui.confirm({ id: 'confirm-exit', title: 'Exit game?', text: 'Your progress is saved.', yes: 'Exit', no: 'Stay' }).then((confirmed) => {
        if (!confirmed) return;
        persist();
        if (!native.exitApp()) ui.toast('Close this tab to exit');
      });
    }

    /** Back button / gesture: modal first; gameplay -> Pause; Pause -> "Quit to map?"; map -> title; title -> "Exit game?". */
    function handleBack() {
      const top = ui.topModal();
      if (top) {
        if (top.back) top.back(top);
        else top.close();
        return 'modal';
      }
      if (machine === STATE.PLAYING || machine === STATE.RESOLVING) {
        openPause();
        return 'pause';
      }
      if (machine === STATE.MAP || machine === STATE.INTRO) {
        goTitle();
        return 'title';
      }
      if (machine === STATE.TITLE) {
        confirmExit();
        return 'exit-confirm';
      }
      if (machine === STATE.WON || machine === STATE.LOST) return 'ignored';
      return 'ignored';
    }

    function openSettings() {
      ui.showSettings(settings(), { name: save().player_name, photo: photo_data_url }, {
        change: changeSetting,
        pickPhoto,
        removePhoto,
        selfTest: () => ui.showSelfTest(createSelfTestRunner()),
        help: () => ui.showHelp(),
        reset: () => {
          ui.confirm({ id: 'confirm-reset-1', title: 'Reset progress?', text: 'Stars, best scores and unlocked levels will be erased.', yes: 'Reset', no: 'Cancel', danger: true }).then((first) => {
            if (!first) return;
            ui.confirm({ id: 'confirm-reset-2', title: 'Are you sure?', text: 'This cannot be undone.', yes: 'Erase everything', no: 'Keep my progress', danger: true }).then((second) => {
              if (!second) return;
              store.resetProgress().then(() => {
                ui.toast('Progress reset');
                if (machine === STATE.MAP) ui.renderMap(LEVELS, save(), openIntro);
              });
            });
          });
        },
        closed: () => {},
      });
    }

    // ---------------------------------------------------------------- lifecycle
    function onAppHidden(source) {
      lifecycle_log.push({ event: 'hidden', source, state: machine, at: Date.now() });
      if (app_hidden) return;
      app_hidden = true;
      audio.pauseForLifecycle();
      stopLoop();
      boardInput.cancel();
      if (machine === STATE.PLAYING || machine === STATE.RESOLVING) openPause();
      persist();
    }

    function onAppVisible(source) {
      lifecycle_log.push({ event: 'visible', source, state: machine, at: Date.now() });
      if (!app_hidden) return;
      app_hidden = false;
      audio.resumeFromLifecycle();
      startLoop();
      native.reapplyImmersive();
      scheduleLayout();
    }

    // ---------------------------------------------------------------- self-test runner
    function createSelfTestRunner() {
      let cancelled = false;
      return {
        cancel() {
          cancelled = true;
        },
        start(output) {
          const assert = SELFTEST.createBrowserAssert();
          const started = performance.now();
          let index = 0;
          let passed = 0;
          let failed = 0;
          output.line(`${CONFIG.GAME_TITLE} self-test · v${CONFIG.VERSION}`);
          output.line(`Logic tests (${SELFTEST.TESTS.length}):`);
          const runSimulation = () => {
            output.line('Bot simulation: 200 games (greedy bot, 20 per level)…');
            SELFTEST.runBotSimulation(200, 7777, (step) => setTimeout(step, 0)).then((per_level) => {
              if (cancelled) return;
              let bot_errors = 0;
              let bot_wins = 0;
              per_level.forEach((entry) => {
                bot_errors += entry.errors;
                bot_wins += entry.wins;
                const sorted = entry.scores.slice().sort((a, b) => a - b);
                const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
                output.line(`  L${entry.id} ${entry.name}: ${entry.wins}/${entry.games} won, median ${median}, errors ${entry.errors}`);
              });
              const all_good = failed === 0 && bot_errors === 0;
              const seconds = ((performance.now() - started) / 1000).toFixed(1);
              output.line(`Done in ${seconds} s. Tests ${passed}/${SELFTEST.TESTS.length} passed. Bot: ${bot_wins}/200 wins, ${bot_errors} errors.`);
              output.finish(all_good, all_good ? `ALL GREEN · ${passed} tests · 200 bot games` : `RED · ${failed} failed test(s), ${bot_errors} bot error(s)`);
            });
          };
          const nextTest = () => {
            if (cancelled) return;
            if (index >= SELFTEST.TESTS.length) {
              runSimulation();
              return;
            }
            const entry = SELFTEST.TESTS[index];
            index += 1;
            SELFTEST.runTest(entry, assert).then((result) => {
              if (cancelled) return;
              if (result.passed) passed += 1;
              else failed += 1;
              output.line(`  ${result.passed ? 'PASS' : 'FAIL'} [${result.group}] ${result.name} (${result.ms} ms)`);
              if (!result.passed) output.line(`       ${result.error}`);
              setTimeout(nextTest, 0);
            });
          };
          setTimeout(nextTest, 30);
        },
      };
    }

    // ---------------------------------------------------------------- keyboard (optional, desktop)
    function onKeyDown(event) {
      if (event.target && (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA')) return;
      audio.unlock();
      const key = event.key;
      if (key === 'Escape' || key === 'Backspace') {
        event.preventDefault();
        handleBack();
        return;
      }
      if (machine !== STATE.PLAYING || ui.topModal()) {
        if ((key === 'm' || key === 'M') && !ui.topModal()) toggleSound();
        return;
      }
      if (key === 'h' || key === 'H') showHint('button');
      else if (key === 'm' || key === 'M') toggleSound();
      else if (key.indexOf('Arrow') === 0) {
        event.preventDefault();
        const board = renderer.board;
        if (keyboard_cursor < 0) keyboard_cursor = Math.floor(board.rows / 2) * board.cols + Math.floor(board.cols / 2);
        const row = Math.floor(keyboard_cursor / board.cols);
        const col = keyboard_cursor % board.cols;
        const delta = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
        const next_row = Math.max(0, Math.min(board.rows - 1, row + delta[0]));
        const next_col = Math.max(0, Math.min(board.cols - 1, col + delta[1]));
        const next = next_row * board.cols + next_col;
        if (keyboard_picked) {
          keyboard_picked = false;
          select(-1);
          requestSwap(keyboard_cursor, next);
          keyboard_cursor = next;
        } else {
          keyboard_cursor = next;
          renderer.setSelected(keyboard_cursor);
        }
      } else if (key === ' ' || key === 'Enter') {
        event.preventDefault();
        if (keyboard_cursor < 0) return;
        keyboard_picked = !keyboard_picked;
        if (keyboard_picked) select(keyboard_cursor);
        else select(-1);
      }
    }

    // ---------------------------------------------------------------- wiring
    const boardInput = SC.INPUT.createBoardInput(dom.game_canvas, renderer, {
      canInteract: () => machine === STATE.PLAYING && !ui.topModal() && !invalid_swap_playing,
      getSelected: () => selected_cell,
      select,
      requestSwap,
      activity: () => {
        renderer.markActivity();
        if (machine === STATE.PLAYING && level && level.id !== 1) ui.fadeTutorialOverlay();
        if (!(tutorial_active && level && level.id === 1)) clearHint();
      },
    });

    function wireButtons() {
      dom.btn_play.addEventListener('click', () => {
        sound('click');
        audio.unlock();
        goMap();
      });
      dom.btn_title_settings.addEventListener('click', () => {
        sound('click');
        openSettings();
      });
      dom.btn_title_help.addEventListener('click', () => {
        sound('click');
        ui.showHelp();
      });
      dom.btn_map_back.addEventListener('click', () => {
        sound('click');
        goTitle();
      });
      dom.btn_map_settings.addEventListener('click', () => {
        sound('click');
        openSettings();
      });
      dom.btn_pause.addEventListener('click', () => {
        sound('click');
        openPause();
      });
      dom.btn_hint.addEventListener('click', () => {
        renderer.markActivity();
        showHint('button');
      });
      dom.btn_sound.addEventListener('click', toggleSound);
      root.addEventListener('resize', scheduleLayout);
      root.addEventListener('orientationchange', scheduleLayout);
      root.addEventListener('sc-safe-area', scheduleLayout);
      document.addEventListener('keydown', onKeyDown);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') onAppHidden('visibility');
        else onAppVisible('visibility');
      });
      root.addEventListener('pagehide', () => onAppHidden('pagehide'));
      if (system_reduced_motion && system_reduced_motion.addEventListener) system_reduced_motion.addEventListener('change', applySettings);
      native.onBack(() => handleBack());
      native.onPause(() => onAppHidden('app-pause'));
      native.onResume(() => onAppVisible('app-resume'));
    }

    const game = {
      STATE,
      start(load_result) {
        applySettings();
        wireButtons();
        layoutNow();
        startLoop();
        if (load_result && load_result.recovered) setTimeout(() => ui.toast('Saved data was damaged, starting fresh'), 600);
        if (!save().name_asked) {
          machine = STATE.TITLE;
          ui.showScreen('title');
          ui.renderTitle('');
          ui.showNamePrompt({
            done: (name) => {
              save().player_name = STORAGE.cleanText(name, STORAGE.MAX_NAME_LENGTH);
              save().name_asked = true;
              persist();
              ui.renderTitle(save().player_name);
              audio.unlock();
              startLevel(1); // first launch goes straight into Level 1 with the tutorial
            },
          });
        } else {
          goTitle();
        }
      },
      // Introspection used by the automated tests (the coordinate helpers live in the debug-only test hook).
      get state() {
        return machine;
      },
      get level() {
        return level;
      },
      get logic() {
        return logic_state;
      },
      get selected() {
        return selected_cell;
      },
      get hintVisible() {
        return hint_visible;
      },
      get movesPlayed() {
        return moves_played;
      },
      get lifecycleLog() {
        return lifecycle_log.slice();
      },
      get photo() {
        return photo_data_url;
      },
      renderer,
      audio,
      ui,
      store,
      haptic,
      handleBack,
      openPause,
      requestSwap,
      startLevel,
      goMap,
      goTitle,
      openSettings,
      changeSetting,
      applyPhoto,
      onAppHidden,
      onAppVisible,
      layoutNow,
    };
    return game;
  }

  SC.GAME = { createGame, STATE };
})(typeof window !== 'undefined' ? window : globalThis);
