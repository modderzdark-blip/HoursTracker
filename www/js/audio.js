// AUDIO: every sound is synthesized with the Web Audio API (no audio files).
// The AudioContext is created on the first tap (phones require a gesture). Music is a 96 BPM pentatonic arpeggio over a
// C - Am - F - G loop with a soft pad, bass and tick percussion, scheduled with a lookahead timer and ducked under effects.
(function attachAudio(root) {
  'use strict';
  const SC = root.SC || (root.SC = {});

  const BPM = 96;
  const EIGHTH_S = 60 / BPM / 2;
  const LOOKAHEAD_S = 0.14;
  const SCHEDULER_MS = 25;
  const PENTATONIC_MIDI = [72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
  const CHORDS = [
    { pad: [60, 64, 67], bass: 48, arp: [72, 76, 79, 81] },
    { pad: [57, 60, 64], bass: 45, arp: [69, 72, 76, 79] },
    { pad: [53, 57, 60], bass: 41, arp: [69, 72, 74, 81] },
    { pad: [55, 59, 62], bass: 43, arp: [67, 74, 76, 79] },
  ];
  const ARP_PATTERN = [0, 1, 2, 3, 2, 1, 2, 3];
  const RATE_LIMIT_MS = { land: 60, match: 40, jelly: 50, frosting: 50, select: 30, click: 30 };

  function midiToFrequency(midi_note) {
    return 440 * Math.pow(2, (midi_note - 69) / 12);
  }

  function createAudio() {
    let context = null;
    let master_gain = null;
    let sfx_gain = null;
    let music_gain = null;
    let noise_buffer = null;
    let settings = { sfx_on: true, sfx_volume: 0.8, music_on: true, music_volume: 0.45 };
    let lifecycle_paused = false;
    let music_timer = null;
    let music_step = 0;
    let music_next_time = 0;
    let music_wanted = false;
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
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 3;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.2;
      master_gain = context.createGain();
      master_gain.gain.value = 0.9;
      sfx_gain = context.createGain();
      music_gain = context.createGain();
      sfx_gain.gain.value = settings.sfx_on ? settings.sfx_volume : 0;
      music_gain.gain.value = 0;
      sfx_gain.connect(master_gain);
      music_gain.connect(master_gain);
      master_gain.connect(compressor);
      compressor.connect(context.destination);
      noise_buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const samples = noise_buffer.getChannelData(0);
      let seed = 12345;
      for (let index = 0; index < samples.length; index += 1) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        samples[index] = (seed / 0x3fffffff) - 1;
      }
      return true;
    }

    function now() {
      return context.currentTime;
    }

    /** Click-free envelope: starts and ends at (near) zero. */
    function shapeGain(gain_param, start, attack, peak, release) {
      gain_param.setValueAtTime(0.0001, start);
      gain_param.linearRampToValueAtTime(peak, start + attack);
      gain_param.exponentialRampToValueAtTime(0.0001, start + attack + release);
    }

    function tone(options) {
      const start = options.start === undefined ? now() : options.start;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = options.type || 'sine';
      oscillator.frequency.setValueAtTime(options.freq, start);
      if (options.freq_end) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, options.freq_end), start + (options.glide || options.duration));
      if (options.detune) oscillator.detune.setValueAtTime(options.detune, start);
      let tail = oscillator;
      if (options.filter) {
        const filter = context.createBiquadFilter();
        filter.type = options.filter.type || 'lowpass';
        filter.frequency.setValueAtTime(options.filter.freq, start);
        if (options.filter.freq_end) filter.frequency.exponentialRampToValueAtTime(options.filter.freq_end, start + options.duration);
        filter.Q.value = options.filter.q || 0.8;
        tail.connect(filter);
        tail = filter;
      }
      tail.connect(gain);
      gain.connect(options.destination || sfx_gain);
      shapeGain(gain.gain, start, options.attack || 0.005, options.gain || 0.2, options.duration);
      oscillator.start(start);
      oscillator.stop(start + (options.attack || 0.005) + options.duration + 0.05);
    }

    function noise(options) {
      const start = options.start === undefined ? now() : options.start;
      const source = context.createBufferSource();
      source.buffer = noise_buffer;
      const filter = context.createBiquadFilter();
      filter.type = options.filter_type || 'bandpass';
      filter.frequency.setValueAtTime(options.freq || 1200, start);
      if (options.freq_end) filter.frequency.exponentialRampToValueAtTime(options.freq_end, start + options.duration);
      filter.Q.value = options.q || 1;
      const gain = context.createGain();
      source.connect(filter);
      filter.connect(gain);
      gain.connect(options.destination || sfx_gain);
      shapeGain(gain.gain, start, options.attack || 0.004, options.gain || 0.2, options.duration);
      source.start(start, Math.random() * 0.5);
      source.stop(start + (options.attack || 0.004) + options.duration + 0.05);
    }

    function bell(frequency, start, gain, length) {
      tone({ freq: frequency, start, duration: length, gain, type: 'sine', attack: 0.004 });
      tone({ freq: frequency * 2.76, start, duration: length * 0.5, gain: gain * 0.35, type: 'sine', attack: 0.002 });
      tone({ freq: frequency * 5.4, start, duration: length * 0.25, gain: gain * 0.12, type: 'sine', attack: 0.002 });
    }

    const SOUNDS = {
      select: () => tone({ freq: 1250, freq_end: 1500, duration: 0.05, gain: 0.08, type: 'sine' }),
      click: () => {
        tone({ freq: 900, freq_end: 600, duration: 0.05, gain: 0.1, type: 'triangle' });
        noise({ duration: 0.02, gain: 0.04, freq: 3000, q: 2 });
      },
      swap: () => noise({ duration: 0.14, gain: 0.16, freq: 700, freq_end: 2600, q: 1.4 }),
      nope: () => {
        const start = now();
        tone({ freq: 330, freq_end: 300, start, duration: 0.11, gain: 0.12, type: 'triangle' });
        tone({ freq: 250, freq_end: 210, start: start + 0.11, duration: 0.16, gain: 0.12, type: 'triangle' });
      },
      match: (params) => {
        const depth = Math.max(1, params && params.depth ? params.depth : 1);
        const note = PENTATONIC_MIDI[Math.min(PENTATONIC_MIDI.length - 1, depth - 1 + (params && params.size > 4 ? 1 : 0))];
        const frequency = midiToFrequency(note);
        tone({ freq: frequency * 1.6, freq_end: frequency, glide: 0.04, duration: 0.18, gain: 0.2, type: 'sine' });
        tone({ freq: frequency * 2, duration: 0.09, gain: 0.06, type: 'triangle' });
        noise({ duration: 0.03, gain: 0.06, freq: 2600, q: 1.5 });
      },
      land: () => tone({ freq: 140, freq_end: 60, duration: 0.09, gain: 0.12, type: 'sine' }),
      create: () => {
        const start = now();
        [0, 2, 4].forEach((step, index) => bell(midiToFrequency(PENTATONIC_MIDI[step + 2]), start + index * 0.06, 0.09, 0.4));
      },
      striped: () => {
        tone({ freq: 1700, freq_end: 180, duration: 0.26, gain: 0.12, type: 'sawtooth', filter: { type: 'bandpass', freq: 1800, freq_end: 400, q: 2 } });
        noise({ duration: 0.22, gain: 0.08, freq: 4000, freq_end: 800, q: 0.8 });
      },
      wrapped: () => {
        noise({ duration: 0.4, gain: 0.3, filter_type: 'lowpass', freq: 900, freq_end: 120, q: 0.7 });
        tone({ freq: 160, freq_end: 38, duration: 0.42, gain: 0.32, type: 'sine' });
      },
      bomb: () => {
        const start = now();
        for (let index = 0; index < 14; index += 1) {
          tone({ freq: midiToFrequency(PENTATONIC_MIDI[index % PENTATONIC_MIDI.length]) * (index > 10 ? 2 : 1), start: start + index * 0.035, duration: 0.12, gain: 0.07, type: 'sine' });
        }
        noise({ start, duration: 0.6, gain: 0.07, freq: 3000, freq_end: 9000, q: 0.7 });
      },
      combo: () => {
        const start = now();
        tone({ freq: 220, freq_end: 880, duration: 0.3, gain: 0.12, type: 'sawtooth', filter: { type: 'lowpass', freq: 600, freq_end: 4000 }, start });
        bell(midiToFrequency(84), start + 0.18, 0.12, 0.5);
      },
      ingredient: () => {
        const start = now();
        bell(1568, start, 0.16, 0.6);
        bell(2093, start + 0.09, 0.12, 0.6);
      },
      jelly: () => {
        noise({ duration: 0.07, gain: 0.08, filter_type: 'highpass', freq: 2500 });
        tone({ freq: 420, freq_end: 200, duration: 0.1, gain: 0.07, type: 'sine' });
      },
      frosting: () => {
        const start = now();
        noise({ start, duration: 0.05, gain: 0.12, freq: 1400 + Math.random() * 800, q: 3 });
        noise({ start: start + 0.05, duration: 0.07, gain: 0.1, freq: 900 + Math.random() * 600, q: 3 });
      },
      star: (params) => bell(midiToFrequency(PENTATONIC_MIDI[4 + ((params && params.index) || 0) * 2]), now(), 0.18, 0.8),
      win: () => {
        const start = now();
        [60, 64, 67, 72].forEach((note, index) => {
          tone({ freq: midiToFrequency(note), start: start + index * 0.12, duration: 0.35, gain: 0.14, type: 'triangle' });
          tone({ freq: midiToFrequency(note + 12), start: start + index * 0.12, duration: 0.25, gain: 0.05, type: 'sine' });
        });
        [60, 64, 67, 72, 76].forEach((note) => tone({ freq: midiToFrequency(note), start: start + 0.5, duration: 0.9, gain: 0.07, type: 'triangle', attack: 0.02 }));
      },
      lose: () => {
        const start = now();
        [[311, 294], [294, 277], [277, 233]].forEach(([from, to], index) => {
          tone({ freq: from, freq_end: to, start: start + index * 0.28, duration: index === 2 ? 0.7 : 0.26, gain: 0.12, type: 'sawtooth', filter: { type: 'lowpass', freq: 1400, freq_end: 500, q: 4 } });
        });
      },
      shuffle: () => {
        const start = now();
        for (let index = 0; index < 6; index += 1) noise({ start: start + index * 0.05, duration: 0.05, gain: 0.07, freq: 1500 + index * 300, q: 2 });
      },
      bonus: () => bell(midiToFrequency(88), now(), 0.1, 0.3),
    };

    function duckMusic() {
      if (!music_gain || !settings.music_on) return;
      const at = now();
      const target = settings.music_volume * 0.35;
      music_gain.gain.cancelScheduledValues(at);
      music_gain.gain.setTargetAtTime(target, at, 0.02);
      music_gain.gain.setTargetAtTime(settings.music_volume * 0.6, at + 0.16, 0.15);
    }

    function scheduleMusicStep(step, start) {
      const bar = Math.floor(step / 8) % CHORDS.length;
      const chord = CHORDS[bar];
      const eighth = step % 8;
      const arp_note = chord.arp[ARP_PATTERN[eighth]] + (eighth === 7 && bar === 3 ? 12 : 0);
      tone({ freq: midiToFrequency(arp_note), start, duration: 0.26, gain: 0.055, type: 'triangle', destination: music_gain, attack: 0.006 });
      tone({ freq: midiToFrequency(arp_note + 12), start, duration: 0.12, gain: 0.012, type: 'sine', destination: music_gain, attack: 0.004 });
      if (eighth === 0) {
        chord.pad.forEach((note, index) => {
          tone({ freq: midiToFrequency(note), start, duration: EIGHTH_S * 8, gain: 0.03, type: 'sawtooth', detune: (index - 1) * 7, attack: 0.35, destination: music_gain, filter: { type: 'lowpass', freq: 900, q: 0.4 } });
        });
      }
      if (eighth === 0 || eighth === 4) {
        tone({ freq: midiToFrequency(chord.bass), start, duration: EIGHTH_S * 3, gain: 0.09, type: 'sine', destination: music_gain, attack: 0.01 });
      }
      noise({ start, duration: 0.025, gain: eighth % 2 === 0 ? 0.03 : 0.016, filter_type: 'highpass', freq: 7000, destination: music_gain });
    }

    function musicTick() {
      if (!context || context.state !== 'running') return;
      while (music_next_time < context.currentTime + LOOKAHEAD_S) {
        scheduleMusicStep(music_step, music_next_time);
        music_step = (music_step + 1) % (CHORDS.length * 8);
        music_next_time += EIGHTH_S;
      }
    }

    function startMusic() {
      if (!context || music_timer !== null) return;
      music_next_time = context.currentTime + 0.08;
      music_gain.gain.cancelScheduledValues(context.currentTime);
      music_gain.gain.setTargetAtTime(settings.music_volume * 0.6, context.currentTime, 0.3);
      music_timer = setInterval(musicTick, SCHEDULER_MS);
      musicTick();
    }

    function stopMusic() {
      if (music_timer !== null) {
        clearInterval(music_timer);
        music_timer = null;
      }
      if (context && music_gain) {
        music_gain.gain.cancelScheduledValues(context.currentTime);
        music_gain.gain.setTargetAtTime(0, context.currentTime, 0.05);
      }
    }

    function applyMusicState() {
      if (!context) return;
      if (music_wanted && settings.music_on && !lifecycle_paused) startMusic();
      else stopMusic();
    }

    const audio = {
      /** Call from a user gesture; creates or resumes the AudioContext. */
      unlock() {
        if (!context && !createContext()) return;
        if (context.state === 'suspended' && !lifecycle_paused) context.resume().catch(() => {});
        applyMusicState();
      },
      play(name, params) {
        if (!context || !settings.sfx_on || lifecycle_paused || context.state !== 'running') return;
        const sound = SOUNDS[name];
        if (!sound) return;
        const at_ms = context.currentTime * 1000;
        if (RATE_LIMIT_MS[name] && last_played[name] !== undefined && at_ms - last_played[name] < RATE_LIMIT_MS[name]) return;
        last_played[name] = at_ms;
        try {
          sound(params);
          duckMusic();
        } catch (sound_error) {
          // A failed sound must never break gameplay.
        }
      },
      setSettings(next_settings) {
        settings = Object.assign({}, settings, next_settings);
        if (context) {
          sfx_gain.gain.setTargetAtTime(settings.sfx_on ? settings.sfx_volume : 0, context.currentTime, 0.03);
          if (music_timer !== null) music_gain.gain.setTargetAtTime(settings.music_on ? settings.music_volume * 0.6 : 0, context.currentTime, 0.08);
        }
        applyMusicState();
      },
      setMusicWanted(wanted) {
        music_wanted = wanted;
        applyMusicState();
      },
      /** App backgrounded / screen off: stop scheduling and suspend the context. */
      pauseForLifecycle() {
        lifecycle_paused = true;
        stopMusic();
        if (context && context.state === 'running') context.suspend().catch(() => {});
      },
      resumeFromLifecycle() {
        lifecycle_paused = false;
        if (context && context.state === 'suspended') {
          context.resume().then(applyMusicState).catch(() => {});
        } else {
          applyMusicState();
        }
      },
      state() {
        return {
          context: context ? context.state : 'none',
          music_scheduler: music_timer !== null,
          lifecycle_paused,
          sfx_on: settings.sfx_on,
          music_on: settings.music_on,
        };
      },
    };
    return audio;
  }

  SC.AUDIO = { createAudio, midiToFrequency, PENTATONIC_MIDI };
})(typeof window !== 'undefined' ? window : globalThis);
