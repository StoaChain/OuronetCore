/**
 * CodexStorageAdapter — the abstraction both browser and server consumers
 * implement for persisting a Codex (seeds + ouro accounts + pure keypairs
 * + address book + encrypted UI settings + schema metadata).
 *
 * Two known implementations:
 *   - OuronetUI: `LocalStorageCodexAdapter` (backed by localStorage +
 *     redux-persist). Lives in the OuronetUI repo at
 *     `src/kadena/wallet/WalletStorage.ts`.
 *   - AncientHolder HUB (future): `EncryptedFileCodexAdapter` backed by a
 *     single AES-GCM encrypted JSON file on disk, with the master passphrase
 *     held in-process. Lives in the HUB repo.
 *
 * This file defines the INTERFACE ONLY. Core does not ship a default
 * implementation — each consumer brings its own. Phase 4 of the extraction
 * plan defines `PlaintextCodex`, the concrete shape both adapters serialize.
 *
 * Methods kept minimal — the adapter is a container, not a state machine.
 * The in-memory CRUD surface (addWallet, getWallet, removeWalletById, etc.)
 * lives on the concrete adapter; different runtimes have different idioms
 * (Redux action-dispatch vs direct mutation vs async-backend) and forcing
 * them through a shared interface gains nothing.
 */

// NOTE: the concrete PlaintextCodex shape lands in Phase 4. For now the
// adapter uses `unknown` for the codex payload — consumers type-narrow on
// their own known shape. Phase 4 tightens this to PlaintextCodex.

export interface CodexStorageAdapter {
  /**
   * Load the persisted Codex. Returns the payload or null if nothing was
   * saved yet (first-run). MUST NOT require a password — secret material
   * inside the payload remains encrypted. Unlocking happens separately.
   */
  load(): Promise<unknown | null> | unknown | null;

  /**
   * Save the in-memory Codex to the underlying store. Overwrites the
   * previous copy atomically (as much as the underlying store allows).
   */
  save(codex: unknown): Promise<void> | void;

  /**
   * Remove the persisted envelope. Used on logout / reset flows. MUST NOT
   * require a password. Consumers decide whether this clears downstream
   * artefacts too (browser: legacy localStorage mirrors; server: file on
   * disk).
   */
  clear(): Promise<void> | void;
}
