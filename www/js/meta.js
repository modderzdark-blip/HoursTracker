// META: the offline meta game, as pure functions over save.meta (no DOM, no real clock: callers pass `now`).
// Hearts (5, one refills every 30 minutes, guarded against the clock moving backwards), Gold Drops, booster inventory and
// prices, the progression (boosters and features unlock one by one as the player advances, each booster with a few free),
// the Sweet Streak (new levels won on the first try in a row start the next new level with special candies), episode
// rewards, the Daily Wheel (one spin per local day), the Star Chest (every 25 new stars), win rewards, and the auto-hint
// scheduler. Nothing here can be bought with money.
(function attachMeta(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});
  const UTIL = SC.UTIL || require('./util.js');

  const MAX_HEARTS = 5;
  const HEART_REFILL_MS = 30 * 60 * 1000;
  const CHEST_STARS = 25;
  const PRICES = Object.freeze({ hammer: 60, free_swap: 40, whirl: 30, brush: 50, party: 120, lucky: 50, rainbow: 80, head_start: 40, plus_five: 60 });
  // Each further +5 Moves in the same attempt costs more (the original's continues climb the same way).
  const CONTINUE_PRICES = Object.freeze([60, 90, 140, 190, 240]);
  const IN_LEVEL = Object.freeze(['hammer', 'free_swap', 'whirl', 'brush', 'party']);
  const BOOSTER_NAMES = Object.freeze({
    hammer: 'Sweet Hammer', free_swap: 'Free Swap', whirl: 'Candy Whirl', lucky: 'Lucky Start', rainbow: 'Rainbow Start', head_start: 'Head Start',
    brush: 'Candy Brush', party: 'Sugar Party',
  });

  // Progression, paced like the original's first episodes: a new booster or feature every few levels, each booster with a
  // few free on unlock (and a pointer showing how to use it in the next level).
  const UNLOCKS = Object.freeze([
    { id: 'hammer', kind: 'booster', level: 7, gift: 3, title: 'Sweet Hammer', text: 'Smash any candy or blocker. It never uses a move.' },
    { id: 'rainbow', kind: 'booster', level: 10, gift: 2, title: 'Rainbow Start', text: 'Start a level with a Rainbow Drop already on the board.' },
    { id: 'wheel', kind: 'feature', level: 12, title: 'Daily Wheel', text: 'Spin the wheel once a day for a free gift.' },
    { id: 'free_swap', kind: 'booster', level: 16, gift: 3, title: 'Free Swap', text: 'Swap any two neighbouring candies, even without a match. No move used.' },
    { id: 'chest', kind: 'feature', level: 20, title: 'Star Chest', text: 'Every 25 stars you earn fill the chest with a gift.' },
    { id: 'lucky', kind: 'booster', level: 22, gift: 2, title: 'Lucky Start', text: 'Start a level with a striped and a wrapped candy on the board.' },
    { id: 'streak', kind: 'feature', level: 25, title: 'Sweet Streak', text: 'Win new levels on the first try, one after another: each win puts more special candies on your next new level. Losing a level ends the streak.' },
    { id: 'whirl', kind: 'booster', level: 28, gift: 3, title: 'Candy Whirl', text: 'Stuck? Mix up the whole board. No move used.' },
    { id: 'head_start', kind: 'booster', level: 35, gift: 2, title: 'Head Start', text: 'Start a level with 3 extra moves (10 extra seconds on timed levels).' },
    { id: 'brush', kind: 'booster', level: 40, gift: 3, title: 'Candy Brush', text: 'Paint any candy into a striped candy. It never uses a move.' },
    { id: 'party', kind: 'booster', level: 55, gift: 2, title: 'Sugar Party', text: 'Throw a party: one blast over the whole board! Every candy pops and every blocker loses a layer. No move used.' },
  ]);

  // Sweet Streak bags: what the next new level starts with after 1, 2, 3, 4 and 5+ first-try wins in a row.
  const STREAK_MAX = 5;
  const STREAK_BAGS = Object.freeze([
    null,
    Object.freeze({ striped: 1 }),
    Object.freeze({ striped: 1, wrapped: 1 }),
    Object.freeze({ striped: 1, wrapped: 1, bomb: 1 }),
    Object.freeze({ striped: 2, wrapped: 1, bomb: 1, moves: 2 }),
    Object.freeze({ striped: 2, wrapped: 2, bomb: 1, moves: 3 }),
  ]);
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

  /** The +5 Moves price for the given continue in this attempt (0 = the first). */
  function continuePrice(index) {
    return CONTINUE_PRICES[Math.min(CONTINUE_PRICES.length - 1, Math.max(0, index || 0))];
  }

  // ---------------------------------------------------------------- progression

  function unlockOf(id) {
    return UNLOCKS.find((unlock) => unlock.id === id) || null;
  }

  /** Whether a booster or feature can be used: reached its level (or already announced, e.g. kept from an older save). */
  function isUnlocked(meta, reached_level, id) {
    const unlock = unlockOf(id);
    return !unlock || reached_level >= unlock.level || meta.announced.indexOf(id) >= 0;
  }

  /** Unlocks reached but not announced yet, in order. */
  function pendingUnlocks(meta, reached_level) {
    return UNLOCKS.filter((unlock) => unlock.level <= reached_level && meta.announced.indexOf(unlock.id) < 0);
  }

  /** Announces an unlock once: a booster comes with its free gift and becomes the one to try next. */
  function announceUnlock(meta, id) {
    const unlock = unlockOf(id);
    if (!unlock || meta.announced.indexOf(id) >= 0) return null;
    meta.announced.push(id);
    if (unlock.kind === 'booster') {
      meta.boosters[id] = (meta.boosters[id] || 0) + (unlock.gift || 0);
      meta.try_booster = id;
    }
    return unlock;
  }

  /** The Sweet Streak bag for a streak length (null at 0). */
  function streakBag(streak) {
    return STREAK_BAGS[Math.min(STREAK_MAX, Math.max(0, streak || 0))] || null;
  }

  /** Episode completion reward: Gold Drops growing with the episode, plus one of the unlocked in-level boosters. */
  function episodeReward(meta, episode, reached_level) {
    const boosters = IN_LEVEL.filter((booster) => isUnlocked(meta, reached_level, booster));
    return { gold: 40 + 10 * Math.min(6, episode), booster: boosters.length ? boosters[(episode - 1) % boosters.length] : null };
  }

  /** Gives an episode's completion reward once; returns it, or null when it was given before. */
  function claimEpisode(meta, episode, reached_level) {
    if (episode <= meta.episodes_claimed) return null;
    const reward = episodeReward(meta, episode, reached_level);
    meta.episodes_claimed = episode;
    meta.gold += reward.gold;
    if (reward.booster) meta.boosters[reward.booster] = (meta.boosters[reward.booster] || 0) + 1;
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
   * Applies a finished level to the meta game. outcome: {won, new_stars, crown, new_level, streak_on} (new_stars = stars
   * above the previous best; crown = won on the very first attempt; new_level = not won before; streak_on = the Sweet
   * Streak is unlocked). Replays never touch the streak. Returns { gold, streak, streak_lost, chest_ready }.
   */
  function recordOutcome(save, outcome, total_stars) {
    const meta = save.meta;
    const rewards = { gold: 0, streak: meta.streak, streak_lost: 0, chest_ready: false };
    if (outcome.won) {
      rewards.gold = 5 + 10 * Math.max(0, outcome.new_stars || 0) + (outcome.crown ? 5 : 0);
      meta.gold += rewards.gold;
      if (outcome.streak_on && outcome.new_level) meta.streak = outcome.crown ? meta.streak + 1 : 0;
    } else if (outcome.streak_on && outcome.new_level && meta.streak > 0) {
      rewards.streak_lost = meta.streak;
      meta.streak = 0;
    }
    rewards.streak = meta.streak;
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
    MAX_HEARTS, HEART_REFILL_MS, CHEST_STARS, PRICES, CONTINUE_PRICES, BOOSTER_NAMES, WHEEL, CHEST, UNLOCKS, STREAK_MAX, STREAK_BAGS,
    refreshHearts, nextHeartIn, heartsEnabled, canPlay, spendHeart, grantHearts, boosterCount, useBooster, buy, applyReward,
    continuePrice, unlockOf, isUnlocked, pendingUnlocks, announceUnlock, streakBag, episodeReward, claimEpisode,
    localDay, canSpin, spinWheel, recordOutcome, chestReady, chestProgress, openChest, createHintScheduler,
  };
  SC.META = META;
  if (typeof module === 'object' && module.exports) module.exports = META;
})(typeof window !== 'undefined' ? window : globalThis);
