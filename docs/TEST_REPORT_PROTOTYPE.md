# Prototype Test Report — 0.2.0 gameplay prototype

Build: v0.2.0 · Date: 2026-10-18 · Environment: cloud container (Node 22, headless Chromium 141
via Playwright 1.56.1, SwiftShader software WebGL 2, ~7 FPS). No physical Android device was
available to the developer; everything marked UNTESTED below needs a phone.

## Summary

| #   | Check                                               | Result                                                                                        |
| --- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 1   | `tsc --noEmit` (app + config/e2e projects)          | **PASS** — 0 errors                                                                           |
| 2   | ESLint (`--max-warnings=0`) + Prettier check        | **PASS** — 0 errors, 0 warnings                                                               |
| 3   | Vitest unit + integration tests                     | **PASS** — 139/139 in 13 files                                                                |
| 4   | `vite build`                                        | **PASS** — sizes below                                                                        |
| 5   | Playwright smoke (Pixel 7 landscape 915×412, touch) | **PASS** — 10/10, incl. full boss run and 60 s soak                                           |
| 6   | APK build in GitHub Actions (`android-preview.yml`) | **PASS** on earlier runs (APK downloaded and its contents checked); see CI section            |
| 7   | APK on Android emulator (API 34, software GPU)      | Job added in this release — result recorded in the release assets (`status.txt`, screenshots) |
| 8   | GitHub Pages deploy                                 | **BLOCKED** — Pages must be enabled in repository settings (README → Deploying)               |
| 9   | Real Android phone (touch feel, FPS, heat, audio)   | **UNTESTED**                                                                                  |

## Unit and integration tests (Vitest)

| File                         | Covers                                                                                                                                                                                                                                              |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `damage.test.ts`             | Formula (ATK × skill × crit × 100/(100+DEF) × difficulty × bonus), crit roll / forced crit / crit rate, never below 1, DoT damage; Health; Poise break + regen delay; StatusEffects (bleed stacks, burn/slow refresh, ticks, weaker re-application) |
| `actionRunner.test.ts`       | Startup → active → recovery, each hit fires once even with big steps, cancel window / i-frames / super armor, move fractions, attack speed; hit shapes (arc, circle, box, bounding radius)                                                          |
| `battle.integration.test.ts` | Real Rapier world: 5-hit combo chain, buffered input, dodge i-frames, perfect dodge + counter (166 damage), skills and ultimate, AI never exceeds 2 attack tokens, stagger, death, boss phases, break, enrage                                       |
| `systems.test.ts`            | AttackTokenManager (incl. random churn), WaveDirector (countdown → waves → boss → victory, enemy cap, skip to boss), Wallet (no negatives, no duplication, sanitising), star rating, save v1 → v2 migration and repair                              |
| `combat.test.ts`             | Cooldowns, UltimateMeter                                                                                                                                                                                                                            |
| `core`, `input`, `movement`  | As in M1 (event bus, fixed step at 30–144 Hz, time control, joystick, 150 ms input buffer, character motor), updated for the new motor constructor                                                                                                  |
| `physics`, `save`, `quality` | As in M1 (Rapier character controller, versioned saves on all backends, quality benchmark)                                                                                                                                                          |
| `debug`, `data`              | Debug report; data sanity for heroes, arena and config                                                                                                                                                                                              |

Not applicable yet (systems not built): XP curve, gear upgrade rates, drop tables/pity. The
economy test covers the wallet and revive cost only.

## Build (`vite build`)

| File                      | Raw     | Gzip    | Loaded                        |
| ------------------------- | ------- | ------- | ----------------------------- |
| `index.html`              | 0.9 KB  | 0.5 KB  | before title                  |
| `index-*.js` (entry)      | 20.6 KB | 7.9 KB  | before title                  |
| `index-*.css`             | 15.4 KB | 4.3 KB  | before title                  |
| `App-*.js` (engine chunk) | 5.11 MB | 1.85 MB | lazily, while the title shows |

The engine chunk is mostly the Rapier WASM (embedded base64, ~4.1 MB raw) plus three.js.

## Playwright smoke tests (headless, SwiftShader)

| Test              | What it proves                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| title screen      | Title appears before the engine loads, no console errors                                          |
| battle renders    | Tap to start → canvas renders, HUD present, countdown running                                     |
| joystick + attack | Real multi-touch: stick moves the hero, ATTACK advances the combo                                 |
| skill slide-off   | Finger sliding off a skill button releases it (no stuck input)                                    |
| wave combat       | Waves spawn, AI engages, ≥ 1 kill within 120 s with real touch input                              |
| boss to victory   | Skip to boss → intro → phase 2 reached → kill → victory screen with stars and rewards             |
| defeat / revive   | Death → defeat screen → gem revive works once, second death offers no revive                      |
| pause / copy log  | Pause menu opens, game time stops, debug log copies                                               |
| hidden gesture    | Triple-tap top-left toggles the debug overlay                                                     |
| 60 s soak         | 60 s of continuous combat: no errors, heap 13.12 → 13.69 MB, plateauing (≈ 9.5 KB/s, GC sawtooth) |

**Draw calls:** max 22 during waves and the boss fight on LOW (the benchmark picks LOW on
SwiftShader); budget is 150. Triangles max ≈ 13.2 k. MEDIUM/HIGH draw calls were not measured
separately (shadows add one pass per caster) — **UNTESTED** on a device.

### Screenshots (`docs/screenshots/proto/`, headless, LOW quality unless noted)

01 title · 02 practice countdown with dummy · 03 wave fight · 04 boss intro · 05 boss fight ·
06 boss phase 2 (flaming weapon) · 07 victory · 08 defeat/revive · 09 pause · 10 HIGH preset ·
11 debug overlay.

## Manual review findings fixed in this release

- Debug overlay intercepted joystick touches (CSS rule had never applied) → click-through.
- Enemy eyes were inside the head → moved to the face surface.
- Boss HP bar overlapped the player HP bar at 915 px width → layout reworked.
- Training dummy stayed during the boss fight after "skip to boss" → removed on boss intro.
- First spawn of a wave came one tick late → spawns on wave start.
- Shader compile hitch when the first enemy/boss/ultimate appeared → full warm-up at load.

## UNTESTED (needs a phone)

- Real-device FPS, thermal behaviour, battery, and which quality preset the benchmark picks.
- Touch feel: joystick dead zone, button sizes, combo timing, perfect-dodge window.
- Audio is audible and balanced (only verified that the Web Audio graph runs without errors).
- Vibration on hits.
- Gamepad.
- APK on a physical phone (install, fullscreen/landscape, back button, resume after app switch).
- Save persistence across app restarts inside the APK WebView.

## Placeholders and not-yet-built features (not cut — scheduled)

- All characters are procedural placeholder rigs; real models + Mixamo animations come with
  the asset milestone (the glTF loader is not implemented yet).
- One hero, one stage, three enemy types, one boss.
- No hub, gear, XP/levels, drops, shop or other game modes yet.
- Procedural SFX instead of recorded sounds; no music.
