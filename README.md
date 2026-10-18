# Ashbound

Mobile dark-fantasy hack-and-slash action RPG — Three.js + TypeScript + Rapier, no engine.
Playable in Chrome on Android (GitHub Pages) and, later, as a Capacitor APK.

> Status: **M1 — Foundation** (test arena, touch controls, follow camera, quality presets,
> debug tools). See [CHANGELOG.md](CHANGELOG.md) and [docs/TEST_REPORT_M1.md](docs/TEST_REPORT_M1.md).

## Project structure

```
src/
  main.ts          entry: log capture, gesture guards, title screen, lazy-loads the engine chunk
  app/             composition root (App.ts) — wires systems together, owns nothing gameplay-specific
  core/            EventBus, ServiceRegistry, GameLoop (fixed step + interpolation),
                   FixedTimestep, TimeControl (hit-stop / slow-mo), FrameLimiter, GameClock, random
  input/           actions, InputState (multi-source), InputBuffer, TouchControls (floating joystick +
                   buttons), KeyboardInput, GamepadInput, gestureGuards (fullscreen, landscape, no zoom)
  camera/          FollowCamera (distance/height/yaw from config), CameraShake (trauma)
  render/          RenderContext (renderer + bloom chain), Atmosphere (lights, fog, env map, shadow
                   frustum), QualityManager + qualityLogic (presets, benchmark), procedural textures, rim light
  physics/         PhysicsWorld (Rapier), CharacterBody (kinematic character controller)
  actors/          Player, PlaceholderHeroVisual, components/ (CharacterMotor, movementMath)
  combat/          Cooldowns, UltimateMeter (combat core arrives in M2)
  modes/           TestArenaMode, ArenaBuilder (data → visuals + colliders)
  data/            ALL tunables: config.ts, quality.ts, heroes.ts, arenas.ts
  save/            SaveStore (versioned JSON), backends (IndexedDB → localStorage → memory),
                   migrations, settings
  ui/              styles.css, TitleScreen, Hud, PauseMenu, Segmented, ErrorScreen, dom helpers
  audio/           AudioManager (Web Audio, unlocks on first touch)
  vfx/             EmberField (GPU particles), BlobShadow (fake contact AO)
  debug/           LogCapture, DebugOverlay (+cheats), FrameStats, deviceInfo, report, clipboard
  anim/ ai/ progression/   created now, filled in M3 / M4 / M8
public/assets/     models/ animations/ textures/ audio/ (empty until real assets arrive)
tests/unit/        Vitest (logic + real Rapier physics in Node)
tests/e2e/         Playwright smoke tests (Pixel 7 landscape, real CDP multi-touch)
.github/workflows/ deploy-pages.yml
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

## Deploying (GitHub Pages)

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

- **Hero**: add an entry to `HEROES` in `src/data/heroes.ts` (movement, capsule body, visual, skill
  slots). Movesets/combos extend this record from M2.
- **Arena / stage layout**: copy `TEST_ARENA` in `src/data/arenas.ts`; every pillar, block, ramp,
  rock and brazier becomes a visual plus a matching static collider via `ArenaBuilder`.
- **Enemies, stages, drops**: data files arrive with M4/M7/M8 following the same pattern.
- **Quality presets**: `src/data/quality.ts` (pixel ratio, shadows, bloom, particles, budgets);
  benchmark thresholds in `BENCHMARK_CONFIG`.
- **Camera**: `CAMERA_CONFIG` in `src/data/config.ts` (`distance`, `height`, `yawDeg`, `fovDeg`, ...).

## Swapping assets

Characters render as procedural placeholders until real models land (M3). A hero's look is one
field: change `visual` in `src/data/heroes.ts` from `{ kind: 'placeholder', ... }` to
`{ kind: 'gltf', url: 'assets/models/kael.glb', scale: 1 }`. (The glTF loading path is
implemented in M3 together with the animation system; M3's asset list says exactly which
Mixamo files to export and where to put them.)

## Debugging on a phone

- **Debug overlay**: triple-tap the top-left corner, or Pause → Debug overlay → On.
- **Copy debug log**: Pause → Copy debug log — copies build, device/GPU info, live stats,
  settings and the last 80 log lines.
- Keyboard (desktop): WASD/arrows move, J attack, Space dodge, 1–3 skills, R ultimate,
  Esc pause, ` overlay.
