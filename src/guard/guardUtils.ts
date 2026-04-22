/**
 * guardUtils.ts — Signing guard analysis engine
 *
 * Covers:
 *  - Standard predicates: keys-all, keys-any, keys-2
 *  - stoic-predicates: keys-1/3/4, at-least-N%, keys-M-of-N, all-but-one/two
 *  - Payment key classification: k: (single pubkey) vs custom (warn + console)
 *  - Guard satisfaction check: codex scan → threshold → needMore
 *  - Progressive manual key resolution
 */

import {
  publicKeyFromPrivateKey,
  publicKeyFromExtendedKey,
} from "../signing/primitives";

/**
 * A Kadena keyset guard. The three standard predicates from Pact core plus
 * any stoic-predicate string are all acceptable. `keysetRef` is present when
 * the on-chain guard is a keyset-ref-guard (e.g. "ouronet-ns.dh_sc_dpdc-keyset")
 * rather than an inline keyset.
 */
export interface IKeyset {
  pred: "keys-all" | "keys-any" | "keys-2" | string;
  keys: string[];
  keysetRef?: string;
}

// ── Predicate tables ───────────────────────────────────────────────────────────

const STOIC_FIXED: Record<string, number> = {
  "stoa-ns.stoic-predicates.keys-1": 1,
  "stoa-ns.stoic-predicates.keys-3": 3,
  "stoa-ns.stoic-predicates.keys-4": 4,
};

const STOIC_M_OF_N: Record<string, number> = {
  "stoa-ns.stoic-predicates.keys-2-of-3": 2,
  "stoa-ns.stoic-predicates.keys-3-of-5": 3,
  "stoa-ns.stoic-predicates.keys-4-of-7": 4,
  "stoa-ns.stoic-predicates.keys-5-of-9": 5,
};

const STOIC_PCT: Record<string, number> = {
  "stoa-ns.stoic-predicates.at-least-51pct": 0.51,
  "stoa-ns.stoic-predicates.at-least-60pct": 0.60,
  "stoa-ns.stoic-predicates.at-least-66pct": 0.66,
  "stoa-ns.stoic-predicates.at-least-75pct": 0.75,
  "stoa-ns.stoic-predicates.at-least-90pct": 0.90,
};

/**
 * Compute the minimum number of signatures required to satisfy a predicate
 * given a keyset of `keyCount` keys.
 */
export function computeThreshold(pred: string, keyCount: number): number {
  if (keyCount === 0) return 0;

  // Standard
  if (pred === "keys-any") return 1;
  if (pred === "keys-all") return keyCount;
  if (pred === "keys-2")   return Math.min(2, keyCount);

  // Stoic fixed
  if (pred in STOIC_FIXED) return Math.min(STOIC_FIXED[pred], keyCount);

  // Stoic m-of-n
  if (pred in STOIC_M_OF_N) return Math.min(STOIC_M_OF_N[pred], keyCount);

  // Stoic percentage
  if (pred in STOIC_PCT) return Math.ceil(keyCount * STOIC_PCT[pred]);

  // Stoic tolerance
  if (pred === "stoa-ns.stoic-predicates.all-but-one") return Math.max(1, keyCount - 1);
  if (pred === "stoa-ns.stoic-predicates.all-but-two") return Math.max(1, keyCount - 2);

  // Unknown predicate — conservative fallback: require all
  console.warn(`[guardUtils] Unknown predicate: "${pred}" — defaulting to keys-all`);
  return keyCount;
}

/** Human-readable label for a predicate + keyset size */
export function predicateLabel(pred: string, keyCount: number): string {
  const threshold = computeThreshold(pred, keyCount);
  const short = pred.split(".").pop() ?? pred;
  if (pred === "keys-any") return `keys-any (1 of ${keyCount})`;
  if (pred === "keys-all") return `keys-all (${keyCount} of ${keyCount})`;
  return `${short} (${threshold} of ${keyCount})`;
}

// ── Guard analysis ─────────────────────────────────────────────────────────────

export interface GuardAnalysis {
  /** All keys declared in the guard keyset */
  keys: string[];
  pred: string;
  /** Minimum signatures needed */
  threshold: number;
  /** Keys immediately signable from Codex */
  codexKeys: string[];
  /** Keys NOT found in Codex and not yet manually resolved */
  foreignKeys: string[];
  /** Subset of foreignKeys that user has resolved via manual private key input */
  resolvedForeignKeys: string[];
  /** Total keys currently able to sign: codexKeys + resolvedForeignKeys */
  signable: number;
  /** Whether the guard is satisfied */
  satisfied: boolean;
  /** How many more keys are still needed (0 when satisfied) */
  neededMore: number;
  /** Human-readable predicate label */
  predLabel: string;
}

/**
 * Analyze a guard keyset against the Codex pub set and any manually resolved keys.
 * Returns a fully computed GuardAnalysis with satisfaction state.
 */
