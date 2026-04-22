/**
 * Pact-format helpers — pure functions that sit between TypeScript and Pact.
 *
 * - formatDecimalForPact: canonicalize a decimal string for inclusion in a Pact
 *   code literal. Pact distinguishes integer vs decimal at the lexer level, so
 *   "1" and "1.0" are NOT the same value; functions expecting `decimal` reject
 *   the integer form. This helper adds a trailing ".0" to integer strings and
 *   truncates to a maximum fractional length (not rounds — see §truncate below).
 * - mayComeWithDeimal: Pact reads often return `{ decimal: "123.456" }` objects
 *   for decimal values (vs. plain numbers for int). This unwraps to the string.
 * - filterFreePositionData: normalize the "no positions" sentinel the chain
 *   returns from free-position reads (a single row with reward-tokens=[0]).
 */

/**
 * Format a numeric string for inclusion in a Pact code literal as a `decimal`.
 *
 * Rules:
 *   - Whitespace is trimmed.
 *   - Input must match /^\d+\.?\d*$/ (non-negative, no scientific, no thousand-separators)
 *     — throws "Invalid decimal format" otherwise.
 *   - Integer-looking strings get ".0" appended (Pact needs a decimal point to
 *     lex as decimal rather than integer).
 *   - Fractional parts longer than `maxDecimals` are TRUNCATED, not rounded —
 *     this matches Pact's own integer-division behavior and avoids producing
 *     a value the on-chain code can't represent.
 */
export function formatDecimalForPact(amount: string, maxDecimals: number = 24): string {
  const trimmed = amount.trim();

  if (!/^\d+\.?\d*$/.test(trimmed)) {
    throw new Error("Invalid decimal format");
  }

  const parts = trimmed.split('.');

  // No decimal part — add .0 so Pact lexes as decimal
  if (parts.length === 1) {
    return `${trimmed}.0`;
  }

  // Truncate (not round) if exceeds max decimals
  if (parts[1].length > maxDecimals) {
    return `${parts[0]}.${parts[1].substring(0, maxDecimals)}`;
  }

  return trimmed;
}

/**
 * Unwrap a Pact `{ decimal: "..." }` value to the underlying string.
 *
 * Pact returns decimal values inside an object envelope `{ decimal: "…" }`
 * to distinguish them from integers (which come back as plain numbers).
 * This helper peels the envelope when present and passes other shapes through
 * unchanged. Null / undefined / non-object inputs round-trip unchanged.
 *
 * Name preserved from the OuronetUI original (typo intentional, "Deimal"
 * instead of "Decimal") — any consumer that imported this under its old
 * name keeps working after extraction. A `mayComeWithDecimal` alias could
 * ship as a deprecation path if the typo ever matters.
 */
export const mayComeWithDeimal = (data: any): any => {
  if (data?.hasOwnProperty("decimal")) {
    return data.decimal;
  }
  return data;
};

// ─── EU locale number formatters ─────────────────────────────────────────────
// Display-side counterparts — convert chain numbers to/from European locale
// (dot thousands separator, comma decimal separator). Both sides of core-based
// code (OuronetUI's display + HUB's admin output) format the same way.

/**
 * Parse a European-locale number string back to a float.
 * "1.234,56" → 1234.56, "1.234" → 1234 (if no comma), "0,9" → 0.9.
 * Falls back to parseFloat for non-EU strings.
 */
export function parseEU(s: string | null | undefined): number {
  if (!s) return 0;
  const trimmed = s.trim();
  if (trimmed === "???" || trimmed === "N/A" || trimmed === "—" || trimmed === "") return 0;
  if (trimmed.includes(",")) {
    return parseFloat(trimmed.replace(/\./g, "").replace(",", ".")) || 0;
  }
  const dotParts = trimmed.split(".");
  if (dotParts.length === 2 && dotParts[1].length === 3 && /^\d+$/.test(dotParts[1])) {
    return parseFloat(trimmed.replace(/\./g, "")) || 0;
  }
  return parseFloat(trimmed) || 0;
}

/**
 * Format a numeric string/number to European locale.
 * "6081.3874" → "6.081,3874"   "42067.93$" → "42.067,93$"
 * Returns "???" for null/undefined; passes "???", "N/A", "—", "" unchanged.
 */
export function formatEU(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return "???";
  const s = String(raw).trim();
  if (s === "???" || s === "N/A" || s === "—" || s === "") return s;

  const m = s.match(/^(\d+(?:\.\d+)?)((?:\s+\([^)]+\))*)\s*(\$|¢)?$/);
  if (!m) return s;

  const numStr = m[1];
  const annotation = m[2] || "";
  const suffix = m[3] || "";

  const dotIdx = numStr.indexOf(".");
  let intPart: string;
  let decPart: string | undefined;

  if (dotIdx >= 0) {
    intPart = numStr.slice(0, dotIdx);
    decPart = numStr.slice(dotIdx + 1);
  } else {
    intPart = numStr;
    decPart = undefined;
  }

  intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  const formatted = decPart !== undefined ? `${intPart},${decPart}` : intPart;
  return `${formatted}${annotation}${suffix ? " " + suffix : ""}`.trim();
}

/**
 * Normalize raw free-position-data rows from the chain.
 *
 * When a user's free-positions list clears, `URC_0017_TruefungibleButton`
 * (and similar position reads) return a single placeholder row with
 * `reward-tokens = [0]` instead of an empty array. That's a "no positions
 * in use" signal from the chain, NOT a real position. Callers should treat
 * it as empty.
 */
export function filterFreePositionData(raw: any[]): any[] {
  if (
    raw.length === 1 &&
    Array.isArray(raw[0]?.["reward-tokens"]) &&
    raw[0]["reward-tokens"].length === 1 &&
    Number(raw[0]["reward-tokens"][0]) === 0
  ) {
    return [];
  }
  return raw;
}
