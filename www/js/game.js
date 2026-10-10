// GAME: the state machine that ties LOGIC, LEVELS, RENDER, UI, MAP, META, AUDIO, STORAGE and INPUT together.
// States: TITLE -> MAP -> INTRO -> PLAYING -> RESOLVING -> WON / LOST, plus PAUSED.
(function attachGame(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const CONFIG = SC.CONFIG;
  const LOGIC = SC.LOGIC;
  const LEVELS = SC.LEVELS;
  const STORAGE = SC.STORAGE;
  const META = SC.META;
  const SELFTEST = SC.SELFTEST;

  const STATE = Object.freeze({ BOOT: 'BOOT', TITLE: 'TITLE', MAP: 'MAP', INTRO: 'INTRO', PLAYING: 'PLAYING', RESOLVING: 'RESOLVING', PAUSED: 'PAUSED', WON: 'WON', LOST: 'LOST' });
  const HAPTIC_STYLES = { tick: 'LIGHT', medium: 'MEDIUM', heavy: 'HEAVY' };
  const VIBRATE_MS = { tick: 8, medium: 18, heavy: 32 };
  const PIP_POINTS_UNTIL_LEVEL = 5;

  function createGame(env) {
    const { dom, native, store, audio, renderer, background, ui } = env;
    let machine = STATE.BOOT;
    let paused_from = null;
    let level = null;
    let logic_state = null;
    let selected_cell = -1;
    let hint_visible = false;
    let current_hint = null;
    let tutorial_active = false;
    let opening = false; // the level opening (candies drop in, the goal ribbon) is playing: input and clock wait
    let opening_token = 0;
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
    let invalid_swap_playing = false;
    let moves_played = 0;
    let armed_booster = null;
    let booster_lesson = null; // a booster just unlocked: the pointer shows how to use it in this level
    let guide = null; // a guided tutorial in progress: { steps, index, move } (the first levels, like the original)
    let finale_skip = null; // while the Sweet Finale plays: skips straight to its end
    let continues_used = 0; // +5 Moves bought in this attempt (each one costs more)
    let announcing = false;
    let time_used_ms = 0;
    let pip_pointed = false;
    let map_status_timer = null;
    let speed_base = 1;
    const lifecycle_log = [];
    const session_attempts = {};
    const system_reduced_motion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const map = SC.MAP.createMap(dom, {
      select: (level_id) => openIntro(level_id),
      sound: (name) => sound(name),
      haptic: (kind) => haptic(kind),
      toast: (text) => ui.toast(text),
      announce: (text) => ui.announce(text),
      icon: ui.icon,
      iconUrl: (kind, size) => SC.SPRITES.iconUrl(kind, size),
      heartsOn: () => META.heartsEnabled(settings()),
      hasCrown: (level_id) => STORAGE.hasCrown(save(), level_id),
      hasMastery: (level_id) => STORAGE.hasMastery(save(), level_id),
      hasTreasure: (level_id) => META.treasureAt(level_id) && !(STORAGE.levelBest(save(), level_id).stars > 0),
    });
    const hint_scheduler = META.createHintScheduler({ set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle) }, CONFIG.AUTO_HINT_DELAYS, (source) => showHint(source));

    const save = () => store.save;
    const settings = () => store.save.settings;
    const now = () => Date.now();

    // ---------------------------------------------------------------- progression
    const isUnlocked = (id) => META.isUnlocked(save().meta, save().unlocked, id);
    const streakOn = () => isUnlocked('streak');
    const isNewLevel = (level_id) => !(STORAGE.levelBest(save(), level_id).stars > 0);

    /** { booster: unlock level } for the boosters still locked. */
    function boosterLocks() {
      const locks = {};
      STORAGE.BOOSTERS.forEach((name) => {
        if (!isUnlocked(name)) locks[name] = META.unlockOf(name).level;
      });
      return locks;
    }

    /** Shows each booster or feature reached but not announced yet, one popup at a time (boosters come with gifts). */
    async function announceUnlocks() {
      if (announcing) return;
      announcing = true;
      try {
        for (const unlock of META.pendingUnlocks(save().meta, save().unlocked)) {
          if (machine !== STATE.MAP && machine !== STATE.INTRO) break;
          META.announceUnlock(save().meta, unlock.id);
          persist();
          refreshMapStatus();
          await ui.showUnlock(unlock);
        }
      } finally {
        announcing = false;
      }
    }
    const reducedMotion = () => settings().reduced_motion || !!(system_reduced_motion && system_reduced_motion.matches);

    // ---------------------------------------------------------------- feedback helpers
    function haptic(kind) {
      if (!settings().haptics) return;
      const time = performance.now();
      if (time - last_haptic_at < 60) return;
      last_haptic_at = time;
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
      ui.setSoundButton(current.sound_on || current.music_on);
      speed_base = CONFIG.ANIMATION_SPEEDS[current.animation_speed] || 1;
      renderer.setSpeed(speed_base);
      hint_scheduler.setMode(current.auto_hint);
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
      if (key === 'unlimited_hearts') refreshMapStatus();
      clearTimeout(persist_timer);
      persist_timer = setTimeout(persist, 250);
    }

    function toggleSound() {
      const current = settings();
      const turn_on = !(current.sound_on || current.music_on);
      current.sound_on = turn_on;
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
        if (guide && guide.move && machine === STATE.PLAYING) showGuideMove();
      }
      if (dom.screen_map.classList.contains('is-active')) map.layout();
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

    /** Whether the level clock runs: only while the board is in play and nothing covers it. */
    function clockRunning() {
      return !!(logic_state && logic_state.timed && (machine === STATE.PLAYING || machine === STATE.RESOLVING) && !opening && !ui.topModal() && !app_hidden);
    }

    function timeLeftMs() {
      if (!logic_state || !logic_state.timed) return 0;
      const bonus = tracker ? tracker.time_bonus : logic_state.time_bonus;
      return Math.max(0, (logic_state.time_limit + bonus) * 1000 - time_used_ms);
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
      if (!dom.screen_map.classList.contains('is-active')) background.draw(time, delta);
      renderer.update(machine === STATE.PAUSED ? 0 : delta);
      if (clockRunning()) {
        time_used_ms += delta;
        hud_dirty = true;
        if (machine === STATE.PLAYING && timeLeftMs() <= 0) timeUp();
      }
      if (hud_dirty) flushHud();
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
      return {
        goals: state.goals, score: state.score, moves_left: state.moves_left, collected: state.collected.slice(), jelly: Uint8Array.from(state.jelly),
        jelly_total: state.jelly_total, ingredients_collected: state.ingredients_collected, order: Object.assign({}, state.order), time_bonus: state.time_bonus,
      };
    }

    const ORDER_EVENT = { frosting: 'frosting', cocoa: 'cocoa', cage: 'cage', swirl: 'swirl', gift: 'gift', mixer: 'mixer' };
    function trackEvent(event) {
      if (!tracker) return;
      if (event.type === 'swap') tracker.moves_left = event.moves_left;
      else if (event.type === 'score') tracker.score += event.points;
      else if (event.type === 'clear' && event.color >= 0) tracker.collected[event.color] += 1;
      else if (event.type === 'jelly') tracker.jelly[event.cell] = event.layers;
      else if (event.type === 'collect') tracker.ingredients_collected += 1;
      else if (event.type === 'bonus_move') tracker.moves_left = event.moves_left;
      else if (event.type === 'time_bonus') tracker.time_bonus = event.total;
      else if (event.type === 'activate' && event.kind !== 'wrapped_second' && event.kind !== 'wrapped_big_second') {
        const item = event.special === 'bomb' ? 'bomb' : event.special === 'wrapped' ? 'wrapped' : event.special === 'stripe_row' || event.special === 'stripe_col' ? 'striped' : null;
        if (item) tracker.order[item] += 1;
      } else if (ORDER_EVENT[event.type]) tracker.order[ORDER_EVENT[event.type]] += 1;
      else if ((event.type === 'popcorn' || event.type === 'chest') && event.layers <= 0) tracker.order[event.type] += 1;
      else return;
      hud_dirty = true;
    }

    let moves_shown = Infinity;
    function flushHud() {
      hud_dirty = false;
      if (!tracker || !logic_state) return;
      const view = Object.assign({}, logic_state, tracker, { cells: logic_state.cells, holes: logic_state.holes });
      const progress = LOGIC.goalProgress(view);
      ui.updateHud({ moves: tracker.moves_left, time_left: logic_state.timed ? timeLeftMs() : undefined, progress });
      // Like the original: a warning when only five moves are left and the goals are not met yet.
      const moves = tracker.moves_left;
      if ((machine === STATE.PLAYING || machine === STATE.RESOLVING) && moves === 5 && moves_shown > 5 && !progress.every((goal) => goal.done)) {
        ui.showBanner('5 moves left!', false, true);
        sound('moves_low');
      }
      moves_shown = moves;
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
          sound('praise', { depth });
          if (depth >= 4) ui.pip('cheer', 1400);
        },
        collect(event, point) {
          flyToGoal(ui.spriteUrl(event.kind === 'hazelnut' ? 'hazelnut' : 'cherry', 40), point, 'ingredients');
        },
        shuffle(reason) {
          if (reason === 'whirl') {
            ui.showBanner('Candy Whirl!', false, true);
          } else {
            ui.showBanner('No more moves, shuffling!', false, true);
            ui.announce('No more moves, shuffling');
          }
        },
        bonusTick(step) {
          sound('bonus', { step });
          haptic('light');
        },
        chargeOrigin() {
          return ui.movesCenter();
        },
        timeBonus() {
          hud_dirty = true;
        },
        fuseOut() {
          ui.pip('worried', 1600);
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
      if (level && save().meta.in_progress) {
        save().meta.in_progress = 0;
        persist();
      }
      invalid_swap_playing = false;
      renderer.cancelAll();
      renderer.setSpeed(speed_base);
      renderer.clearEffects();
      renderer.setVisible(false);
      boardInput.cancel();
      hint_scheduler.touch();
      tracker = null;
      selected_cell = -1;
      hint_visible = false;
      current_hint = null;
      tutorial_active = false;
      armed_booster = null;
      booster_lesson = null;
      guide = null;
      finale_skip = null;
      renderer.setSpotlight(null);
      ui.swipeHint(null);
      ui.pointAt(null);
      ui.tutorial(null);
      ui.hidePip();
      native.keepAwake(false);
    }

    function goTitle() {
      cancelLevel();
      ui.closeAllModals();
      map.leave();
      clearInterval(map_status_timer);
      machine = STATE.TITLE;
      level = null;
      logic_state = null;
      ui.showScreen('title');
      ui.renderTitle(save().player_name);
      background.setScenery(null);
      audio.setMusic('title');
    }

    function refreshMapStatus() {
      const meta = META.refreshHearts(save().meta, now());
      ui.setMapStatus({
        hearts: meta.hearts, next_heart_ms: META.nextHeartIn(meta, now()), unlimited: !META.heartsEnabled(settings()), gold: meta.gold,
        wheel_ready: META.canSpin(meta, now()), chest_progress: META.chestProgress(meta, STORAGE.totalStars(save())),
        wheel_locked: !isUnlocked('wheel'), chest_locked: !isUnlocked('chest'),
        daily_locked: !isUnlocked('daily'), daily_claimable: isUnlocked('daily') ? META.dailyStatus(meta, now(), save().unlocked).claimable : 0,
      });
    }

    // ---------------------------------------------------------------- Daily Challenges
    const BLOCKER_EVENTS = new Set(['frosting', 'cocoa', 'cage', 'swirl', 'gift', 'popcorn', 'chest', 'mixer']);

    /** What a move did, in Daily Challenge terms. */
    function dailyTallies(result) {
      const stats = result.stats || {};
      const created = stats.specials_created || { stripe: 0, wrapped: 0, bomb: 0 };
      const tallies = {
        striped: created.stripe || 0, wrapped: created.wrapped || 0, bomb: created.bomb || 0, combo: (stats.combos || []).length,
        candies: stats.candies_cleared || 0, cascade: stats.cascades >= 4 ? 1 : 0, jelly: 0, blockers: 0,
      };
      result.events.forEach((event) => {
        if (event.type === 'jelly') tallies.jelly += 1;
        else if (BLOCKER_EVENTS.has(event.type)) tallies.blockers += 1;
      });
      return tallies;
    }

    function noteDaily(tallies) {
      if (!isUnlocked('daily')) return;
      META.trackDaily(save().meta, now(), tallies).forEach((quest) => {
        ui.toast(`Daily Challenge done: ${quest.text}!`);
        sound('goal');
      });
    }

    function openDaily() {
      sound('tap');
      if (!isUnlocked('daily')) {
        ui.toast(`Daily Challenges unlock at level ${META.unlockOf('daily').level}`);
        return;
      }
      const status = () => META.dailyStatus(save().meta, now(), save().unlocked);
      ui.showDaily(status(), {
        status,
        claim: (index) => {
          const reward = META.claimDaily(save().meta, now(), index, save().unlocked);
          persist();
          refreshMapStatus();
          return reward;
        },
        bonus: () => {
          const reward = META.claimDailyBonus(save().meta, now(), save().unlocked);
          persist();
          refreshMapStatus();
          return reward;
        },
        closed: () => refreshMapStatus(),
      });
    }

    /** options.advance = { from, to, open_next }: after a win the marker hops to the next level and, with open_next,
     *  that level's intro opens by itself (the classic map flow). */
    function goMap(options) {
      const opts = options || {};
      cancelLevel();
      ui.closeAllModals();
      machine = STATE.MAP;
      level = null;
      logic_state = null;
      ui.showScreen('map');
      background.setScenery(null);
      audio.setMusic('map');
      refreshMapStatus();
      clearInterval(map_status_timer);
      map_status_timer = setInterval(() => {
        if (machine === STATE.MAP || machine === STATE.INTRO) refreshMapStatus();
      }, 1000);
      const advance = opts.advance || null;
      const sequence = map.render(save(), { advance });
      return sequence.then(async (finished) => {
        if (machine !== STATE.MAP || ui.topModal()) return finished;
        if (finished && advance && advance.open_next) openIntro(advance.to);
        else await announceUnlocks();
        return finished;
      });
    }

    async function openIntro(level_id) {
      const intro_level = await LEVELS.ensureLevel(level_id).catch(() => null);
      if (!intro_level) {
        ui.toast('This level is not in this version yet.');
        return;
      }
      if (machine !== STATE.MAP && machine !== STATE.INTRO) return;
      if (!META.canPlay(save(), now())) {
        ui.showHeartsEmpty({ nextHeartMs: () => META.nextHeartIn(META.refreshHearts(save().meta, now()), now()) }, {
          unlimited: () => {
            changeSetting('unlimited_hearts', true);
            ui.toast('Unlimited hearts is on');
          },
        });
        return;
      }
      await announceUnlocks();
      if (machine !== STATE.MAP && machine !== STATE.INTRO) return;
      if (ui.topModal()) return;
      machine = STATE.INTRO;
      background.setScenery(LEVELS.sceneryOf(LEVELS.episodeOf(level_id)));
      const meta = save().meta;
      const new_level = isNewLevel(level_id);
      ui.showIntro(intro_level, {
        best: STORAGE.levelBest(save(), level_id), boosters: Object.assign({}, meta.boosters), hearts_on: META.heartsEnabled(settings()),
        locks: boosterLocks(), try_booster: STORAGE.PRE_LEVEL_BOOSTERS.indexOf(meta.try_booster) >= 0 ? meta.try_booster : '',
        crown: STORAGE.hasCrown(save(), level_id), mastery: STORAGE.hasMastery(save(), level_id),
        treasure: META.treasureAt(level_id) && new_level,
        streak: streakOn() ? { on: true, count: meta.streak, bag: META.streakBag(meta.streak), new_level } : null,
      }, {
        play: (chosen) => startLevel(level_id, chosen),
        buy: (item) => buyItem(item),
        closed: () => {
          if (machine === STATE.INTRO) machine = STATE.MAP;
        },
      });
    }

    function buyItem(item) {
      return ui.confirmBuy(item, save().meta.gold).then((confirmed) => {
        if (!confirmed) return false;
        const bought = META.buy(save().meta, item);
        if (bought) {
          sound('reward');
          persist();
          refreshMapStatus();
        }
        return bought;
      });
    }

    async function startLevel(level_id, chosen_boosters) {
      const next_level = await LEVELS.ensureLevel(level_id).catch(() => null);
      if (!next_level) {
        goMap();
        return;
      }
      cancelLevel();
      ui.closeAllModals();
      map.leave();
      clearInterval(map_status_timer);
      level = next_level;
      const attempt = session_attempts[level_id] || 0;
      session_attempts[level_id] = attempt + 1;
      logic_state = LOGIC.createGame(level, { seed: level.seed + attempt * 7919 });
      const meta = save().meta;
      const boosters = {};
      Object.keys(chosen_boosters || {}).forEach((name) => {
        if (chosen_boosters[name] && isUnlocked(name) && META.useBooster(meta, name)) boosters[name] = true;
      });
      // Sweet Streak: a new level starts with the bag earned by the first-try wins in a row before it.
      const bag = streakOn() && isNewLevel(level_id) ? META.streakBag(meta.streak) : null;
      const start = Object.assign({}, boosters);
      if (bag) start.streak_bag = bag;
      if (Object.keys(start).length) logic_state = LOGIC.applyStartBoosters(logic_state, start).state;
      continues_used = 0;
      booster_lesson = null;
      if (meta.try_booster) {
        if (STORAGE.IN_LEVEL_BOOSTERS.indexOf(meta.try_booster) >= 0 && isUnlocked(meta.try_booster)) booster_lesson = meta.try_booster;
        meta.try_booster = '';
      }
      meta.in_progress = level_id;
      persist();
      time_used_ms = 0;
      pip_pointed = false;
      ui.showScreen('game');
      background.setScenery(LEVELS.sceneryOf(LEVELS.episodeOf(level_id)));
      renderer.setLevel(logic_state);
      layoutNow();
      ui.setupHud(level, logic_state);
      tracker = createTracker(logic_state);
      moves_shown = Infinity;
      renderer.setVisible(true);
      renderer.markActivity();
      machine = STATE.PLAYING;
      updateBoosterBar();
      paused_from = null;
      native.keepAwake(true);
      audio.setMusic('level');
      if (level.tutorial && !level.guide && !save().tutorials_seen[level_id]) {
        tutorial_active = true;
        ui.keepTutorial(false);
        ui.tutorial(level.tutorial);
        ui.placeTutorial(renderer.boardRect(), boardHasTrays());
      }
      const goal_text = level.goals.map((goal) => ui.goalText(goal)).join(', ');
      ui.announce(`Level ${level.id}, ${level.name}. ${level.time ? `${level.time} seconds` : `${level.moves} moves`}. Goals: ${goal_text}.`);
      playOpening(Object.keys(boosters).length > 0, !!bag);
    }

    /** The level opening: the candies drop into the board while the goal ribbon sweeps across, then play begins. */
    async function playOpening(has_boosters, has_bag) {
      // A restart or a quit during the opening starts a new one (or none): only the latest may finish it.
      opening_token += 1;
      const token = opening_token;
      opening = true;
      const ribbon_ms = ui.showGoalIntro(level.goals, { timed: !!level.time, role: level.role });
      const dropped = await renderer.playEntrance(playbackHooks());
      // Jelly levels: the jelly flashes once the candies are in, so you see at a glance where it all is.
      if (dropped && token === opening_token && level.goals.some((goal) => goal.type === 'jelly')) {
        renderer.flashJelly();
        sound('jelly');
      }
      const waited = dropped && token === opening_token ? await renderer.timeline.wait(Math.max(0, ribbon_ms - 900)) : false;
      if (token !== opening_token) return;
      opening = false;
      if (!waited || machine !== STATE.PLAYING) return;
      if (has_bag) ui.showBanner('Sweet Streak bonus!', true, true);
      else if (has_boosters) ui.showBanner('Boosters ready!', false, true);
      if (startGuide()) return;
      boardIdle();
      showBoosterLesson();
    }

    /** A booster unlocked just before this level: the hand points at its button until it is used (or a move is made). */
    function showBoosterLesson() {
      if (!booster_lesson || machine !== STATE.PLAYING || opening || (guide && guide.move)) return;
      const target = document.getElementById(`btn-booster-${booster_lesson}`);
      if (target) ui.pointAt(target, `Try your new ${META.BOOSTER_NAMES[booster_lesson]}!`);
    }

    function endBoosterLesson() {
      if (!booster_lesson) return;
      booster_lesson = null;
      ui.pointAt(null);
    }

    // ---------------------------------------------------------------- guided tutorials
    /**
     * The first time a tutorial level is played, its guide walks through it step by step like the original: the board
     * dims around the exact swap to make, a hand shows the move, and only that swap is allowed. A step whose kind of
     * move is not on the board right now is skipped; a step without a move just shows its words until the next move.
     */
    function startGuide() {
      guide = null;
      if (!level || !Array.isArray(level.guide) || !level.guide.length || save().tutorials_seen[level.id]) return false;
      guide = { steps: level.guide, index: -1, move: null };
      advanceGuide();
      return true;
    }

    function advanceGuide() {
      if (!guide) return;
      for (guide.index += 1; guide.index < guide.steps.length; guide.index += 1) {
        const step = guide.steps[guide.index];
        const move = step.find ? LOGIC.findGuideMove(logic_state, step.find, { color: step.color }) || (Number.isInteger(step.color) ? LOGIC.findGuideMove(logic_state, step.find) : null) : null;
        if (step.find && !move) continue;
        guide.move = move;
        ui.keepTutorial(true);
        ui.tutorial(step.text);
        let avoid = null;
        if (move) {
          const rows = move.cells.map((cell) => renderer.cellCenter(cell).y);
          const half = renderer.boardRect().cell / 2;
          avoid = { top: Math.min(...rows) - half, bottom: Math.max(...rows) + half };
        }
        ui.placeTutorial(renderer.boardRect(), boardHasTrays(), avoid);
        showGuideMove();
        return;
      }
      endGuide();
    }

    function showGuideMove() {
      if (!guide || !guide.move) {
        renderer.setSpotlight(null);
        ui.swipeHint(null);
        return;
      }
      const shown = LOGIC.hintFor(logic_state, guide.move);
      renderer.setSpotlight(guide.move.cells);
      ui.swipeHint(renderer.cellCenter(shown.from), renderer.cellCenter(shown.to));
    }

    function endGuide() {
      const had_guide = !!guide;
      guide = null;
      renderer.setSpotlight(null);
      ui.swipeHint(null);
      if (!had_guide) return;
      ui.keepTutorial(false);
      ui.tutorial(null);
      if (level) {
        save().tutorials_seen[level.id] = true;
        persist();
      }
      // A booster unlocked just before this level gets its own pointer once the lesson is over.
      if (machine === STATE.PLAYING && logic_state && logic_state.status === 'playing') showBoosterLesson();
    }

    // ---------------------------------------------------------------- hints
    function boardHasTrays() {
      return !!(renderer.board && Array.prototype.some.call(renderer.board.exits, (exit) => exit === 1));
    }

    function select(cell) {
      if (machine !== STATE.PLAYING) return;
      if (armed_booster === 'hammer' && cell >= 0) {
        useHammer(cell);
        return;
      }
      if (armed_booster === 'brush' && cell >= 0) {
        useBrush(cell);
        return;
      }
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

    /** The board settled and input is unlocked: the auto-hint setting decides when the hint appears. */
    function boardIdle() {
      if (machine !== STATE.PLAYING || !logic_state) return;
      hint_scheduler.idle();
    }

    function showHint(source) {
      if (machine !== STATE.PLAYING || opening || !logic_state || armed_booster) return;
      if (guide && guide.move) {
        if (source === 'button') showGuideMove();
        return;
      }
      const move = LOGIC.findHint(logic_state);
      if (!move) return;
      current_hint = move;
      hint_visible = true;
      // The shown hint names the candy that actually moves into the match (it may be either end of the swap).
      const shown = LOGIC.hintFor(logic_state, move);
      renderer.setHint(shown);
      if (level && level.id <= PIP_POINTS_UNTIL_LEVEL && !pip_pointed) {
        pip_pointed = true;
        const pip_canvas = document.getElementById('game-pip');
        const target = renderer.cellCenter(shown.from);
        const pip_rect = pip_canvas ? pip_canvas.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
        const angle = Math.atan2(target.y - (pip_rect.top + pip_rect.height / 2), target.x - (pip_rect.left + pip_rect.width / 2));
        ui.pip('pointing', 2600, angle);
      }
      if (source === 'button') {
        sound('select');
        ui.announce('Hint shown on the board');
      }
    }

    // ---------------------------------------------------------------- moves and boosters
    async function playResult(result, before) {
      machine = STATE.RESOLVING;
      clearHint();
      hint_scheduler.touch();
      select(-1);
      if (guide) {
        renderer.setSpotlight(null);
        ui.swipeHint(null);
      }
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
      renderer.syncToState(logic_state);
      tracker = createTracker(logic_state);
      flushHud();
      renderer.markActivity();
      updateBoosterBar();
      if (result.stats) noteDaily(dailyTallies(result));
      const progress = LOGIC.goalProgress(logic_state);
      ui.announce(`${logic_state.timed ? `${Math.ceil(timeLeftMs() / 1000)} seconds left` : `${logic_state.moves_left} moves left`}. ${progress.filter((goal) => goal.done).length} of ${progress.length} goals done.`);
      if (logic_state.status !== 'playing') endGuide();
      if (logic_state.status === 'won') {
        await winSequence();
      } else if (logic_state.status === 'lost') {
        await loseSequence();
      } else if (machine === STATE.PAUSED) {
        paused_from = STATE.PLAYING;
        if (guide) advanceGuide();
      } else {
        machine = STATE.PLAYING;
        if (guide) advanceGuide();
        if (logic_state.timed && timeLeftMs() <= 0) timeUp();
        else boardIdle();
      }
    }

    async function requestSwap(from_cell, to_cell) {
      if (machine !== STATE.PLAYING || !logic_state || invalid_swap_playing) return;
      renderer.markActivity();
      if (guide && guide.move) {
        // During a guided step only the swap the hand shows is allowed (either direction).
        const move = guide.move;
        const shown = (from_cell === move.from && to_cell === move.to) || (from_cell === move.to && to_cell === move.from);
        if (!shown) {
          select(-1);
          await bounceBack(from_cell, to_cell);
          showGuideMove();
          return;
        }
      }
      const before = logic_state;
      if (armed_booster === 'free_swap') {
        const result = LOGIC.applyFreeSwap(before, from_cell, to_cell);
        if (!result.valid) {
          await bounceBack(from_cell, to_cell);
          return;
        }
        consumeArmedBooster();
        moves_played += 1;
        await playResult(result, before);
        return;
      }
      const result = LOGIC.applySwap(before, from_cell, to_cell);
      if (!result.valid) {
        await bounceBack(from_cell, to_cell);
        boardIdle();
        return;
      }
      endBoosterLesson();
      moves_played += 1;
      await playResult(result, before);
    }

    async function bounceBack(from_cell, to_cell) {
      clearHint();
      haptic('tick');
      invalid_swap_playing = true;
      await renderer.playInvalidSwap(from_cell, to_cell, { sound });
      invalid_swap_playing = false;
      renderer.markActivity();
    }

    function updateBoosterBar() {
      const relayout = ui.setBoosters(save().meta.boosters, armed_booster, machine === STATE.PLAYING || machine === STATE.RESOLVING, boosterLocks());
      if (relayout && level) layoutNow();
    }

    function consumeArmedBooster() {
      if (booster_lesson === armed_booster) endBoosterLesson();
      META.useBooster(save().meta, armed_booster);
      armed_booster = null;
      persist();
      updateBoosterBar();
    }

    async function onBoosterButton(name) {
      if (machine !== STATE.PLAYING || opening || !logic_state) return;
      sound('tap');
      if (guide && guide.move) {
        ui.toast('Make the move the hand shows first!');
        return;
      }
      if (!isUnlocked(name)) {
        ui.toast(`${META.BOOSTER_NAMES[name]} unlocks at level ${META.unlockOf(name).level}`);
        return;
      }
      if (armed_booster === name) {
        armed_booster = null;
        ui.toast('Booster put away');
        updateBoosterBar();
        boardIdle();
        showBoosterLesson();
        return;
      }
      if (!(save().meta.boosters[name] > 0)) {
        const bought = await buyItem(name);
        if (!bought || machine !== STATE.PLAYING) return;
      }
      clearHint();
      hint_scheduler.touch();
      if (name === 'whirl' || name === 'party') {
        const before = logic_state;
        const result = name === 'whirl' ? LOGIC.applyWhirl(before) : LOGIC.applyParty(before);
        if (!result.valid) return;
        armed_booster = name;
        consumeArmedBooster();
        await playResult(result, before);
        return;
      }
      armed_booster = name;
      updateBoosterBar();
      const move = booster_lesson === name ? LOGIC.findHint(logic_state) : null;
      if (move) {
        // Second step of the lesson: point at a candy to use it on (the hint move's candy is always a fine target).
        const lesson = { hammer: 'Now tap a candy to smash it', brush: 'Now tap a candy to paint it' }[name] || 'Now swap it with a neighbor';
        ui.pointAt(renderer.cellCenter(move.from), lesson);
      } else {
        ui.showBanner({ hammer: 'Tap a piece to smash it', brush: 'Tap a candy to paint it striped' }[name] || 'Swap any two neighbors', false, true);
      }
      ui.announce({ hammer: 'Sweet Hammer ready: tap a piece', brush: 'Candy Brush ready: tap a candy' }[name] || 'Free Swap ready: swap any two neighboring candies');
    }

    async function useBrush(cell) {
      const before = logic_state;
      const result = LOGIC.applyBrush(before, cell);
      if (!result.valid) {
        ui.toast('The brush only paints plain candies');
        return;
      }
      consumeArmedBooster();
      await playResult(result, before);
    }

    async function useHammer(cell) {
      const before = logic_state;
      const result = LOGIC.applyHammer(before, cell);
      if (!result.valid) {
        ui.toast('The hammer cannot hit that');
        return;
      }
      consumeArmedBooster();
      await playResult(result, before);
    }

    function timeUp() {
      if (machine !== STATE.PLAYING || !logic_state || !logic_state.timed) return;
      logic_state = LOGIC.expireTime(logic_state);
      if (logic_state.status === 'won') winSequence();
      else if (logic_state.status === 'lost') {
        ui.showBanner("Time's up!", false, true);
        loseSequence();
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
      clearHint();
      hint_scheduler.touch();
      const level_at_start = level;
      // Moves left when the goals are met (the Sweet Finale spends them): 5 or more on a first try is Sweet Mastery.
      const moves_left_at_win = Number.isFinite(logic_state.moves_left) ? logic_state.moves_left : 0;
      sound('win');
      haptic('heavy');
      renderer.confetti(root.innerWidth);
      ui.showBanner(level.role === 'superhard' ? 'Super hard beaten!' : level.role === 'hard' ? 'Hard level beaten!' : 'Sweet Victory!', true);
      ui.pip('cheer', 2600);
      if (!(await renderer.timeline.wait(900)) || level !== level_at_start) return;
      const seconds_left = logic_state.timed ? Math.floor(timeLeftMs() / 1000) : 0;
      const specials_waiting = logic_state.cells.some((piece) => piece && piece.kind === 'candy' && piece.special && piece.special !== 'none');
      if ((logic_state.moves_left > 0 && Number.isFinite(logic_state.moves_left)) || seconds_left > 0 || specials_waiting) {
        // Sweet Finale, like the original's end-of-level party: the specials on the board go off, then each leftover
        // move flies out of the moves counter and charges a candy into a striped candy, and they all fire. It plays at
        // a pace you can enjoy (a little brisker with lots of moves); a tap anywhere fast-forwards it.
        ui.showBanner('Sweet Finale!', true);
        sound('finale');
        ui.pip('cheer', 1800);
        if (!(await renderer.timeline.wait(950)) || level !== level_at_start) return;
        const bonus = LOGIC.applyEndBonus(logic_state, { seconds_left });
        tracker = createTracker(logic_state);
        const strikes = (bonus.events.find((event) => event.type === 'end') || {}).bonus_moves || 0;
        renderer.setSpeed(speed_base * (strikes > 15 ? 1.45 : strikes > 8 ? 1.25 : 1.1));
        // A tap fast-forwards the Finale; a second tap (or Back) skips straight to its end.
        let skipNow = null;
        const skipped = new Promise((resolve) => {
          skipNow = () => resolve('skip');
        });
        let taps = 0;
        const onTap = () => {
          taps += 1;
          if (taps === 1) renderer.setSpeed(speed_base * 6);
          else skipNow();
        };
        finale_skip = skipNow;
        dom.app.addEventListener('pointerdown', onTap);
        const outcome = await Promise.race([renderer.playEvents(bonus.events, playbackHooks()), skipped]);
        dom.app.removeEventListener('pointerdown', onTap);
        finale_skip = null;
        renderer.setSpeed(speed_base);
        if (level !== level_at_start) return;
        if (outcome === 'skip') renderer.cancelAll();
        else if (!outcome) return;
        logic_state = bonus.state;
        renderer.syncToState(logic_state);
        tracker = createTracker(logic_state);
        flushHud();
      }
      // Like the original today, meeting the goals is worth all three stars; the score stays behind the scenes.
      const stars = 3;
      const previous = STORAGE.levelBest(save(), level.id);
      const outcome = STORAGE.recordResult(save(), level.id, { won: true, score: logic_state.score, stars, moves_left: moves_left_at_win });
      const streak_on = streakOn();
      const rewards = META.recordOutcome(save(), {
        won: true, new_stars: Math.max(0, stars - previous.stars), crown: outcome.crown, mastery: outcome.mastery, new_level: outcome.new_level,
        streak_on, role: level.role, level_id: level.id,
      }, STORAGE.totalStars(save()));
      save().meta.in_progress = 0;
      save().tutorials_seen[level.id] = true;
      noteDaily({ win: 1, first_try: outcome.crown ? 1 : 0 });
      persist();
      ui.announce(`Level complete! ${outcome.mastery ? 'Sweet Mastery: first try with moves to spare!' : outcome.crown ? 'Gold Crown: won on the first try!' : ''}`);
      const finished_level = level;
      const has_next = finished_level.id < LEVELS.shippedCount();
      // The last level of an episode, won for the first time: the episode celebration comes before the map.
      const episode = LEVELS.episodeOf(finished_level.id);
      const finale = finished_level.id === LEVELS.episodeRange(episode).last && outcome.new_level && episode > save().meta.episodes_claimed;
      const afterWin = (then) => (finale ? celebrateEpisode(episode).then(then) : then());
      ui.showWin({
        stars, player_name: save().player_name, win_message: settings().win_message, has_next, rewards, role: level.role,
        crown: outcome.crown, mastery: outcome.mastery, streak: rewards.streak, streak_on: streak_on && outcome.new_level,
      }, {
        next: () => afterWin(() => goMap({ advance: { from: finished_level.id, to: finished_level.id + 1, open_next: true } })),
        replay: () => afterWin(() => openIntroFrom(finished_level.id)),
        map: () => afterWin(() => goMap(has_next ? { advance: { from: finished_level.id, to: finished_level.id + 1, open_next: false } } : {})),
      });
    }

    /** The episode's completion reward and its celebration popup (once per episode). */
    function celebrateEpisode(episode) {
      const reward = META.claimEpisode(save().meta, episode, save().unlocked);
      persist();
      if (!reward) return Promise.resolve();
      ui.closeAllModals();
      const range = LEVELS.episodeRange(episode);
      let stars = 0;
      let crowns = 0;
      for (let level_id = range.first; level_id <= range.last; level_id += 1) {
        stars += STORAGE.levelBest(save(), level_id).stars;
        crowns += STORAGE.hasCrown(save(), level_id) ? 1 : 0;
      }
      const levels = range.last - range.first + 1;
      const next = range.last < LEVELS.shippedCount() ? { episode: episode + 1, name: LEVELS.episodeName(episode + 1) } : null;
      ui.announce(`Episode ${episode} complete! ${reward.gold} Gold Drops${reward.booster ? ` and a ${META.BOOSTER_NAMES[reward.booster]}` : ''}.`);
      return ui.showEpisodeComplete({ episode, name: LEVELS.episodeName(episode), stars, max_stars: levels * 3, crowns, levels, reward, next });
    }

    function openIntroFrom(level_id) {
      goMap().then(() => openIntro(level_id));
    }

    async function loseSequence() {
      if (machine === STATE.PAUSED) {
        paused_from = STATE.LOST;
        if (!(await waitWhilePaused())) return;
      }
      machine = STATE.LOST;
      clearHint();
      hint_scheduler.touch();
      const level_at_start = level;
      sound('lose');
      ui.pip('worried', 1800);
      // Like the classic games: the reason pops over the board first, then the "keep going?" popup opens.
      const reason = logic_state.loss_reason;
      ui.showBanner(reason === 'time' ? "Time's up!" : reason === 'fuse' ? 'Boom!' : 'Out of moves!', false, true);
      if (!(await renderer.timeline.wait(1250)) || level !== level_at_start) return;
      showLoseModal();
    }

    function showLoseModal() {
      const lost_level = level;
      const reason = logic_state.loss_reason;
      const can_continue = reason === 'moves' || reason === 'time';
      ui.announce(reason === 'time' ? "Time's up." : reason === 'fuse' ? 'A Fuse Candy went off.' : 'Out of moves.');
      const streak_at_risk = streakOn() && isNewLevel(lost_level.id) ? save().meta.streak : 0;
      const giveUp = () => {
        const outcome = STORAGE.recordResult(save(), lost_level.id, { won: false, score: logic_state.score, stars: 0 });
        const result = META.recordOutcome(save(), { won: false, new_level: outcome.new_level, streak_on: streakOn() }, STORAGE.totalStars(save()));
        if (result.streak_lost) ui.toast(`Your Sweet Streak of ${result.streak_lost} ended`);
        if (META.heartsEnabled(settings())) ui.heartBreak();
        META.spendHeart(save(), now());
        save().meta.in_progress = 0;
        persist();
      };
      ui.showLose({
        progress: LOGIC.goalProgress(logic_state), goals: lost_level.goals, player_name: save().player_name, reason, timed: logic_state.timed,
        can_continue, price: META.continuePrice(continues_used), gold: save().meta.gold, streak_at_risk,
      }, {
        retry: () => {
          giveUp();
          if (!META.canPlay(save(), now())) {
            goMap();
            return;
          }
          startLevel(lost_level.id);
        },
        map: () => {
          giveUp();
          goMap();
        },
        plusFive: () => {
          const price = META.continuePrice(continues_used);
          if (save().meta.gold < price) {
            ui.toast('Not enough Gold Drops');
            return;
          }
          save().meta.gold -= price;
          continues_used += 1;
          persist();
          ui.closeAllModals();
          logic_state = LOGIC.addMoves(logic_state, 5);
          if (logic_state.timed) time_used_ms = Math.max(0, time_used_ms);
          tracker = createTracker(logic_state);
          flushHud();
          machine = STATE.PLAYING;
          sound('reward');
          ui.showBanner(logic_state.timed ? '+15 seconds!' : '+5 Moves!', false, true);
          boardIdle();
        },
      });
    }

    // ---------------------------------------------------------------- pause, back, exit
    function openPause() {
      if (machine !== STATE.PLAYING && machine !== STATE.RESOLVING) return;
      paused_from = machine;
      machine = STATE.PAUSED;
      boardInput.cancel();
      hint_scheduler.touch();
      native.keepAwake(false);
      ui.pointAt(null);
      ui.swipeHint(null);
      const heart_note = META.heartsEnabled(settings()) ? ' You will lose a heart.' : '';
      const streak = streakOn() && isNewLevel(level.id) ? save().meta.streak : 0;
      const streak_note = streak > 0 ? ` Your Sweet Streak of ${streak} will end.` : '';
      // Restarting or quitting counts as a lost attempt: no Gold Crown on this level, and the streak ends.
      const abandonAttempt = () => {
        const outcome = STORAGE.recordResult(save(), level.id, { won: false, score: logic_state ? logic_state.score : 0, stars: 0 });
        META.recordOutcome(save(), { won: false, new_level: outcome.new_level, streak_on: streakOn() }, STORAGE.totalStars(save()));
        META.spendHeart(save(), now());
        save().meta.in_progress = 0;
      };
      ui.showPause({
        resume: resumeFromPause,
        restart: () => {
          ui.confirm({ id: 'confirm-restart', title: 'Restart level?', text: `Your progress on this attempt will be lost.${heart_note}${streak_note}`, yes: 'Restart', no: 'Keep playing' }).then((confirmed) => {
            if (!confirmed) return;
            const restart_id = level.id;
            abandonAttempt();
            persist();
            if (!META.canPlay(save(), now())) goMap();
            else startLevel(restart_id);
          });
        },
        settings: () => openSettings(),
        quit: () => {
          ui.confirm({ id: 'confirm-quit', title: streak ? "Don't give up!" : 'Quit to map?', text: `This attempt will not be saved.${heart_note}${streak_note}`, yes: 'Quit', no: 'Stay' }).then((confirmed) => {
            if (!confirmed) return;
            abandonAttempt();
            persist();
            goMap();
          });
        },
        closed: () => {},
      });
    }

    function resumeFromPause() {
      if (machine !== STATE.PAUSED) return;
      machine = paused_from || STATE.PLAYING;
      paused_from = null;
      native.keepAwake(true);
      renderer.markActivity();
      if (machine === STATE.PLAYING) {
        boardIdle();
        if (guide && guide.move) showGuideMove();
        else showBoosterLesson();
      }
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
      if (armed_booster && machine === STATE.PLAYING) {
        armed_booster = null;
        updateBoosterBar();
        return 'booster';
      }
      if (machine === STATE.PLAYING || machine === STATE.RESOLVING) {
        openPause();
        return 'pause';
      }
      if (machine === STATE.WON && finale_skip) {
        finale_skip();
        return 'skip-finale';
      }
      if (machine === STATE.MAP || machine === STATE.INTRO) {
        goTitle();
        return 'title';
      }
      if (machine === STATE.TITLE) {
        confirmExit();
        return 'exit-confirm';
      }
      return 'ignored';
    }

    function openSettings() {
      ui.showSettings(settings(), { name: save().player_name, photo: photo_data_url }, {
        change: changeSetting,
        pickPhoto,
        removePhoto,
        soundCheck: () => {
          audio.unlock();
          audio.soundCheck();
        },
        selfTest: () => ui.showSelfTest(createSelfTestRunner()),
        help: () => ui.showHelp(),
        reset: () => {
          ui.confirm({ id: 'confirm-reset-1', title: 'Reset progress?', text: 'Stars, best scores, boosters and unlocked levels will be erased.', yes: 'Reset', no: 'Cancel', danger: true }).then((first) => {
            if (!first) return;
            ui.confirm({ id: 'confirm-reset-2', title: 'Are you sure?', text: 'This cannot be undone.', yes: 'Erase everything', no: 'Keep my progress', danger: true }).then((second) => {
              if (!second) return;
              store.resetProgress().then(() => {
                ui.toast('Progress reset');
                if (machine === STATE.MAP) goMap();
              });
            });
          });
        },
        closed: () => {},
      });
    }

    // ---------------------------------------------------------------- map extras
    function openWheel() {
      sound('tap');
      if (!isUnlocked('wheel')) {
        ui.toast(`The Daily Wheel unlocks at level ${META.unlockOf('wheel').level}`);
        return;
      }
      ui.showWheel({ can_spin: META.canSpin(save().meta, now()) }, {
        spin: () => {
          const outcome = META.spinWheel(save().meta, now());
          persist();
          return outcome;
        },
        done: () => refreshMapStatus(),
      });
    }

    function openChest() {
      sound('tap');
      if (!isUnlocked('chest')) {
        ui.toast(`The Star Chest unlocks at level ${META.unlockOf('chest').level}`);
        return;
      }
      const total = STORAGE.totalStars(save());
      if (!META.chestReady(save().meta, total)) {
        ui.toast(`Star Chest: ${META.chestProgress(save().meta, total)} of ${META.CHEST_STARS} stars. Earn stars to open it!`);
        return;
      }
      const prize = META.openChest(save().meta, total, now());
      persist();
      refreshMapStatus();
      ui.showReward('Star Chest!', `You found ${prize.label}!`, 'cheer');
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
      if (machine === STATE.MAP) refreshMapStatus();
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
            output.line('Bot simulation: 200 games (greedy bot over every shipped level)…');
            SELFTEST.runBotSimulation(200, 7777, (step) => setTimeout(step, 0)).then((per_level) => {
              if (cancelled) return;
              let bot_errors = 0;
              let bot_wins = 0;
              per_level.forEach((entry) => {
                bot_errors += entry.errors;
                bot_wins += entry.wins;
                if (entry.errors) output.line(`  L${entry.id}: ${entry.errors} errors`);
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
          output.line('Loading level packs…');
          SELFTEST.prepare().then(() => setTimeout(nextTest, 30), (error) => output.finish(false, `RED · could not load levels: ${error}`));
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
      if (key === 'h' || key === 'H') hint_scheduler.button();
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
      canInteract: () => machine === STATE.PLAYING && !opening && !ui.topModal() && !invalid_swap_playing,
      getSelected: () => selected_cell,
      select,
      requestSwap,
      activity: () => {
        renderer.markActivity();
        hint_scheduler.touch();
        if (machine === STATE.PLAYING) ui.fadeTutorialOverlay();
        clearHint();
      },
    });

    function wireButtons() {
      const by_id = (id) => document.getElementById(id);
      dom.btn_play.addEventListener('click', () => {
        sound('tap');
        audio.unlock();
        goMap();
      });
      dom.btn_title_settings.addEventListener('click', () => {
        sound('tap');
        openSettings();
      });
      dom.btn_title_help.addEventListener('click', () => {
        sound('tap');
        ui.showHelp();
      });
      dom.btn_map_back.addEventListener('click', () => {
        sound('tap');
        goTitle();
      });
      dom.btn_map_settings.addEventListener('click', () => {
        sound('tap');
        openSettings();
      });
      by_id('btn-map-wheel').addEventListener('click', openWheel);
      by_id('btn-map-daily').addEventListener('click', openDaily);
      by_id('btn-map-chest').addEventListener('click', openChest);
      by_id('btn-map-mine').addEventListener('click', () => {
        sound('tap');
        map.jumpToMine();
      });
      by_id('btn-map-goto').addEventListener('click', () => {
        sound('tap');
        ui.showGoTo(map.lastLevel, { go: (level_number) => map.jumpTo(level_number, true) });
      });
      by_id('map-hearts').addEventListener('click', () => {
        sound('tap');
        const meta = META.refreshHearts(save().meta, now());
        if (!META.heartsEnabled(settings())) ui.toast('Unlimited hearts is on (Settings)');
        else ui.toast(meta.hearts >= META.MAX_HEARTS ? 'Hearts are full!' : `${meta.hearts} hearts. The next one arrives in ${ui.formatClock(META.nextHeartIn(meta, now()))}.`);
      });
      by_id('map-gold').addEventListener('click', () => {
        sound('tap');
        ui.toast(`${save().meta.gold} Gold Drops. Earn more by winning levels, collecting stars and spinning the Daily Wheel.`);
      });
      dom.btn_pause.addEventListener('click', () => {
        sound('tap');
        openPause();
      });
      dom.btn_hint.addEventListener('click', () => {
        renderer.markActivity();
        hint_scheduler.button();
      });
      document.querySelectorAll('.booster').forEach((booster_button) => {
        booster_button.addEventListener('click', () => onBoosterButton(booster_button.dataset.booster));
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
        // A level that was in progress when the app was killed restarts from its intro, without costing a heart.
        const interrupted = save().meta.in_progress;
        if (interrupted) {
          save().meta.in_progress = 0;
          persist();
        }
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
              startLevel(1); // first launch goes straight into Level 1 and its guided lesson
            },
          });
        } else if (interrupted) {
          goMap().then(() => openIntro(interrupted));
        } else {
          goTitle();
        }
      },
      // Introspection used by the automated tests (the coordinate helpers live in the debug-only test hook).
      get state() {
        // While the opening plays the level is not yet accepting moves.
        return opening && machine === STATE.PLAYING ? 'STARTING' : machine;
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
      /** The swap the guided tutorial's hand shows right now (null when no guided step is waiting). */
      get guideMove() {
        return guide && guide.move ? { from: guide.move.from, to: guide.move.to } : null;
      },
      get hintVisible() {
        return hint_visible;
      },
      get currentHint() {
        return current_hint;
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
      get timeLeftMs() {
        return timeLeftMs();
      },
      get armedBooster() {
        return armed_booster;
      },
      map,
      renderer,
      audio,
      ui,
      store,
      haptic,
      handleBack,
      openPause,
      requestSwap,
      startLevel,
      openIntro,
      goMap,
      goTitle,
      openSettings,
      changeSetting,
      applyPhoto,
      onAppHidden,
      onAppVisible,
      layoutNow,
      onBoosterButton,
    };
    return game;
  }

  SC.GAME = { createGame, STATE };
})(typeof window !== 'undefined' ? window : globalThis);
