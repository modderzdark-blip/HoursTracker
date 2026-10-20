# Test Report — 0.6.0 beasts, hunts & settings

Build: v0.6.0 · Date: 2026-10-20 · Environment: cloud container (Node 22, headless Chromium 141
via Playwright 1.56.1, SwiftShader software WebGL 2 at ~3–7 FPS). No physical phone was available
to the developer; everything marked **UNTESTED** needs your phone.

## Summary

| #   | Check                                         | Result                                                                                                                  |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | `tsc --noEmit` (app + config/e2e projects)    | **PASS** — 0 errors                                                                                                     |
| 2   | ESLint (`--max-warnings=0`) + Prettier        | **PASS**                                                                                                                |
| 3   | Vitest unit + integration                     | **PASS** — 290/290 in 20 files                                                                                          |
| 4   | `vite build`                                  | **PASS**                                                                                                                |
| 5   | Playwright smoke + settings + UI layout audit | 15/17 in the full run; the 2 failures (triple-tap overlay, 60 s soak) **pass on re-run** — see note; audit **0 issues** |
| 6   | Creature boss fights in headless Chrome       | **PASS** — 4-4, 4-6, 4-8 intro → phase 2 with god mode, no errors (scratch script)                                      |
| 7   | APK build + Android emulator boot (CI)        | **PASS** — run #23                                                                                                      |
| 8   | GitHub Pages deploy                           | **BLOCKED** until Pages is enabled in repository settings                                                               |
| 9   | Real phone (feel, FPS, heat, audio, music)    | **UNTESTED**                                                                                                            |

**0.6.0 e2e note:** in the full 18-minute run the machine rendered at ~3 FPS (software WebGL);
the soak's "a hit landed in 60 s" check and the triple-tap gesture timed out. Re-run alone on
the same build (6.7 FPS) both passed. Treated as timing in the slow container, not fixed.

## 0.6.0 checks

- **Creatures**: every creature builds valid skinned geometry (weights sum to 1, indices valid,
  triangle budgets); every mode and attack motion gives finite poses and cross-fades without
  jumps; the run cycle moves legs/tail; the head turns toward the target.
- **Creature bosses (integration, real physics)**: each fights through all 3 phases using ≥ 4
  different attacks; the wyrm's burrow makes it untouchable, tunnels to the player and erupts
  there; the Brood Weaver summons broodlings; hounds and broodlings attack; a Swift omen speeds
  the boss through phases and enrage.
- **Hunts**: daily board (3 different bosses, same all day, more omens later on the board),
  only defeated bosses, rank scaling, omen multipliers, replay pay, midnight reset, save
  sanitising.
- **Balance guard**: chapters 1–3 beatable on first clears with rare +3 gear; chapter 4 with
  epic gear; hero level keeps within 5 of the stage level.
- **Settings**: sanitising, old-save migration and option mappings (unit); every settings
  section in the UI audit; e2e for applying options.
- **UNTESTED on a phone**: how the creature bosses look and feel, burrow / pounce / charge
  fairness, FPS with the larger creatures, the new camera and control options.

**Emulator note:** build #16 (same game code as #17) failed once: the app process ended about
26 s after reaching the hub, with no JS error in the WebView console. The script now saves
Android's crash buffer and process-death lines (`crash.txt` in the release). The rerun (#17)
passed, and a 60 s hub idle in headless Chrome stays flat (heap ~10 MB, no errors). Not
reproduced; if the app ever closes on its own on your phone, please report it.

## 0.5.0 checks

- **Characters**: every rig builds; skin weights sum to 1, bone indices valid, roughness and
  metalness in range; triangles: crowd enemies < 9k, heroes and bosses < 12k (largest: Bound
  King ~11.2k); capes stream back when running, settle at rest, survive a 3 s hitch. Viewed
  close up in `/dev/rig-viewer.html` under the real arena lighting, and in game (hub, waves,
  boss): 17–28 draw calls, ~25–48k triangles on screen.
- **Running**: the stance foot moves backward at 0.6–1.5× the running speed at 3 and 6.2 m/s
  (the old fixed rhythm failed this at 3 m/s).
- **Magnetism**: one attack hits a dummy 3.6 m away (fails with magnetism off) and does not
  move the hero toward a dummy that is already close.
