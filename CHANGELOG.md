# Changelog

## [Unreleased]

### Added

- **Release signing (M15, optional):** with the `ASHBOUND_*` secrets set, the Android workflow
  also builds a store-signed APK + AAB as a workflow artifact. Skipped without them; the preview
  build is unchanged. UNTESTED (no secrets configured).

## [0.3.0] — Full game loop (2026-10-19)

### Added

- **Hub**: 3D hero preview, game modes, Heroes / Gear / Skills / Settings, currency bar.
- **Adventure**: 3 chapters × 8 stages (Ashfall March, The Smoldering Wastes, The Bound Spire),
  stage map with stars, pre-battle panel (foes, rewards, recommended vs. your power), Normal /
  Hard / Nightmare per chapter, victory screen with loot reveal, next-stage flow.
- **Progression**: hero levels (XP curve in data), gear in 6 slots × 5 rarities with random
  substats, upgrades +1…+15 (success rate drops above +10, nothing is ever destroyed), salvage,
  locking, bulk salvage, Ember Cache (reward tickets → rare+ item), drop tables per stage and
  difficulty with epic/legendary pity, skill trees per hero (power, haste, modifiers, core).
- **Heroes**: Brann (greatsword, super armor, hold-to-charge Oathbreaker, Earthsplitter
  shockwave, Bulwark Rush, Meteor Cleave) and Lyra (bow at range / dagger up close, Piercing
  Gloam, Ashfall Volley rain, Snare Leap trap, homing Gloamstorm), unlocked with souls.
- **Enemies**: Bulwark Sentinel (front shield — flank or stagger it), Ember Seer (kites, bolts,
  ground eruptions), Cinder Wretch (rushes in and explodes).
- **Bosses**: Mother of Ash (claws, fire breath, takes flight and rains fireballs, summons
  adds), The Bound King (sweeps, slams, a grab you must dodge, timed arena eruptions);
  mini-bosses The Gaoler, The Seer Exalted, The Iron Penitent.
- **Modes**: Dungeon (random chambers, HP carry-over, elite, timed entries), Demon Tower
  (endless floors, boss every 10th, milestones), Boss Challenge (10 tiers per boss), Arena
  (AI duelists built from hero + gear + skills, rating, weekly seasons with rewards, local
  leaderboard).
- **Combat systems**: pooled projectiles and ground zones, shields / blocking, kiting AI,
  summons, boss flight and grabs, hazards; camera pulls back for huge bosses.
- **Settings**: button size and opacity, left-handed layout, screen shake, damage numbers,
  volumes (master / effects / music), vibration, graphics, FPS cap.
- **Music**: procedural soundtrack (hub, battle, boss themes).
- **Save v3** with migration from v2 (wallet and settings kept).
- 193 unit/integration tests in 15 files; 12 Playwright smoke tests rewritten for the hub flow.

### Changed

- Each battle builds its own scene and physics world and is disposed afterwards.
- Enemy stats scale with stage level and difficulty; heroes with level, gear and skills.

## [0.2.0] — Gameplay prototype (2026-10-18)

### Added

- **Animation:** procedural skinned placeholder rigs (one SkinnedMesh + glow mesh per character,
  Mixamo bone names, weapon sockets) for Kael, Thrall, Imp, Brute, the Hollow Warden and a
  training dummy; AnimationMixer controller with pose-built clips, crossfades, clip events,
  additive hurt reactions and head look-at.
- **Combat:** data-driven damage formula with crits, defence, difficulty and bonuses; health,
  poise/stagger, knockback/knockdown, status effects (bleed stacks, burn, slow); ActionRunner
  with startup/active/recovery, cancel windows, i-frames and root-motion-style move curves;
  Rapier shape queries + precise arc/circle/box hit tests; hit-stop, shake, sparks, damage numbers.
- **Hero Kael:** 5-hit combo with 150 ms input buffer, dodge with i-frames and perfect-dodge
  slow-mo + counter (×1.5), skills Rending Dash, Blade Gyre (steerable spin), Umbral Step
  (shadow step, guaranteed crit), ultimate Hollow Legion (shadow clones), weapon trails.
- **Enemies:** Thrall (chop), Imp (fast pounce, can burn), Brute (slam + sweep, heavy poise); AI state machine with
  telegraphs, attack tokens (max 2 attackers on Normal), whisker obstacle avoidance, crowd
  separation; pooled roster.
- **Boss — The Hollow Warden:** cinematic intro, 3 phases (flaming weapon from phase 2),
  phase-change shockwave push, locked-target leap, break bar with stun and damage bonus, enrage timer, boss HP bar.
