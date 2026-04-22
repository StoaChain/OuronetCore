import { calculateAutoGasLimit } from "../gas";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE, GAS_STATION,
  KADENA_NETWORK,
  PACT_URL,
} from "../constants";
import { Pact, createClient } from "@kadena/client";
import { universalSignTransaction, fromKeypair } from "../signing";
import { IOuroAccountKeypair, IKadenaKeypair } from "./dexFunctions";
import { mayComeWithDeimal } from "../pact";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


// ===========================
// ADD LIQUIDITY FUNCTIONS
// ===========================

// Liquidity Data object interface
export interface LiquidityData {
  [key: string]: any; // Will be defined based on actual Pact structure
}

// Deviation validation result
export interface DeviationResult {
  deviation: number;
  maxDeviation: number;
  isValid: boolean;
}

// Add Liquidity parameters
export interface AddLiquidityParams {
  patronKeypair: IOuroAccountKeypair;
  kadenaKeypair: IKadenaKeypair;
  guardKeypair: IKadenaKeypair;
  account: string;
  swpair: string;
  inputAmounts: string[];
}

// Multi-step add liquidity result
export interface MultiStepAddLiquidityResult {
  type: "multi-step";
  steps: Array<{
    stepNumber: number;
    transaction: any;
    requestKey: string;
    status: "completed" | "pending" | "failed";
  }>;
  totalSteps: number;
  // TransactionProcessing compatibility properties (from final step)
  requestKey?: string;
  chainId?: string;
  networkId?: string;
}

// LP Type information
export interface LPTypeInfo {
  hasFrozenLP: boolean;
  hasSleepingLP: boolean;
}

// Special LP Type parameters
export interface SpecialLPParams {
  type: "iced" | "glacial" | "frozen" | "sleeping";
  frozenDptf?: string; // For frozen LP
  sleepingDpmf?: string; // For sleeping LP
  nonce?: number; // For sleeping LP
}

/**
 * Generate LiquidityData object for deviation validation
 */