- **UI audit**: 35 states (title, gift, hub, Journal, battle countdown/boss/pause/mirrored XL
  controls, victory, map, pre-battle, revive, defeat, heroes, gear + compare/upgrade, skills,
  settings, every mode, dungeon interlude) checked for overlaps, clipping, off-screen content,
  safe areas, text < 12px, tap targets < 40px: **0 issues**.
- **Floating text**: checked in mid-combat screenshots: numbers and STAGGER/MISS stack into
  rows and stay below the top HUD.
- **Soak**: 60 s live combat, zero errors, heap 13.95 → 14.80 MB (trend 14 KB/s).
- **UNTESTED on a phone**: how the new characters look at 60 FPS on a real screen, frame rate
  and heat with the heavier characters, feel of the closer camera and the magnetism.

## Unit and integration tests (Vitest, 238)

| File                         | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `goals.test.ts`              | **Balance guard** (first-clear player vs every boss: hero level within 5 of stage level, boss hit counts in band, final boss ≤ 1.6× first boss, recommended power met); daily quests (3 distinct, stable per day, locked modes excluded, capped progress, claim once, all-done chest); local day with time zones; login calendar (once a day, 7-day cycle, no reset on missed days); hearth (grows with time and level, 12 h cap, clock rollback gives nothing, collect once); Ember Blessing (stacks to 3, per difficulty, cleared on victory, abandons ignored); achievements (tiers in order, paid once); sanitising of the new save fields; bench XP |
| `animation.test.ts`          | Body dynamics (front/back/side hit recoil direction, settles, bounded, banks into turns, stable after a 2 s hitch); strike keys (ordered, idle at both ends, overshoot in the swing direction); pose blending                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `progression.test.ts`        | XP curve (formula, multi-level gains, max level); hero stats with level and gear; gear rolls (substat counts, no duplicates), upgrade success table (+1…+10 = 100%, then lower), failures never destroy/downgrade, all-or-nothing payment, salvage; pity (epic and legendary guarantees, 5000-roll streak check), drop tables; skill-tree costs, prerequisites, level gates, mods; profile equip / salvage / full bag / stage unlock chain / star gems once / difficulty unlocks; profile sanitising                                                                                                                                                     |
| `modes.test.ts`              | Dungeon entries (spend, timed refill, cap, never negative), room planning (distinct, random order, elite last); tower floors (deterministic, boss every 10th, enemy unlock floors, milestones); challenge tiers; arena rating changes (direction, upsets, bounds), opponents (distinct, near rating/power, deterministic), season settle + soft reset, leaderboard                                                                                                                                                                                                                                                                                       |
| `battle.integration.test.ts` | Real Rapier: Kael combo/buffer/dodge/perfect dodge/counter/skills/ult; AI tokens; stagger; boss phases/break/enrage; **Brann** charge (full charge > 2.2× tap) and shockwave reach; **Lyra** arrows at range vs dagger up close, trap springs only on hittable enemies, homing ultimate; **Bulwark** blocks frontal hits (>5× less damage) but not from behind; **Seer** kites and shoots; **Wretch** explodes and dies; **Mother of Ash** flies invulnerable and summons in phase III; **Bound King** grab → hold → slam; **arena duelist** closes in, lands hits, uses several moves                                                                   |
| `systems.test.ts`            | Attack tokens, WaveDirector, wallet rules (no negatives / no duplication), stars, save migrations v1→v3 and v2→v3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `data.test.ts`               | Every arena (props and spawn points clear), chapters (8 stages, rising levels, valid enemies/bosses), boss phases, gear and skill-tree data, mode unlock ids                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| others                       | core, input, movement, physics, save (incl. new settings), quality, combat, damage, actionRunner, debug — as before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Build

| File                      | Raw     | Gzip    | Loaded                        |
| ------------------------- | ------- | ------- | ----------------------------- |
| `index-*.js` (entry)      | 42.1 KB | 14.4 KB | before the title              |
| `index-*.css`             | 30.6 KB | 7.2 KB  | before the title              |
| `App-*.js` (engine chunk) | 5.23 MB | 1.91 MB | lazily, while the title shows |

Initial load before the title ≈ 22 KB gzip (budget 10 MB).

## Playwright smoke (13)

