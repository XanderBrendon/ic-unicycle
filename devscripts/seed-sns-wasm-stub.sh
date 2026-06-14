#!/usr/bin/env bash
#
# Seed the local sns_wasm stub with one governance→root SNS mapping so the
# backend's `resolveSnsRoot` recognizes a caller as an SNS governance canister
# and keys its deposits / tracking to the given root. The stub's `addSns`
# helper appends to an in-memory list; the backend rebuilds its cache from
# `list_deployed_snses` on a cache miss (or the startup timer).
#
# Idempotent in effect — re-adding the same governance principal just overwrites
# its root. Run after `icp deploy` on a fresh local network.
#
# Usage:
#   devscripts/seed-sns-wasm-stub.sh <governance-pid> <root-pid>
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <governance-pid> <root-pid>" >&2
  exit 1
fi

governance="$1"
root="$2"

icp canister call sns_wasm addSns "(principal \"$governance\", principal \"$root\")" >/dev/null
echo "sns_wasm seeded: governance $governance -> root $root"
