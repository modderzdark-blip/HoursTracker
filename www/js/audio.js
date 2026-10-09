// AUDIO: soft, warm, ear-safe sound, all synthesized with the Web Audio API (no audio files).
// Rules (tested in CI by tests/audio): sine and triangle only; every envelope starts at zero with an attack of at least
// 6 ms and ends with an exponential release of at least 70 ms; no fundamental above 1.1 kHz (pitch capped at C6);
// every source -> voice gain -> bus -> low-pass (3.2 kHz, Q 0.5) -> high-shelf (-3 dB at 4 kHz) -> compressor
// (-18 dB, 4:1, 5 ms, 120 ms) -> trim -> master -> speakers. Effects never peak above 0.25, music never above 0.1.
// At most 6 effect voices at once, the same sound at most every 60 ms (landings 80 ms); music ducks 3 dB under big
// effects. Music plays about two loops, fades out, rests in silence and comes back later.
// renderSoundOffline(name, params, options) renders any sound (or 'stress', or 'music') with an OfflineAudioContext.
(function attachAudio(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const PEAK_EFFECTS = 0.25;
  const MAX_VOICES = 6;
  const PRE_ROLL_S = 0.004; // every sound begins a few ms after its start time, so its first samples are silence
  const C6 = 1046.5;
  const FREQUENCY_CEILING = 1100;
  const RATE_LIMIT_MS = { land: 80 };
  const DEFAULT_RATE_LIMIT_MS = 60;
  const COMPRESSOR_TRIM = 0.5; // keeps the worst case (6 voices + music, every volume at 100%) under 0.25
  const MUSIC_REST_S = 38;

  const db = (decibels) => Math.pow(10, decibels / 20);
  const midiToFrequency = (midi_note) => 440 * Math.pow(2, (midi_note - 69) / 12);
  const PENTATONIC = [72, 74, 76, 79, 81, 84]; // C5 D5 E5 G5 A5 C6 (C6 = 1046.5 Hz, the cap)

  // ---------------------------------------------------------------- voices (shared by live play and offline rendering)

  /** A click-free voice: sine or triangle with optional soft overtones, a frequency glide and an exponential release. */
  function voice(ctx, destination, options) {
    const start = options.start + PRE_ROLL_S;
    const attack = Math.max(0.006, options.attack || 0.008);
    const hold = options.hold || 0;
    const release = Math.max(0.07, options.release || 0.12);
    const peak = options.peak;
    const frequency = Math.min(FREQUENCY_CEILING, options.frequency);
    const frequency_end = options.frequency_end ? Math.min(FREQUENCY_CEILING, options.frequency_end) : null;
    const end = start + attack + hold + release;
    const partials = [[1, 1]].concat(options.partials || []);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(peak, start + attack);
    if (hold > 0) gain.gain.setValueAtTime(peak, start + attack + hold);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.00001, peak * 0.0005), end);
    gain.gain.linearRampToValueAtTime(0, end + 0.008);
    gain.connect(destination);
    partials.forEach(([multiple, level]) => {
      const oscillator = ctx.createOscillator();
      oscillator.type = multiple === 1 ? options.type || 'sine' : 'sine';
      oscillator.frequency.setValueAtTime(frequency * multiple, start);
      if (frequency_end) oscillator.frequency.exponentialRampToValueAtTime(frequency_end * multiple, end);
      if (level === 1) {
        oscillator.connect(gain);
      } else {
        const partial_gain = ctx.createGain();
        partial_gain.gain.value = level;
        oscillator.connect(partial_gain);
        partial_gain.connect(gain);
      }
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    });
    return end + 0.02;
  }

  /** A very quiet whoosh: noise through a low-pass under 900 Hz with a soft envelope. */
  function whoosh(ctx, destination, start, length, peak) {
    const sample_rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.ceil(sample_rate * (length + 0.05)), sample_rate);
    const samples = buffer.getChannelData(0);
    let seed = 2463534242;
    for (let index = 0; index < samples.length; index += 1) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      samples[index] = ((seed >>> 0) / 4294967296) * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.4;
    const second = ctx.createBiquadFilter();
    second.type = 'lowpass';
    second.frequency.value = 900;
    second.Q.value = 0.4;
    const gain = ctx.createGain();
    const begin = start + PRE_ROLL_S;
    gain.gain.setValueAtTime(0, begin);
    gain.gain.linearRampToValueAtTime(peak, begin + length * 0.4);
    gain.gain.exponentialRampToValueAtTime(peak * 0.0005, begin + length);
    gain.gain.linearRampToValueAtTime(0, begin + length + 0.008);
    source.connect(filter);
    filter.connect(second);
    second.connect(gain);
    gain.connect(destination);
    source.start(begin);
    source.stop(begin + length + 0.03);
    return begin + length + 0.03;
  }

  const SOFT_OVERTONES = [[2, db(-18)], [3, db(-26)]];
  const MARIMBA = [[2, 0.25], [3, 0.08]];

  /**
   * The sound list (Section 14.2): each plays into `destination` at `start` and returns its end time.
   * `duration_ms` is the spec length the audio tests check against.
   */
  const SOUNDS = {
    tap: { duration_ms: 70, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 600, frequency_end: 520, attack: 0.006, release: 0.07, peak: db(-26) }) },
    select: { duration_ms: 90, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 520, partials: [[2, db(-18)]], attack: 0.008, release: 0.08, peak: db(-24) }) },
    swap: {
      duration_ms: 120,
      play(ctx, out, t) {
        whoosh(ctx, out, t, 0.12, db(-38));
        return voice(ctx, out, { start: t, frequency: 400, frequency_end: 500, attack: 0.012, release: 0.1, peak: db(-30) });
      },
    },
    nope: { duration_ms: 140, play: (ctx, out, t) => voice(ctx, out, { start: t, type: 'triangle', frequency: 220, frequency_end: 196, attack: 0.012, release: 0.12, peak: db(-26) }) },
    match: {
      duration_ms: 230,
      play(ctx, out, t, params) {
        // Each extra set in one move steps up the pentatonic scale, capped at C6; past the cap a soft chord joins in.
        const step = Math.max(0, ((params && params.depth) || 1) - 1);
        const note = PENTATONIC[Math.min(PENTATONIC.length - 1, step)];
        let end = voice(ctx, out, { start: t, frequency: Math.min(C6, midiToFrequency(note)), partials: MARIMBA, attack: 0.006, release: 0.22, peak: db(-20) });
        if (step >= PENTATONIC.length) {
          [60, 64, 67].forEach((chord_note) => {
            end = Math.max(end, voice(ctx, out, { start: t, frequency: midiToFrequency(chord_note + 12), attack: 0.02, release: 0.25, peak: db(-32) }));
          });
        }
        return end;
      },
    },
    land: { duration_ms: 60, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 160, attack: 0.006, release: 0.07, peak: db(-30) }) },
    create: {
      duration_ms: 260,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, frequency: midiToFrequency(79), partials: SOFT_OVERTONES, attack: 0.008, release: 0.14, peak: db(-21) });
        return voice(ctx, out, { start: t + 0.09, frequency: C6, partials: SOFT_OVERTONES, attack: 0.008, release: 0.16, peak: db(-21) });
      },
    },
    striped: { duration_ms: 220, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 500, frequency_end: 900, attack: 0.03, release: 0.18, peak: db(-22) }) },
    wrapped: {
      duration_ms: 300,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, frequency: 90, partials: [[2, db(-14)]], attack: 0.01, release: 0.26, peak: db(-21) });
        return voice(ctx, out, { start: t + 0.03, frequency: midiToFrequency(72), partials: SOFT_OVERTONES, attack: 0.01, release: 0.25, peak: db(-26) });
      },
    },
    bomb: {
      duration_ms: 720,
      play(ctx, out, t) {
        let end = t;
        [72, 74, 76, 79, 81].forEach((note, index) => {
          end = voice(ctx, out, { start: t + index * 0.12, frequency: midiToFrequency(note), partials: SOFT_OVERTONES, attack: 0.01, release: 0.2, peak: db(-23) });
        });
        return end;
      },
    },
    combo: {
      duration_ms: 760,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, frequency: 110, partials: [[2, db(-14)]], attack: 0.012, release: 0.3, peak: db(-22) });
        let end = t;
        [76, 79, 81, 84].forEach((note, index) => {
          end = voice(ctx, out, { start: t + 0.06 + index * 0.11, frequency: Math.min(C6, midiToFrequency(note)), partials: SOFT_OVERTONES, attack: 0.01, release: 0.2, peak: db(-24) });
        });
        return end;
      },
    },
    ingredient: { duration_ms: 190, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: midiToFrequency(76), partials: [[2, db(-16)], [3, db(-26)]], attack: 0.008, release: 0.17, peak: db(-24) }) },
    jelly: { duration_ms: 90, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 880, partials: [[2, db(-22)]], attack: 0.006, release: 0.08, peak: db(-28) }) },
    frosting: {
      duration_ms: 150,
      play(ctx, out, t) {
        let end = t;
        [300, 340, 270].forEach((frequency, index) => {
          end = voice(ctx, out, { start: t + index * 0.03, type: 'triangle', frequency, attack: 0.006, release: 0.07, peak: db(-29) });
        });
        return end;
      },
    },
    cocoa: { duration_ms: 110, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 220, frequency_end: 180, attack: 0.008, release: 0.09, peak: db(-26) }) },
    cocoa_spread: { duration_ms: 130, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 180, frequency_end: 160, attack: 0.01, release: 0.11, peak: db(-30) }) },
    cage: { duration_ms: 120, play: (ctx, out, t) => voice(ctx, out, { start: t, type: 'triangle', frequency: 660, attack: 0.006, release: 0.1, peak: db(-27) }) },
    hammer: { duration_ms: 160, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 120, partials: [[2, db(-12)]], attack: 0.008, release: 0.14, peak: db(-22) }) },
    belt: { duration_ms: 110, play: (ctx, out, t) => voice(ctx, out, { start: t, type: 'triangle', frequency: 330, frequency_end: 300, attack: 0.01, release: 0.09, peak: db(-31) }) },
    fuse_tick: {
      duration_ms: 170,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, type: 'triangle', frequency: 440, attack: 0.006, release: 0.07, peak: db(-28) });
        return voice(ctx, out, { start: t + 0.09, type: 'triangle', frequency: 440, attack: 0.006, release: 0.07, peak: db(-28) });
      },
    },
    fuse_out: { duration_ms: 420, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 300, frequency_end: 150, attack: 0.02, release: 0.38, peak: db(-22) }) },
    star: {
      duration_ms: 220,
      play(ctx, out, t, params) {
        const note = [76, 79, 84][Math.min(2, (params && params.index) || 0)];
        return voice(ctx, out, { start: t, frequency: Math.min(C6, midiToFrequency(note)), partials: SOFT_OVERTONES, attack: 0.008, release: 0.2, peak: db(-22) });
      },
    },
    goal: { duration_ms: 180, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: midiToFrequency(81), partials: SOFT_OVERTONES, attack: 0.008, release: 0.16, peak: db(-24) }) },
    win: {
      duration_ms: 900,
      play(ctx, out, t) {
        let end = t;
        [72, 76, 79, 84].forEach((note, index) => {
          end = voice(ctx, out, { start: t + index * 0.04, frequency: Math.min(C6, midiToFrequency(note)), partials: SOFT_OVERTONES, attack: 0.02, hold: 0.25, release: 0.55, peak: db(-28) });
        });
        return end;
      },
    },
    lose: {
      duration_ms: 520,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, frequency: midiToFrequency(67), frequency_end: midiToFrequency(64), attack: 0.02, release: 0.22, peak: db(-26) });
        return voice(ctx, out, { start: t + 0.22, frequency: midiToFrequency(64), frequency_end: midiToFrequency(60), attack: 0.02, release: 0.28, peak: db(-26) });
      },
    },
    reward: {
      duration_ms: 320,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, frequency: midiToFrequency(76), partials: SOFT_OVERTONES, attack: 0.01, release: 0.18, peak: db(-23) });
        return voice(ctx, out, { start: t + 0.11, frequency: midiToFrequency(81), partials: SOFT_OVERTONES, attack: 0.01, release: 0.2, peak: db(-23) });
      },
    },
    unlock: {
      duration_ms: 300,
      play(ctx, out, t) {
        voice(ctx, out, { start: t, frequency: midiToFrequency(72), partials: SOFT_OVERTONES, attack: 0.01, release: 0.16, peak: db(-23) });
        return voice(ctx, out, { start: t + 0.1, frequency: midiToFrequency(79), partials: SOFT_OVERTONES, attack: 0.01, release: 0.18, peak: db(-23) });
      },
    },
    hop: { duration_ms: 170, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: 400, frequency_end: 600, attack: 0.012, release: 0.15, peak: db(-28) }) },
    praise: {
      duration_ms: 420,
      play(ctx, out, t, params) {
        const lift = Math.min(4, Math.max(0, ((params && params.depth) || 2) - 2));
        let end = t;
        [60, 64, 67].forEach((note) => {
          end = voice(ctx, out, { start: t, frequency: midiToFrequency(note + 12 + lift), attack: 0.08, hold: 0.06, release: 0.26, peak: db(-29) });
        });
        return end;
      },
    },
    bonus: { duration_ms: 110, play: (ctx, out, t) => voice(ctx, out, { start: t, frequency: midiToFrequency(79), frequency_end: midiToFrequency(84), attack: 0.006, release: 0.09, peak: db(-27) }) },
    shuffle: {
      duration_ms: 220,
      play(ctx, out, t) {
        whoosh(ctx, out, t, 0.2, db(-38));
        return voice(ctx, out, { start: t, frequency: 300, frequency_end: 450, attack: 0.02, release: 0.18, peak: db(-30) });
      },
    },
    wheel: {
      duration_ms: 3200,
      play(ctx, out, t) {
        let end = t;
        let at = t;
        for (let tick = 0; tick < 22; tick += 1) {
          end = voice(ctx, out, { start: at, type: 'triangle', frequency: 700, attack: 0.006, release: 0.07, peak: db(-32) });
          at += 0.05 + tick * tick * 0.0005;
        }
        return end;
      },
    },
  };
  SOUNDS.click = SOUNDS.tap;
  const BIG_SOUNDS = new Set(['bomb', 'combo', 'wrapped', 'win', 'fuse_out', 'hammer']);

  // ---------------------------------------------------------------- music

  const MUSIC = {
    level: { bpm: 90, chords: [[48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 59, 62], [48, 60, 64, 67], [45, 57, 60, 64], [41, 57, 60, 65], [43, 55, 62, 67]], melody: true, tick: true },
    map: { bpm: 72, chords: [[48, 60, 64, 67], [41, 57, 60, 65], [45, 57, 60, 64], [43, 55, 59, 62]], melody: false, tick: false },
  };
  MUSIC.title = MUSIC.map;
  const MELODY_PATTERN = [0, 2, 1, 3, 2, 1, -1, 2];

  /** All the notes of one loop of a track: [{at (s), frequency, length (s), peak, kind}] (deterministic). */
  function musicLoop(track_name) {
    const track = MUSIC[track_name] || MUSIC.level;
    const beat = 60 / track.bpm;
    const bar = beat * 4;
    const notes = [];
    track.chords.forEach((chord, bar_index) => {
      const bar_start = bar_index * bar;
      notes.push({ at: bar_start, frequency: midiToFrequency(chord[0]), length: bar, peak: 0.016, kind: 'bass', type: 'triangle' });
      chord.slice(1).forEach((note) => notes.push({ at: bar_start, frequency: midiToFrequency(note), length: bar, peak: 0.008, kind: 'pad', type: 'sine' }));
      if (track.melody) {
        const scale = [72, 74, 76, 79, 81];
        MELODY_PATTERN.forEach((degree, eighth) => {
          if (degree < 0) return;
          const note = scale[(degree + bar_index) % scale.length];
          notes.push({ at: bar_start + eighth * beat * 0.5, frequency: midiToFrequency(note), length: beat * 0.42, peak: 0.016, kind: 'melody', type: 'sine' });
        });
      } else if (bar_index % 2 === 0) {
        notes.push({ at: bar_start + beat * 2, frequency: midiToFrequency([76, 79, 81, 79][bar_index % 4]), length: beat * 1.6, peak: 0.012, kind: 'melody', type: 'sine' });
      }
      if (track.tick) {
        for (let quarter = 0; quarter < 4; quarter += 1) notes.push({ at: bar_start + quarter * beat, frequency: 820, length: 0.02, peak: 0.0035, kind: 'tick', type: 'sine' });
      }
    });
    return { notes, length: track.chords.length * bar };
  }

  /** Plays one music note: pads and bass swell in and overlap the next bar slightly, so the loop seam is seamless. */
  function musicNote(ctx, destination, note, start) {
    if (note.kind === 'pad' || note.kind === 'bass') {
      return voice(ctx, destination, { start, type: note.type, frequency: note.frequency, attack: 0.35, hold: Math.max(0, note.length - 0.3), release: 0.5, peak: note.peak });
    }
    if (note.kind === 'tick') return voice(ctx, destination, { start, frequency: note.frequency, attack: 0.006, release: 0.07, peak: note.peak });
    return voice(ctx, destination, { start, type: note.type, frequency: note.frequency, partials: [[2, db(-20)]], attack: 0.02, hold: note.length * 0.3, release: Math.max(0.12, note.length * 0.7), peak: note.peak });
  }

  // ---------------------------------------------------------------- the output chain

  function buildChain(ctx, options) {
    const opts = options || {};
    const soft = opts.soft_sounds !== false;
    const effects_bus = ctx.createGain();
    const music_bus = ctx.createGain();
    const music_duck = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = soft ? 2600 : 3200;
    lowpass.Q.value = 0.5;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 4000;
    shelf.gain.value = soft ? -6 : -3;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 6;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.12;
    const trim = ctx.createGain();
    trim.gain.value = COMPRESSOR_TRIM * (soft ? db(-3) : 1);
    const master = ctx.createGain();
    effects_bus.connect(lowpass);
    music_bus.connect(music_duck);
    music_duck.connect(lowpass);
    lowpass.connect(shelf);
    shelf.connect(compressor);
    compressor.connect(trim);
    trim.connect(master);
    master.connect(ctx.destination);
    return { effects_bus, music_bus, music_duck, lowpass, shelf, compressor, trim, master };
  }

  /**
   * Renders a sound offline (for the audio tests). name: any key of SOUNDS, 'stress' (6 overlapping effects + music) or
   * 'music' (two loops of the level track). options: { master, effects, music, soft_sounds, sample_rate }.
   * Resolves { samples: Float32Array, sample_rate, duration_ms }.
   */
  function renderSoundOffline(name, params, options) {
    const opts = Object.assign({ master: 1, effects: 1, music: 1, soft_sounds: false, sample_rate: 44100 }, options || {});
    const OfflineContext = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OfflineContext) return Promise.reject(new Error('OfflineAudioContext is not available'));
    let length_s;
    if (name === 'music') length_s = musicLoop(params && params.track ? params.track : 'level').length * 2 + 1.2;
    else if (name === 'stress') length_s = musicLoop('level').length + 1.4;
    else length_s = (SOUNDS[name] ? SOUNDS[name].duration_ms : 500) / 1000 + 0.6;
    const ctx = new OfflineContext(1, Math.ceil(length_s * opts.sample_rate), opts.sample_rate);
    const chain = buildChain(ctx, { soft_sounds: opts.soft_sounds });
    chain.master.gain.value = opts.master;
    chain.effects_bus.gain.value = opts.effects;
    chain.music_bus.gain.value = opts.music;
    if (name === 'music' || name === 'stress') {
      const loop = musicLoop(params && params.track ? params.track : 'level');
      const loops = name === 'music' ? 2 : 1;
      for (let index = 0; index < loops; index += 1) loop.notes.forEach((note) => musicNote(ctx, chain.music_bus, note, index * loop.length + note.at));
    }
    if (name === 'stress') {
      ['bomb', 'combo', 'wrapped', 'create', 'match', 'striped'].forEach((sound_name, index) => SOUNDS[sound_name].play(ctx, chain.effects_bus, 0.3 + index * 0.02, { depth: 6 }));
    } else if (name !== 'music') {
      if (!SOUNDS[name]) return Promise.reject(new Error(`unknown sound ${name}`));
      SOUNDS[name].play(ctx, chain.effects_bus, 0, params || {});
    }
    return ctx.startRendering().then((buffer) => ({ samples: buffer.getChannelData(0), sample_rate: opts.sample_rate, duration_ms: length_s * 1000, loop_s: name === 'music' ? musicLoop((params && params.track) || 'level').length : 0 }));
  }

  // ---------------------------------------------------------------- live engine

  function createAudio() {
    let context = null;
    let chain = null;
    let settings = { sound_on: true, music_on: true, master_volume: 0.7, effects_volume: 0.6, music_volume: 0.35, soft_sounds: true };
    let lifecycle_paused = false;
    let music_mode = null;
    let music_timer = null;
    let music_plan = null; // { track, loop, next_index, loop_start, loops_played, state: 'playing'|'resting', rest_until }
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
      chain.lowpass.frequency.setTargetAtTime(soft ? 2600 : 3200, at, 0.05);
      chain.shelf.gain.setTargetAtTime(soft ? -6 : -3, at, 0.05);
      chain.trim.gain.setTargetAtTime(COMPRESSOR_TRIM * (soft ? db(-3) : 1), at, 0.05);
      chain.master.gain.setTargetAtTime(settings.master_volume, at, 0.05);
      chain.effects_bus.gain.setTargetAtTime(settings.sound_on ? settings.effects_volume : 0, at, 0.05);
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
      const end = sound.play(context, chain.effects_bus, at + 0.005, params || {});
      voices.push(end);
      if (BIG_SOUNDS.has(name)) duckMusic(at);
    }

    function duckMusic(at) {
      const duck = chain.music_duck.gain;
      duck.cancelScheduledValues(at);
      duck.setValueAtTime(duck.value, at);
      duck.linearRampToValueAtTime(db(-3), at + 0.03);
      duck.setValueAtTime(db(-3), at + 0.2);
      duck.linearRampToValueAtTime(1, at + 0.45);
    }

    /** Sound Check: a gentle sample of the main sounds, one after another. */
    function soundCheck() {
      if (!context) return;
      const sequence = ['tap', 'select', 'swap', 'match', 'create', 'striped', 'star', 'reward'];
      sequence.forEach((name, index) => {
        setTimeout(() => {
          last_played[name] = -1000;
          play(name, { depth: 1, index: index % 3 });
        }, index * 330);
      });
    }

    // Music: a lookahead scheduler plays about two loops, fades out, rests in silence, then comes back.
    function ensureMusic() {
      if (!context || !music_mode || !settings.music_on) return;
      if (music_plan && music_plan.track === music_mode) return;
      stopMusic(true);
      music_plan = { track: music_mode, loop: musicLoop(music_mode), next_index: 0, loop_start: context.currentTime + 0.1, loops_played: 0, state: 'playing', rest_until: 0 };
      chain.music_bus.gain.setTargetAtTime(settings.music_volume, context.currentTime, 0.4);
      music_timer = setInterval(musicTick, 40);
    }

    function musicTick() {
      if (!context || !music_plan || lifecycle_paused) return;
      const horizon = context.currentTime + 0.25;
      const plan = music_plan;
      if (plan.state === 'resting') {
        if (context.currentTime < plan.rest_until) return;
        plan.state = 'playing';
        plan.loops_played = 0;
        plan.next_index = 0;
        plan.loop_start = context.currentTime + 0.1;
        chain.music_bus.gain.setTargetAtTime(settings.music_on ? settings.music_volume : 0, context.currentTime, 0.4);
      }
      while (plan.state === 'playing') {
        if (plan.next_index >= plan.loop.notes.length) {
          plan.loops_played += 1;
          plan.loop_start += plan.loop.length;
          plan.next_index = 0;
          if (plan.loops_played >= 2) {
            // Fade out gently, then rest in silence.
            chain.music_bus.gain.setTargetAtTime(0, plan.loop_start - 1.5, 0.6);
            plan.state = 'resting';
            plan.rest_until = plan.loop_start + MUSIC_REST_S;
            break;
          }
        }
        const note = plan.loop.notes[plan.next_index];
        const at = plan.loop_start + note.at;
        if (at > horizon) break;
        if (at >= context.currentTime - 0.02) musicNote(context, chain.music_bus, note, at);
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
        settings = Object.assign({}, settings, next_settings);
        applyVolumes();
        if (settings.music_on && !music_was_on) ensureMusic();
        if (!settings.music_on) stopMusic(true);
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
          music: music_plan ? music_plan.state : 'off',
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
