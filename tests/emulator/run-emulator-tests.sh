#!/usr/bin/env bash
# Emulator tests (CI job "emulator"), run inside reactivecircus/android-emulator-runner on API 34.
# Phase A uses the test-only debug APK (it carries the debug-only test hook that reports state and coordinates);
# every action is a real `adb shell input` tap, swipe or key event. Phase B uses the release APK users install.
set -uo pipefail
OUT="${EMULATOR_OUTPUT:-$PWD/emulator-output}"
PKG=app.sweetcascade.game
ACTIVITY="$PKG/.MainActivity"
HOOK_LOG="$OUT/hook-latest.log"
mkdir -p "$OUT/screenshots"
touch "$OUT/booted.marker"
: > "$OUT/summary.txt"
METRICS="$OUT/metrics.txt"
: > "$METRICS"

log() { echo "[$(date +%H:%M:%S)] $*"; }
pass() { echo "PASS: $*" | tee -a "$OUT/summary.txt"; }
metric() { echo "$1=$2" | tee -a "$METRICS"; }
fail() {
  echo "FAIL: $*" | tee -a "$OUT/summary.txt"
  shot "failure"
  adb logcat -d > "$OUT/logcat-at-failure.txt" 2>/dev/null
  cp "$HOOK_LOG" "$OUT/hook-at-failure.log" 2>/dev/null
  echo "EMULATOR TESTS: FAILED" | tee -a "$OUT/summary.txt"
  exit 1
}
shot() { adb exec-out screencap -p > "$OUT/screenshots/$1.png" 2>/dev/null; }
app_alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
dump_hook() {
  adb logcat -d -s 'Capacitor/Console:*' 2>/dev/null | grep 'SCTEST ' | tail -n 5 > "$HOOK_LOG"
  if [ ! -s "$HOOK_LOG" ]; then adb logcat -d 2>/dev/null | grep 'SCTEST ' | tail -n 5 > "$HOOK_LOG"; fi
}
q() { dump_hook; node tests/emulator/hook.mjs "$HOOK_LOG" "$1"; }
wait_for() { # expression, timeout seconds, label
  local expression="$1" timeout="$2" label="$3" elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    if [ "$(q "$expression")" = "true" ]; then return 0; fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  log "last snapshot: $(q 'JSON.stringify({state: s.state, modal: s.modal, screen: s.screen, level: s.level, seq: s.seq})')"
  fail "timed out after ${timeout}s waiting for: $label"
}
fresh() { q 's.seq'; }
wait_fresh() { # wait until the hook reports a newer snapshot than $1
  local previous="$1"
  wait_for "s.seq > $previous" 20 "a fresh hook snapshot"
}
tap_button() { # button id or label as reported by the hook
  local point
  point=$(q "px(s.buttons[$(printf '%s' "$1" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')])")
  [ "$point" = "none" ] && fail "button '$1' not visible"
  adb shell input tap $point
}
tap_map_node() {
  local point
  point=$(q "px(s.map_nodes['$1'])")
  [ "$point" = "none" ] && fail "map node $1 not visible"
  adb shell input tap $point
}
back() { adb shell input keyevent KEYCODE_BACK; sleep 1.2; }
check_no_crash() {
  if adb logcat -d 2>/dev/null | grep -E "FATAL EXCEPTION|ANR in $PKG|onRenderProcessGone|Render(er)? process (crashed|gone|was killed)|Fatal signal.*(sweetcascade|webview|sandboxed)" > "$OUT/crash-lines.txt"; then
    cat "$OUT/crash-lines.txt"
    fail "crash, ANR or WebView renderer crash in logcat ($1)"
  fi
}
make_move() { # one real swipe from the hook's suggested move; waits until it has been played
  local before swipe_points
  before=$(q 's.moves_played')
  swipe_points=$(q 'swipe(s.move)')
  [ "$swipe_points" = "none" ] && return 1
  adb shell input swipe $swipe_points 260
  wait_for "s.moves_played > $before || s.state === 'WON' || s.state === 'LOST'" 60 "the move to resolve"
  return 0
}
play_until_end() { # plays real swipes until a win/lose modal shows; $1 = max seconds
  local deadline=$((SECONDS + $1))
  while [ $SECONDS -lt $deadline ]; do
    case "$(q 's.modal || s.state')" in
      win|lose) return 0 ;;
      PLAYING) make_move || sleep 1 ;;
      *) sleep 1 ;;
    esac
  done
  return 1
}

