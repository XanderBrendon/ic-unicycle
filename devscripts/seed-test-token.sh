#!/usr/bin/env bash
#
# Mint TEST tokens (the local test_icrc1_ledger) into a principal's local
# wallet so US19's "recover an unsupported token" flow has a stray balance to
# find. TEST is a real DFINITY ICRC-1 ledger deployed only on the local network
# (see icp.yaml). Its minting account is the `dev` identity, so a transfer FROM
# dev mints new tokens — that's what this does.
#
# Usage:
#   devscripts/seed-test-token.sh <principal> [whole_token_amount=100]
#
# Example — seed the principal you see signed in as in the browser:
#   devscripts/seed-test-token.sh s35ww-...-lae 250
#
# After running, paste the test_icrc1_ledger canister id into the wallet's
# `Add token` box. The script prints it; it also lives in
# .icp/cache/mappings/ledger.ids.json.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAPPINGS="$REPO_ROOT/.icp/cache/mappings/ledger.ids.json"

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '3,20p' "$0" >&2
    exit 1
fi

PRINCIPAL="$1"
WHOLE="${2:-100}"
DECIMALS=8
# Base units = whole * 10^decimals.
AMOUNT="${WHOLE}$(printf '0%.0s' $(seq 1 "$DECIMALS"))"

echo "==> Minting $WHOLE TEST ($AMOUNT base units) to $PRINCIPAL"
icp canister call -e ledger --identity dev test_icrc1_ledger icrc1_transfer \
    "(record { to = record { owner = principal \"$PRINCIPAL\" }; amount = $AMOUNT })"

echo
echo "==> Recipient TEST balance:"
icp canister call -e ledger test_icrc1_ledger icrc1_balance_of \
    "(record { owner = principal \"$PRINCIPAL\" })"

echo
echo "==> test_icrc1_ledger canister id (paste this into 'Add token'):"
grep -o '"test_icrc1_ledger": "[^"]*"' "$MAPPINGS" | sed 's/.*: "//; s/"$//'