export async function generateLiquidityData(
  swpair: string,
  input: string,
  amounts: number[]
): Promise<LiquidityData | null> {
  try {
    const pactAmounts = `[${amounts.map(amount => {
      const amountStr = amount.toString();
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    const transaction = Pact.builder
      .execution(`(${KADENA_NAMESPACE}.SWPL.URC_LD "${swpair}" "${input}" ${pactAmounts})`)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({
        chainId: KADENA_CHAIN_ID,
        gasLimit: 150_000,
      })
      .createTransaction();

    const { dirtyRead } = createClient(PACT_URL);
    const response = await dirtyRead(transaction);

    if (!response || !response.result) {
      throw new Error("Failed to generate liquidity data from the transaction.");
    }

    if (response.result.status === "failure") {
      throw new Error(`Liquidity data generation failed: ${response.result.error?.message || "Unknown error"}`);
    }

    return response.result.data as LiquidityData;
    
  } catch (error) {
    console.error("Generate liquidity data failed:", error);
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Validate liquidity deviation
 */
export async function validateLiquidityDeviation(
  swpair: string,
  liquidityData: LiquidityData
): Promise<DeviationResult | null> {
  try {
    const transaction = Pact.builder
      .execution(`(${KADENA_NAMESPACE}.SWPL.UEV_Liquidity "${swpair}" ${JSON.stringify(liquidityData)})`)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({
        chainId: KADENA_CHAIN_ID,
        gasLimit: 100_000,
      })
      .createTransaction();

    const { dirtyRead } = createClient(PACT_URL);
    const response = await dirtyRead(transaction);

    if (!response || !response.result) {
      throw new Error("Failed to validate liquidity deviation from the transaction.");
    }

    if (response.result.status === "failure") {
      // This might fail if deviation exceeds max - capture the error for UI
      const errorMessage = response.result.error?.message || "";
      const deviationMatch = errorMessage.match(/(\d+\.?\d*)\s*deviation.*maximum.*?(\d+\.?\d*)/);
      
      if (deviationMatch) {
        return {
          deviation: parseFloat(deviationMatch[1]),
          maxDeviation: parseFloat(deviationMatch[2]),
          isValid: false
        };
      }
      
      throw new Error(`Liquidity deviation validation failed: ${errorMessage}`);
    }

    const data = response.result.data;
    
    // Data should be [dev, max-dev]
    if (Array.isArray(data) && data.length >= 2) {
      const deviation = typeof data[0] === 'object' ? parseFloat(data[0].decimal) : parseFloat(data[0]);
      const maxDeviation = typeof data[1] === 'object' ? parseFloat(data[1].decimal) : parseFloat(data[1]);
      
      return {
        deviation,
        maxDeviation,
        isValid: deviation <= maxDeviation
      };
    }
    
    return null;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Calculate balanced liquidity amounts based on one input token
 */
export async function calculateBalancedLiquidity(
  swpair: string,
  inputTokenId: string,
  inputAmount: string,
  withValidation: boolean = true
): Promise<string[]> {
  try {
    // Format amount for Pact (ensure decimal format)
    const pactAmount = inputAmount.includes('.') 
      ? inputAmount 
      : `${inputAmount}.0`;
    
    const pactCode = `(${KADENA_NAMESPACE}.SWPL.URC_BalancedLiquidity "${swpair}" "${inputTokenId}" ${pactAmount} ${withValidation})`;
    
    const transaction = Pact.builder
      .execution(pactCode)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({
        chainId: KADENA_CHAIN_ID,
        gasLimit: 100_000,
      })
      .createTransaction();

    const { dirtyRead } = createClient(PACT_URL);
    const response = await dirtyRead(transaction);

    if (!response || !response.result) {
      throw new Error("Failed to calculate balanced liquidity from the transaction.");
    }

    if (response.result.status === "failure") {
      const errorMessage = response.result.error?.message || "Unknown error";
      throw new Error(`Balanced liquidity calculation failed: ${errorMessage}`);
    }

    const data = response.result.data;
    
    // Parse the result array using mayComeWithDeimal for consistent handling
    let balancedAmounts: string[] = [];
    
    if (Array.isArray(data)) {
      balancedAmounts = data.map(item => mayComeWithDeimal(item));
    } else {
      throw new Error("Expected array result from balanced liquidity calculation");
    }
    
    return balancedAmounts;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Balanced liquidity calculation failed");
  }
}

/**
 * Check if pool supports special LP types
 */
export async function getLPTypeInfo(swpair: string): Promise<LPTypeInfo> {
  try {
    const [frozenCheck, sleepingCheck] = await Promise.all([
      // Check for Frozen LP support
      (async () => {
        try {
          const transaction = Pact.builder
            .execution(`(${KADENA_NAMESPACE}.SWP.UR_IzFrozenLP "${swpair}")`)
            .setNetworkId(KADENA_NETWORK)
            .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 50_000 })
            .createTransaction();

          const { dirtyRead } = createClient(PACT_URL);
          const response = await dirtyRead(transaction);
          
          return response?.result?.status === "success" ? response.result.data === true : false;
        } catch {
          return false;
        }
      })(),
      
      // Check for Sleeping LP support
      (async () => {
        try {
          const transaction = Pact.builder
            .execution(`(${KADENA_NAMESPACE}.SWP.UR_IzSleepingLP "${swpair}")`)
            .setNetworkId(KADENA_NETWORK)
            .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 50_000 })
            .createTransaction();

          const { dirtyRead } = createClient(PACT_URL);
          const response = await dirtyRead(transaction);
          
          return response?.result?.status === "success" ? response.result.data === true : false;
        } catch {
          return false;
        }
      })()
    ]);

    return {
      hasFrozenLP: frozenCheck,
      hasSleepingLP: sleepingCheck
    };
    
  } catch (error) {
    return { hasFrozenLP: false, hasSleepingLP: false };
  }
}

/**
 * Execute single-step add liquidity (TS01-C3 module)
 */
export async function executeAddLiquiditySingle(
  params: AddLiquidityParams
): Promise<any> {
  try {
    const pactInputAmounts = `[${params.inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : String(amount);
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_AddLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputAmounts})`;
  
    const keysetName = `ks`;
    // Scale gas limit based on pool token count: 60k per token
    const tokenCount = params.inputAmounts.length;
    const defaultGasLimit = tokenCount * 100_000;
    
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
          gasLimit: gasLimitOverride ?? defaultGasLimit,
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
    
    // Simulate to estimate gas
    const simTransaction = buildTransaction(defaultGasLimit);
    const simulation = await dirtyRead(simTransaction);

    // Check if simulation failed
    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Add liquidity simulation failed: ${errorMessage}`);
    }

    // Set actual gas limit = simulation gas + 5K buffer
    const actualGasLimit = (simulation.gas || defaultGasLimit) + 5_000;
    const transaction = buildTransaction(actualGasLimit);

    // Sign the transaction
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
 * Execute multi-step add liquidity (TS01-CP module) - Step 1
 */
