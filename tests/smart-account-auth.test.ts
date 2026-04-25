/**
 * smart-account-auth.test.ts — Tier 1, Group A from the testing
 * strategy doc.
 *
 * Covers the v1.6.0 additions in `src/guard/smartAccountAuth.ts`:
 *
 *   - `classifyGuardKind`   — pure shape discriminator
 *   - `extractKeysetFromGuard` — keyset payload pulling
 *   - `analyzeSmartAccountAuthPaths` — three-branch summary
 *
 * The discriminator's truth-table has to match OuronetUI's
 * `<GuardTree>` 1:1 — these tests pin the contract so future
 * additions can't drift the two apart.
 */

import { describe, it, expect } from "vitest";
import {
  classifyGuardKind,
  extractKeysetFromGuard,
  analyzeSmartAccountAuthPaths,
} from "../src/guard/smartAccountAuth";

// ─── Fixture guards (one of each shape) ─────────────────────────────────────

const KEYSET = {
  pred: "keys-all",
  keys: ["pubA", "pubB"],
};

const KEYSET_REF_UNRESOLVED = {
  keysetref: { ns: "ouronet-ns", ksn: "dh_sc_dpdc-keyset" },
};

const CAPABILITY_GUARD = {
  cgName: "ouronet-ns.MOD.CAP_X",
  cgArgs: ["arg1", 42],
  cgPactId: null,
};

const USER_GUARD = {
  fun: "ouronet-ns.MOD.UEV_Any",
  args: ["acc-1", "acc-2"],
};

// ─── classifyGuardKind ─────────────────────────────────────────────────────

describe("classifyGuardKind", () => {
  it("recognises an inline keyset", () => {
    expect(classifyGuardKind(KEYSET)).toBe("keyset");
  });
  it("recognises an unresolved keyset-ref", () => {
    expect(classifyGuardKind(KEYSET_REF_UNRESOLVED)).toBe("keyset-ref");
  });
  it("recognises a capability guard", () => {
    expect(classifyGuardKind(CAPABILITY_GUARD)).toBe("capability");
  });
  it("recognises a user guard", () => {
    expect(classifyGuardKind(USER_GUARD)).toBe("user");
  });

  it("returns 'unknown' for null / undefined", () => {
    expect(classifyGuardKind(null)).toBe("unknown");
    expect(classifyGuardKind(undefined)).toBe("unknown");
  });
  it("returns 'unknown' for primitives and arrays", () => {
    expect(classifyGuardKind("plain string")).toBe("unknown");
    expect(classifyGuardKind(42)).toBe("unknown");
    expect(classifyGuardKind(true)).toBe("unknown");
    expect(classifyGuardKind([1, 2, 3])).toBe("unknown");
  });
  it("returns 'unknown' for objects with no recognised discriminator field", () => {
    expect(classifyGuardKind({ random: "shape" })).toBe("unknown");
  });

  it("orders specificity: capability > user > keyset-ref > keyset", () => {
    // Defensive: a guard carrying both cgName and pred (impossible in
    // practice but easy to construct) must classify as the more
    // specific 'capability'. Mirrors GuardTree's order.
    const overlap = { cgName: "x", cgArgs: [], cgPactId: null, pred: "p", keys: [] };
    expect(classifyGuardKind(overlap)).toBe("capability");
  });
});

// ─── extractKeysetFromGuard ─────────────────────────────────────────────────

describe("extractKeysetFromGuard", () => {
  it("returns the keyset for an inline keyset guard", () => {
    expect(extractKeysetFromGuard(KEYSET)).toEqual({ pred: "keys-all", keys: ["pubA", "pubB"] });
  });
  it("preserves keysetRef field when present (resolved keyset-ref)", () => {
    const resolved = { pred: "keys-2", keys: ["x", "y", "z"], keysetRef: "ouronet-ns.foo-keyset" };
    expect(extractKeysetFromGuard(resolved)).toEqual({
      pred: "keys-2",
      keys: ["x", "y", "z"],
      keysetRef: "ouronet-ns.foo-keyset",
    });
  });
  it("returns null for unresolved keyset-refs", () => {
    expect(extractKeysetFromGuard(KEYSET_REF_UNRESOLVED)).toBeNull();
  });
  it("returns null for capability and user guards", () => {
    expect(extractKeysetFromGuard(CAPABILITY_GUARD)).toBeNull();
    expect(extractKeysetFromGuard(USER_GUARD)).toBeNull();
  });
  it("returns null for null / undefined / primitives", () => {
    expect(extractKeysetFromGuard(null)).toBeNull();
    expect(extractKeysetFromGuard(undefined)).toBeNull();
    expect(extractKeysetFromGuard("not a guard")).toBeNull();
  });
});

