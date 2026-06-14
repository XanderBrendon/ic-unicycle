#!/usr/bin/env bash
#
# Seed the local cmc stub (US30) so the direct-mint saga can pay out: top up
# 200T raw cycles. The stub's `notify_top_up` mints by attaching cycles from its
# own balance via the management canister's `deposit_cycles`, so without a raw
# cycle balance every mint would fail with a deposit_cycles error.
#
# Unlike the icpswap stub, the cmc stub holds no TCYCLES — it mints raw cycles
# straight into the backend, which re-wraps them as TCYCLES itself. So this only
# needs a cycle top-up, no `bootstrapTcycles`.
#
# Idempotent — repeated runs accumulate more cycles, which is benign. Run once
# after `icp deploy` on a fresh local network.
#
# Usage:
#   devscripts/seed-cmc-stub.sh
set -euo pipefail

icp canister top-up --amount 200t cmc >/dev/null
echo "cmc seeded: +200T cycles"