Title (no console errors) · daily gift pops on the first hub visit, pays, Journal lists 3
quests and 10 achievements, hearth shown · hub → Adventure → stage map → pre-battle → fight with real taps, and
every dock screen opens · battle renders within the draw-call budget · joystick + multi-touch
combo, nothing sticks · skill slide-off release · wave combat kills with real touch · boss stage
1-8: intro → phase 2 → victory with loot cards → equip raises power · defeat → revive (gems) →
revive limit → give up → defeat screen · pause + copy debug log + quality switch · left-handed
layout mirrors the buttons, XL size applies, damage numbers hidden · hidden debug gesture ·
60 s soak with continuous touch play.

**Soak:** zero errors, JS heap 13.13 → 13.36 → 13.77 → 13.88 → 13.90 → 14.18 → 14.06 MB
(plateaus; trend 16.9 KB/s within GC noise), 30 draw calls.

## Mode runs (headless, scripted with the test hook)

With chapters cleared via the test hook, each mode was entered from its screen and completed:
Dungeon (4 rooms, room interludes, full-clear loot), Demon Tower (floor 1), Boss Challenge
(Gaoler tier 1), Arena (duel vs. an AI Brann) — all reached their result screens with rewards,
no console errors. Brann and Lyra fought stage 1-2 with every skill and ultimate (Lyra up to 10
projectiles at once). Mother of Ash and The Bound King were fought to phase II.

**Draw calls** (LOW preset, chosen by the benchmark on SwiftShader): 17–32 in every fight
measured (waves, Warden, Mother of Ash, Bound King, duel). Budget 150.

## Screenshots (`docs/screenshots/full/`)

Hub · stage map · pre-battle · wave fight · Warden · victory with loot · gear · skills · Lyra's
ultimate · Brann in the hub · Mother of Ash in flight · The Bound King · Dungeon · Arena · duel ·
left-handed layout · settings.

## 0.4.0 balance (first clears only, Kael, rare +3 gear of the stage level)

Average hits at skill multiplier 1 (real fights use combos and skills, so fewer taps):

| Stage | Boss          | Hero level before → after | Hits to kill before → after |
| ----- | ------------- | ------------------------- | --------------------------- |
| 1-4   | Gaoler        | 2 → 5                     | 50 → 42                     |
| 1-8   | Hollow Warden | 4 → 8                     | 137 → 95                    |
| 2-4   | Seer Exalted  | 5 → 11                    | 62 → 47                     |
| 2-8   | Mother of Ash | 7 → 14                    | 213 → 113                   |
| 3-4   | Penitent      | 8 → 17                    | 120 → 69                    |
| 3-8   | Bound King    | 9 → 20                    | 369 → 139                   |

The animation pass was checked with screenshots of running and mid-combo frames in headless
Chrome (no broken poses, no console errors). How it feels at 60 FPS needs the phone.

## Fixed during self-testing

- Menu lists could not be scrolled by touch (the gesture guard blocked panning): menus are now
  marked scrollable.
- Bound King's grab started out of reach of its own grab box.
- Ember Seer attacked before backing off; kiting now comes first (time-limited).
- Lyra's trap could be wasted on a still-spawning (invulnerable) enemy.
- Duelist AI swung sideways while strafing (stick now points at the target when attacking).
- Huge bosses were cut off by the camera; framing now pulls back with boss size and flight.
- Arena opponents could not be weaker than "fully geared at level 1".
- Skill-tree core branch drew crossing lines (re-laid out into Core + Guard columns).
- Recommended power showed "too low" on stage 1-1 for a new player.
- Duel countdown text overlapped the opponent bar.
- Left-handed idle joystick ring stayed on the left.

## UNTESTED (needs a phone)

- FPS / heat / battery on real hardware, especially boss fights with many projectiles and zones.
- How the controls feel (dodge timing, Brann's hold-to-charge, Lyra's range switch).
- Procedural music and SFX are audible and balanced (the Web Audio graph runs without errors in
  headless Chrome, but nothing can be heard there).
- Vibration; gamepad.
- Long-term balance (levels, gear, enemy scaling across 24 stages, tower depth, arena ratings).
- Save persistence across app restarts inside the APK.

## Not built / placeholders (not cut)

- Real character models and animations: procedural rigs only; the loader is built when the
  files from `docs/ASSET_LIST.md` are uploaded.
- Real online PvP (out of scope for v1 per the brief); arena opponents are generated locally.
- iOS packaging (M16 — the code is platform-agnostic).