// ─── analyzeSmartAccountAuthPaths ───────────────────────────────────────────

describe("analyzeSmartAccountAuthPaths", () => {
  const codex = new Set<string>(["pubA"]);

  it("returns three branches in canonical order", () => {
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: KEYSET, sovereignGuard: KEYSET, governor: KEYSET },
      codex,
    );
    expect(r.branches).toHaveLength(3);
    expect(r.branches[0].which).toBe("guard");
    expect(r.branches[1].which).toBe("sovereign");
    expect(r.branches[2].which).toBe("governor");
  });

  it("classifies a mixed Smart account: keyset / keyset / user-guard", () => {
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: KEYSET, sovereignGuard: KEYSET, governor: USER_GUARD },
      codex,
    );
    expect(r.branches[0].kind).toBe("keyset");
    expect(r.branches[1].kind).toBe("keyset");
    expect(r.branches[2].kind).toBe("user");
    expect(r.branches[0].keyBased).toBe(true);
    expect(r.branches[1].keyBased).toBe(true);
    expect(r.branches[2].keyBased).toBe(false);
  });

  it("runs analyzeGuard on key-based branches and leaves the rest as null", () => {
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: KEYSET, sovereignGuard: USER_GUARD, governor: CAPABILITY_GUARD },
      codex,
    );
    expect(r.branches[0].analysis).not.toBeNull();
    expect(r.branches[0].analysis?.codexKeys).toEqual(["pubA"]);
    expect(r.branches[1].analysis).toBeNull();
    expect(r.branches[2].analysis).toBeNull();
  });

  it("computes anyKeyBased correctly", () => {
    expect(
      analyzeSmartAccountAuthPaths(
        { accountGuard: USER_GUARD, sovereignGuard: CAPABILITY_GUARD, governor: USER_GUARD },
        codex,
      ).anyKeyBased,
    ).toBe(false);

    expect(
      analyzeSmartAccountAuthPaths(
        { accountGuard: USER_GUARD, sovereignGuard: KEYSET, governor: CAPABILITY_GUARD },
        codex,
      ).anyKeyBased,
    ).toBe(true);
  });

  it("computes firstSatisfied = -1 when no branch is satisfied", () => {
    // KEYSET requires both pubA + pubB (keys-all of 2). Codex only has pubA.
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: KEYSET, sovereignGuard: KEYSET, governor: KEYSET },
      new Set(["pubA"]),
    );
    expect(r.firstSatisfied).toBe(-1);
  });

  it("computes firstSatisfied to the earliest satisfied branch", () => {
    // KEYSET keys-all of 2 — satisfied when codex has BOTH keys.
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: USER_GUARD, sovereignGuard: KEYSET, governor: KEYSET },
      new Set(["pubA", "pubB"]),
    );
    // Branch 0 is user-guard (not satisfied — not key-based).
    // Branch 1 is keyset, fully satisfied.
    expect(r.firstSatisfied).toBe(1);
  });

  it("handles null guards (guard fetch failure) as 'unknown' / non-key-based", () => {
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: null, sovereignGuard: undefined, governor: null },
      codex,
    );
    expect(r.branches.every((b) => b.kind === "unknown")).toBe(true);
    expect(r.anyKeyBased).toBe(false);
    expect(r.firstSatisfied).toBe(-1);
  });

  it("threads resolvedManualKeys through to analyzeGuard", () => {
    const r = analyzeSmartAccountAuthPaths(
      { accountGuard: { pred: "keys-all", keys: ["pubA", "pubB"] }, sovereignGuard: USER_GUARD, governor: USER_GUARD },
      new Set(["pubA"]),
      // Manual key for pubB → branch 0 should now be satisfied.
      { pubB: "0".repeat(64) },
    );
    expect(r.branches[0].analysis?.satisfied).toBe(true);
    expect(r.firstSatisfied).toBe(0);
  });
});
