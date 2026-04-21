/**
 * Node Failover — automatic failover between Stoa Chain nodes.
 *
 * Primary: node2.stoachain.com (ASIC miner, 2M gas limit)
 * Fallback: node1.stoachain.com (seed node, 1.6M gas limit)
 *
 * Health check: GET /info with 3s timeout.
 * Retry primary every 30s when on fallback.
 */

const KADENA_NETWORK = "stoa";

const NODE2_HOST = "https://node2.stoachain.com";
const NODE1_HOST = "https://node1.stoachain.com";

/** Known gas limits per node */
const NODE_GAS_LIMITS: Record<string, number> = {
  [NODE2_HOST]: 2_000_000,
  [NODE1_HOST]: 2_000_000,
};

/** Default gas limit for unknown/custom nodes (chainweb default) */
const DEFAULT_GAS_LIMIT = 1_600_000;

let PRIMARY_HOST = NODE2_HOST;
let FALLBACK_HOST = NODE1_HOST;
let customGasLimit = DEFAULT_GAS_LIMIT;

const HEALTH_TIMEOUT_MS = 3000;
const RETRY_INTERVAL_MS = 30_000;

let currentHost = PRIMARY_HOST;
let retryTimer: ReturnType<typeof setInterval> | null = null;

/** Check if a node is healthy */
async function isHealthy(host: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${host}/info`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/** Switch to fallback and start retry loop */
function switchToFallback() {
  if (currentHost === FALLBACK_HOST) return;
  console.warn("[node-failover] Primary node down, switching to fallback:", FALLBACK_HOST);
  currentHost = FALLBACK_HOST;
  startRetryLoop();
}

/** Switch back to primary */
function switchToPrimary() {
  if (currentHost === PRIMARY_HOST) return;
  console.info("[node-failover] Primary node recovered, switching back:", PRIMARY_HOST);
  currentHost = PRIMARY_HOST;
  stopRetryLoop();
}

function startRetryLoop() {
  if (retryTimer) return;
  retryTimer = setInterval(async () => {
    if (await isHealthy(PRIMARY_HOST)) {
      switchToPrimary();
    }
  }, RETRY_INTERVAL_MS);
}

function stopRetryLoop() {
  if (retryTimer) {
    clearInterval(retryTimer);
    retryTimer = null;
  }
}

/** Get the current active node base URL (chainweb API root) */
export function getActiveBaseUrl(): string {
  return `${currentHost}/chainweb/0.0/${KADENA_NETWORK}`;
}

/** Get the current active host (without chainweb path) */
export function getActiveHost(): string {
  return currentHost;
}

/** Get Pact URL for a specific chain, using the active node */
export function getActivePactUrl(chainId: string): string {
  return `${getActiveBaseUrl()}/chain/${chainId}/pact`;
}

/** Get SPV URL for a specific chain, using the active node */
export function getActiveSpvUrl(chainId: string): string {
  return `${getActiveBaseUrl()}/chain/${chainId}/pact/spv`;
}

/**
 * Wrap a fetch/submit call with automatic failover.
 * If the call fails with a network error on primary, switches to fallback and retries once.
 */
export async function withFailover<T>(
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  try {
    const result = await fn(getActiveBaseUrl());
    return result;
  } catch (err: any) {
    // Only failover on network errors, not on chain/logic errors
    const isNetworkError =
      err?.message?.includes("Failed to fetch") ||
      err?.message?.includes("NetworkError") ||
      err?.message?.includes("ECONNREFUSED") ||
      err?.name === "AbortError";

    if (isNetworkError && currentHost === PRIMARY_HOST) {
      switchToFallback();
      // Retry once on fallback
      return fn(getActiveBaseUrl());
    }
    throw err;
  }
}

/** Configure the primary and fallback nodes based on user selection */
export function setNodeConfig(
  selected: "node2" | "node1" | "custom",
  customUrl?: string,
  customNodeGasLimit?: number
): void {
  stopRetryLoop();

  if (selected === "node1") {
    PRIMARY_HOST = NODE1_HOST;
    FALLBACK_HOST = NODE2_HOST;
  } else if (selected === "custom" && customUrl) {
    PRIMARY_HOST = customUrl;
    FALLBACK_HOST = NODE2_HOST;
  } else {
    // node2 (default)
    PRIMARY_HOST = NODE2_HOST;
    FALLBACK_HOST = NODE1_HOST;
  }

  customGasLimit = customNodeGasLimit ?? DEFAULT_GAS_LIMIT;

  // Reset to new primary
  currentHost = PRIMARY_HOST;
}

/** Get the block gas limit for the currently active node */
export function getActiveGasLimit(): number {
  return NODE_GAS_LIMITS[currentHost] ?? customGasLimit;
}

/** Get gas limit info for a specific node preset */
export function getNodeGasLimit(node: "node2" | "node1" | "custom"): number {
  if (node === "node2") return NODE_GAS_LIMITS[NODE2_HOST];
  if (node === "node1") return NODE_GAS_LIMITS[NODE1_HOST];
  return customGasLimit;
}

/** Default gas limit for custom/unknown nodes */
export const CHAINWEB_DEFAULT_GAS_LIMIT = DEFAULT_GAS_LIMIT;

/** Get the current node configuration */
export function getNodeConfig(): { primary: string; fallback: string } {
  return { primary: PRIMARY_HOST, fallback: FALLBACK_HOST };
}

/** Get current node status */
export function getCurrentNodeStatus(): {
  primary: string;
  fallback: string;
  active: string;
  isOnPrimary: boolean;
} {
  return {
    primary: PRIMARY_HOST,
    fallback: FALLBACK_HOST,
    active: currentHost,
    isOnPrimary: currentHost === PRIMARY_HOST,
  };
}

/** Initialize: check primary health on startup */
export async function initNodeFailover(): Promise<void> {
  if (!(await isHealthy(PRIMARY_HOST))) {
    switchToFallback();
  }
}
