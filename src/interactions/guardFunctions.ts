import { calculateAutoGasLimit } from "../gas";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE,
  GAS_STATION,
  KADENA_NETWORK,
  getPactUrl,
} from "../constants";
import { Pact, createClient } from "@kadena/client";
import { pactRead } from "../reads";
import { universalSignTransaction, fromKeypair } from "../signing";
import { createSimulationError, logDetailedError } from "../errors";
import { IKadenaKeypair } from "./ouroFunctions";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


export interface IDescribedKeyset {
  keys: string[];
  pred: string;
}

export interface RotateGuardParams {
  patronAddress: string;
  accountAddress: string;
  mode: "define" | "existing";
  newKeys?: string[];
  newPred?: string;
  keysetRef?: string;
  safe: boolean;
  gasStationKey: IKadenaKeypair;
  patronGuardKeys: IKadenaKeypair[];
  accountGuardKeys: IKadenaKeypair[];
  newGuardKeys: IKadenaKeypair[];
}

/**
 * Query RotateGuard info object from the chain.
 * (ouronet-ns.DALOS-INFO.DALOS-INFO|URC_RotateGuard <patron> <account>)
 */
export async function getRotateGuardInfo(
  patron: string,
  account: string
): Promise<any | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ZERO.DALOS-INFO|URC_RotateGuard "${patron}" "${account}")`;
    const response = await pactRead(pactCode, { tier: "T7" });

    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting RotateGuard info:", error);
    return null;
  }
}

/**
 * Describe a keyset on-chain.
 * (describe-keyset "keysetName")
 */
export async function describeKeyset(
  keysetName: string
): Promise<IDescribedKeyset> {
  const pactCode = `(describe-keyset "${keysetName}")`;
  const response = await pactRead(pactCode, { tier: "T7" });

  if (response?.result?.status === "success") {
    const data = (response.result as any).data;
    return { keys: data.keys, pred: data.pred };
  }
  throw new Error(
    (response?.result as any)?.error?.message || "Failed to describe keyset"
  );
}

/**
 * Rotate Guard for an Ouronet account.
 * (ouronet-ns.TS01-C1.DALOS|C_RotateGuard patron account GUARD_EXPR SAFE)
 */
export async function rotateGuard(params: RotateGuardParams) {
  const {
    patronAddress,
    accountAddress,
    mode,
    newKeys,
    newPred,
    keysetRef,
    safe,
    gasStationKey,
    patronGuardKeys,
    accountGuardKeys,
    newGuardKeys,
  } = params;

  let gasLimit = 2_000_000;

  const guardExpr =
    mode === "define"
      ? `(read-keyset "ks")`
      : `(keyset-ref-guard "${keysetRef}")`;

  // Collect all unique signers: gasStation + patronGuard + accountGuard + newGuard
  const allSigners: IKadenaKeypair[] = [gasStationKey];
  const addedPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [...patronGuardKeys, ...accountGuardKeys, ...newGuardKeys]) {
    if (!addedPubs.has(k.publicKey)) {
      allSigners.push(k);
      addedPubs.add(k.publicKey);
    }
  }

  const buildTransaction = (gasLimitOverride?: number) => {
    let builder = Pact.builder.execution(
      `(${KADENA_NAMESPACE}.TS01-C1.DALOS|C_RotateGuard "${patronAddress}" "${accountAddress}" ${guardExpr} ${safe})`
    );

    // Add keyset data for "define" mode
    if (mode === "define" && newKeys && newPred) {
      builder = builder.addData("ks", {
        keys: newKeys,
        pred: newPred,
      });
    }

    builder = builder
      .setMeta({
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride || gasLimit,
      })
      .setNetworkId(KADENA_NETWORK)
      // Gas Station key: GAS_PAYER capability
      .addSigner(gasStationKey.publicKey, (withCapability: any) => [
        withCapability(
          `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
          "",
          { int: 0 },
          { decimal: "0.0" }
        ),
      ]);

    // All other keys: pure signers
    const addedSignerPubs = new Set<string>([gasStationKey.publicKey]);
    for (const k of [
      ...patronGuardKeys,
      ...accountGuardKeys,
      ...newGuardKeys,
    ]) {
      if (!addedSignerPubs.has(k.publicKey)) {
        builder = builder.addSigner(k.publicKey);
        addedSignerPubs.add(k.publicKey);
      }
    }

    return builder.createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);

  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Rotate Guard",
      simulation.result,
      `Patron: ${patronAddress} | Account: ${accountAddress} | Mode: ${mode} | Safe: ${safe}`
    );
    logDetailedError(error);
    throw error;
  }

  const requiredGas = simulation.gas;
  if (requiredGas) {
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  const signedTransaction: any = await universalSignTransaction(
    transaction,
    allSigners.map((s) => fromKeypair(s))
  );

  return await submit(signedTransaction);
}
