import { Pact, createClient, ITransactionDescriptor } from "@kadena/client";
import { KADENA_NETWORK, getPactUrl, getSpvUrl, GAS_STATION, KADENA_NAMESPACE } from "../constants";
import { GAS_PRICE_MIN_ANU, anuToStoa } from "../gas";
import { pactRead } from "../reads";
import { ChainId } from "@kadena/types";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


/**
 * Get KDA balance for an account on a specific chain.
 * exists=false means the account row does not exist on that chain (not just zero balance).
 */
export async function getBalanceOnChain(
  account: string,
  chainId: string,
  tier: "T1" | "T2" | "T3" = "T1"
): Promise<{ balance: string; exists: boolean; error?: string }> {
  try {
    const pactCode = `(coin.get-balance "${account}")`;
    const response = await pactRead(pactCode, {
      pactUrl: getPactUrl(chainId),
      chainId,
      tier,
    });

    if (!response?.result || (response.result as any).status === "failure") {
      return { balance: "0", exists: false };
    }

    const data = (response.result as any).data;
    let balance = "0";
    if (data) {
      if (typeof data === "string") {
        balance = data;
      } else if (typeof data === "number") {
        balance = data.toString();
      } else if (typeof data === "object" && data.decimal) {
        balance = data.decimal;
      } else if (typeof data === "object" && data.int) {
        balance = data.int;
      }
    }
    return { balance, exists: true };
  } catch (error) {
    return {
      balance: "0",
      exists: false,
      error: error instanceof Error ? error.message : "Failed to fetch balance",
    };
  }
}

export interface CrossChainTransferParams {
  sender: string;
  receiver: string;
  receiverGuard: {
    keys: string[];
    pred: "keys-all" | "keys-any" | "keys-2";
  };
  amount: string;
  sourceChain: string;
  targetChain: string;
  senderPublicKey: string;
}

export interface TransferStatus {
  status: "pending" | "success" | "failure" | "not-found";
  continuation?: {
    pactId: string;
    step: number;
    stepHasRollback: boolean;
  };
  result?: any;
  error?: string;
}

/**
 * Build a cross-chain transfer transaction (step 1)
 * This creates a transaction that needs to be signed and submitted
 */
export function buildCrossChainTransfer(params: CrossChainTransferParams) {
  const {
    sender,
    receiver,
    receiverGuard,
    amount,
    sourceChain,
    targetChain,
    senderPublicKey,
  } = params;

  const formattedAmount = parseFloat(amount).toFixed(12);
  const receiverKeysetName = `receiver-guard-${Date.now()}`;

  const transaction = Pact.builder
    .execution(
      `(coin.transfer-crosschain "${sender}" "${receiver}" (read-keyset "${receiverKeysetName}") "${targetChain}" ${formattedAmount})`
    )
    .addData(receiverKeysetName, receiverGuard)
    .addSigner(senderPublicKey, (withCapability) => [
      withCapability("coin.TRANSFER_XCHAIN", sender, receiver, {
        decimal: formattedAmount,
      }, targetChain),
      withCapability("coin.GAS"),
    ])
    .setMeta({
      chainId: sourceChain as ChainId,
      senderAccount: sender,
      gasLimit: 2500,
      gasPrice: 0.00000001,
      ttl: 28800,
    })
    .setNetworkId(KADENA_NETWORK)
    .createTransaction();

  return transaction;
}

// ── buildCTransferAcross ──────────────────────────────────────────────────

export interface CTransferAcrossParams {
  sender: string;
  receiver: string;
  receiverGuard: { keys: string[]; pred: string };
  amount: string; // already formatted (e.g. "1.000000000000")
  sourceChain: string;
  targetChain: string;
  senderPublicKey: string;
  /** Required for chain 0 — Ouronet Gas Station pub key */
  gasStationPublicKey?: string;
}

/**
 * Build a coin.C_TransferAcross transaction (step 0 of cross-chain transfer).
 *
 * Chain 0: Gas paid by Ouronet Gas Station (DALOS.GAS_PAYER).
 * Other chains: Gas paid by kadena-xchain-gas (unsigned).
 */
