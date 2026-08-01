#!/usr/bin/env bash
#
# Seed the local REAL SNS governance canister with a proposal history, so the
# frontend's SNS Proposals tab has something to render.
#
# `devscripts/seed-local.sh` onboards the SNS in *backend* state only — it writes
# a `snsProposalNeuron` entry for a neuron governance has never heard of — so
# governance itself has no Unicycle functions and no proposals, and the tab comes
# up empty. This is the governance-side half of that fixture.
#
# The real DFINITY governance wasm has no method that writes a proposal, and its
# only ingress (`manage_neuron`) auto-adopts and executes everything the dominant
# neuron submits, which would make every row `Executed` with a just-now
# timestamp. But `proposals` and `id_to_nervous_system_functions` are both init
# fields, so the history is baked into the init payload and the canister is
# reinstalled — the same path encode-sns-init.sh already uses for the wiring.
#
# The seeded set is Sneed's real Unicycle proposals (cached in
# vendor/sns_governance/sneed_proposals.json; --refresh re-fetches from mainnet)
# plus synthetic ones covering the branches Sneed's own history never exercised,
# plus non-Unicycle filler so the history is deeper than one `list_proposals`
# page and `Load more` engages.
#
# Reinstalling governance does NOT touch the backend, so seed-local.sh's
# fixtures, the recorded proposal neuron, admin grants, and configs all survive.
#
# Prerequisites:
#   icp deploy                      (core canisters)
#   icp deploy -e ledger            (the SNS suite)
#   devscripts/setup-sns-local.sh   (installs the SNS with correct wiring)
#   devscripts/seed-local.sh        (records the backend's proposal neuron)
#
# Usage:
#   devscripts/seed-sns-proposals.sh [--refresh] [--base 4000]
set -euo pipefail
cd "$(dirname "$0")/.."

SNS_ENV=ledger
INIT_BIN=vendor/sns_governance/governance_init.bin
GEN_CANDID=$(mktemp -t governance_init_seeded.XXXXXX.candid)

command -v didc >/dev/null || { echo "error: didc not found — needed to encode the init payload" >&2; exit 1; }
[ -f .icp/cache/mappings/${SNS_ENV}.ids.json ] \
  || { echo "error: the SNS suite is not deployed — run 'icp deploy -e $SNS_ENV' and devscripts/setup-sns-local.sh" >&2; exit 1; }

# governance_init.bin is a tracked file. Leaving the seeded variant in place
# would dirty the tree and silently re-apply the seed on the next unrelated
# reinstall, so restore it on success and failure alike (as seed-local.sh does
# with the production wasm).
ORIGINAL_BIN=$(mktemp -t governance_init.XXXXXX.bin)
cp "$INIT_BIN" "$ORIGINAL_BIN"
cleanup() {
  local rc=$?
  cp "$ORIGINAL_BIN" "$INIT_BIN"
  rm -f "$ORIGINAL_BIN" "$GEN_CANDID"
  exit "$rc"
}
trap cleanup EXIT

echo "==> 1/3 generating the seeded init payload"
node devscripts/seed/sns-proposals.mjs --out "$GEN_CANDID" "$@"

echo "==> 2/3 encoding"
didc encode -d vendor/sns_governance/governance.did -t '(Governance)' -f hex < "$GEN_CANDID" \
  | xxd -r -p > "$INIT_BIN"
echo "    $INIT_BIN $(wc -c < "$INIT_BIN") bytes"

echo "==> 3/3 reinstalling sns_governance"
icp deploy sns_governance -e "$SNS_ENV" --mode reinstall -y >/dev/null

echo
echo "Seeded. Verify with:"
echo "  icp canister call sns_governance list_nervous_system_functions '()' --query -e $SNS_ENV"
echo "  open the SNS in the frontend and switch to the Proposals tab"
