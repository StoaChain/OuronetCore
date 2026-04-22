/**
 * guardUtils.ts regression suite — Phase -1.2 extraction safety net.
 *
 * This is the second most-critical test module (after encryption): a silent
 * regression in analyzeGuard / selectCapsSigningKey would cause multi-sig
 * guards to stop signing correctly, or the GAS_PAYER key to collide with a
 * pure-signer key — both result in transactions that build fine but fail
 * on-chain with obscure capability errors.
 */

import { describe, it, expect } from "vitest";
import {
  computeThreshold,
  predicateLabel,
  analyzeGuard,
  buildCodexPubSet,
  classifyPaymentKey,
  tryDerivePublicKey,
  selectCapsSigningKey,
} from "../src/guard";

// ══ computeThreshold ══════════════════════════════════════════════════════════
describe("computeThreshold", () => {
  describe("standard predicates", () => {
    it("keys-all = full keyset size", () => {
      expect(computeThreshold("keys-all", 1)).toBe(1);
      expect(computeThreshold("keys-all", 3)).toBe(3);
      expect(computeThreshold("keys-all", 10)).toBe(10);
    });

    it("keys-any = 1", () => {
      expect(computeThreshold("keys-any", 1)).toBe(1);
      expect(computeThreshold("keys-any", 5)).toBe(1);
      expect(computeThreshold("keys-any", 100)).toBe(1);
    });

    it("keys-2 = min(2, keyCount)", () => {
      expect(computeThreshold("keys-2", 1)).toBe(1);   // degenerate — single key
      expect(computeThreshold("keys-2", 2)).toBe(2);
      expect(computeThreshold("keys-2", 3)).toBe(2);
      expect(computeThreshold("keys-2", 10)).toBe(2);
    });
  });

  describe("stoic fixed predicates (keys-1, keys-3, keys-4)", () => {
    it("keys-1 = min(1, keyCount)", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-1", 5)).toBe(1);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-1", 1)).toBe(1);
    });

    it("keys-3 = min(3, keyCount)", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-3", 5)).toBe(3);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-3", 2)).toBe(2);
    });

    it("keys-4 = min(4, keyCount)", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-4", 10)).toBe(4);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-4", 3)).toBe(3);
    });
  });

  describe("stoic M-of-N predicates", () => {
    it("keys-2-of-3 = min(2, keyCount)", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-2-of-3", 3)).toBe(2);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-2-of-3", 1)).toBe(1);
    });

    it("keys-3-of-5, keys-4-of-7, keys-5-of-9", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-3-of-5", 5)).toBe(3);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-4-of-7", 7)).toBe(4);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-5-of-9", 9)).toBe(5);
    });
  });

  describe("stoic percentage predicates (use ceil)", () => {
    it("at-least-51pct ceils up", () => {
      // Math.ceil(3 * 0.51) = 2
      expect(computeThreshold("stoa-ns.stoic-predicates.at-least-51pct", 3)).toBe(2);
      expect(computeThreshold("stoa-ns.stoic-predicates.at-least-51pct", 10)).toBe(6);
    });

    it("at-least-66pct", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.at-least-66pct", 3)).toBe(2);
      expect(computeThreshold("stoa-ns.stoic-predicates.at-least-66pct", 9)).toBe(6);
    });

    it("at-least-75pct, at-least-90pct", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.at-least-75pct", 4)).toBe(3);
      expect(computeThreshold("stoa-ns.stoic-predicates.at-least-90pct", 10)).toBe(9);
    });
  });

  describe("stoic tolerance predicates", () => {
    it("all-but-one = max(1, keyCount - 1)", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.all-but-one", 3)).toBe(2);
      expect(computeThreshold("stoa-ns.stoic-predicates.all-but-one", 5)).toBe(4);
      expect(computeThreshold("stoa-ns.stoic-predicates.all-but-one", 1)).toBe(1);  // floor at 1
    });

    it("all-but-two = max(1, keyCount - 2)", () => {
      expect(computeThreshold("stoa-ns.stoic-predicates.all-but-two", 5)).toBe(3);
      expect(computeThreshold("stoa-ns.stoic-predicates.all-but-two", 2)).toBe(1);  // floor at 1
      expect(computeThreshold("stoa-ns.stoic-predicates.all-but-two", 1)).toBe(1);
    });
  });

  describe("edge cases", () => {
    it("returns 0 for empty keyset regardless of predicate", () => {
      expect(computeThreshold("keys-all", 0)).toBe(0);
      expect(computeThreshold("keys-any", 0)).toBe(0);
      expect(computeThreshold("keys-2", 0)).toBe(0);
      expect(computeThreshold("stoa-ns.stoic-predicates.keys-3", 0)).toBe(0);
    });

    it("unknown predicate falls back to keys-all (conservative)", () => {
      // Warn is expected but not part of the assertion
      expect(computeThreshold("some-unknown-predicate", 5)).toBe(5);
      expect(computeThreshold("", 3)).toBe(3);
    });
  });
});

