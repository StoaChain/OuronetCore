/**
 * gas-utils.ts regression suite — Phase -1.2 safety net.
 *
 * Gas math is pure arithmetic, but any drift here would result in
 * under-estimated gas (tx fails on-chain) or over-estimated gas (wastes
 * user's STOA). Both are silent-enough to slip past manual smoke-test.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ANU_PER_STOA,
  anuToStoa,
  stoaToAnu,
  formatAnuAsStoa,
  getGasLimitStatus,
  formatMaxFee,
  calculateAutoGasLimit,
} from "../src/gas";
import { setNodeConfig } from "../src/network";

// Reset node config before each test so calculateAutoGasLimit's cap is deterministic
beforeEach(() => {
  setNodeConfig("node2");   // node2 has the 2M gas limit
});

// ══ Unit constants ═══════════════════════════════════════════════════════════
describe("ANU_PER_STOA constant", () => {
  it("is exactly 10^12", () => {
    expect(ANU_PER_STOA).toBe(1_000_000_000_000);
  });
});

// ══ anuToStoa / stoaToAnu round-trip ═════════════════════════════════════════
describe("anuToStoa / stoaToAnu", () => {
  it("round-trips whole STOA values", () => {
    expect(anuToStoa(stoaToAnu(1))).toBe(1);
    expect(anuToStoa(stoaToAnu(100))).toBe(100);
    expect(anuToStoa(stoaToAnu(0.5))).toBe(0.5);
  });

  it("1 STOA = 10^12 ANU", () => {
    expect(stoaToAnu(1)).toBe(1_000_000_000_000);
    expect(anuToStoa(1_000_000_000_000)).toBe(1);
  });

  it("zero → zero", () => {
    expect(anuToStoa(0)).toBe(0);
    expect(stoaToAnu(0)).toBe(0);
  });

  it("small ANU amounts convert to sub-STOA decimals", () => {
    expect(anuToStoa(1)).toBe(1e-12);
    expect(anuToStoa(1_000)).toBe(1e-9);
  });
});

// ══ formatAnuAsStoa — display formatting ═════════════════════════════════════
describe("formatAnuAsStoa", () => {
  it("formats 1e12 ANU as '1.0' (trailing .0 preserved)", () => {
    expect(formatAnuAsStoa(1_000_000_000_000)).toBe("1.0");
  });

  it("formats zero as '0.0'", () => {
    expect(formatAnuAsStoa(0)).toBe("0.0");
  });

  it("strips trailing zeros but preserves at least one decimal digit", () => {
    // 1.5 STOA = 1,500,000,000,000 ANU
    expect(formatAnuAsStoa(1_500_000_000_000)).toBe("1.5");
    // 2.25 STOA = 2,250,000,000,000 ANU
    expect(formatAnuAsStoa(2_250_000_000_000)).toBe("2.25");
  });

  it("handles fractional ANU → small STOA decimals", () => {
    // 1 ANU = 1e-12 STOA; toFixed(12) → "0.000000000001", no trailing zeros
    expect(formatAnuAsStoa(1)).toBe("0.000000000001");
  });

  it("never produces a trailing-dot string", () => {
    const samples = [0, 1, 100, 1_000_000_000_000, 1_234_567_890];
    for (const a of samples) {
      const formatted = formatAnuAsStoa(a);
      expect(formatted).not.toMatch(/\.$/);  // no "1." / "0." outputs
      expect(formatted).toMatch(/\d\.\d/);   // always has a digit on each side of '.'
    }
  });
});

// ══ getGasLimitStatus ═════════════════════════════════════════════════════════
describe("getGasLimitStatus — boundary behaviour", () => {
  it("returns 'safe' up to and including 1,600,000", () => {
    expect(getGasLimitStatus(0)).toBe("safe");
    expect(getGasLimitStatus(1_000_000)).toBe("safe");
    expect(getGasLimitStatus(1_600_000)).toBe("safe");
  });

  it("returns 'warning' from 1,600,001 up to and including 2,000,000", () => {
    expect(getGasLimitStatus(1_600_001)).toBe("warning");
    expect(getGasLimitStatus(1_800_000)).toBe("warning");
    expect(getGasLimitStatus(2_000_000)).toBe("warning");
  });

  it("returns 'danger' above 2,000,000", () => {
    expect(getGasLimitStatus(2_000_001)).toBe("danger");
    expect(getGasLimitStatus(5_000_000)).toBe("danger");
  });
});

// ══ formatMaxFee ══════════════════════════════════════════════════════════════
describe("formatMaxFee", () => {
  it("multiplies gas price × gas limit for ANU total", () => {
    const result = formatMaxFee(10_000, 1_000);
    // 10_000 × 1_000 = 10,000,000 ANU
    expect(result.anu).toMatch(/10,000,000/);
  });

  it("returns STOA string as the ANU-to-STOA conversion", () => {
    // 10_000 ANU/unit × 1_000_000 units = 10^10 ANU = 0.01 STOA
    const result = formatMaxFee(10_000, 1_000_000);
    expect(result.stoa).toBe("0.01");
  });

  it("handles zero gas → zero fee", () => {
    expect(formatMaxFee(10_000, 0).stoa).toBe("0.0");
    expect(formatMaxFee(0, 1_000).stoa).toBe("0.0");
  });
});

// ══ calculateAutoGasLimit — the buffer + cap logic ════════════════════════════
describe("calculateAutoGasLimit — buffering simulated gas", () => {
  // Buckets (from source):
  //   sim <    1_000 → ×2.0  + 0
  //   sim <   20_000 → ×1.15 + 0
  //   sim <  100_000 → ×1.10 + 5_000
  //   sim <  500_000 → ×1.10 + 10_000
  //   sim ≥  500_000 → ×1.05 + 20_000
  // Always capped at node gas limit (node2 = 2_000_000).

  describe("bucket 1: sim < 1,000 → 2x (generous for trivial txs)", () => {
    it("sim=0 → 0", () => {
      expect(calculateAutoGasLimit(0)).toBe(0);
    });
    it("sim=500 → 1000", () => {
      expect(calculateAutoGasLimit(500)).toBe(1000);  // 500 * 2.0 = 1000
    });
    it("sim=999 → 1998", () => {
      expect(calculateAutoGasLimit(999)).toBe(1998);
    });
  });

  describe("bucket 2: 1,000 ≤ sim < 20,000 → 15% buffer", () => {
    it("sim=1000 → ceil(1000 * 1.15) = 1150", () => {
      expect(calculateAutoGasLimit(1000)).toBe(1150);
    });
    it("sim=10_000 → 11_500", () => {
      expect(calculateAutoGasLimit(10_000)).toBe(11_500);
    });
    it("sim=19_999 → ceil(22998.85) = 22_999", () => {
      expect(calculateAutoGasLimit(19_999)).toBe(22_999);
    });
  });

  describe("bucket 3: 20,000 ≤ sim < 100,000 → 10% buffer + 5k flat", () => {
    it("sim=20_000 → 22_000 + 5_000 = 27_000", () => {
      expect(calculateAutoGasLimit(20_000)).toBe(27_000);
    });
    it("sim=50_000 → ceil(50000 * 1.10) + 5000 = 60_001 (FP drift: 55000.0000…01)", () => {
      // JS: 50000 * 1.10 === 55000.00000000001 → ceil → 55001 → +5000 → 60001
      expect(calculateAutoGasLimit(50_000)).toBe(60_001);
    });
  });

  describe("bucket 4: 100,000 ≤ sim < 500,000 → 10% buffer + 10k flat", () => {
    it("sim=100_000 → ceil(100000 * 1.10) + 10000 = 120_001 (FP drift)", () => {
      expect(calculateAutoGasLimit(100_000)).toBe(120_001);
    });
    it("sim=300_000 → 330_000 + 10_000 = 340_000", () => {
      expect(calculateAutoGasLimit(300_000)).toBe(340_000);
    });
  });

  describe("bucket 5: sim ≥ 500,000 → 5% buffer + 20k flat", () => {
    it("sim=500_000 → 525_000 + 20_000 = 545_000", () => {
      expect(calculateAutoGasLimit(500_000)).toBe(545_000);
    });
    it("sim=1_000_000 → 1_050_000 + 20_000 = 1_070_000", () => {
      expect(calculateAutoGasLimit(1_000_000)).toBe(1_070_000);
    });
  });

  describe("node cap (2,000,000 for node2)", () => {
    it("caps at node limit even when buffer would exceed it", () => {
      // sim=1_900_000 → 1_995_000 + 20_000 = 2_015_000 → capped at 2_000_000
      expect(calculateAutoGasLimit(1_900_000)).toBe(2_000_000);
    });
    it("sim already over cap → returns cap", () => {
      expect(calculateAutoGasLimit(5_000_000)).toBe(2_000_000);
    });
  });

  describe("bucket-boundary non-monotonicity (by design)", () => {
    // The buffer function is intentionally NOT strictly monotonic across bucket
    // boundaries. Small txs get proportionally MORE buffer because a % overrun
    // matters less in absolute ANU. Two documented drop-points:
    //   sim=999 (×2.0)    = 1998    →  sim=1000  (×1.15)       = 1150
    //   sim=499_999 (×1.10+10k) = 559999  →  sim=500_000 (×1.05+20k)  = 545000
    // These are captured explicitly so anyone changing the bucket table sees
    // the assertion update and is forced to think about the tradeoff.
    it("drops at the 999→1000 boundary (generous bucket-1 vs lean bucket-2)", () => {
      expect(calculateAutoGasLimit(999)).toBeGreaterThan(calculateAutoGasLimit(1_000));
    });
    it("drops at the 499_999→500_000 boundary (×1.10+10k → ×1.05+20k)", () => {
      expect(calculateAutoGasLimit(499_999)).toBeGreaterThan(calculateAutoGasLimit(500_000));
    });
    it("but IS monotonic WITHIN each bucket", () => {
      // Within bucket 3 (20k ≤ sim < 100k): ×1.10 + 5k flat
      expect(calculateAutoGasLimit(30_000)).toBeLessThan(calculateAutoGasLimit(50_000));
      expect(calculateAutoGasLimit(50_000)).toBeLessThan(calculateAutoGasLimit(80_000));
    });
  });
});
