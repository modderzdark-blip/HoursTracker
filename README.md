# Ashbound

Mobile dark-fantasy hack-and-slash action RPG — Three.js + TypeScript + Rapier, no engine.
Playable in Chrome on Android (GitHub Pages) and as a sideloadable Capacitor APK.

> Status: **0.4.0 — progress & polish**: hub, 3 heroes, 3 Adventure chapters × 8 stages (Normal /
> Hard / Nightmare), 6 enemy types, 3 bosses + 3 mini-bosses, Dungeon, Demon Tower, Boss
> Challenge, Arena (AI duels, rating, seasons, leaderboard), XP/levels, gear with upgrades and
> salvage, loot with pity, skill trees, daily quests, login calendar, achievements, Ember Hearth
> (rewards over time), Ember Blessing (help after defeats), settings, procedural music and SFX. Characters are still
> procedural placeholder rigs (real models: see [docs/ASSET_LIST.md](docs/ASSET_LIST.md)).
> See [CHANGELOG.md](CHANGELOG.md) and [docs/TEST_REPORT_FULL.md](docs/TEST_REPORT_FULL.md).

## Play it

- **APK (Android):** <https://github.com/modderzdark-blip/HoursTracker/releases/download/ashbound-preview/Ashbound-preview.apk>
  — open it on the phone, allow "Install unknown apps" for your browser, install. Every CI run
  replaces it; new builds install over the old one (same signing key, increasing versionCode).
