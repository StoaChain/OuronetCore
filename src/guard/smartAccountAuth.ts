/**
 * `smartAccountAuth.ts` — Smart Ouronet Account auth-path resolution
 * primitives.
 *
 * Standard Ouronet Accounts (Ѻ.) are guarded by a single keyset stored
 * in their `guard` field; the chain checks that one keyset for any
 * mutation. Smart Ouronet Accounts (Σ.) are different: the chain
 * runs `enforce-one` over THREE auth branches and accepts the
 * transaction if ANY one branch's keyset is satisfied:
 *
 *   1. the Smart account's own guard
 *   2. the current sovereign account's guard
 *   3. the Smart account's governor
 *
 * The first two are always keysets (Standard accounts can only have
 * keyset guards by construction). The governor field is polymorphic
 * — it can be a keyset, a keyset-ref, a capability-guard, or a
 * user-guard. Only keyset/keyset-ref governors are signable by the
 * codex — capability-guards and user-guards require on-chain
 * capability acquisition that lives outside the ZBOM scope.
 *
 * This module exposes three primitives the UI's AuthPathZone (and
 * any future HUB/CLI tooling) builds on:
 *
 *   - `classifyGuardKind(g)` — pure shape discriminator. Maps a raw
 *     guard payload (as returned by the Pact `UR_AccountGuard` read
 *     or the `URC_0027_AccountSelectorMapper`) into one of five
 *     categories: `keyset`, `keyset-ref`, `capability`, `user`, or
 *     `unknown` (corrupt / unrecognised shape).
 *
 *   - `extractKeysetFromGuard(g)` — returns the keyset payload from
 *     keyset / already-resolved keyset-ref guards, otherwise `null`.
 *     Caller is responsible for resolving keyset-refs (via
 *     `resolveGuard`) before calling this if they want the keys to
 *     analyse. Inline keysets pass through unchanged.
 *
 *   - `analyzeSmartAccountAuthPaths(...)` — given the three guards
 *     plus the codex pub set + manually resolved keys, runs the
 *     classifier + extractor + `analyzeGuard` pipeline for each branch
 *     and returns a `SmartAccountAuthPaths` summary suitable for
 *     direct UI consumption.
 *
 * What this module does NOT do:
 *   - It does not fetch guards from chain. Callers feed in already-
 *     fetched guards (from URC_0027 selector or `getKadenaAccountGuard`).
 *   - It does not pick which branch to use. That's a UX decision;
 *     the analyzer just reports the satisfaction state of all three.
 *   - It does not modify `CodexSigningStrategy.execute`. The strategy
 *     stays AND-required over its `guards: IKeyset[]` argument; the UI
 *     resolves OR-of-3 to one chosen keyset before calling execute.
 *
 * Added in v1.6.0.
 */

import { analyzeGuard, type GuardAnalysis, type IKeyset } from "./guardUtils";

/**
 * Kinds of Pact guards we discriminate at runtime. Mirrors the shape
 * matrix the chain itself uses; matches OuronetUI's `<GuardTree>`
 * detection so guard rendering and auth analysis stay in lockstep.
 *
 *   - `keyset`       — inline `{ pred, keys: [...] }`
 *   - `keyset-ref`   — `{ keysetref: { ns, ksn } }` (pre-resolution)
 *   - `capability`   — `{ cgName, cgArgs, cgPactId }`
 *   - `user`         — `{ fun, args }`
 *   - `unknown`      — any other shape, including null / undefined
 */
export type GuardKind =
  | "keyset"
  | "keyset-ref"
  | "capability"
  | "user"
  | "unknown";

/**
 * Pure shape discriminator. Does not throw, does not mutate, does
 * not fetch. Maps any value to one of the five `GuardKind`s.
 *
 * Discrimination order matters — we check the most specific shape
 * first so a guard that happens to carry both `pred` and `cgName`
 * (impossible in practice but defensive) gets the more-specific
 * label. Mirrors `<GuardTree>`'s `detectGuardKind` 1:1.
 */
export function classifyGuardKind(g: unknown): GuardKind {
  if (g === null || g === undefined) return "unknown";
  if (typeof g !== "object" || Array.isArray(g)) return "unknown";
  const o = g as Record<string, unknown>;
  if ("cgName" in o && typeof o.cgName === "string") return "capability";
  if ("fun" in o && typeof o.fun === "string" && "args" in o) return "user";
  if (
    "keysetref" in o &&
    typeof o.keysetref === "object" &&
    o.keysetref !== null
  ) {
    return "keyset-ref";
  }
  if (
    "pred" in o &&
    typeof o.pred === "string" &&
    "keys" in o &&
    Array.isArray(o.keys)
  ) {
    return "keyset";
  }
  return "unknown";
}