adb logcat -G 16M >/dev/null 2>&1 || true
adb shell settings put secure immersive_mode_confirmations confirmed
adb shell getprop ro.build.version.release | tee "$OUT/android-version.txt"
adb shell wm size | tee -a "$OUT/android-version.txt"
adb shell dumpsys package com.google.android.webview | grep -m1 versionName | tee -a "$OUT/android-version.txt"

APK_RELEASE=$(ls dist/SweetCascade-v*.apk | head -1)
APK_DEBUG=dist/test-only-debug-build.apk

# ============================================================ PHASE A: debug build + test hook
log "Installing the test-only debug build"
adb install -r "$APK_DEBUG" > /dev/null || fail "install debug APK"
adb logcat -c
adb shell am start -n "$ACTIVITY" > /dev/null
sleep 0.6
shot "01-splash"
wait_for "s.ready && s.modal === 'name'" 90 "the first-launch name prompt"
pass "debug build launched; first launch asks for the player name"
sleep 1
shot "02-title-name-prompt"
check_no_crash "launch"

# --- Play Level 1 to a win with real swipes
tap_button "btn-name-skip"
wait_for "s.state === 'PLAYING' && s.level === 1" 30 "Level 1 to start"
sleep 1.5
shot "03-gameplay-level1"
play_until_end 300 || fail "Level 1 did not end within 5 minutes"
[ "$(q 's.modal')" = "win" ] || fail "Level 1 ended without a win"
metric level1_moves_to_win "$(q 's.moves_played')"
sleep 2.5
shot "04-win"
pass "Level 1 played to a win with real adb swipes ($(q 's.moves_played') moves)"
[ "$(q 's.unlocked')" = "2" ] || fail "Level 2 not unlocked"
pass "Level 2 unlocked"

# --- Back button / gesture at every screen
back
wait_for "s.state === 'MAP' && !s.modal" 15 "Back on the win modal to go to the map"
pass "Back on win modal -> map"
shot "05-map"
back
wait_for "s.state === 'TITLE' && !s.modal" 15 "Back on the map to go to the title"
pass "Back on map -> title"
back
wait_for "s.modal === 'confirm-exit'" 15 "Back on the title to ask 'Exit game?'"
pass "Back on title -> 'Exit game?'"
shot "06-exit-confirm"
back
wait_for "s.state === 'TITLE' && !s.modal" 15 "Back to close the exit question"
app_alive || fail "app exited by accident"
pass "Back on 'Exit game?' closes the question; the app stays open"
tap_button "btn-play"
wait_for "s.state === 'MAP' && s.map_nodes['1'] !== undefined" 15 "the map"
sleep 1
tap_map_node 1
wait_for "s.modal === 'intro'" 15 "the level intro"
shot "07-intro"
back
wait_for "s.state === 'MAP' && !s.modal" 15 "Back to close the intro"
pass "Back on a modal closes it first"
tap_map_node 1
wait_for "s.modal === 'intro'" 15 "the level intro"
tap_button "btn-intro-play"
wait_for "s.state === 'PLAYING'" 15 "gameplay"
sleep 1
back
wait_for "s.state === 'PAUSED' && s.modal === 'pause'" 15 "Back during gameplay to open Pause"
pass "Back during gameplay -> Pause"
shot "08-pause"
back
wait_for "s.modal === 'confirm-quit'" 15 "Back on Pause to ask 'Quit to map?'"
pass "Back on Pause -> 'Quit to map?'"
back
wait_for "s.modal === 'pause'" 15 "Back to close 'Quit to map?'"
tap_button "btn-resume"
wait_for "s.state === 'PLAYING' && !s.modal" 15 "Resume"
app_alive || fail "app exited by accident during Back tests"
pass "every Back press behaved as specified; the app never exited by accident"

