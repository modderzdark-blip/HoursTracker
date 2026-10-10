// AUDIO: bright, juicy candy-shop sound, synthesized live with the Web Audio API (no audio files to load).
// Instruments: a crisp bubble pop, marimba, glockenspiel and celesta (modal synthesis: each partial rings and fades on
// its own), FM chimes, plucked strings, synth brass, filtered-noise swishes and crunches and a soft sub "thump" for
// blasts. Everything plays through a small room reverb, a gentle glue compressor and a limiter, so a pile-up of blasts
// and cascades never clips.
// Matches climb a bright pentatonic scale with every cascade step; each special candy has its own signature (striped
// "zing", wrapped "boom", color bomb "whirr"); every blocker breaks with its own sound (jelly "splotch", frosting
// "crunch", cage "clink" ...). The music is a looping arrangement with a real tune: pizzicato bass, marimba, celesta,
// harp and a soft shaker.
// Checked in CI by tests/audio: no clipping at full volume, click-free starts and ends, no harsh top end, sensible
// lengths and a seamless music loop. renderSoundOffline(name, params, options) renders any sound for those tests.
(function attachAudio(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const PEAK_EFFECTS = 0.9;
  const MAX_VOICES = 14;
  const PRE_ROLL_S = 0.003; // every sound begins a few ms after its start time, so its first samples are silence
  const RATE_LIMIT_MS = { land: 90, match: 35, bonus: 28, jelly: 45, frosting: 45, cocoa: 45, cage: 45, swirl: 45, popcorn: 45, key: 60, mood: 200 };
  const DEFAULT_RATE_LIMIT_MS = 50;

  const db = (decibels) => Math.pow(10, decibels / 20);
  const mtof = (midi_note) => 440 * Math.pow(2, (midi_note - 69) / 12);
  // The match scale: C major pentatonic from C5; every cascade step climbs one note.
  const MATCH_SCALE = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];

  // ---------------------------------------------------------------- building blocks

  const NOISE = typeof WeakMap === 'function' ? new WeakMap() : null;

  /** Two seconds of seeded white noise per audio context (looped by the players). */
  function noiseBuffer(ctx) {
    const cached = NOISE && NOISE.get(ctx);
    if (cached) return cached;
    const length = Math.floor(ctx.sampleRate * 2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 2463534242;
    for (let index = 0; index < length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[index] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    if (NOISE) NOISE.set(ctx, buffer);
    return buffer;
  }

  /** Click-free envelope: 0 -> peak (linear attack) -> hold -> exponential fall of 70 dB over `release` -> 0. */
  function envelope(param, start, attack, hold, release, peak) {
    param.setValueAtTime(0, start);
    param.linearRampToValueAtTime(peak, start + attack);
    if (hold > 0) param.setValueAtTime(peak, start + attack + hold);
    const end = start + attack + hold + release;
    param.exponentialRampToValueAtTime(Math.max(0.000001, peak * 0.0003), end);
    param.linearRampToValueAtTime(0, end + 0.012);
    return end + 0.012;
  }

  /** A chain of biquad filters ({ type, freq, to, time, q, gain }); `to` sweeps the cutoff exponentially. */
  function makeFilters(ctx, specs, start) {
    const list = (Array.isArray(specs) ? specs : [specs]).filter(Boolean).map((spec) => {
      const filter = ctx.createBiquadFilter();
      filter.type = spec.type || 'lowpass';
      filter.Q.value = spec.q === undefined ? 0.7 : spec.q;
      if (spec.gain !== undefined) filter.gain.value = spec.gain;
      filter.frequency.setValueAtTime(spec.freq, start);
      if (spec.to) filter.frequency.exponentialRampToValueAtTime(spec.to, start + (spec.time || 0.1));
      if (spec.then) filter.frequency.exponentialRampToValueAtTime(spec.then, start + (spec.time || 0.1) + (spec.then_time || 0.2));
      return filter;
    });
    for (let index = 1; index < list.length; index += 1) list[index - 1].connect(list[index]);
    return list;
  }

  function route(source, filters, destination) {
    if (filters.length) {
      source.connect(filters[0]);
      filters[filters.length - 1].connect(destination);
    } else {
      source.connect(destination);
    }
  }

  /** One oscillator voice: any wave, optional pitch glide, vibrato, detuned unison and filters. */
  function tone(ctx, out, o) {
    const start = o.start + PRE_ROLL_S;
    const attack = Math.max(0.002, o.attack || 0.004);
    const hold = o.hold || 0;
    const release = Math.max(0.03, o.release || 0.15);
    const gain = ctx.createGain();
    const end = envelope(gain.gain, start, attack, hold, release, o.peak);
    route(gain, o.filter ? makeFilters(ctx, o.filter, start) : [], out);
    const detunes = o.spread ? [-o.spread, o.spread] : [0];
    let mix = gain;
    if (detunes.length > 1) {
      mix = ctx.createGain();
      mix.gain.value = 0.62;
      mix.connect(gain);
    }
    detunes.forEach((cents) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = o.type || 'sine';
      oscillator.frequency.setValueAtTime(o.freq, start);
      if (o.to) oscillator.frequency.exponentialRampToValueAtTime(o.to, start + (o.glide || attack + hold + release * 0.5));
      if (cents) oscillator.detune.setValueAtTime(cents, start);
      if (o.vibrato) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = o.vibrato.rate || 5.5;
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, start);
        depth.gain.linearRampToValueAtTime(o.vibrato.cents || 18, start + (o.vibrato.delay || 0.08));
        lfo.connect(depth);
        depth.connect(oscillator.detune);
        lfo.start(start);
        lfo.stop(end + 0.02);
      }
      oscillator.connect(mix);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    });
    return end + 0.02;
  }

  /** Filtered noise: swishes, crunches, splats, shakers. */
  function noise(ctx, out, o) {
    const start = o.start + PRE_ROLL_S;
    const attack = Math.max(0.001, o.attack || 0.002);
    const hold = o.hold || 0;
    const release = Math.max(0.02, o.release || 0.1);
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx);
    source.loop = true;
    const gain = ctx.createGain();
    const end = envelope(gain.gain, start, attack, hold, release, o.peak);
    route(source, makeFilters(ctx, o.filter, start), gain);
    gain.connect(out);
    const offset = o.offset !== undefined ? o.offset : (start * 7.31) % 1.6;
    source.start(start, Math.max(0, offset));
    source.stop(end + 0.02);
    return end + 0.02;
  }

  // Modal recipes: [frequency ratio, level, decay seconds (70 dB)].
  const MARIMBA = [[1, 1, 0.55], [3.93, 0.26, 0.1], [9.1, 0.05, 0.035]];
  const GLOCK = [[1, 1, 1.2], [2.76, 0.3, 0.42], [5.4, 0.1, 0.16], [8.93, 0.035, 0.07]];
  const CELESTA = [[1, 1, 0.95], [2, 0.28, 0.36], [3, 0.08, 0.18], [4.16, 0.04, 0.09]];
  const XYLO = [[1, 1, 0.24], [3, 0.32, 0.07], [6.1, 0.07, 0.03]];
  const WOOD = [[1, 1, 0.07], [2.32, 0.45, 0.04], [4.25, 0.16, 0.02]];
  const COIN = [[1, 1, 0.55], [1.46, 0.65, 0.42], [2.31, 0.35, 0.26], [3.1, 0.16, 0.16]];
  const METAL = [[1, 1, 0.22], [2.76, 0.6, 0.15], [5.4, 0.3, 0.08], [7.3, 0.12, 0.05]];

  /** A struck instrument: a set of sine partials, each with its own decay (marimba, glockenspiel, wood, coins ...). */
  function mallet(ctx, out, o) {
    const start = o.start + PRE_ROLL_S;
    const scale = o.decay || 1;
    const bus = ctx.createGain();
    bus.gain.value = o.peak;
    route(bus, o.filter ? makeFilters(ctx, o.filter, start) : [], out);
    let end = start;
    o.partials.forEach(([ratio, level, decay]) => {
      const frequency = o.freq * ratio;
      if (frequency > 12000) return;
      const oscillator = ctx.createOscillator();
      oscillator.frequency.setValueAtTime(frequency, start);
      const gain = ctx.createGain();
      const stop = envelope(gain.gain, start, o.attack || 0.0015, 0, decay * scale, level);
      oscillator.connect(gain);
      gain.connect(bus);
      oscillator.start(start);
      oscillator.stop(stop + 0.02);
      end = Math.max(end, stop);
    });
    return end + 0.02;
  }

  /** An FM chime: bright at the strike, mellowing as the modulation index falls. */
  function chime(ctx, out, o) {
    const start = o.start + PRE_ROLL_S;
    const carrier = ctx.createOscillator();
    carrier.frequency.setValueAtTime(o.freq, start);
    const modulator = ctx.createOscillator();
    modulator.frequency.setValueAtTime(o.freq * (o.ratio || 3.5), start);
    const index = ctx.createGain();
    const depth = o.freq * (o.index || 1.6);
    index.gain.setValueAtTime(depth, start);
    index.gain.exponentialRampToValueAtTime(Math.max(1, depth * 0.04), start + (o.index_time || 0.3));
    modulator.connect(index);
    index.connect(carrier.frequency);
    const gain = ctx.createGain();
    const end = envelope(gain.gain, start, o.attack || 0.002, o.hold || 0, o.release || 0.7, o.peak);
    carrier.connect(gain);
    gain.connect(out);
    carrier.start(start);
    modulator.start(start);
    carrier.stop(end + 0.02);
    modulator.stop(end + 0.02);
    return end + 0.02;
  }

  /** A plucked string: a bright sawtooth (or triangle) whose low-pass closes quickly, like pizzicato or a harp. */
  function pluck(ctx, out, o) {
    return tone(ctx, out, {
      start: o.start, type: o.type || 'sawtooth', freq: o.freq, attack: 0.003, release: o.release || 0.5, peak: o.peak,
      filter: { type: 'lowpass', freq: Math.min(9000, o.freq * (o.bright || 7)), to: Math.max(180, o.freq * 1.4), time: o.damp || 0.16, q: 0.9 },
    });
  }

  /** Synth brass: detuned sawtooths with a filter that opens on the attack (fanfares). */
  function brass(ctx, out, o) {
    return tone(ctx, out, {
      start: o.start, type: 'sawtooth', freq: o.freq, spread: 7, attack: 0.025, hold: o.hold || 0.1, release: o.release || 0.35, peak: o.peak,
      vibrato: o.hold > 0.3 ? { rate: 5.2, cents: 10, delay: 0.25 } : null,
      filter: [{ type: 'lowpass', freq: 700, to: 3400, time: 0.05, then: 1700, then_time: 0.3, q: 1.1 }, { type: 'highpass', freq: 160 }],
    });
  }

  /** A soft sub "thump" under blasts: a sine falling from `from` to `to` Hz. */
  function thump(ctx, out, t, peak, release, from, to) {
    return tone(ctx, out, { start: t, freq: from || 150, to: to || 45, glide: 0.14, attack: 0.002, release: release || 0.32, peak });
  }

  /** Airy shimmer on top of magic moments. */
  function sparkle(ctx, out, t, peak, length) {
    return noise(ctx, out, { start: t, attack: 0.03, release: length || 0.35, peak, filter: [{ type: 'highpass', freq: 4500, q: 0.5 }, { type: 'lowpass', freq: 8000, q: 0.5 }] });
  }

  /** A swish: band-passed noise sweeping from `from` to `to` Hz. */
  function swish(ctx, out, t, peak, length, from, to) {
    return noise(ctx, out, { start: t, attack: length * 0.35, release: length * 0.75, peak, filter: { type: 'bandpass', freq: from, to, time: length, q: 1.1 } });
  }

  function arpeggio(ctx, out, t, notes, gap, peak, recipe) {
    let end = t;
    notes.forEach((note, index) => {
      end = Math.max(end, mallet(ctx, out, { start: t + index * gap, freq: mtof(note), partials: recipe || GLOCK, peak, decay: 0.8 }));
    });
    return end;
  }

  // ---------------------------------------------------------------- the sound list

  /** Each plays into `out` at time `t` and returns its end time. `duration_ms` is the length the audio tests expect. */
  const SOUNDS = {
    // ---- interface
    tap: {
      dry: true,
      duration_ms: 90,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.001, release: 0.02, peak: 0.05, filter: { type: 'bandpass', freq: 3200, q: 1.2 } });
        return tone(ctx, out, { start: t, freq: 1050, to: 560, glide: 0.045, attack: 0.002, release: 0.07, peak: 0.17 });
      },
    },
    open: {
      dry: true,
      duration_ms: 220,
      play(ctx, out, t) {
        swish(ctx, out, t, 0.06, 0.16, 500, 2200);
        return tone(ctx, out, { start: t + 0.03, freq: 520, to: 880, glide: 0.07, attack: 0.004, release: 0.1, peak: 0.12 });
      },
    },
    select: { dry: true, duration_ms: 140, play: (ctx, out, t) => mallet(ctx, out, { start: t, freq: mtof(88), partials: XYLO, peak: 0.11, decay: 0.6 }) },
    swap: {
      dry: true,
      duration_ms: 160,
      play(ctx, out, t) {
        swish(ctx, out, t, 0.16, 0.13, 700, 3000);
        return tone(ctx, out, { start: t, freq: 480, to: 760, glide: 0.08, attack: 0.006, release: 0.08, peak: 0.08 });
      },
    },
    nope: {
      dry: true,
      duration_ms: 260,
      play(ctx, out, t) {
        tone(ctx, out, { start: t, type: 'triangle', freq: 392, to: 311, glide: 0.08, attack: 0.004, release: 0.1, peak: 0.16, filter: { type: 'lowpass', freq: 2200 } });
        return tone(ctx, out, { start: t + 0.1, type: 'triangle', freq: 330, to: 247, glide: 0.1, attack: 0.004, release: 0.14, peak: 0.15, filter: { type: 'lowpass', freq: 2000 } });
      },
    },
    land: { dry: true, duration_ms: 70, play: (ctx, out, t) => mallet(ctx, out, { start: t, freq: 620, partials: WOOD, peak: 0.07 }) },

    // ---- matches and special candies
    match: {
      duration_ms: 360,
      play(ctx, out, t, params) {
        const depth = Math.max(1, (params && params.depth) || 1);
        const frequency = mtof(MATCH_SCALE[Math.min(MATCH_SCALE.length - 1, depth - 1)]);
        tone(ctx, out, { start: t, freq: frequency * 2.2, to: frequency, glide: 0.025, attack: 0.002, release: 0.12, peak: 0.13 });
        noise(ctx, out, { start: t, attack: 0.001, release: 0.035, peak: 0.06, filter: [{ type: 'highpass', freq: 2400 }, { type: 'lowpass', freq: 7000 }] });
        let end = mallet(ctx, out, { start: t + 0.004, freq: frequency, partials: MARIMBA, peak: 0.2 });
        if (depth >= 3) end = Math.max(end, mallet(ctx, out, { start: t + 0.01, freq: Math.min(3200, frequency * 2), partials: GLOCK, peak: 0.05 + 0.012 * Math.min(6, depth), decay: 0.5 }));
        return end;
      },
    },
    create: {
      duration_ms: 520,
      play(ctx, out, t, params) {
        const special = (params && params.special) || 'striped';
        let end;
        if (special === 'bomb') {
          end = arpeggio(ctx, out, t, [84, 88, 91, 96, 100], 0.045, 0.13, CELESTA);
          sparkle(ctx, out, t, 0.04, 0.5);
          chime(ctx, out, { start: t, freq: mtof(72), ratio: 2, index: 1.2, release: 0.8, peak: 0.12 });
        } else if (special === 'wrapped') {
          tone(ctx, out, { start: t, freq: 300, to: 900, glide: 0.07, attack: 0.004, release: 0.09, peak: 0.16 });
          tone(ctx, out, { start: t + 0.08, freq: 450, to: 1300, glide: 0.07, attack: 0.004, release: 0.1, peak: 0.13 });
          end = arpeggio(ctx, out, t + 0.06, [84, 91], 0.07, 0.12, CELESTA);
          sparkle(ctx, out, t, 0.03, 0.3);
        } else {
          end = arpeggio(ctx, out, t, [79, 84, 88], 0.045, 0.14, CELESTA);
          swish(ctx, out, t, 0.05, 0.16, 1500, 6000);
        }
        return end;
      },
    },
    striped: {
      duration_ms: 380,
      play(ctx, out, t) {
        tone(ctx, out, { start: t, type: 'sawtooth', freq: 1900, to: 260, glide: 0.24, attack: 0.003, release: 0.26, peak: 0.1, filter: { type: 'lowpass', freq: 5000, to: 900, time: 0.25, q: 2 } });
        swish(ctx, out, t, 0.16, 0.26, 3200, 650);
        return thump(ctx, out, t, 0.22, 0.2, 170, 80);
      },
    },
    wrapped: {
      duration_ms: 520,
      play(ctx, out, t) {
        thump(ctx, out, t, 0.5, 0.4, 150, 42);
        noise(ctx, out, { start: t, attack: 0.002, release: 0.42, peak: 0.32, filter: { type: 'lowpass', freq: 2200, to: 300, time: 0.35, q: 0.8 } });
        return noise(ctx, out, { start: t + 0.02, attack: 0.002, release: 0.14, peak: 0.07, filter: { type: 'highpass', freq: 3000 } });
      },
    },
    bomb: {
      duration_ms: 950,
      play(ctx, out, t) {
        tone(ctx, out, { start: t, type: 'sawtooth', freq: 220, to: 1760, glide: 0.42, attack: 0.05, hold: 0.28, release: 0.2, peak: 0.08, filter: { type: 'lowpass', freq: 700, to: 5200, time: 0.42, q: 5 } });
        arpeggio(ctx, out, t + 0.04, [84, 86, 88, 91, 93, 96], 0.06, 0.08, CELESTA);
        sparkle(ctx, out, t + 0.05, 0.05, 0.6);
        thump(ctx, out, t + 0.44, 0.45, 0.4, 160, 42);
        return noise(ctx, out, { start: t + 0.44, attack: 0.002, release: 0.45, peak: 0.28, filter: { type: 'lowpass', freq: 2600, to: 350, time: 0.4 } });
      },
    },
    combo: {
      duration_ms: 1000,
      play(ctx, out, t) {
        thump(ctx, out, t, 0.55, 0.45, 160, 40);
        noise(ctx, out, { start: t, attack: 0.002, release: 0.5, peak: 0.3, filter: { type: 'lowpass', freq: 2800, to: 300, time: 0.45 } });
        [60, 64, 67, 72].forEach((note) => brass(ctx, out, { start: t + 0.02, freq: mtof(note), hold: 0.12, release: 0.45, peak: 0.05 }));
        return arpeggio(ctx, out, t + 0.06, [84, 88, 91, 96], 0.05, 0.1);
      },
    },
    bonus: {
      // Sweet Finale: a leftover move turns into a striped candy; each one rings a step higher.
      duration_ms: 320,
      play(ctx, out, t, params) {
        const step = Math.max(0, (params && params.step) || 0);
        const note = Math.min(103, MATCH_SCALE[step % 6 + 2] + 12 * Math.floor(step / 6));
        sparkle(ctx, out, t, 0.02, 0.15);
        return mallet(ctx, out, { start: t, freq: mtof(note), partials: CELESTA, peak: 0.15, decay: 0.45 });
      },
    },
    finale: {
      duration_ms: 1300,
      play(ctx, out, t) {
        swish(ctx, out, t, 0.12, 0.5, 300, 5000);
        [60, 64, 67, 72].forEach((note) => brass(ctx, out, { start: t + 0.3, freq: mtof(note), hold: 0.45, release: 0.5, peak: 0.05 }));
        thump(ctx, out, t + 0.3, 0.3, 0.35, 140, 50);
        sparkle(ctx, out, t + 0.3, 0.04, 0.7);
        return arpeggio(ctx, out, t + 0.32, [84, 88, 91, 96], 0.07, 0.11);
      },
    },
    praise: {
      // Sweet! Tasty! Delicious! Divine! A bell strum that grows brighter with the word.
      duration_ms: 900,
      play(ctx, out, t, params) {
        const level = Math.min(4, Math.max(0, ((params && params.depth) || 2) - 2));
        const chord = [72, 76, 79, 84, 88].slice(0, 3 + Math.min(2, level));
        let end = t;
        chord.forEach((note, index) => {
          end = Math.max(end, chime(ctx, out, { start: t + index * 0.035, freq: mtof(note + level), ratio: 3.5, index: 1.1, release: 0.9, peak: 0.13 }));
        });
        sparkle(ctx, out, t, 0.03 + 0.01 * level, 0.6);
        if (level >= 2) end = Math.max(end, arpeggio(ctx, out, t + 0.15, [91 + level, 96 + level], 0.07, 0.07));
        return end;
      },
    },
    shuffle: {
      duration_ms: 650,
      play(ctx, out, t) {
        swish(ctx, out, t, 0.12, 0.3, 500, 2800);
        swish(ctx, out, t + 0.25, 0.1, 0.3, 2800, 600);
        return arpeggio(ctx, out, t + 0.1, [79, 84, 88, 84], 0.08, 0.06, CELESTA);
      },
    },

    // ---- blockers and board pieces
    jelly: {
      dry: true,
      duration_ms: 200,
      play(ctx, out, t) {
        tone(ctx, out, { start: t, freq: 640, to: 170, glide: 0.09, attack: 0.003, release: 0.13, peak: 0.18 });
        return noise(ctx, out, { start: t, attack: 0.003, release: 0.11, peak: 0.13, filter: { type: 'bandpass', freq: 1500, to: 380, time: 0.1, q: 2.6 } });
      },
    },
    frosting: {
      dry: true,
      duration_ms: 200,
      play(ctx, out, t) {
        [0, 0.024, 0.052].forEach((offset, index) => {
          noise(ctx, out, { start: t + offset, attack: 0.001, release: 0.035, peak: [0.17, 0.12, 0.08][index], filter: [{ type: 'highpass', freq: 1700 }, { type: 'lowpass', freq: 6500 }] });
        });
        return mallet(ctx, out, { start: t + 0.01, freq: 2093, partials: GLOCK, peak: 0.045, decay: 0.25 });
      },
    },
    cocoa: {
      dry: true,
      duration_ms: 170,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.002, release: 0.1, peak: 0.22, filter: { type: 'lowpass', freq: 1000, q: 1.2 } });
        return tone(ctx, out, { start: t, freq: 230, to: 110, glide: 0.08, attack: 0.002, release: 0.12, peak: 0.18 });
      },
    },
    cocoa_spread: {
      dry: true,
      duration_ms: 220,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.03, release: 0.14, peak: 0.07, filter: { type: 'lowpass', freq: 600 } });
        return tone(ctx, out, { start: t, freq: 140, to: 200, glide: 0.12, attack: 0.03, release: 0.14, peak: 0.15 });
      },
    },
    cage: {
      dry: true,
      duration_ms: 260,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.001, release: 0.018, peak: 0.12, filter: { type: 'bandpass', freq: 4200, q: 1.5 } });
        mallet(ctx, out, { start: t, freq: 1250, partials: METAL, peak: 0.12 });
        return mallet(ctx, out, { start: t + 0.045, freq: 1580, partials: METAL, peak: 0.07 });
      },
    },
    swirl: {
      dry: true,
      duration_ms: 170,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.001, release: 0.04, peak: 0.07, filter: { type: 'bandpass', freq: 2200, q: 1.4 } });
        return tone(ctx, out, { start: t, type: 'triangle', freq: 760, to: 330, glide: 0.08, attack: 0.002, release: 0.11, peak: 0.17, filter: { type: 'lowpass', freq: 3000 } });
      },
    },
    gift: {
      duration_ms: 420,
      play(ctx, out, t) {
        swish(ctx, out, t, 0.12, 0.14, 1400, 5200);
        return arpeggio(ctx, out, t + 0.07, [88, 91, 96], 0.06, 0.12, CELESTA);
      },
    },
    popcorn: {
      dry: true,
      duration_ms: 150,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.001, release: 0.03, peak: 0.16, filter: { type: 'bandpass', freq: 1900, q: 1.3 } });
        return mallet(ctx, out, { start: t, freq: 880, partials: WOOD, peak: 0.16 });
      },
    },
    popcorn_burst: {
      duration_ms: 700,
      play(ctx, out, t) {
        [0, 0.05, 0.09, 0.14].forEach((offset, index) => {
          noise(ctx, out, { start: t + offset, attack: 0.001, release: 0.04, peak: 0.16 - index * 0.025, filter: { type: 'bandpass', freq: 1600 + index * 500, q: 1.3 } });
        });
        thump(ctx, out, t, 0.25, 0.25, 220, 70);
        return arpeggio(ctx, out, t + 0.12, [84, 88, 91, 96], 0.05, 0.11, CELESTA);
      },
    },
    key: {
      duration_ms: 420,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 2349, partials: COIN, peak: 0.08, decay: 0.6 });
        mallet(ctx, out, { start: t + 0.06, freq: 2793, partials: COIN, peak: 0.07, decay: 0.6 });
        return mallet(ctx, out, { start: t + 0.12, freq: 3136, partials: COIN, peak: 0.06, decay: 0.7 });
      },
    },
    chest: {
      duration_ms: 650,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 220, partials: WOOD, peak: 0.3, decay: 1.6 });
        mallet(ctx, out, { start: t + 0.03, freq: 1400, partials: METAL, peak: 0.08 });
        return arpeggio(ctx, out, t + 0.12, [79, 84, 88, 91], 0.06, 0.11, CELESTA);
      },
    },
    mixer: {
      duration_ms: 420,
      play(ctx, out, t) {
        tone(ctx, out, { start: t, type: 'square', freq: 95, to: 140, glide: 0.3, attack: 0.04, hold: 0.18, release: 0.16, peak: 0.07, vibrato: { rate: 14, cents: 60, delay: 0.02 }, filter: { type: 'lowpass', freq: 650, q: 2 } });
        return tone(ctx, out, { start: t + 0.25, freq: 500, to: 260, glide: 0.08, attack: 0.003, release: 0.1, peak: 0.15 });
      },
    },
    mood: {
      duration_ms: 260,
      play(ctx, out, t) {
        chime(ctx, out, { start: t, freq: mtof(88), ratio: 2.01, index: 0.8, release: 0.3, peak: 0.05 });
        return chime(ctx, out, { start: t + 0.05, freq: mtof(91), ratio: 2.01, index: 0.8, release: 0.3, peak: 0.04 });
      },
    },
    ingredient: {
      duration_ms: 480,
      play(ctx, out, t) {
        swish(ctx, out, t, 0.05, 0.2, 1000, 4500);
        mallet(ctx, out, { start: t, freq: mtof(79), partials: GLOCK, peak: 0.17, decay: 0.6 });
        return mallet(ctx, out, { start: t + 0.09, freq: mtof(84), partials: GLOCK, peak: 0.19, decay: 0.7 });
      },
    },
    hammer: {
      dry: true,
      duration_ms: 300,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 420, partials: WOOD, peak: 0.34, decay: 1.4 });
        thump(ctx, out, t, 0.32, 0.25, 160, 55);
        return noise(ctx, out, { start: t + 0.01, attack: 0.001, release: 0.09, peak: 0.14, filter: [{ type: 'highpass', freq: 1500 }, { type: 'lowpass', freq: 6000 }] });
      },
    },
    belt: {
      dry: true,
      duration_ms: 200,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 320, partials: WOOD, peak: 0.12 });
        mallet(ctx, out, { start: t + 0.07, freq: 270, partials: WOOD, peak: 0.1 });
        return noise(ctx, out, { start: t, attack: 0.01, release: 0.09, peak: 0.035, filter: { type: 'lowpass', freq: 1200 } });
      },
    },
    fuse_tick: {
      dry: true,
      duration_ms: 220,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 1800, partials: WOOD, peak: 0.12 });
        return mallet(ctx, out, { start: t + 0.13, freq: 1500, partials: WOOD, peak: 0.1 });
      },
    },
    fuse_out: {
      duration_ms: 800,
      play(ctx, out, t) {
        thump(ctx, out, t, 0.55, 0.6, 140, 35);
        noise(ctx, out, { start: t, attack: 0.002, release: 0.65, peak: 0.34, filter: { type: 'lowpass', freq: 2400, to: 220, time: 0.6 } });
        return tone(ctx, out, { start: t + 0.1, type: 'triangle', freq: 440, to: 140, glide: 0.5, attack: 0.02, release: 0.55, peak: 0.08 });
      },
    },
    moves_low: {
      duration_ms: 420,
      play(ctx, out, t) {
        chime(ctx, out, { start: t, freq: mtof(88), ratio: 3.5, index: 1, release: 0.35, peak: 0.1 });
        return chime(ctx, out, { start: t + 0.13, freq: mtof(84), ratio: 3.5, index: 1, release: 0.4, peak: 0.1 });
      },
    },

    // ---- rewards and results
    star: {
      duration_ms: 700,
      play(ctx, out, t, params) {
        const note = [84, 88, 91][Math.min(2, Math.max(0, (params && params.index) || 0))];
        sparkle(ctx, out, t, 0.03, 0.4);
        chime(ctx, out, { start: t, freq: mtof(note + 12), ratio: 2.01, index: 0.6, release: 0.5, peak: 0.04 });
        return mallet(ctx, out, { start: t, freq: mtof(note), partials: GLOCK, peak: 0.24, decay: 0.75 });
      },
    },
    goal: {
      duration_ms: 520,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: mtof(81), partials: GLOCK, peak: 0.18, decay: 0.6 });
        return mallet(ctx, out, { start: t + 0.08, freq: mtof(88), partials: GLOCK, peak: 0.2, decay: 0.7 });
      },
    },
    win: {
      duration_ms: 1700,
      play(ctx, out, t) {
        [[67, 0], [72, 0.11], [76, 0.22]].forEach(([note, at]) => brass(ctx, out, { start: t + at, freq: mtof(note), hold: 0.04, release: 0.18, peak: 0.1 }));
        [64, 67, 72, 79].forEach((note) => brass(ctx, out, { start: t + 0.34, freq: mtof(note), hold: 0.6, release: 0.6, peak: 0.07 }));
        thump(ctx, out, t + 0.34, 0.3, 0.4, 130, 50);
        sparkle(ctx, out, t + 0.34, 0.04, 0.9);
        return arpeggio(ctx, out, t + 0.4, [84, 88, 91, 96], 0.075, 0.12);
      },
    },
    lose: {
      duration_ms: 1400,
      play(ctx, out, t) {
        const voice = (note, at, hold, sag) => tone(ctx, out, {
          start: t + at, type: 'triangle', freq: mtof(note), to: sag ? mtof(note - 1) : undefined, glide: hold + 0.2, attack: 0.03, hold, release: 0.3, peak: 0.16,
          vibrato: { rate: 5, cents: 14, delay: 0.1 }, filter: { type: 'lowpass', freq: 1800 },
        });
        voice(67, 0, 0.16, false);
        voice(66, 0.3, 0.16, false);
        return voice(65, 0.6, 0.5, true);
      },
    },
    reward: {
      duration_ms: 520,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 1976, partials: COIN, peak: 0.11 });
        return mallet(ctx, out, { start: t + 0.085, freq: 2637, partials: COIN, peak: 0.1 });
      },
    },
    unlock: {
      duration_ms: 950,
      play(ctx, out, t) {
        sparkle(ctx, out, t + 0.05, 0.03, 0.6);
        let end = t;
        [72, 76, 79, 84, 88].forEach((note, index) => {
          end = Math.max(end, chime(ctx, out, { start: t + index * 0.07, freq: mtof(note), ratio: 3.5, index: 1.2, release: 0.6, peak: 0.09 }));
        });
        return end;
      },
    },
    heart_break: {
      duration_ms: 600,
      play(ctx, out, t) {
        noise(ctx, out, { start: t, attack: 0.001, release: 0.06, peak: 0.12, filter: [{ type: 'highpass', freq: 1500 }, { type: 'lowpass', freq: 6000 }] });
        return tone(ctx, out, { start: t + 0.04, type: 'triangle', freq: mtof(64), to: mtof(57), glide: 0.4, attack: 0.02, release: 0.45, peak: 0.13, filter: { type: 'lowpass', freq: 2000 } });
      },
    },
    hop: {
      dry: true,
      duration_ms: 180,
      play(ctx, out, t) {
        mallet(ctx, out, { start: t, freq: 900, partials: WOOD, peak: 0.07 });
        return tone(ctx, out, { start: t, freq: 330, to: 760, glide: 0.09, attack: 0.004, release: 0.1, peak: 0.15 });
      },
    },
    wheel: {
      duration_ms: 3200,
      play(ctx, out, t) {
        let end = t;
        let at = t;
        for (let tick = 0; tick < 22; tick += 1) {
          end = mallet(ctx, out, { start: at, freq: 1500 - tick * 12, partials: WOOD, peak: 0.12 });
          at += 0.05 + tick * tick * 0.0005;
        }
        return end;
      },
    },
  };
  SOUNDS.click = SOUNDS.tap;
  const BIG_SOUNDS = new Set(['bomb', 'combo', 'wrapped', 'win', 'fuse_out', 'hammer', 'finale', 'popcorn_burst']);

  // ---------------------------------------------------------------- music

  // Chord voicings: a bass root (45-55, plucked so phone speakers still hear its harmonics) and mid-range tones.
  const CHORDS = {
    C: { root: 48, tones: [60, 64, 67] },
    C7: { root: 48, tones: [58, 60, 64, 67] },
    Dm: { root: 50, tones: [62, 65, 69] },
    Dm7: { root: 50, tones: [60, 62, 65, 69] },
    Em: { root: 52, tones: [59, 64, 67] },
    F: { root: 53, tones: [60, 65, 69] },
    G: { root: 43, tones: [59, 62, 67] },
    G7: { root: 43, tones: [59, 62, 65, 67] },
    Gm: { root: 43, tones: [58, 62, 67] },
    Gm7: { root: 43, tones: [58, 62, 65, 67] },
    Am: { root: 45, tones: [60, 64, 69] },
    Bb: { root: 46, tones: [58, 62, 65] },
  };

  // Melodies: one entry per bar, each note [eighth (0-7), midi note, length in eighths]. Original tunes.
  const TRACKS = {
    level: {
      bpm: 118,
      swing: 0.6,
      chords: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm7', 'G7', 'F', 'G', 'Em', 'Am', 'Dm7', 'G7', 'C', 'G7'],
      melody: [
        [[0, 67, 1], [1, 72, 1], [2, 76, 1], [3, 79, 1], [4, 76, 2], [6, 72, 2]],
        [[0, 69, 1], [1, 72, 1], [2, 76, 2], [4, 74, 1], [5, 72, 1], [6, 69, 2]],
        [[0, 65, 1], [1, 69, 1], [2, 72, 1], [3, 77, 2], [5, 76, 1], [6, 74, 1], [7, 72, 1]],
        [[0, 74, 2], [2, 71, 2], [4, 67, 4]],
        [[0, 67, 1], [1, 72, 1], [2, 76, 1], [3, 79, 1], [4, 81, 2], [6, 79, 2]],
        [[0, 76, 2], [2, 72, 1], [3, 76, 1], [4, 81, 3]],
        [[0, 77, 1], [1, 76, 1], [2, 74, 1], [3, 72, 1], [4, 69, 2], [6, 72, 1], [7, 74, 1]],
        [[0, 74, 2], [2, 77, 1], [3, 76, 1], [4, 74, 2], [6, 71, 2]],
        [[0, 81, 3], [3, 79, 1], [4, 77, 2], [6, 72, 2]],
        [[0, 79, 3], [3, 77, 1], [4, 74, 2], [6, 71, 2]],
        [[0, 79, 1], [1, 76, 1], [2, 71, 1], [3, 76, 1], [4, 79, 2], [6, 83, 2]],
        [[0, 81, 4], [4, 76, 1], [5, 72, 1], [6, 69, 2]],
        [[0, 74, 1], [1, 77, 1], [2, 81, 2], [4, 84, 2], [6, 81, 2]],
        [[0, 83, 2], [2, 79, 1], [3, 77, 1], [4, 74, 1], [5, 71, 1], [6, 67, 2]],
        [[0, 72, 1], [1, 76, 1], [2, 79, 1], [3, 84, 3], [6, 79, 1], [7, 76, 1]],
        [[0, 74, 3], [3, 77, 1], [4, 74, 2], [6, 71, 2]],
      ],
      style: 'level',
    },
    map: {
      bpm: 92,
      swing: 0.5,
      chords: ['F', 'Dm', 'Bb', 'C', 'F', 'Dm', 'Gm7', 'C7', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'C', 'F', 'F'],
      melody: [
        [[0, 72, 2], [2, 77, 2], [4, 81, 3], [7, 79, 1]],
        [[0, 77, 2], [2, 74, 2], [4, 69, 4]],
        [[0, 70, 2], [2, 74, 2], [4, 77, 2], [6, 74, 1], [7, 77, 1]],
        [[0, 79, 4], [4, 76, 2], [6, 72, 2]],
        [[0, 72, 2], [2, 77, 2], [4, 81, 2], [6, 84, 2]],
        [[0, 81, 2], [2, 77, 1], [3, 81, 1], [4, 86, 4]],
        [[0, 82, 2], [2, 81, 1], [3, 79, 1], [4, 77, 2], [6, 74, 2]],
        [[0, 76, 3], [3, 79, 1], [4, 72, 4]],
        [[0, 74, 2], [2, 77, 2], [4, 82, 4]],
        [[0, 84, 2], [2, 82, 1], [3, 81, 1], [4, 79, 4]],
        [[0, 81, 2], [2, 76, 2], [4, 72, 2], [6, 76, 2]],
        [[0, 77, 4], [4, 74, 4]],
        [[0, 79, 2], [2, 82, 2], [4, 86, 2], [6, 82, 2]],
        [[0, 84, 3], [3, 82, 1], [4, 79, 2], [6, 76, 2]],
        [[0, 77, 2], [2, 81, 2], [4, 84, 2], [6, 81, 2]],
        [[0, 77, 6], [6, 72, 2]],
      ],
      style: 'map',
    },
  };
  TRACKS.title = TRACKS.map;
  const MUSIC = TRACKS;

  /** All the notes of one loop of a track, sorted by time: [{ at (s), kind, midi (number or chord), length (s), peak }]. */
  function musicLoop(track_name) {
    const track = TRACKS[track_name] || TRACKS.level;
    const beat = 60 / track.bpm;
    const bar_length = beat * 4;
    const eighthAt = (bar, eighth) => bar * bar_length + Math.floor(eighth / 2) * beat + (eighth % 2 ? track.swing * beat : 0);
    const notes = [];
    const add = (bar, eighth, kind, midi, eighths, peak) => notes.push({ at: eighthAt(bar, eighth), kind, midi, length: eighths * beat * 0.5, peak });
    track.chords.forEach((chord_name, bar) => {
      const chord = CHORDS[chord_name];
      (track.melody[bar] || []).forEach(([eighth, midi, eighths]) => add(bar, eighth, 'lead', midi, eighths, 1));
      if (track.style === 'level') {
        [[0, 0, 2], [3, 0, 1], [4, 7, 2], [6, 12, 1], [7, 7, 1]].forEach(([eighth, interval, eighths]) => add(bar, eighth, 'bass', chord.root + interval, eighths, eighth === 0 ? 1 : 0.8));
        add(bar, 2, 'comp', chord.tones, 1, 1);
        add(bar, 6, 'comp', chord.tones, 1, 1);
        add(bar, 0, 'kick', 0, 1, 1);
        add(bar, 4, 'kick', 0, 1, 0.8);
        add(bar, 2, 'snap', 0, 1, 1);
        add(bar, 6, 'snap', 0, 1, 1);
        for (let eighth = 0; eighth < 8; eighth += 1) add(bar, eighth, 'shaker', 0, 1, eighth % 2 ? 1 : 0.55);
      } else {
        add(bar, 0, 'bass', chord.root, 4, 1);
        add(bar, 4, 'bass', chord.root + 7, 4, 0.75);
        add(bar, 0, 'pad', chord.tones, 8, 1);
        const arp = chord.tones.slice(0, 3).concat([chord.tones[0] + 12]);
        [0, 1, 2, 3, 2, 1, 2, 1].forEach((position, eighth) => add(bar, eighth, 'arp', arp[position], 2, eighth % 2 ? 0.7 : 1));
        add(bar, 2, 'shaker', 0, 1, 0.6);
        add(bar, 6, 'shaker', 0, 1, 0.6);
      }
    });
    notes.sort((first, second) => first.at - second.at);
    return { notes, length: track.chords.length * bar_length, style: track.style };
  }

  /** Plays one music note with its instrument. */
  function musicNote(ctx, destination, note, start, style) {
    const frequency = typeof note.midi === 'number' ? mtof(note.midi) : 0;
    switch (note.kind) {
      case 'lead':
        if (style === 'map') {
          mallet(ctx, destination, { start, freq: frequency, partials: CELESTA, peak: 0.0682 * note.peak, decay: Math.min(1.4, 0.6 + note.length) });
          return mallet(ctx, destination, { start, freq: frequency * 2, partials: GLOCK, peak: 0.0112 * note.peak, decay: 0.6 });
        }
        mallet(ctx, destination, { start, freq: frequency, partials: MARIMBA, peak: 0.068 * note.peak, decay: Math.min(1.3, 0.7 + note.length) });
        return mallet(ctx, destination, { start, freq: frequency * 2, partials: CELESTA, peak: 0.0248 * note.peak, decay: Math.min(1, 0.4 + note.length) });
      case 'bass':
        return pluck(ctx, destination, { start, freq: frequency, peak: 0.1054 * note.peak, release: Math.max(0.3, note.length * 1.6), bright: 6, damp: 0.12 });
      case 'comp': {
        let end = start;
        note.midi.forEach((midi) => {
          end = Math.max(end, mallet(ctx, destination, { start, freq: mtof(midi), partials: MARIMBA, peak: 0.024 * note.peak, decay: 0.45 }));
        });
        return end;
      }
      case 'arp':
        return pluck(ctx, destination, { start, type: 'triangle', freq: frequency, peak: 0.0372 * note.peak, release: 0.9, bright: 5, damp: 0.25 });
      case 'pad': {
        let end = start;
        note.midi.forEach((midi) => {
          end = Math.max(end, tone(ctx, destination, { start, type: 'triangle', freq: mtof(midi), spread: 6, attack: 0.4, hold: Math.max(0, note.length - 0.4), release: 0.7, peak: 0.0099 * note.peak, filter: { type: 'lowpass', freq: 1400 } }));
        });
        return end;
      }
      case 'kick':
        return thump(ctx, destination, start, 0.08 * note.peak, 0.2, 130, 50);
      case 'snap':
        noise(ctx, destination, { start, attack: 0.001, release: 0.06, peak: 0.031 * note.peak, filter: { type: 'bandpass', freq: 1900, q: 1.4 } });
        return mallet(ctx, destination, { start, freq: 950, partials: WOOD, peak: 0.0155 * note.peak });
      case 'shaker':
        return noise(ctx, destination, { start, attack: 0.006, release: 0.05, peak: 0.0136 * note.peak, filter: [{ type: 'bandpass', freq: 6000, q: 0.9 }, { type: 'lowpass', freq: 8500 }] });
      default:
        return start;
    }
  }

  // ---------------------------------------------------------------- the output chain

  /** A small, bright room: stereo exponentially decaying noise, gently darkened toward the tail. */
  function roomImpulse(ctx) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 1.3);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      let seed = channel ? 1597334677 : 3812015801;
      let smooth = 0;
      for (let index = 0; index < length; index += 1) {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        const white = ((seed >>> 0) / 4294967296) * 2 - 1;
        const position = index / length;
        const darkening = 0.55 - 0.4 * position;
        smooth += darkening * (white - smooth);
        const fade_in = Math.min(1, index / (rate * 0.004));
        data[index] = smooth * Math.pow(1 - position, 3.2) * fade_in;
      }
    }
    return impulse;
  }

  function buildChain(ctx, options) {
    const opts = options || {};
    const soft = !!opts.soft_sounds;
    const effects_bus = ctx.createGain(); // effects with a touch of room
    const effects_dry = ctx.createGain(); // short interface and blocker sounds stay tight and dry
    const music_bus = ctx.createGain();
    const music_duck = ctx.createGain();
    const mix = ctx.createGain();
    const reverb = ctx.createConvolver();
    reverb.buffer = roomImpulse(ctx);
    const effects_send = ctx.createGain();
    effects_send.gain.value = 0.22;
    const music_send = ctx.createGain();
    music_send.gain.value = 0.3;
    const reverb_return = ctx.createGain();
    reverb_return.gain.value = 0.9;
    effects_bus.connect(mix);
    effects_bus.connect(effects_send);
    effects_dry.connect(mix);
    music_bus.connect(music_duck);
    music_duck.connect(mix);
    music_duck.connect(music_send);
    effects_send.connect(reverb);
    music_send.connect(reverb);
    reverb.connect(reverb_return);
    reverb_return.connect(mix);
    // Tone: tame the very top so nothing is piercing (Soft Sounds rounds it off further).
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = soft ? 5200 : 11000;
    lowpass.Q.value = 0.5;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 7000;
    shelf.gain.value = soft ? -6 : -2;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -12;
    glue.knee.value = 12;
    glue.ratio.value = 2.5;
    glue.attack.value = 0.004;
    glue.release.value = 0.16;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.08;
    const trim = ctx.createGain();
    trim.gain.value = soft ? db(-4) : 1;
    const master = ctx.createGain();
    mix.connect(lowpass);
    lowpass.connect(shelf);
    shelf.connect(glue);
    glue.connect(limiter);
    limiter.connect(trim);
    trim.connect(master);
    master.connect(ctx.destination);
    return { effects_bus, effects_dry, music_bus, music_duck, lowpass, shelf, glue, limiter, trim, master };
  }

  /**
   * Renders a sound offline (for the audio tests). name: any key of SOUNDS, 'stress' (6 overlapping big effects over the
   * music) or 'music' (one loop of a track plus the first seconds of the next, to check the seam).
   * options: { master, effects, music, soft_sounds, sample_rate }. Resolves { samples, sample_rate, duration_ms, loop_s }.
   */
  function renderSoundOffline(name, params, options) {
    const opts = Object.assign({ master: 1, effects: 1, music: 1, soft_sounds: false, sample_rate: 44100 }, options || {});
    const OfflineContext = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OfflineContext) return Promise.reject(new Error('OfflineAudioContext is not available'));
    const track = (params && params.track) || 'level';
    // The dynamics processors need a moment to settle after a context starts, so the sound plays SETTLE_S in and the
    // returned samples begin there.
    const SETTLE_S = 0.5;
    let length_s;
    if (name === 'music') length_s = musicLoop(track).length + 4;
    else if (name === 'stress') length_s = 9;
    else length_s = (SOUNDS[name] ? SOUNDS[name].duration_ms : 500) / 1000 + 1.8;
    const ctx = new OfflineContext(1, Math.ceil((length_s + SETTLE_S) * opts.sample_rate), opts.sample_rate);
    const chain = buildChain(ctx, { soft_sounds: opts.soft_sounds });
    chain.master.gain.value = opts.master;
    chain.effects_bus.gain.value = opts.effects;
    chain.effects_dry.gain.value = opts.effects;
    chain.music_bus.gain.value = opts.music;
    const t0 = SETTLE_S;
    if (name === 'music' || name === 'stress') {
      const loop = musicLoop(track);
      const loops = name === 'music' ? 2 : 1;
      for (let index = 0; index < loops; index += 1) {
        loop.notes.forEach((note) => {
          const at = index * loop.length + note.at;
          if (at < length_s - 2.5) musicNote(ctx, chain.music_bus, note, t0 + at, loop.style);
        });
      }
      if (name === 'music') {
        // Fade out at the end of the render so the file ends in silence (the seam check is well before it).
        chain.master.gain.setValueAtTime(opts.master, t0 + length_s - 2.4);
        chain.master.gain.linearRampToValueAtTime(0, t0 + length_s - 1.4);
      }
    }
    if (name === 'stress') {
      ['bomb', 'combo', 'wrapped', 'create', 'match', 'striped', 'fuse_out', 'win'].forEach((sound_name, index) => SOUNDS[sound_name].play(ctx, chain.effects_bus, t0 + 0.3 + index * 0.02, { depth: 9, special: 'bomb' }));
      chain.master.gain.setValueAtTime(opts.master, t0 + length_s - 2.4);
      chain.master.gain.linearRampToValueAtTime(0, t0 + length_s - 1.4);
    } else if (name !== 'music') {
      if (!SOUNDS[name]) return Promise.reject(new Error(`unknown sound ${name}`));
      SOUNDS[name].play(ctx, SOUNDS[name].dry ? chain.effects_dry : chain.effects_bus, t0, params || {});
    }
    return ctx.startRendering().then((buffer) => ({ samples: buffer.getChannelData(0).slice(Math.round(t0 * opts.sample_rate)), sample_rate: opts.sample_rate, duration_ms: length_s * 1000, loop_s: name === 'music' ? musicLoop(track).length : 0 }));
  }

  // ---------------------------------------------------------------- live engine

  function createAudio() {
    let context = null;
    let chain = null;
    let settings = { sound_on: true, music_on: true, master_volume: 0.8, effects_volume: 0.8, music_volume: 0.55, soft_sounds: false };
    let lifecycle_paused = false;
    let music_mode = null;
    let music_timer = null;
    let music_plan = null; // { track, loop, next_index, loop_start }
    const voices = []; // end times of active effect voices
    const last_played = {};

    function createContext() {
      const AudioContextClass = root.AudioContext || root.webkitAudioContext;
      if (!AudioContextClass) return false;
      try {
        context = new AudioContextClass({ latencyHint: 'interactive' });
      } catch (context_error) {
        context = null;
        return false;
      }
      chain = buildChain(context, { soft_sounds: settings.soft_sounds });
      applyVolumes();
      return true;
    }

    function applyVolumes() {
      if (!context) return;
      const at = context.currentTime;
      const soft = settings.soft_sounds;
      chain.lowpass.frequency.setTargetAtTime(soft ? 5200 : 11000, at, 0.05);
      chain.shelf.gain.setTargetAtTime(soft ? -6 : -2, at, 0.05);
      chain.trim.gain.setTargetAtTime(soft ? db(-4) : 1, at, 0.05);
      chain.master.gain.setTargetAtTime(settings.master_volume, at, 0.05);
      chain.effects_bus.gain.setTargetAtTime(settings.sound_on ? settings.effects_volume : 0, at, 0.05);
      chain.effects_dry.gain.setTargetAtTime(settings.sound_on ? settings.effects_volume : 0, at, 0.05);
      chain.music_bus.gain.setTargetAtTime(settings.music_on && !lifecycle_paused ? settings.music_volume : 0, at, 0.08);
    }

    function unlock() {
      if (!context && !createContext()) return;
      if (context.state === 'suspended' && !lifecycle_paused) context.resume().catch(() => {});
      ensureMusic();
    }

    function play(name, params) {
      const sound = SOUNDS[name];
      if (!context || !sound || !settings.sound_on || lifecycle_paused || context.state !== 'running') return;
      const time_ms = context.currentTime * 1000;
      const limit = RATE_LIMIT_MS[name] || DEFAULT_RATE_LIMIT_MS;
      if (last_played[name] !== undefined && time_ms - last_played[name] < limit) return;
      const at = context.currentTime;
      for (let index = voices.length - 1; index >= 0; index -= 1) if (voices[index] <= at) voices.splice(index, 1);
      if (voices.length >= MAX_VOICES) return;
      last_played[name] = time_ms;
      const end = sound.play(context, sound.dry ? chain.effects_dry : chain.effects_bus, at + 0.005, params || {});
      voices.push(end);
      if (BIG_SOUNDS.has(name)) duckMusic(at);
    }

    function duckMusic(at) {
      const duck = chain.music_duck.gain;
      duck.cancelScheduledValues(at);
      duck.setValueAtTime(duck.value, at);
      duck.linearRampToValueAtTime(db(-5), at + 0.03);
      duck.setValueAtTime(db(-5), at + 0.35);
      duck.linearRampToValueAtTime(1, at + 0.8);
    }

    /** Sound Check: a sample of the main sounds, one after another. */
    function soundCheck() {
      if (!context) return;
      const sequence = [['tap', {}], ['swap', {}], ['match', { depth: 1 }], ['match', { depth: 2 }], ['match', { depth: 3 }], ['create', { special: 'striped' }], ['striped', {}], ['wrapped', {}], ['star', { index: 2 }]];
      sequence.forEach(([name, params], index) => {
        setTimeout(() => {
          last_played[name] = -1000;
          play(name, params);
        }, index * 300);
      });
    }

    // Music: a lookahead scheduler loops the screen's track for as long as it is on.
    function ensureMusic() {
      if (!context || !music_mode || !settings.music_on) return;
      if (music_plan && music_plan.track === music_mode) return;
      stopMusic(true);
      music_plan = { track: music_mode, loop: musicLoop(music_mode), next_index: 0, loop_start: context.currentTime + 0.15 };
      chain.music_bus.gain.cancelScheduledValues(context.currentTime);
      chain.music_bus.gain.setTargetAtTime(settings.music_volume, context.currentTime, 0.3);
      music_timer = setInterval(musicTick, 50);
    }

    function musicTick() {
      if (!context || !music_plan || lifecycle_paused) return;
      const plan = music_plan;
      const horizon = context.currentTime + 0.3;
      if (plan.loop_start + plan.loop.length < context.currentTime - 1) {
        // The scheduler fell far behind (the app was throttled): restart the loop cleanly instead of catching up.
        plan.loop_start = context.currentTime + 0.1;
        plan.next_index = 0;
      }
      for (;;) {
        if (plan.next_index >= plan.loop.notes.length) {
          plan.loop_start += plan.loop.length;
          plan.next_index = 0;
        }
        const note = plan.loop.notes[plan.next_index];
        const at = plan.loop_start + note.at;
        if (at > horizon) break;
        if (at >= context.currentTime - 0.02) musicNote(context, chain.music_bus, note, at, plan.loop.style);
        plan.next_index += 1;
      }
    }

    function stopMusic(immediate) {
      clearInterval(music_timer);
      music_timer = null;
      music_plan = null;
      if (context && chain) chain.music_bus.gain.setTargetAtTime(0, context.currentTime, immediate ? 0.05 : 0.4);
    }

    return {
      unlock,
      play,
      soundCheck,
      setSettings(next_settings) {
        const music_was_on = settings.music_on;
        const soft_before = settings.soft_sounds;
        settings = Object.assign({}, settings, next_settings);
        applyVolumes();
        if (settings.music_on && !music_was_on) ensureMusic();
        if (!settings.music_on) stopMusic(true);
        if (soft_before !== settings.soft_sounds && context) applyVolumes();
      },
      /** 'title', 'map', 'level' or null: the track for the current screen. */
      setMusic(mode) {
        if (music_mode === mode) return;
        music_mode = mode;
        if (!mode) stopMusic(false);
        else ensureMusic();
      },
      setMusicWanted(wanted) {
        this.setMusic(wanted ? music_mode || 'map' : null);
      },
      pauseForLifecycle() {
        lifecycle_paused = true;
        stopMusic(true);
        if (context) {
          applyVolumes();
          context.suspend().catch(() => {});
        }
      },
      resumeFromLifecycle() {
        lifecycle_paused = false;
        if (context) {
          context.resume().catch(() => {});
          applyVolumes();
          ensureMusic();
        }
      },
      /** A summary for the automated tests and the emulator hook. */
      state() {
        return {
          context: context ? context.state : 'none',
          sound_on: settings.sound_on,
          music_on: settings.music_on,
          soft_sounds: settings.soft_sounds,
          lifecycle_paused,
          music_scheduler: !!music_timer,
          music: music_plan ? 'playing' : 'off',
          track: music_mode,
          voices: voices.length,
        };
      },
      get context() {
        return context;
      },
      get activeVoices() {
        return voices.length;
      },
    };
  }

  SC.AUDIO = { createAudio, renderSoundOffline, SOUNDS, MUSIC, musicLoop, PEAK_EFFECTS, MAX_VOICES };
})(typeof window !== 'undefined' ? window : globalThis);
