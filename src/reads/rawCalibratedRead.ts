/**
 * rawCalibratedDirtyRead — uncached Pact dirty-read with a read-friendly gas limit.
 *
 * For on-chain READS (as opposed to submits), simulation gas is effectively
 * free — the 10 M ceiling just needs to be comfortably above anything a real
 * read might consume so we never get a gas-exhausted result for a non-malicious
 * query. Consumers that want caching / dedup / tier-tracking wrap this in their
 * own layer (OuronetUI does via `pact-query-cache`).
 *
 * This function is intentionally pure: no cache, no subscribers, no circular
 * dependencies. It's what the HUB will use directly (no React lifecycle to
 * bind a cache to) and what OuronetUI's cache wrapper delegates to on miss.
 */

import { Pact, createClient } from "@kadena/client";
import type { ChainId } from "@kadena/types";
import { KADENA_CHAIN_ID, KADENA_NETWORK, PACT_URL } from "../constants";

/** Read-friendly simulation gas ceiling — reads don't actually spend it. */
const READ_SIM_GAS_LIMIT = 10_000_000;

/**
 * Perform a Pact dirty-read. Bypasses any cache. Returns the raw
 * `@kadena/client` response (including `result.status`, `result.data`, etc.);
 * callers are expected to unwrap based on their read's shape.
 *
 * Options:
 *   pactUrl   — target endpoint. Defaults to PACT_URL (the baked constant
 *               used by OuronetUI's browser flow). Server consumers pass
 *               their own (direct node URL, no CORS proxy).
 *   chainId   — chain id. Defaults to KADENA_CHAIN_ID ("0").
 */
export async function rawCalibratedDirtyRead(
  pactCode: string,
  options?: {
    pactUrl?: string;
    chainId?: ChainId | string;
    /**
     * Accepted and ignored. Source-compatibility shim for consumers that
     * used to call OuronetUI's cache-aware `calibratedDirtyRead` (which
     * carried tier tracking). The raw read has no cache, so the tier is
     * meaningless here — the option exists so the migration doesn't touch
     * 20+ call sites needlessly.
     */
    tier?: string;
    skipTempWatcher?: boolean;
  },
) {
  const pactUrl = options?.pactUrl ?? PACT_URL;
  const chainId = (options?.chainId ?? KADENA_CHAIN_ID) as ChainId;

  const transaction = Pact.builder
    .execution(pactCode)
    .setNetworkId(KADENA_NETWORK)
    .setMeta({ chainId, gasLimit: READ_SIM_GAS_LIMIT })
    .createTransaction();

  const { dirtyRead } = createClient(pactUrl);
  const response = await dirtyRead(transaction);

  return response;
}
