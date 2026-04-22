/**
 * CFM Pact-code builder tests — Tier 1, Group A from the testing
 * strategy doc. One test per builder, verifying the exact Pact-code
 * string shape a canonical input produces.
 *
 * These catch:
 *   - Pact function-name typos (C_Coyl vs C_Coil, missing underscore)
 *   - Namespace drift (ouronet-ns hardcoded correctly)
 *   - Module + function separator (| vs :)
 *   - Argument ORDER (swapping patron + resident = silent on-chain failure)
 *   - Quoting (strings quoted, decimals/ints bare)
 *   - Decimal formatting (amount "5" → "5.0", not "5")
 *
 * Every CFM modal in OuronetUI now imports its builder from here
 * instead of inlining the template literal. If you're adding a new
 * CFM function, add its builder + test together.
 */

import { describe, it, expect } from "vitest";
import {
  buildTransferPactCode,
  buildClearDispoPactCode,
  buildSublimatePactCode,
  buildCompressPactCode,
  buildCoilPactCode,
  buildCurlPactCode,
  buildBrumatePactCode,
  buildConstrictPactCode,
  buildColdRecoveryPactCode,
  buildDirectRecoveryPactCode,
  buildCullPactCode,
  buildAwakePactCode,
  buildSlumberPactCode,
  buildFirestarterPactCode,
} from "../src/pact/cfmBuilders";

// ─── Canonical fixture values (used across many tests) ──────────────────────

const PATRON   = "ouro:PATRON-A";
const RESIDENT = "ouro:RESIDENT-B";
const SENDER   = RESIDENT;
const RECEIVER = "ouro:RECEIVER-C";
const ATS_A    = "Auryndex-O136CBn22ncY";
const ATS_B    = "EliteAuryndex-O136CBn22ncY";
const RT       = "OURO";          // reward-token id
const TOKEN    = "GSTOA-xyz";     // generic token-id for Transfer
const DPOF     = "H|GSTOA-xyz";

// ─── TS01-C1.DPTF — Transfer + ClearDispo ───────────────────────────────────

describe("buildTransferPactCode", () => {
  it("emits the canonical 6-arg C_Transfer shape", () => {
    expect(
      buildTransferPactCode({
        patron: PATRON, tokenId: TOKEN, sender: SENDER,
        receiver: RECEIVER, amount: "5", method: false,
      }),
    ).toBe(
      `(ouronet-ns.TS01-C1.DPTF|C_Transfer "${PATRON}" "${TOKEN}" "${SENDER}" "${RECEIVER}" 5.0 false)`,
    );
  });

  it("formats integer amounts with .0 suffix (Pact decimal lexer)", () => {
    const code = buildTransferPactCode({
      patron: PATRON, tokenId: TOKEN, sender: SENDER,
      receiver: RECEIVER, amount: "1000", method: false,
    });
    expect(code).toContain(" 1000.0 ");
  });

  it("preserves fractional amounts verbatim", () => {
    const code = buildTransferPactCode({
      patron: PATRON, tokenId: TOKEN, sender: SENDER,
      receiver: RECEIVER, amount: "3.14159", method: false,
    });
    expect(code).toContain(" 3.14159 ");
  });

  it("emits method=true for smart-account flows", () => {
    const code = buildTransferPactCode({
      patron: PATRON, tokenId: TOKEN, sender: SENDER,
      receiver: RECEIVER, amount: "1", method: true,
    });
    expect(code).toMatch(/ true\)$/);
  });
});

describe("buildClearDispoPactCode", () => {
  it("emits the 2-arg C_ClearDispo shape", () => {
    expect(
      buildClearDispoPactCode({ patron: PATRON, account: RESIDENT }),
    ).toBe(
      `(ouronet-ns.TS01-C1.DPTF|C_ClearDispo "${PATRON}" "${RESIDENT}")`,
    );
  });
});

// ─── TS01-C2.ORBR — Sublimate + Compress ────────────────────────────────────

describe("buildSublimatePactCode", () => {
  it("emits the 3-arg C_Sublimate shape", () => {
    expect(
      buildSublimatePactCode({ client: RESIDENT, target: RESIDENT, amount: "1" }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ORBR|C_Sublimate "${RESIDENT}" "${RESIDENT}" 1.0)`,
    );
  });

  it("supports gift-style where client !== target", () => {
    const code = buildSublimatePactCode({ client: RESIDENT, target: RECEIVER, amount: "2.5" });
    expect(code).toContain(`"${RESIDENT}" "${RECEIVER}"`);
  });
});

describe("buildCompressPactCode", () => {
  it("emits the 2-arg C_Compress shape with .0-formatted integer amount", () => {
    expect(
      buildCompressPactCode({ client: RESIDENT, ignisAmount: "5" }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ORBR|C_Compress "${RESIDENT}" 5.0)`,
    );
  });
});

