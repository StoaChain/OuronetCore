// @stoachain/ouronet-core/signing
//
// Pure public-key derivation (primitives) + the universal-signing core
// (routes koala/foreign → nacl, chainweaver/eckowallet → WASM) + the
// Phase 3 abstraction interfaces (KeyResolver, SigningStrategy, PactClient)
// consumers implement to plug their own Codex + endpoint into signing.
//
// Phase 2b duplicated universalSign to unblock interactions moving to core.
// Phase 3a (this version) ships the abstraction interfaces.
// Phase 3b will ship CodexSigningStrategy + collapse the 23 CFM handleExecute
// blocks. Until then the new interfaces exist but nothing inside core uses
// them — deliberate scaffolding.

export * from "./primitives";
export * from "./universalSign";
export * from "./types";
