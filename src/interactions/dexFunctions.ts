import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE, GAS_STATION, NATIVE_TOKEN_VAULT,
  KADENA_NETWORK,
  PACT_URL,
} from "../constants";
import { Pact, createClient } from "@kadena/client";
import { universalSignTransaction, fromKeypair } from "../signing";
import { calculateAutoGasLimit } from "../gas";
import { pactRead } from "../reads";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


// Re-export add liquidity functions
export * from "./addLiquidityFunctions";

// Interface definitions for keypair types  
export interface IOuroAccountKeypair {
  address: string;
  publicKey: string;
  privateKey?: string;
}

export interface IKadenaKeypair {
  publicKey: string;
  privateKey: string;
  seedType?: "koala" | "chainweaver" | "eckowallet";
  encryptedSecretKey?: any;
  password?: string;
}

// Type definitions for DEX data structures
export interface DecimalValue {
  decimal: string;
}

export interface SwapPoolData {
  "liquid-fee": number;
  "lp-fee": number;
  "lp-supply": DecimalValue;
  "special-fee": number;
  "special-fee-targets-short": string[];
  "pool-value-in-dwk": DecimalValue;
  "special-fee-targets": string[];
  "tvl-in-$": string;
  "lp-value-in-$": string;
  "pool-type": string;
  "special-fee-targets-proportions": number[];
  "pool-type-word": string;
  "pool-token-supplies": DecimalValue[];
  "lp-value-in-dwk": DecimalValue;
  "total-fee": number;
  "pool-tokens": string[];
}

// Enhanced Pool Data with additional dashboard-specific fields
export interface PoolPreviewData {
  "liquid-fee": number;
  "lp-fee": number;
  "lp-supply": DecimalValue;
  "special-fee": number;
  "special-fee-targets-short": string[];
  "pool-value-in-dwk": DecimalValue;
  "special-fee-targets": string[];
  "tvl-in-$": string;
  "lp-value-in-$": string;
  "pool-type": string;
  "special-fee-targets-proportions": number[];
  "pool-type-word": string;
  "pool-token-supplies": DecimalValue[];
  "lp-value-in-dwk": DecimalValue;
  "total-fee": number;
  "pool-tokens": string[];
  // Enhanced dashboard-specific fields
  "ft-pool-value-in-dwk": string;        // Formatted pool value
  "ft-lp-supply": string;                // Formatted LP supply
  "ft-lp-value-in-dwk": string;          // Formatted LP value in DWK
  "ft-pool-token-supplies": string[];    // Formatted token supplies
  "weigths": number[];                   // Pool weights (note: typo in API "weigths")
}

// Internal Pool Dashboard Data - comprehensive pool statistics
export interface SwpairInternalDashboard {
  "special-fee-target-proportions": number[];
  "primality": string;
  "liquid-fee": number;
  "lp-fee": number;
  "lp-supply": DecimalValue;
  "special-fee": number;
  "ft-pool-value-in-dwk": string;
  "special-fee-targets-short": string[];
  "pool-value-in-dwk": DecimalValue;
  "special-fee-targets": string[];
  "tvl-in-$": string;
  "fee-lockup": string;
  "swapping-enabled": string;
  "ft-lp-supply": string;
  "genesis-supplies": number[];
  "liquidity-enabled": string;
  "genesis-weights": number[];
  "lp-value-in-$": string;
  "pool-type": string;
  "amplifier": number;
  "ft-genesis-supplies": string[];
  "pool-type-word": string;
  "ft-lp-value-in-dwk": string;
  "pool-token-supplies": DecimalValue[];
  "ft-pool-token-supplies": string[];
  "lp-value-in-dwk": DecimalValue;
  "fee-unlocks": {
    "int": number;
  };
  "weigths": number[];
  "frozen-and-sleeping": string;
  "total-fee": number;
  "pool-tokens": string[];
}

// Direct Swap Calculation Result
export interface SwapCalculationResult {
  "output-amount": string; // "WSTOA-8Nh-JO8JO4F5 Output: 28.633136871920000000000000"
  "to-liquidity-providers": string[]; // ["SSTOA... from Input to Liquidity Providers: 0.0000829749299355716637", ...]
  "to-liquid-boost": string; // "WSTOA-8Nh-JO8JO4F5 from Raw Output to Liquid Boost: 0.059911020479"
  "to-special-targets": string; // "WSTOA-8Nh-JO8JO4F5 from Raw Output to Special Targets: 0.119822040958"
}

// Reverse Swap Calculation Result
export interface InverseSwapResult {
  [key: string]: any; // Will define structure after seeing API response
}

// Capped Inverse Swap Result (75% supply limit)
export interface CappedInverseResult {
  decimal: string;
}

// User Account Token Balances for a specific swap pair
export interface UserAccountSupplies {
  [key: string]: any; // Will define structure after seeing API response
}

// Utility functions to parse swap calculation results
export function parseSwapAmount(amountString: string): number {
  // Extract number from strings like "WSTOA-8Nh-JO8JO4F5 Output: 28.633136871920000000000000"
  const match = amountString.match(/:\s*([0-9.]+)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Parse swap amount as string to preserve full decimal precision
 * @param amountString - String like "WSTOA-8Nh-JO8JO4F5 Output: 28.633136871920000000000000"
 * @returns The numeric value as a string with full precision
 */
export function parseSwapAmountPrecise(amountString: string): string {
  const match = amountString.match(/:\s*([0-9.]+)/);
  return match ? match[1] : "0";
}

export function parseSwapLiquidityProviders(providers: string[]): number {
  // Sum all liquidity provider fees from array like:
  // ["SSTOA-8Nh-JO8JO4F5 from Input to Liquidity Providers: 0.0000829749299355716637", "OURO-8Nh-JO8JO4F5 from Input to Liquidity Providers: 0.26312828657714566275"]
  return providers.reduce((total, providerString) => {
    const amount = parseSwapAmount(providerString);
    return total + amount;
  }, 0);
}

export interface SwapLiquidityProviderItem {
  token: string;
  amount: number;
}

export interface SwapLiquidityProviderItemPrecise {
  token: string;
  amount: string;
}

export function parseSwapLiquidityProvidersDetailed(providers: string[]): SwapLiquidityProviderItem[] {
  // Parse individual liquidity provider fees from array like:
  return providers.map((providerString) => {
    const amount = parseSwapAmount(providerString);
    // Extract token name from the beginning of the string (e.g., "SSTOA" from "SSTOA-8Nh-JO8JO4F5")
    const tokenMatch = providerString.match(/^([A-Z]+)/);
    const token = tokenMatch ? tokenMatch[1] : 'Unknown';
    
    return {
      token,
      amount
    };
  });
}

/**
 * Parse liquidity provider fees with full precision
 * @param providers - Array of provider strings from API
 * @returns Array of {token, amount} with amount as string for full precision
 */
export function parseSwapLiquidityProvidersDetailedPrecise(providers: string[]): SwapLiquidityProviderItemPrecise[] {
  return providers.map((providerString) => {
    const amount = parseSwapAmountPrecise(providerString);
    const tokenMatch = providerString.match(/^([A-Z]+)/);
    const token = tokenMatch ? tokenMatch[1] : 'Unknown';
    
    return {
      token,
      amount
    };
  });
}

// Swap Execution Parameters
export interface SwapExecutionParams {
  patronKeypair: IOuroAccountKeypair; // OURO account keypair for patron
  kadenaKeypair: IKadenaKeypair; // Kadena account for gas payments
  guardKeypair: IKadenaKeypair; // Guard keypair for the patron account
  account: string; // User account address  
  swpair: string; // Pool ID
  outputId: string; // Output token ID
}

/**
 * Fetch all swap pair IDs from the SWP contract
 */
export async function getPoolIds(): Promise<string[] | null> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.SWP.URC_Swpairs)`, { tier: "T7" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve pool IDs from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Pool IDs query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    return Array.isArray(data) ? (data as string[]) : null;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Fetch the primordial pool ID
 */
export async function getPrimordialPool(): Promise<string | null> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.SWP.UR_PrimordialPool)`, { tier: "T7" });
    if (response?.result?.status === "success") {
      return String(response.result.data);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch general information for all swap pairs
 */
export async function getSWPairGeneralInfo(): Promise<any> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.DPL-UR.URC_0003_SWPairGeneralInfo)`, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve general swap pair info from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`General info query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Fetch detailed dashboard information for a specific swap pair
 */
export async function getSWPairDashboardInfo(swpair: string): Promise<SwapPoolData | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0004_SWPairDashboardInfo "${swpair}")`;
    
    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve swap pair dashboard info from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Dashboard info query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    // Single pool API returns an object directly, not an array
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as SwapPoolData;
    } else if (Array.isArray(data) && data.length > 0) {
      return data[0] as SwapPoolData;
    } else {
      return null;
    }
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Fetch enhanced pool preview/dashboard data for a specific pool
 * Returns richer data structure with formatted values and weights
 */
export async function getPoolPreviewData(poolId: string): Promise<PoolPreviewData | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0004_SWPairDashboardInfo "${poolId}")`;
    
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve pool preview data from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Pool preview query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    // Enhanced pool API returns an object directly with additional formatted fields
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as PoolPreviewData;
    } else if (Array.isArray(data) && data.length > 0) {
      return data[0] as PoolPreviewData;
    } else {
      return null;
    }
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Fetch detailed dashboard information for multiple swap pairs
 */
