# Unicycle

A cycle service for purchasing cycles and automating top-ups of canisters on the Internet Computer, with SNS customers as a first-class citizen.

See [`planning/ObsidianVault/_Unicycle Overview.md`](planning/ObsidianVault/_Unicycle%20Overview.md) for the product overview and design notes. The `planning/` directory is a private git submodule; its contents are only available to collaborators with access.

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22.13 (pnpm ≥ 11 requires it)
- [pnpm](https://pnpm.io/) — enable via `corepack enable pnpm`
- [icp-cli](https://cli.internetcomputer.org/) and [ic-wasm](https://github.com/dfinity/ic-wasm) — `npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm`
- [ic-mops](https://mops.one/) — `npm install -g ic-mops`

This project uses `icp` (icp-cli), not `dfx` — the CLIs are not flag-compatible. Prefer `@icp-sdk/*` packages for direct dependencies; `@dfinity/*` packages are fine when they're the only option (for example, as a peer dep of an `@icp-sdk/*` package).

## Local development

```bash
pnpm install                              # install frontend deps and generate Candid bindings
icp network start -d                      # start the local replica with Internet Identity enabled
icp deploy                                # build, deploy, and sync all canisters locally
devscripts/seed-icpswap-stub.sh           # fund the US12 saga test fixture (+200T cycles, +100T TCYCLES)
```

The local Internet Identity frontend is served at `http://id.ai.localhost:8000` once the network is up. The local replica auto-deploys the canonical ICP ledger (`ryjl3-tyaaa-aaaaa-aaaba-cai`) and cycles ledger (`um5iw-rqaaa-aaaaq-qaaba-cai`) as system canisters — the wallet panel talks to those directly with the same IDs locally and on mainnet. Use `icp token transfer` and `icp cycles mint` to seed your local identity with balances.

### Init-args and local canister IDs

`icp.yaml` encodes the `unicycle_backend` and `balance_checker` init-args inline as candid strings, referencing the local canister IDs that icp-cli's managed network allocates on first deploy. Those IDs are deterministic for a given allocation order, so a fresh `icp deploy` should produce a match against the principals already in `icp.yaml`. If `icp canister id unicycle_backend / balance_checker / icpswap_pool` ever disagrees with what's in the file, copy the values from `.icp/cache/mappings/local.ids.json` into the three `init_args` lines in `icp.yaml` and redeploy once.

## Mainnet deployment

```bash
icp identity default <your-identity>   # confirm you're not using the anonymous identity
icp deploy -e ic                       # deploy to the `ic` environment (mainnet)
```

## Project layout

```
/
├── icp.yaml                 # canister + network configuration
├── mops.toml                # Motoko toolchain + dependencies
├── package.json             # frontend deps + scripts
├── .icp/data/               # canister ID mappings (committed)
└── src/
    ├── unicycle_backend/    # Motoko canister
    └── unicycle_frontend/   # React + Vite + TypeScript app
```
