# Technical decisions

Each entry: the decision, why, and what would change it.

## Toolchain

- **TypeScript 6.0.3, not 7.0.** TS 7 (native) is the npm `latest`, but `typescript-eslint` 8.71
  declares support for `typescript >=4.8.4 <6.1.0`. Typed lint rules are worth more than the
  faster compiler. Revisit when typescript-eslint supports TS 7.
- **Vite 8 / Vitest 5 / ESLint 10** — current stable majors; peer ranges checked at install.
- **Playwright 1.56.1** (not latest 1.64): it matches the Chromium build (1194) preinstalled in
  the cloud environment, so no browser download is needed. CI does not run e2e (SwiftShader runs at ~7 FPS; the suite is run in the cloud session).
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

## Gameplay prototype (0.2.0)

- **Procedural skinned rigs instead of capsules or downloaded models.** Placeholders use the
  same pipeline real assets will (Skeleton + SkinnedMesh + AnimationMixer + named clips +
  sockets) with Mixamo bone names, so swapping in glTF changes the visual source, not the
  gameplay code. Each rig is merged into one skinned mesh plus one emissive mesh → 2 draw calls
  per character. Clips are generated from a small pose library.
- **Combat hits = Rapier `intersectionsWithShape` (broad) + exact 2D shape tests (narrow).**
  Rapier finds candidates near the swing; arc/circle/box tests on the ground plane give exact,
  readable hit areas matching the telegraph decals. No physics impulses between characters;
  characters collide only with world geometry (collision groups) and are separated by a crowd pass.
- **Attack tokens** cap how many enemies attack at once (2 on Normal, data in `difficulty.ts`),
  the standard trick that keeps crowds fair on a small screen.
- **One damage pipeline** (`CombatSystem.applyHit`) for every source, reusing one HitEvent
  object (no per-hit allocation).
- **Shader warm-up:** `renderer.compile` only walks visible objects, so pooled (hidden) enemies,
  boss, VFX and clones are made visible for one compile call and restored. Removes the hitch
  when the first enemy / boss / ultimate appears.
- **Procedural SFX** (Web Audio oscillators/noise) until a sound pack exists: zero download,
  works offline in the APK.

## Android APK

- **Capacitor 8** wraps `dist/` in an Android WebView. Landscape (`sensorLandscape`), status
  bar hidden. Source maps are deleted before `cap sync` (smaller APK, no source in the package).
- **Debug build signed with a committed public test keystore** (`android/app/sideload-test.keystore`,
  password `android`). Reason: every CI runner would otherwise generate a new debug key and
  Android refuses to update an app signed with a different key. It protects nothing, so it must
  never be used for a store release (that needs a private key in repository secrets).
- **Store signing is secret-gated** (M15): the release `signingConfig` exists only when
  `ASHBOUND_KEYSTORE_FILE` is set, and the workflow decodes the keystore from a base64 secret
  into `$RUNNER_TEMP` and deletes it after the build. `secrets` cannot be read in a step `if:`,
  so the job exposes only a boolean `HAS_RELEASE_KEY`. Signed outputs go to a workflow artifact,
  not the public pre-release.
- **versionCode = workflow run number** so each preview installs over the previous one.
- **Published to one pre-release (`ashbound-preview`) with `gh release upload --clobber`**: a
  stable download link the tester can bookmark on the phone.
- **Emulator smoke job** (`reactivecircus/android-emulator-runner@v2`, API 34, x86_64,
  SwiftShader GPU): installs the APK, launches it, taps start, attaches screenshots and the
  WebView console to the release. Software GPU, so it proves the app boots and renders, not
  real-device performance.

## Testing

- **Test hook `window.__ashbound`** (state + commands such as skip countdown, kill all, skip to
  boss) lets e2e tests reach every stage state in minutes on a ~7 FPS software renderer.
  Cheats in the debug overlay call the same methods.
- **Speed-tolerant e2e assertions.** Headless SwiftShader runs game time at roughly a third of
  real time, so the wave test requires ≥ 1 kill in 120 s and the soak test requires that combat
  happened (ultimate charge or kills > 0), not a fixed kill count. Exact combat behaviour is
  covered by the deterministic integration tests instead.
- **Warm-up tap in the gesture test:** the first CDP touch on a fresh page took ~2 s in headless
  Chromium, which broke the triple-tap timing; one tap elsewhere first makes it reliable.

## Full game loop (0.3.0)

- **One battle = one scene + one Rapier world**, created on start and disposed on exit. Cheaper
  to reason about than resetting a long-lived world between very different stages (arenas,
  bosses, duels) and guarantees nothing leaks between fights. The hub has its own tiny scene.
- **Menus are DOM screens rebuilt on every change** (`ui/menu/`): the hub/menus are not
  performance-critical, and full rebuilds keep the code simple and listener-leak-free (each
  rebuild disposes the previous listeners).
- **`PlayerProfile` is the only API over the save** for wallet, heroes, gear, skills, records
  and unlocks. Every change ends with `commit()` (wallet sync + debounced save). Economy rules
  (no negatives, all-or-nothing spends, auto-salvage on a full bag) live there and in `Wallet`,
  isolated so IAP could be added later without touching gameplay.
- **Gear never breaks**: failed upgrades above +10 cost the materials but never destroy or
  downgrade the item (brief: "no item destruction").
- **Pity counts drops, not battles**, so multi-drop boss chests don't burn pity faster than
  single drops.
