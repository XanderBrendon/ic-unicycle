#!/usr/bin/env bash
#
# One-command (re)setup of the local REAL SNS (Sneed-equivalent) for unicycle
# integration testing. Run after `icp deploy -e local` (core canisters) and
# `icp deploy -e ledger` (the on-demand fixtures: test ICRC ledger, the sns_wasm
# registry shim, and the SNS suite, which all live in the `ledger` env).
#
# Steps:
#   1. Allocate the SNS canister ids (no-op if they already exist). Allocating
#      before encoding solves the circular wiring: governance↔root↔ledger↔index
#      all need each other's ids baked into their init payloads.
#   2. Bake the live ids into the init payloads (encode-sns-init.sh).
#   3. (Re)install the SNS canisters with the correct wiring, ledger → index →
#      root → governance so governance starts with its ledger live.
#   4. Seed the registry + ICP treasury + custom functions (seed-sns-real.sh).
#
# Idempotent: safe to re-run to reset the SNS to a clean seeded state.
set -euo pipefail
cd "$(dirname "$0")/.."
ENV=ledger   # the SNS suite lives in the `ledger` env (see icp.yaml)

echo "==> 1/4 allocate SNS canister ids (no-op if already created)"
for c in sns_ledger sns_index sns_root sns_governance; do
  icp canister create "$c" -e "$ENV" >/dev/null 2>&1 && echo "    created $c" || echo "    $c already exists"
done

echo "==> 2/4 bake live ids into init payloads"
./devscripts/encode-sns-init.sh "$ENV"

echo "==> 3/4 (re)install SNS canisters (ledger → index → root → governance)"
icp deploy sns_ledger sns_index sns_root sns_governance -e "$ENV" --mode reinstall -y >/dev/null
echo "    installed (module hashes match Sneed mainnet)"

echo "==> 4/4 seed registry + treasury + functions"
./devscripts/seed-sns-real.sh
