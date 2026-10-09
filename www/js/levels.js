// LEVELS: the level registry, built for 20,000+ levels.
// Level records live in packs of 100 (www/levels/pack-NNNN.js) that load lazily on demand, so levels cost no memory
// until they are visited. The manifest (www/levels/manifest.js) says how many levels ship. Roles, difficulty targets,
// episodes and their scenery are pure functions of the level number, so they work for any n from 1 to 99,999.
(function attachLevels(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const PACK_SIZE = 100;
  const MAX_LEVEL = 99999;
  const EPISODE_SIZE = 15;
  const IS_NODE = typeof window === 'undefined' && typeof module === 'object' && !!module.exports;

  const packs = {};
  const pending_loads = {};

  function manifest() {
    if (root.SC_LEVEL_MANIFEST) return root.SC_LEVEL_MANIFEST;
    if (IS_NODE) {
      try {
        return require('../levels/manifest.js');
      } catch (missing_manifest) {
        return { count: 0, packs: [] };
      }
    }
    return { count: 0, packs: [] };
  }

  /** How many levels ship in this build (levels beyond it show "More levels coming soon!"). */
  function shippedCount() {
    return manifest().count;
  }

  function packOf(level_number) {
    return Math.floor((level_number - 1) / PACK_SIZE) + 1;
  }

  function packFileName(pack_number) {
    return `pack-${String(pack_number).padStart(4, '0')}.js`;
  }

  function isValidNumber(level_number) {
    return Number.isInteger(level_number) && level_number >= 1 && level_number <= MAX_LEVEL;
  }

  function adoptPack(pack_number) {
    const registry = root.SC_LEVEL_PACKS || {};
    if (registry[pack_number]) packs[pack_number] = registry[pack_number];
    // Node (tests, calibration) loads packs synchronously on first use.
    if (!packs[pack_number] && IS_NODE && manifest().packs.indexOf(pack_number) >= 0) packs[pack_number] = require(`../levels/${packFileName(pack_number)}`);
    return packs[pack_number] || null;
  }

  /** Loads a pack (once). Browser: a <script> tag; Node: require. Resolves to the pack or null when it does not ship. */
  function loadPack(pack_number) {
    if (packs[pack_number] || adoptPack(pack_number)) return Promise.resolve(packs[pack_number]);
    if (manifest().packs.indexOf(pack_number) < 0) return Promise.resolve(null);
    if (pending_loads[pack_number]) return pending_loads[pack_number];
    if (IS_NODE) {
      try {
        packs[pack_number] = require(`../levels/${packFileName(pack_number)}`);
      } catch (load_error) {
        return Promise.reject(load_error);
      }
      return Promise.resolve(packs[pack_number]);
    }
    pending_loads[pack_number] = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `levels/${packFileName(pack_number)}`;
      script.async = true;
      script.onload = () => {
        delete pending_loads[pack_number];
        resolve(adoptPack(pack_number));
      };
      script.onerror = () => {
        delete pending_loads[pack_number];
        reject(new Error(`could not load level pack ${pack_number}`));
      };
      document.head.appendChild(script);
    });
    return pending_loads[pack_number];
  }

  /** Synchronous lookup: the level record, or null when it does not ship or its pack is not loaded yet. */
  function getLevel(level_number) {
    if (!isValidNumber(level_number) || level_number > shippedCount()) return null;
    const pack = packs[packOf(level_number)] || adoptPack(packOf(level_number));
    if (!pack) return null;
    return pack.levels[level_number - pack.first] || null;
  }

  /** Makes sure level n is loaded (and prefetches the next pack near a pack boundary). Resolves to the level or null. */
  function ensureLevel(level_number) {
    if (!isValidNumber(level_number) || level_number > shippedCount()) return Promise.resolve(null);
    const pack_number = packOf(level_number);
    const next_pack = pack_number + 1;
    if ((level_number - 1) % PACK_SIZE >= PACK_SIZE - EPISODE_SIZE && manifest().packs.indexOf(next_pack) >= 0) {
      loadPack(next_pack).catch(() => null);
    }
    return loadPack(pack_number).then(() => getLevel(level_number));
  }

  /** Loads every pack touching the range (used by the map for the nodes near the viewport). */
  function ensureRange(first_level, last_level) {
    const loads = [];
    const last = Math.min(last_level, shippedCount());
    for (let pack_number = packOf(Math.max(1, first_level)); pack_number <= packOf(Math.max(1, last)); pack_number += 1) loads.push(loadPack(pack_number));
    return Promise.all(loads);
  }

  function loadedPackCount() {
    return Object.keys(packs).length;
  }

  // ---------------------------------------------------------------- difficulty roles and targets

  const ROLES = Object.freeze(['normal', 'breather', 'hard', 'superhard', 'tutorial']);

  /** The role a level number gets from the schedule (authored levels may override it in their record). */
  function scheduledRole(level_number) {
    if (level_number >= 150 && level_number % 75 === 0) return 'superhard';
    if (level_number >= 30 && level_number % 15 === 0) return 'hard';
    const previous = level_number - 1;
    if (previous >= 30 && previous % 15 === 0) return 'breather'; // always right after a hard or superhard level
    if (level_number % 10 === 7) return 'breather';
    return 'normal';
  }

  function roleOf(level_number) {
    const record = getLevel(level_number);
    return record && record.role ? record.role : scheduledRole(level_number);
  }

  /** Long-run curve for a normal level: about 90% at level 50, 57% at 400, settling near 35% after about 2,000. */
  function baseWinRate(level_number) {
    const value = 0.95 - 0.6 * (1 - Math.exp(-level_number / 400));
    return Math.min(0.95, Math.max(0.3, value));
  }

  /** Target greedy-bot win rate for a level (the hand-authored opening has its own targets). */
  function targetWinRate(level_number, role) {
    if (level_number <= 3) return 0.98;
    if (level_number <= 10) return 0.92;
    if (level_number <= 25) return 0.85 - (0.15 * (level_number - 11)) / 14;
    const base = baseWinRate(level_number);
    const level_role = role || scheduledRole(level_number);
    if (level_role === 'breather') return Math.min(0.9, base + 0.15);
    if (level_role === 'hard') return base - 0.15;
    if (level_role === 'superhard') return Math.max(0.1, base - 0.25);
    return base;
  }

  // ---------------------------------------------------------------- episodes and scenery

  const SCENERY_FAMILIES = Object.freeze([
    { id: 'gumdrop_meadow', nouns: ['Meadow', 'Fields', 'Hills', 'Green'] },
    { id: 'lollipop_forest', nouns: ['Forest', 'Grove', 'Woods', 'Thicket'] },
    { id: 'frosted_peaks', nouns: ['Peaks', 'Summit', 'Ridge', 'Heights'] },
    { id: 'caramel_canyon', nouns: ['Canyon', 'Gorge', 'Mesa', 'Bluffs'] },
    { id: 'starlight_sky', nouns: ['Sky', 'Stars', 'Heavens', 'Nebula'] },
    { id: 'jelly_lagoon', nouns: ['Lagoon', 'Bay', 'Shallows', 'Reef'] },
    { id: 'cookie_town', nouns: ['Town', 'Village', 'Square', 'Lanes'] },
    { id: 'sorbet_desert', nouns: ['Desert', 'Dunes', 'Oasis', 'Sands'] },
    { id: 'midnight_carnival', nouns: ['Carnival', 'Fair', 'Parade', 'Midway'] },
    { id: 'cloud_kitchen', nouns: ['Kitchen', 'Bakery', 'Pantry', 'Ovens'] },
    { id: 'glacier_gelato', nouns: ['Glacier', 'Floes', 'Tundra', 'Icefall'] },
    { id: 'sunrise_orchard', nouns: ['Orchard', 'Gardens', 'Groves', 'Terraces'] },
  ]);
  const EPISODE_ADJECTIVES = Object.freeze([
    'Sweet', 'Sunny', 'Misty', 'Sparkling', 'Hidden', 'Golden', 'Silver', 'Whispering', 'Bubbly', 'Dreamy', 'Cozy', 'Breezy',
    'Twinkling', 'Frosty', 'Rosy', 'Velvet', 'Honey', 'Minty', 'Peachy', 'Fizzy', 'Sugary', 'Glowing', 'Gentle', 'Jolly',
  ]);

  function episodeOf(level_number) {
    return Math.floor((level_number - 1) / EPISODE_SIZE) + 1;
  }

  function episodeRange(episode_number) {
    const first = (episode_number - 1) * EPISODE_SIZE + 1;
    return { first, last: first + EPISODE_SIZE - 1 };
  }

  function hashNumber(value) {
    let hash = (value | 0) ^ 0x9e3779b9;
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    return (hash ^ (hash >>> 16)) >>> 0;
  }

  function sceneryOf(episode_number) {
    const family_index = (episode_number - 1) % SCENERY_FAMILIES.length;
    const cycle = Math.floor((episode_number - 1) / SCENERY_FAMILIES.length);
    // Each pass through the 12 families shifts the hue a little, so 1,334 episodes never repeat exactly.
    return { family: SCENERY_FAMILIES[family_index].id, family_index, hue_shift: ((hashNumber(cycle + 17) % 61) - 30) * (cycle > 0 ? 1 : 0), seed: hashNumber(episode_number) };
  }

  /** Original generated episode name, e.g. "Twinkling Grove" (deterministic per episode). */
  function episodeName(episode_number) {
    const family = SCENERY_FAMILIES[(episode_number - 1) % SCENERY_FAMILIES.length];
    const hash = hashNumber(episode_number * 31 + 7);
    const adjective = EPISODE_ADJECTIVES[hash % EPISODE_ADJECTIVES.length];
    const noun = family.nouns[Math.floor(hash / EPISODE_ADJECTIVES.length) % family.nouns.length];
    return `${adjective} ${noun}`;
  }

  const LEVELS = {
    PACK_SIZE,
    MAX_LEVEL,
    EPISODE_SIZE,
    ROLES,
    SCENERY_FAMILIES,
    shippedCount,
    packOf,
    packFileName,
    loadPack,
    getLevel,
    ensureLevel,
    ensureRange,
    loadedPackCount,
    scheduledRole,
    roleOf,
    baseWinRate,
    targetWinRate,
    episodeOf,
    episodeRange,
    episodeName,
    sceneryOf,
    hashNumber,
  };

  SC.LEVELS = LEVELS;
  if (typeof module === 'object' && module.exports) module.exports = LEVELS;
})(typeof window !== 'undefined' ? window : globalThis);
