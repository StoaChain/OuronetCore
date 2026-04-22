import { calculateAutoGasLimit } from "../gas";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE, GAS_STATION,
  KADENA_NETWORK,
  PACT_URL,
} from "../constants";
import { Pact, createClient } from "@kadena/client";
import { pactRead } from "../reads";
import { universalSignTransaction, fromKeypair } from "../signing";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


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

/**
 * Get KPay data for a specific Ouro account
 * @param account - Ouro account address
 * @returns KPay data object or null on failure
 */
export async function getKpayData(account: string): Promise<any> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.DEMIPAD-KPAY.UR_Kpay "${account}")`, { tier: "T5" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return response.result.data as any;
  } catch (error) {
    console.error("Error getting KPay data:", error);
    return null;
  }
}

/**
 * Get cost for specific amount of KPAY tokens with future price projection
 * @param amount - Amount of KPAY tokens (integer)
 * @param futureSeconds - Seconds in the future to calculate price (default 900 = 15 minutes)
 * @returns Object with pid (price in dollars) and wkda (WSTOA amount) or null
 */
export async function getKpayAmountCosts(
  amount: number,
  futureSeconds: number = 900.0
): Promise<{ pid: string; wkda: string } | null> {
  try {
    const integerAmount = Math.floor(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.DEMIPAD-KPAY.URC_KpayAmountCosts ${integerAmount} ${futureSeconds})`, { tier: "T6" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return response.result.data as any;
  } catch (error) {
    console.error("Error getting KPay amount costs:", error);
    return null;
  }
}

/**
 * Get required capabilities for KPAY acquisition
 * @param buyer - Buyer Ouro account address
 * @param amount - Amount of KPAY tokens (integer)
 * @param isNative - true for KDA native, false for WSTOA
 * @returns Array of capability strings or null
 */
export async function getKpayAcquireCapabilities(
  buyer: string,
  amount: number,
  isNative: boolean
): Promise<string[] | null> {
  try {
    const integerAmount = Math.floor(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.DEMIPAD-KPAY.URC_Acquire "${buyer}" ${integerAmount} ${isNative})`, { tier: "T5" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return response.result.data as any;
  } catch (error) {
    console.error("Error getting KPay acquire capabilities:", error);
    return null;
  }
}

/**
 * Parse capability string from blockchain format to withCapability format
 * @param capString - Capability string like "<(coin.TRANSFER \"k:...\" \"c:...\" 46.298)>"
 * @returns Parsed capability object or null
 */
function parseCapabilityString(capString: string): { name: string; args: any[] } | null {
  try {
    // Remove < > wrapper and extra whitespace
    const cleaned = capString.replace(/^<\s*|\s*>$/g, '').trim();
    
    // Pattern for: (coin.TRANSFER "from" "to" amount)
    // More flexible regex that allows dots, pipes, and other chars in module names
    const regex = /\(([^\s]+)\s+"([^"]+)"\s+"([^"]+)"\s+([\d.]+)\)/;
    const match = cleaned.match(regex);
    
    if (!match) {
      return null;
    }
    
    const [, name, from, to, amount] = match;
    
    // For coin.TRANSFER, format args as [from, to, { decimal: amount }]
    if (name === "coin.TRANSFER") {
      return {
        name,
        args: [from, to, { decimal: amount }]
      };
    }
    
    // Generic fallback for other capabilities
    return {
      name,
      args: [from, to, { decimal: amount }]
    };
  } catch (error) {
    console.error("Error parsing capability string:", error);
    return null;
  }
}

/**
 * Buy KPAY tokens with KDA or WSTOA
 * @param patronAccount - Patron Ouro account
 * @param buyerAccount - Buyer Ouro address (usually same as patron)
 * @param kpayAmount - Amount of KPAY tokens to buy (integer)
 * @param isNative - true for KDA native, false for WSTOA
 * @param kadenaAccount - Kadena account for gas and payments
 * @param guardAccount - Guard account from Ouro account
 * @returns Transaction result
 */
export async function kpayBuy(
  patronAccount: IOuroAccountKeypair,
  buyerAccount: string,
  kpayAmount: number,
  isNative: boolean,
  kadenaAccount: IKadenaKeypair,
  guardAccount: IKadenaKeypair,
  guardKeyset: { keys: string[]; pred: "keys-all" | "keys-any" | "keys-2" }
): Promise<any> {
  const keysetName = `ks`;
  
  // 1. Convert to integer
  const integerAmount = Math.floor(kpayAmount);
  
  // 2. Get required capabilities from blockchain
  const capabilitiesStrings = await getKpayAcquireCapabilities(
    buyerAccount,
    integerAmount,
    isNative
  );
  
  if (!capabilitiesStrings || capabilitiesStrings.length === 0) {
    throw new Error("Failed to retrieve capabilities for KPAY purchase");
  }
  
  // 3. Parse capabilities
  const parsedCapabilities: Array<{ name: string; args: any[] }> = [];
  for (const capString of capabilitiesStrings) {
    const parsed = parseCapabilityString(capString);
    if (parsed) {
      parsedCapabilities.push(parsed);
    }
  }
  
  if (parsedCapabilities.length === 0) {
    throw new Error("Failed to parse any capabilities for KPAY purchase");
  }
  
  let gasLimit = 2_000_000; // Default gas limit for KPAY buy
  
  // 4. Build transaction
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS02-DPAD.KPAY|C_BuyKpay "${patronAccount.address}" "${buyerAccount}" ${integerAmount} ${isNative})`)
      .addData(keysetName, {
        keys: guardKeyset.keys,
        pred: guardKeyset.pred,
      })
      .setMeta({
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(), // Gas station
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride || gasLimit,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(kadenaAccount.publicKey, (withCapability: any) => {
        const capabilities: any[] = [];
        
        // Always add GAS_PAYER first
        capabilities.push(
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" }
          )
        );
        
        // Add all parsed capabilities from URC_Acquire
        for (const cap of parsedCapabilities) {
          try {
            const addedCap = withCapability(cap.name, ...cap.args);
            capabilities.push(addedCap);
          } catch (error) {
            console.error(`Failed to add capability: ${cap.name}`, error);
          }
        }
        
        return capabilities;
      })
      .addSigner(guardAccount.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  // 5. Build and simulate UNSIGNED to check gas
  let transaction = buildTransaction();
  
  const simulation = await dirtyRead(transaction);
  
  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`KPAY purchase simulation failed: ${errorMessage}`);
  }

  // 6. Adjust gas limit if needed
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    gasLimit = calculateAutoGasLimit(requiredGas); // 20% buffer
    transaction = buildTransaction(gasLimit);
  }

  // 7. Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guardAccount),
  ]);

  // 8. Submit the signed transaction
  const result = await submit(signedTransaction);
  
  return result;
}