export function buildCTransferAcross(params: CTransferAcrossParams) {
  const {
    sender,
    receiver,
    receiverGuard,
    amount,
    sourceChain,
    targetChain,
    senderPublicKey,
    gasStationPublicKey,
  } = params;

  const keysetName = `receiver-guard-${Date.now()}`;
  const pactCode = `(coin.C_TransferAcross "${sender}" "${receiver}" (read-keyset "${keysetName}") "${targetChain}" ${amount})`;

  if (sourceChain === "0") {
    // Chain 0: Gas Station pays via DALOS.GAS_PAYER
    if (!gasStationPublicKey) {
      throw new Error("gasStationPublicKey is required for chain 0 transfers");
    }
    return Pact.builder
      .execution(pactCode)
      .addData(keysetName, receiverGuard)
      .addSigner(gasStationPublicKey, (w) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ])
      .addSigner(senderPublicKey, (w) => [
        w("coin.TRANSFER_XCHAIN", sender, receiver, { decimal: amount }, targetChain),
      ])
      .setMeta({
        chainId: "0" as ChainId,
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
        gasLimit: 2500,
        gasPrice: anuToStoa(GAS_PRICE_MIN_ANU),
        ttl: 28800,
      })
      .setNetworkId(KADENA_NETWORK)
      .createTransaction();
  } else {
    // Non-chain-0: kadena-xchain-gas pays gas.
    // Its guard uses coin.gas-only (no signature needed) BUT requires:
    //   - gasPrice <= 0.00000001
    //   - gasLimit <= 850
    // No signer needed for gas — only sender signs TRANSFER_XCHAIN cap.
    return Pact.builder
      .execution(pactCode)
      .addData(keysetName, receiverGuard)
      .addSigner(senderPublicKey, (w) => [
        w("coin.TRANSFER_XCHAIN", sender, receiver, { decimal: amount }, targetChain),
      ])
      .setMeta({
        chainId: sourceChain as ChainId,
        senderAccount: "kadena-xchain-gas",
        gasLimit: 850,       // must be ≤ 850 for kadena-xchain-gas guard
        gasPrice: 0.00000001, // must be ≤ 0.00000001 for kadena-xchain-gas guard
        ttl: 28800,
      })
      .setNetworkId(KADENA_NETWORK)
      .createTransaction();
  }
}

/**
 * Submit a cross-chain transfer and get the request key
 */
export async function submitCrossChainTransfer(
  signedTransaction: any,
  sourceChain: string
): Promise<ITransactionDescriptor> {
  const { submit } = createClient(getPactUrl(sourceChain));
  return await submit(signedTransaction);
}

/**
 * Poll for transaction status on source chain
 */
