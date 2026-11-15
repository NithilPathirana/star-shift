#!/bin/sh
# One-command deploy (Judging panel round 4, item 11: a live page check after EVERY deploy).
#   sh deploy/deploy.sh [commit]        default: HEAD of the main checkout
# Builds from a clean worktree (../SpaceApps2026-deploy, or $DEPLOY_DIR), never from the shared folder:
# npm test, prepare-assets (source.zip + loader media), wrangler deploy, then the page check and the smoke
# test against the LIVE URL. A failing live check exits non-zero so it is never missed.
# AI-written code (Claude, Anthropic) for team Proper Motion, NASA Space Apps 2026.
set -e
ROOT="$(git rev-parse --show-toplevel)"
REV="$(git -C "$ROOT" rev-parse --short "${1:-HEAD}")"
DIR="${DEPLOY_DIR:-$ROOT/../SpaceApps2026-deploy}"
LIVE="${LIVE_URL:-https://star-shift.nithil-kpathirana.workers.dev}"
[ -d "$DIR" ] || git -C "$ROOT" worktree add --detach "$DIR" "$REV"
cd "$DIR"
git checkout -q --detach "$REV"
rm -rf web/loader web/source.zip
echo "deploy: $REV — npm test"
LOG="$(mktemp)"; npm test --silent > "$LOG" 2>&1 || { grep -E "^✖|^ℹ (pass|fail)" "$LOG" | head; echo "deploy: npm test FAILED, nothing deployed"; exit 1; }
grep -E "^ℹ (pass|fail)" "$LOG"
node deploy/prepare-assets.mjs > "$LOG" 2>&1 || { tail -5 "$LOG"; echo "deploy: prepare-assets FAILED, nothing deployed"; exit 1; }
WRANGLER_SEND_METRICS=false CI=1 npx --yes wrangler@4 deploy > "$LOG" 2>&1 || { tail -8 "$LOG"; echo "deploy: wrangler FAILED"; exit 1; }
grep -E "Version ID" "$LOG"
echo "deploy: live page check on $LIVE"
node deploy/page-check.mjs "$LIVE" > "$LOG" 2>&1 || { grep -E "FAIL|could not" "$LOG" | head; echo "deploy: LIVE PAGE CHECK FAILED after deploying $REV"; exit 2; }
tail -1 "$LOG"
node deploy/smoke-test.mjs "$LIVE" | grep -E "passed|FAIL" || true   # IRSA-route rows can fail while IRSA itself is down
echo "deploy: $REV is live"
