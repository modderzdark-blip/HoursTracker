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
  # Say so plainly when Android killed the game because a provider it was using died (not a crash in the game).
  adb logcat -d 2>/dev/null | grep -E "Killing [0-9]+:$PKG/.*depends on provider" | tail -1 | sed 's/^/CAUSE: /' | tee -a "$OUT/summary.txt"
  shot "failure"
  adb logcat -d > "$OUT/logcat-at-failure.txt" 2>/dev/null
  cp "$HOOK_LOG" "$OUT/hook-at-failure.log" 2>/dev/null
  echo "EMULATOR TESTS: FAILED" | tee -a "$OUT/summary.txt"
  exit 1
}
shot() { adb exec-out screencap -p > "$OUT/screenshots/$1.png" 2>/dev/null; }
app_alive() { adb shell pidof "$PKG" >/dev/null 2>&1; }
# An overloaded CI emulator sometimes shows "<system app> isn't responding" on top of the game, which would swallow
# the next tap. Before every input, make sure the game's window has focus; dismiss a foreign system dialog if not.
ensure_app_focused() {
  local attempt focus
  for attempt in $(seq 1 12); do
    # Every display reports its own mCurrentFocus (the launcher's comes first on API 34): look at all of them.
    focus=$(adb shell dumpsys window 2>/dev/null | grep 'mCurrentFocus' | tr -d '\r' | tr '\n' ' ')
    case "$focus" in
      *"$PKG/"*MainActivity*) return 0 ;;
      *"Splash Screen"*) sleep 1 ;;
      *"Not Responding"*|*"isn't responding"*|*"Application Error"*|*"has stopped"*)
        log "dismissing a system dialog over the game: $focus"
        echo "$focus" >> "$OUT/system-dialogs.txt"
        adb shell input keyevent KEYCODE_BACK
        sleep 1.5 ;;
      *) sleep 1 ;;
    esac
  done
  log "game window not focused before input: $focus"
}
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
# Android drops touches that arrive while an activity is still finishing a launch transition and logs
# "Not sending touch gesture to ... ActivityRecordInputSink <pkg> ... NO_INPUT_CHANNEL". Only when that exact OS-level
# drop is logged for our activity is the tap repeated (once); a tap the game itself ignores still fails the test.
dropped_taps() { adb logcat -d 2>/dev/null | grep -c "ActivityRecordInputSink $PKG.*NO_INPUT_CHANNEL"; }
tap_point() {
  local before
  ensure_app_focused
  before=$(dropped_taps)
  adb shell input tap $1 $2
  sleep 0.8
  if [ "$(dropped_taps)" -gt "$before" ]; then
    log "the system dropped the tap (activity still in transition); tapping again"
    echo "dropped tap at $1 $2" >> "$OUT/dropped-taps.txt"
    sleep 1.5
    ensure_app_focused
    adb shell input tap $1 $2
  fi
}
tap_button() { # button id or label as reported by the hook
  local point
  point=$(q "px(s.buttons[$(printf '%s' "$1" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')])")
  [ "$point" = "none" ] && fail "button '$1' not visible"
  tap_point $point
}
tap_map_node() {
  local point
  point=$(q "px(s.map_nodes['$1'])")
  [ "$point" = "none" ] && fail "map node $1 not visible"
  tap_point $point
}
back() { ensure_app_focused; adb shell input keyevent KEYCODE_BACK; sleep 1.2; }
check_no_crash() {
  if adb logcat -d 2>/dev/null | grep -E "FATAL EXCEPTION|ANR in $PKG|onRenderProcessGone|Render(er)? process (crashed|gone|was killed)|Fatal signal.*(sweetcascade|webview|sandboxed)|Killing [0-9]+:$PKG/.*depends on provider" > "$OUT/crash-lines.txt"; then
    cat "$OUT/crash-lines.txt"
    fail "crash, ANR or WebView renderer crash in logcat ($1)"
  fi
}
# Records which processes hold Google Play services' font provider (Android kills every holder when that process dies).
font_provider_link() { # label
  adb shell dumpsys activity providers 2>/dev/null | grep -A60 "fonts.provider.FontsProvider" > "$OUT/font-provider-$1.txt"
  if grep -q "$PKG" "$OUT/font-provider-$1.txt"; then metric "game_linked_to_play_services_fonts_$1" yes; else metric "game_linked_to_play_services_fonts_$1" no; fi
}
make_move() { # one real swipe from the hook's suggested move; waits until it has been played
  local before swipe_points
  before=$(q 's.moves_played')
  swipe_points=$(q 'swipe(s.move)')
  [ "$swipe_points" = "none" ] && return 1
  ensure_app_focused
  adb shell input swipe $swipe_points 260
  wait_for "s.moves_played > $before || s.state === 'WON' || s.state === 'LOST'" 60 "the move to resolve"
  return 0
}
play_step() { # one step of "keep playing" from whatever screen is showing (used by the offline and 3-minute loops)
  case "$(q 's.modal || s.state')" in
    PLAYING) make_move && return 0 ;;
    win) tap_button "btn-next"; sleep 2 ;;
    intro) tap_button "btn-intro-play"; sleep 1.5 ;;
    lose) tap_button "btn-retry"; sleep 2 ;;
    pause) tap_button "btn-resume"; sleep 1 ;;
    hearts) tap_button "btn-hearts-unlimited"; sleep 1.5 ;;
    MAP)
      if [ "$(q "px(s.map_nodes[String(s.unlocked)])")" = "none" ]; then tap_button "btn-map-mine"; else tap_map_node "$(q 's.unlocked')"; fi
      sleep 1.5 ;;
    *) sleep 1 ;;
  esac
  return 1
}
scroll_to_button() { # scrolls the open modal until button $1 sits in the middle 60% of the screen
  local attempt
  for attempt in $(seq 1 10); do
    [ "$(q "!!s.buttons['$1'] && s.buttons['$1'][1] > s.viewport[1] * 0.2 && s.buttons['$1'][1] < s.viewport[1] * 0.8")" = "true" ] && return 0
    ensure_app_focused
    adb shell input swipe 540 1700 540 900 300
    sleep 0.9
  done
  fail "button '$1' never scrolled into view"
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
# Other apps' crash/"not responding" dialogs are not part of this test; hide them (best effort).
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put secure anr_show_background 0 || true
adb shell getprop ro.build.version.release | tee "$OUT/android-version.txt"
adb shell wm size | tee -a "$OUT/android-version.txt"
adb shell dumpsys package com.google.android.webview | grep -m1 versionName | tee -a "$OUT/android-version.txt"

# A freshly booted emulator keeps delivering boot broadcasts and starting services for a while; launching into
# that stalls the app's UI thread for seconds. Wait until the boot animation has stopped and the load settles.
for settle in $(seq 1 90); do
  load=$(adb shell cat /proc/loadavg 2>/dev/null | awk '{print int($1)}')
  [ "$(adb shell getprop init.svc.bootanim | tr -d '\r')" = "stopped" ] && [ "${load:-99}" -lt 3 ] && break
  sleep 2
done
metric settle_wait_seconds "$((settle * 2))"
# Google Play services restarts its own processes to refresh configuration during the first minutes after boot, and
# Android then kills every app holding one of its providers. Start the tests only once the device has been up 3 minutes.
uptime_s=$(adb shell cat /proc/uptime 2>/dev/null | awk '{print int($1)}')
if [ "${uptime_s:-0}" -lt 180 ]; then
  log "device up ${uptime_s:-0}s; waiting until it has been up 180s"
  sleep $((180 - ${uptime_s:-0}))
fi
metric device_uptime_at_launch_s "$(adb shell cat /proc/uptime | awk '{print int($1)}')"
metric load_average_at_launch "$(adb shell cat /proc/loadavg | tr -d '\r')"

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
font_provider_link "title"

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
font_provider_link "after-level-1"

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

# --- A long press released on a button still activates it (WebView sends no click after a long press)
help_point=$(q "px(s.buttons['btn-title-help'])")
[ "$help_point" = "none" ] && fail "Help button not visible"
ensure_app_focused
adb shell input swipe $help_point $help_point 900
wait_for "s.modal === 'help'" 15 "a 900 ms press on Help to open it"
back
wait_for "s.state === 'TITLE' && !s.modal" 15 "one Back to close Help (it must have opened only once)"
pass "a 900 ms long press on a button activates it exactly once"
tap_button "btn-play"
wait_for "s.state === 'MAP' && s.map_nodes['1'] !== undefined" 15 "the map"
sleep 1
tap_map_node 1
wait_for "s.modal === 'intro'" 15 "the level intro"
shot "07-intro"
back
wait_for "s.state === 'MAP' && !s.modal" 15 "Back to close the intro"
pass "Back on a modal closes it first"
# The rest of this block plays Level 2: Level 1 is a tutorial that one good move can win, which would end the level
# in the middle of the background/foreground checks below.
tap_map_node 2
wait_for "s.modal === 'intro'" 15 "the Level 2 intro"
tap_button "btn-intro-play"
wait_for "s.state === 'PLAYING' && s.level === 2" 15 "Level 2 gameplay"
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
adb shell am start -W -n "$ACTIVITY" > /dev/null
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
tap_button "btn-confirm-quit-yes"
wait_for "s.state === 'MAP' && !s.modal" 15 "the map after quitting"
back
wait_for "s.state === 'TITLE' && !s.modal" 15 "the title"
tap_button "btn-title-settings"
wait_for "s.modal === 'settings'" 15 "settings"
scroll_to_button "btn-choose-photo"
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
scroll_to_button "btn-self-test"
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
adb shell am start -W -n "$ACTIVITY" > /dev/null
wait_for "s.ready && s.state === 'TITLE'" 60 "the title screen offline"
sleep 1.5
tap_button "btn-play"
wait_for "s.state === 'MAP' && s.map_nodes['2'] !== undefined" 15 "the map offline"
sleep 1
tap_map_node 2
wait_for "s.modal === 'intro'" 15 "the Level 2 intro"
tap_button "btn-intro-play"
wait_for "s.state === 'PLAYING' && s.level === 2" 15 "Level 2 offline"
offline_moves=0
offline_deadline=$((SECONDS + 420))
while [ "$offline_moves" -lt 10 ]; do
  [ $SECONDS -lt $offline_deadline ] || fail "only $offline_moves offline moves in 7 minutes (stuck at '$(q 's.modal || s.state')')"
  play_step && offline_moves=$((offline_moves + 1))
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
  play_step && played=$((played + 1))
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

# --- The map at a seeded level-19,000 save: live nodes, frame pacing while flinging, memory, save size and parse time.
# The save is written through the game's own store over the debug WebView's DevTools socket (debug builds only).
# The play loop may have stopped mid-win: Back skips the Sweet Finale, then closes the win popup, the map, ... (the
# emulator renders a few frames a second, so game time runs slower than the clock: allow plenty of presses).
for attempt in $(seq 1 20); do
  case "$(q 's.modal || s.state')" in
    TITLE) break ;;
    confirm-quit) tap_button "btn-confirm-quit-yes"; sleep 1.5 ;;
    *) back ;;
  esac
