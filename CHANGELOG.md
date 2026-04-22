# Changelog

All notable changes to `@stoachain/ouronet-core`.

## 1.1.0 — 2026-04-22

**Tier 2 testing pass.** 18 new tests across 2 files (one extension + one new). 286 total pass (was 268). No source changes — tests exercise existing code paths that weren't previously covered. See `OuronetUI/docs/TESTING_STRATEGY.md` §Tier 2.

### Added

- **`tests/strategy.test.ts` extended** — 6 new edge-case tests:
  - Foreign key synthesis via `resolvedForeignKeys` (ForeignKeySignModal flow)
  - Tx with unsigned slot for a foreign pub when no resolvedForeignKeys supplied — documents that strategy doesn't police guard satisfaction; chain-level rejection is the user-visible failure mode
  - `resolver.requestForeignKey` invocation path + error propagation
  - Impossible case: only codex key is also payment key AND guard key → throw
  - Resolver throw (HD derivation fail, password cancelled) propagates up execute()
  - Multi-guard: 2-of-3 patron + 1-of-1 resident → caps correctly picks the one free codex key
  - Keyset-ref guards flow through without surprise
- **`tests/encryption-upgrade.test.ts`** NEW — 12 tests for the V1 → V2 upgrade-on-unlock flow:
  - Happy path: V1 blob decrypts → re-encrypt with schemaVersion=1 → V2 blob → decrypts back to same plaintext
  - Idempotent: re-running upgrade on a V2 blob leaves it V2
  - schemaVersion-null/0 → V1 blob (fail-safe pre-upgrade behaviour)
  - Mixed-codex state: some V1 + some V2 blobs all decrypt via `smartDecrypt`
  - Wrong-password rejection for both V1 and V2 (no silent V2-fallback slip)
  - `isCodexUpgraded` ↔ `smartEncrypt` contract across null/0/1/2/99/garbage inputs
  - Password-change-during-upgrade: new password decrypts, old password fails
  - `decryptStringV2` V1-fallback path (belt-and-suspenders)
  - Full-codex simulation: 5 entries (wallet + account + pure keypair fields), all round-trip through the upgrade pipeline

### No changes

- Source. These are pure test additions.

## 1.0.0 — 2026-04-22

**Extraction complete.** Symbolic bump to 1.0.0 to mark the end of the OuronetUI → OuronetCore migration. Every piece of blockchain logic that used to live in OuronetUI (Pact builders, signing pipeline, encryption, guard analysis, gas calibration, codex codec, seed-type migration) now lives here. OuronetUI is a pure consumer. No API changes from 0.11.0 — strict semver would call this 0.11.1, but the bump signals "this is the public surface we commit to and will semver against going forward."

### Documentation

- `README.md` — rewritten. Status now "extraction complete", not "skeleton only". Submodule table reflects current exports (including the 14 `buildXxxPactCode` builders added in 0.11.0). Cross-links to OuronetUI's TESTING_STRATEGY + CFM_BUILD_GUIDE. Documents the `npm link` local-dev flow and the tag-push publish workflow.

### What 1.0.0 commits to

- Public API: the 10 subpath exports listed in `package.json` (`/constants`, `/network`, `/gas`, `/guard`, `/crypto`, `/signing`, `/codex`, `/reads`, `/pact`, `/interactions`). Removing or renaming anything exported at the top level of any of these = major version bump.
- Codex export format: `"version": "1.2"` is stable — existing `OuronetCodex_*.json` files users have on disk must stay importable forever.
- Signing strategy contract: `CodexSigningStrategy.execute({ build, guards, paymentKey?, resolvedForeignKeys?, extraSigners? })` is the stable shape.

## 0.11.0 — 2026-04-22

**Tier 1 testing pass.** Extracts the per-modal Pact-code builders into a pure module and adds 75 tests across 4 new/extended test files. All 268 tests pass (was 193). See `OuronetUI/docs/TESTING_STRATEGY.md` for the testing strategy rationale.