export async function getSWPairMultiDashboardInfo(swpairs: string[]): Promise<SwapPoolData[] | null> {
  try {
    // Format array for Pact: ["id1" "id2" "id3"]
    const pactArray = `[${swpairs.map(swpair => `"${swpair}"`).join(' ')}]`;
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.DPL-UR.URC_0005_SWPairMultiDashboardInfo ${pactArray})`, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve multi swap pair dashboard info from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Multi dashboard info query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    return Array.isArray(data) ? (data as SwapPoolData[]) : null;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

// ===========================
// UTILITY FUNCTIONS
// ===========================

/**
 * Parse decimal string to number for display
 */
export function parseDecimalValue(decimalValue: DecimalValue): number {
  return parseFloat(decimalValue.decimal);
}

/**
 * Parse decimal value as string to preserve full precision
 * @param decimalValue - DecimalValue object with decimal string
 * @returns The decimal value as a string with full precision
 */
export function parseDecimalValuePrecise(decimalValue: DecimalValue): string {
  return decimalValue.decimal;
}

/**
 * Format pool type for display
 */
export function formatPoolType(poolType: string, poolTypeWord: string): string {
  return `${poolType} (${poolTypeWord})`;
}

/**
 * Get total pool value in USD from a pool
 */
export function getPoolValueUSD(pool: SwapPoolData): string {
  return pool["tvl-in-$"];
}

/**
 * Get pool tokens summary
 */
export function getPoolTokensSummary(pool: SwapPoolData): {
  tokens: string[];
  supplies: number[];
  totalTokens: number;
} {
  return {
    tokens: pool["pool-tokens"],
    supplies: pool["pool-token-supplies"].map(parseDecimalValue),
    totalTokens: pool["pool-tokens"].length,
  };
}

/**
 * Calculate total fees for pool
 */
export function getPoolFeeStructure(pool: SwapPoolData): {
  liquidFee: number;
  lpFee: number;
  specialFee: number;
  totalFee: number;
} {
  return {
    liquidFee: pool["liquid-fee"],
    lpFee: pool["lp-fee"],
    specialFee: pool["special-fee"],
    totalFee: pool["total-fee"],
  };
}

/**
 * Get special fee targets with proportions
 */
export function getSpecialFeeTargets(pool: SwapPoolData): {
  targets: string[];
  shortTargets: string[];
  proportions: number[];
} {
  return {
    targets: pool["special-fee-targets"],
    shortTargets: pool["special-fee-targets-short"],
    proportions: pool["special-fee-targets-proportions"],
  };
}

// ===========================
// ENHANCED POOL PREVIEW UTILITIES
// ===========================

/**
 * Get formatted pool values from enhanced preview data
 */
export function getFormattedPoolValues(pool: PoolPreviewData): {
  formattedPoolValue: string;
  formattedLpSupply: string;
  formattedLpValue: string;
  formattedTokenSupplies: string[];
} {
  return {
    formattedPoolValue: pool["ft-pool-value-in-dwk"],
    formattedLpSupply: pool["ft-lp-supply"],
    formattedLpValue: pool["ft-lp-value-in-dwk"],
    formattedTokenSupplies: pool["ft-pool-token-supplies"],
  };
}

/**
 * Get pool weights and calculate percentages
 */
export function getPoolWeights(pool: PoolPreviewData): {
  weights: number[];
  weightPercentages: string[];
  isBalanced: boolean;
} {
  const weights = pool["weigths"]; // Note: API has typo "weigths"
  const percentages = weights.map(w => `${(w * 100).toFixed(1)}%`);
  const isBalanced = weights.every(w => Math.abs(w - weights[0]) < 0.01);
  
  return {
    weights,
    weightPercentages: percentages,
    isBalanced,
  };
}

/**
 * Calculate pool composition data for charts/visualizations
 */
export function getPoolComposition(pool: PoolPreviewData): {
  tokens: string[];
  supplies: number[];
  weights: number[];
  compositions: Array<{
    token: string;
    supply: number;
    weight: number;
    percentage: string;
    formattedSupply: string;
  }>;
} {
  const tokens = pool["pool-tokens"];
  const supplies = pool["pool-token-supplies"].map(parseDecimalValue);
  const weights = pool["weigths"];
  const formattedSupplies = pool["ft-pool-token-supplies"];
  
  const compositions = tokens.map((token, index) => ({
    token: token.split('-')[0], // Clean token name
    supply: supplies[index],
    weight: weights[index],
    percentage: `${(weights[index] * 100).toFixed(1)}%`,
    formattedSupply: formattedSupplies[index],
  }));
  
  return {
    tokens,
    supplies,
    weights,
    compositions,
  };
}

// ===========================
// NEW DEX FUNCTIONS
// ===========================

/**
 * Fetch comprehensive internal dashboard data for a specific swap pair
 * Contains all pool stats including detailed analytics
 */
export async function getSwpairInternalDashboard(swpair: string): Promise<SwpairInternalDashboard | null> {
  try {
    
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0010_SwpairInternalDashboard "${swpair}")`;
    
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve internal dashboard data from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Internal dashboard query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    return data as SwpairInternalDashboard;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Calculate direct swap output amounts
 */
export async function calculateDirectSwap(
  account: string,
  swpair: string,
  inputIds: string[],
  inputAmounts: string[] | number[],
  outputId: string
): Promise<SwapCalculationResult | null> {
  try {
    
    // Format arrays for Pact with proper decimal formatting - keep as strings to preserve precision
    const pactInputIds = `[${inputIds.map(id => `"${id}"`).join(' ')}]`;
    const pactInputAmounts = `[${inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : amount.toString();
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0006_Swap "${account}" "${swpair}" ${pactInputIds} ${pactInputAmounts} "${outputId}")`;
    


    
    const response = await pactRead(pactCode, { tier: "T2" });


    if (!response || !response.result) {
      throw new Error("Failed to retrieve direct swap calculation from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Direct swap calculation failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    return data as SwapCalculationResult;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Calculate reverse swap input amounts (user specifies desired output)
 */
export async function calculateInverseSwap(
  account: string,
  swpair: string,
  outputId: string,
  outputAmount: number,
  inputId: string
): Promise<InverseSwapResult | null> {
  try {
    
    // Format outputAmount as decimal for Pact (e.g., 1 → "1.0")
    const outputAmountDecimal = outputAmount.toString().includes('.') ? outputAmount.toString() : `${outputAmount}.0`;
    
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0007_InverseSwap "${account}" "${swpair}" "${outputId}" ${outputAmountDecimal} "${inputId}")`;
    
    const response = await pactRead(pactCode, { tier: "T2" });


    if (!response || !response.result) {
      throw new Error("Failed to retrieve inverse swap calculation from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Inverse swap calculation failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    return data as InverseSwapResult;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * URC_0006b — Direct swap calculation, returns numeric output amount directly
 */
export async function calculateDirectSwapB(
  account: string,
  swpair: string,
  inputIds: string[],
  inputAmounts: string[] | number[],
  outputId: string
): Promise<{ decimal: string } | number | null> {
  try {
    const pactInputIds = `[${inputIds.map(id => `"${id}"`).join(' ')}]`;
    const pactInputAmounts = `[${inputAmounts.map(a => {
      const s = typeof a === 'string' ? a : a.toString();
      return s.includes('.') ? s : `${s}.0`;
    }).join(' ')}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0006b_DirectSwap "${account}" "${swpair}" ${pactInputIds} ${pactInputAmounts} "${outputId}")`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response?.result) throw new Error("No response");
    if (response.result.status === "failure") throw new Error(response.result.error?.message ?? "Failed");
    return response.result.data as any;
  } catch (e) {
    throw e instanceof Error ? e : new Error("Unknown error");
  }
}

/**
 * URC_0007b — Inverse swap calculation, returns numeric input amount directly
 */
export async function calculateInverseSwapB(
  account: string,
  swpair: string,
  outputId: string,
  outputAmount: number,
  inputId: string
): Promise<{ decimal: string } | number | null> {
  try {
    const outDecimal = outputAmount.toString().includes('.') ? outputAmount.toString() : `${outputAmount}.0`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0007b_InverseSwap "${account}" "${swpair}" "${outputId}" ${outDecimal} "${inputId}")`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response?.result) throw new Error("No response");
    if (response.result.status === "failure") throw new Error(response.result.error?.message ?? "Failed");
    return response.result.data as any;
  } catch (e) {
    throw e instanceof Error ? e : new Error("Unknown error");
  }
}

/**
 * Get maximum output amount for reverse swap (75% of token supply in pool)
 */
export async function getCappedInverseAmount(
  swpair: string,
  outputId: string
): Promise<CappedInverseResult | null> {
  try {
    
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0008_CappedInverse "${swpair}" "${outputId}")`;
    
    const response = await pactRead(pactCode, { tier: "T5" });


    if (!response || !response.result) {
      throw new Error("Failed to retrieve capped inverse amount from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Capped inverse query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    return data as CappedInverseResult;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Get user's token balances for all tokens in a specific swap pair
 */
export async function getUserAccountSupplies(
  account: string,
  swpair: string
): Promise<UserAccountSupplies | null> {
  try {
    
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0011_AccountSuppliesForSwpair "${account}" "${swpair}")`;

    
    const response = await pactRead(pactCode, { tier: "T5" });



    if (!response || !response.result) {
      throw new Error("Failed to retrieve user account supplies from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`User account supplies query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    return data as UserAccountSupplies;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

// ===========================
// SLIPPAGE BOUNDS FUNCTIONS
// ===========================

/**
 * Slippage bounds object returned by SWPU.UDC_SpawnSlippageBounds
 */
export interface SlippageBounds {
  "expected-output-amount": number;
  "output-precision": number;
  "slippage-percent": number;
}

/**
 * Fetch slippage bounds object for a swap via dirtyRead.
 * Must be called before executing a swap with slippage protection.
 */
export async function getSlippageBounds(
  swpair: string,
  inputIds: string[],
  inputAmounts: (string | number)[],
  outputId: string,
  slippage: number
): Promise<SlippageBounds> {
  try {
    const pactInputIds = `[${inputIds.map(id => `"${id}"`).join(' ')}]`;
    const pactInputAmounts = `[${inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : amount.toString();
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    const slippageStr = slippage.toString();
    const slippageDecimal = slippageStr.includes('.') ? slippageStr : `${slippageStr}.0`;

    const pactCode = `(${KADENA_NAMESPACE}.SWPU.UDC_SpawnSlippageBounds "${swpair}" ${pactInputIds} ${pactInputAmounts} "${outputId}" ${slippageDecimal})`;

    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve slippage bounds from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Slippage bounds query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data as SlippageBounds;

  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred fetching slippage bounds");
  }
}

// ===========================
// SWAP EXECUTION FUNCTIONS (TS01-C3 Module)
// ===========================

/**
 * Execute single swap with slippage protection
 */
export async function executeSingleSwapWithSlippage(
  params: SwapExecutionParams & { inputId: string; inputAmount: string | number; slippage: number }
): Promise<any> {
  try {
    
    // Format numbers as decimals for Pact (preserve exact user input, just ensure decimal format)
    const inputAmountStr = typeof params.inputAmount === 'string' ? params.inputAmount : params.inputAmount.toString();
    const inputAmountDecimal = inputAmountStr.includes('.') ? inputAmountStr : `${inputAmountStr}.0`;

    // Fetch slippage bounds object from chain before executing
    const slippageBoundsObj = await getSlippageBounds(
      params.swpair,
      [params.inputId],
      [inputAmountDecimal],
      params.outputId,
      params.slippage
    );
      
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_SingleSwapWithSlippage "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" "${params.inputId}" ${inputAmountDecimal} "${params.outputId}" (read-msg 'slippage-bounds))`;
    
    // Create keyset name for the guard (following OURO pattern)
    const keysetName = `ks`;
      
    let gasLimit = 100_000; // Default gas limit for swap execution (under block limit)
    
    // Build transaction function
    const buildTransaction = (gasLimitOverride?: number) => {
      return Pact.builder
        .execution(pactCode)
        .addData(keysetName, {
          keys: [params.guardKeypair.publicKey],
          pred: "keys-all",
        })
        .addData('slippage-bounds', slippageBoundsObj as any)
        .setMeta({
          senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride || gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey, (withCapability: any) => [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" },
          ),
        ])
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();
    };

    const { dirtyRead, submit } = createClient(PACT_URL);
    
    // First do a simulation to check gas
    let transaction = buildTransaction();
    const simulation = await dirtyRead(transaction);
    

    
    // Check if simulation failed
    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Single swap execution failed: ${errorMessage}`);
    }

    // Apply adaptive gas limit from simulation
    const requiredGas = simulation.gas;
    if (requiredGas) {
      // Rebuild with adaptive gas limit
      gasLimit = calculateAutoGasLimit(requiredGas);

      transaction = buildTransaction(gasLimit);
    }

    // Sign the transaction with both keypairs
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the signed transaction
    const result = await submit(signedTransaction);
    

    
    return result;
    
  } catch (error) {
    console.error("Single Swap WITH Slippage Error:", error);
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute single swap without slippage protection
 */
export async function executeSingleSwapNoSlippage(
  params: SwapExecutionParams & { inputId: string; inputAmount: string | number }
): Promise<any> {
  try {

    
    // Format numbers as decimals for Pact (preserve exact user input, just ensure decimal format)
    const inputAmountStr = typeof params.inputAmount === 'string' ? params.inputAmount : params.inputAmount.toString();
    const inputAmountDecimal = inputAmountStr.includes('.') ? inputAmountStr : `${inputAmountStr}.0`;
      
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_SingleSwapNoSlippage "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" "${params.inputId}" ${inputAmountDecimal} "${params.outputId}")`;


    
    // Create keyset name for the guard (following OURO pattern)
    const keysetName = `ks`;
      
    let gasLimit = 140_000; // Default gas limit for swap execution
    
    // Build transaction function
    const buildTransaction = (gasLimitOverride?: number) => {
      return Pact.builder
        .execution(pactCode)
        .addData(keysetName, {
          keys: [params.guardKeypair.publicKey],
          pred: "keys-all",
        })
        .setMeta({
          senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride || gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey, (withCapability: any) => [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" },
          ),
        ])
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();
    };

    const { dirtyRead, submit } = createClient(PACT_URL);
    
    // First do a simulation to check gas
    let transaction = buildTransaction();
    const simulation = await dirtyRead(transaction);
    

    
    // Check if simulation failed
    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Single swap execution failed: ${errorMessage}`);
    }

    // Apply adaptive gas limit from simulation
    const requiredGas = simulation.gas;
    if (requiredGas) {
      // Rebuild with adaptive gas limit
      gasLimit = calculateAutoGasLimit(requiredGas);

      transaction = buildTransaction(gasLimit);
    }

    // Sign the transaction with both keypairs
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the signed transaction
    const result = await submit(signedTransaction);
    
    return result;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute multi-token swap with slippage protection
 */
export async function executeMultiSwapWithSlippage(
  params: SwapExecutionParams & { inputIds: string[]; inputAmounts: (string | number)[]; slippage: number }
): Promise<any> {
  try {
    
    // Format arrays for Pact with decimals (preserve exact user input as strings)
    const pactInputIds = `[${params.inputIds.map(id => `"${id}"`).join(' ')}]`;
    const formattedAmounts = params.inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : amount.toString();
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    });
    const pactInputAmounts = `[${formattedAmounts.join(' ')}]`;

    // Fetch slippage bounds object from chain before executing
    const slippageBoundsObj = await getSlippageBounds(
      params.swpair,
      params.inputIds,
      formattedAmounts,
      params.outputId,
      params.slippage
    );
    
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_MultiSwapWithSlippage "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputIds} ${pactInputAmounts} "${params.outputId}" (read-msg 'slippage-bounds))`;
    
    // Create keyset name for the guard (following OURO pattern)
    const keysetName = `ks`;
      
    let gasLimit = 120_000; // Default gas limit for multi-swap execution (under block limit)
    
    // Build transaction function
    const buildTransaction = (gasLimitOverride?: number) => {
      return Pact.builder
        .execution(pactCode)
        .addData(keysetName, {
          keys: [params.guardKeypair.publicKey],
          pred: "keys-all",
        })
        .addData('slippage-bounds', slippageBoundsObj as any)
        .setMeta({
          senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride || gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey, (withCapability: any) => [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" },
          ),
        ])
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();
    };

    const { dirtyRead, submit } = createClient(PACT_URL);
    
    // First do a simulation to check gas
    let transaction = buildTransaction();
    const simulation = await dirtyRead(transaction);
    
    
    // Check if simulation failed
    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Multi swap execution failed: ${errorMessage}`);
    }

    // Apply adaptive gas limit from simulation
    const requiredGas = simulation.gas;
    if (requiredGas) {
      // Rebuild with adaptive gas limit
      gasLimit = calculateAutoGasLimit(requiredGas);

      transaction = buildTransaction(gasLimit);
    }

    // Sign the transaction with both keypairs
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the signed transaction
    const result = await submit(signedTransaction);
    
    
    return result;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

// ===========================
// SMART SWAP FUNCTIONS
// ===========================

/**
 * Return type for SmartSwap hopper preview
 */
export interface SmartSwapHopper {
  "output-amount"?: any;
  "best-output"?: any;
  "output"?: any;
  "hops"?: number | { int: number };
  "trace"?: string[];
  "nodes"?: string[];
  "edges"?: string[];
  [key: string]: any;
}

/**
 * Return type for SmartSwap slippage bounds
 */
export interface SmartSwapSlippageBounds {
  "expected-output-amount": DecimalValue | number;
  "output-precision": { int: number } | number;
  "slippage-percent": DecimalValue | number;
}

/**
 * SmartSwap execution params
 */
export interface SmartSwapExecutionParams {
  patronKeypair: IOuroAccountKeypair;
  kadenaKeypair: IKadenaKeypair;
  guardKeypair: IKadenaKeypair;
  account: string;
  inputId: string;
  inputAmount: string | number;
  outputId: string;
  slippage?: number;
}

/**
 * Fetch all tokens available across all pools via SWP.URC_AllPoolTokens
 */
export async function getAllPoolTokens(): Promise<string[]> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.SWP.URC_AllPoolTokens)`, { tier: "T7" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve pool tokens from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Pool tokens query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    return Array.isArray(data) ? (data as string[]) : [];
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Preview a smart swap via SWPI.URC_Hopper
 */
export async function getSmartSwapHopper(
  inputId: string,
  outputId: string,
  inputAmount: string | number
): Promise<SmartSwapHopper | null> {
  try {
    const amountStr = typeof inputAmount === "string" ? inputAmount : inputAmount.toString();
    const amountDecimal = amountStr.includes(".") ? amountStr : `${amountStr}.0`;

    const pactCode = `(${KADENA_NAMESPACE}.SWPI.URC_Hopper "${inputId}" "${outputId}" ${amountDecimal})`;

    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve smart swap hopper from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Smart swap hopper query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data as SmartSwapHopper;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Get slippage bounds for a smart swap via SWPU.UDC_SpawnSmartSwapSlippageBounds
 */
export async function getSmartSwapSlippageBounds(
  inputId: string,
  inputAmount: string | number,
  outputId: string,
  slippage: number
): Promise<SmartSwapSlippageBounds> {
  try {
    const amountStr = typeof inputAmount === "string" ? inputAmount : inputAmount.toString();
    const amountDecimal = amountStr.includes(".") ? amountStr : `${amountStr}.0`;
    const slippageStr = slippage.toString();
    const slippageDecimal = slippageStr.includes(".") ? slippageStr : `${slippageStr}.0`;

    const pactCode = `(${KADENA_NAMESPACE}.SWPU.UDC_SpawnSmartSwapSlippageBounds "${inputId}" ${amountDecimal} "${outputId}" ${slippageDecimal})`;

    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve smart swap slippage bounds.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Smart swap slippage bounds failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data as SmartSwapSlippageBounds;
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute a smart swap with slippage protection
 */
export async function executeSmartSwapWithSlippage(
  params: SmartSwapExecutionParams
): Promise<any> {
  try {
    const amountStr = typeof params.inputAmount === "string" ? params.inputAmount : params.inputAmount.toString();
    const amountDecimal = amountStr.includes(".") ? amountStr : `${amountStr}.0`;
    const slippage = params.slippage ?? 5;

    // Fetch slippage bounds before executing
    const slippageObj = await getSmartSwapSlippageBounds(
      params.inputId,
      amountDecimal,
      params.outputId,
      slippage
    );

    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_SmartSwapWithSlippage "${params.patronKeypair.address}" "${params.account}" "${params.inputId}" ${amountDecimal} "${params.outputId}" (read-msg 'slippage-bounds))`;

    const gasLimit = 1_500_000;

    const buildTx = (gasLimitOverride?: number) =>
      Pact.builder
        .execution(pactCode)
        .addData("ks", {
          keys: [params.guardKeypair.publicKey],
          pred: "keys-all",
        })
        .addData("slippage-bounds", slippageObj as any)
        .setMeta({
          senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride ?? gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey, (withCapability: any) => [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" }
          ),
        ])
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();

    const { dirtyRead, submit } = createClient(PACT_URL);

    const simulation = await dirtyRead(buildTx());
    if (simulation.result.status === "failure") {
      throw new Error(`Smart swap simulation failed: ${simulation.result.error?.message || "Unknown error"}`);
    }

    const finalGas = simulation.gas ? calculateAutoGasLimit(simulation.gas) : gasLimit;
    const tx = buildTx(finalGas);

    const signedTx: any = await universalSignTransaction(tx, [
      fromKeypair(params.kadenaKeypair),
      fromKeypair(params.guardKeypair),
    ]);
    return await submit(signedTx);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Fetch decimal precision for a DPTF token via DPTF.UR_Decimals
 * Returns the number of decimal places (e.g. 12 for high-precision tokens)
 */
export async function getTokenDecimals(tokenId: string): Promise<number> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.DPTF.UR_Decimals "${tokenId}")`, { tier: "T7" });

    if (!response || !response.result || response.result.status === "failure") {
      return 8; // sensible default
    }

    const data = response.result.data;
    if (typeof data === "number") return data;
    if (data && typeof data === "object") {
      if ("int" in data) return parseInt((data as any).int, 10);
      if ("decimal" in data) return parseInt((data as any).decimal, 10);
    }
    return 8;
  } catch {
    return 8;
  }
}

/**
 * Local helper to resolve Pact decimal/int/number values to JS number
 */
function resolvePactDecimalLocal(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return val;
  if (typeof val === "object") {
    if ("decimal" in val) return parseFloat(val.decimal);
    if ("int" in val) return parseInt(val.int, 10);
  }
  return parseFloat(String(val));
}

/**
 * Fetch total fee for a swap pair pool via SWP.URC_PoolTotalFee
 * Returns fee as a decimal fraction (e.g. 0.003 = 0.3%)
 */
export async function getPoolTotalFee(swpair: string): Promise<number> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.SWP.URC_PoolTotalFee "${swpair}")`, { tier: "T5" });
    if (response.result.status === "success") {
      return resolvePactDecimalLocal(response.result.data);
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Execute a smart swap without slippage protection
 */
export async function executeSmartSwapNoSlippage(
  params: SmartSwapExecutionParams
): Promise<any> {
  try {
    const amountStr = typeof params.inputAmount === "string" ? params.inputAmount : params.inputAmount.toString();
    const amountDecimal = amountStr.includes(".") ? amountStr : `${amountStr}.0`;

    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_SmartSwapNoSlippage "${params.patronKeypair.address}" "${params.account}" "${params.inputId}" ${amountDecimal} "${params.outputId}")`;

    const gasLimit = 1_500_000;

    const buildTx = (gasLimitOverride?: number) =>
      Pact.builder
        .execution(pactCode)
        .addData("ks", {
          keys: [params.guardKeypair.publicKey],
          pred: "keys-all",
        })
        .setMeta({
          senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride ?? gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey, (withCapability: any) => [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" }
          ),
        ])
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();

    const { dirtyRead, submit } = createClient(PACT_URL);

    const simulation = await dirtyRead(buildTx());
    if (simulation.result.status === "failure") {
      throw new Error(`Smart swap simulation failed: ${simulation.result.error?.message || "Unknown error"}`);
    }

    const finalGas = simulation.gas ? calculateAutoGasLimit(simulation.gas) : gasLimit;
    const tx = buildTx(finalGas);

    const signedTx: any = await universalSignTransaction(tx, [
      fromKeypair(params.kadenaKeypair),
      fromKeypair(params.guardKeypair),
    ]);
    return await submit(signedTx);
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute multi-token swap without slippage protection
 */
export async function executeMultiSwapNoSlippage(
  params: SwapExecutionParams & { inputIds: string[]; inputAmounts: (string | number)[] }
): Promise<any> {
  try {

    
    // Format arrays for Pact with decimals (preserve exact user input as strings)
    const pactInputIds = `[${params.inputIds.map(id => `"${id}"`).join(' ')}]`;
    const pactInputAmounts = `[${params.inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : amount.toString();
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_MultiSwapNoSlippage "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputIds} ${pactInputAmounts} "${params.outputId}")`;
    

    
    // Create keyset name for the guard (following OURO pattern)
    const keysetName = `ks`;
      
    let gasLimit = 120_000; // Default gas limit for multi-swap execution (under block limit)
    
    // Build transaction function
    const buildTransaction = (gasLimitOverride?: number) => {
      return Pact.builder
        .execution(pactCode)
        .addData(keysetName, {
          keys: [params.guardKeypair.publicKey],
          pred: "keys-all",
        })
        .setMeta({
          senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride || gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey, (withCapability: any) => [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" },
          ),
        ])
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();
    };

    const { dirtyRead, submit } = createClient(PACT_URL);
    
    // First do a simulation to check gas
    let transaction = buildTransaction();
    const simulation = await dirtyRead(transaction);
    
    
    // Check if simulation failed
    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Multi swap execution failed: ${errorMessage}`);
    }

    // Apply adaptive gas limit from simulation
    const requiredGas = simulation.gas;
    if (requiredGas) {
      // Rebuild with adaptive gas limit
      gasLimit = calculateAutoGasLimit(requiredGas);

      transaction = buildTransaction(gasLimit);
    }

    // Sign the transaction with both keypairs
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the signed transaction
    const result = await submit(signedTransaction);
    
    
    return result;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}


export async function describeModule(moduleName: string): Promise<string | null> {
  try {
    const fqn = moduleName.includes(".") ? moduleName : `${KADENA_NAMESPACE}.${moduleName}`;
    const response = await pactRead(`(describe-module "${fqn}")`, { tier: "T7" });
    if (response.result.status === "success") {
      const data = response.result.data as any;
      return data?.code || JSON.stringify(data);
    }
    return null;
  } catch {
    return null;
  }
}

/** Fetch SWP principal tokens list */
export async function getSWPPrincipals(): Promise<string[]> {
  try {
    const res = await pactRead(`(${KADENA_NAMESPACE}.SWP.UR_Principals)`, { tier: "T7" });
    if (res.result.status === "failure") return [];
    return (Array.isArray(res.result.data) ? res.result.data : []) as string[];
  } catch { return []; }
}

/** Fetch SWP spawn limit (WSTOA minimum to create a pool) */
export async function getSWPSpawnLimit(): Promise<string> {
  try {
    const res = await pactRead(`(${KADENA_NAMESPACE}.SWP.UR_SpawnLimit)`, { tier: "T7" });
    if (res.result.status === "failure") return "N/A";
    const d = res.result.data;
    return d && typeof d === "object" && (d as any).decimal ? (d as any).decimal : String(d ?? "N/A");
  } catch { return "N/A"; }
}

/** Fetch SWP inactive limit (WSTOA below which swap auto-deactivates) */
export async function getSWPInactiveLimit(): Promise<string> {
  try {
    const res = await pactRead(`(${KADENA_NAMESPACE}.SWP.UR_InactiveLimit)`, { tier: "T7" });
    if (res.result.status === "failure") return "N/A";
    const d = res.result.data;
    return d && typeof d === "object" && (d as any).decimal ? (d as any).decimal : String(d ?? "N/A");
  } catch { return "N/A"; }
}

// ── LP Entry Functions ────────────────────────────────────────────────────────

/** Response shape from URC_0008b_TrueFungibleLPEntry */
export interface TrueFungibleLPEntry {
  t1: string;
  t2: string;
  "wallet-supply": { decimal: string } | number;
  "dptf-supply": { decimal: string } | number;
  "wallet-worth-in-stoa": { decimal: string } | number;
  "wallet-worth-in-dollarz": string;
  "token-worth-in-stoa": { decimal: string } | number;
  "token-worth-in-dollarz": string;
}

function parseLPDec(v: unknown): string {
  if (v == null) return "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "decimal" in v) return (v as any).decimal;
  if (typeof v === "object" && v !== null && "int" in v) return String((v as any).int);
  return String(v);
}

export async function getTrueFungibleLPEntry(
  account: string,
  swpair: string,
  izNative: boolean,
): Promise<TrueFungibleLPEntry | null> {
  try {
    const boolStr = izNative ? "true" : "false";
    const pactCode = izNative
      ? `(${KADENA_NAMESPACE}.DPL-UR.URC_0008b_TrueFungibleLPEntry "${account}" "${swpair}" ${boolStr})`
      : `(try false (${KADENA_NAMESPACE}.DPL-UR.URC_0008b_TrueFungibleLPEntry "${account}" "${swpair}" ${boolStr}))`;

    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response?.result || response.result.status === "failure") return null;

    const data = response.result.data;
    if (!izNative && (typeof data === "boolean" || (data as any) === false)) return null;
    if (!data || typeof data !== "object") return null;

    return data as TrueFungibleLPEntry;
  } catch {
    return null;
  }
}

export async function getLPEntries(
  account: string,
  swpair: string,
): Promise<{ native: TrueFungibleLPEntry | null; frozen: TrueFungibleLPEntry | null }> {
  const [native, frozen] = await Promise.all([
    getTrueFungibleLPEntry(account, swpair, true),
    getTrueFungibleLPEntry(account, swpair, false),
  ]);
  return { native, frozen };
}

export function formatLPEntry(entry: TrueFungibleLPEntry) {
  const walletSupply = parseLPDec(entry["wallet-supply"]);
  const totalSupply = parseLPDec(entry["dptf-supply"]);
  const walletStoa = parseLPDec(entry["wallet-worth-in-stoa"]);
  const walletUsd = typeof entry["wallet-worth-in-dollarz"] === "string"
    ? entry["wallet-worth-in-dollarz"]
    : parseLPDec(entry["wallet-worth-in-dollarz"]);
  const tokenStoa = parseLPDec(entry["token-worth-in-stoa"]);
  const tokenUsd = typeof entry["token-worth-in-dollarz"] === "string"
    ? entry["token-worth-in-dollarz"]
    : parseLPDec(entry["token-worth-in-dollarz"]);

  return { name: entry.t1, tokenId: entry.t2, walletSupply, totalSupply, walletStoa, walletUsd, tokenStoa, tokenUsd };
}

/**
 * Fetch swap pairs owned by a specific Ouronet resident account.
 * Returns a list of swpair IDs that the account can manage.
 */
export async function getOwnedSwapPairs(account: string): Promise<string[]> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.SWP.URD_OwnedSwapPairs "${account}")`, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return [];

    const data = response.result.data;
    if (Array.isArray(data)) return data as string[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Fetch management pool settings for a specific swap pair
 * URC_0014_SwpairManagementPoolSettings
 */
export async function getSwpairManagementPoolSettings(swpair: string): Promise<any> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0014_SwpairManagementPoolSettings "${swpair}")`;

    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve pool settings from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Pool settings query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data;
  } catch (err) {
    console.error("URC_0014 failed:", err);
    return null;
  }
}

/**
 * URC_0015_SwpairManagementFeeSettings
 * Returns fee configuration for a SWP pair: lock state, fee breakdown,
 * special fee targets (up to 7), and max available target slots.
 */
export async function getSwpairManagementFeeSettings(swpair: string): Promise<any> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0015_SwpairManagementFeeSettings "${swpair}")`;

    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve fee settings from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Fee settings query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data;
  } catch (err) {
    console.error("URC_0015 failed:", err);
    return null;
  }
}

/**
 * DALOS.UR_UsagePrice — Get the price for a usage type (e.g. "blue" for blue flag branding)
 * Returns the price in STOA
 */
export async function getUsagePrice(usageType: string): Promise<number | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DALOS.UR_UsagePrice "${usageType}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") {
      const d = response.result.data;
      return typeof d === "number" ? d : (typeof d === "object" && (d as any)?.decimal ? parseFloat((d as any).decimal) : null);
    }
    return null;
  } catch (err) {
    console.error(`UR_UsagePrice(${usageType}) failed:`, err);
    return null;
  }
}

/**
 * BRD.UR_Branding — Fetch branding properties for an entity
 * @param entityId - SWP pair ID or LP token ID
 * @param pending - true for pending branding, false for live branding
 */
export async function getBranding(entityId: string, pending: boolean): Promise<any> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.BRD.UR_Branding "${entityId}" ${pending})`;

    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve branding from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Branding query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data;
  } catch (err) {
    console.error(`BRD.UR_Branding(${entityId}, ${pending}) failed:`, err);
    return null;
  }
}

// ─── True Fungible Header & Entry Functions ───────────────────────────────────

/**
 * Response shape from URC_0016_TruefungibleHeader
 */
export interface TrueFungibleHeaderData {
  "total-true-fungible-number": number | { int: number };
  "held-tf": string[];
  "held-tf-number": number | { int: number };
  "mngd-tf": string[];
  "mngd-tf-number": number | { int: number };
}

function parseIntVal(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "object" && "int" in v) return v.int;
  return parseInt(String(v), 10) || 0;
}

/**
 * Fetch True Fungible header data for an account.
 * Returns global TF count, held TF list/count, managed TF list/count.
 */
export async function getTrueFungibleHeader(
  account: string,
): Promise<TrueFungibleHeaderData | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0016_TruefungibleHeader "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return null;
    const data = response.result.data;
    if (!data || typeof data !== "object") return null;
    return data as TrueFungibleHeaderData;
  } catch (err) {
    console.error("URC_0016_TruefungibleHeader failed:", err);
    return null;
  }
}

/**
 * Response shape from URC_0008a_TrueFungibleEntry (Native/Frozen/Reserved tokens)
 */
export interface TrueFungibleEntryData {
  t1: string;          // display name
  t2: string;          // token ID
  "wallet-supply": { decimal: string } | number;
  "dptf-supply": { decimal: string } | number;
  "wallet-worth-in-stoa": { decimal: string } | number;
  "wallet-worth-in-dollarz": string;
  "token-worth-in-stoa": { decimal: string } | number;
  "token-worth-in-dollarz": string;
}

/**
 * Batch-fetch TrueFungibleEntry data for multiple token IDs using the chain mapper function.
 * Works for Native, Frozen, and Reserved tokens (not LP).
 * Uses URC_0008a_TrueFungibleEntryMapper(account, dptfs:[string])
 */
export async function getTrueFungibleEntries(
  account: string,
  tokenIds: string[],
): Promise<(TrueFungibleEntryData | null)[]> {
  if (tokenIds.length === 0) return [];
  try {
    const listItems = tokenIds.map(id => `"${id}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0008a_TrueFungibleEntryMapper "${account}" [${listItems}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return tokenIds.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return tokenIds.map(() => null);

    return data.map((item: any) => {
      if (!item || typeof item !== "object" || item === false) return null;
      return item as TrueFungibleEntryData;
    });
  } catch (err) {
    console.error("URC_0008a_TrueFungibleEntryMapper failed:", err);
    return tokenIds.map(() => null);
  }
}

/**
 * Batch-fetch Native LP entry data using the chain mapper function.
 * Uses URC_0008b_TrueFungibleNativeLPMapper(account, lp-ids:[string])
 * Accepts LP token IDs directly — chain resolves swpairs internally.
 */
export async function getNativeLPEntries(
  account: string,
  lpIds: string[],
): Promise<(TrueFungibleLPEntry | null)[]> {
  if (lpIds.length === 0) return [];
  try {
    const listItems = lpIds.map(id => `"${id}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0008b_TrueFungibleNativeLPMapper "${account}" [${listItems}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return lpIds.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return lpIds.map(() => null);

    return data.map((item: any) => {
      if (!item || typeof item !== "object" || item === false) return null;
      return item as TrueFungibleLPEntry;
    });
  } catch (err) {
    console.error("URC_0008b_TrueFungibleNativeLPMapper failed:", err);
    return lpIds.map(() => null);
  }
}

/**
 * Batch-fetch Frozen LP entry data using the chain mapper function.
 * Uses URC_0008b_TrueFungibleFrozenLPMapper(account, lp-ids:[string])
 * Accepts LP token IDs directly — chain resolves swpairs internally.
 */
export async function getFrozenLPEntries(
  account: string,
  lpIds: string[],
): Promise<(TrueFungibleLPEntry | null)[]> {
  if (lpIds.length === 0) return [];
  try {
    const listItems = lpIds.map(id => `"${id}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0008b_TrueFungibleFrozenLPMapper "${account}" [${listItems}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return lpIds.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return lpIds.map(() => null);

    return data.map((item: any) => {
      if (!item || typeof item !== "object" || item === false) return null;
      return item as TrueFungibleLPEntry;
    });
  } catch (err) {
    console.error("URC_0008b_TrueFungibleFrozenLPMapper failed:", err);
    return lpIds.map(() => null);
  }
}

/**
 * Format a TrueFungibleEntry response into display-ready values.
 */
export function formatTFEntry(entry: TrueFungibleEntryData) {
  const walletSupply = parseLPDec(entry["wallet-supply"]);
  const totalSupply = parseLPDec(entry["dptf-supply"]);
  const walletStoa = parseLPDec(entry["wallet-worth-in-stoa"]);
  const walletUsd = typeof entry["wallet-worth-in-dollarz"] === "string"
    ? entry["wallet-worth-in-dollarz"]
    : parseLPDec(entry["wallet-worth-in-dollarz"]);
  const tokenStoa = parseLPDec(entry["token-worth-in-stoa"]);
  const tokenUsd = typeof entry["token-worth-in-dollarz"] === "string"
    ? entry["token-worth-in-dollarz"]
    : parseLPDec(entry["token-worth-in-dollarz"]);

  return { name: entry.t1, tokenId: entry.t2, walletSupply, totalSupply, walletStoa, walletUsd, tokenStoa, tokenUsd };
}

/**
 * Classify a token ID into its category based on prefix.
 * Returns: "lp" | "frozen-lp" | "frozen" | "reserved" | "native"
 */
/**
 * Get the SWP-Pair ID from an LP token ID.
 * Uses SWP.UR_GetLpSwpair on chain.
 */
export async function getSwpairFromLpId(lpId: string): Promise<string | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.SWP.UR_GetLpSwpair "${lpId}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return null;
    const data = response.result.data;
    if (typeof data !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Batch-fetch SWP-Pair IDs for multiple LP token IDs using a single Pact (map ...) call.
 */
export async function getSwpairsFromLpIds(lpIds: string[]): Promise<(string | null)[]> {
  if (lpIds.length === 0) return [];
  try {
    const listItems = lpIds.map(id => `"${id}"`).join(" ");
    const pactCode = `(map (lambda (lid:string) (try "" (${KADENA_NAMESPACE}.SWP.UR_GetLpSwpair lid))) [${listItems}])`;

    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return lpIds.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return lpIds.map(() => null);
    return data.map((v: any) => (typeof v === "string" && v !== "" ? v : null));
  } catch {
    return lpIds.map(() => null);
  }
}

/**
 * Response shape from URC_0017_TruefungibleButton
 * Boolean per action key — true = button enabled, false = disabled.
 * where-* keys provide target pool info for coil/curl/constrict/brumate.
 */
export interface TrueFungibleButtonState {
  mint: boolean;
  burn: boolean;
  wipe: boolean;
  unfold: boolean;
  freeze: boolean;
  reserve: boolean;
  vest: boolean;
  sleep: boolean;
  hibernate: boolean;
  coil: boolean;
  curl: boolean;
  constrict: boolean;
  brumate: boolean;
  recover: boolean;
  sublimate: boolean;
  compress: boolean;
  transmute: boolean;
  unwrap: boolean;
  transfer: boolean;
  "where-coil"?: any;
  "where-curl"?: any;
  "where-constrict"?: any;
  "where-brumate"?: any;
}

/**
 * Fetch button enable/disable state for a specific token held by an account.
 * Uses URC_0017_TruefungibleButton(account, dptf)
 */
export async function getTrueFungibleButtonState(
  account: string,
  dptfId: string,
): Promise<TrueFungibleButtonState | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0017_TruefungibleButton "${account}" "${dptfId}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return null;
    const data = response.result.data;
    if (!data || typeof data !== "object") return null;
    return data as TrueFungibleButtonState;
  } catch (err) {
    console.error("URC_0017_TruefungibleButton failed:", err);
    return null;
  }
}

export function classifyTokenId(tokenId: string): "lp" | "frozen-lp" | "frozen" | "reserved" | "native" {
  // Frozen LP: F|S|, F|W|, F|P|
  if (/^F\|[SWP]\|/.test(tokenId)) return "frozen-lp";
  // LP: S|, W|, P|
  if (/^[SWP]\|/.test(tokenId)) return "lp";
  // Frozen: F|
  if (tokenId.startsWith("F|")) return "frozen";
  // Reserved: R|
  if (tokenId.startsWith("R|")) return "reserved";
  return "native";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Orto Fungibles — URC_0018_OrtofungibleHeader
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrtoFungibleHeaderData {
  "total-orto-fungible-number": number | { int: number };
  "total-orto-fungible-nonces": number | { int: number };
  "held-of": string[];
  "held-of-number": number | { int: number };
  "mngd-of": string[];
  "mngd-of-number": number | { int: number };
}

/**
 * Fetch Orto Fungible header data for an account.
 * Returns global OF count + nonces, held OF list/count, managed OF list/count.
 */
export async function getOrtoFungibleHeader(
  account: string,
): Promise<OrtoFungibleHeaderData | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0018_OrtofungibleHeader "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return null;
    const data = response.result.data;
    if (!data || typeof data !== "object") return null;
    return data as OrtoFungibleHeaderData;
  } catch (err) {
    console.error("URC_0018_OrtofungibleHeader failed:", err);
    return null;
  }
}

/**
 * Classify an Orto Fungible token ID into one of 5 categories.
 *
 * Sleeping LP: Z|S|, Z|W|, Z|P|
 * Vesting:     V|
 * Sleeping:    Z| (but NOT Z|S|, Z|W|, Z|P|)
 * Hibernating: H|
 * Native:      everything else
 */
export type OrtoFungibleCategory = "native" | "vesting" | "sleeping" | "hibernating" | "sleeping-lp";

export function classifyOrtoFungibleId(tokenId: string): OrtoFungibleCategory {
  // Sleeping LP: Z|S|, Z|W|, Z|P| — must be checked BEFORE sleeping
  if (/^Z\|[SWP]\|/.test(tokenId)) return "sleeping-lp";
  // Vesting: V|
  if (tokenId.startsWith("V|")) return "vesting";
  // Sleeping: Z|
  if (tokenId.startsWith("Z|")) return "sleeping";
  // Hibernating: H|
  if (tokenId.startsWith("H|")) return "hibernating";
  return "native";
}

/**
 * Response shape from URC_0009a_OrtoFungibleEntryMapper
 * Same as TrueFungibleEntryData but with extra "wallet-nonces" field.
 */
export interface OrtoFungibleEntryData {
  t1: string;          // display name
  t2: string;          // token ID
  "wallet-supply": { decimal: string } | number;
  "dpof-supply": { decimal: string } | number;
  "wallet-worth-in-stoa": { decimal: string } | number;
  "wallet-worth-in-dollarz": string;
  "token-worth-in-stoa": { decimal: string } | number;
  "token-worth-in-dollarz": string;
  "wallet-nonces": number[];               // list of nonce integers
  "wallet-nonces-no": number | { int: number }; // count of nonces
}

/**
 * Format an OrtoFungibleEntryData into display-ready values.
 * Same as formatTFEntry but includes wallet-nonces.
 */
export function formatOFEntry(entry: OrtoFungibleEntryData) {
  const walletSupply = parseLPDec(entry["wallet-supply"]);
  const totalSupply = parseLPDec(entry["dpof-supply"]);
  const walletStoa = parseLPDec(entry["wallet-worth-in-stoa"]);
  const walletUsd = typeof entry["wallet-worth-in-dollarz"] === "string"
    ? entry["wallet-worth-in-dollarz"]
    : parseLPDec(entry["wallet-worth-in-dollarz"]);
  const tokenStoa = parseLPDec(entry["token-worth-in-stoa"]);
  const tokenUsd = typeof entry["token-worth-in-dollarz"] === "string"
    ? entry["token-worth-in-dollarz"]
    : parseLPDec(entry["token-worth-in-dollarz"]);
  // wallet-nonces can be [0, 1, 2] or [{int: 0}, {int: 1}, {int: 2}] from chain
  const rawNonces = entry["wallet-nonces"] ?? [];
  const walletNonces = rawNonces.map((n: any) => parseIntVal(n));
  const walletNoncesNo = parseIntVal(entry["wallet-nonces-no"]);

  return { name: entry.t1, tokenId: entry.t2, walletSupply, totalSupply, walletStoa, walletUsd, tokenStoa, tokenUsd, walletNonces, walletNoncesNo };
}

/**
 * Batch-fetch OrtoFungibleEntry data for Native/Vesting/Sleeping/Hibernating tokens.
 * Uses URC_0009a_OrtoFungibleEntryMapper(account, dpofs:[string])
 */
export async function getOrtoFungibleEntries(
  account: string,
  tokenIds: string[],
): Promise<(OrtoFungibleEntryData | null)[]> {
  if (tokenIds.length === 0) return [];
  try {
    const listItems = tokenIds.map(id => `"${id}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0009a_OrtoFungibleEntryMapper "${account}" [${listItems}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return tokenIds.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return tokenIds.map(() => null);

    return data.map((item: any) => {
      if (!item || typeof item !== "object" || item === false) return null;
      return item as OrtoFungibleEntryData;
    });
  } catch (err) {
    console.error("URC_0009a_OrtoFungibleEntryMapper failed:", err);
    return tokenIds.map(() => null);
  }
}

/**
 * Batch-fetch Sleeping LP Orto Fungible data.
 * Uses URC_0009b_OrtoFungibleSleepingLPMapper(account, lp-ids:[string])
 */
export async function getOrtoFungibleSleepingLPEntries(
  account: string,
  lpIds: string[],
): Promise<(OrtoFungibleEntryData | null)[]> {
  if (lpIds.length === 0) return [];
  try {
    const listItems = lpIds.map(id => `"${id}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0009b_OrtoFungibleSleepingLPMapper "${account}" [${listItems}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return lpIds.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return lpIds.map(() => null);

    return data.map((item: any) => {
      if (!item || typeof item !== "object" || item === false) return null;
      return item as OrtoFungibleEntryData;
    });
  } catch (err) {
    console.error("URC_0009b_OrtoFungibleSleepingLPMapper failed:", err);
    return lpIds.map(() => null);
  }
}

/**
 * Fetch supplies for specific nonces of an Orto Fungible.
 * Returns a list of decimal strings (one per nonce, in order).
 */
export async function getOrtoFungibleNoncesSupplies(
  dpofId: string,
  nonces: number[],
): Promise<string[]> {
  if (nonces.length === 0) return [];
  try {
    const nonceList = nonces.join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPOF.UR_NoncesSupplies "${dpofId}" [${nonceList}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return nonces.map(() => "0");
    const data = response.result.data;
    if (!Array.isArray(data)) return nonces.map(() => "0");

    return data.map((item: any) => {
      if (item === null || item === undefined) return "0";
      if (typeof item === "object" && "decimal" in item) return String(item.decimal);
      return String(item);
    });
  } catch (err) {
    console.error("DPOF.UR_NoncesSupplies failed:", err);
    return nonces.map(() => "0");
  }
}

/**
 * Fetch metadata for specific nonces of an Orto Fungible.
 * Returns array of metadata objects (one per nonce).
 * Each nonce's metadata is itself an array of objects [object].
 */
export async function getOrtoFungibleNoncesMetaDatas(
  dpofId: string,
  nonces: number[],
): Promise<(any[] | null)[]> {
  if (nonces.length === 0) return [];
  try {
    const nonceList = nonces.join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPOF.UR_NoncesMetaDatas "${dpofId}" [${nonceList}])`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return nonces.map(() => null);
    const data = response.result.data;
    if (!Array.isArray(data)) return nonces.map(() => null);

    return data.map((item: any) => {
      if (!item || !Array.isArray(item)) return item ? [item] : null;
      return item;
    });
  } catch (err) {
    console.error("DPOF.UR_NoncesMetaDatas failed:", err);
    return nonces.map(() => null);
  }
}

/**
 * Hibernating nonce data — custom metadata for hibernating tokens.
 * Returns: { dptf-id, nonce-supply, mint-time, release-time, hibernating-fee-promile, remainder, hibernating-fee }
 */
export interface HibernatingNonceData {
  "dptf-id": string;
  "nonce-supply": { decimal: string } | number;
  "mint-time": string; // Pact time
  "release-time": string; // Pact time
  "hibernating-fee-promile": { decimal: string } | number;
  "remainder": { decimal: string } | number;
  "hibernating-fee": { decimal: string } | number;
}

// ─── URC_0019: Ortofungible Button State ─────────────────────────────────────

export interface OrtofungibleButtonState {
  transfer: boolean;
  transmit: boolean;
  redeem: boolean;
  "reverse-hrbt": boolean;
  unvest: boolean;
  unsleep: boolean;
  merge: boolean;
  awake: boolean;
  slumber: boolean;
  wipe: boolean;
  burn: boolean;
  mint: boolean;
  "add-quantity": boolean;
  [key: string]: boolean;
}

export async function getOrtofungibleButtonState(
  account: string,
  dpofId: string,
  selectedNonces: number[],
): Promise<OrtofungibleButtonState | null> {
  try {
    const nonceList = `[${selectedNonces.join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0019_OrtofungibleButton "${account}" "${dpofId}" ${nonceList})`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return null;
    const data = response.result.data;
    if (!data || typeof data !== "object") return null;
    return data as OrtofungibleButtonState;
  } catch (err) {
    console.error("URC_0019_OrtofungibleButton failed:", err);
    return null;
  }
}

export async function getHibernatingNonceData(
  dpofId: string,
  nonce: number,
): Promise<HibernatingNonceData | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0020_HibernatingNonceData "${dpofId}" ${nonce})`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (!response?.result || response.result.status === "failure") return null;
    const data = response.result.data;
    if (!data || typeof data !== "object") return null;
    return data as HibernatingNonceData;
  } catch (err) {
    console.error("URC_0020_HibernatingNonceData failed:", err);
    return null;
  }
}

// ─── URC_0021: Collectables Header ────────────────────────────────────────────

export interface CollectablesHeaderData {
  "total-semi-fungible-number": number | { int: number };
  "total-semi-fungible-nonces": number | { int: number };
  "held-sf": string[];
  "held-sf-number": number | { int: number };
  "mngd-sf": string[];
  "mngd-sf-no": number | { int: number };
  "total-non-fungible-number": number | { int: number };
  "total-non-fungible-nonces": number | { int: number };
  "held-nf": string[];
  "held-nf-number": number | { int: number };
  "mngd-nf": string[];
  "mngd-nf-no": number | { int: number };
}

export async function getCollectablesHeader(
  account: string,
): Promise<CollectablesHeaderData | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0021_CollectablesHeader "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return null;
    const data = (response.result as any).data;
    if (!data || typeof data !== "object") return null;
    return data as CollectablesHeaderData;
  } catch (err) {
    console.error("URC_0021_CollectablesHeader failed:", err);
    return null;
  }
}

// ─── URC_0022a: Semi/Non Fungible Entry Mapper ───────────────────────────────

export interface CollectableNonceEntry {
  nonce: number | { int: number };
  supply: number | { decimal: string } | { int: number };
}

export interface CollectableEntryData {
  t1: string;   // name
  t2: string;   // dpdc-id
  "wallet-nonces": CollectableNonceEntry[];
  "wallet-nonces-no": number | { int: number };
}

export async function getSemifungibleEntries(
  account: string,
  dpdcIds: string[],
): Promise<(CollectableEntryData | null)[]> {
  try {
    const idList = `[${dpdcIds.map(id => `"${id}"`).join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0022a_SemifungibleEntryMapper "${account}" ${idList})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return dpdcIds.map(() => null);
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return dpdcIds.map(() => null);
    return data as CollectableEntryData[];
  } catch (err) {
    console.error("URC_0022a_SemifungibleEntryMapper failed:", err);
    return dpdcIds.map(() => null);
  }
}

export async function getNonfungibleEntries(
  account: string,
  dpdcIds: string[],
): Promise<(CollectableEntryData | null)[]> {
  try {
    const idList = `[${dpdcIds.map(id => `"${id}"`).join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0022a_NonfungibleEntryMapper "${account}" ${idList})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return dpdcIds.map(() => null);
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return dpdcIds.map(() => null);
    return data as CollectableEntryData[];
  } catch (err) {
    console.error("URC_0022a_NonfungibleEntryMapper failed:", err);
    return dpdcIds.map(() => null);
  }
}

// ─── URC_0023 — Collectable Nonce Data ───────────────────────────────────────

export interface NonceMetaData {
  score: number;
  composition: number[];
  "meta-data": Record<string, any>;
}

export interface URIType {
  image: boolean;
  audio: boolean;
  video: boolean;
  document: boolean;
  archive: boolean;
  model: boolean;
  exotic: boolean;
}

export interface URIData {
  image: string;
  audio: string;
  video: string;
  document: string;
  archive: string;
  model: string;
  exotic: string;
}

export interface NonceData {
  royalty: number;
  ignis: number;
  name: string;
  description: string;
  "meta-data": NonceMetaData;
  "asset-type": URIType;
  "uri-primary": URIData;
  "uri-secondary": URIData;
  "uri-tertiary": URIData;
}

export function parseNonceData(raw: any): NonceData {
  const parseURIType = (t: any): URIType => ({
    image: !!t?.image, audio: !!t?.audio, video: !!t?.video,
    document: !!t?.document, archive: !!t?.archive, model: !!t?.model, exotic: !!t?.exotic,
  });
  const parseURIData = (d: any): URIData => ({
    image: d?.image ?? "", audio: d?.audio ?? "", video: d?.video ?? "",
    document: d?.document ?? "", archive: d?.archive ?? "", model: d?.model ?? "", exotic: d?.exotic ?? "",
  });
  const parseDecNonce = (v: any) => {
    if (typeof v === "number") return v;
    if (typeof v === "object" && v !== null) {
      if ("decimal" in v) return parseFloat(v.decimal) || 0;
      if ("int" in v) return parseFloat(v.int) || 0;
    }
    return parseFloat(String(v)) || 0;
  };
  return {
    royalty: parseDecNonce(raw?.royalty),
    ignis: parseDecNonce(raw?.ignis),
    name: raw?.name ?? "",
    description: raw?.description ?? "",
    "meta-data": {
      score: parseDecNonce(raw?.["meta-data"]?.score),
      composition: Array.isArray(raw?.["meta-data"]?.composition) ? raw["meta-data"].composition : [],
      "meta-data": raw?.["meta-data"]?.["meta-data"] ?? {},
    },
    "asset-type": parseURIType(raw?.["asset-type"]),
    "uri-primary": parseURIData(raw?.["uri-primary"]),
    "uri-secondary": parseURIData(raw?.["uri-secondary"]),
    "uri-tertiary": parseURIData(raw?.["uri-tertiary"]),
  };
}

export async function getCollectableNonceData(
  dpdcId: string,
  isSFT: boolean,
  nonces: number[]
): Promise<NonceData[]> {
  if (nonces.length === 0) return [];
  const nonceList = nonces.join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0023_CollectablesNonceData "${dpdcId}" ${isSFT} [${nonceList}])`;
  try {
    const response = await pactRead(pactCode, { tier: "T5" });
    const data = (response as any)?.result?.data;
    if (Array.isArray(data)) return data.map(parseNonceData);
    return [];
  } catch (e) {
    console.error("URC_0023 fetch error:", e);
    return [];
  }
}

export async function getCollectableNonceSupply(
  dpdcId: string,
  isSFT: boolean,
  nonce: number
): Promise<number> {
  const pactCode = `(${KADENA_NAMESPACE}.DPDC.UR_NonceSupply "${dpdcId}" ${isSFT} ${nonce})`;
  try {
    const response = await pactRead(pactCode, { tier: "T5" });
    const data = (response as any)?.result?.data;
    if (typeof data === "number") return data;
    if (typeof data === "object" && data !== null) {
      if ("decimal" in data) return parseFloat(data.decimal) || 0;
      if ("int" in data) return parseFloat(data.int) || 0;
    }
    return 0;
  } catch (e) {
    console.error("UR_NonceSupply fetch error:", e);
    return 0;
  }
}

/**
 * Batched per-account per-nonce supplies (DPDC.UR_AccountNoncesSupplies).
 * Replaces the per-nonce UR_NonceSupply loop with a single read for N nonces.
 */
export async function getAccountNoncesSupplies(
  account: string,
  dpdcId: string,
  isSFT: boolean,
  nonces: number[],
): Promise<number[]> {
  if (nonces.length === 0) return [];
  try {
    const nonceList = nonces.join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.DPDC.UR_AccountNoncesSupplies "${account}" "${dpdcId}" ${isSFT} [${nonceList}])`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return nonces.map(() => 0);
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return nonces.map(() => 0);
    return data.map((n: any) => {
      if (typeof n === "number") return n;
      if (typeof n === "object" && n !== null) {
        if ("decimal" in n) return parseFloat(n.decimal) || 0;
        if ("int" in n) return parseFloat(n.int) || 0;
      }
      return parseFloat(String(n)) || 0;
    });
  } catch (err) {
    console.error("DPDC.UR_AccountNoncesSupplies failed:", err);
    return nonces.map(() => 0);
  }
}

// ─── URC_0024: Set Reader ─────────────────────────────────────────────────────

export interface SetAllowedNonceForPosition {
  "allowed-nonces": number[] | Array<number | { int: number }>;
}

export interface SetAllowedClassForPosition {
  "allowed-sclass": number | { int: number };
}

export interface SetDefinition {
  "set-class": number | { int: number };
  "set-name": string;
  "set-score-multiplier": number | { decimal: string };
  "nonce-of-set": number | { int: number };
  "iz-active": boolean;
  "primordial": boolean;
  "composite": boolean;
  "primordial-set-definition": SetAllowedNonceForPosition[];
  "composite-set-definition": SetAllowedClassForPosition[];
  "nonce-data": any;
  "split-data": any;
}

export async function getCollectableSets(
  dpdcId: string,
  isSFT: boolean,
): Promise<SetDefinition[]> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0024_SetReader "${dpdcId}" ${isSFT})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return [];
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return [];
    return data as SetDefinition[];
  } catch (err) {
    console.error("URC_0024_SetReader failed:", err);
    return [];
  }
}

// ─── URC_0025: Filter Nonces by Class ─────────────────────────────────────────

/**
 * Filter wallet nonces by nonce class for composite set positions.
 * Returns only the nonces that match the given class.
 */
export async function filterNoncesByClass(
  dpdcId: string,
  isSFT: boolean,
  nonces: number[],
  nonceClass: number,
): Promise<number[]> {
  if (nonces.length === 0) return [];
  try {
    const nonceList = `[${nonces.join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0025_FilterNoncesByClass "${dpdcId}" ${isSFT} ${nonceList} ${nonceClass})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return [];
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return [];
    return data.map((n: any) => {
      if (typeof n === "number") return n;
      if (typeof n === "object" && n !== null && "int" in n) return n.int;
      return parseInt(String(n), 10) || 0;
    }).filter((n: number) => n > 0);
  } catch (err) {
    console.error("URC_0025_FilterNoncesByClass failed:", err);
    return [];
  }
}

/**
 * Batched filter-nonces-by-classes (URC_0025a_FilterNoncesByClasses).
 * One network call returns one filtered nonce list per class, in order.
 * Replaces N per-position calls to filterNoncesByClass.
 */
export async function filterNoncesByClasses(
  dpdcId: string,
  isSFT: boolean,
  nonces: number[],
  nonceClasses: number[],
): Promise<number[][]> {
  if (nonceClasses.length === 0) return [];
  if (nonces.length === 0) return nonceClasses.map(() => []);
  try {
    const nonceList = `[${nonces.join(" ")}]`;
    const classList = `[${nonceClasses.join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0025a_FilterNoncesByClasses "${dpdcId}" ${isSFT} ${nonceList} ${classList})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return nonceClasses.map(() => []);
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return nonceClasses.map(() => []);
    return data.map((row: any) => {
      if (!Array.isArray(row)) return [];
      return row.map((n: any) => {
        if (typeof n === "number") return n;
        if (typeof n === "object" && n !== null && "int" in n) return n.int;
        return parseInt(String(n), 10) || 0;
      }).filter((n: number) => n > 0);
    });
  } catch (err) {
    console.error("URC_0025a_FilterNoncesByClasses failed:", err);
    return nonceClasses.map(() => []);
  }
}

// ─── URC_0026: Collectables Button State ─────────────────────────────────────

export interface CollectablesButtonState {
  morph: boolean;
  "add-quantity": boolean;
  burn: boolean;
  respawn: boolean;
  wipe: boolean;
  fuse: boolean;
  split: boolean;
  "break-set": boolean;
  transfer: boolean;
  [key: string]: boolean;
}

export async function getCollectablesButtonState(
  account: string,
  dpdcId: string,
  isSFT: boolean,
  selectedNonces: number[],
): Promise<CollectablesButtonState | null> {
  try {
    const nonceList = `[${selectedNonces.join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0026_CollectablesButtons "${account}" "${dpdcId}" ${isSFT} ${nonceList})`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (!response?.result || response.result.status === "failure") return null;
    const data = (response.result as any).data;
    if (!data || typeof data !== "object") return null;
    return data as CollectablesButtonState;
  } catch (err) {
    console.error("URC_0026_CollectablesButtons failed:", err);
    return null;
  }
}