// ══ predicateLabel ═══════════════════════════════════════════════════════════
describe("predicateLabel", () => {
  it("keys-any shows '1 of N'", () => {
    expect(predicateLabel("keys-any", 3)).toBe("keys-any (1 of 3)");
  });

  it("keys-all shows 'N of N'", () => {
    expect(predicateLabel("keys-all", 3)).toBe("keys-all (3 of 3)");
  });

  it("other predicates use the short name (last dot-segment)", () => {
    expect(predicateLabel("keys-2", 3)).toBe("keys-2 (2 of 3)");
    expect(predicateLabel("stoa-ns.stoic-predicates.keys-3-of-5", 5))
      .toBe("keys-3-of-5 (3 of 5)");
  });
});

// ══ analyzeGuard ══════════════════════════════════════════════════════════════
describe("analyzeGuard", () => {
  const PUB1 = "a".repeat(64);
  const PUB2 = "b".repeat(64);
  const PUB3 = "c".repeat(64);
  const FOREIGN = "f".repeat(64);

  describe("null / empty guards", () => {
    it("handles null guard as satisfied-empty", () => {
      const r = analyzeGuard(null, new Set([PUB1]));
      expect(r.satisfied).toBe(true);
      expect(r.threshold).toBe(0);
      expect(r.keys).toEqual([]);
      expect(r.neededMore).toBe(0);
    });

    it("handles undefined guard", () => {
      const r = analyzeGuard(undefined, new Set([PUB1]));
      expect(r.satisfied).toBe(true);
    });

    it("handles guard with empty keys array", () => {
      const r = analyzeGuard({ keys: [], pred: "keys-all" }, new Set([PUB1]));
      expect(r.satisfied).toBe(true);
      expect(r.threshold).toBe(0);
    });
  });

  describe("all-codex (no foreign keys)", () => {
    it("keys-all, 3/3 in Codex → satisfied", () => {
      const r = analyzeGuard(
        { keys: [PUB1, PUB2, PUB3], pred: "keys-all" },
        new Set([PUB1, PUB2, PUB3]),
      );
      expect(r.threshold).toBe(3);
      expect(r.codexKeys).toEqual([PUB1, PUB2, PUB3]);
      expect(r.foreignKeys).toEqual([]);
      expect(r.signable).toBe(3);
      expect(r.satisfied).toBe(true);
      expect(r.neededMore).toBe(0);
    });

    it("keys-any, any in Codex → satisfied", () => {
      const r = analyzeGuard(
        { keys: [PUB1, PUB2], pred: "keys-any" },
        new Set([PUB1]),
      );
      expect(r.threshold).toBe(1);
      expect(r.codexKeys).toEqual([PUB1]);
      expect(r.foreignKeys).toEqual([PUB2]);
      expect(r.satisfied).toBe(true);
    });

    it("keys-2, 2/3 in Codex → satisfied", () => {
      const r = analyzeGuard(
        { keys: [PUB1, PUB2, PUB3], pred: "keys-2" },
        new Set([PUB1, PUB2]),
      );
      expect(r.threshold).toBe(2);
      expect(r.codexKeys).toEqual([PUB1, PUB2]);
      expect(r.foreignKeys).toEqual([PUB3]);
      expect(r.signable).toBe(2);
      expect(r.satisfied).toBe(true);
    });
  });

  describe("foreign keys (in guard but not in Codex)", () => {
    it("partitions codex vs foreign correctly", () => {
      const r = analyzeGuard(
        { keys: [PUB1, FOREIGN, PUB2], pred: "keys-all" },
        new Set([PUB1, PUB2]),
      );
      expect(r.codexKeys.sort()).toEqual([PUB1, PUB2].sort());
      expect(r.foreignKeys).toEqual([FOREIGN]);
    });

    it("keys-all with 1 foreign → unsatisfied, neededMore=1", () => {
      const r = analyzeGuard(
        { keys: [PUB1, FOREIGN], pred: "keys-all" },
        new Set([PUB1]),
      );
      expect(r.threshold).toBe(2);
      expect(r.signable).toBe(1);
      expect(r.satisfied).toBe(false);
      expect(r.neededMore).toBe(1);
    });

    it("keys-2 with 1 codex + 1 foreign + 1 codex → satisfied (threshold met by codex alone)", () => {
      const r = analyzeGuard(
        { keys: [PUB1, FOREIGN, PUB2], pred: "keys-2" },
        new Set([PUB1, PUB2]),
      );
      expect(r.threshold).toBe(2);
      expect(r.signable).toBe(2);
      expect(r.satisfied).toBe(true);
    });
  });

  describe("resolved manual keys (foreign key user has pasted)", () => {
    it("resolvedForeignKeys boosts signable", () => {
      const r = analyzeGuard(
        { keys: [PUB1, FOREIGN], pred: "keys-all" },
        new Set([PUB1]),
        { [FOREIGN]: "f".repeat(64) }, // user pasted the key
      );
      expect(r.threshold).toBe(2);
      expect(r.codexKeys).toEqual([PUB1]);
      expect(r.foreignKeys).toEqual([FOREIGN]);
      expect(r.resolvedForeignKeys).toEqual([FOREIGN]);
      expect(r.signable).toBe(2);  // codex + resolved
      expect(r.satisfied).toBe(true);
    });

    it("only counts manual keys that are in foreignKeys", () => {
      // User pasted a key that's NOT in the guard — noise should be ignored
      const r = analyzeGuard(
        { keys: [PUB1, PUB2], pred: "keys-all" },
        new Set([PUB1, PUB2]),
        { [FOREIGN]: "whatever" },  // FOREIGN not in the guard
      );
      expect(r.resolvedForeignKeys).toEqual([]);
    });

    it("empty/falsy manual values are not counted as resolved", () => {
      const r = analyzeGuard(
        { keys: [FOREIGN], pred: "keys-all" },
        new Set(),
        { [FOREIGN]: "" },  // empty string = not resolved
      );
      expect(r.resolvedForeignKeys).toEqual([]);
      expect(r.satisfied).toBe(false);
    });
  });

  describe("threshold math edge cases", () => {
    it("keys-2-of-3 with 1 codex + 2 foreign → neededMore=1", () => {
      const r = analyzeGuard(
        { keys: [PUB1, PUB2, PUB3], pred: "stoa-ns.stoic-predicates.keys-2-of-3" },
        new Set([PUB1]),
      );
      expect(r.threshold).toBe(2);
      expect(r.signable).toBe(1);
      expect(r.neededMore).toBe(1);
    });

    it("keys-all with all foreign → unsatisfied, neededMore=N", () => {
      const r = analyzeGuard(
        { keys: [PUB1, PUB2, PUB3], pred: "keys-all" },
        new Set(),
      );
      expect(r.threshold).toBe(3);
      expect(r.signable).toBe(0);
      expect(r.neededMore).toBe(3);
    });
  });
});