### Added

- **`@stoachain/ouronet-core/pact/cfmBuilders`** — 14 pure Pact-code string builders, one per CFM function the ecosystem ships: `buildTransferPactCode`, `buildClearDispoPactCode`, `buildSublimatePactCode`, `buildCompressPactCode`, `buildCoilPactCode`, `buildCurlPactCode`, `buildBrumatePactCode`, `buildConstrictPactCode`, `buildColdRecoveryPactCode`, `buildDirectRecoveryPactCode`, `buildCullPactCode`, `buildAwakePactCode`, `buildSlumberPactCode`, `buildFirestarterPactCode`. Replaces the inline template literals that used to live in OuronetUI's 23 CFM modals. Each builder takes a typed params object and returns the canonical Pact-code string.
- **`tests/cfm-builders.test.ts`** — 35 tests. One per builder + argument-order preservation + decimal formatting + edge cases (empty nonce list, single-item list, dayz as integer not decimal, etc). Cross-cutting "every builder produces `(ouronet-ns...)` shape" test for forward-compat.
- **`tests/codex-codec.test.ts`** — 31 tests covering `buildCodexExport` / `serializeCodex` / `deserializeCodex` / `migrateSeedType`. Round-trip + version-mismatch rejection + unicode preservation + idempotent seed-type migration.
- **`tests/strategy.test.ts`** — 9 tests for `CodexSigningStrategy.execute()` + `sign()`. Uses mock `PactClient` + mock `KeyResolver` with real Ed25519 nacl signing (RFC 8032 test vectors for keypairs). Verifies call-order (simulate → submit), gas calibration flows through, sim-failure halts pipeline, guard keypair dedup, `extraSigners` folded into sign step.

### Changed

- `tests/guard.test.ts` — extended with multi-guard scenarios (patron+resident cooperating) and keyset-ref guard edge cases. The pattern every CFM modal runs internally but that wasn't directly covered before.

### Migration notes

- `@stoachain/ouronet-core/pact` now also exports the 14 `buildXPactCode` functions. Existing imports of `formatDecimalForPact`, `safeCreationTime`, `filterFreePositionData`, `mayComeWithDeimal`, `parseEU`, `formatEU` all still work.
- No breaking change — pure additions.

## 0.10.0 — 2026-04-22

**Phase 4 of the OuronetUI → OuronetCore extraction.** Moves encryption primitives + introduces portable Codex types + the backup-JSON codec. Pure additions — no existing export changes.

### Added

- **`@stoachain/ouronet-core/crypto`** — migrated wholesale from OuronetUI's `src/lib/encryptor.ts` + `src/lib/encryptorV2.ts`. Both V1 (PBKDF2-SHA256 10k) and V2 (PBKDF2-SHA512 600k) primitives, plus `smartDecrypt` auto-format-detection + `smartEncrypt` (now pure — takes `schemaVersion: string | null` as an argument instead of reading `localStorage.codex_schema_version`). Works in browser + Node.js.
- **`@stoachain/ouronet-core/codex`** — portable Codex shape + codec:
  - `PlaintextCodex<KS, OA, PK, AB, UI>` — generic in-memory shape. Default type params are `unknown`; consumers (OuronetUI, future HUB) plug in their own wallet/account/keypair types. Fields: kadenaWallets, ouronetWallets, addressBook, pureKeypairs, uiSettings, schemaVersion, lastUpdatedAt, lastUpdatedDevice.
  - `CodexExportV1_2<KS, OA, AB, UI>` — the `"version": "1.2"` backup-JSON shape OuronetUI has been writing since early 2025. Intentionally preserved byte-for-byte: existing `OuronetCodex_*.json` files stay valid.
  - `buildCodexExport(codex)` + `serializeCodex(codex)` (stringify with 2-space indent) + `deserializeCodex(json)` (throws on version mismatch — fail-fast before mis-decoding a hypothetical future V2).
  - `migrateSeedType(rawType)` + `SeedType`/`RawSeedType` types — the historical `legacy → chainweaver`, `new → koala` mapping. Was inlined in OuronetUI's WalletStorage; lives here now so HUB doesn't rediscover it. Idempotent.
