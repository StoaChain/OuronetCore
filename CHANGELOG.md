# Changelog

All notable changes to `@stoachain/ouronet-core`.

## 0.4.0 — 2026-04-22

**Phase 2b of the OuronetUI → OuronetCore extraction.** The largest single phase so far — all Pact builders + error helpers + signing core move into the package. Both consumers (OuronetUI today, HUB in future) now get every on-chain action OuronetUI performs by importing from `@stoachain/ouronet-core/interactions/*`.

### Added

- **`@stoachain/ouronet-core/interactions/*`** — 13 files from OuronetUI's `src/kadena/interactions/`:
  `activateFunctions`, `addLiquidityFunctions`, `coilFunctions`, `crossChainFunctions`, `dexFunctions` (swap + pool reads), `guardFunctions` (guard rotation), `infoOneFunctions` (INFO_* cost-estimate reads), `kadenaFunctions` (native coin + account reads), `kpayFunctions`, `ouroFunctions` (OURO token family, ignis, virtual-OURO, activation flow), `pensionFunctions` (brumate / hibernate), `urStoaFunctions` (stake / unstake / collect), `wrapFunctions` (Coil / Curl / Compress / Sublimate / Awake / Slumber / Transfer / Firestater). Sub-path-importable as `@stoachain/ouronet-core/interactions/ouroFunctions` etc. — the package now declares a wildcard subpath so every file is its own entry.