export async function executeAddLiquidityMultiStep1(
  params: AddLiquidityParams
): Promise<any> {
  try {
    const pactInputAmounts = `[${params.inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : String(amount);
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    const pactCode = `(${KADENA_NAMESPACE}.TS01-CP.SWP|C_AddStandardLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputAmounts})`;
    
    
    const keysetName = `ks`;
    let gasLimit = 2_000_000;
    
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
      throw new Error(`Add liquidity multi-step 1 simulation failed: ${errorMessage}`);
    }

    // Check if we need to adjust gas limit
    const requiredGas = simulation.gas;
    if (requiredGas && requiredGas > gasLimit) {
      gasLimit = calculateAutoGasLimit(requiredGas);
      transaction = buildTransaction(gasLimit);
    }

    // Sign the transaction
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the transaction
    const result = await submit(signedTransaction);
    
    // Wait for transaction to complete and extract pactId
    const { listen } = createClient(PACT_URL);
    const transactionResult = await listen(result);
    
    
    // Extract pactId from the transaction result for continuation steps
    const pactId = result.requestKey;
    
    
    return {
      ...result,
      pactId: pactId,
      transactionResult: transactionResult
    };
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute multi-step add liquidity continuation (Step 2)
 */
export async function executeAddLiquidityMultiStep2(
  params: AddLiquidityParams,
  step1Result: any
): Promise<any> {
  try {
    if (!step1Result?.pactId) {
      throw new Error("Step 1 pactId is required for continuation but is missing or undefined");
    }
    
    const gasLimit = 2_000_000; // Safe buffer for continuation steps
    
    const buildTransaction = (gasLimitOverride?: number) => {
      return Pact.builder
        .continuation({
          pactId: step1Result.pactId,
          rollback: false,
          step: 1,
          proof: null
        })
        .setMeta({
          senderAccount: `k:${params.kadenaKeypair.publicKey}`, // Direct kadena gas payment for continuation 
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride || gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey) // No gas station capability for continuation
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();
    };

    const { submit } = createClient(PACT_URL);
    
    // Build transaction with fixed gas limit (no simulation needed)
    const transaction = buildTransaction();

    // Sign the transaction - simple signing for continuation (direct kadena gas payment)
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the transaction
    const result = await submit(signedTransaction);
    
    
    return result;
    
  } catch (error) {
    console.error("Multi-Step Add Liquidity Step 2 Error:", error);
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute multi-step add liquidity final step (Step 3)
 */
export async function executeAddLiquidityMultiStep3(
  params: AddLiquidityParams,
  step1Result: any
): Promise<any> {
  try {
    if (!step1Result?.pactId) {
      throw new Error("Step 1 pactId is required for continuation but is missing or undefined");
    }

    
    const gasLimit = 2_000_000; // Safe buffer for continuation steps
    
    const buildTransaction = (gasLimitOverride?: number) => {
      return Pact.builder
        .continuation({
          pactId: step1Result.pactId,
          rollback: false,
          step: 2,
          proof: null
        })
        .setMeta({
          senderAccount: `k:${params.kadenaKeypair.publicKey}`, // Direct kadena gas payment for continuation 
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride || gasLimit,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(params.kadenaKeypair.publicKey) // No gas station capability for continuation
        .addSigner(params.guardKeypair.publicKey)
        .createTransaction();
    };

    const { submit } = createClient(PACT_URL);
    
    // Build transaction with fixed gas limit (no simulation needed)
    const transaction = buildTransaction();

    // Sign the transaction - simple signing for continuation (direct kadena gas payment)
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the transaction
    const result = await submit(signedTransaction);
    
    
    return result;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Unknown error occurred");
  }
}

/**
 * Execute complete multi-step add liquidity (all 3 steps with continuation)
 */
export async function executeAddLiquidityMultiStepComplete(
  params: AddLiquidityParams,
  onProgress?: (step: number) => void
): Promise<MultiStepAddLiquidityResult> {
  const steps: MultiStepAddLiquidityResult['steps'] = [];
  
  try {

    
    // Step 1: Initial transaction
    const step1Result = await executeAddLiquidityMultiStep1(params);
    const step1RequestKey = step1Result.requestKey;
    
    if (!step1RequestKey || !step1Result.pactId) {
      throw new Error("Step 1 request key or pactId is missing or undefined");
    }
    
    steps.push({
      stepNumber: 1,
      transaction: step1Result,
      requestKey: step1RequestKey,
      status: "completed"
    });
    
    // Notify step 1 completion
    onProgress?.(0);
    
    // Wait for step 1 to be confirmed before continuing
    const { listen } = createClient(PACT_URL);
    await listen(step1Result);
    
    // Much longer delay to ensure transaction is fully processed and available for continuation on mainnet
    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased from 5s to 15s
    
    
    // Step 2: First continuation (with retry if transaction not found)
    let step2Result;
    let step2RequestKey;
    let retryCount = 0;
    const maxRetries = 5; // Increased from 3 to 5 for better success rate
    
    while (retryCount <= maxRetries) {
      try {
        step2Result = await executeAddLiquidityMultiStep2(params, step1Result);
        step2RequestKey = step2Result.requestKey;
        break; // Success, exit retry loop
      } catch (error: any) {
        if (error.message.includes("Cannot find module") && retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Increased from 3s to 10s
          retryCount++;
        } else {
          throw error; // Re-throw if not a "module not found" error or max retries exceeded
        }
      }
    }
    
    if (!step2Result || !step2RequestKey) {
      throw new Error("Step 2 failed to complete successfully");
    }
    
    steps.push({
      stepNumber: 2,
      transaction: step2Result,
      requestKey: step2RequestKey,
      status: "completed"
    });
    
    // Notify step 2 completion
    onProgress?.(1);
    
    // Wait for step 2 to be confirmed
    await listen(step2Result);
    
    await new Promise(resolve => setTimeout(resolve, 3000)); // Increased from 5s to 15s
    
    
    // Step 3: Final continuation (with retry if transaction not found)
    let step3Result;
    retryCount = 0;
    
    while (retryCount <= maxRetries) {
      try {
        step3Result = await executeAddLiquidityMultiStep3(params, step1Result);
        break; // Success, exit retry loop
      } catch (error: any) {
        if (error.message.includes("Cannot find module") && retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Increased from 3s to 10s
          retryCount++;
        } else {
          throw error; // Re-throw if not a "module not found" error or max retries exceeded
        }
      }
    }
    
    if (!step3Result) {
      throw new Error("Step 3 failed to complete successfully");
    }
    
    steps.push({
      stepNumber: 3,
      transaction: step3Result,
      requestKey: step3Result.requestKey,
      status: "completed"
    });
    
    // Notify step 3 completion (final step)
    onProgress?.(2);
    
    console.info("Multi-step Summary:", {
      totalSteps: 3,
      step1Key: step1RequestKey,
      step2Key: step2RequestKey,
      step3Key: step3Result.requestKey
    });
    
    return {
      type: "multi-step",
      steps,
      totalSteps: 3,
      // Add transaction properties from final step for TransactionProcessing compatibility
      requestKey: step3Result.requestKey,
      chainId: step3Result.chainId,
      networkId: step3Result.networkId
    };
    
  } catch (error) {
    console.info("Multi-Step Add Liquidity Error:", error);
    
    // Mark current step as failed
    if (steps.length > 0) {
      steps[steps.length - 1].status = "failed";
    }
    
    throw error instanceof Error ? error : new Error("Multi-step add liquidity failed");
  }
}

/**
 * Main add liquidity function - always uses single-step with gas simulation
 */
export async function executeAddLiquidity(
  params: AddLiquidityParams,
  _strategy: "auto" | "single" | "multi" = "auto",
): Promise<any> {
  try {
    return await executeAddLiquiditySingle(params);
  } catch (error) {
    console.error("Add Liquidity Error:", error);
    throw error instanceof Error ? error : new Error("Add liquidity execution failed");
  }
}

/**
 * Execute special LP type add liquidity (Iced, Glacial, Frozen, Sleeping)
 */
export async function executeSpecialAddLiquidity(
  params: AddLiquidityParams,
  specialParams: SpecialLPParams
): Promise<any> {
  try {
    let pactCode: string;

    const pactInputAmounts = `[${params.inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : String(amount);
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    switch (specialParams.type) {
      case "iced":
        pactCode = `(${KADENA_NAMESPACE}.TS01-CP.SWP|C_AddIcedLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputAmounts})`;
        break;
      case "glacial":
        pactCode = `(${KADENA_NAMESPACE}.TS01-CP.SWP|C_AddGlacialLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputAmounts})`;
        break;
      case "frozen":
        if (!specialParams.frozenDptf) {
          throw new Error("frozenDptf parameter required for frozen liquidity");
        }
        // Note: Frozen liquidity uses single input amount, not array
        const frozenAmount = params.inputAmounts[0] || 0;
        const frozenAmountStr = frozenAmount.toString().includes('.') ? frozenAmount.toString() : `${frozenAmount}.0`;
        pactCode = `(${KADENA_NAMESPACE}.TS01-CP.SWP|C_AddFrozenLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" "${specialParams.frozenDptf}" ${frozenAmountStr})`;
        break;
      case "sleeping":
        if (!specialParams.sleepingDpmf || specialParams.nonce === undefined) {
          throw new Error("sleepingDpmf and nonce parameters required for sleeping liquidity");
        }
        pactCode = `(${KADENA_NAMESPACE}.TS01-CP.SWP|C_AddSleepingLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" "${specialParams.sleepingDpmf}" ${specialParams.nonce})`;
        break;
      default:
        throw new Error(`Unsupported special LP type: ${specialParams.type}`);
    }
    
    const keysetName = `ks`;
    let gasLimit = 2_000_000;
    
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
      throw new Error(`Add ${specialParams.type} liquidity simulation failed: ${errorMessage}`);
    }

    // Check if we need to adjust gas limit
    const requiredGas = simulation.gas;
    if (requiredGas && requiredGas > gasLimit) {
      gasLimit = calculateAutoGasLimit(requiredGas);
      transaction = buildTransaction(gasLimit);
    }

    // Sign the transaction
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(params.kadenaKeypair),
    fromKeypair(params.guardKeypair),
  ]);

    // Submit the transaction
    const result = await submit(signedTransaction);
    
    
    return result;
    
  } catch (error) {
    console.error(`Add ${specialParams.type} Liquidity Error:`, error);
    throw error instanceof Error ? error : new Error("Special add liquidity execution failed");
  }
}

