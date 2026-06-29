#!/usr/bin/env bash
#
# Seed the local REAL SNS (Sneed-equivalent) for unicycle integration testing.
# Run after `icp deploy -e ledger` (+ setup-sns-local.sh) has installed the real
# SNS canisters (sns_ledger/sns_index/sns_root/sns_governance, all in the
# `ledger` env).
#
# Seeds ONLY the mainnet-equivalent preconditions — the state a launched SNS
# already has *before* it ever onboards unicycle:
#   1. Registry  — map governance → root in the sns_wasm shim so the backend's
#      `resolveSnsRoot(governance)` recognizes the caller as an SNS. This is the
#      local stand-in for the live NNS SNS-Wasm registry (which lists every
#      launched SNS automatically) — not part of unicycle onboarding.
#   2. Treasury  — fund the SNS's ICP treasury (governance's default ICP account
#      on the NNS ICP ledger) so US24 TransferSnsTreasuryFunds proposals can
#      actually move ICP into unicycle's deposit subaccount.
#
# It deliberately does NOT register unicycle's custom functions or record the
# proposal neuron: that is unicycle's own onboarding path (register the `snsSetup`
# bootstrap, then execute it), which the local quickstart walks through exactly as
# on mainnet — so the starting state stays as close to a real mainnet SNS as
# possible. The dominant neuron + backend hotkey come baked into the governance
# init payload (installed by setup-sns-local.sh), so they are already in place.
#
# To pre-register the 12 functions for flows that need them already present (e.g.
# the manual test guide's later sections), run
# devscripts/register-sns-functions.sh.
#
# Usage:
#   devscripts/seed-sns-real.sh [treasury_icp=1000]
set -euo pipefail
cd "$(dirname "$0")/.."

SNS_ENV=ledger   # env holding the SNS suite + the sns_wasm registry shim
SNS_IDS=.icp/cache/mappings/${SNS_ENV}.ids.json
CORE_IDS=.icp/cache/mappings/local.ids.json
# Resolve a canister id from either env mapping (the SNS env is read last, so it
# wins over any stale SNS ids lingering in local.ids.json).
cid() {
  python3 - "$1" "$CORE_IDS" "$SNS_IDS" <<'PY'
import json, os, sys
key = sys.argv[1]
ids = {}
for path in sys.argv[2:]:
    if os.path.exists(path):
        ids.update(json.load(open(path)))
print(ids[key])
PY
}

GOV=$(cid sns_governance)
ROOT=$(cid sns_root)
TREASURY_ICP="${1:-1000}"

echo "==> 1/2 registry: $GOV -> $ROOT"
icp canister call sns_wasm addSns "(principal \"$GOV\", principal \"$ROOT\")" -e "$SNS_ENV" >/dev/null

echo "==> 2/2 fund SNS ICP treasury (governance $GOV) with $TREASURY_ICP ICP"
icp token transfer "$TREASURY_ICP" "$GOV" >/dev/null
echo "    treasury balance: $(icp token balance --of-principal "$GOV")"

echo
echo "Seed complete (preconditions only — no custom functions registered)."
echo "Onboard unicycle via the quickstart (register fn 2000 -> execute it), or"
echo "pre-register the 12 functions with: devscripts/register-sns-functions.sh"
