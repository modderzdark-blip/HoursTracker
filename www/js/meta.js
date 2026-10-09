// META: the offline meta game, as pure functions over save.meta (no DOM, no real clock: callers pass `now`).
// Hearts (5, one refills every 30 minutes, guarded against the clock moving backwards), Gold Drops, booster inventory and
// prices, the Daily Wheel (one spin per local day), Sweet Streak (a free pre-level booster every 3 wins in a row), the
// Star Chest (every 25 new stars), win rewards, and the auto-hint scheduler. Nothing here can be bought with money.
(function attachMeta(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');

  const MAX_HEARTS = 5;
  const HEART_REFILL_MS = 30 * 60 * 1000;
  const CHEST_STARS = 25;
  const STREAK_LENGTH = 3;
  const PRICES = Object.freeze({ hammer: 60, free_swap: 40, whirl: 30, lucky: 50, rainbow: 80, head_start: 40, plus_five: 60 });
  const BOOSTER_NAMES = Object.freeze({
    hammer: 'Sweet Hammer', free_swap: 'Free Swap', whirl: 'Candy Whirl', lucky: 'Lucky Start', rainbow: 'Rainbow Start', head_start: 'Head Start',
  });
  const STREAK_REWARDS = Object.freeze(['lucky', 'head_start', 'rainbow']);
  const WHEEL = Object.freeze([
    { kind: 'gold', amount: 25, label: '25 Gold Drops' },
    { kind: 'booster', booster: 'hammer', label: 'Sweet Hammer' },
    { kind: 'gold', amount: 50, label: '50 Gold Drops' },
    { kind: 'booster', booster: 'lucky', label: 'Lucky Start' },
    { kind: 'heart', label: 'A heart' },
    { kind: 'booster', booster: 'free_swap', label: 'Free Swap' },
    { kind: 'gold', amount: 100, label: '100 Gold Drops' },
    { kind: 'booster', booster: 'rainbow', label: 'Rainbow Start' },
  ]);
  const CHEST = Object.freeze([
    { kind: 'gold', amount: 80, label: '80 Gold Drops' },
    { kind: 'gold', amount: 150, label: '150 Gold Drops' },
    { kind: 'booster', booster: 'whirl', amount: 2, label: '2 Candy Whirls' },
    { kind: 'booster', booster: 'hammer', amount: 2, label: '2 Sweet Hammers' },
    { kind: 'booster', booster: 'rainbow', amount: 1, label: 'Rainbow Start' },
  ]);

  // ---------------------------------------------------------------- hearts

  /**
   * Brings hearts up to date at `now`. If the clock moved backwards since the last reading, no hearts are awarded and
   * the refill timer restarts from the new time (so turning the clock back never gives free hearts).
   */
  function refreshHearts(meta, now) {
    if (now < meta.last_seen) {
      meta.hearts_clock = now;
      meta.last_seen = now;
      return meta;
    }
    meta.last_seen = now;
    if (meta.hearts >= MAX_HEARTS) {
      meta.hearts = MAX_HEARTS;
      meta.hearts_clock = now;
      return meta;
    }
    if (!meta.hearts_clock || meta.hearts_clock > now) meta.hearts_clock = now;
    const gained = Math.floor((now - meta.hearts_clock) / HEART_REFILL_MS);
    if (gained > 0) {
      meta.hearts = Math.min(MAX_HEARTS, meta.hearts + gained);
      meta.hearts_clock = meta.hearts >= MAX_HEARTS ? now : meta.hearts_clock + gained * HEART_REFILL_MS;
    }
    return meta;
  }

  /** Milliseconds until the next heart (0 when full). */
  function nextHeartIn(meta, now) {
    if (meta.hearts >= MAX_HEARTS) return 0;
    return Math.max(0, HEART_REFILL_MS - Math.max(0, now - meta.hearts_clock));
  }

  function heartsEnabled(settings) {
    return !(settings && settings.unlimited_hearts);
  }

  /** Whether a level may start: hearts off, or at least one heart. */
  function canPlay(save, now) {
    if (!heartsEnabled(save.settings)) return true;
    refreshHearts(save.meta, now);
    return save.meta.hearts > 0;
  }

  /** A loss (or restart, or quit) costs one heart when hearts are on. Returns true when a heart was spent. */
  function spendHeart(save, now) {
    if (!heartsEnabled(save.settings)) return false;
    const meta = refreshHearts(save.meta, now);
    if (meta.hearts <= 0) return false;
    if (meta.hearts >= MAX_HEARTS) meta.hearts_clock = now;
    meta.hearts -= 1;
    return true;
  }

  function grantHearts(meta, count, now) {
    refreshHearts(meta, now);
    meta.hearts = Math.min(MAX_HEARTS, meta.hearts + count);
    if (meta.hearts >= MAX_HEARTS) meta.hearts_clock = now;
  }

  // ---------------------------------------------------------------- Gold Drops and boosters

  function boosterCount(meta, booster) {
    return meta.boosters[booster] || 0;
  }

  /** Uses one booster from the inventory; returns false when there is none. */
  function useBooster(meta, booster) {
    if (!(meta.boosters[booster] > 0)) return false;
    meta.boosters[booster] -= 1;
    return true;
  }

  /** Buys one booster (or +5 Moves, booster 'plus_five', which is used at once) for Gold Drops. */
  function buy(meta, item) {
    const price = PRICES[item];
    if (!price || meta.gold < price) return false;
    meta.gold -= price;
    if (item !== 'plus_five') meta.boosters[item] = (meta.boosters[item] || 0) + 1;
    return true;
  }

  function applyReward(meta, reward, now) {
    if (reward.kind === 'gold') meta.gold += reward.amount;
    else if (reward.kind === 'booster') meta.boosters[reward.booster] = (meta.boosters[reward.booster] || 0) + (reward.amount || 1);
    else if (reward.kind === 'heart') grantHearts(meta, 1, now);
    return reward;
  }

  // ---------------------------------------------------------------- Daily Wheel

  /** Local calendar day 'YYYY-MM-DD' for a timestamp (the wheel resets at local midnight). */
  function localDay(now) {
    const date = new Date(now);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function canSpin(meta, now) {
    return meta.wheel_day !== localDay(now);
  }

  /** Spins once per local day; the prize is seeded by the day. Returns {index, reward} or null when already spun. */
  function spinWheel(meta, now) {
    const day = localDay(now);
    if (meta.wheel_day === day) return null;
    const rng = UTIL.createRng(day.split('-').reduce((hash, part) => hash * 131 + Number(part), 7));
    const index = Math.floor(rng() * WHEEL.length);
    meta.wheel_day = day;
    return { index, reward: applyReward(meta, WHEEL[index], now) };
  }

  // ---------------------------------------------------------------- results: streak, stars, chest

  /**
   * Applies a finished level to the meta game. win: {won, new_stars} (new_stars = stars above the previous best).
   * Returns the rewards earned: { gold, streak_reward, chest_ready }.
   */
  function recordOutcome(save, outcome, total_stars) {
    const meta = save.meta;
    const rewards = { gold: 0, streak_reward: null, chest_ready: false };
    if (outcome.won) {
      rewards.gold = 5 + 10 * Math.max(0, outcome.new_stars || 0);
      meta.gold += rewards.gold;
      meta.streak += 1;
      if (meta.streak % STREAK_LENGTH === 0) {
        const booster = STREAK_REWARDS[(meta.streak / STREAK_LENGTH - 1) % STREAK_REWARDS.length];
        meta.boosters[booster] = (meta.boosters[booster] || 0) + 1;
        rewards.streak_reward = booster;
      }
    } else {
      meta.streak = 0;
    }
    rewards.chest_ready = chestReady(meta, total_stars);
    return rewards;
  }

  function chestReady(meta, total_stars) {
    return total_stars - meta.chest_claimed >= CHEST_STARS;
  }

  function chestProgress(meta, total_stars) {
    return Math.min(CHEST_STARS, Math.max(0, total_stars - meta.chest_claimed));
  }

  /** Opens the Star Chest when 25 new stars are in; the prize is seeded by how many chests were opened. */
  function openChest(meta, total_stars, now) {
    if (!chestReady(meta, total_stars)) return null;
    meta.chest_claimed += CHEST_STARS;
    const rng = UTIL.createRng(meta.chest_claimed * 977 + 3);
    return applyReward(meta, CHEST[Math.floor(rng() * CHEST.length)], now);
  }

  // ---------------------------------------------------------------- auto-hint scheduler

  /**
   * Shows the hint when the board has been idle long enough for the player's setting (Instant, 3 s, 8 s or Off).
   * timers: { set(fn, ms) -> handle, clear(handle) } (fake timers in tests). The Hint button always shows at once.
   */
  function createHintScheduler(timers, delays, show) {
    let handle = null;
    let mode = 'instant';
    const cancel = () => {
      if (handle !== null) timers.clear(handle);
      handle = null;
    };
    return {
      setMode(next_mode) {
        mode = Object.prototype.hasOwnProperty.call(delays, next_mode) ? next_mode : 'instant';
      },
      get mode() {
        return mode;
      },
      /** The board settled and input is unlocked: arm the auto hint. */
      idle() {
        cancel();
        const delay = delays[mode];
        if (delay === null || delay === undefined) return;
        handle = timers.set(() => {
          handle = null;
          show('auto');
        }, delay);
      },
      /** The player touched the board or a move started: the pending auto hint is dropped. */
      touch() {
        cancel();
      },
      button() {
        cancel();
        show('button');
      },
      get pending() {
        return handle !== null;
      },
    };
  }

  const META = {
    MAX_HEARTS, HEART_REFILL_MS, CHEST_STARS, STREAK_LENGTH, PRICES, BOOSTER_NAMES, WHEEL, CHEST, STREAK_REWARDS,
    refreshHearts, nextHeartIn, heartsEnabled, canPlay, spendHeart, grantHearts, boosterCount, useBooster, buy, applyReward,
    localDay, canSpin, spinWheel, recordOutcome, chestReady, chestProgress, openChest, createHintScheduler,
  };
  SC.META = META;
  if (typeof module === 'object' && module.exports) module.exports = META;
})(typeof window !== 'undefined' ? window : globalThis);