// ── Balanced & Asymmetric Liquidity Functions ─────────────────────────────────


/**
 * URC_BalancedLiquidity — compute balanced amounts for all tokens given one input.
 * Returns decimal[] with balanced values for each pool token.
 */
export async function getBalancedLiquidity(
  swpair: string, inputId: string, inputAmount: string, withValidation: boolean = false
): Promise<string[] | null> {
  try {
    const amt = inputAmount.includes(".") ? inputAmount : inputAmount + ".0";
    const pactCode = `(${KADENA_NAMESPACE}.SWPL.URC_BalancedLiquidity "${swpair}" "${inputId}" ${amt} ${withValidation})`;
    const tx = Pact.builder.execution(pactCode)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 150_000 })
      .setNetworkId(KADENA_NETWORK).createTransaction();
    const { dirtyRead } = createClient(PACT_URL);
    const res = await dirtyRead(tx);
    if (!res?.result || res.result.status === "failure") return null;
    const data = res.result.data as any;
    if (!Array.isArray(data)) return null;
    return data.map((v: any) => {
      if (typeof v === "object" && v?.decimal) return String(v.decimal);
      return String(v);
    });
  } catch (e) { console.error("getBalancedLiquidity error:", e); return null; }
}

/**
 * URC_SortLiquidity — split input amounts into balanced + asymmetric portions.
 * Returns { balanced: string[], asymmetric: string[] }
 */
