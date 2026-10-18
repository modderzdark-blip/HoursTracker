# Changelog

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
