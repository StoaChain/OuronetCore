/**
 * Pact-format helpers + code-template snapshot tests.
 *
 * Moved from OuronetUI to @stoachain/ouronet-core in Phase 2a along with
 * their subjects: formatDecimalForPact, mayComeWithDeimal, filterFreePositionData.
 *
 * Pact-code-template snapshots lock in the exact templates used by the
 * builders in src/kadena/interactions/*.ts (still in OuronetUI until Phase 2b,
 * but their format-contract lives in core from this phase onward).
 */

import { describe, it, expect } from "vitest";
import {
  formatDecimalForPact,
  mayComeWithDeimal,
  filterFreePositionData,
} from "../src/pact";
import { KADENA_NAMESPACE } from "../src/constants";

// ══ formatDecimalForPact ══════════════════════════════════════════════════════
describe("formatDecimalForPact", () => {
  describe("integer inputs — add .0 so Pact treats as decimal", () => {
    it("'0' → '0.0'", () => {
      expect(formatDecimalForPact("0")).toBe("0.0");
    });
    it("'1' → '1.0'", () => {
      expect(formatDecimalForPact("1")).toBe("1.0");
    });
    it("'1234567890' → '1234567890.0'", () => {
      expect(formatDecimalForPact("1234567890")).toBe("1234567890.0");
    });
  });

  describe("decimal inputs — passed through if within maxDecimals", () => {
    it("'1.5' → '1.5'", () => {
      expect(formatDecimalForPact("1.5")).toBe("1.5");
    });
    it("'0.1' → '0.1'", () => {
      expect(formatDecimalForPact("0.1")).toBe("0.1");
    });
    it("'123.456789' → '123.456789' (6 decimals, under 24-default)", () => {
      expect(formatDecimalForPact("123.456789")).toBe("123.456789");
    });
    it("trailing-dot '1.' → '1.' (matches the regex, passed through)", () => {
      // Current regex allows \d+\.?\d* which permits "1."
      expect(formatDecimalForPact("1.")).toBe("1.");
    });
  });

  describe("excess decimals — TRUNCATE (not round) to maxDecimals", () => {
    it("default 24-decimal cap preserves 24 and drops the rest", () => {
      const input = "1.123456789012345678901234567890";  // 30 decimals
      expect(formatDecimalForPact(input)).toBe("1.123456789012345678901234");
    });

    it("custom maxDecimals lower than natural length → truncated there", () => {
      expect(formatDecimalForPact("1.123456789", 4)).toBe("1.1234");
    });

    it("truncates, does NOT round (1.9999 with cap 2 → 1.99, not 2.00)", () => {
      expect(formatDecimalForPact("1.9999", 2)).toBe("1.99");
    });
  });

  describe("validation — rejects malformed input", () => {
    it("throws on alphabetic characters", () => {
      expect(() => formatDecimalForPact("abc")).toThrow("Invalid decimal format");
      expect(() => formatDecimalForPact("1.5x")).toThrow();
    });

    it("throws on negative numbers", () => {
      expect(() => formatDecimalForPact("-1.5")).toThrow();
    });

    it("throws on scientific notation (Pact doesn't accept it)", () => {
      expect(() => formatDecimalForPact("1e10")).toThrow();
      expect(() => formatDecimalForPact("1.5E-3")).toThrow();
    });

    it("throws on empty string", () => {
      expect(() => formatDecimalForPact("")).toThrow();
    });

    it("throws on double-dot garbage", () => {
      expect(() => formatDecimalForPact("1..5")).toThrow();
      expect(() => formatDecimalForPact("1.5.5")).toThrow();
    });
  });

  describe("whitespace handling — trims input", () => {
    it("strips leading/trailing whitespace", () => {
      expect(formatDecimalForPact("  1.5  ")).toBe("1.5");
      expect(formatDecimalForPact("\t100\n")).toBe("100.0");
    });
  });
});

// ══ mayComeWithDeimal ════════════════════════════════════════════════════════
describe("mayComeWithDeimal — unwrap Pact {decimal: ...} object", () => {
  it("unwraps a Pact decimal object", () => {
    expect(mayComeWithDeimal({ decimal: "123.456" })).toBe("123.456");
  });

  it("returns the value as-is when not wrapped", () => {
    expect(mayComeWithDeimal("123.456")).toBe("123.456");
    expect(mayComeWithDeimal(42)).toBe(42);
  });

  it("handles null/undefined without throwing", () => {
    expect(mayComeWithDeimal(null)).toBe(null);
    expect(mayComeWithDeimal(undefined)).toBe(undefined);
  });

  it("passes through objects without 'decimal' key unchanged", () => {
    const obj = { foo: "bar" };
    expect(mayComeWithDeimal(obj)).toBe(obj);
  });

  it("unwraps even when decimal field is falsy (current behavior)", () => {
    expect(mayComeWithDeimal({ decimal: "0" })).toBe("0");
    expect(mayComeWithDeimal({ decimal: 0 })).toBe(0);
  });
});