// ══ buildCodexPubSet ══════════════════════════════════════════════════════════
describe("buildCodexPubSet", () => {
  const PUB_A = "a".repeat(64);
  const PUB_B = "b".repeat(64);
  const PUB_C = "c".repeat(64);
  const PUB_D = "d".repeat(64);

  it("pulls pubkeys from seed.accounts[]", () => {
    const seeds = [
      { accounts: [{ publicKey: PUB_A }, { publicKey: PUB_B }] },
    ];
    expect(buildCodexPubSet(seeds, undefined, undefined))
      .toEqual(new Set([PUB_A, PUB_B]));
  });

  it("pulls pubkeys from flattened kadenaAccounts[]", () => {
    const accounts = [{ publicKey: PUB_A }, { publicKey: PUB_B }];
    expect(buildCodexPubSet(undefined, accounts, undefined))
      .toEqual(new Set([PUB_A, PUB_B]));
  });

  it("pulls pubkeys from pureKeypairs[]", () => {
    const pure = [{ publicKey: PUB_C }, { publicKey: PUB_D }];
    expect(buildCodexPubSet(undefined, undefined, pure))
      .toEqual(new Set([PUB_C, PUB_D]));
  });

  it("merges all three sources, deduplicating (Set semantics)", () => {
    const seeds = [{ accounts: [{ publicKey: PUB_A }, { publicKey: PUB_B }] }];
    const accounts = [{ publicKey: PUB_B }, { publicKey: PUB_C }];  // PUB_B dup
    const pure = [{ publicKey: PUB_D }];
    const set = buildCodexPubSet(seeds, accounts, pure);
    expect(set).toEqual(new Set([PUB_A, PUB_B, PUB_C, PUB_D]));
    expect(set.size).toBe(4);
  });

  it("handles all undefined inputs gracefully", () => {
    expect(buildCodexPubSet(undefined, undefined, undefined))
      .toEqual(new Set());
  });

  it("skips seeds without accounts array", () => {
    const seeds = [{ accounts: undefined }, { /* no accounts field */ }];
    expect(buildCodexPubSet(seeds as any, undefined, undefined))
      .toEqual(new Set());
  });

  it("skips accounts with missing publicKey", () => {
    const accounts = [{ publicKey: PUB_A }, { publicKey: null }, {}];
    expect(buildCodexPubSet(undefined, accounts as any, undefined))
      .toEqual(new Set([PUB_A]));
  });
});