- **Web (Chrome on Android):** `https://modderzdark-blip.github.io/HoursTracker/` once Pages is
  enabled (see [Deploying](#deploying-github-pages)).

### Controls

| Touch                      | Keyboard  | Action                                                      |
| -------------------------- | --------- | ----------------------------------------------------------- |
| Left half: floating stick  | WASD      | Move                                                        |
| ATTACK                     | J         | Combo (tap again during a swing; inputs buffer 150 ms)      |
| DODGE                      | Space     | Dash with i-frames; dodge just before a hit = perfect dodge |
| Skill 1 / 2 / 3            | 1 / 2 / 3 | Hero skills (hold Brann's II to charge)                     |
| ULT (when glowing)         | R         | Hero ultimate                                               |
| Pause (top right)          | Esc       | Pause menu (graphics, restart, copy debug log)              |
| Triple-tap top-left corner | `         | Debug overlay + cheats                                      |

Settings (hub → Settings) change graphics, FPS cap, volumes, vibration, button size and opacity,
left-handed layout, screen shake and damage numbers.

### Heroes

| Hero  | Style                      | Skills                                                                  | Ultimate                   |
| ----- | -------------------------- | ----------------------------------------------------------------------- | -------------------------- |
| Kael  | Dual blades, fast combos   | Rending Dash · Blade Gyre (steerable) · Umbral Step                     | Hollow Legion (clones)     |
| Brann | Greatsword, super armor    | Earthsplitter (shockwave) · Oathbreaker (hold to charge) · Bulwark Rush | Meteor Cleave              |
| Lyra  | Bow at range, dagger close | Piercing Gloam · Ashfall Volley (arrow rain) · Snare Leap (trap)        | Gloamstorm (homing arrows) |

Brann unlocks after 1-4 for 60 souls, Lyra after 1-8 for 120 souls (Heroes screen).

### Modes

- **Adventure** — 3 chapters × 8 stages; mini-boss on stage 4, boss on stage 8; 1–3 stars
  (clear · no revive and little damage · par time). Clearing a chapter on Normal opens Hard,
  Hard opens Nightmare (tougher enemies, better loot).
- **Dungeon** (after chapter 1) — 4 random chambers, HP carries over, elite at the end; 5
  entries refilling one every 4 h.
- **Boss Challenge** (after 1-4) — defeated bosses at tiers 1–10.
- **Arena** (after chapter 1) — duels against AI-controlled heroes built from a hero, gear and
  skills; rating, 7-day seasons with rewards, local leaderboard.
- **Demon Tower** (after chapter 2) — endless floors, a boss every 10th, milestone rewards.

### Coming back every day

- **Journal** (hub dock): 3 daily quests (reset at local midnight) plus a chest for finishing
  all three; a 7-day login calendar (a missed day never resets it); 10 achievements with tiers
  paying gems.
- **Ember Hearth** (hub, top left): gold, XP and materials build up over real time, up to
  12 hours; the rate grows with your Adventure progress. Tap to collect.
- **Ember Blessing**: each defeat on a stage adds +10% ATK and +12% HP on that stage (up to 3
  stacks) until you win it, so a wall always turns into a win.
- Heroes you are not playing earn 40% of the XP, so switching heroes never starts from zero.

## Project structure

```
src/
  main.ts          entry: log capture, gesture guards, title screen, lazy-loads the engine chunk
  app/             App.ts (composition root, hub ↔ battle, test hook), Menus.ts (screen routing),
                   Runs.ts (turns each mode into battles and outcomes into rewards)
  core/            EventBus, ServiceRegistry, GameLoop (fixed step + interpolation),
                   FixedTimestep, TimeControl (hit-stop / slow-mo), FrameLimiter, GameClock, random
  input/           actions, InputState, InputBuffer, TouchControls, KeyboardInput, GamepadInput,
                   gestureGuards (fullscreen, landscape, no zoom)
  camera/          FollowCamera (boss framing), CameraShake (trauma), CameraDirector (cinematics)
  render/          RenderContext (renderer + bloom), Atmosphere, QualityManager + qualityLogic,
                   procedural textures, rim light
  physics/         PhysicsWorld (Rapier), CharacterBody (kinematic controller), collision groups
  anim/            HumanoidRig (procedural skinned placeholder, Mixamo bone names), poses,
                   clipBuilder, clipSets, AnimationController (mixer, events, hurt layer, look-at)
  combat/          damage formula, Health, Poise, StatusEffects, ActionRunner, hitShapes,
                   CombatSystem (one damage pipeline, shields), Effects (projectiles + ground
                   zones), Cooldowns, UltimateMeter
  actors/          Actor, Player (human or AI duelist), Enemy, Boss, TrainingDummy, components/
  ai/              EnemyBrain (state machine, tokens, kiting), BossBrain (phases, break, enrage,
                   flight, grabs, hazards), DuelistBrain (arena AI), AttackTokens
  modes/           BattleMode (one battle), WaveDirector, EnemyRoster (pool), HubScene, rewards,
                   meta (dungeon / tower / challenge / arena rules), crowd, ArenaBuilder
  progression/     PlayerProfile (one API over the save), xp, gear, loot (pity), skillTree,
                   heroStats, enemyScale, profile (save schema + sanitising), wallet, stars
  data/            ALL tunables: config, quality, heroes, skillTrees, rigs, enemies, bosses,
                   stages (chapters), arenas, items, progression (XP, loot, drop tables),
                   modes (unlocks + mode rules), statusEffects, difficulty, economy, combatTypes
  save/            SaveStore (versioned JSON v3), backends, migrations, settings
  ui/              styles.css, TitleScreen, BattleHud, DamageNumbers, ResultScreen, Hud, PauseMenu,
                   menu/ (shell, hub, stage map, heroes, gear, skills, modes, rewards, settings)
  audio/           AudioManager (Web Audio buses), Sfx (procedural effects), Music (procedural)
  vfx/             Sparks, WeaponTrails, TelegraphDecals, SoulOrbs, BlobShadows, ShadowClones, EmberField
  debug/           LogCapture, DebugOverlay (+cheats), FrameStats, deviceInfo, report, clipboard
public/assets/     models/ animations/ textures/ audio/ (empty until real assets arrive)
tests/unit/        Vitest (logic, progression, modes, real Rapier physics, battle integration)
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

### Release signing (store builds, optional)

Only needed for a Play Store upload; the preview APK above does not need it. Create a private
key once (`keytool` comes with any JDK; without a PC, the Termux app can run
`pkg install openjdk-17`):

```sh
keytool -genkeypair -v -keystore release.keystore -alias ashbound \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.keystore > release.keystore.b64
```

Add four secrets under **Settings → Secrets and variables → Actions**:
`ASHBOUND_KEYSTORE_BASE64` (the contents of `release.keystore.b64`),
`ASHBOUND_KEYSTORE_PASSWORD`, `ASHBOUND_KEY_ALIAS` (`ashbound`) and `ASHBOUND_KEY_PASSWORD`.
From then on each run also builds a signed `Ashbound-release.apk` and `Ashbound-release.aab`
(workflow artifact `ashbound-release`, not published to the public pre-release). Keep the
keystore and passwords safe: losing them means no further updates to a store listing. Without
the secrets those steps are skipped. **UNTESTED** — no secrets exist in this repository yet.

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

- **Hero**: `HEROES` in `src/data/heroes.ts` — stats and level growth, unlock rule, combo
  `ActionDef`s (timings, hit shapes, multipliers, move curves, cancel windows; `emit` for
  projectiles / zones), optional `rangedCombo`, dodge, three skills (`special: 'charge'`,
  `'steerable'`, `'shadowStep'`), ultimate, colour. Add its rig in `rigs.ts` and its tree in
  `skillTrees.ts`.
- **Enemy**: `ENEMIES` in `src/data/enemies.ts` (stats, rig, poise, attacks with range /
  cooldown / weight / telegraph / chains / `emit`, `shield`, `preferredRange` for kiting,
  `special: 'explode'`, souls). Add its id to `EnemyId` and use it in waves.
- **Boss / mini-boss**: `BOSSES` in `src/data/bosses.ts` — phases (HP threshold, attack set,
  speed/damage, optional timed `hazard`), break bar, enrage, intro; attacks may use `special:
'leap' | 'fly' | 'grab'` and `summon`.
- **Stage / chapter**: `CHAPTERS` in `src/data/stages.ts` (`buildChapter(...)` with waves,
  arena, boss, kind); arenas in `src/data/arenas.ts`.
- **Gear / loot / economy**: `src/data/items.ts` (slots, rarities, stats, upgrade table),
  `src/data/progression.ts` (XP curve, enemy scaling, rarity weights, pity, drop tables),
  `src/data/economy.ts`.
- **Modes**: `src/data/modes.ts` — unlocks, dungeon rooms, tower scaling, challenge tiers,
  arena rating/seasons/opponent names.
- **Quality presets**: `src/data/quality.ts`; benchmark thresholds in `BENCHMARK_CONFIG`.
- **Camera**: `CAMERA_CONFIG` in `src/data/config.ts` (distance, height, yaw, FOV, boss framing).

## Swapping assets

Characters are procedural skinned meshes (`src/anim/HumanoidRig.ts`) built on a skeleton with
Mixamo bone names (`mixamorig:Hips`, ...), driven by an `AnimationMixer` with named clips, so
real models can replace them without touching gameplay. The swap is designed as one field —
`visual` in `src/data/heroes.ts` from `{ kind: 'rig', rig: 'kael' }` to
`{ kind: 'gltf', url: 'assets/models/kael.glb', scale: 1 }` — **but the glTF loader itself is
not implemented yet** (selecting `gltf` throws a clear error). It lands with the asset
milestone. The list of models and animations to fetch is in
[docs/ASSET_LIST.md](docs/ASSET_LIST.md).

## Debugging on a phone

- **Debug overlay**: triple-tap the top-left corner, or Pause → Debug overlay → On.
- **Copy debug log**: Pause → Copy debug log — copies build, device/GPU info, live stats,
  settings and the last 80 log lines.
- **Cheats** (in the overlay): Shake, Slowmo, ULT (fill), CD (reset cooldowns), God, Kill
  (all enemies), Boss (skip to boss), -50% (boss HP).
- **Android emulator check**: the APK workflow also boots the APK on an API 34 emulator and
  attaches two screenshots plus the WebView console to the `ashbound-preview` release.
