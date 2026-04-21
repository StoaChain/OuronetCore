# Changelog

All notable changes to `@stoachain/ouronet-core`.

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