/**
 * If the guard is a keyset (inline OR a resolved keyset-ref that has
 * been hydrated to `{ pred, keys }`), return the keyset payload.
 * Returns `null` for unresolved keyset-refs, capabilities, user-guards,
 * or unrecognised shapes.
 *
 * Call this AFTER resolving keyset-refs (use the existing
 * `resolveGuard` helper in `interactions/ouroFunctions`) if the upstream
 * data could include unresolved refs.
 */
export function extractKeysetFromGuard(g: unknown): IKeyset | null {
  if (classifyGuardKind(g) !== "keyset") return null;
  const o = g as { pred: string; keys: string[]; keysetRef?: string };
  return {
    pred: o.pred,
    keys: o.keys,
    ...(o.keysetRef ? { keysetRef: o.keysetRef } : {}),
  };
}

/** A single branch in the Smart-account auth analysis. */
export interface SmartAccountAuthBranch {
  /** Which of the three branches this row represents. */
  readonly which: "guard" | "sovereign" | "governor";
  /** Shape classification of the branch's guard. */
  readonly kind: GuardKind;
  /**
   * Whether the branch is even *signable* by the codex. True for
   * `keyset` (and resolved keyset-refs); false for everything else
   * including `unknown`.
   */
  readonly keyBased: boolean;
  /**
   * `analyzeGuard` output when `keyBased === true`. Null for non-
   * keyset branches (codex cannot reason about them).
   */
  readonly analysis: GuardAnalysis | null;
  /**
   * The raw guard payload as supplied. Useful for the UI to render
   * a `<GuardTree>` for non-keyset branches even when the analyzer
   * cannot help.
   */
  readonly rawGuard: unknown;
}

/**
 * Aggregated auth-path analysis for a Smart Ouronet Account.
 *
 * `branches` is always exactly three entries in canonical order
 * (guard / sovereign / governor) so the UI can render them with a
 * stable layout. The two derived flags express the most common
 * questions a CFM modal asks:
 *
 *   - `anyKeyBased` — at least one branch is signable. If false, the
 *     ZBOM cannot satisfy this transaction; the UI should refer the
 *     user to the Execute Code page where they can construct an
 *     ad-hoc capability acquisition.
 *
 *   - `firstSatisfied` — index of the first branch whose keyset is
 *     fully satisfied by the codex (+ optional manual keys). Useful
 *     as a default selection for the UI's auth-path picker. -1 when
 *     no branch is currently satisfied.
 */
export interface SmartAccountAuthPaths {
  readonly branches: readonly [
    SmartAccountAuthBranch,
    SmartAccountAuthBranch,
    SmartAccountAuthBranch,
  ];
  readonly anyKeyBased: boolean;
  readonly firstSatisfied: number; // 0 | 1 | 2 | -1
}

/**
 * Build a `SmartAccountAuthPaths` summary from the three guards plus
 * the codex pub set and any manually resolved keys.
 *
 * @param guards
 *   The three guards in canonical order. `accountGuard` is the Smart
 *   account's own guard; `sovereignGuard` is the on-chain guard of
 *   the account's `sovereign` field (resolve via
 *   `getKadenaAccountGuard(account.sovereign)`); `governor` is the
 *   account's governor field. Pass `null` if a guard could not be
 *   fetched — the corresponding branch will surface as `unknown`.
 *
 * @param codexPubs
 *   Set of public keys present in the codex (output of
 *   `buildCodexPubSet`).
 *
 * @param resolvedManualKeys
 *   Optional map of pubkey → privkey for keys the user manually
 *   provided. Same shape `analyzeGuard` accepts.
 */
export function analyzeSmartAccountAuthPaths(
  guards: {
    accountGuard:   unknown;
    sovereignGuard: unknown;
    governor:       unknown;
  },
  codexPubs: Set<string>,
  resolvedManualKeys: Record<string, string> = {},
): SmartAccountAuthPaths {
  const buildBranch = (
    which: "guard" | "sovereign" | "governor",
    rawGuard: unknown,
  ): SmartAccountAuthBranch => {
    const kind = classifyGuardKind(rawGuard);
    const keyBased = kind === "keyset"; // keyset-ref must be resolved upstream
    const ks = keyBased ? extractKeysetFromGuard(rawGuard) : null;
    const analysis = ks
      ? analyzeGuard(ks, codexPubs, resolvedManualKeys)
      : null;
    return { which, kind, keyBased, analysis, rawGuard };
  };

  const branches = [
    buildBranch("guard",     guards.accountGuard),
    buildBranch("sovereign", guards.sovereignGuard),
    buildBranch("governor",  guards.governor),
  ] as const;

  const anyKeyBased = branches.some((b) => b.keyBased);

  let firstSatisfied = -1;
  for (let i = 0; i < branches.length; i++) {
    if (branches[i].analysis?.satisfied) {
      firstSatisfied = i;
      break;
    }
  }

  return { branches, anyKeyBased, firstSatisfied };
}