export async function getSortLiquidity(
  swpair: string, inputAmounts: string[]
): Promise<{ balanced: string[]; asymmetric: string[] } | null> {
  try {
    const pactAmounts = `[${inputAmounts.map(a => { const s = String(a); return s.includes(".") ? s : s + ".0"; }).join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.SWPL.URC_SortLiquidity "${swpair}" ${pactAmounts})`;
    const tx = Pact.builder.execution(pactCode)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 150_000 })
      .setNetworkId(KADENA_NETWORK).createTransaction();
    const { dirtyRead } = createClient(PACT_URL);
    const res = await dirtyRead(tx);
    if (!res?.result || res.result.status === "failure") return null;
    const data = res.result.data as any;
    const parseArr = (arr: any[]) => arr.map((v: any) => typeof v === "object" && v?.decimal ? String(v.decimal) : String(v));
    return {
      balanced: parseArr(data?.balanced ?? []),
      asymmetric: parseArr(data?.asymmetric ?? []),
    };
  } catch (e) { console.error("getSortLiquidity error:", e); return null; }
}

/**
 * URC_LD — build LiquidityData object from input amounts.
 */
export async function getLiquidityData(
  swpair: string, inputAmounts: string[]
): Promise<any | null> {
  try {
    const pactAmounts = `[${inputAmounts.map(a => { const s = String(a); return s.includes(".") ? s : s + ".0"; }).join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.SWPL.URC_LD "${swpair}" ${pactAmounts})`;
    const tx = Pact.builder.execution(pactCode)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 150_000 })
      .setNetworkId(KADENA_NETWORK).createTransaction();
    const { dirtyRead } = createClient(PACT_URL);
    const res = await dirtyRead(tx);
    if (!res?.result || res.result.status === "failure") return null;
    return res.result.data;
  } catch (e) { console.error("getLiquidityData error:", e); return null; }
}

