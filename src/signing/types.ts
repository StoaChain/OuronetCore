/**
 * Signing interfaces — the contract consumers implement to plug their own
 * key-storage backend into `@stoachain/ouronet-core`'s signing core.
 *
 * Phase 3a introduces these types. Phase 3b wires the first consumer
 * (`CodexSigningStrategy`) + collapses the 23 CFM-modal `handleExecute`
 * duplicates. For now the interfaces compile as part of the public API but
 * nothing inside core USES them yet — they're a scaffold.
 *
 * Grounded in the research pass in `docs/EXTRACT_OURONET_CORE_PLAN.md §2.2`
 * — these signatures match what OuronetUI's CFM modals actually call today.
 */

import type { IUnsignedCommand, ICommand } from "@kadena/types";
import type { IKeyset } from "../guard";

/**
 * Signing-ready keypair. Same shape every CFM modal's `handleExecute`
 * builds today. Canonical home is here; ouroFunctions still exports a
 * structurally identical type for backwards-compat with Phase 2b imports.
 */
export interface IKadenaKeypair {
  publicKey:          string;
  privateKey:         string;
  seedType?:          "koala" | "chainweaver" | "eckowallet" | "foreign";
  /** Chainweaver/Ecko only: the EncryptedString from @kadena/hd-wallet. */
  encryptedSecretKey?: unknown;
  /** Chainweaver/Ecko only: wallet password (used by kadenaSign WASM). */
  password?:          string;
}

/**
 * "Give me keys" abstraction. Consumers implement this against whatever
 * storage backs their Codex:
 *
 *   - OuronetUI:  ReduxCodexResolver — pulls from walletsSlice + wallet-context
 *   - HUB:        FileCodexResolver — pulls from the encrypted-at-rest JSON
 *                 on disk, password held in-process at boot
 *   - CLI/other:  anything that satisfies the three methods
 *
 * The contract is minimal — three methods, all that CFM handleExecute
 * actually calls. `requestForeignKey` is optional; OuronetUI implements it
 * by opening the existing `ForeignKeySignModal`, the HUB will throw (or
 * consult an allow-list), a CLI could `readline` on stdin.
 */
export interface KeyResolver {
  /**
   * Set of every public key this resolver can sign for. Drives the
   * codex-vs-foreign partitioning in `analyzeGuard`. Must NOT require a
   * password — this is metadata-only, never touches a secret.
   */
  listCodexPubs(): Set<string> | Promise<Set<string>>;

  /**
   * Resolve one public key to a signing-ready `IKadenaKeypair`. MAY prompt
   * the user (browser modal for password) or read from KMS (server) — the
   * Promise lets either resolution strategy work. MUST throw if the pubkey
   * is unknown to this resolver.
   */
  getKeyPairByPublicKey(publicKey: string): Promise<IKadenaKeypair>;

  /**
   * Optional: resolve a signer pubkey that isn't in the Codex by prompting
   * the user (or equivalent) for a raw 64-char private key. Browser
   * implementations call the ForeignKeySignModal here. Server
   * implementations should either throw or consult a pre-configured
   * allow-list.
   */
  requestForeignKey?(publicKey: string): Promise<string>;
}

/**
 * Narrow subset of `@kadena/client`'s `createClient(url)` return value —
 * enough to simulate + submit a transaction. Consumers pass one into the
 * SigningStrategy so core-side code doesn't import the URL constant
 * directly (browser needs the CF-worker proxy URL; server hits Stoa
 * directly).
 *
 * Phase 5 drops this requirement — once core ships its own
 * `getConfiguredClient(chainId)` that uses the node-failover URL, strategies
 * can compose one internally. For Phase 3 we accept the explicit arg.
 */
export interface PactClient {
  dirtyRead(tx: IUnsignedCommand): Promise<any>;
  submit(signed: ICommand | IUnsignedCommand): Promise<any>;
}

/**
 * The end-to-end execute pipeline every CFM modal runs today. Phase 3b
 * will ship `CodexSigningStrategy` implementing this interface; the 23
 * CFM modals each call `strategy.execute({...})` instead of reimplementing
 * the A–F pipeline inline.
 *
 * For now this interface exists but has no implementation — intentional
 * scaffolding, not wired anywhere yet.
 */
export interface SigningStrategy {
  readonly resolver: KeyResolver;
  readonly client:   PactClient;

  /**
   * Full simulate → build → sign → submit pipeline:
   *   1. build(gasLimit) with a sim-friendly ceiling
   *   2. client.dirtyRead → fail-fast on simulation failure
   *   3. calculateAutoGasLimit on the returned gas
   *   4. build(gasLimit) again with the measured limit
   *   5. analyzeGuard + collectKeys for every guard
   *   6. selectCapsSigningKey for GAS_PAYER
   *   7. universalSignTransaction with deduped keypairs
   *   8. client.submit → return the request key
   */
  execute(args: {
    /** Build an unsigned tx given a gas limit. Called twice (sim + real). */
    build: (gasLimit: number) => IUnsignedCommand;
    /** Guards whose keys must pure-sign the tx (bare addSigner). */
    guards: IKeyset[];
    /** Optional payment-key pubkey used for GAS_PAYER capability. */
    paymentKey?: string | null;
    /** Browser-side: foreign keys pre-resolved via a modal. Server: empty. */
    resolvedForeignKeys?: Record<string, string>;
  }): Promise<{ requestKey: string; raw: any }>;

  /**
   * Lower-level: take a pre-built tx + specific keypairs and produce a
   * signed + submitted result. For callers that need their own sim logic
   * or want to batch-build before signing.
   */
  sign(args: {
    tx:            IUnsignedCommand;
    capsKey:       IKadenaKeypair;
    guardKeypairs: IKadenaKeypair[];
  }): Promise<ICommand>;
}
