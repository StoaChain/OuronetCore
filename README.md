# @stoachain/ouronet-core

Shared TypeScript core for the OuroNet ecosystem — StoaChain™ / Chainweb /
Pact interactions, Codex signing, guard analysis, encryption. Consumed by
**OuronetUI** (browser SPA) and the **AncientHolder HUB** (Node.js server).

## Status

**`1.6.0` on public npmjs** — extraction complete + DALOS cryptography
integration + Smart-account metadata in the batched selector + historical
primitives surfaced + Smart-account auth-path resolution primitives.

Every piece of blockchain logic that used to live in OuronetUI has
landed here: Pact builders, signing pipeline (CodexSigningStrategy +
universalSignTransaction), encryption (V1 + V2 + smartDecrypt), guard
analysis, gas calibration, codex codec, seed-type migration. OuronetUI
is now a pure consumer.

Since **v1.3.0**, OuronetCore integrates
**[`@stoachain/dalos-crypto@^1.2.0`](https://www.npmjs.com/package/@stoachain/dalos-crypto)**
via a new `./dalos` subpath — consumers mint Ouronet accounts locally
(all six DALOS input modes: random, bitmap, bitstring, base-10,
base-49, seed words) without touching the retired
`go.ouronetwork.io/api/generate` endpoint.

**v1.4.0** extends the `AccountSelectorData` type returned by the
batched `URC_0027_AccountSelectorMapper` to include `public-key`,
`sovereign`, and `governor` — the three fields the on-chain mapper
started returning to support Smart Ouronet Account display (Σ. prefix
accounts with sovereign + governor authorisation paths).

**v1.5.0** re-exports the new `Leto` / `Artemis` / `Apollo`
historical-curve primitives (v1.2.0 of dalos-crypto) through the
`./dalos` subpath, plus the `createGen1Primitive` factory and
`AddressPrefixPair` type. These are **NOT** registered in
`createDefaultRegistry()` — Ouronet continues to use DALOS Genesis
exclusively; the re-exports exist so consumers who need the
historical primitives can reach them without adding a direct
dependency on dalos-crypto.

**v1.6.0** lands the first batch of Smart Ouronet Account auth-path
primitives. Smart accounts (Σ. prefix) authorise mutations via
`enforce-one` over THREE branches (account guard, sovereign account
guard, governor) — any one branch satisfying its predicate authorises
the transaction. Standard accounts (Ѻ.) still use a single keyset.
The new `/guard` exports (`classifyGuardKind`, `extractKeysetFromGuard`,
`analyzeSmartAccountAuthPaths`) let consumers discriminate the four
guard shapes (keyset / keyset-ref / capability / user) and produce a
ready-to-render summary of which branches are signable by the codex.
A new `buildRotateSovereignPactCode` builder lands the first CFM
function that targets a Smart account's auth path. Strategy itself
is unchanged — it still takes a single AND-of-keysets array; the UI
resolves the OR-of-3 to one chosen branch before calling execute.

**~310 tests** pass on every commit (cfm-builders + smart-account-auth
+ codex-codec + crypto + DALOS integration + misc). Published to the
public npmjs registry via `.github/workflows/publish.yml` on every
`v*` tag.

```bash
npm install @stoachain/ouronet-core
```

## Design docs

The architectural plan, per-phase migration history, HUB handoff, and
decision log live in the **OuronetUI repo** under `docs/`:

- [`EXTRACT_OURONET_CORE_PLAN.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/EXTRACT_OURONET_CORE_PLAN.md) — the 8-phase migration plan (now complete)
- [`ANCIENTHOLDER_HUB_HANDOFF.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/ANCIENTHOLDER_HUB_HANDOFF.md) — what the HUB agent needs to know to integrate
- [`TESTING_STRATEGY.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/TESTING_STRATEGY.md) — 3-tier testing approach + current state + roadmap
- [`CFM_BUILD_GUIDE.md`](https://github.com/DemiourgosHoldings/OuronetUI/blob/dev/docs/CFM_BUILD_GUIDE.md) — how a CFM modal uses this package

Don't fork logic — add to core, version-bump, publish, and consumers
upgrade deliberately.

## Submodules

Each is a subpath export of the package: `import { ... } from "@stoachain/ouronet-core/<submodule>"`.

| Path | Contains |
|---|---|
| `@stoachain/ouronet-core/constants` | `KADENA_NAMESPACE`, `KADENA_CHAIN_ID`, `KADENA_NETWORK`, `PACT_URL`, gas-station + liquidpot addresses, every `TOKEN_ID_*` |
| `@stoachain/ouronet-core/network` | Node failover (node2 → node1), URL construction |
| `@stoachain/ouronet-core/gas` | `calculateAutoGasLimit`, ANU/STOA math |
| `@stoachain/ouronet-core/guard` | `analyzeGuard`, `buildCodexPubSet`, `selectCapsSigningKey`, `computeThreshold` (all predicates including `stoa-ns.stoic-predicates.*`); **(v1.6.0+)** `classifyGuardKind`, `extractKeysetFromGuard`, `analyzeSmartAccountAuthPaths` for the Smart Ouronet Account three-branch auth-path resolution (`enforce-one` over account-guard / sovereign-guard / governor) |
| `@stoachain/ouronet-core/crypto` | V1 + V2 AES-GCM-256 encryption, `smartDecrypt`, pure `smartEncrypt(pt, pw, schemaVersion)` |
| `@stoachain/ouronet-core/signing` | `KeyResolver` / `SigningStrategy` interfaces, `CodexSigningStrategy`, `universalSignTransaction`, signing primitives (`publicKeyFromPrivateKey`, etc.) |
| `@stoachain/ouronet-core/codex` | `PlaintextCodex` generic type, `serializeCodex` / `deserializeCodex` (backup format `"1.2"`), `migrateSeedType` |
| `@stoachain/ouronet-core/reads` | `rawCalibratedDirtyRead` (pure Pact read with node failover; no cache) |
| `@stoachain/ouronet-core/pact` | `formatDecimalForPact`, `safeCreationTime`, `filterFreePositionData`, EU locale formatters, and **14 `buildXxxPactCode` builders** for every CFM function the ecosystem ships |
| `@stoachain/ouronet-core/interactions` | Read helpers (`getXxxInfo`, `getXxxBalance`, `getHibernatedNonces…`) + non-CFM execute helpers (`executeWrapStoa`, `executeWrapUrStoa`, `executeNativeUrStoaTransfer`) |
| `@stoachain/ouronet-core/dalos` | **(v1.3.0+)** thin re-export of `@stoachain/dalos-crypto/registry` + `createOuronetAccount(registry, options)` convenience helper covering all 6 DALOS input modes. One-stop shop for browser-side key-gen; no need to install `dalos-crypto` as a separate dep. |

## Quick start — `/dalos` subpath

Mint a new Ouronet account locally in one call:

```ts
import {
  createDefaultRegistry,
  createOuronetAccount,
} from "@stoachain/ouronet-core/dalos";

const registry = createDefaultRegistry();

// Random account (simplest — OS randomness)
const a = createOuronetAccount(registry, { mode: "random" });

// From a seed phrase (any array of UTF-8 words, 4–256 entries)
const b = createOuronetAccount(registry, {
  mode: "seedWords",
  data: ["mountain", "whisper", "aurora", "eternal"],
});

// From a 40×40 bitmap (1 = black, 0 = white; row-major TTB-LTR)
import type { Bitmap } from "@stoachain/ouronet-core/dalos";
const bitmap: Bitmap = /* 40 rows × 40 cols */;
const c = createOuronetAccount(registry, { mode: "bitmap", data: bitmap });

console.log(b.standardAddress);    // Ѻ.xxxxx…
console.log(b.keyPair.priv);       // base-49 private key
console.log(b.privateKey.int49);   // same, via `privateKey` object
console.log(b.privateKey.int10);   // base-10 representation
console.log(b.privateKey.bitString); // 1600-bit binary
```

Same API shape as `@stoachain/dalos-crypto/registry` — OuronetCore just
re-exports the types and adds `createOuronetAccount` as a convenience.
See [`@stoachain/dalos-crypto`](https://www.npmjs.com/package/@stoachain/dalos-crypto)
for deeper documentation on the cryptographic primitive itself.

## Local development

```bash
npm install
npm run build        # tsc -p tsconfig.build.json → dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest run — 295 tests across crypto, guard, gas, pact format, signing, strategy, codex, cfmBuilders, dalos integration
```

To hot-reload changes into OuronetUI (which now depends on the published
registry version), use `npm link`:

```bash
cd OuronetCore && npm link
cd OuronetUI  && npm link @stoachain/ouronet-core
# Edit core, run `npm run build` in OuronetCore, UI picks up the change.
# npm unlink @stoachain/ouronet-core  # restores registry resolution
```

## Publishing

Push a `v*`-prefixed tag and `.github/workflows/publish.yml` handles the
rest — typecheck + build + test + `npm publish` to **public npmjs.org**
under the `@stoachain` scope. Version parity check bakes in protection
against mismatched tag / package.json versions.

```bash
# After bumping package.json + CHANGELOG.md and committing:
git tag v1.3.1 -m "v1.3.1 — ..."
git push origin v1.3.1
# Workflow publishes within ~2 minutes. Consumers run `npm install` to pick up.
```

## Versioning

Strict semver. Breaking changes → major version bump → consumers upgrade
deliberately. Changelog in `CHANGELOG.md`.

## License

UNLICENSED (org-owned package). Public on
[npmjs.com/package/@stoachain/ouronet-core](https://www.npmjs.com/package/@stoachain/ouronet-core);
authoring rights retained by AncientHoldings GmbH.
