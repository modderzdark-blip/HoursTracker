# Technical decisions

Each entry: the decision, why, and what would change it.

## Toolchain

- **TypeScript 6.0.3, not 7.0.** TS 7 (native) is the npm `latest`, but `typescript-eslint` 8.71
  declares support for `typescript >=4.8.4 <6.1.0`. Typed lint rules are worth more than the
  faster compiler. Revisit when typescript-eslint supports TS 7.
- **Vite 8 / Vitest 5 / ESLint 10** — current stable majors; peer ranges checked at install.
- **Playwright 1.56.1** (not latest 1.64): it matches the Chromium build (1194) preinstalled in
  the cloud environment, so no browser download is needed. CI does not run e2e yet.
- **Exact version pins** in package.json + lockfile for reproducible cloud builds.

## Architecture

- **Composition root (`src/app/App.ts`) + typed EventBus + small ServiceRegistry.** Systems get
  dependencies through constructors; the bus carries cross-module events; the registry is only
  for late-bound tools (debug, tests). Avoids both god objects and global singletons.
- **Extra folders vs. the brief:** `src/app/` (composition root) and `src/physics/` (Rapier
  wrappers). Putting them in `core/` would make `core` depend on gameplay and three.js.
- **All tunables in `src/data/`.** Logic files contain no balancing numbers.
- **Fixed 60 Hz logic + interpolated render.** Deterministic timing for combat windows
  (startup/active/recovery, i-frames) regardless of display rate; smooth on 90/120 Hz panels.
- **Game clock for timing windows.** The input buffer and cooldowns run on game time, so
  hit-stop and slow motion stretch them consistently with gameplay.

## Rendering

- **WebGLRenderer, not WebGPU.** WebGPU on Android Chrome is still inconsistent across GPUs;
  WebGL2 is universal. Revisit after M14 with real device data.
- **MSAA on the default framebuffer for MEDIUM/HIGH** — cheap on tile-based mobile GPUs. The
  `antialias` flag is fixed at context creation, so switching to/from LOW at runtime changes
  AA only after a reload (all other preset settings apply live).
- **Bloom only on HIGH**, via EffectComposer on a 4× MSAA half-float target, then OutputPass
  for tone mapping/sRGB. **Vignette is CSS** (free on the 3D path).
- **PCFShadowMap.** `PCFSoftShadowMap` was removed in three r186 (verified in source).
- **Shadow frustum follows the player and snaps to texels** to avoid shimmering with a tight
  frustum (high shadow resolution where it matters).
- **Rim light via `onBeforeCompile` fresnel**, not an extra light: one shader tweak, no cost per
  light.
- **Particles fully GPU-animated** (one draw call, two uniform writes per frame).
- **Quality benchmark uses the median frame interval** over 120 frames after a 45-frame
  warm-up, runs uncapped, never upgrades after a downgrade. Result is saved.

## Physics & movement

- **Rapier compat build** (`@dimforge/rapier3d-compat` 0.21): WASM embedded as base64, no
  bundler plugin or extra fetch, works offline and in Capacitor. Cost: ~4.1 MB raw / ~1.5 MB
  gzip in the lazily loaded engine chunk. Alternative for M14 if load time matters: the
  non-compat package with a separately fetched `.wasm` (~3 MB, compresses better).
- **Kinematic character controller** for all characters; hit detection (M2+) will use sensor
  colliders / shape casts — never physics impulses between characters.

## Input

- **Pointer Events with per-pointer tracking** instead of Touch Events: one code path for
  touch, mouse and pen; implicit capture keeps moves flowing. Safety nets: slide-off release,
  release on `touchend` with zero touches, on blur/visibility change and on resize.
- **Menu buttons fire on `pointerup` inside the element**, not `click`: gesture blocking
  disables some synthesized clicks on mobile.

## UI

- **Plain DOM + CSS, no framework.** A dozen screens don't justify a framework; DOM writes are
  cached so the HUD touches styles only when values change.
- **System fonts only** (no web font download): works offline and in the APK; the serif title
  stack gives the dark-fantasy look.

## Save

- **IndexedDB → localStorage → memory**, versioned JSON with a migration runner. Corrupt or
  future-version saves are backed up under `save.corrupt`, never silently deleted.

## Deployment

- **GitHub Pages via Actions** on `main` and `ccr-*`. The `github-pages` environment needs a
  deployment-branch rule for `ccr-*` (see README).