- 31 new encryption tests moved to `tests/encryption.test.ts` (from OuronetUI's `src/lib/__tests__/encryption.test.ts`). Covers V1/V2 round-trips, wrong-password, envelope shape, smartDecrypt mixed-format, isCodexUpgraded predicate, smartEncrypt schema-version dispatch. **193 tests total pass** (was 162).

### Migration notes

- `smartEncrypt` API changed: now `smartEncrypt(plaintext, password, schemaVersion)` instead of the browser-only `smartEncrypt(plaintext, password)`. OuronetUI keeps a tiny `src/lib/smart-encrypt-browser.ts` wrapper that reads `localStorage.codex_schema_version` and delegates here — no behaviour change for UI consumers.
- Existing codex blobs decrypt identically — no on-disk format change.

## 0.9.1 — 2026-04-22

**Phase 3b cleanup.** Deletes 15 now-unused `executeX` helpers from `interactions/wrapFunctions.ts` and re-tightens `tsconfig.json` (`noUnusedLocals` + `noUnusedParameters` back on, were relaxed during the 3a/3b scaffolding).

### Removed

- `executeFirestarter`, `executeSublimate`, `executeCompress`, `executeTransferToken`, `executeCoil`, `executeCurl`, `executeBrumate`, `executeConstrict`, `executeColdRecovery`, `executeDirectRecovery`, `executeCull`, `buildNativeTransferTx`, `executeAwake`, `executeSlumber`, `executeClearDispo` — every last CFM modal in OuronetUI (v0.29.7c) moved to `strategy.execute()`, so these direct-path helpers have no remaining callers. Kept: `executeWrapStoa` + `executeWrapUrStoa` (still used by the two Wrap* modals, which aren't CFM modals).

### Changed

- `tsconfig.json`: `noUnusedLocals: true`, `noUnusedParameters: true` — both were off during 3a/3b to let scaffolding compile with in-flight unused symbols. Back on, with a handful of leftover unused imports (`NATIVE_TOKEN_VAULT`, `IKeyset`, a couple of dev-local variables) cleaned up.

### Migration

Consumers that still imported these helpers will fail to resolve — if you're one of those, switch to `CodexSigningStrategy` via `new CodexSigningStrategy(resolver, client)` + `strategy.execute({...})` (see codexStrategy.ts docstring).

## 0.9.0 — 2026-04-22

**Phase 3b.2 Wave 4 support.** Small SigningStrategy API addition — adds `extraSigners?: IKadenaKeypair[]` to `execute()` so flows with more than two signer roles (like Firestarter, which needs GAS_PAYER + payment-key with `coin.TRANSFER` cap + account guards) can plug in. No breaking change: existing consumers pass nothing and behave exactly as before.

### Added

- `SigningStrategy.execute({ extraSigners? })` — optional array of pre-resolved `IKadenaKeypair`s. The strategy folds them into the sign step alongside the guard keypairs (deduplicated by pubkey). Used by OuronetUI's `FirestarterCFMModal` to supply the payment-key signer whose `coin.TRANSFER` cap the build closure wires explicitly via `addSigner`.

## 0.8.0 — 2026-04-22

**Phase 3b.2 Wave 1 support.** Pure addition — exposes `safeCreationTime()` from `@stoachain/ouronet-core/pact` so CFM modals in OuronetUI can mint `creationTime` values the same way every core `execute*` helper already does (Pact `setMeta`'s creationTime − 30s to sidestep node clock-skew rejections). No behavior changes to existing exports.

### Added

- `safeCreationTime(): number` — shared `Math.floor(Date.now()/1000) - 30` helper. Used by the CFM modals' `strategy.execute({ build })` closures so their `setMeta({creationTime})` matches what the A-F pipeline has always done. Keeps sim + submit consistent across every modal.

## 0.7.0 — 2026-04-22

**Phase 3b.1 of the OuronetUI → OuronetCore extraction.** Ships `CodexSigningStrategy` — the first real `SigningStrategy` implementation. The 23 CFM modals in OuronetUI can now delete their ~43-line `handleExecute` A-F pipeline in favor of a ~30-line `strategy.execute({...})` call. Done one modal at a time with smoke-testing between each; `CompressCFMModal` is the first consumer (see OuronetUI v0.29.6).

### Added

- **`@stoachain/ouronet-core/signing/CodexSigningStrategy`** — implements the full pipeline:
  1. Get codex pub set from resolver
  2. `analyzeGuard` each guard (with any caller-provided resolvedForeignKeys)
  3. Resolve keypairs via `resolver.getKeyPairByPublicKey` (or synthesize inline for resolved-foreign keys)
  4. `selectCapsSigningKey` for GAS_PAYER avoiding pure-signer overlap
  5. Build via caller closure (given the resolved pubkeys)
  6. `client.dirtyRead` to simulate → fail-fast
  7. `calculateAutoGasLimit` on measured gas
  8. Rebuild with real gas
  9. `universalSignTransaction` with deduped keypairs
  10. `client.submit` → return `{requestKey, raw}`
- `.execute(...)` for the full pipeline; `.sign(...)` as a lower-level primitive for callers that own their simulation flow.

### Changed

- `SigningStrategy.execute`'s `build` closure signature widened: now receives `{gasLimit, capsKeyPub, guardPubs}` instead of just `gasLimit`. Necessary because Pact.builder's `addSigner` calls need the pubkeys at simulation time (cap-requiring modules reject sims with missing capability signers).

### Migration semantics

Resolved-foreign-keys handling: when a guard-signer pubkey is in the caller's `resolvedForeignKeys` map (user pasted a raw priv via `ForeignKeySignModal` or equivalent), the strategy synthesizes `{publicKey: pub, privateKey, seedType: "foreign"}` inline rather than asking the resolver — the resolver never knew about it. Codex keys still go through the resolver which handles password prompts + HD derivation.

## 0.6.0 — 2026-04-22

**Phase 3a of the OuronetUI → OuronetCore extraction.** Pure scaffolding release — introduces the signing abstractions Phase 3b will wire up and collapse the 23 CFM `handleExecute` duplicates against.

### Added

- **`@stoachain/ouronet-core/signing/types`** — three interfaces grounded in the research pass (`docs/EXTRACT_OURONET_CORE_PLAN.md §2.2` in the OuronetUI repo):
  - **`IKadenaKeypair`** — canonical home for the keypair shape. Same structure ouroFunctions has been exporting since Phase 2b; this version is the authoritative one going forward. Both paths compile because the shape is identical.
  - **`KeyResolver`** — the three-method contract (`listCodexPubs`, `getKeyPairByPublicKey`, optional `requestForeignKey`) each consumer implements against their own Codex backend. OuronetUI: `ReduxCodexResolver` (Redux + wallet-context). HUB: future `FileCodexResolver` (disk file + env/KMS passphrase). CLI: `readline`. Etc.
  - **`PactClient`** — minimal `dirtyRead` + `submit` subset of `@kadena/client`'s `createClient` return. Strategies accept one so the URL isn't baked into core (browser needs the CF-worker proxy; server hits Stoa directly).
  - **`SigningStrategy`** — the `execute(...)` + `sign(...)` pipeline interface. Still unimplemented in this release; `CodexSigningStrategy` lands in Phase 3b.

### Changed

Nothing — this is additive scaffolding. Every existing import path keeps working unchanged; every runtime behavior is identical to v0.5.0.

### Tests

Still 162 — the new interfaces are compile-time only and have no runtime until Phase 3b wires an implementation. On-chain acceptance for the whole signing surface runs at the end of 3b (9-item real-wallet matrix).

## 0.5.0 — 2026-04-22

**Phase 2c of the OuronetUI → OuronetCore extraction.** HD keypair derivation + runtime wallet class move to core; `CodexStorageAdapter` interface defined so browser + server consumers each implement their own storage backend.

### Added

- **`@stoachain/ouronet-core/wallet/KadenaWalletBuilder`** — HD keypair derivation + mnemonic generation/validation. Two paths: `koala` (24-word BIP39 + SLIP-10 Ed25519) and `chainweaver`/`eckowallet` (12-word Kadena mnemonic + BIP32-Ed25519). Plus `encrypt`/`decrypt` wrapping `@kadena/hd-wallet`'s AES-GCM primitive (distinct from core/crypto's Codex-level encryption — this is the inner per-seed wrapper).
- **`@stoachain/ouronet-core/wallet/KadenaWallet`** — runtime account class with `address`, `publicKey`, `derivationPath`, and lazy `getBalance()`. Pure data holder + one async chain read.
- **`@stoachain/ouronet-core/wallet/SeedType`** — `"koala" | "chainweaver" | "eckowallet"`. Picks the derivation algorithm; NOT a delegation marker (no browser-wallet integration is wired).
- **`@stoachain/ouronet-core/wallet/CodexStorageAdapter`** — interface only. Two methods: `load()`, `save(codex)`, `clear()`. Concrete implementations live in each consumer: OuronetUI ships `LocalStorageCodexAdapter` (backed by localStorage + redux-persist); the HUB will ship `EncryptedFileCodexAdapter` (AES-GCM file on disk). Core intentionally provides no default — each runtime brings its own.

### Why no default adapter in core

Different runtimes have fundamentally different idioms: Redux action-dispatch (browser) vs direct-mutation-then-write (server) vs async-backend (future). Trying to force them through one shared state machine gains nothing; the interface is the minimal contract. Phase 4's `PlaintextCodex` type will concrete-type the payload both adapters persist.

### Tests

Still 162 — the wallet code is integration-level (needs real @kadena/hd-wallet WASM + a mnemonic); unit-testing would mostly exercise the library. Phase 3b's on-chain checklist covers HD-derivation end-to-end.

## 0.4.1 — 2026-04-22

**Phase 2b refinement.** Adds a pluggable Pact reader so consumers can wire their own cache-aware implementation, restoring the read behavior OuronetUI had before Phase 2b. Caught via a Smart Swap UI flicker bug: after v0.4.0, every dex read inside `interactions/*` went through `rawCalibratedDirtyRead` — no cache, no dedup — so a widget that fires reads per-keystroke (Smart Swap's token selector) flickered and couldn't finalize a selection.

### Added

- **`@stoachain/ouronet-core/reads`** — new `setPactReader(reader)` + `getPactReader()` + `pactRead(pactCode, options)`. Interactions now call `pactRead` instead of `rawCalibratedDirtyRead` directly; the default is `rawCalibratedDirtyRead` (so HUB / server consumers see no change), but OuronetUI calls `setPactReader(calibratedDirtyRead)` at boot and its cache-aware wrapper takes over.

### Changed

- Every `rawCalibratedDirtyRead(...)` call inside `src/interactions/*` rewritten to `pactRead(...)`. Behavior identical when no reader is configured (default is still raw); behavior cache-aware when a consumer configures one.

### Why

Phase 2b's sed swapped `calibratedDirtyRead` → `rawCalibratedDirtyRead` blanket across all moved interactions. That was too aggressive — the intent was "simulations shouldn't be cached" (one-shot reads before signing), but the same swap also touched routine display reads inside `interactions/*` (`getPoolTotalFee`, `getSwpairs`, `getSWPairGeneralInfo`, etc.). These need cache dedup because UI widgets call them repeatedly as users interact. Pluggable reader keeps both worlds clean: raw by default, cached on request.

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
