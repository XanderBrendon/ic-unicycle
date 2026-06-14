#!/usr/bin/env bash
#
# Seed the local sns_governance stub for the US22 hotkey path: grant the
# Unicycle backend `SubmitProposal` on a test neuron, then register that neuron
# with the backend via the real root-keyed `snsSetProposalNeuron` twin (driven
# with caller = the stub = governance, the only way to call that twin locally).
#
# Precondition: the sns_wasm stub must already map this sns_governance stub's id
# → a root, so the backend's `resolveSnsRoot(governance)` succeeds and
# `snsSetProposalNeuron` can key the neuron to that root. Seed it first with:
#   devscripts/seed-sns-wasm-stub.sh <sns_governance-pid> <root-pid>
#
# Usage:
#   devscripts/seed-sns-governance-stub.sh <backend-pid> [neuron-hex]
#
# neuron-hex is an optional 64-char (32-byte) hex string; defaults to 32 bytes
# of 0x01. The matching un-hotkeyed neuron used to prove the gate in the US22
# verification is 32 bytes of 0x02.
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "usage: $0 <backend-pid> [neuron-hex]" >&2
  exit 1
fi

backend="$1"
neuron_hex="${2:-$(printf '01%.0s' {1..32})}"

if ! [[ "$neuron_hex" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "error: neuron-hex must be 64 hex chars (32 bytes); got: $neuron_hex" >&2
  exit 1
fi

# Convert the hex string to a candid blob literal: \xx\xx...
blob=$(echo "$neuron_hex" | sed 's/\(..\)/\\\1/g')

icp canister call sns_governance addHotkey "(blob \"$blob\", principal \"$backend\")" >/dev/null
icp canister call sns_governance registerNeuronWithBackend "(principal \"$backend\", blob \"$blob\")" >/dev/null
echo "sns_governance seeded: neuron $neuron_hex hotkeyed to backend $backend and registered"
