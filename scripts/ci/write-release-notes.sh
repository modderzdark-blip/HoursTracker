#!/usr/bin/env bash
# Prints the release notes for the APK release (Markdown).
set -eu
repo="$GITHUB_REPOSITORY"
cat <<NOTES
**Sweet Cascade v${VERSION}** (build ${GITHUB_RUN_NUMBER}, commit ${GITHUB_SHA:0:7})

An original, fully offline match-3 puzzle game. All art and audio are generated procedurally; no third-party assets.

### Install on your Android phone
1. Tap **${APK_NAME}** below. Your browser downloads it.
2. Open the download. If Android asks, allow **Install unknown apps** for your browser.
3. Tap **Install**. If Play Protect warns you, choose **Install anyway**. This is your own sideloaded app.

Newer builds install over older ones and keep your progress, because every build is signed with the same key.

NOTES
if [ "${SIGNING_MODE:-sideload}" = "release" ]; then
  echo "Signed with the project's stable release key."
else
  echo "Signed with the project's public sideload key (no signing secrets are configured yet). See the README section *Signing*."
fi
cat <<NOTES

Checks that passed before this was published: logic tests and bot simulations, browser tests, APK verification and emulator tests.
Full run: https://github.com/${repo}/actions/runs/${GITHUB_RUN_ID}
NOTES
