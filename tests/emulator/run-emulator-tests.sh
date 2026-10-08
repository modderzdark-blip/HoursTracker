#!/usr/bin/env bash
# Emulator smoke test (pipeline bring-up). Runs inside reactivecircus/android-emulator-runner.
set -uo pipefail
OUT="${EMULATOR_OUTPUT:-$PWD/emulator-output}"
PKG=app.sweetcascade.game
ACTIVITY="$PKG/.MainActivity"
mkdir -p "$OUT/screenshots"
touch "$OUT/booted.marker"
adb shell getprop ro.build.version.release | tee "$OUT/android-version.txt"

APK_RELEASE=$(ls dist/SweetCascade-v*.apk | head -1)
APK_DEBUG=dist/test-only-debug-build.apk
fail() { echo "FAIL: $*" | tee -a "$OUT/summary.txt"; adb logcat -d > "$OUT/logcat-final.txt"; exit 1; }
pass() { echo "PASS: $*" | tee -a "$OUT/summary.txt"; }
shot() { adb exec-out screencap -p > "$OUT/screenshots/$1.png"; }

adb install -r -g "$APK_DEBUG" || fail "install debug APK"
pass "installed test-only debug APK"
adb logcat -c
START_OUTPUT=$(adb shell am start -W -n "$ACTIVITY")
echo "$START_OUTPUT" | tee "$OUT/cold-start.txt"
for second in $(seq 1 60); do
  if adb logcat -d | grep -q "SCTEST"; then break; fi
  sleep 1
done
adb logcat -d | grep "SCTEST" | tail -5
adb logcat -d | grep -q "SCTEST" || fail "test hook never reported (page did not load)"
pass "debug build launched and test hook reported"
sleep 2
shot debug-launch
adb shell pidof "$PKG" >/dev/null || fail "app process not running"
if adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG"; then fail "crash or ANR in logcat"; fi
pass "no crash after launch"

adb install -r "$APK_RELEASE" || fail "install release APK over debug build (same key)"
adb logcat -c
adb shell am start -W -S -n "$ACTIVITY" | tee "$OUT/cold-start-release.txt"
sleep 6
shot release-launch
adb shell pidof "$PKG" >/dev/null || fail "release app process not running"
if adb logcat -d | grep -E "FATAL EXCEPTION|ANR in $PKG"; then fail "crash or ANR in logcat (release)"; fi
pass "release APK installed over debug build and launched"
adb logcat -d > "$OUT/logcat-final.txt"
echo "EMULATOR TESTS: ALL PASSED" | tee -a "$OUT/summary.txt"
