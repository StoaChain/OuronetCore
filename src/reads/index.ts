// @stoachain/ouronet-core/reads
//
// Read helpers for on-chain data. Two surfaces:
//
//   - rawCalibratedDirtyRead — direct uncached call, always available
//   - pactRead / setPactReader — pluggable reader, used by the interactions
//     package so consumers can wire their own cache-aware implementation
//     at boot time. See ./pactReader.ts for the rationale.

export * from "./rawCalibratedRead";
export * from "./pactReader";