# --- Keep awake during gameplay (FLAG_KEEP_SCREEN_ON on the game window)
adb shell dumpsys window windows | grep -A12 "$PKG/$PKG.MainActivity" > "$OUT/window-flags.txt"
grep -q "KEEP_SCREEN_ON" "$OUT/window-flags.txt" || fail "screen is not kept awake during gameplay"
pass "keep-awake is on during gameplay"

# --- Background / foreground: audio and timers pause and resume
make_move || fail "could not make a move before backgrounding"
wait_for "s.state === 'PLAYING'" 60 "the board to settle"
[ "$(q 's.audio.context')" = "running" ] || fail "audio was not running after taps ($(q 'JSON.stringify(s.audio)'))"
pass "audio started on the first tap (AudioContext running)"
before_home=$(fresh)
clock_before=$(q 's.timeline_now')
adb shell input keyevent KEYCODE_HOME
sleep 4
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -2 > "$OUT/home-activity.txt"
grep -q "$PKG" "$OUT/home-activity.txt" && fail "app still in the foreground after Home"
adb shell am start -n "$ACTIVITY" > /dev/null
wait_fresh "$before_home"
sleep 1.5
wait_for "s.lifecycle.some((entry) => entry.event === 'hidden') && s.lifecycle.some((entry) => entry.event === 'visible')" 15 "the app to report hidden then visible"
wait_for "s.state === 'PAUSED' && s.modal === 'pause'" 15 "the game to be paused after returning"
q 'JSON.stringify(s.lifecycle)' > "$OUT/lifecycle.json"
[ "$(q 's.audio.lifecycle_paused')" = "false" ] || fail "audio still paused after returning"
clock_after=$(q 's.timeline_now')
metric timeline_advance_during_4s_background_ms "$((clock_after - clock_before))"
[ $((clock_after - clock_before)) -lt 1000 ] || fail "game timers kept running in the background ($((clock_after - clock_before)) ms)"
shot "09-after-resume"
tap_button "btn-resume"
wait_for "s.state === 'PLAYING' && s.audio.context === 'running' && s.audio.music_scheduler === true" 20 "audio and music to resume"
pass "Home pauses audio and timers (lifecycle: $(cat "$OUT/lifecycle.json" | head -c 300)); returning resumes cleanly"

# --- Rotation: portrait lock holds
adb shell settings put system accelerometer_rotation 0
adb shell settings put system user_rotation 1
sleep 3
q 'JSON.stringify(s.viewport)' > "$OUT/viewport-after-rotation.txt"
shot "10-rotation-request"
wait_for "s.viewport[1] > s.viewport[0]" 10 "the portrait lock to hold"
adb shell settings put system user_rotation 0
pass "rotation request ignored: portrait lock holds (viewport $(cat "$OUT/viewport-after-rotation.txt"))"

# --- Background photo: the system photo picker opens without any permission prompt
back
wait_for "s.modal === 'pause'" 15 "Pause"
back
wait_for "s.modal === 'confirm-quit'" 15 "'Quit to map?'"
tap_button "Quit"
wait_for "s.state === 'MAP' && !s.modal" 15 "the map after quitting"
back
wait_for "s.state === 'TITLE' && !s.modal" 15 "the title"
tap_button "btn-title-settings"
wait_for "s.modal === 'settings'" 15 "settings"
for scroll in 1 2 3; do adb shell input swipe 540 1900 540 700 300; sleep 0.8; done
wait_for "s.buttons['btn-choose-photo'] !== undefined" 15 "the Choose photo button"
shot "11a-settings-photo"
tap_button "btn-choose-photo"
sleep 4
adb shell dumpsys activity activities | grep -iE "topResumedActivity|mResumedActivity" | head -2 > "$OUT/photo-picker-activity.txt"
shot "11b-system-photo-picker"
grep -qiE "photopicker|documentsui|PickImages" "$OUT/photo-picker-activity.txt" || fail "the system photo picker did not open ($(cat "$OUT/photo-picker-activity.txt"))"
adb shell dumpsys package "$PKG" | grep -iE "android.permission.(READ_MEDIA|READ_EXTERNAL)" && fail "app holds a storage/media permission"
adb shell input keyevent KEYCODE_BACK
wait_for "s.modal === 'settings'" 20 "the app to come back from the photo picker"
back
wait_for "!s.modal" 15 "settings to close"
pass "Choose photo opens the system photo picker ($(head -c 160 "$OUT/photo-picker-activity.txt" | tr -s ' ')) with no storage permission"

