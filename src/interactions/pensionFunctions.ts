import { calculateAutoGasLimit } from "../gas";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE, GAS_STATION, NATIVE_TOKEN_VAULT,
  KADENA_NETWORK,
  PACT_URL,
} from "../constants";
import { formatDecimalForPact } from "../pact";
import { Pact, createClient } from "@kadena/client";
import { pactRead } from "../reads";
import { universalSignTransaction, fromKeypair } from "../signing";
import type { IOuroAccountKeypair, IKadenaKeypair } from "./ouroFunctions";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


// Brumate WSTOA to H|GSTOA (Hibernated Pension Kadena)
// (namespace.TS01-C2.ATS|C_Brumate patron:string brumate-account:string "SilverStoaPillar-O136CBn22ncY" "GoldenStoaPillar-O136CBn22ncY" "WSTOA-8Nh-JO8JO4F5" amount:decimal lock-days:integer)
export async function brumateWkdaToPkda(
  ouroAccount: IOuroAccountKeypair,
  kadenaAccount: IKadenaKeypair,
  guard: IKadenaKeypair,
  wkdaAmount: string,
  lockDays: number
) {
  const keysetName = `ks`;
  const decimalAmount = formatDecimalForPact(wkdaAmount);
  let gasLimit = 2_000_000;

  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Brumate "${ouroAccount.address}" "${ouroAccount.address}" "SilverStoaPillar-O136CBn22ncY" "GoldenStoaPillar-O136CBn22ncY" "WSTOA-8Nh-JO8JO4F5" ${decimalAmount} ${lockDays})`)
      .addData(keysetName, {
        keys: [guard.publicKey],
        pred: "keys-all",
      })
      .setMeta({
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride || gasLimit,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(kadenaAccount.publicKey, (withCapability: any) => [
        withCapability(
          `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
          "",
          { int: 0 },
          { decimal: "0.0" },
        ),
      ])
      .addSigner(guard.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);

  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guard),
  ]);
  const result = await submit(signedTransaction);

  return result;
}

// Constrict SSTOA to H|GSTOA (Hibernated Pension Kadena)
// (namespace.TS01-C2.ATS|C_Constrict patron:string constrictor:string "GoldenStoaPillar-O136CBn22ncY" "SSTOA-8Nh-JO8JO4F5" amount:decimal lock-days:integer)
export async function constrictLkdaToPkda(
  ouroAccount: IOuroAccountKeypair,
  kadenaAccount: IKadenaKeypair,
  guard: IKadenaKeypair,
  lkdaAmount: string,
  lockDays: number
) {
  const keysetName = `ks`;
  const decimalAmount = formatDecimalForPact(lkdaAmount);
  let gasLimit = 2_000_000;

  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Constrict "${ouroAccount.address}" "${ouroAccount.address}" "GoldenStoaPillar-O136CBn22ncY" "SSTOA-8Nh-JO8JO4F5" ${decimalAmount} ${lockDays})`)
      .addData(keysetName, {
        keys: [guard.publicKey],
        pred: "keys-all",
      })
      .setMeta({
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride || gasLimit,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(kadenaAccount.publicKey, (withCapability: any) => [
        withCapability(
          `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
          "",
          { int: 0 },
          { decimal: "0.0" },
        ),
      ])
      .addSigner(guard.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);

  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guard),
  ]);
  const result = await submit(signedTransaction);

  return result;
}

/**
 * Get Hibernate/Pension entry fee for a specific lock period
 * Formula: 12% - 0.0008% per day locked (0% at 15000 days)
 * @param korIndexId - KORIndex pool ID (e.g., "GoldenStoaPillar-O136CBn22ncY")
 * @param lockDays - Number of days to lock
 * @returns Fee as decimal (e.g., 0.12 for 12%)
 */
export async function getHibernateFee(
  korIndexId: string,
  lockDays: number
): Promise<number> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.DPL-UR.URC_0012_HibernateFee "${korIndexId}" ${lockDays})`, { tier: "T2" });

    if (!response || !response.result) {
      throw new Error("Failed to retrieve hibernate fee");
    }

    if (response.result.status === "failure") {
      throw new Error(`Hibernate fee query failed: ${response.result.error?.message || "Unknown error"}`);
    }

    const data = response.result.data;
    
    // API returns decimal value, convert to number
    if (typeof data === 'object' && data !== null && 'decimal' in data) {
      return parseFloat(String((data as any).decimal));
    }
    
    return typeof data === 'number' ? data : parseFloat(String(data));
    
  } catch (error) {
    // Silent fallback - function may not be deployed yet on blockchain
    // Using local calculation: 12% - 0.0008% per day (0% at 15000 days)
    const fee = 0.12 - (0.000008 * lockDays);
    return Math.max(0, fee); // Never negative
  }
}
