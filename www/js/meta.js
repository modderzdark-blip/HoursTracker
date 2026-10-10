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
    { id: 'daily', kind: 'feature', level: 18, title: 'Daily Challenges', text: 'Three new challenges every day. Finish each one for a gift, and all three for a bonus box!' },
    { id: 'chest', kind: 'feature', level: 20, title: 'Star Chest', text: 'Every 25 stars you earn fill the chest with a gift.' },
    { id: 'lucky', kind: 'booster', level: 22, gift: 2, title: 'Lucky Start', text: 'Start a level with a striped and a wrapped candy on the board.' },
    { id: 'streak', kind: 'feature', level: 25, title: 'Sweet Streak', text: 'Win new levels on the first try, one after another: each win puts more special candies on your next new level. Losing a level ends the streak.' },
    { id: 'whirl', kind: 'booster', level: 28, gift: 3, title: 'Candy Whirl', text: 'Stuck? Mix up the whole board. No move used.' },
    { id: 'head_start', kind: 'booster', level: 35, gift: 2, title: 'Head Start', text: 'Start a level with 3 extra moves.' },
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

  // Beating a Hard or Super Hard level for the first time pays a bonus (the original fills its rewards faster there too).
  const HARD_BONUS = Object.freeze({ hard: 20, superhard: 50 });

  // Treasure on the map: every 5th level (except episode finales, which have their own reward) holds a chest that opens
  // when the level is beaten for the first time.
  const TREASURE_EVERY = 5;

  function treasureAt(level_id) {
    return level_id % TREASURE_EVERY === 0 && level_id % 15 !== 0;
  }

  /** The chest on level n: Gold Drops and boosters in turn (a booster only once one is unlocked). */
  function treasureReward(meta, level_id, reached_level) {
    if (!treasureAt(level_id)) return null;
    const turn = Math.floor(level_id / TREASURE_EVERY);
    const boosters = IN_LEVEL.filter((booster) => isUnlocked(meta, reached_level, booster));
    if (turn % 2 === 1 || boosters.length === 0) return { gold: 30 + 10 * Math.min(5, Math.floor(level_id / 30)) };
    return { booster: boosters[Math.floor(turn / 2) % boosters.length], amount: 1 };
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


  // ---------------------------------------------------------------- Daily Challenges

  // Three small challenges a day, picked by the date: progress counts in every level played that day (wins or not),
  // each finished challenge pays its reward, and finishing all three opens a bonus box.
  const DAILY_KINDS = Object.freeze([
    { kind: 'win', range: [2, 3], text: (n) => `Win ${n} levels` },
    { kind: 'striped', range: [8, 14], text: (n) => `Make ${n} striped candies` },
    { kind: 'wrapped', range: [4, 7], text: (n) => `Make ${n} wrapped candies` },
    { kind: 'bomb', range: [1, 3], text: (n) => `Make ${n} Color Bomb${n === 1 ? '' : 's'}` },
    { kind: 'combo', range: [1, 3], text: (n) => `Swap two specials together ${n === 1 ? 'once' : `${n} times`}` },
    { kind: 'jelly', range: [25, 45], text: (n) => `Clear ${n} jelly` },
    { kind: 'blockers', range: [20, 40], text: (n) => `Break ${n} blockers` },
    { kind: 'candies', range: [30, 50], scale: 10, text: (n) => `Clear ${n} candies` },
    { kind: 'cascade', range: [3, 6], text: (n) => `Get "Delicious!" or better ${n} times` },
    { kind: 'first_try', range: [1, 1], text: () => 'Win a level on the first try' },
  ]);
  const DAILY_SLOTS = 3;

  function dayRng(day, salt) {
    return UTIL.createRng(day.split('-').reduce((hash, part) => hash * 131 + Number(part), 17 + salt));
  }

  /** The three challenges of a local day ('YYYY-MM-DD'): distinct kinds and targets, the same for the whole day. */
  function dailyQuests(day) {
    const rng = dayRng(day, 0);
    const pool = DAILY_KINDS.slice();
    const quests = [];
    while (quests.length < DAILY_SLOTS && pool.length) {
      const entry = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const target = (entry.range[0] + Math.floor(rng() * (entry.range[1] - entry.range[0] + 1))) * (entry.scale || 1);
      quests.push({ kind: entry.kind, target, text: entry.text(target) });
    }
    return quests;
  }

  function dailyRewards(meta, reached_level, day) {
    const boosters = IN_LEVEL.filter((booster) => isUnlocked(meta, reached_level, booster));
    const rng = dayRng(day, 5);
    const booster = boosters.length ? boosters[Math.floor(rng() * boosters.length)] : null;
    return [
      { kind: 'gold', amount: 25, label: '25 Gold Drops' },
      booster ? { kind: 'booster', booster, label: BOOSTER_NAMES[booster] } : { kind: 'gold', amount: 40, label: '40 Gold Drops' },
      { kind: 'gold', amount: 50, label: '50 Gold Drops' },
    ];
  }

  function dailyBonus(meta, reached_level, day) {
    const boosters = IN_LEVEL.filter((booster) => isUnlocked(meta, reached_level, booster));
    const booster = boosters.length ? boosters[Math.floor(dayRng(day, 9)() * boosters.length)] : null;
    return { gold: 80, booster, label: booster ? `80 Gold Drops and a ${BOOSTER_NAMES[booster]}` : '80 Gold Drops' };
  }

  /** Starts a fresh set of challenges when the local day changed. */
  function refreshDaily(meta, now) {
    const day = localDay(now);
    if (!meta.daily || meta.daily.day !== day) meta.daily = { day, progress: [0, 0, 0], claimed: [false, false, false], bonus: false };
    return meta.daily;
  }

  /**
   * Adds a level's (or a move's) tallies, e.g. { striped: 2, candies: 31 }, to today's challenges. Returns the
   * challenges this finished (for a "challenge complete" toast).
   */
  function trackDaily(meta, now, tallies) {
    const daily = refreshDaily(meta, now);
    const finished = [];
    dailyQuests(daily.day).forEach((quest, index) => {
      const add = tallies[quest.kind] || 0;
      if (!add || daily.progress[index] >= quest.target) return;
      daily.progress[index] = Math.min(quest.target, daily.progress[index] + add);
      if (daily.progress[index] >= quest.target) finished.push(quest);
    });
    return finished;
  }

  /** Today's challenges with progress and rewards, the bonus box, and how many rewards wait to be claimed. */
  function dailyStatus(meta, now, reached_level) {
    const daily = refreshDaily(meta, now);
    const rewards = dailyRewards(meta, reached_level, daily.day);
    const quests = dailyQuests(daily.day).map((quest, index) => Object.assign({}, quest, {
      progress: daily.progress[index], done: daily.progress[index] >= quest.target, claimed: daily.claimed[index], reward: rewards[index],
    }));
    const all_claimed = quests.every((quest) => quest.claimed);
    const bonus = { ready: all_claimed && !daily.bonus, claimed: daily.bonus, reward: dailyBonus(meta, reached_level, daily.day) };
    const claimable = quests.filter((quest) => quest.done && !quest.claimed).length + (bonus.ready ? 1 : 0);
    return { day: daily.day, quests, bonus, claimable };
  }

  /** Claims a finished challenge's reward (once). Returns the reward, or null. */
  function claimDaily(meta, now, index, reached_level) {
    const status = dailyStatus(meta, now, reached_level);
    const quest = status.quests[index];
    if (!quest || !quest.done || quest.claimed) return null;
    meta.daily.claimed[index] = true;
    return applyReward(meta, quest.reward, now);
  }

  /** Opens the bonus box once all three rewards are claimed. Returns the reward, or null. */
  function claimDailyBonus(meta, now, reached_level) {
    const status = dailyStatus(meta, now, reached_level);
    if (!status.bonus.ready) return null;
    meta.daily.bonus = true;
    const reward = status.bonus.reward;
    meta.gold += reward.gold;
    if (reward.booster) meta.boosters[reward.booster] = (meta.boosters[reward.booster] || 0) + 1;
    return reward;
  }

  // ---------------------------------------------------------------- results: streak, stars, chest

  /**
   * Applies a finished level to the meta game. outcome: {won, new_stars, crown, mastery, new_level, streak_on, role,
   * level_id} (new_stars = stars above the previous best; crown = won on the very first attempt; mastery = a crown with
   * 5+ moves left; new_level = not won before; streak_on = the Sweet Streak is unlocked). Replays never touch the
   * streak, and the hard-level bonus and map treasure pay only on the first win.
   * Returns { gold, hard_bonus, treasure, streak, streak_lost, chest_ready } (gold includes the bonus and treasure gold).
   */
  function recordOutcome(save, outcome, total_stars) {
    const meta = save.meta;
    const rewards = { gold: 0, hard_bonus: 0, treasure: null, streak: meta.streak, streak_lost: 0, chest_ready: false };
    if (outcome.won) {
      rewards.gold = 5 + 10 * Math.max(0, outcome.new_stars || 0) + (outcome.crown ? 5 : 0) + (outcome.mastery ? 10 : 0);
      if (outcome.new_level) {
        rewards.hard_bonus = HARD_BONUS[outcome.role] || 0;
        rewards.gold += rewards.hard_bonus;
        rewards.treasure = treasureReward(meta, outcome.level_id, save.unlocked);
        if (rewards.treasure && rewards.treasure.gold) rewards.gold += rewards.treasure.gold;
        if (rewards.treasure && rewards.treasure.booster) meta.boosters[rewards.treasure.booster] = (meta.boosters[rewards.treasure.booster] || 0) + rewards.treasure.amount;
      }
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
    HARD_BONUS, TREASURE_EVERY, treasureAt, treasureReward,
    localDay, canSpin, spinWheel, recordOutcome, chestReady, chestProgress, openChest, createHintScheduler,
    DAILY_KINDS, dailyQuests, refreshDaily, trackDaily, dailyStatus, claimDaily, claimDailyBonus,
  };
  SC.META = META;
  if (typeof module === 'object' && module.exports) module.exports = META;
})(typeof window !== 'undefined' ? window : globalThis);
