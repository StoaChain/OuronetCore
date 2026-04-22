// @stoachain/ouronet-core/wallet
//
// HD keypair derivation (KadenaWalletBuilder) + runtime account class
// (KadenaWallet) + the CodexStorageAdapter interface each consumer
// implements against its own storage backend (browser: localStorage,
// server: encrypted file, etc.).

export * from "./types";
export * from "./storageAdapter";

// Default exports for the two classes — keep the original OuronetUI
// import style working: `import KadenaWallet from ".../wallet"`.
// Also available as named imports via the star re-exports below for
// anyone who prefers that shape.
export { default as KadenaWallet } from "./KadenaWallet";
export { default as KadenaWalletBuilder } from "./KadenaWalletBuilder";
