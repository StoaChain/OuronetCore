/**
 * Gas utility functions for ANU/STOA conversion, gas limit status,
 * and max fee calculation.
 *
 * ANU is the smallest unit of the STOA token (like wei to ETH).
 * 1 STOA = 10^12 ANU
 */

import { getActiveGasLimit } from "../network/nodeFailover";

// --- Constants ---

/** 1 STOA = 10^12 ANU */
export const ANU_PER_STOA = 1_000_000_000_000;

/** Maximum gas limit allowed for execution (above this, simulation only) */
export const GAS_LIMIT_MAX = 2_000_000;

/** Minimum gas price in ANU */
export const GAS_PRICE_MIN_ANU = 10_000;

/** Default TTL in seconds (8 hours) */
export const TTL_DEFAULT = 28_800;

/** Minimum TTL in seconds (1 minute) */
export const TTL_MIN = 60;

/** Maximum TTL in seconds (24 hours) */
export const TTL_MAX = 86_400;

// --- Conversion Functions ---

/** Convert ANU to STOA */
export function anuToStoa(anu: number): number {
  return anu / ANU_PER_STOA;
}

/** Convert STOA to ANU */
export function stoaToAnu(stoa: number): number {
  return stoa * ANU_PER_STOA;
}

/**
 * Format an ANU value as a STOA string with appropriate decimal places.
 * Strips trailing zeros but ensures at least one decimal digit.
 */
export function formatAnuAsStoa(anu: number): string {
  const stoa = anu / ANU_PER_STOA;
  const fixed = stoa.toFixed(12);

  // Strip trailing zeros but keep at least one decimal digit
  const stripped = fixed.replace(/0+$/, "");
  if (stripped.endsWith(".")) {
    return stripped + "0";
  }
  return stripped;
}

// --- Gas Limit Status ---

export type GasLimitStatus = "safe" | "warning" | "danger";

/**
 * Determine the gas limit status based on the value.
 * - safe: 0 to 1,600,000
 * - warning: 1,600,001 to 2,000,000
 * - danger: above 2,000,000
 */
export function getGasLimitStatus(limit: number): GasLimitStatus {
  if (limit > 2_000_000) return "danger";
  if (limit > 1_600_000) return "warning";
  return "safe";
}

/** Color mappings for each gas limit status (dark theme inline styles) */
export const GAS_LIMIT_COLORS: Record<
  GasLimitStatus,
  { bg: string; text: string; border: string }
> = {
  safe: { bg: "#052e16", text: "#4ade80", border: "#166534" },
  warning: { bg: "#431407", text: "#fb923c", border: "#9a3412" },
  danger: { bg: "#450a0a", text: "#f87171", border: "#991b1b" },
};

// --- Max Fee ---

/**
 * Calculate the max transaction fee given gas price (ANU) and gas limit.
 * Returns both ANU and STOA formatted representations.
 */
export function formatMaxFee(
  gasPrice: number,
  gasLimit: number
): { anu: string; stoa: string } {
  const totalAnu = gasPrice * gasLimit;
  return {
    anu: totalAnu.toLocaleString(),
    stoa: formatAnuAsStoa(totalAnu),
  };
}

// --- Auto Gas Limit ---

/**
 * Calculate a calibrated gas limit from a simulated gas value.
 * Uses proportional % buffer + flat buffer to cover unexpected spikes.
 * Single source of truth — used by console executor and all transaction functions.
 */
export function calculateAutoGasLimit(simulatedGas: number): number {
  let multiplier: number;
  let flat: number;
  if (simulatedGas < 1_000)        { multiplier = 2.0;  flat = 0; }
  else if (simulatedGas < 20_000)  { multiplier = 1.15; flat = 0; }
  else if (simulatedGas < 100_000) { multiplier = 1.10; flat = 5_000; }
  else if (simulatedGas < 500_000) { multiplier = 1.10; flat = 10_000; }
  else                              { multiplier = 1.05; flat = 20_000; }
  const nodeLimit = getActiveGasLimit();
  return Math.min(Math.ceil(simulatedGas * multiplier) + flat, nodeLimit);
}