export function analyzeGuard(
  guard: { keys: string[]; pred: string } | null | undefined,
  codexPubs: Set<string>,
  resolvedManualKeys: Record<string, string> = {},
): GuardAnalysis {
  if (!guard?.keys?.length) {
    return {
      keys: [], pred: "keys-all", threshold: 0,
      codexKeys: [], foreignKeys: [], resolvedForeignKeys: [],
      signable: 0, satisfied: true, neededMore: 0, predLabel: "—",
    };
  }

  const threshold = computeThreshold(guard.pred, guard.keys.length);
  const codexKeys: string[]   = [];
  const foreignKeys: string[] = [];

  for (const key of guard.keys) {
    (codexPubs.has(key) ? codexKeys : foreignKeys).push(key);
  }

  const resolvedForeignKeys = foreignKeys.filter(k => !!resolvedManualKeys[k]);
  const signable    = codexKeys.length + resolvedForeignKeys.length;
  const satisfied   = signable >= threshold;
  const neededMore  = Math.max(0, threshold - signable);

  return {
    keys: guard.keys,
    pred: guard.pred,
    threshold,
    codexKeys,
    foreignKeys,
    resolvedForeignKeys,
    signable,
    satisfied,
    neededMore,
    predLabel: predicateLabel(guard.pred, guard.keys.length),
  };
}

// ── Payment key classification ─────────────────────────────────────────────────

export type PaymentKeyType = "k-account" | "custom-account";

export interface PaymentKeyInfo {
  address: string;
  type: PaymentKeyType;
  /** Only defined for k-account: the raw pubkey (address without "k:") */
  pubkey: string | null;
}

/**
 * Determine if a payment key address is a standard k: account (single known pubkey)
 * or a custom account (c:, u:, w:, named — cannot reliably derive pubkey).
 */
export function classifyPaymentKey(address: string | null): PaymentKeyInfo | null {
  if (!address) return null;
  if (address.startsWith("k:")) {
    return { address, type: "k-account", pubkey: address.slice(2) };
  }
  return { address, type: "custom-account", pubkey: null };
}

// ── Codex pub set ──────────────────────────────────────────────────────────────

/** Build a Set of all public keys present in the wallet Codex (seeds + pure keypairs) */
export function buildCodexPubSet(
  kadenaSeeds: any[] | undefined,
  kadenaAccounts: any[] | undefined,
  pureKeypairs?: any[] | undefined,
): Set<string> {
  const set = new Set<string>();
  for (const s of (kadenaSeeds ?? [])) {
    for (const a of (s.accounts ?? [])) {
      if (a.publicKey) set.add(a.publicKey);
    }
  }
  for (const a of (kadenaAccounts ?? [])) {
    if (a.publicKey) set.add(a.publicKey);
  }
  for (const kp of (pureKeypairs ?? [])) {
    if (kp.publicKey) set.add(kp.publicKey);
  }
  return set;
}

// ── Manual key derivation ──────────────────────────────────────────────────────

/**
 * Try to derive a public key from a raw private key string.
 * Supports 64-char (Ed25519) and 128-char (extended) formats.
 * Returns null if the input is not a valid private key.
 */
export function tryDerivePublicKey(priv: string): string | null {
  try {
    if (priv.length === 128) return publicKeyFromExtendedKey(priv.slice(0, 64));
    if (priv.length === 64)  return publicKeyFromPrivateKey(priv);
    return null;
  } catch {
    return null;
  }
}

// ── Gas station / caps key selection ──────────────────────────────────────────

/**
 * Select the best key for signing capabilities (CAPS zone):
 *  1. Payment key pubkey (if in Codex) — highest priority
 *  2. Any Codex key not used for pure guard signing
 *  3. null if no eligible key found
 *
 * Returns null if payment key pubkey is in pure signing set (warn user — "impossible overlap").
 */
export function selectCapsSigningKey(
  paymentKeyPub: string | null,
  codexPubs: Set<string>,
  pureSigningPubs: Set<string>,
): {
  key: string | null;
  isPaymentKey: boolean;
  impossible: boolean;
} {
  // Best case: payment key is in Codex and NOT in pure signing
  if (paymentKeyPub && codexPubs.has(paymentKeyPub) && !pureSigningPubs.has(paymentKeyPub)) {
    return { key: paymentKeyPub, isPaymentKey: true, impossible: false };
  }

  // Fallback: any Codex key not used for pure signing
  for (const pub of codexPubs) {
    if (!pureSigningPubs.has(pub)) {
      return { key: pub, isPaymentKey: false, impossible: false };
    }
  }

  // Worst case: payment key pub is in pure signing — tx impossible without guard rotation
  if (paymentKeyPub && pureSigningPubs.has(paymentKeyPub)) {
    return { key: null, isPaymentKey: true, impossible: true };
  }

  return { key: null, isPaymentKey: false, impossible: false };
}