// ══ filterFreePositionData ═══════════════════════════════════════════════════
describe("filterFreePositionData — 'no positions' sentinel normalisation", () => {
  it("passes through non-sentinel arrays unchanged", () => {
    const real = [{ "reward-tokens": ["OURO", "AURYN"], balance: "1.5" }];
    expect(filterFreePositionData(real)).toBe(real);
  });

  it("passes through multi-row arrays even when one looks like the sentinel", () => {
    const input = [
      { "reward-tokens": [0] },
      { "reward-tokens": ["OURO"], balance: "1.0" },
    ];
    expect(filterFreePositionData(input)).toBe(input);
  });

  it("replaces a single-row reward-tokens=[0] sentinel with an empty array", () => {
    const input = [{ "reward-tokens": [0] }];
    expect(filterFreePositionData(input)).toEqual([]);
  });

  it("passes through a single row with real content unchanged", () => {
    const input = [{ "reward-tokens": ["OURO"], balance: "0.1" }];
    expect(filterFreePositionData(input)).toBe(input);
  });

  it("passes through a single row with reward-tokens of non-zero content", () => {
    const input = [{ "reward-tokens": [1] }];
    expect(filterFreePositionData(input)).toBe(input);
  });

  it("passes through a single row missing reward-tokens entirely", () => {
    const input = [{ balance: "0.1" }];
    expect(filterFreePositionData(input)).toBe(input);
  });

  it("passes through an empty array unchanged", () => {
    const input: any[] = [];
    expect(filterFreePositionData(input)).toBe(input);
  });
});

// ══ Pact code template snapshots ══════════════════════════════════════════════
//
// Explicit strings reconstructing the templates used by OuronetUI's Pact
// builders (src/kadena/interactions/*.ts). Any drift in argument order,
// function name, or whitespace → assertion fails at CI instead of silently
// on-chain.
describe("Pact code templates — snapshot format assertions", () => {
  const PATRON = "k:aaaa0000";
  const COILER = "OU_Stoa_x";
  const CURLER = "OU_Stoa_y";
  const ATS    = "Auryndex-O136CBn22ncY";
  const ATS2   = "EliteAuryndex-O136CBn22ncY";
  const RT     = "OURO-8Nh-JO8JO4F5";
  const AMOUNT = "1.5";

  it("C_Coil template", () => {
    const decimal = formatDecimalForPact(AMOUNT);
    const pactCode =
      `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Coil "${PATRON}" "${COILER}" "${ATS}" "${RT}" ${decimal})`;
    expect(pactCode).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Coil "k:aaaa0000" "OU_Stoa_x" "Auryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" 1.5)`
    );
  });

  it("C_Curl template (two ATS args — pair picker)", () => {
    const decimal = formatDecimalForPact(AMOUNT);
    const pactCode =
      `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Curl "${PATRON}" "${CURLER}" "${ATS}" "${ATS2}" "${RT}" ${decimal})`;
    expect(pactCode).toBe(
      `(ouronet-ns.TS01-C2.ATS|C_Curl "k:aaaa0000" "OU_Stoa_y" "Auryndex-O136CBn22ncY" "EliteAuryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" 1.5)`
    );
  });

  it("C_Transfer template (vanilla coin.C_Transfer)", () => {
    const decimal = formatDecimalForPact("10");
    const pactCode = `(coin.C_Transfer "${PATRON}" "k:bbbb0000" ${decimal})`;
    expect(pactCode).toBe(
      `(coin.C_Transfer "k:aaaa0000" "k:bbbb0000" 10.0)`
    );
  });

  it("INFO template shape — INFO_* queries use namespaced INFO-ONE", () => {
    const decimal = formatDecimalForPact(AMOUNT);
    const pactCode =
      `(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Coil "${PATRON}" "${COILER}" "${ATS}" "${RT}" ${decimal})`;
    expect(pactCode).toBe(
      `(ouronet-ns.INFO-ONE.ATS|INFO_Coil "k:aaaa0000" "OU_Stoa_x" "Auryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" 1.5)`
    );
  });

  describe("decimal formatting in templates preserves integrity", () => {
    it("integer amount renders with .0", () => {
      expect(formatDecimalForPact("100")).toBe("100.0");
    });

    it("leading-zero decimal stays as-is (Pact accepts 0.5)", () => {
      expect(formatDecimalForPact("0.5")).toBe("0.5");
    });

    it("high-precision decimal preserved up to 24 places by default", () => {
      expect(formatDecimalForPact("1.000000000000000000000001"))
        .toBe("1.000000000000000000000001");
    });
  });
});
