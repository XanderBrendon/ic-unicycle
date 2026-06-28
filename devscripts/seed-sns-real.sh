#!/usr/bin/env bash
#
# Seed the local REAL SNS (Sneed-equivalent) for unicycle integration testing.
# Replaces the old stub seed (seed-sns-governance-stub.sh). Run after
# `icp deploy -e ledger` (+ setup-sns-local.sh) has installed the real SNS
# canisters (sns_ledger/sns_index/sns_root/sns_governance, all in the `ledger`
# env).
#
# Does, in order:
#   1. Registry  — map governance → root in the sns_wasm shim so the backend's
#      `resolveSnsRoot(governance)` recognizes the caller as an SNS.
#   2. Treasury  — fund the SNS's ICP treasury (governance's default ICP account
#      on the NNS ICP ledger) so US24 TransferSnsTreasuryFunds proposals can
#      actually move ICP into unicycle's deposit subaccount.
#   3. Setup     — `adminSnsSetup` (driven as --identity dev, a backend
#      controller = admin) records the proposal neuron with the backend AND
#      submits the AddGenericNervousSystemFunction proposals. The dominant
#      neuron (baked into governance init with the backend hotkeyed) holds 100%
#      voting power, so each proposal auto-adopts and executes, registering the
#      twin on governance.
#
# The neuron id is 32 bytes of 0x01 — the same value baked into
# vendor/sns_governance/governance_init.candid.
#
# Usage:
#   devscripts/seed-sns-real.sh [treasury_icp=1000]
set -euo pipefail
cd "$(dirname "$0")/.."

SNS_ENV=ledger   # env holding the SNS suite + the sns_wasm registry shim
CORE_ENV=local   # env holding unicycle_backend
SNS_IDS=.icp/cache/mappings/${SNS_ENV}.ids.json
CORE_IDS=.icp/cache/mappings/${CORE_ENV}.ids.json
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
BACKEND=$(cid unicycle_backend)
TREASURY_ICP="${1:-1000}"
NEURON_BLOB="blob \"$(printf '\\01%.0s' {1..32})\""

echo "==> 1/3 registry: $GOV -> $ROOT"
icp canister call sns_wasm addSns "(principal \"$GOV\", principal \"$ROOT\")" -e "$SNS_ENV" >/dev/null

echo "==> 2/3 fund SNS ICP treasury (governance $GOV) with $TREASURY_ICP ICP"
icp token transfer "$TREASURY_ICP" "$GOV" >/dev/null
echo "    treasury balance: $(icp token balance --of-principal "$GOV")"

echo "==> 3/3 adminSnsSetup (registers proposal neuron + 12 custom functions)"
icp canister call unicycle_backend adminSnsSetup \
  "(principal \"$GOV\", $NEURON_BLOB, 1000:nat64)" -e "$CORE_ENV"

echo
echo "Seed complete. Verify registered functions with:"
echo "  icp canister call sns_governance list_nervous_system_functions '()' -e $SNS_ENV"