done
wait_for "s.state === 'TITLE' && !s.modal" 20 "the title screen before seeding"
app_pid=$(adb shell pidof "$PKG" | tr -d '\r')
devtools_socket=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$app_pid" | head -1)
[ -n "$devtools_socket" ] || fail "the debug build's WebView DevTools socket was not found"
adb forward tcp:9333 "localabstract:$devtools_socket" > /dev/null
before_seed=$(fresh)
node tests/emulator/cdp-eval.mjs 9333 tests/emulator/seed-level-19000.js > "$OUT/seed-19000.json" || fail "seeding the level-19,000 save failed"
adb forward --remove tcp:9333 > /dev/null 2>&1
log "seeded: $(cat "$OUT/seed-19000.json")"
metric save_19000_bytes "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).save_bytes)' "$OUT/seed-19000.json")"
metric save_19000_parse_ms "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).parse_ms)' "$OUT/seed-19000.json")"
# The page reloads, so the hook starts counting again: a snapshot numbered below the one before seeding is a new page.
wait_for "s.seq < $before_seed && s.ready && s.state === 'TITLE' && s.unlocked === 19000" 90 "the game to reload with the level-19,000 save"
tap_button "btn-play"
wait_for "s.state === 'MAP' && s.map_nodes['18999'] !== undefined" 30 "the map at level 19,000"
sleep 2
shot "12b-map-level-19000"
metric map_19000_live_nodes "$(q 's.map_live_nodes')"
metric map_19000_rendered_range "$(q 'JSON.stringify(s.map_range)')"
adb shell dumpsys gfxinfo "$PKG" reset > /dev/null
adb shell dumpsys meminfo "$PKG" > "$OUT/meminfo-map-19000-start.txt"
max_live=0
for fling in $(seq 1 12); do
  ensure_app_focused
  if [ $((fling % 4)) -lt 2 ]; then adb shell input swipe 540 700 540 1900 120; else adb shell input swipe 540 1900 540 700 120; fi
  sleep 1.2
  live=$(q 's.map_live_nodes')
  [ "$live" -gt "$max_live" ] && max_live=$live