/**
 * UEV_Liquidity — validate asymmetric liquidity doesn't exceed max deviation.
 * Returns true if valid, false if deviation too high.
 */
/**
 * Validate asymmetric liquidity deviation.
 * Returns { valid: true, computed: string, max: string } on success,
 * or { valid: false } when deviation exceeds limit (enforce fails).
 */
export async function validateLiquidity(
  swpair: string, inputAmounts: string[]
): Promise<{ valid: boolean; computed?: string; max?: string }> {
  try {
    const pactAmounts = `[${inputAmounts.map(a => { const s = String(a || "0"); return s.includes(".") ? s : s + ".0"; }).join(" ")}]`;
    // Try to run UEV_Liquidity — returns [computed_deviation, max_deviation] on success, throws on exceed
    const pactCode = `(let ((ld (${KADENA_NAMESPACE}.SWPL.URC_LD "${swpair}" ${pactAmounts}))) (try [false false] (${KADENA_NAMESPACE}.SWPL.UEV_Liquidity "${swpair}" ld)))`;
    const tx = Pact.builder.execution(pactCode)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 200_000 })
      .setNetworkId(KADENA_NETWORK).createTransaction();
    const { dirtyRead } = createClient(PACT_URL);
    const res = await dirtyRead(tx);
    if (!res?.result || res.result.status === "failure") return { valid: false };
    const data = res.result.data as any;
    // If try caught the error, data = [false, false]
    if (Array.isArray(data) && data[0] === false) return { valid: false };
    // Success: data = [computed_deviation, max_deviation]
    if (Array.isArray(data) && data.length >= 2) {
      const parseVal = (v: any) => typeof v === "object" && v?.decimal ? String(v.decimal) : String(v);
      return { valid: true, computed: parseVal(data[0]), max: parseVal(data[1]) };
    }
    return { valid: true };
  } catch { return { valid: false }; }
}