// ══ classifyPaymentKey ════════════════════════════════════════════════════════
describe("classifyPaymentKey", () => {
  const PUB = "a".repeat(64);

  it("null input → null output", () => {
    expect(classifyPaymentKey(null)).toBe(null);
  });

  it("k: prefix → k-account, pubkey stripped", () => {
    const r = classifyPaymentKey(`k:${PUB}`);
    expect(r).toEqual({ address: `k:${PUB}`, type: "k-account", pubkey: PUB });
  });

  it("non-k: prefix → custom-account, null pubkey", () => {
    expect(classifyPaymentKey("c:HashBasedNsRef-xyz"))
      .toEqual({ address: "c:HashBasedNsRef-xyz", type: "custom-account", pubkey: null });
    expect(classifyPaymentKey("coin-gas-station"))
      .toEqual({ address: "coin-gas-station", type: "custom-account", pubkey: null });
    expect(classifyPaymentKey("u:user-guard-xyz"))
      .toEqual({ address: "u:user-guard-xyz", type: "custom-account", pubkey: null });
  });

  it("empty string → null (falsy)", () => {
    expect(classifyPaymentKey("")).toBe(null);
  });
});

// ══ tryDerivePublicKey ════════════════════════════════════════════════════════
describe("tryDerivePublicKey", () => {
  // RFC 8032 Ed25519 test vector 1
  const RFC8032_PRIV = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
  const RFC8032_PUB  = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

  it("derives public key from a valid 64-char Ed25519 private key", () => {
    const result = tryDerivePublicKey(RFC8032_PRIV);
    expect(result).toBe(RFC8032_PUB);
  });

  it("returns null for invalid lengths", () => {
    expect(tryDerivePublicKey("")).toBe(null);
    expect(tryDerivePublicKey("a".repeat(32))).toBe(null);  // half-length
    expect(tryDerivePublicKey("a".repeat(63))).toBe(null);  // one off
    expect(tryDerivePublicKey("a".repeat(65))).toBe(null);
    expect(tryDerivePublicKey("a".repeat(127))).toBe(null);
    expect(tryDerivePublicKey("a".repeat(200))).toBe(null);
  });

  it("returns null (or catches errors) for non-hex input of correct length", () => {
    const result = tryDerivePublicKey("z".repeat(64));
    // Either null or a defensive-fallback — must not throw
    expect(result === null || typeof result === "string").toBe(true);
  });
});