# --- In-game self-test on the device (logic tests + 200 bot games, chunked so the UI stays responsive)
tap_button "btn-title-settings"
wait_for "s.modal === 'settings'" 15 "settings"
for scroll in 1 2 3 4; do adb shell input swipe 540 1900 540 700 300; sleep 0.8; done
wait_for "s.buttons['btn-self-test'] !== undefined" 15 "the Run self-test button"
tap_button "btn-self-test"
wait_for "s.selftest !== null && (s.selftest.passed || s.selftest.failed)" 240 "the self-test to finish"
sleep 1
shot "11d-selftest-report"
q 'JSON.stringify(s.selftest)' > "$OUT/selftest.json"
[ "$(q 's.selftest.passed')" = "true" ] || fail "in-game self-test reported red: $(cat "$OUT/selftest.json")"
metric selftest_on_device "$(q 's.selftest.done')"
back
wait_for "s.modal === 'settings'" 15 "settings after the self-test"
back
wait_for "!s.modal" 15 "settings to close"
pass "in-game self-test on the device is green: $(cat "$OUT/selftest.json" | head -c 220)"

# --- Airplane mode: relaunch and play 10 moves offline
adb shell cmd connectivity airplane-mode enable
sleep 2
metric airplane_mode_on "$(adb shell settings get global airplane_mode_on | tr -d '\r')"
adb shell am force-stop "$PKG"
adb logcat -c
adb shell am start -n "$ACTIVITY" > /dev/null
wait_for "s.ready && s.state === 'TITLE'" 60 "the title screen offline"
tap_button "btn-play"
wait_for "s.state === 'MAP' && s.map_nodes['2'] !== undefined" 15 "the map offline"
sleep 1
tap_map_node 2
wait_for "s.modal === 'intro'" 15 "the Level 2 intro"
tap_button "btn-intro-play"
wait_for "s.state === 'PLAYING' && s.level === 2" 15 "Level 2 offline"
offline_moves=0
while [ "$offline_moves" -lt 10 ]; do
  state="$(q 's.modal || s.state')"
  case "$state" in
    PLAYING) make_move && offline_moves=$((offline_moves + 1)) ;;
    win) tap_button "btn-next"; sleep 2 ;;
    lose) tap_button "btn-retry"; sleep 2 ;;
    *) sleep 1 ;;
  esac
done
shot "11e-airplane-mode-play"
[ "$(q 's.errors')" = "0" ] || fail "script errors while offline"
check_no_crash "airplane mode"
adb shell cmd connectivity airplane-mode disable
pass "airplane mode: relaunched and played $offline_moves moves fully offline"

# --- Three minutes of play: frame pacing and memory
adb shell dumpsys gfxinfo "$PKG" reset > /dev/null
adb shell dumpsys meminfo "$PKG" > "$OUT/meminfo-start.txt"
play_deadline=$((SECONDS + 180))
played=0
while [ $SECONDS -lt $play_deadline ]; do
  case "$(q 's.modal || s.state')" in
    PLAYING) make_move && played=$((played + 1)) ;;
    win) tap_button "btn-next"; sleep 2 ;;
    lose) tap_button "btn-retry"; sleep 2 ;;
    *) sleep 1 ;;
  esac