// ─── TS01-C2.ATS — autostake pool (Coil/Curl/Brumate/Constrict/...) ─────────

describe("buildCoilPactCode", () => {
  it("emits the 5-arg C_Coil shape", () => {
    expect(
      buildCoilPactCode({
        patron: PATRON, coiler: RESIDENT, atsId: ATS_A,
        rewardTokenId: RT, amount: "100",
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Coil "${PATRON}" "${RESIDENT}" "${ATS_A}" "${RT}" 100.0)`,
    );
  });
});

describe("buildCurlPactCode", () => {
  it("emits the 6-arg C_Curl shape (two ats ids)", () => {
    expect(
      buildCurlPactCode({
        patron: PATRON, curler: RESIDENT, ats1Id: ATS_A, ats2Id: ATS_B,
        rewardTokenId: RT, amount: "50",
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Curl "${PATRON}" "${RESIDENT}" "${ATS_A}" "${ATS_B}" "${RT}" 50.0)`,
    );
  });

  it("preserves ats1/ats2 order (swapping them IS a bug)", () => {
    const code = buildCurlPactCode({
      patron: PATRON, curler: RESIDENT, ats1Id: "POOL-FIRST", ats2Id: "POOL-SECOND",
      rewardTokenId: RT, amount: "1",
    });
    // "POOL-FIRST" must appear before "POOL-SECOND" in the string.
    const first  = code.indexOf("POOL-FIRST");
    const second = code.indexOf("POOL-SECOND");
    expect(first).toBeLessThan(second);
    expect(first).toBeGreaterThanOrEqual(0);
  });
});

describe("buildBrumatePactCode", () => {
  it("emits the 7-arg C_Brumate shape (Curl + dayz)", () => {
    expect(
      buildBrumatePactCode({
        patron: PATRON, brumator: RESIDENT, ats1Id: ATS_A, ats2Id: ATS_B,
        rewardTokenId: RT, amount: "10", lockDays: 365,
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Brumate "${PATRON}" "${RESIDENT}" "${ATS_A}" "${ATS_B}" "${RT}" 10.0 365)`,
    );
  });

  it("dayz is emitted as a bare integer (not a decimal)", () => {
    const code = buildBrumatePactCode({
      patron: PATRON, brumator: RESIDENT, ats1Id: ATS_A, ats2Id: ATS_B,
      rewardTokenId: RT, amount: "1", lockDays: 7,
    });
    // last-arg before closing paren is just `7`, not `7.0`
    expect(code).toMatch(/ 7\)$/);
  });
});

describe("buildConstrictPactCode", () => {
  it("emits the 6-arg C_Constrict shape (Coil + dayz)", () => {
    expect(
      buildConstrictPactCode({
        patron: PATRON, constricter: RESIDENT, atsId: ATS_A,
        rewardTokenId: RT, amount: "20", lockDays: 30,
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Constrict "${PATRON}" "${RESIDENT}" "${ATS_A}" "${RT}" 20.0 30)`,
    );
  });
});

describe("buildColdRecoveryPactCode", () => {
  it("emits the 4-arg C_ColdRecovery shape", () => {
    expect(
      buildColdRecoveryPactCode({
        patron: PATRON, recoverer: RESIDENT, atsId: ATS_A, ra: "5",
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_ColdRecovery "${PATRON}" "${RESIDENT}" "${ATS_A}" 5.0)`,
    );
  });
});

describe("buildDirectRecoveryPactCode", () => {
  it("emits the 4-arg C_DirectRecovery shape (same params as Cold, different fn name)", () => {
    const cold = buildColdRecoveryPactCode({
      patron: PATRON, recoverer: RESIDENT, atsId: ATS_A, ra: "5",
    });
    const direct = buildDirectRecoveryPactCode({
      patron: PATRON, recoverer: RESIDENT, atsId: ATS_A, ra: "5",
    });
    // Only the function name differs.
    expect(direct).toBe(cold.replace("C_ColdRecovery", "C_DirectRecovery"));
  });
});

describe("buildCullPactCode", () => {
  it("emits the 3-arg C_Cull shape (no amount, just patron/culler/ats)", () => {
    expect(
      buildCullPactCode({ patron: PATRON, culler: RESIDENT, atsId: ATS_A }),
    ).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Cull "${PATRON}" "${RESIDENT}" "${ATS_A}")`,
    );
  });
});

// ─── TS01-C2.VST — Awake + Slumber (GSTOA hibernation) ──────────────────────

describe("buildAwakePactCode", () => {
  it("emits the 4-arg C_Awake shape with integer nonce", () => {
    expect(
      buildAwakePactCode({
        patron: PATRON, awaker: RESIDENT, dpof: DPOF, nonce: 42,
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.VST|C_Awake "${PATRON}" "${RESIDENT}" "${DPOF}" 42)`,
    );
  });
});

describe("buildSlumberPactCode", () => {
  it("emits the 4-arg C_Slumber shape with [nonce list]", () => {
    expect(
      buildSlumberPactCode({
        patron: PATRON, merger: RESIDENT, dpof: DPOF, nonces: [1, 2, 3],
      }),
    ).toBe(
      `(ouronet-ns.TS01-C2.VST|C_Slumber "${PATRON}" "${RESIDENT}" "${DPOF}" [1 2 3])`,
    );
  });

  it("single-item list renders [N], not N", () => {
    const code = buildSlumberPactCode({
      patron: PATRON, merger: RESIDENT, dpof: DPOF, nonces: [7],
    });
    expect(code).toContain("[7]");
  });

  it("empty list renders []", () => {
    const code = buildSlumberPactCode({
      patron: PATRON, merger: RESIDENT, dpof: DPOF, nonces: [],
    });
    expect(code).toContain("[]");
  });
});

// ─── TS01-C3.SWP — Firestarter ──────────────────────────────────────────────

describe("buildFirestarterPactCode", () => {
  it("emits the 1-arg C_Firestarter shape", () => {
    expect(
      buildFirestarterPactCode({ firestarter: RESIDENT }),
    ).toBe(
      `(ouronet-ns.TS01-C3.SWP|C_Firestarter "${RESIDENT}")`,
    );
  });
});

// ─── Cross-cutting: every builder emits a non-empty string that starts
// with "(ouronet-ns." and ends with ")". This catches someone forgetting
// the parens or the namespace prefix entirely.

describe("every builder produces a valid Pact call shape", () => {
  const samples = [
    () => buildTransferPactCode({ patron: "a", tokenId: "t", sender: "s", receiver: "r", amount: "1", method: false }),
    () => buildClearDispoPactCode({ patron: "a", account: "b" }),
    () => buildSublimatePactCode({ client: "a", target: "b", amount: "1" }),
    () => buildCompressPactCode({ client: "a", ignisAmount: "1" }),
    () => buildCoilPactCode({ patron: "a", coiler: "b", atsId: "ats", rewardTokenId: "rt", amount: "1" }),
    () => buildCurlPactCode({ patron: "a", curler: "b", ats1Id: "ats1", ats2Id: "ats2", rewardTokenId: "rt", amount: "1" }),
    () => buildBrumatePactCode({ patron: "a", brumator: "b", ats1Id: "ats1", ats2Id: "ats2", rewardTokenId: "rt", amount: "1", lockDays: 1 }),
    () => buildConstrictPactCode({ patron: "a", constricter: "b", atsId: "ats", rewardTokenId: "rt", amount: "1", lockDays: 1 }),
    () => buildColdRecoveryPactCode({ patron: "a", recoverer: "b", atsId: "ats", ra: "1" }),
    () => buildDirectRecoveryPactCode({ patron: "a", recoverer: "b", atsId: "ats", ra: "1" }),
    () => buildCullPactCode({ patron: "a", culler: "b", atsId: "ats" }),
    () => buildAwakePactCode({ patron: "a", awaker: "b", dpof: "d", nonce: 1 }),
    () => buildSlumberPactCode({ patron: "a", merger: "b", dpof: "d", nonces: [1] }),
    () => buildFirestarterPactCode({ firestarter: "a" }),
  ];

  it.each(samples.map((fn, i) => [i, fn]))("sample %i: starts with (ouronet-ns. and ends with )", (_i, fn) => {
    const code = (fn as () => string)();
    expect(code.startsWith("(ouronet-ns.")).toBe(true);
    expect(code.endsWith(")")).toBe(true);
    expect(code.length).toBeGreaterThan(20);
  });
});
