/**
 * @stoachain/ouronet-core/crypto — codex encryption.
 *
 * Two formats ship side-by-side. V1 (legacy) stays around to decrypt codex
 * blobs written before the V2 upgrade; V2 is what every new write produces.
 * Both use AES-GCM-256; they differ only in KDF params (V1: PBKDF2-SHA256
 * 10k; V2: PBKDF2-SHA512 600k).
 *
 *   `encryptString` / `decryptString` — V1 primitives. Only needed when a
 *     caller specifically wants the V1 format (almost never). Imported
 *     under `/v1`-like aliases elsewhere.
 *   `encryptStringV2` / `decryptStringV2` — V2 primitives.
 *   `smartEncrypt(plain, pw, schemaVersion)` — picks V1 or V2 based on
 *     the schema-version string the caller hands in (pure — no storage).
 *   `smartDecrypt(blob, pw)` — auto-detects by shape. The single best
 *     entry point for "decrypt whatever the user gave me".
 *   `isEncryptedV2`, `allEncryptedV2`, `isCodexUpgraded` — predicates.
 *
 * All pure. Works in browser + Node.js + any WebCrypto environment.
 * OuronetUI's `src/lib/smart-encrypt-browser.ts` is the ~5-line wrapper
 * that reads `localStorage.codex_schema_version` and calls `smartEncrypt`
 * here — the localStorage dependency lives at the consumer boundary.
 */

export {
  encryptString,
  decryptString,
  type EncryptedData,
} from "./v1";

export {
  encryptStringV2,
  decryptStringV2,
  isEncryptedV2,
  allEncryptedV2,
  isCodexUpgraded,
  smartEncrypt,
  smartDecrypt,
  type EncryptedDataV1,
  type EncryptedDataV2,
} from "./v2";
