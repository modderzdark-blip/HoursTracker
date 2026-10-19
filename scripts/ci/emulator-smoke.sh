#!/usr/bin/env bash
# Installs the preview APK on the CI emulator, launches it, taps "Tap to begin", and records
# screenshots + the WebView console so the build is verified on real Android.
set -u
OUT="${EMULATOR_OUTPUT:-emulator-output}"
mkdir -p "$OUT"
PKG=com.ashbound.game

adb wait-for-device
adb shell settings put global window_animation_scale 0 || true
adb install -r Ashbound-preview.apk
adb logcat -c || true
adb shell am start -n "$PKG/.MainActivity"
sleep 40
adb exec-out screencap -p > "$OUT/emulator-1-title.png"
PID=$(adb shell pidof "$PKG" | tr -d '\r')
echo "app pid after launch: ${PID:-none}"
# Landscape Pixel 6 is 2400x1080: tap the middle of the title screen.
adb shell input tap 1200 700
sleep 45
adb exec-out screencap -p > "$OUT/emulator-2-game.png"
adb logcat -d > "$OUT/logcat.txt" || true
grep -E "Capacitor/Console|chromium" "$OUT/logcat.txt" | tail -300 > "$OUT/webview-console.txt" || true
# Why the app died, if it did: the crash buffer plus process-death / memory-killer lines.
{
  echo "pid after launch: ${PID:-none}"
  adb logcat -d -b crash || true
  grep -E "com\.ashbound|lmkd|lowmemorykiller|AndroidRuntime|has died|ANR in|Force finishing|onRenderProcessGone|RenderProcessGone|${PID:-NOPID}" \
    "$OUT/logcat.txt" | grep -vE "Capacitor/Console" | tail -250
} > "$OUT/crash.txt" 2>&1
if adb shell pidof "$PKG" > /dev/null; then
  echo "app running" | tee "$OUT/status.txt"
else
  echo "APP NOT RUNNING (crashed?)" | tee "$OUT/status.txt"
  exit 1
fi
