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
