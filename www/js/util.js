// UTIL: seeded RNG (mulberry32), easing curves and small helpers. DOM-free; shared by the game, the tests and the self-test.
(function attachUtil(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  /** Advances a mulberry32 generator whose 32-bit state lives on `holder.rng_state`; returns a float in [0, 1). */
  function rngNext(holder) {
    holder.rng_state = (holder.rng_state + 0x6D2B79F5) | 0;
    let mixed = holder.rng_state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a standalone mulberry32 generator function for the given seed. */
  function createRng(seed) {
    const holder = { rng_state: seed | 0 };
    const next_float = () => rngNext(holder);
    next_float.int = (exclusive_max) => Math.floor(rngNext(holder) * exclusive_max);
    next_float.pick = (items) => items[Math.floor(rngNext(holder) * items.length)];
    return next_float;
  }

  const EASE = {
    linear: (t) => t,
    inQuad: (t) => t * t,
    outQuad: (t) => t * (2 - t),
    inOutQuad: (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
    outCubic: (t) => 1 - Math.pow(1 - t, 3),
    inCubic: (t) => t * t * t,
    outBack: (t) => {
      const overshoot = 1.70158;
      const shifted = t - 1;
      return 1 + (overshoot + 1) * shifted * shifted * shifted + overshoot * shifted * shifted;
    },
    outElastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    spring: (t) => 1 - Math.cos(t * Math.PI * 4.5) * Math.exp(-t * 6),
  };

  function clamp(value, minimum, maximum) {
    return value < minimum ? minimum : value > maximum ? maximum : value;
  }

  function lerp(from, to, t) {
    return from + (to - from) * t;
  }

  const UTIL = { rngNext, createRng, EASE, clamp, lerp };
  SC.UTIL = UTIL;
  if (typeof module === 'object' && module.exports) module.exports = UTIL;
})(typeof window !== 'undefined' ? window : globalThis);