- **Moves emit effects through data** (`TimedHit.emit`): arrows, fireballs, rain, traps,
  shockwaves, meteors and eruptions are all projectiles or ground zones from one pooled
  `Effects` system, and every hit still goes through `CombatSystem.applyHit` (formula, i-frames,
  poise, statuses, ultimate charge unchanged).
- **Arena duels use the real hero code**: the opponent is a `Player` on the enemy team whose
  input comes from a `DuelistBrain` writing to its own `InputState` (own event bus, so its
  presses never reach the UI). Same movesets, i-frames and cooldowns as the human — "the same
  AI system with a duelist behaviour" without a second moveset implementation.
- **Arena is offline**: opponents are generated from a seed near the player's rating and power
  (level × number of gear slots searched to match power), seasons are 7 days of real time, the
  leaderboard is generated per season plus the player. Real online PvP stays out of scope.
- **Dungeon entries refill on real time** (epoch ms in the save) — no server needed; clock
  changes on the phone can be exploited, which is acceptable for an offline single-player game.
- **Procedural music** (Web Audio sequencer with look-ahead scheduling) instead of audio files:
  zero download, works offline, separate volume. Replaceable by real tracks later.
- **Balance is guarded by a test, not by feel alone** (`tests/unit/goals.test.ts`): a player who
  clears each stage once with rare +3 gear must find every boss within a hit-count band, the
  final boss at most 1.6× the first chapter boss, and meet the recommended power. 0.3.0 had
  heroes at level ~9 when reaching the level-24 final boss (~370 average hits to kill); the XP
  curve (40 × L^1.3), stage XP, per-level enemy HP/DEF and boss HP were retuned together.
- **Help after defeats is per stage and temporary** (Ember Blessing): it removes walls without
  making the rest of the game easier, and disappears on the clear so stars still mean
  something.
- **Daily systems use local days and wall-clock time, offline** (quests, login calendar,
  hearth): the same trade-off as dungeon refills — no server, clock changes are exploitable,
  acceptable offline. A clock moved backwards yields nothing rather than a negative.
- **Login calendar never resets on a missed day**: retention without punishment.
- **Secondary motion is procedural, on top of the clips** (`BodyDynamics`): torso lean and
  directional hit recoil are springs applied after the mixer, so they work for every rig and
  will also apply to real models later. Attack clips get easing keys (anticipation, snap,
  follow-through overshoot) generated from the same wind/hit poses — no new data per move.
- **Characters stay procedural, but sculpted** (0.5.0): the brief requires original assets and
  the asset sites are unreachable from the build environment, so instead of downloading models
  the rig builder lofts smooth bodies, blends skin weights across joints, and builds outfits,
  armor and weapons from per-rig data. One skinned mesh + one glow mesh per character (2 draw
  calls), ≤ 9k triangles for crowd enemies and ≤ 12k for heroes and bosses (unit-tested).
- **Per-vertex roughness/metalness** in one material instead of several materials per
  character: plate, leather, cloth and skin read differently without extra draw calls.
- **Cloth on spring bones, not a cloth simulation**: capes, scarves, tabards, tails and wings
  are short bone chains driven by damped springs from the character's velocity, turn rate and
  pose (they hang with gravity and clear the legs). Cheap, stable, works with real models too.
- **Camera fill in the character shader, not a scene light**: a scene-wide fill light also lit
  the whole floor (measurable cost in software rendering); the shader term lights only
  characters, from above-left of the view.
- **Run cadence from speed and step length** (`runCycleSec`): the feet stay planted at any
  speed; a unit test measures stance-foot speed against running speed.
- **Attack magnetism** (`INPUT_CONFIG.aimAssist`): melee combo lunges stretch toward the
  auto-aimed enemy or shrink when it is close. Ranged shots and skills keep data distances.
- **Floating combat text stacks into rows** chosen on its first frame instead of random jitter,
  so numbers and STAGGER/BLOCK/MISS never draw over each other or the top HUD.
- **UI layout is tested, not eyeballed**: `tests/e2e/ui-audit.spec.ts` visits 35 screen states
  at several phone/tablet sizes and fails on overlaps, clipping, off-screen content, tiny text
  or small tap targets.
- **Left-handed layout = CSS mirror** of the button cluster (labels flipped back) and the
  joystick zone moved right; hit-testing uses live element rects, so it needs no code changes.

## Creatures, Hunts and settings (0.6.0)

- **Creature bodies are procedural like the humanoids** (`src/anim/creatures/`): each body plan
  (spider, beast, wyrm) owns a skeleton, builds one skinned mesh + one glow mesh, and poses its
  bones procedurally from the mode the AI asks for (`idle`, `run`, `<attack>:tele`,
  `<attack>:strike`, `stagger`, `death`…). `CreatureRig` / `CreatureAnimator` implement the same
  interfaces as `HumanoidRig` / `AnimationController`, so actors, AI, trails and VFX did not
  change. An attack's `motion` field picks the creature animation; humanoids ignore it.
- **Burrow is a boss special like leap**: sink during the telegraph, tunnel to the locked
  target, erupt when the attack goes active; untouchable while more than 0.8 m under.
- **Chapter 4 expects some grinding** (epic gear) — the balance guard says so explicitly
  instead of pretending first clears with rare gear are enough; deeper chapters also pay more
  XP so hero levels keep pace.
- **Hunts reuse the boss roster** with omens (stat / speed / adds modifiers) rather than new
  content per day; the board is a pure function of the local day, so it survives restarts with
  no server, and early bosses scale to the player's progress so every boss stays worth hunting.
