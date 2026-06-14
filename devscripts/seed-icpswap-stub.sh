#!/usr/bin/env bash
#
# Seed the local icpswap_pool stub so the US12 saga can pay out post-swap:
# top up 200T raw cycles and mint 100T of them into TCYCLES via the stub's
# bootstrapTcycles helper. The stub's `withdrawToSubaccount` performs a real
# ICRC-1 transfer from its own account, so without a TCYCLES balance every
# successful saga would fall into the stuck-funds path.
#
# Idempotent — repeated runs accumulate more cycles + TCYCLES, which is
# benign. Run once after `icp deploy` on a fresh local network.
#
# Usage:
#   devscripts/seed-icpswap-stub.sh
set -euo pipefail

icp canister top-up --amount 200t icpswap_pool >/dev/null
icp canister call icpswap_pool bootstrapTcycles '(100000000000000)' >/dev/null
echo "icpswap_pool seeded: +200T cycles, +100T TCYCLES"
