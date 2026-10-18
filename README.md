# Ashbound

Mobile dark-fantasy hack-and-slash action RPG — Three.js + TypeScript + Rapier, no engine.
Playable in Chrome on Android (GitHub Pages) and as a sideloadable Capacitor APK.

> Status: **0.2.0 — gameplay prototype**: one stage (practice dummy → 3 waves → 3-phase boss →
> result screen), full hero moveset, enemy AI, revive, save. Characters are procedural
> placeholder rigs. See [CHANGELOG.md](CHANGELOG.md) and
> [docs/TEST_REPORT_PROTOTYPE.md](docs/TEST_REPORT_PROTOTYPE.md).

## Play it

- **APK (Android):** <https://github.com/modderzdark-blip/HoursTracker/releases/download/ashbound-preview/Ashbound-preview.apk>
  — open it on the phone, allow "Install unknown apps" for your browser, install. Every CI run
  replaces it; new builds install over the old one (same signing key, increasing versionCode).
- **Web (Chrome on Android):** `https://modderzdark-blip.github.io/HoursTracker/` once Pages is
  enabled (see [Deploying](#deploying-github-pages)).

### Controls

| Touch                      | Keyboard  | Action                                                       |
| -------------------------- | --------- | ------------------------------------------------------------ |
| Left half: floating stick  | WASD      | Move                                                         |
| ATTACK                     | J         | 5-hit combo (tap again during a swing; inputs buffer 150 ms) |
| DODGE                      | Space     | Dash with i-frames; dodge just before a hit = perfect dodge  |
| Skill 1 / 2 / 3            | 1 / 2 / 3 | Rending Dash / Blade Gyre (steer with stick) / Umbral Step   |
| ULT (when glowing)         | R         | Hollow Legion — shadow clones                                |
| Pause (top right)          | Esc       | Pause menu (graphics, restart, copy debug log)               |
| Triple-tap top-left corner | `         | Debug overlay + cheats                                       |

## Project structure

```
src/
  main.ts          entry: log capture, gesture guards, title screen, lazy-loads the engine chunk
  app/             composition root (App.ts) — wires systems, debug cheats, test hook
  core/            EventBus, ServiceRegistry, GameLoop (fixed step + interpolation),
                   FixedTimestep, TimeControl (hit-stop / slow-mo), FrameLimiter, GameClock, random
  input/           actions, InputState, InputBuffer, TouchControls, KeyboardInput, GamepadInput,
                   gestureGuards (fullscreen, landscape, no zoom)
  camera/          FollowCamera, CameraShake (trauma), CameraDirector (boss intro / framing)
  render/          RenderContext (renderer + bloom), Atmosphere, QualityManager + qualityLogic,
                   procedural textures, rim light
  physics/         PhysicsWorld (Rapier), CharacterBody (kinematic controller), collision groups
  anim/            HumanoidRig (procedural skinned placeholder, Mixamo bone names), poses,
                   clipBuilder, clipSets, AnimationController (mixer, events, hurt layer, look-at)
  combat/          damage formula, Health, Poise, StatusEffects, ActionRunner (startup/active/
                   recovery, cancel windows, i-frames), hitShapes, CombatSystem, Cooldowns, UltimateMeter
  actors/          Actor, Player, Enemy, Boss, TrainingDummy, components/ (CharacterMotor, movementMath)
  ai/              EnemyBrain (state machine, whiskers), BossBrain (phases, break, enrage),
                   AttackTokens (max simultaneous attackers)
  modes/           BattleMode (orchestrator), WaveDirector, EnemyRoster (pool), crowd, ArenaBuilder
  progression/     Wallet (currencies), stars (run rating)
  data/            ALL tunables: config, quality, heroes, rigs, enemies, bosses, stages, arenas,
                   statusEffects, difficulty, economy, combatTypes
  save/            SaveStore (versioned JSON v2), backends, migrations, settings
  ui/              styles.css, TitleScreen, BattleHud, DamageNumbers, ResultScreen, Hud, PauseMenu, ...
  audio/           AudioManager (Web Audio), Sfx (procedural sound effects)
  vfx/             Sparks, WeaponTrails, TelegraphDecals, SoulOrbs, BlobShadows, ShadowClones, EmberField
  debug/           LogCapture, DebugOverlay (+cheats), FrameStats, deviceInfo, report, clipboard
public/assets/     models/ animations/ textures/ audio/ (empty until real assets arrive)
tests/unit/        Vitest (logic, real Rapier physics, battle integration)
tests/e2e/         Playwright smoke tests (Pixel 7 landscape, real CDP multi-touch, 60 s soak)
android/           Capacitor 8 Android project
scripts/ci/        emulator smoke script used by the APK workflow
.github/workflows/ deploy-pages.yml, android-preview.yml
```

Rules: data-driven (balancing never touches logic), systems talk through the typed `EventBus`
(`src/core/events.ts`), no god objects, no circular imports, no per-frame allocations in hot loops.

## Commands

| Command                                 | What it does                                           |
| --------------------------------------- | ------------------------------------------------------ |
| `npm run dev`                           | Vite dev server                                        |
| `npm run build`                         | Production build to `dist/`                            |
| `npm run typecheck`                     | `tsc --noEmit` for app + config/e2e projects           |
| `npm run lint` / `npm run format:check` | ESLint (zero warnings) / Prettier                      |
| `npm test`                              | Vitest unit tests                                      |
| `npm run test:e2e`                      | Playwright smoke tests (builds + serves `dist/` first) |
| `npm run check`                         | Everything above except e2e                            |

## Combat model

`damage = ATK × skillMultiplier × crit × 100 / (100 + DEF) × difficultyMultiplier × bonuses`
(`src/combat/damage.ts`). Crit = `critMult` with probability `critChance` (or forced). Every hit
also deals poise damage (stagger when poise breaks; the boss has a separate break bar), can apply
bleed (stacking) / burn / slow (refresh), grants ultimate charge, and drives hit-stop, shake and
sparks from its `HitSpec`. Hits are found with Rapier shape intersections and then precise
arc / circle / box tests in 2D. One pipeline (`CombatSystem.applyHit`) serves player, enemies and boss.

## Deploying (GitHub Pages)

The APK is built by `.github/workflows/android-preview.yml` (tests → web build → `cap sync` →
`assembleDebug`, signed with a public test key in `android/app/sideload-test.keystore`; never
use it for a store release).

Every push to `main` or any `ccr-*` branch runs `.github/workflows/deploy-pages.yml`:
typecheck → lint → format check → unit tests → build → deploy.

One-time repository setup:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
2. **Settings → Environments → github-pages → Deployment branches and tags**: GitHub only lets the
   default branch deploy by default. Click **Add deployment branch or tag rule**, enter `ccr-*`
   and save (or pick "No restriction").
3. Re-run the workflow: **Actions → Deploy to GitHub Pages → Run workflow** (or push).

The site is served at `https://<owner>.github.io/<repo>/`. The build uses a relative base (`./`),
so it works under any path and inside Capacitor.

## Adding content through data

- **Hero**: `HEROES` in `src/data/heroes.ts` — stats, five combo `ActionDef`s (timings, hit
  shapes, multipliers, move curves, cancel windows), dodge, three skills, ultimate, visual.
- **Enemy**: add an entry to `ENEMIES` in `src/data/enemies.ts` (stats, rig, poise, attacks with
  range / cooldown / weight / telegraph / chains, aggro and hold distances, souls dropped) and a rig in `src/data/rigs.ts`. Reference it from
  a wave in `stages.ts`.
- **Boss**: `BOSSES` in `src/data/bosses.ts` — stats, phases (HP threshold, attack set, speed and
  damage multipliers), break bar, enrage timer, intro and transition timings. Set `boss:` in a stage.
- **Stage**: copy `proto_cinder_court` in `src/data/stages.ts` (waves, spawn intervals,
  countdown, star rules, rewards) and an arena in `src/data/arenas.ts` (geometry, spawn points,
  boss/dummy spawns). Every pillar, block and ramp becomes a visual plus a collider.
- **Status effects / difficulty / economy**: `statusEffects.ts`, `difficulty.ts`, `economy.ts`.
- **Quality presets**: `src/data/quality.ts`; benchmark thresholds in `BENCHMARK_CONFIG`.
- **Camera**: `CAMERA_CONFIG` in `src/data/config.ts` (distance, height, yaw, FOV, boss framing).

## Swapping assets

Characters are procedural skinned meshes (`src/anim/HumanoidRig.ts`) built on a skeleton with
Mixamo bone names (`mixamorig:Hips`, ...), driven by an `AnimationMixer` with named clips, so
real models can replace them without touching gameplay. The swap is designed as one field —
`visual` in `src/data/heroes.ts` from `{ kind: 'rig', rig: 'kael' }` to
`{ kind: 'gltf', url: 'assets/models/kael.glb', scale: 1 }` — **but the glTF loader itself is
not implemented yet** (selecting `gltf` throws a clear error). It lands with the asset
milestone, together with the list of Mixamo files to export.

## Debugging on a phone

- **Debug overlay**: triple-tap the top-left corner, or Pause → Debug overlay → On.
- **Copy debug log**: Pause → Copy debug log — copies build, device/GPU info, live stats,
  settings and the last 80 log lines.
- **Cheats** (in the overlay): Shake, Slowmo, ULT (fill), CD (reset cooldowns), God, Kill
  (all enemies), Boss (skip to boss), -50% (boss HP).
- **Android emulator check**: the APK workflow also boots the APK on an API 34 emulator and
  attaches two screenshots plus the WebView console to the `ashbound-preview` release.
