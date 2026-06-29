#!/usr/bin/env bash
#
# Pre-register unicycle's 12 custom functions on the local REAL SNS via the
# `adminSnsSetup` admin shortcut: it records the proposal neuron and submits the
# 12 AddGenericNervousSystemFunction proposals in one call; the dominant neuron
# auto-adopts each, so all twelve (ids baseFunctionId .. +11) register.
#
# This is the ADMIN shortcut, NOT the path an SNS takes on mainnet. Use it only
# when a test needs the functions already registered (e.g. the manual test
# guide's US24/US25/US26/US27 sections, which submit
# ExecuteGenericNervousSystemFunction proposals against ids 1000-1011). To
# exercise the REAL mainnet onboarding path — register the `snsSetup` bootstrap
# (fn 2000) via a proposal, then execute that proposal — follow the local
# quickstart instead (2026-06-28-sns-unicycle-quickstart-local.md).
#
# Re-registering a function id that already exists fails by design, so run this
# against a freshly-(re)installed governance (devscripts/setup-sns-local.sh).
#
# Run after setup-sns-local.sh, which installs governance with the dominant
# neuron + backend hotkey baked in.
#
# Usage:
#   devscripts/register-sns-functions.sh [base_function_id=1000]
set -euo pipefail
cd "$(dirname "$0")/.."

SNS_ENV=ledger   # the SNS suite
CORE_ENV=local   # unicycle_backend
SNS_IDS=.icp/cache/mappings/${SNS_ENV}.ids.json
CORE_IDS=.icp/cache/mappings/${CORE_ENV}.ids.json
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
BASE_FN="${1:-1000}"
# The dominant neuron baked into vendor/sns_governance/governance_init.candid:
# 32 bytes of 0x01, with the unicycle backend hotkeyed (SUBMIT_PROPOSAL + VOTE).
NEURON_BLOB="blob \"$(printf '\\01%.0s' {1..32})\""

echo "==> adminSnsSetup: record proposal neuron + register 12 functions (base $BASE_FN) on $GOV"
icp canister call unicycle_backend adminSnsSetup \
  "(principal \"$GOV\", $NEURON_BLOB, ${BASE_FN}:nat64)" -e "$CORE_ENV"

echo
echo "Verify with:"
echo "  icp canister call sns_governance list_nervous_system_functions '()' -e $SNS_ENV"
