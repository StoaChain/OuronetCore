/**
 * StoaChain / Chainweb / Pact constants — canonical source of truth.
 *
 * Moved to @stoachain/ouronet-core in Phase 1. Consumers import from
 * "@stoachain/ouronet-core/constants".
 */

import { getActivePactUrl, getActiveSpvUrl } from "../network/nodeFailover";

export const KADENA_NETWORK = "stoa";

export const KADENA_CHAIN_ID = "0";

export const KADENA_NAMESPACE = "ouronet-ns";

/** Base URL for Chainweb API (static — primary node) */
export const KADENA_BASE_URL = `https://node2.stoachain.com/chainweb/0.0/${KADENA_NETWORK}`;

/**
 * Pact API endpoint for chain 0.
 * For failover support, prefer getPactUrl(chainId) which uses the active node.
 */
export const PACT_URL = `${KADENA_BASE_URL}/chain/${KADENA_CHAIN_ID}/pact`;

/** Get Pact API URL for any chain — uses failover (node2 primary, node1 fallback) */
export const getPactUrl = (chainId: string): string =>
  getActivePactUrl(chainId);

/** Get SPV API URL for any chain — uses failover */
export const getSpvUrl = (chainId: string): string =>
  getActiveSpvUrl(chainId);

// ─── Stoa Autonomic Accounts ───────────────────────────────────────────────
// Canonical names for all protocol-level Stoa accounts.
// Always reference these — never hardcode the address strings directly.

/** Ouroboros protocol account (staking/rewards engine) */
export const STOA_AUTONOMIC_OUROBOROS = "c:XM-pkmuB5XUQlp87ZYSbfKt8qzmHY6O2EHAzMRVBt3k";

/** LiquidPot account (native STOA vault — source of unwrapped tokens) */
export const STOA_AUTONOMIC_LIQUIDPOT = "c:ZNfuj3iZI83n7MUSKGuoXoSxFg1cyMxCzB3szUHVvrI";

/** Ouronet Gas Station (pays Kadena gas fees for all transactions) */
export const STOA_AUTONOMIC_OURONETGASSTATION = "c:iQQFWj6gWtpGEzhM_O5ekW1QtnQQy55R8BRPGhj_0FU";

// Legacy aliases — point to canonical constants above
/** @deprecated Use STOA_AUTONOMIC_OURONETGASSTATION */
export const GAS_STATION = STOA_AUTONOMIC_OURONETGASSTATION;
/** @deprecated Use STOA_AUTONOMIC_LIQUIDPOT */
export const NATIVE_TOKEN_VAULT = STOA_AUTONOMIC_LIQUIDPOT;

/** Number of chains on the Stoa network */
export const STOA_CHAIN_COUNT = 10;

/** Available Stoa chains (0-9) */
export const STOA_CHAINS = Array.from({ length: STOA_CHAIN_COUNT }, (_, i) =>
  String(i)
);

/** All available chains (0-9) */
export const KADENA_CHAINS = STOA_CHAINS;

export const MAIN_TOKENS = [
  { id: "AURYN-8Nh-JO8JO4F5", name: "AURYN" },
  {
    id: "ELITEAURYN-8Nh-JO8JO4F5",
    name: "ELITEAURYN",
  },
  {
    id: "SSTOA-8Nh-JO8JO4F5",
    name: "SSTOA",
  },
  {
    id: "OURO-8Nh-JO8JO4F5",
    name: "OURO",
  },
  {
    id: "VST-8Nh-JO8JO4F5",
    name: "VST",
  },
];
