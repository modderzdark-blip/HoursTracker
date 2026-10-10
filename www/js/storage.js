// STORAGE: versioned save schema with defensive parsing, corruption fallback and migration.
// Backends (picked at runtime): Capacitor Preferences on Android, localStorage in a browser, in-memory as a last resort.
// Everything stays on the device; nothing is ever uploaded.
//
// Save v4 is built for 20,000+ levels: per-level progress is packed (2-bit stars, varint best score / 10) into one
// base64 string, so a save with 20,000 completed levels stays well under 100 KB and parses in a few milliseconds.
// Save v5 adds two bitsets (levels ever tried, Gold Crowns for first-try wins) and the progression bookkeeping: which
// boosters and features have been unlocked and announced, the booster to try next, and episode rewards claimed.
(function attachStorage(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const SAVE_KEY = 'sweet_cascade_save';
  const PHOTO_KEY = 'sweet_cascade_photo';
  const SAVE_VERSION = 5;
  const MAX_LEVEL = 99999;
  const THEMES = ['gummy', 'hard', 'sprinkle'];
  const ACCENTS = ['bubblegum', 'sunset', 'ocean', 'mint', 'grape', 'cherry', 'gold', 'midnight'];
  const AUTO_HINT = ['instant', '3s', '8s', 'off'];
  const ANIMATION_SPEEDS = ['normal', 'snappy', 'fast'];
  const IN_LEVEL_BOOSTERS = ['hammer', 'free_swap', 'whirl', 'brush', 'party'];
  const PRE_LEVEL_BOOSTERS = ['lucky', 'rainbow', 'head_start'];
  const BOOSTERS = IN_LEVEL_BOOSTERS.concat(PRE_LEVEL_BOOSTERS);
  const MAX_HEARTS = 5;
  const MAX_NAME_LENGTH = 16;
  const MAX_MESSAGE_LENGTH = 80;
  // Everything a v4 (or older) save already had from the start: those players keep it unlocked without a new popup.
  const LEGACY_UNLOCKS = Object.freeze(['hammer', 'free_swap', 'whirl', 'lucky', 'rainbow', 'head_start', 'wheel', 'chest']);
  const UNLOCK_IDS = Object.freeze(LEGACY_UNLOCKS.concat(['streak', 'brush', 'party']));

  function defaultSettings() {
    return {
      sound_on: true,
      music_on: true,
      master_volume: 0.7,
      effects_volume: 0.6,
      music_volume: 0.35,
      soft_sounds: true,
      comfort_done: false, // the first-launch comfort slider has been shown
      haptics: true,
      reduced_motion: false,
      animation_speed: 'snappy',
      auto_hint: 'instant',
      unlimited_hearts: false,
      colorblind: false,
      theme: 'gummy',
      accent: 'bubblegum',
      photo_brightness: 0.75,
      win_message: '',
    };
  }

  function defaultMeta() {
    // New players start with no boosters: each one unlocks at its level with a few free (META.UNLOCKS).
    const boosters = {};
    BOOSTERS.forEach((booster) => { boosters[booster] = 0; });
    return {
      hearts: MAX_HEARTS,
      hearts_clock: 0, // when the oldest missing heart started refilling (ms since epoch)
      last_seen: 0, // the latest clock reading ever seen (clock-tamper guard)
      gold: 100,
      boosters,
      wheel_day: '', // local date of the last Daily Wheel spin (YYYY-MM-DD)
      streak: 0, // Sweet Streak: new levels won on the first try in a row
      chest_claimed: 0, // total stars when the Star Chest was last opened
      announced: [], // unlocks (boosters and features) already announced, and so usable
      try_booster: '', // a booster just unlocked: the next level points at it once
      episodes_claimed: 0, // episodes whose completion reward has been given
      in_progress: 0, // the level being played (restarted for free after the app was killed)
      total_attempts: 0,
      total_wins: 0,
    };
  }

  function defaultSave() {
    return {
      version: SAVE_VERSION,
      player_name: '',
      name_asked: false,
      unlocked: 1,
      progress: { stars: [], scores: [] }, // index = level - 1; scores are best scores rounded down to tens
      tried: [], // bitset bytes: levels with at least one finished attempt
      crowns: [], // bitset bytes: Gold Crowns (won on the very first attempt)
      mastered: [], // bitset bytes: Sweet Mastery (a Gold Crown with 5 or more moves left)
      tutorials_seen: {},
      settings: defaultSettings(),
      meta: defaultMeta(),
    };
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = typeof value === 'number' && isFinite(value) ? value : fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function clampInteger(value, minimum, maximum, fallback) {
    return Math.floor(clampNumber(value, minimum, maximum, fallback));
  }

  function cleanText(value, max_length) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max_length);
  }

  function pickOne(value, options, fallback) {
    return options.indexOf(value) >= 0 ? value : fallback;
  }

  function sanitizeSettings(raw_settings) {
    const defaults = defaultSettings();
    const raw = raw_settings && typeof raw_settings === 'object' ? raw_settings : {};
    const flag = (key) => (typeof raw[key] === 'boolean' ? raw[key] : defaults[key]);
    return {
      sound_on: flag('sound_on'),
      music_on: flag('music_on'),
      master_volume: clampNumber(raw.master_volume, 0, 1, defaults.master_volume),
      effects_volume: clampNumber(raw.effects_volume, 0, 1, defaults.effects_volume),
      music_volume: clampNumber(raw.music_volume, 0, 1, defaults.music_volume),
      soft_sounds: flag('soft_sounds'),
      comfort_done: flag('comfort_done'),
      haptics: flag('haptics'),
      reduced_motion: flag('reduced_motion'),
      animation_speed: pickOne(raw.animation_speed, ANIMATION_SPEEDS, defaults.animation_speed),
      auto_hint: pickOne(raw.auto_hint, AUTO_HINT, defaults.auto_hint),
      unlimited_hearts: flag('unlimited_hearts'),
      colorblind: flag('colorblind'),
      theme: pickOne(raw.theme, THEMES, defaults.theme),
      accent: pickOne(raw.accent, ACCENTS, defaults.accent),
      photo_brightness: clampNumber(raw.photo_brightness, 0.2, 1, defaults.photo_brightness),
      win_message: cleanText(raw.win_message, MAX_MESSAGE_LENGTH),
    };
  }

  function sanitizeMeta(raw_meta) {
    const defaults = defaultMeta();
    const raw = raw_meta && typeof raw_meta === 'object' ? raw_meta : {};
    const raw_boosters = raw.boosters && typeof raw.boosters === 'object' ? raw.boosters : {};
    const boosters = {};
    BOOSTERS.forEach((booster) => { boosters[booster] = clampInteger(raw_boosters[booster], 0, 999, defaults.boosters[booster]); });
    return {
      hearts: clampInteger(raw.hearts, 0, MAX_HEARTS, defaults.hearts),
      hearts_clock: clampNumber(raw.hearts_clock, 0, 1e15, 0),
      last_seen: clampNumber(raw.last_seen, 0, 1e15, 0),
      gold: clampInteger(raw.gold, 0, 1e9, defaults.gold),
      boosters,
      wheel_day: typeof raw.wheel_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.wheel_day) ? raw.wheel_day : '',
      streak: clampInteger(raw.streak, 0, 1e6, 0),
      chest_claimed: clampInteger(raw.chest_claimed, 0, 3 * MAX_LEVEL, 0),
      in_progress: clampInteger(raw.in_progress, 0, MAX_LEVEL, 0),
      total_attempts: clampInteger(raw.total_attempts, 0, 1e9, 0),
      total_wins: clampInteger(raw.total_wins, 0, 1e9, 0),
      announced: Array.isArray(raw.announced) ? UNLOCK_IDS.filter((id) => raw.announced.indexOf(id) >= 0) : [],
      try_booster: BOOSTERS.indexOf(raw.try_booster) >= 0 ? raw.try_booster : '',
      episodes_claimed: clampInteger(raw.episodes_claimed, 0, MAX_LEVEL, 0),
    };
  }

  // ------------------------------------------------------------------ level bitsets (tried, crowns)

  function bitGet(bytes, level_id) {
    const index = level_id - 1;
    return index >= 0 && ((bytes[index >> 3] || 0) >> (index & 7)) & 1 ? 1 : 0;
  }

  function bitSet(bytes, level_id) {
    const index = level_id - 1;
    if (index < 0 || index >= MAX_LEVEL) return;
    while (bytes.length <= index >> 3) bytes.push(0);
    bytes[index >> 3] |= 1 << (index & 7);
  }

  function bitCount(bytes) {
    let total = 0;
    for (let index = 0; index < bytes.length; index += 1) {
      let byte = bytes[index];
      while (byte) {
        total += byte & 1;
        byte >>= 1;
      }
    }
    return total;
  }

  function sanitizeBits(raw) {
    const limit = Math.ceil(MAX_LEVEL / 8);
    if (typeof raw === 'string') {
      try {
        return raw ? Array.from(base64ToBytes(raw).subarray(0, limit)) : [];
      } catch (decode_error) {
        return [];
      }
    }
    if (Array.isArray(raw)) return raw.slice(0, limit).map((byte) => clampInteger(byte, 0, 255, 0));
    return [];
  }

  // ------------------------------------------------------------------ packed progress

  const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const BASE64_INDEX = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let index = 0; index < BASE64.length; index += 1) table[BASE64.charCodeAt(index)] = index;
    return table;
  })();

  function bytesToBase64(bytes) {
    const parts = [];
    let chunk = '';
    for (let index = 0; index < bytes.length; index += 3) {
      const first = bytes[index];
      const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
      const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
      const triple = (first << 16) | (second << 8) | third;
      chunk += BASE64[(triple >> 18) & 63] + BASE64[(triple >> 12) & 63] +
        (index + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '=') + (index + 2 < bytes.length ? BASE64[triple & 63] : '=');
      if (chunk.length >= 4096) {
        parts.push(chunk);
        chunk = '';
      }
    }
    parts.push(chunk);
    return parts.join('');
  }

  function base64ToBytes(text) {
    const clean = text.replace(/=+$/, '');
    if (/[^A-Za-z0-9+/]/.test(clean)) throw new Error('bad base64');
    const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let output = 0;
    const length = clean.length;
    for (let index = 0; index < length; index += 4) {
      const triple = (BASE64_INDEX[clean.charCodeAt(index)] << 18) |
        ((index + 1 < length ? BASE64_INDEX[clean.charCodeAt(index + 1)] : 0) << 12) |
        ((index + 2 < length ? BASE64_INDEX[clean.charCodeAt(index + 2)] : 0) << 6) |
        (index + 3 < length ? BASE64_INDEX[clean.charCodeAt(index + 3)] : 0);
      if (output < bytes.length) bytes[output++] = (triple >> 16) & 255;
      if (output < bytes.length) bytes[output++] = (triple >> 8) & 255;
      if (output < bytes.length) bytes[output++] = triple & 255;
    }
    return bytes;
  }

  /** Packs progress: varint(count), 2-bit stars (4 levels per byte), then varint(best score / 10) per level. */
  function encodeProgress(progress) {
    const count = progress.stars.length;
    const bytes = [];
    const pushVarint = (value) => {
      let rest = Math.max(0, Math.floor(value));
      while (rest >= 128) {
        bytes.push((rest % 128) | 128);
        rest = Math.floor(rest / 128);
      }
      bytes.push(rest);
    };
    pushVarint(count);
    for (let index = 0; index < count; index += 4) {
      let packed = 0;
      for (let offset = 0; offset < 4; offset += 1) packed |= ((progress.stars[index + offset] || 0) & 3) << (offset * 2);
      bytes.push(packed);
    }
    for (let index = 0; index < count; index += 1) pushVarint((progress.scores[index] || 0) / 10);
    return bytesToBase64(bytes);
  }

  function decodeProgress(text) {
    const bytes = base64ToBytes(text);
    let cursor = 0;
    const readVarint = () => {
      let value = 0;
      let scale = 1;
      for (let guard = 0; guard < 6; guard += 1) {
        if (cursor >= bytes.length) throw new Error('truncated progress');
        const byte = bytes[cursor++];
        value += (byte & 127) * scale;
        if (byte < 128) return value;
        scale *= 128;
      }
      throw new Error('bad varint');
    };
    const count = readVarint();
    if (count > MAX_LEVEL) throw new Error('too many levels');
    const stars = [];
    for (let index = 0; index < count; index += 4) {
      if (cursor >= bytes.length) throw new Error('truncated stars');
      const packed = bytes[cursor++];
      for (let offset = 0; offset < 4 && index + offset < count; offset += 1) stars.push((packed >> (offset * 2)) & 3);
    }
    const scores = [];
    for (let index = 0; index < count; index += 1) scores.push(Math.min(1e9, readVarint() * 10));
    // Already in range (2-bit stars, non-negative whole tens, at most MAX_LEVEL levels): needs no sanitizing.
    return { stars, scores };
  }

  function sanitizeProgress(raw_progress) {
    const progress = { stars: [], scores: [] };
    if (!raw_progress || !Array.isArray(raw_progress.stars)) return progress;
    const count = Math.min(MAX_LEVEL, raw_progress.stars.length);
    for (let index = 0; index < count; index += 1) {
      progress.stars.push(clampInteger(raw_progress.stars[index], 0, 3, 0));
      progress.scores.push(Math.floor(clampNumber(Array.isArray(raw_progress.scores) ? raw_progress.scores[index] : 0, 0, 1e9, 0) / 10) * 10);
    }
    return progress;
  }

  /** v1-v3 kept a {levelId: {best_score, best_stars, attempts, wins}} map. */
  function progressFromLevelMap(raw_levels) {
    const progress = { stars: [], scores: [] };
    if (!raw_levels || typeof raw_levels !== 'object') return progress;
    Object.keys(raw_levels).forEach((level_key) => {
      const level_id = parseInt(level_key, 10);
      const record = raw_levels[level_key];
      if (!Number.isInteger(level_id) || level_id < 1 || level_id > MAX_LEVEL || !record || typeof record !== 'object') return;
      while (progress.stars.length < level_id) {
        progress.stars.push(0);
        progress.scores.push(0);
      }
      progress.stars[level_id - 1] = clampInteger(record.best_stars, 0, 3, 0);
      progress.scores[level_id - 1] = Math.floor(clampNumber(record.best_score, 0, 1e9, 0) / 10) * 10;
    });
    return progress;
  }

  /** v1 (development builds) stored {version:1, sound, music, unlocked, best:{id:{score,stars}}, name}. */
  function migrateV1(raw_save) {
    const best = raw_save.best && typeof raw_save.best === 'object' ? raw_save.best : {};
    const levels = {};
    Object.keys(best).forEach((level_key) => {
      const entry = best[level_key] || {};
      levels[level_key] = { best_score: entry.score, best_stars: entry.stars };
    });
    const name = cleanText(raw_save.name, MAX_NAME_LENGTH);
    return { version: 1, player_name: name, name_asked: name.length > 0, unlocked: raw_save.unlocked, levels, settings: { sfx_on: raw_save.sound !== false, music_on: raw_save.music !== false } };
  }

  /** Normalizes any stored object (v1-v4) into a valid current-version save. Unknown or missing keys fall back to defaults. */
  function normalizeSave(raw_save) {
    let source = raw_save && typeof raw_save === 'object' && !Array.isArray(raw_save) ? raw_save : {};
    if (source.version === 1) source = migrateV1(source);
    const legacy = source.version === undefined || source.version < 4;
    const save = defaultSave();
    save.player_name = cleanText(source.player_name, MAX_NAME_LENGTH);
    save.name_asked = typeof source.name_asked === 'boolean' ? source.name_asked : save.player_name.length > 0;
    if (legacy) {
      save.progress = progressFromLevelMap(source.levels);
      const old_settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
      // The old sounds were too sharp: v4 keeps the on/off choices but starts everyone on the new gentle volumes.
      save.settings = sanitizeSettings({
        sound_on: old_settings.sfx_on,
        music_on: old_settings.music_on,
        haptics: old_settings.haptics,
        reduced_motion: old_settings.reduced_motion,
        colorblind: old_settings.colorblind,
        theme: old_settings.theme === 'classic' ? 'gummy' : old_settings.theme,
        accent: old_settings.accent,
        photo_brightness: old_settings.photo_brightness,
        win_message: old_settings.win_message,
      });
    } else {
      // A packed string decodes straight into valid progress; anything else is sanitized entry by entry.
      let decoded = null;
      if (typeof source.progress === 'string') {
        try {
          decoded = decodeProgress(source.progress);
        } catch (decode_error) {
          decoded = null;
        }
      }
      save.progress = decoded || sanitizeProgress(typeof source.progress === 'string' ? null : source.progress);
      save.settings = sanitizeSettings(source.settings);
      save.meta = sanitizeMeta(source.meta);
    }
    save.tried = sanitizeBits(source.tried);
    save.crowns = sanitizeBits(source.crowns);
    save.mastered = sanitizeBits(source.mastered);
    if (legacy || source.version < 5) {
      // Saves from before v5 had every booster, the wheel and the chest from the start, and no crowns or tries.
      save.meta.announced = LEGACY_UNLOCKS.slice();
      save.meta.try_booster = '';
      save.meta.streak = 0;
      save.progress.stars.forEach((stars, index) => {
        if (stars > 0) bitSet(save.tried, index + 1);
      });
    }
    save.unlocked = clampInteger(source.unlocked, 1, MAX_LEVEL, 1);
    // A level beaten but never unlocked past (older saves) still unlocks the next one.
    for (let index = save.progress.stars.length - 1; index >= 0; index -= 1) {
      if (save.progress.stars[index] > 0) {
        save.unlocked = Math.max(save.unlocked, Math.min(MAX_LEVEL, index + 2));
        break;
      }
    }
    // Episodes already finished before v5 do not pay their completion reward again (episodes are 15 levels long).
    if (legacy || source.version < 5) save.meta.episodes_claimed = Math.floor((save.unlocked - 1) / 15);
    if (source.tutorials_seen && typeof source.tutorials_seen === 'object') {
      Object.keys(source.tutorials_seen).forEach((level_key) => {
        if (source.tutorials_seen[level_key] === true && /^\d+$/.test(level_key)) save.tutorials_seen[level_key] = true;
      });
    }
    return save;
  }

  /** Parses stored text. Corrupted or empty data yields defaults and `recovered: true` instead of throwing. */
  function parseSave(stored_text) {
    if (stored_text === null || stored_text === undefined || stored_text === '') return { save: defaultSave(), recovered: false, fresh: true };
    try {
      const parsed = JSON.parse(stored_text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { save: defaultSave(), recovered: true, fresh: false };
      return { save: normalizeSave(parsed), recovered: false, fresh: false };
    } catch (parse_error) {
      return { save: defaultSave(), recovered: true, fresh: false };
    }
  }

  function serializeSave(save) {
    const normal = normalizeSave(Object.assign({}, save, { version: SAVE_VERSION }));
    return JSON.stringify(Object.assign({}, normal, {
      progress: encodeProgress(normal.progress),
      tried: normal.tried.length ? bytesToBase64(normal.tried) : '',
      crowns: normal.crowns.length ? bytesToBase64(normal.crowns) : '',
      mastered: normal.mastered.length ? bytesToBase64(normal.mastered) : '',
    }));
  }

  // ------------------------------------------------------------------ progress helpers

  function levelBest(save, level_id) {
    const index = level_id - 1;
    return { stars: save.progress.stars[index] || 0, score: save.progress.scores[index] || 0 };
  }

  function totalStars(save) {
    let total = 0;
    const stars = save.progress.stars;
    for (let index = 0; index < stars.length; index += 1) total += stars[index];
    return total;
  }

  function hasCrown(save, level_id) {
    return bitGet(save.crowns, level_id) === 1;
  }

  function totalCrowns(save) {
    return bitCount(save.crowns);
  }

  function hasMastery(save, level_id) {
    return bitGet(save.mastered, level_id) === 1;
  }

  /** Moves left that turn a Gold Crown into Sweet Mastery (the original's Sugar Stars ask for the same). */
  const MASTERY_MOVES = 5;

  /**
   * Records a finished attempt; returns {is_new_best, unlocked_next, crown, mastery, new_level}. crown: won on the
   * level's very first attempt (a Gold Crown); mastery: a crown with result.moves_left of MASTERY_MOVES or more;
   * new_level: the level had not been won before this attempt.
   */
  function recordResult(save, level_id, result) {
    save.meta.total_attempts += 1;
    const index = level_id - 1;
    while (save.progress.stars.length <= index) {
      save.progress.stars.push(0);
      save.progress.scores.push(0);
    }
    const new_level = !(save.progress.stars[index] > 0);
    const crown = !!result.won && !bitGet(save.tried, level_id);
    bitSet(save.tried, level_id);
    if (crown) bitSet(save.crowns, level_id);
    const mastery = crown && (result.moves_left || 0) >= MASTERY_MOVES;
    if (mastery) bitSet(save.mastered, level_id);
    const stored_score = Math.floor(Math.max(0, result.score || 0) / 10) * 10;
    const is_new_best = !!result.won && stored_score > save.progress.scores[index];
    if (result.won) {
      save.meta.total_wins += 1;
      save.progress.scores[index] = Math.max(save.progress.scores[index], stored_score);
      save.progress.stars[index] = Math.max(save.progress.stars[index], Math.min(3, Math.max(1, result.stars || 1)));
    }
    let unlocked_next = false;
    if (result.won && save.unlocked < level_id + 1 && level_id < MAX_LEVEL) {
      save.unlocked = level_id + 1;
      unlocked_next = true;
    }
    return { is_new_best, unlocked_next, crown, mastery, new_level };
  }

  // ------------------------------------------------------------------ backends

  function createMemoryBackend() {
    const memory = new Map();
    return {
      name: 'memory',
      get: (key) => Promise.resolve(memory.has(key) ? memory.get(key) : null),
      set: (key, value) => {
        memory.set(key, value);
        return Promise.resolve(true);
      },
      remove: (key) => {
        memory.delete(key);
        return Promise.resolve(true);
      },
    };
  }

  function createPreferencesBackend(preferences_plugin) {
    return {
      name: 'preferences',
      get: (key) => preferences_plugin.get({ key }).then((result) => (result && typeof result.value === 'string' ? result.value : null)),
      set: (key, value) => preferences_plugin.set({ key, value }).then(() => true),
      remove: (key) => preferences_plugin.remove({ key }).then(() => true),
    };
  }

  function createLocalStorageBackend(local_storage) {
    return {
      name: 'localStorage',
      get: (key) => Promise.resolve(local_storage.getItem(key)),
      set: (key, value) => {
        local_storage.setItem(key, value);
        return Promise.resolve(true);
      },
      remove: (key) => {
        local_storage.removeItem(key);
        return Promise.resolve(true);
      },
    };
  }

  function pickBackend() {
    try {
      const capacitor = root.Capacitor;
      if (capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform() && capacitor.Plugins && capacitor.Plugins.Preferences) {
        return createPreferencesBackend(capacitor.Plugins.Preferences);
      }
    } catch (plugin_error) {
      // fall through to the browser backends
    }
    try {
      if (root.localStorage) {
        const probe_key = '__sweet_cascade_probe__';
        root.localStorage.setItem(probe_key, '1');
        root.localStorage.removeItem(probe_key);
        return createLocalStorageBackend(root.localStorage);
      }
    } catch (local_storage_error) {
      // private mode or blocked storage
    }
    return createMemoryBackend();
  }

  /** A save store with a safe in-memory fallback: any backend failure keeps the game running on memory. */
  function createStore(backend_override) {
    let backend = backend_override || pickBackend();
    const fallback_backend = createMemoryBackend();
    let current_save = defaultSave();
    let pending_write = Promise.resolve();
    const store = {
      backendName: () => backend.name,
      get save() {
        return current_save;
      },
      load() {
        return backend.get(SAVE_KEY).catch(() => {
          backend = fallback_backend;
          return null;
        }).then((stored_text) => {
          const parsed = parseSave(stored_text);
          current_save = parsed.save;
          return parsed;
        });
      },
      persist() {
        const text = serializeSave(current_save);
        pending_write = pending_write.then(() => backend.set(SAVE_KEY, text)).catch(() => {
          backend = fallback_backend;
          return backend.set(SAVE_KEY, text);
        });
        return pending_write;
      },
      loadPhoto() {
        return backend.get(PHOTO_KEY).catch(() => null);
      },
      /** Stores the downscaled photo; resolves false (and keeps it for this session only) when storage is full. */
      savePhoto(data_url) {
        return backend.set(PHOTO_KEY, data_url).then(() => true).catch(() => false);
      },
      removePhoto() {
        return backend.remove(PHOTO_KEY).catch(() => false);
      },
      resetProgress() {
        const kept_settings = current_save.settings;
        const kept_name = current_save.player_name;
        current_save = defaultSave();
        current_save.settings = kept_settings;
        current_save.player_name = kept_name;
        current_save.name_asked = true;
        return store.persist();
      },
    };
    return store;
  }

  const STORAGE = {
    SAVE_KEY,
    PHOTO_KEY,
    SAVE_VERSION,
    MAX_LEVEL,
    THEMES,
    ACCENTS,
    AUTO_HINT,
    ANIMATION_SPEEDS,
    IN_LEVEL_BOOSTERS,
    PRE_LEVEL_BOOSTERS,
    BOOSTERS,
    MAX_HEARTS,
    MAX_NAME_LENGTH,
    MAX_MESSAGE_LENGTH,
    defaultSave,
    defaultSettings,
    defaultMeta,
    normalizeSave,
    parseSave,
    serializeSave,
    encodeProgress,
    decodeProgress,
    levelBest,
    totalStars,
    hasCrown,
    totalCrowns,
    hasMastery,
    MASTERY_MOVES,
    recordResult,
    LEGACY_UNLOCKS,
    cleanText,
    createStore,
    createMemoryBackend,
  };
  SC.STORAGE = STORAGE;
  if (typeof module === 'object' && module.exports) module.exports = STORAGE;
})(typeof window !== 'undefined' ? window : globalThis);