done
adb shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo-map-19000.txt"
adb shell dumpsys meminfo "$PKG" > "$OUT/meminfo-map-19000.txt"
shot "12c-map-level-19000-after-flings"
metric map_19000_max_live_nodes_while_flinging "$max_live"
metric map_19000_total_frames "$(grep -m1 'Total frames rendered' "$OUT/gfxinfo-map-19000.txt" | awk -F': ' '{print $2}' | tr -d '\r')"
metric map_19000_janky_frames "$(grep -m1 'Janky frames:' "$OUT/gfxinfo-map-19000.txt" | awk -F': ' '{print $2}' | tr -d '\r')"
metric map_19000_pss_kb "$(grep -m1 'TOTAL PSS:' "$OUT/meminfo-map-19000.txt" | awk '{print $3}')"
[ "$max_live" -le 60 ] || fail "the map kept $max_live live nodes at level 19,000 (limit 60)"
tap_button "btn-map-mine"
wait_for "s.map_nodes['18999'] !== undefined" 20 "'Jump to my level' to return to level 19,000"
check_no_crash "level-19,000 map"
pass "map at a seeded level-19,000 save: at most $max_live live nodes while flinging; metrics recorded"
# Put the real save back so the release build and the monkey run start from normal, playable progress.
back
wait_for "s.state === 'TITLE' && !s.modal" 15 "the title before restoring the save"
app_pid=$(adb shell pidof "$PKG" | tr -d '\r')
devtools_socket=$(adb shell cat /proc/net/unix | grep -o "webview_devtools_remote_$app_pid" | head -1)
adb forward tcp:9333 "localabstract:$devtools_socket" > /dev/null
before_restore=$(fresh)
node tests/emulator/cdp-eval.mjs 9333 tests/emulator/restore-save.js > "$OUT/restore-save.json" || fail "restoring the player's save failed"
adb forward --remove tcp:9333 > /dev/null 2>&1
wait_for "s.seq < $before_restore && s.ready && s.state === 'TITLE' && s.unlocked < 19000" 90 "the game to reload with the player's own save"

# --- "Exit game?" -> Exit really closes the app
for attempt in $(seq 1 12); do
  case "$(q 's.modal || s.state')" in
    TITLE) break ;;
    win|lose) back ;;
    pause) back ;;
    confirm-quit) tap_button "btn-confirm-quit-yes"; sleep 1.5 ;;
    intro|hearts|settings|goto) back ;;
    PLAYING|RESOLVING|MAP) back ;;
    *) sleep 1 ;;
  esac
done
wait_for "s.state === 'TITLE' && !s.modal" 20 "the title screen"
back
wait_for "s.modal === 'confirm-exit'" 15 "'Exit game?'"
tap_button "btn-confirm-exit-yes"
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
