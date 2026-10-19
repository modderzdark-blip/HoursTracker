# Test Report — 0.4.0 progress & polish

Build: v0.4.0 · Date: 2026-10-19 · Environment: cloud container (Node 22, headless Chromium 141
via Playwright 1.56.1, SwiftShader software WebGL 2 at ~3–7 FPS). No physical phone was available
to the developer; everything marked **UNTESTED** needs your phone.

## Summary

| #   | Check                                               | Result                                                    |
| --- | --------------------------------------------------- | --------------------------------------------------------- |
| 1   | `tsc --noEmit` (app + config/e2e projects)          | **PASS** — 0 errors                                       |
| 2   | ESLint (`--max-warnings=0`) + Prettier              | **PASS**                                                  |
| 3   | Vitest unit + integration                           | **PASS** — 216/216 in 17 files                            |
| 4   | `vite build`                                        | **PASS** — sizes below                                    |
| 5   | Playwright smoke (Pixel 7 landscape 915×412, touch) | **PASS** — 13/13, incl. daily gift + Journal, boss, soak  |
| 6   | Scripted runs of every mode in headless Chrome      | **PASS** — see "Mode runs" (scratch scripts, not in CI)   |
| 7   | APK build + Android emulator boot (CI)              | **PASS** — build #17 (see note below)                     |
| 8   | GitHub Pages deploy                                 | **BLOCKED** until Pages is enabled in repository settings |
| 9   | Real phone (feel, FPS, heat, audio, music)          | **UNTESTED**                                              |

**Emulator note:** build #16 (same game code as #17) failed once: the app process ended about
26 s after reaching the hub, with no JS error in the WebView console. The script now saves
Android's crash buffer and process-death lines (`crash.txt` in the release). The rerun (#17)
passed, and a 60 s hub idle in headless Chrome stays flat (heap ~10 MB, no errors). Not
reproduced; if the app ever closes on its own on your phone, please report it.

## Unit and integration tests (Vitest, 216)

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
