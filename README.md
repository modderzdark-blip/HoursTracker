# Sweet Cascade

An original, fully offline **match-3 puzzle game for Android**. Swap candies, match three or more, set off striped, wrapped and color-bomb specials, and clear the goals of 10 levels on a candy trail map.

GitHub Actions builds, tests, signs and publishes the installable APK. There is nothing to build on your phone or computer.

* **Download:** [latest APK](https://github.com/modderzdark-blip/HoursTracker/releases/tag/latest) (rolling build of the newest green commit) or the versioned release `v1.0.0` under [Releases](https://github.com/modderzdark-blip/HoursTracker/releases).
* All art is drawn procedurally (Canvas and CSS gradients) and all sound is synthesized with the Web Audio API. There are no image, font or audio files and no third-party assets.
* No ads, no purchases, no analytics, no network access. The app requests no dangerous permissions and has no `INTERNET` permission at all.

## Install on your Android phone

1. On your phone, open the [Releases page](https://github.com/modderzdark-blip/HoursTracker/releases) and tap the `SweetCascade-v1.0.0….apk` file. Your browser downloads it.
2. Open the downloaded file. If Android asks, allow **Install unknown apps** for your browser.
3. Tap **Install**. If Play Protect shows a warning, choose **Install anyway**. It is your own sideloaded app.

Newer builds install over older ones and keep your progress, because every build is signed with the same key (see *Signing*). The repository is public, so you don't need to sign in to download.

## What's in the game

* 6 original candies, each with its own color **and** shape: Strawberry Heart, Orange Wedge, Lemon Drop, Mint Cube, Blueberry Orb and Grape Star. Each is painted with an 8-layer gloss recipe (ground shadow, base body, rim light, inner glow, subsurface tint, main specular, secondary glint, outline).
* 3 switchable materials: **Gummy**, **Hard Candy** and **Sugar Sprinkle**.
* Specials: striped (match 4), wrapped (L/T/+ shape, explodes twice) and color bomb (match 5). All six special+special combos are implemented.
* Blockers and goals: single and double glaze (jelly), one- and two-layer frosting, cherries that must reach the exit trays, collect goals, score goals and combined goals.
* Juice: squash and stretch, gravity falls, swell-and-pop clears with particles, beams, shockwaves, lightning arcs, cascade banners ("Tasty!" … "Sugar Rush!"), Sugar Bonus, confetti, and haptics.
* Personal touches: your name on the title and win screen, a background photo picked with the system photo picker (stays on the phone), 8 accent palettes, and a custom level-complete message.
* Accessibility: color-blind assist (letters on candies), reduced motion (also follows the system setting), labelled buttons, visible focus rings and a screen-reader live region. Keyboard play works on desktop (arrows, Space/Enter, Esc, H, M).
* **Settings → Run self-test** runs the logic test suite and a 200-game bot simulation on the phone, then shows a green or red report you can copy.

## How it is built

| Part | Where |
|---|---|
| Game (vanilla JS ES2020, Canvas 2D board, DOM/CSS UI) | `www/` |
| Capacitor 8 Android project | `android/` |
| Tests (Node, Playwright, APK verification, emulator) | `tests/` |
| Icon and splash generator, CI helpers | `scripts/` |
| CI workflow | `.github/workflows/android.yml` |

Game code is plain script files loaded in order. Each file is one labelled section:
`config.js` (CONFIG), `util.js` (UTIL: seeded mulberry32 RNG, easings), `logic.js` (LOGIC: pure and DOM-free), `levels.js` (LEVELS), `audio.js` (AUDIO), `art.js` + `render.js` (RENDER), `ui.js` (UI), `storage.js` (STORAGE), `input.js` (INPUT), `game.js` (GAME state machine: TITLE → MAP → INTRO → PLAYING → RESOLVING → WON/LOST, plus PAUSED) and `boot.js` (BOOT). `selftest.js` holds the test suite shared by Node and the in-game self-test.

**Architecture rule:** `LOGIC.applySwap(state, from, to)` computes the full result of a move instantly and deterministically. It returns the new state plus an event list (swap, match, clear, create, transform, activate, fall, spawn, collect, jelly, frosting, score, shuffle, …). The renderer only animates that list. Replaying the events on the starting board reproduces the final board exactly; this is tested on 500 random moves.

### CI pipeline

Every push to `main` (and to the development branch), every `v*` tag, and manual runs execute these jobs in order:

1. **logic**: 32 Node tests (`node tests/logic.test.js`), then 2,000 random-move fuzz games plus 300 greedy-bot games per level (`node tests/simulate.js`).
2. **browser**: Playwright with Chromium mobile emulation (`npx playwright test`). It plays Level 1 to a win with real swipes and taps, and checks persistence, losing, pause/restart/quit mid-animation, back navigation, lifecycle, hints, settings, the self-test, accessibility and reduced motion. It also captures 228 screenshots (6 sizes × 3 themes × 12 screens, plus landscape, desktop and zoomed art sheets).
3. **build**: Node 22, JDK 21, Android SDK, `npx cap sync android`, then Gradle `assembleDebug assembleRelease bundleRelease`.
4. **apk-verify**: `aapt2 dump badging`, `apksigner verify` and a scan of the bundled assets (`tests/apk/verify-apk.mjs`).
5. **emulator**: Android 14 (API 34) emulator, Pixel 6 profile (`tests/emulator/run-emulator-tests.sh`). It installs the APK, wins Level 1 with real `adb` swipes, and tests Back at every screen, Home and resume, the portrait lock, airplane mode, 3 minutes of play (frame pacing and memory), release cold start and a 3,000-event monkey run.
6. **release**: replaces the rolling `latest` pre-release with the new APK. A `v*` tag (or a manual run with *publish versioned release* ticked) creates the versioned release.

Screenshots, logs and reports are uploaded as workflow artifacts. They are also attached to the `qa` pre-release so they can be downloaded without signing in. That pre-release is not a game build.

`versionName` comes from `package.json`; `versionCode` is the CI run number, so every build upgrades the previous one.

### Signing

Android only installs an update over an existing app when both are signed with the same key.

* **If these repository secrets exist**, release builds are signed with your own stable key: `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. The file is named `SweetCascade-vX.Y.Z.apk`.
* **Until then (the current state)**, the optimized, non-debuggable release build is signed with the project's public *sideload key* (`android/sideload-debug.keystore`, password `android`, the standard Android debug-key convention). The file is named `SweetCascade-vX.Y.Z-debug.apk`, as agreed for the fallback. This key is not a secret. It exists so every CI build installs over the last one without losing progress. The trade-off is that anyone could sign an "update" with it, so only install APKs from this repository's Releases page.

To switch to your own private key (optional): create a keystore once on any computer, for example
`keytool -genkeypair -keystore sweetcascade.jks -alias sweetcascade -keyalg RSA -keysize 2048 -validity 10000`.
Then add the four secrets under **Settings → Secrets and variables → Actions**. `ANDROID_KEYSTORE_B64` is the output of `base64 -w0 sweetcascade.jks`. Switching keys means uninstalling the sideload-signed app once (Android refuses an update signed with a different key), which resets local progress.

### Decisions recorded

* **JDK 21 instead of 17:** Capacitor 8's Android library is compiled for Java 21, so CI uses Temurin 21.
* **Status bar:** Capacitor 8 moved status and navigation bar control into its core `SystemBars` API, so the separate `@capacitor/status-bar` plugin is not used. Immersive fullscreen (both bars hidden, swipe to reveal) is applied natively in `MainActivity`. Display-cutout insets are passed to CSS as `--native-safe-*` variables.
* **Keep awake, photo picker, safe area:** these come from one small app plugin (`NativeShellPlugin.java`) instead of extra third-party dependencies. The photo picker is the Android system photo picker (`PickVisualMedia`), which needs no storage permission. The photo is downscaled to at most 1280 px on the device.
* **Ingredient exits:** in cherry levels, every bottom cell is an exit tray, so a cherry can never get stuck.
* **Color bomb in a chain:** a color bomb hit by another special's blast fires on the most common color on the board (ties go to the lowest candy id).
* **Chain order:** breadth-first, with each wave processed in reading order (row by row from the top, left to right). Frosting and jelly lose at most one layer per clear stage, however many matches or blasts touch them.
* **Gravity:** candies and cherries fall straight down. The topmost non-hole cell of each column spawns new candies. Only when nothing else can move, an empty cell under a hole or frosting takes a piece sliding diagonally from the upper-left, then the upper-right (see `settleBoard` in `logic.js`).
* **Retries:** each new attempt at a level uses a fresh deterministic seed derived from the level seed, so retries show new boards.
* **Branch:** development happened on the session branch, and CI also runs there, so the `latest` release and `v1.0.0` were published from it.

## Adding levels

Levels are data only. Append an object to the array in `www/js/levels.js`:

```js
{
  id: 11, name: 'Caramel Cove', moves: 28, colors: 6, seed: 11011,
  rows: 9, cols: 9,
  // '.' normal  '#' hole  'j' single jelly  'J' double jelly  'f' frosting(1)  'F' frosting(2)  'c' cherry start  'x' exit tray
  layout: ['.........', /* nine rows of nine characters */],
  goals: [{ type: 'score', target: 9000 }],   // score | collect (color, count) | jelly | ingredients (count)
  stars: [9000, 14000, 20000],
  tutorial: 'Optional one-line tip shown the first time.',
}
```

The map, intro, HUD and tests pick it up automatically. `node tests/logic.test.js` checks that every cell is reachable and that cherries can reach an exit. `node tests/simulate.js` shows the bot win rate and suggests star thresholds.

## Running the tests yourself (optional)

```bash
npm ci
node tests/logic.test.js          # logic test suite
node tests/simulate.js            # fuzz + greedy bot simulation, star suggestions
npx playwright test               # browser QA + screenshots (needs Chromium: npx playwright install chromium)
node scripts/generate-icons.mjs   # regenerate launcher icons and the splash icon
```

## Credits

Game design, code, art and sound: made for this project. All art and audio are generated procedurally; no third-party assets. Built with [Capacitor](https://capacitorjs.com/) (MIT).
