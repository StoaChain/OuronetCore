// @stoachain/ouronet-core/guard

export * from "./guardUtils";
// v1.6.0 — Smart Ouronet Account auth-path resolution primitives.
// Used by the UI's AuthPathZone to render the three auth branches
// (account guard / sovereign / governor) of a Smart account as a
// pickable list, and to flag transactions where no branch is signable
// by the codex (fall-through to Execute Code).
export * from "./smartAccountAuth";
