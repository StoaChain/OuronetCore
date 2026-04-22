/**
 * @stoachain/ouronet-core/codex — portable Codex types + serialization
 * codec + seed-type migration.
 *
 * Three small pieces that every codex consumer (OuronetUI, future HUB,
 * any CLI/recovery tool) needs:
 *
 *   - `PlaintextCodex<...>` — generic in-memory shape. Consumer plugs
 *     its own wallet/account/keypair types via the type params.
 *   - `CodexExportV1_2` + `serializeCodex` / `deserializeCodex` /
 *     `buildCodexExport` — the backup-JSON codec. Format version is
 *     literally the string `"1.2"`; don't bump (see codec.ts JSDoc).
 *   - `SeedType` + `migrateSeedType` — the legacy↔canonical name
 *     mapping, idempotent. Was inlined in OuronetUI's WalletStorage
 *     before; lives here now so HUB doesn't have to rediscover it.
 *
 * Intentionally does NOT handle encryption. Each entry's `secret` field
 * inside a codex is already an encrypted blob at rest; serializing /
 * deserializing the codex doesn't touch those. For encryption see
 * `@stoachain/ouronet-core/crypto`.
 */

export type { PlaintextCodex, CodexExportV1_2 } from "./types";
export {
  buildCodexExport,
  serializeCodex,
  deserializeCodex,
} from "./codec";
export type { SeedType, RawSeedType } from "./seedTypeMigration";
export { migrateSeedType } from "./seedTypeMigration";
