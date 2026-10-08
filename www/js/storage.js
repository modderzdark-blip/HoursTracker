// STORAGE: versioned save schema with defensive parsing, corruption fallback and migration.
// Backends (picked at runtime): Capacitor Preferences on Android, localStorage in a browser, in-memory as a last resort.
// Everything stays on the device; nothing is ever uploaded.
(function attachStorage(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const SAVE_KEY = 'sweet_cascade_save';
  const PHOTO_KEY = 'sweet_cascade_photo';
  const SAVE_VERSION = 2;
  const THEMES = ['gummy', 'hard', 'sprinkle'];
  const ACCENTS = ['bubblegum', 'sunset', 'ocean', 'mint', 'grape', 'cherry', 'gold', 'midnight'];
  const MAX_NAME_LENGTH = 16;
  const MAX_MESSAGE_LENGTH = 80;

  function defaultSettings() {
    return {
      sfx_on: true,
      sfx_volume: 0.8,
      music_on: true,
      music_volume: 0.45,
      haptics: true,
      reduced_motion: false,
      colorblind: false,
      theme: 'gummy',
      accent: 'bubblegum',
      photo_brightness: 0.75,
      win_message: '',
    };
  }

  function defaultSave() {
    return {
      version: SAVE_VERSION,
      player_name: '',
      name_asked: false,
      unlocked: 1,
      levels: {},
      tutorials_seen: {},
      settings: defaultSettings(),
    };
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = typeof value === 'number' && isFinite(value) ? value : fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function cleanText(value, max_length) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max_length);
  }

  function sanitizeSettings(raw_settings) {
    const defaults = defaultSettings();
    const raw = raw_settings && typeof raw_settings === 'object' ? raw_settings : {};
    return {
      sfx_on: typeof raw.sfx_on === 'boolean' ? raw.sfx_on : defaults.sfx_on,
      sfx_volume: clampNumber(raw.sfx_volume, 0, 1, defaults.sfx_volume),
      music_on: typeof raw.music_on === 'boolean' ? raw.music_on : defaults.music_on,
      music_volume: clampNumber(raw.music_volume, 0, 1, defaults.music_volume),
      haptics: typeof raw.haptics === 'boolean' ? raw.haptics : defaults.haptics,
      reduced_motion: typeof raw.reduced_motion === 'boolean' ? raw.reduced_motion : defaults.reduced_motion,
      colorblind: typeof raw.colorblind === 'boolean' ? raw.colorblind : defaults.colorblind,
      theme: THEMES.indexOf(raw.theme) >= 0 ? raw.theme : defaults.theme,
      accent: ACCENTS.indexOf(raw.accent) >= 0 ? raw.accent : defaults.accent,
      photo_brightness: clampNumber(raw.photo_brightness, 0.2, 1, defaults.photo_brightness),
      win_message: cleanText(raw.win_message, MAX_MESSAGE_LENGTH),
    };
  }

  function sanitizeLevels(raw_levels) {
    const levels = {};
    if (!raw_levels || typeof raw_levels !== 'object') return levels;
    Object.keys(raw_levels).forEach((level_key) => {
      const level_id = parseInt(level_key, 10);
      const record = raw_levels[level_key];
      if (!Number.isInteger(level_id) || level_id < 1 || level_id > 9999 || !record || typeof record !== 'object') return;
      levels[level_id] = {
        best_score: Math.floor(clampNumber(record.best_score, 0, 1e9, 0)),
        best_stars: Math.floor(clampNumber(record.best_stars, 0, 3, 0)),
        attempts: Math.floor(clampNumber(record.attempts, 0, 1e6, 0)),
        wins: Math.floor(clampNumber(record.wins, 0, 1e6, 0)),
      };
    });
    return levels;
  }

  /** v1 (development builds) stored {version:1, sound, music, unlocked, best:{id:{score,stars}}, name}. */
  function migrateV1(raw_save) {
    const migrated = defaultSave();
    migrated.player_name = cleanText(raw_save.name, MAX_NAME_LENGTH);
    migrated.name_asked = migrated.player_name.length > 0;
    migrated.unlocked = raw_save.unlocked;
    migrated.settings.sfx_on = raw_save.sound !== false;
    migrated.settings.music_on = raw_save.music !== false;
    const best = raw_save.best && typeof raw_save.best === 'object' ? raw_save.best : {};
    Object.keys(best).forEach((level_key) => {
      const entry = best[level_key] || {};
      migrated.levels[level_key] = { best_score: entry.score, best_stars: entry.stars, attempts: 0, wins: entry.stars > 0 ? 1 : 0 };
    });
    return migrated;
  }

  /** Normalizes any stored object into a valid current-version save. Unknown or missing keys fall back to defaults. */
  function normalizeSave(raw_save) {
    let source = raw_save && typeof raw_save === 'object' && !Array.isArray(raw_save) ? raw_save : {};
    if (source.version === 1) source = migrateV1(source);
    const save = defaultSave();
    save.player_name = cleanText(source.player_name, MAX_NAME_LENGTH);
    save.name_asked = typeof source.name_asked === 'boolean' ? source.name_asked : save.player_name.length > 0;
    save.levels = sanitizeLevels(source.levels);
    save.unlocked = Math.floor(clampNumber(source.unlocked, 1, 9999, 1));
    save.settings = sanitizeSettings(source.settings);
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
    return JSON.stringify(normalizeSave(save));
  }

  /** Records a finished attempt; returns {is_new_best, unlocked_next}. */
  function recordResult(save, level_id, result) {
    const record = save.levels[level_id] || { best_score: 0, best_stars: 0, attempts: 0, wins: 0 };
    record.attempts += 1;
    const is_new_best = result.won && result.score > record.best_score;
    if (result.won) {
      record.wins += 1;
      record.best_score = Math.max(record.best_score, result.score);
      record.best_stars = Math.max(record.best_stars, result.stars);
    }
    save.levels[level_id] = record;
    let unlocked_next = false;
    if (result.won && save.unlocked < level_id + 1) {
      save.unlocked = level_id + 1;
      unlocked_next = true;
    }
    return { is_new_best, unlocked_next };
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
    THEMES,
    ACCENTS,
    MAX_NAME_LENGTH,
    MAX_MESSAGE_LENGTH,
    defaultSave,
    defaultSettings,
    normalizeSave,
    parseSave,
    serializeSave,
    recordResult,
    cleanText,
    createStore,
    createMemoryBackend,
  };
  SC.STORAGE = STORAGE;
  if (typeof module === 'object' && module.exports) module.exports = STORAGE;
})(typeof window !== 'undefined' ? window : globalThis);
