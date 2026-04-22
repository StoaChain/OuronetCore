// @stoachain/ouronet-core/signing
//
// Pure public-key derivation (primitives) + the universal-signing core
// (routes koala/foreign → nacl, chainweaver/eckowallet → WASM).
//
// Phase 2b temporarily duplicates universalSign from OuronetUI so the
// interaction builders can live here. Phase 3 collapses — KeyResolver +
// SigningStrategy + CodexSigningStrategy land here and the duplication
// goes away.

export * from "./primitives";
export * from "./universalSign";
