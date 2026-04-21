# @stoachain/ouronet-core

Shared TypeScript core for the OuroNet ecosystem — StoaChain™ / Chainweb / Pact interactions, Codex signing, guard analysis, encryption. Consumed by **OuronetUI** (browser SPA) and the **AncientHolder HUB** (Node.js server).

## Status

`0.0.1-alpha.0` — **skeleton only.** The package exists; every submodule is an empty barrel. Code migrates in from OuronetUI over Phases 1–4 of the extraction plan.

## Design docs

The architectural plan, per-phase migration steps, handoff for the HUB, and decision log all live in the **OuronetUI repo** under `docs/`:

- [`ANCIENTHOLDER_HUB_HANDOFF.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/ANCIENTHOLDER_HUB_HANDOFF.md) — what the HUB agent needs to know to integrate
- [`EXTRACT_OURONET_CORE_PLAN.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/EXTRACT_OURONET_CORE_PLAN.md) — comprehensive 8-phase migration plan

Don't fork logic — add to core, version-bump, publish, and consumers upgrade deliberately.

## Submodules

Each is a subpath export of the package: `import { ... } from "@stoachain/ouronet-core/<submodule>"`.

| Path | Contains |
|---|---|
| `@stoachain/ouronet-core/constants` | `KADENA_NAMESPACE`, `KADENA_CHAIN_ID`, `KADENA_NETWORK`, gas-station addresses, token-id constants |
| `@stoachain/ouronet-core/network` | Node failover (node2 → node1), URL construction |
| `@stoachain/ouronet-core/gas` | `calculateAutoGasLimit`, `formatDecimalForPact`, ANU/STOA math |
| `@stoachain/ouronet-core/guard` | `analyzeGuard`, `buildCodexPubSet`, `selectCapsSigningKey`, `computeThreshold` (all predicates including stoa-ns.stoic-predicates.*) |
| `@stoachain/ouronet-core/crypto` | V2 AES-GCM-256 / PBKDF2-SHA512-600k + V1 legacy decrypt + `smartDecrypt` |
| `@stoachain/ouronet-core/signing` | `KeyResolver` / `SigningStrategy` interfaces, `CodexSigningStrategy`, signing primitives |
| `@stoachain/ouronet-core/wallet` | `KadenaWallet`, `KadenaWalletBuilder` (HD derivation), `CodexStorageAdapter` interface |
| `@stoachain/ouronet-core/codex` | `PlaintextCodex` type, serialization codec, seed-type migration |
| `@stoachain/ouronet-core/reads` | `rawCalibratedDirtyRead` (pure Pact read with node failover; no cache) |
| `@stoachain/ouronet-core/interactions` | Pact builders: `executeCoil`, `executeCurl`, `executeSwap`, etc. |

## Local development

This repo is consumed by OuronetUI via a `file:` dependency during Phases 1–4 — `npm install` in OuronetUI runs this package's `prepare` script to build `dist/`.

```bash
npm install
npm run build        # tsc -p tsconfig.build.json → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest run (Node environment)
```

## Versioning

Strict semver. Breaking changes → major version bump → consumers upgrade deliberately. Changelog in `CHANGELOG.md`.

## License

UNLICENSED (private package). Access restricted to the StoaChain org.
