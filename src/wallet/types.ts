/**
 * Shared wallet types — consumed by the HD builder, the storage adapter
 * interface, and the eventual PlaintextCodex codec (Phase 4).
 */

/**
 * Derivation algorithm for an HD seed in the Codex.
 *
 *   koala       — standard BIP39 24-word mnemonic + SLIP-10 Ed25519.
 *                 Produces 64-char private keys; signs via nacl.
 *   chainweaver — Kadena 12-word mnemonic + BIP32-Ed25519 via
 *                 @kadena/hd-wallet/chainweaver. Signs via WASM with an
 *                 EncryptedString secretKey + password.
 *   eckowallet  — same 12-word + BIP32-Ed25519 pathway as chainweaver;
 *                 only the label differs.
 *
 * Note this is a DERIVATION marker, not a delegation marker — OuronetUI has
 * no `window.ecko`/`window.chainweaver` extension integration today. The
 * seed's private key lives in the Codex either way; only the math that
 * turns a mnemonic into that key differs between these three labels.
 */
export type SeedType = "koala" | "chainweaver" | "eckowallet";
