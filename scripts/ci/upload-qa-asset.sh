#!/usr/bin/env bash
# Attaches a QA zip (screenshots, logs, reports) to the rolling "qa" pre-release so it can be
# downloaded without signing in. This is not a game build; the APK lives in the "latest" release.
set -u
asset_path="${1:-}"
if [ -z "$asset_path" ] || [ ! -f "$asset_path" ]; then
  echo "No QA asset '$asset_path' to upload."
  exit 0
fi
repo="$GITHUB_REPOSITORY"
tag="${QA_RELEASE_TAG:-qa}"
if ! gh release view "$tag" --repo "$repo" >/dev/null 2>&1; then
  gh release create "$tag" --repo "$repo" --prerelease --target "$GITHUB_SHA" \
    --title "QA artifacts (CI screenshots and reports)" \
    --notes "Screenshots, logs and reports from the most recent CI run. This is NOT a game build: download the game from the 'latest' release." \
    || echo "QA release already being created by a parallel job."
fi
for attempt in 1 2 3; do
  if gh release upload "$tag" "$asset_path" --repo "$repo" --clobber; then
    echo "Uploaded $asset_path to release '$tag' (run ${GITHUB_RUN_NUMBER:-?}, commit ${GITHUB_SHA:-?})."
    exit 0
  fi
  sleep $((attempt * 5))
done
echo "warning: could not upload $asset_path to the QA release."
exit 0