/**
 * Execute Fuel — transfer tokens into pool without receiving LP.
 * (ouronet-ns.TS01-C3.SWP|C_Fuel patron account swpair input-amounts)
 */
export async function executeFuel(
  params: AddLiquidityParams
): Promise<any> {
  try {
    const pactInputAmounts = `[${params.inputAmounts.map(amount => {
      const amountStr = typeof amount === 'string' ? amount : String(amount);
      return amountStr.includes('.') ? amountStr : `${amountStr}.0`;
    }).join(' ')}]`;
    
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_Fuel "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${pactInputAmounts})`;
  
    const keysetName = `ks`;
    const tokenCount = params.inputAmounts.length;
    const defaultGasLimit = tokenCount * 100_000;
    
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
          gasLimit: gasLimitOverride ?? defaultGasLimit,
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
    
    const simTransaction = buildTransaction(defaultGasLimit);
    const simulation = await dirtyRead(simTransaction);

    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Fuel simulation failed: ${errorMessage}`);
    }

    const actualGasLimit = (simulation.gas || defaultGasLimit) + 5_000;
    const transaction = buildTransaction(actualGasLimit);

    const signedTransaction: any = await universalSignTransaction(transaction, [
      fromKeypair(params.kadenaKeypair),
      fromKeypair(params.guardKeypair),
    ]);

    const result = await submit(signedTransaction);
    return result;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Fuel execution failed");
  }
}

/**
 * Execute Remove Liquidity (Unfold) — burn LP tokens to recover underlying pool tokens.
 * (ouronet-ns.TS01-C3.SWP|C_RemoveLiquidity patron account swpair lp-amount)
 */
export async function executeRemoveLiquidity(
  params: {
    patronKeypair: { address: string; publicKey: string };
    kadenaKeypair: { publicKey: string; secretKey: string };
    guardKeypair: { publicKey: string; secretKey: string };
    account: string;
    swpair: string;
    lpAmount: string;
  }
): Promise<any> {
  try {
    const decLpAmount = params.lpAmount.includes(".") ? params.lpAmount : params.lpAmount + ".0";
    const pactCode = `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_RemoveLiquidity "${params.patronKeypair.address}" "${params.account}" "${params.swpair}" ${decLpAmount})`;
    const keysetName = `ks`;
    const defaultGasLimit = 200_000;
    
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
          gasLimit: gasLimitOverride ?? defaultGasLimit,
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
    
    const simTransaction = buildTransaction(defaultGasLimit);
    const simulation = await dirtyRead(simTransaction);

    if (simulation.result.status === "failure") {
      const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Remove liquidity simulation failed: ${errorMessage}`);
    }

    const actualGasLimit = (simulation.gas || defaultGasLimit) + 5_000;
    const transaction = buildTransaction(actualGasLimit);

    const signedTransaction: any = await universalSignTransaction(transaction, [
      fromKeypair(params.kadenaKeypair),
      fromKeypair(params.guardKeypair),
    ]);

    const result = await submit(signedTransaction);
    return result;
    
  } catch (error) {
    throw error instanceof Error ? error : new Error("Remove liquidity execution failed");
  }
}
