#!/usr/bin/env bash
#
# Seed the LOCAL unicycle_backend with curated sample data.
#
# No seeding method exists in main.mo, and none ever ships to mainnet. Instead
# this script builds a throwaway wasm — main.mo with devscripts/seed/seed_block.mo
# appended to the actor body — installs it onto the local backend as an upgrade
# (the fixtures are written while that upgrade runs, because actor-body
# statements re-run on every install/upgrade), and then restores the production
# wasm. The seeded state survives the restore via enhanced orthogonal
# persistence, so you end up on the real production wasm holding rich history.
#
# Usage:
#   devscripts/seed-local.sh <owner-a-principal> [owner-b-principal]
#
# owner-a is made an admin and gets the six curated canister scenarios.
# owner-b stays a plain user, so the non-admin view is testable too.
#
# IMPORTANT: owner-a must be the principal your BROWSER holds after signing in
# with local Internet Identity — II issues a per-app principal, which is not
# your `icp identity principal`. Copy it from the identity menu in the app.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="$ROOT/src/unicycle_backend/main.mo"
BLOCK="$ROOT/devscripts/seed/seed_block.mo"
OVERLAY="$ROOT/src/unicycle_backend/main.seed.mo"
IDS="$ROOT/.icp/cache/mappings/local.ids.json"

# A structurally valid, obviously-synthetic principal. Used when no second owner
# is given, so the admin cross-owner tables always have more than one row.
DEFAULT_OWNER_B="snnfi-lalgb-kxvh6-e5ehd-gwd5u-ld6ye-jwloa-klsxp-cq4v5-a5izx-zae"

die() { echo "error: $*" >&2; exit 1; }

if [ $# -lt 1 ]; then
  sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2
  exit 1
fi

OWNER_A="$1"
OWNER_B="${2:-$DEFAULT_OWNER_B}"
[ "$OWNER_A" != "$OWNER_B" ] || die "owner-a and owner-b must differ"

cd "$ROOT"

# --- preconditions --------------------------------------------------------
icp network ping local >/dev/null 2>&1 || die "local network is not running — start it with 'icp network start -d'"
[ -f "$IDS" ] || die "no local canister id mapping at $IDS — run 'icp deploy' first"
[ -f "$BLOCK" ] || die "missing fixture block at $BLOCK"

canister_id() { sed -n "s/.*\"$1\": *\"\([^\"]*\)\".*/\1/p" "$IDS" | head -1; }

[ -n "$(canister_id unicycle_backend)" ] || die "unicycle_backend is not deployed locally — run 'icp deploy' first"

# The SNS fixtures point at the real local SNS canisters so the SNS screens are
# not showing dangling principals. Without the `ledger` environment deployed
# those ids do not exist, so the SNS block is skipped rather than faked.
SNS_GOV="$(canister_id sns_governance)"
SNS_ROOT="$(canister_id sns_root)"
if [ -n "$SNS_GOV" ] && [ -n "$SNS_ROOT" ]; then
  SNS_ENABLED=true
else
  SNS_ENABLED=false
  SNS_GOV="aaaaa-aa"
  SNS_ROOT="aaaaa-aa"
  echo "warning: sns_governance/sns_root not deployed locally — skipping the SNS fixtures." >&2
  echo "         run 'icp deploy -e ledger' first if you need them." >&2
fi

# The overlay is built by stripping main.mo's final line, so make that
# assumption explicit rather than silently producing a broken file.
[ "$(tail -n 1 "$MAIN")" = "};" ] || die "main.mo does not end with the actor's closing '};' — the overlay generator needs updating"

# --- cleanup / restore ----------------------------------------------------
# The dangerous state is "seed wasm installed, production wasm not restored", so
# the restore lives in the trap and runs on success and failure alike.
INSTALLED=0
cleanup() {
  local rc=$?
  rm -f "$OVERLAY"
  if [ "$INSTALLED" = 1 ]; then
    echo "==> restoring the production wasm"
    if ! icp deploy unicycle_backend; then
      echo "error: restore failed. The local backend is still running the seed wasm." >&2
      echo "       run 'icp deploy unicycle_backend' to fix it." >&2
      rc=1
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT

# --- generate the overlay -------------------------------------------------
echo "==> generating $(basename "$OVERLAY")"
{
  head -n -1 "$MAIN"
  sed -e "s|__OWNER_A__|$OWNER_A|g" \
      -e "s|__OWNER_B__|$OWNER_B|g" \
      -e "s|__SNS_ENABLED__|$SNS_ENABLED|g" \
      -e "s|__SNS_GOV__|$SNS_GOV|g" \
      -e "s|__SNS_ROOT__|$SNS_ROOT|g" \
      "$BLOCK"
  echo "};"
} > "$OVERLAY"

# --- build ----------------------------------------------------------------
echo "==> building the seed wasm"
icp build -e seed unicycle_backend_seed

WASM="$ROOT/.icp/cache/artifacts/unicycle_backend_seed"
[ -f "$WASM" ] || die "expected the built seed wasm at $WASM"

# `icp canister install --wasm` does not pick up init_args from icp.yaml, and the
# actor class takes four principals. Read them from the unicycle_backend entry
# rather than keeping a second copy here that could drift out of step.
BACKEND_ARGS="$(sed -n "/^  - name: unicycle_backend$/,/^  - name: /p" "$ROOT/icp.yaml" \
  | sed -n "s/^    init_args: '\(.*\)'$/\1/p" | head -1)"
[ -n "$BACKEND_ARGS" ] || die "could not read unicycle_backend's init_args from icp.yaml"

# --- install, seed, restore ----------------------------------------------
echo "==> installing the seed wasm (fixtures are written during this upgrade)"
INSTALLED=1
icp canister install unicycle_backend --mode upgrade --wasm "$WASM" --args "$BACKEND_ARGS"

echo "==> seeded"
echo "    owner A (admin): $OWNER_A"
echo "    owner B (user):  $OWNER_B"
[ "$SNS_ENABLED" = true ] && echo "    SNS root:        $SNS_ROOT"
exit 0