- **Stage flow:** The Cinder Court — 12 s practice countdown with a training dummy, 3 waves,
  boss, victory screen with 1–3 stars (clear / no revive + low damage / par time), rewards;
  defeat screen with one gem revive per run.
- **Save v2:** wallet (gold, gems, souls, materials, tickets) + stage records, v1 → v2
  migration (20 starting gems so revive can be tried).
- **Audio:** procedural Web Audio SFX (swings, hits, crits, hurt, dodge, perfect dodge,
  skills, ultimate, telegraphs, slams, boss roar, soul pickup, break, victory/defeat).
- **Android APK:** Capacitor 8 project, `android-preview.yml` builds a signed debug APK on every
  push and publishes it to the `ashbound-preview` pre-release; an emulator job boots it and
  attaches screenshots + WebView console.
- **Debug:** cheats God, Kill, Boss, -50% boss HP; test hook `window.__ashbound`; all battle
  shaders precompiled at load.
- **Tests:** 139 unit/integration tests, 10 Playwright smoke tests incl. full boss run,
  defeat/revive and 60 s soak.

### Changed

- The M1 test arena mode and capsule hero are replaced by the battle mode and skinned rig.
- The debug overlay is click-through (only its cheat buttons take touches); the corner gesture
  counts taps by gap (3 taps, ≤ 1 s apart).

### Fixed

- Boss HP bar no longer overlaps the player HP bar on narrow screens.
- Training dummy is removed when waves or the boss intro start.
- Enemy eyes were hidden inside the head.

## [0.1.0] — M1 Foundation (2026-10-18)

### Added

- Vite 8 + TypeScript 6 (strict) project, ESLint 10 + typescript-eslint, Prettier, Vitest 5,
  Playwright 1.56 (Pixel 7 landscape, real CDP multi-touch).
- GitHub Pages workflow: typecheck, lint, format check, unit tests, build, deploy on every push
  to `main` / `ccr-*`.
- Core: typed allocation-free event bus, service registry, fixed-timestep loop (60 Hz logic,
  interpolated render, max 5 sub-steps, spiral-of-death protection), time control (hit-stop,
  slow motion), FPS cap limiter (30/60, works on 60/90/120 Hz panels), game clock.
- Input: floating virtual joystick (dead zone, response curve, base follows thumb), ATTACK /
  DODGE / 3 SKILL (radial cooldown rings) / ULTIMATE (fill + glow when charged) buttons,
  per-pointer multi-touch with slide-off release and stuck-touch safety nets, 150 ms input
  buffer on game time, keyboard and gamepad (standard mapping), browser gesture blocking,
  fullscreen + landscape lock on first tap, portrait hint.
- Rendering: ACES tone mapping, sRGB output, PMREM environment map, moonlight key with a tight
  texel-snapped shadow frustum following the player, hemisphere fill, fresnel rim light on the
  hero, exponential fog, flickering brazier lights, GPU ember/dust particles, blob contact
  shadow, bloom (HIGH), CSS vignette.
- Quality presets LOW/MEDIUM/HIGH (pixel ratio, shadows, shadow map size, bloom, particles,
  point lights, enemy cap, texture budgets) with a startup FPS benchmark (median-based,
  no oscillation) and a device-hint initial guess; result saved and reused.
- Physics: Rapier world, kinematic character controller (slide, slope limit, auto-step,
  snap-to-ground), data-built test arena (wall ring, pillars, steps, ramp + platform, rocks,
  braziers) with instanced visuals.
- Placeholder hero Kael: capsule-based body with procedural breathing, distance-driven run
  cycle, lean, and an alternating placeholder blade swing on ATTACK.
- Follow camera: distance/height/yaw/FOV in config, smoothing, look-ahead, trauma shake.
- Save: versioned JSON with migration runner, IndexedDB → localStorage → memory backends,
  corrupt/future saves backed up instead of destroyed. Settings persisted.
- Debug: overlay (FPS, frame time mean/p95/max, logic steps, draw calls, triangles,
  geometries/textures/programs, entities, particles, colliders, JS heap, quality, DPR,
  player state, input state) toggled by triple-tapping the top-left corner; cheats (shake,
  hit-stop, slow-mo, fill ultimate, reset cooldowns, flash); log capture; "Copy debug log" in
  the pause menu and on the fatal error screen.
- Title screen shown instantly while the engine chunk loads; pause menu with graphics,
  FPS cap, debug overlay, fullscreen, respawn and copy-log.