// ══ selectCapsSigningKey ══════════════════════════════════════════════════════
describe("selectCapsSigningKey", () => {
  const PAYMENT = "p".repeat(64);
  const K1      = "1".repeat(64);
  const K2      = "2".repeat(64);
  const K3      = "3".repeat(64);

  describe("best case: payment key in Codex, not pure-signing", () => {
    it("picks the payment key", () => {
      const r = selectCapsSigningKey(
        PAYMENT,
        new Set([PAYMENT, K1]),
        new Set(),
      );
      expect(r).toEqual({ key: PAYMENT, isPaymentKey: true, impossible: false });
    });
  });

  describe("fallback: any Codex key not in pure-signing", () => {
    it("picks the first Codex key not pure-signing when payment key not in Codex", () => {
      const r = selectCapsSigningKey(
        PAYMENT,                    // payment key not in Codex
        new Set([K1, K2]),
        new Set([K1]),              // K1 reserved for pure signing
      );
      expect(r.key).toBe(K2);
      expect(r.isPaymentKey).toBe(false);
      expect(r.impossible).toBe(false);
    });

    it("picks any free Codex key when payment key is null", () => {
      const r = selectCapsSigningKey(null, new Set([K1, K2]), new Set([K1]));
      expect(r.key).toBe(K2);
      expect(r.isPaymentKey).toBe(false);
    });

    it("picks free key when payment key is in Codex but reserved for pure signing", () => {
      // Payment key IS in codex, but also in pure signing — must fall back
      const r = selectCapsSigningKey(
        PAYMENT,
        new Set([PAYMENT, K1]),
        new Set([PAYMENT]),         // payment is pure-signing → not eligible for caps
      );
      expect(r.key).toBe(K1);
      expect(r.isPaymentKey).toBe(false);
      expect(r.impossible).toBe(false);
    });
  });

  describe("impossible case: payment key reserved AND no fallback available", () => {
    it("returns impossible=true when payment key is in pure signing and Codex has no other free key", () => {
      const r = selectCapsSigningKey(
        PAYMENT,
        new Set([PAYMENT]),
        new Set([PAYMENT]),          // payment is the only Codex key AND is reserved
      );
      expect(r).toEqual({ key: null, isPaymentKey: true, impossible: true });
    });

    it("returns key=null (not impossible) when Codex is empty and no payment key", () => {
      const r = selectCapsSigningKey(null, new Set(), new Set());
      expect(r).toEqual({ key: null, isPaymentKey: false, impossible: false });
    });

    it("returns key=null (not impossible) when all Codex keys are in pure signing but payment key is not involved", () => {
      const r = selectCapsSigningKey(
        null,
        new Set([K1, K2]),
        new Set([K1, K2]),           // all pure-signing, no payment key
      );
      expect(r.key).toBe(null);
      expect(r.impossible).toBe(false);  // not a payment-key conflict
    });
  });

  describe("real-world multi-sig scenario", () => {
    it("2-of-3 guard: picks a codex key not among the 2 guard signers", () => {
      // Guard has K1, K2, K3 — wallet signs with K1 and K2 for pure. K3 is free.
      const codex = new Set([K1, K2, K3]);
      const pure  = new Set([K1, K2]);
      const r = selectCapsSigningKey(null, codex, pure);
      expect(r.key).toBe(K3);
      expect(r.impossible).toBe(false);
    });
  });
});

// ══ Multi-guard scenarios (integration with analyzeGuard + selectCapsSigningKey)
// These exercise the flow CodexSigningStrategy.execute runs internally — what
// happens when BOTH a patron guard AND a resident guard need to sign on the
// same tx. Regressions here brick every 2-guard CFM modal (Coil, Transfer,
// Awake, Slumber, etc. — 18 of our 23 CFM modals).