done
adb shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo.txt"
adb shell dumpsys meminfo "$PKG" > "$OUT/meminfo-after-3min.txt"
shot "12-after-3-minutes"
metric moves_in_3_minutes "$played"
metric total_frames "$(grep -m1 'Total frames rendered' "$OUT/gfxinfo.txt" | awk -F': ' '{print $2}' | tr -d '\r')"
metric janky_frames "$(grep -m1 'Janky frames:' "$OUT/gfxinfo.txt" | awk -F': ' '{print $2}' | tr -d '\r')"
metric pss_kb_start "$(grep -m1 'TOTAL PSS:' "$OUT/meminfo-start.txt" | awk '{print $3}')"
metric pss_kb_after_3min "$(grep -m1 'TOTAL PSS:' "$OUT/meminfo-after-3min.txt" | awk '{print $3}')"
metric render_quality_level "$(q 's.quality')"
check_no_crash "3 minutes of play"
pass "3 minutes of play: $played moves, metrics recorded"

# --- "Exit game?" -> Exit really closes the app
for attempt in $(seq 1 12); do
  case "$(q 's.modal || s.state')" in
    TITLE) break ;;
    win|lose) back ;;
    pause) back ;;
    confirm-quit) tap_button "Quit"; sleep 1.5 ;;
    PLAYING|RESOLVING|MAP) back ;;
    *) sleep 1 ;;
  esac
done
wait_for "s.state === 'TITLE' && !s.modal" 20 "the title screen"
back
wait_for "s.modal === 'confirm-exit'" 15 "'Exit game?'"
tap_button "Exit"
sleep 3
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity" | head -2 > "$OUT/after-exit.txt"
grep -q "$PKG" "$OUT/after-exit.txt" && fail "'Exit' did not close the app"
pass "'Exit game?' -> Exit closes the app"
adb shell input keyevent KEYCODE_HOME
sleep 2
adb shell input swipe 540 2000 540 500 300
sleep 2.5
shot "15-launcher-app-drawer"
adb shell input keyevent KEYCODE_HOME

# ============================================================ PHASE B: the release APK users install
log "Installing the release APK over the debug build (same key, progress must survive)"
adb install -r "$APK_RELEASE" > /dev/null || fail "install release APK over the debug build"
for attempt in 1 2 3; do
  adb shell am force-stop "$PKG"
  sleep 1
  adb shell am start -W -n "$ACTIVITY" > "$OUT/cold-start-$attempt.txt"
  metric "cold_start_ms_$attempt" "$(grep TotalTime "$OUT/cold-start-$attempt.txt" | awk '{print $2}' | tr -d '\r')"
  sleep 3
done
shot "13-release-title"
app_alive || fail "release build not running"
pass "release APK installed as an update and launched (cold start measured 3x)"
adb shell dumpsys package "$PKG" | grep -E "versionName|versionCode|flags=" | head -4 > "$OUT/release-package.txt"
grep -q DEBUGGABLE "$OUT/release-package.txt" && fail "release build is debuggable"
pass "release build is not debuggable"

log "Monkey: 3,000 random events on the release build"
adb logcat -c
adb shell monkey -p "$PKG" --throttle 60 --pct-syskeys 3 --pct-appswitch 2 -v -v 3000 > "$OUT/monkey.txt" 2>&1
grep -q "Monkey finished" "$OUT/monkey.txt" || fail "monkey did not finish"
grep -qE "// CRASH|// NOT RESPONDING|ANR" "$OUT/monkey.txt" && fail "monkey found a crash or ANR"
metric monkey_events_injected "$(grep -m1 'Events injected' "$OUT/monkey.txt" | awk -F': ' '{print $2}' | tr -d '\r')"
check_no_crash "monkey"
pass "monkey: 3,000 events, zero crashes, zero ANRs, no WebView crash"
shot "14-after-monkey"

adb logcat -d > "$OUT/logcat-final.txt"
echo "EMULATOR TESTS: ALL PASSED" | tee -a "$OUT/summary.txt"
