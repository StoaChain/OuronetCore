// @stoachain/ouronet-core/interactions
//
// Pact builders + submit helpers for every on-chain action OuronetUI (and
// the future HUB backend) performs. Thirteen files in this directory — they
// have overlapping symbol names (several files re-export IKadenaKeypair etc.
// from ouroFunctions), so consumers should import from specific subpaths
// rather than via this barrel:
//
//   import { executeCoil }    from "@stoachain/ouronet-core/interactions/wrapFunctions";
//   import type { IKadenaKeypair } from "@stoachain/ouronet-core/interactions/ouroFunctions";
//
// This barrel re-exports only ouroFunctions (the canonical source for most
// shared types — IKadenaKeypair, IOuroAccountKeypair, etc.) for the
// convenience of any caller that wants just those.

export * from "./ouroFunctions";