describe("multi-guard scenario (patron + resident, both codex)", () => {
  const CODEX_KEYS = new Set([
    "00".repeat(32),                       // "caps candidate" — in codex, in no guard
    "a".repeat(64),                        // patron
    "b".repeat(64),                        // resident
  ]);
  const PATRON_GUARD: any   = { pred: "keys-all", keys: ["a".repeat(64)] };
  const RESIDENT_GUARD: any = { pred: "keys-all", keys: ["b".repeat(64)] };

  it("patron and resident each contribute one key; caps picks the remaining codex key", () => {
    const patronAn   = analyzeGuard(PATRON_GUARD,   CODEX_KEYS);
    const residentAn = analyzeGuard(RESIDENT_GUARD, CODEX_KEYS);

    const pureSigning = new Set<string>([
      ...patronAn.codexKeys,   ...patronAn.resolvedForeignKeys,
      ...residentAn.codexKeys, ...residentAn.resolvedForeignKeys,
    ]);

    const caps = selectCapsSigningKey(null, CODEX_KEYS, pureSigning);
    expect(caps.key).toBe("00".repeat(32));
    expect(caps.impossible).toBe(false);
  });

  it("patron == resident (same key): pureSigning has 1 member, caps picks one of the others", () => {
    const sameKey = "a".repeat(64);
    const patronAn   = analyzeGuard({ pred: "keys-all", keys: [sameKey] }, CODEX_KEYS);
    const residentAn = analyzeGuard({ pred: "keys-all", keys: [sameKey] }, CODEX_KEYS);
    const pureSigning = new Set<string>([
      ...patronAn.codexKeys, ...residentAn.codexKeys,
    ]);
    expect(pureSigning.size).toBe(1); // key-level dedup via Set

    const caps = selectCapsSigningKey(null, CODEX_KEYS, pureSigning);
    expect(caps.key).not.toBe(sameKey);
    expect(caps.key).toBeTruthy();
  });

  it("impossible: 2-guard tx where all codex keys are needed for signing", () => {
    const TIGHT_CODEX = new Set(["a".repeat(64), "b".repeat(64)]);
    const patronAn   = analyzeGuard({ pred: "keys-all", keys: ["a".repeat(64)] }, TIGHT_CODEX);
    const residentAn = analyzeGuard({ pred: "keys-all", keys: ["b".repeat(64)] }, TIGHT_CODEX);
    const pureSigning = new Set<string>([
      ...patronAn.codexKeys, ...residentAn.codexKeys,
    ]);

    const caps = selectCapsSigningKey(null, TIGHT_CODEX, pureSigning);
    // No free codex key → selectCapsSigningKey returns null.
    // Not "impossible" in the sense of a payment-key conflict; just no caps available.
    expect(caps.key).toBe(null);
    expect(caps.impossible).toBe(false);
  });
});

// ══ Keyset-ref guards — on-chain keyset names
// Some guards reference a named keyset (e.g. "ouronet-ns.dh_sc_dpdc-keyset")
// rather than inlining the pubkey list. analyzeGuard treats the keys array
// as the source of truth; the keysetRef is metadata for UI display. Test
// that analyzeGuard doesn't trip on the extra field.

describe("keyset-ref guards (on-chain named keysets)", () => {
  const PUB = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";

  it("keysetRef field is preserved + analyzeGuard still inspects .keys", () => {
    const guardWithRef: any = {
      pred: "keys-all",
      keys: [PUB],
      keysetRef: "ouronet-ns.dh_sc_dpdc-keyset",
    };
    const result = analyzeGuard(guardWithRef, new Set([PUB]));
    expect(result.satisfied).toBe(true);
    expect(result.signable).toBe(1);
  });

  it("keysetRef with foreign-only keys still correctly partitions", () => {
    const guardWithRef: any = {
      pred: "keys-all",
      keys: [PUB],
      keysetRef: "ouronet-ns.some-keyset",
    };
    // PUB NOT in codex → classified as foreign
    const result = analyzeGuard(guardWithRef, new Set());
    expect(result.codexKeys).toEqual([]);
    expect(result.foreignKeys).toEqual([PUB]);
    expect(result.satisfied).toBe(false);
  });
});
