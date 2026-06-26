#!/usr/bin/env bash
#
# Encode the real SNS canisters' init payloads from their human-readable Candid
# (.candid) template files into raw binary (.bin) artifacts that icp.yaml
# installs via `init_args: { path: …, format: bin }`.
#
# The .candid files use @@name@@ placeholders for local canister ids (e.g.
# @@sns_governance@@, @@sns_root@@, @@sns_ledger@@, @@sns_index@@,
# @@unicycle_backend@@). This script substitutes the LIVE ids from
# .icp/cache/mappings/<env>.ids.json before encoding, so the wiring is always
# correct even if a fresh `icp deploy` allocates different ids. (Sneed's swap id
# hshru-… stays literal — it is an inert placeholder, not a local canister, and
# the dev controller principal is a fixed identity, not a canister.)
#
# WHY type-aware binary instead of inline Candid text: icp-cli has no Candid
# interface for a pre-built canister, so it would encode an inline candid string
# by *inferring* types — which mis-encodes map fields like governance's
# `neurons : vec record { text; Neuron }` ("expect a key-value pair" trap). didc
# encodes against the real .did type, guaranteeing a clean decode on the canister.
#
# Re-run this after `icp deploy` (which allocates ids) and before reinstalling the
# SNS canisters. Requires `didc`, `xxd`, and `python3`.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${1:-local}"
IDS=".icp/cache/mappings/${ENV}.ids.json"
[ -f "$IDS" ] || { echo "error: $IDS not found — run 'icp deploy -e $ENV' first" >&2; exit 1; }

# Build a sed program that replaces every @@name@@ with the live id for that name.
SEDPROG=$(python3 - "$IDS" <<'PY'
import json, sys
ids = json.load(open(sys.argv[1]))
print("".join(f"s|@@{name}@@|{cid}|g;" for name, cid in ids.items()))
PY
)

encode() {
  local did="$1" type="$2" src="$3" out="$4" filled
  filled=$(sed "$SEDPROG" "$src")
  # Fail loudly if any placeholder survived (missing id in the mappings file).
  if printf '%s' "$filled" | grep -q '@@'; then
    echo "error: unresolved @@placeholder@@ in $src — check $IDS" >&2; exit 1
  fi
  printf '%s' "$filled" | didc encode -d "$did" -t "$type" -f hex | xxd -r -p > "$out"
  echo "  $(printf '%-44s' "$out") $(wc -c < "$out") bytes"
}

echo "Encoding SNS init payloads (env=$ENV):"
encode vendor/sns_governance/governance.did '(Governance)'      vendor/sns_governance/governance_init.candid vendor/sns_governance/governance_init.bin
encode vendor/sns_root/root.did             '(SnsRootCanister)' vendor/sns_root/root_init.candid             vendor/sns_root/root_init.bin
encode vendor/sns_index/index-ng.did        '(opt IndexArg)'    vendor/sns_index/index_init.candid           vendor/sns_index/index_init.bin
encode vendor/icrc1/icrc1_ledger.did        '(LedgerArg)'       vendor/sns_ledger/ledger_init.candid         vendor/sns_ledger/ledger_init.bin
echo "done."