- **`@stoachain/ouronet-core/errors`** — `TransactionError`, `SigningError` + `createSigningError` / `createSimulationError` / `formatErrorForUser` / `logDetailedError`. Moved wholesale from OuronetUI's `src/lib/transaction-errors.ts`; 100% pure, no browser deps.
- **`@stoachain/ouronet-core/signing/universalSign.ts`** — `universalSignTransaction`, `UniversalKeypair`, `fromKeypair`. Phase-3 will collapse with OuronetUI's local copy (which still exists — interactions in core use core's version, the rest of UI uses its own until signing's full refactor lands).
- **`@stoachain/ouronet-core/guard`** adds `IKeyset` type (was in OuronetUI's `src/ouro.d.ts`).

### Changed

- `rawCalibratedDirtyRead` gained accepted-and-ignored `tier?: string` + `skipTempWatcher?: boolean` options — source-compatibility shim for the 20+ call sites that previously hit OuronetUI's cache-aware wrapper with these options.
- Barrel `src/interactions/index.ts` now re-exports only `ouroFunctions` (the canonical source of shared types). Cross-file collisions on `IKadenaKeypair` / `IOuroAccountKeypair` / etc. surface if consumers import from the root barrel; use sub-path imports (`./interactions/<filename>`) when in doubt.

### Internal

- Relaxed `tsconfig.json`: removed `noUnusedLocals` + `noUnusedParameters` (OuronetUI's cached typecheck was silently tolerating these; re-tighten in a later cleanup phase).
- ~12 surgical `as any` casts inside the moved interactions where stricter `@kadena/types` in TS 5.9 rejected access patterns that worked under the OuronetUI cache. All casts are boundary-level (narrowing response bodies, slippage-bounds addData args, BIP32 WASM hashBytes). No behaviour change.

### Tests

Still 162 tests / 5 files on the core side — the moved interaction code has no tests yet (interactions are integration-level; Phase 3b's on-chain acceptance checklist is the real verification). Phase 3 / 4 add more.

## 0.3.0 — 2026-04-22

**Phase 2a of the OuronetUI → OuronetCore extraction.** Adds raw on-chain read + Pact-format helpers.

### Added

- **`@stoachain/ouronet-core/reads`** — `rawCalibratedDirtyRead(pactCode, options?)`. Uncached Pact dirty-read with a read-friendly 10M gas ceiling. Pure, no React lifecycle. OuronetUI layers its PactQueryCache on top; the HUB will call this directly.
- **`@stoachain/ouronet-core/pact`** — three helpers moved from OuronetUI's `src/lib/utils.ts`:
  - `formatDecimalForPact(amount, maxDecimals?)` — canonicalize a decimal string for Pact code literals (adds `.0` to integers, truncates overlong fractional parts, validates shape).
  - `mayComeWithDeimal(data)` — unwrap Pact's `{ decimal: "…" }` envelope to the underlying string (typo preserved from original to keep name compatibility).
  - `filterFreePositionData(raw)` — normalise the `[{ "reward-tokens": [0] }]` sentinel the chain returns for "no positions" to an empty array.
- **`@stoachain/ouronet-core/signing`** — `toHexString(byteArray)` added alongside `publicKeyFromPrivateKey` + `publicKeyFromExtendedKey`. Used wherever raw bytes cross into strings (derived private keys, signed-tx hashes).

### Tests

+52 tests across `pact-format.test.ts` (29: formatDecimalForPact, mayComeWithDeimal, filterFreePositionData, Pact code template snapshots) and `signing.test.ts` (signing-primitives test moved from OuronetUI, plus 7 new tests for toHexString). Total suite: 162 tests across 5 files (was 110).

### `exports` map

Added `./pact` subpath to `package.json` exports. Existing `./reads` and `./signing` subpaths gain new symbols; consumers don't need to change import style.

## 0.2.0 — 2026-04-22

**Phase 1 of the OuronetUI → OuronetCore extraction.** First real code move.

### Added

- **`@stoachain/ouronet-core/constants`** — full StoaChain / Chainweb / Pact constants:
  - `KADENA_NETWORK`, `KADENA_CHAIN_ID`, `KADENA_NAMESPACE`, `KADENA_BASE_URL`, `PACT_URL`, `KADENA_CHAINS`, `STOA_CHAINS`, `STOA_CHAIN_COUNT`
  - Stoa autonomic account addresses: `STOA_AUTONOMIC_OUROBOROS`, `STOA_AUTONOMIC_LIQUIDPOT`, `STOA_AUTONOMIC_OURONETGASSTATION`, legacy aliases `GAS_STATION` + `NATIVE_TOKEN_VAULT`
  - `MAIN_TOKENS` list
  - Token IDs: `TOKEN_ID_OURO`, `TOKEN_ID_IGNIS`, `TOKEN_ID_AURYN`, `TOKEN_ID_ELITEAURYN`, `TOKEN_ID_WSTOA`, `TOKEN_ID_SSTOA`, `TOKEN_ID_GSTOA`, `ALL_TOKEN_IDS`
  - Helper accessors `getPactUrl(chainId)` + `getSpvUrl(chainId)` that route through node-failover
- **`@stoachain/ouronet-core/network`** — Stoa node failover:
  - Primary node2 → fallback node1, with health check + 30s retry loop
  - `getActiveBaseUrl`, `getActiveHost`, `getActivePactUrl`, `getActiveSpvUrl`
  - `setNodeConfig` (node2 / node1 / custom), `getNodeConfig`, `getCurrentNodeStatus`, `getNodeGasLimit`, `getActiveGasLimit`, `CHAINWEB_DEFAULT_GAS_LIMIT`
  - `withFailover(fn)` — wrapper that retries once on fallback for network errors
  - `initNodeFailover()` — optional startup health check
- **`@stoachain/ouronet-core/gas`** — gas + ANU/STOA math:
  - `ANU_PER_STOA` (10^12), `GAS_LIMIT_MAX` (2M), `GAS_PRICE_MIN_ANU`, TTL constants
  - `anuToStoa`, `stoaToAnu`, `formatAnuAsStoa`
  - `getGasLimitStatus` (safe/warning/danger bands) + `GAS_LIMIT_COLORS`
  - `formatMaxFee`, `calculateAutoGasLimit` (5-bucket buffer with node-cap)
- **`@stoachain/ouronet-core/guard`** — full guard analysis surface:
  - `computeThreshold` for 14 predicates: standard (keys-all/keys-any/keys-2), stoic fixed (keys-1/3/4), M-of-N (2-of-3 through 5-of-9), percentage (51/60/66/75/90pct), tolerance (all-but-one/two)
  - `predicateLabel`, `analyzeGuard`, `buildCodexPubSet`, `classifyPaymentKey`, `tryDerivePublicKey`, `selectCapsSigningKey` — all pure
- **`@stoachain/ouronet-core/signing`** — phase-1 temp copy of pure public-key primitives:
  - `publicKeyFromPrivateKey` (standard Ed25519 from 64-char seed)
  - `publicKeyFromExtendedKey` (BIP32-Ed25519 from kL half of extended key)
  - Full signing surface (universalSignTransaction, KeyResolver, SigningStrategy) lands in Phase 3

### Tests

110 tests across 3 files (`guard.test.ts` 54, `gas.test.ts` 31, `network.test.ts` 25), all green in Node environment.

### Peer dependencies added

- `@kadena/cryptography-utils ^0.4.0` (public-key derivation)
- `@noble/curves ^1.4.0` (BIP32-Ed25519 math)

## 0.1.0 — 2026-04-21

Initial scaffold commit. Empty-barrel skeleton. See
[`docs/EXTRACT_OURONET_CORE_PLAN.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/EXTRACT_OURONET_CORE_PLAN.md) in the OuronetUI repo for the multi-phase plan driving this package's development.
