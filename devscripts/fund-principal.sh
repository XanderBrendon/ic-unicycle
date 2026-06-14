#!/usr/bin/env bash
#
# Fund a principal with ICP and cycles on the local replica.
#
# Usage:
#   devscripts/fund-principal.sh <principal> [icp_amount=100] [cycles_amount=10t]
#
# Examples:
#   devscripts/fund-principal.sh aaaaa-aa
#   devscripts/fund-principal.sh aaaaa-aa 50 5t
#
# Cycles amount accepts suffixes: k, m, b, t.
# If the current icp identity is short on cycles, top it up first with:
#   icp cycles mint --icp <amount>

set -euo pipefail

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    sed -n '3,14p' "$0" >&2
    exit 1
fi

PRINCIPAL="$1"
ICP_AMOUNT="${2:-100}"
CYCLES_AMOUNT="${3:-10t}"

echo "==> Transferring $ICP_AMOUNT ICP to $PRINCIPAL"
icp token transfer "$ICP_AMOUNT" "$PRINCIPAL"

echo "==> Transferring $CYCLES_AMOUNT cycles to $PRINCIPAL"
icp cycles transfer "$CYCLES_AMOUNT" "$PRINCIPAL"

echo
echo "==> Recipient balances:"
icp token balance --of-principal "$PRINCIPAL"
icp cycles balance --of-principal "$PRINCIPAL"