export async function pollTransactionStatus(
  requestKey: string,
  chainId: string
): Promise<TransferStatus> {
  try {
    const { pollOne } = createClient(getPactUrl(chainId));
    const result = await pollOne({ requestKey, chainId: chainId as ChainId, networkId: KADENA_NETWORK });

    if (!result) {
      return { status: "pending" };
    }

    if (result.result.status === "failure") {
      return {
        status: "failure",
        error: result.result.error?.message || "Transaction failed",
        result,
      };
    }

    // Check if this is a defpact with continuation info
    const continuation = result.continuation ? {
      pactId: result.continuation.pactId,
      step: result.continuation.step,
      stepHasRollback: result.continuation.stepHasRollback,
    } : undefined;

    return {
      status: "success",
      continuation,
      result,
    };
  } catch (error) {
    return {
      status: "pending",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Fetch SPV proof for a cross-chain transfer
 * This requires waiting for block finality (~100-120 seconds)
 */
export async function fetchSpvProof(
  requestKey: string,
  sourceChain: string,
  targetChain: string
): Promise<{ proof: string | null; error?: string }> {
  try {
    const spvUrl = getSpvUrl(sourceChain);

    const response = await fetch(spvUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestKey,
        targetChainId: targetChain,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // If proof is not ready yet, return null without error
      if (response.status === 400 && errorText.includes("not available")) {
        return { proof: null, error: "SPV proof not ready yet. Please wait for block confirmation." };
      }
      return { proof: null, error: `Failed to fetch SPV proof: ${errorText}` };
    }

    const proof = await response.text();
    // Remove quotes if present (API returns JSON string)
    const cleanProof = proof.replace(/^"|"$/g, "");
    return { proof: cleanProof };
  } catch (error) {
    return {
      proof: null,
      error: error instanceof Error ? error.message : "Failed to fetch SPV proof",
    };
  }
}

/**
 * Poll for SPV proof with retry logic
 * Will retry until proof is available or max attempts reached
 */
export async function pollSpvProof(
  requestKey: string,
  sourceChain: string,
  targetChain: string,
  maxAttempts = 30,
  delayMs = 5000,
  onProgress?: (attempt: number, maxAttempts: number) => void
): Promise<{ proof: string | null; error?: string }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.(attempt, maxAttempts);

    const result = await fetchSpvProof(requestKey, sourceChain, targetChain);

    if (result.proof) {
      return result;
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { proof: null, error: "Timeout waiting for SPV proof" };
}

/**
 * Build a continuation transaction for step 2 of cross-chain transfer
 * This can be executed by anyone - no signature required from original sender
 */
export function buildContinuationTransaction(
  pactId: string,
  proof: string,
  targetChain: string,
  gasPayerAccount = "kadena-xchain-gas"
) {
  const transaction = Pact.builder
    .continuation({
      pactId,
      rollback: false,
      step: 1,
      proof,
    })
    .setMeta({
      chainId: targetChain as ChainId,
      senderAccount: gasPayerAccount,
      gasLimit: 850,
      gasPrice: 0.00000001,
      ttl: 28800,
    })
    .setNetworkId(KADENA_NETWORK)
    .createTransaction();

  return transaction;
}

/**
 * Submit a continuation transaction
 * Note: For public gas station, no signature needed
 * For user-paid gas, transaction must be signed first
 */
export async function submitContinuation(
  transaction: any,
  targetChain: string
): Promise<ITransactionDescriptor> {
  const { submit } = createClient(getPactUrl(targetChain));
  return await submit(transaction);
}

/**
 * Listen for transaction completion
 */
export async function listenForCompletion(
  requestKey: string,
  chainId: string
): Promise<any> {
  const { listen } = createClient(getPactUrl(chainId));
  return await listen({ requestKey, chainId: chainId as ChainId, networkId: KADENA_NETWORK });
}

/**
 * Simulate a transaction to check if it will succeed
 */
export async function simulateTransaction(
  transaction: any,
  chainId: string
): Promise<{ success: boolean; result?: any; error?: string; gas?: number }> {
  try {
    const { dirtyRead } = createClient(getPactUrl(chainId));
    const result = await dirtyRead(transaction);

    if (result.result.status === "failure") {
      return {
        success: false,
        error: result.result.error?.message || "Simulation failed",
        result,
      };
    }

    return {
      success: true,
      result,
      gas: result.gas,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Simulation failed",
    };
  }
}

/**
 * Get pending cross-chain transfers for an account
 * Checks for continuation status
 */
export async function getContinuationStatus(
  requestKey: string,
  sourceChain: string
): Promise<{
  exists: boolean;
  completed: boolean;
  pactId?: string;
  step?: number;
  error?: string;
}> {
  try {
    const status = await pollTransactionStatus(requestKey, sourceChain);

    if (status.status === "not-found") {
      return { exists: false, completed: false, error: "Transaction not found" };
    }

    if (status.status === "failure") {
      return { exists: true, completed: false, error: status.error };
    }

    if (status.continuation) {
      return {
        exists: true,
        completed: false,
        pactId: status.continuation.pactId,
        step: status.continuation.step,
      };
    }

    // If no continuation info, transaction might be complete
    return { exists: true, completed: true };
  } catch (error) {
    return {
      exists: false,
      completed: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
