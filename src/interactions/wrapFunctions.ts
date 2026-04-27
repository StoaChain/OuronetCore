/**
 * wrapFunctions.ts
 * On-chain interactions for C_WrapStoa (ouronet-ns.TS01-C2.LQD)
 */

import { Pact, createClient } from "@kadena/client";
import { calculateAutoGasLimit } from "../gas";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE,
  KADENA_NETWORK,
  getPactUrl,
  STOA_AUTONOMIC_OURONETGASSTATION,
  STOA_AUTONOMIC_LIQUIDPOT,
} from "../constants";
import { formatDecimalForPact } from "../pact";
import { universalSignTransaction, fromKeypair } from "../signing";
import { IKadenaKeypair } from "./ouroFunctions";
import { createSimulationError, logDetailedError } from "../errors";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


// ─── INFO ─────────────────────────────────────────────────────────────────────
/**
 * (ouronet-ns.INFO-ONE.LIQUID|INFO_WrapStoa <patron:string> <wrapper:string> <amount:decimal>)
 * Returns cost info: ignis, kadena, pre-text, post-text, etc.
 */
export async function getWrapStoaInfo(
  patron: string,
  wrapper: string,
  amount: string,
): Promise<any | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.LIQUID|INFO_WrapStoa "${patron}" "${wrapper}" ${decimalAmount})`;
    const transaction = Pact.builder
      .execution(pactCode)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 100_000 })
      .createTransaction();
    const { dirtyRead } = createClient(getPactUrl(KADENA_CHAIN_ID));
    const response = await dirtyRead(transaction);
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting WrapStoa info:", error);
    return null;
  }
}

// ─── Resolve wrapper's payment key address ────────────────────────────────────
/**
 * (ouronet-ns.DALOS.UR_AccountKadena <wrapper>) → k: address (payment key)
 */
export async function getWrapperPaymentKey(wrapper: string): Promise<string | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DALOS.UR_AccountKadena "${wrapper}")`;
    const transaction = Pact.builder
      .execution(pactCode)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 50_000 })
      .createTransaction();
    const { dirtyRead } = createClient(getPactUrl(KADENA_CHAIN_ID));
    const response = await dirtyRead(transaction);
    if (response?.result?.status === "success") {
      return String((response.result as any).data);
    }
    return null;
  } catch (error) {
    console.error("Error resolving wrapper payment key:", error);
    return null;
  }
}

// ─── Get STOA balance of payment key ─────────────────────────────────────────
/**
 * (coin.get-balance <paymentKeyAddress>) → decimal balance
 */
export async function getPaymentKeyBalance(paymentKeyAddress: string): Promise<number | null> {
  try {
    const pactCode = `(try 0.0 (coin.get-balance "${paymentKeyAddress}"))`;
    const transaction = Pact.builder
      .execution(pactCode)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 50_000 })
      .createTransaction();
    const { dirtyRead } = createClient(getPactUrl(KADENA_CHAIN_ID));
    const response = await dirtyRead(transaction);
    if (response?.result?.status === "success") {
      const data = (response.result as any).data;
      if (typeof data === "number") return data;
      if (data?.decimal !== undefined) return parseFloat(data.decimal);
      return parseFloat(String(data));
    }
    return null;
  } catch (error) {
    console.error("Error fetching payment key balance:", error);
    return null;
  }
}

// ─── Execute ──────────────────────────────────────────────────────────────────

export interface WrapStoaParams {
  patronAddress:    string;
  wrapperAddress:   string;
  amount:           string;          // pre-formatted decimal string
  numAmount:        number;          // numeric value for coin.TRANSFER capability
  paymentKeyAddress: string;         // k: address — sender for coin.TRANSFER
  gasStationKey:    IKadenaKeypair;  // CodexPrime Key #0
  paymentSignerKey: IKadenaKeypair;  // key pair for the payment key (pubkey = paymentKeyAddress.slice(2))
  patronGuardKeys:  IKadenaKeypair[];
  wrapperGuardKeys: IKadenaKeypair[];
}

export async function executeWrapStoa(params: WrapStoaParams): Promise<any> {
  const {
    patronAddress, wrapperAddress, amount, numAmount,
    paymentKeyAddress, gasStationKey, paymentSignerKey,
    patronGuardKeys, wrapperGuardKeys,
  } = params;

  const buildTransaction = (gasLimitOverride?: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.LQD|C_WrapStoa "${patronAddress}" "${wrapperAddress}" ${amount})`
      )
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride ?? 2_000_000,
      })
      .setNetworkId(KADENA_NETWORK)
      // GAS_PAYER — CodexPrime Key #0
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);

    // coin.TRANSFER — payment key signer
    // If same key as gas station, add TRANSFER cap to existing signer,
    // otherwise add new signer with TRANSFER cap
    if (paymentSignerKey.publicKey === gasStationKey.publicKey) {
      // Edge case: payment key IS CodexPrime Key #0 — rebuild with both caps on same key
      builder = Pact.builder
        .execution(
          `(${KADENA_NAMESPACE}.TS01-C2.LQD|C_WrapStoa "${patronAddress}" "${wrapperAddress}" ${amount})`
        )
        .setMeta({
          senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride ?? 2_000_000,
        })
        .setNetworkId(KADENA_NETWORK)
        .addSigner(gasStationKey.publicKey, (w: any) => [
          w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
          w("coin.TRANSFER", paymentKeyAddress, STOA_AUTONOMIC_LIQUIDPOT, { decimal: String(numAmount) }),
        ]);
    } else {
      builder = (builder as any).addSigner(
        paymentSignerKey.publicKey,
        (w: any) => [
          w("coin.TRANSFER", paymentKeyAddress, STOA_AUTONOMIC_LIQUIDPOT, { decimal: String(numAmount) }),
        ],
      );
    }

    // Pure guard signers (patron + wrapper) — no capabilities
    const addedPubs = new Set<string>([gasStationKey.publicKey, paymentSignerKey.publicKey]);
    for (const k of [...patronGuardKeys, ...wrapperGuardKeys]) {
      if (!addedPubs.has(k.publicKey)) {
        builder = (builder as any).addSigner(k.publicKey);
        addedPubs.add(k.publicKey);
      }
    }

    return builder.createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // 1. Simulate with 2M (network max)
  const simTx = buildTransaction();
  const simulation = await dirtyRead(simTx);

  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Wrap STOA",
      simulation.result,
      `Patron: ${patronAddress} | Wrapper: ${wrapperAddress} | Amount: ${amount} | PaymentKey: ${paymentKeyAddress}`,
    );
    logDetailedError(error);
    throw error;
  }

  // 2. Adaptive gas
  const gasLimit = simulation.gas ? calculateAutoGasLimit(simulation.gas) : 2_000_000;
  const finalTx = buildTransaction(gasLimit);

  // 3. Collect all unique signers
  const allSigners: IKadenaKeypair[] = [gasStationKey];
  const seenPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [paymentSignerKey, ...patronGuardKeys, ...wrapperGuardKeys]) {
    if (!seenPubs.has(k.publicKey)) { allSigners.push(k); seenPubs.add(k.publicKey); }
  }

  // 4. Sign & submit
  const signed: any = await universalSignTransaction(
    finalTx,
    allSigners.map((s) => fromKeypair(s)),
  );

  return await submit(signed);
}

// ─── INFO UrStoa ──────────────────────────────────────────────────────────────
/**
 * (ouronet-ns.INFO-ONE.LIQUID|INFO_WrapUrStoa <patron:string> <wrapper:string> <amount:decimal>)
 * Returns cost info: ignis, kadena, pre-text, post-text, etc.
 */
export async function getWrapUrStoaInfo(
  patron: string,
  wrapper: string,
  amount: string,
): Promise<any | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.LIQUID|INFO_WrapUrStoa "${patron}" "${wrapper}" ${decimalAmount})`;
    const transaction = Pact.builder
      .execution(pactCode)
      .setNetworkId(KADENA_NETWORK)
      .setMeta({ chainId: KADENA_CHAIN_ID, gasLimit: 100_000 })
      .createTransaction();
    const { dirtyRead } = createClient(getPactUrl(KADENA_CHAIN_ID));
    const response = await dirtyRead(transaction);
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting WrapUrStoa info:", error);
    return null;
  }
}

// ─── Execute WrapUrStoa ───────────────────────────────────────────────────────

export interface WrapUrStoaParams {
  patronAddress:      string;
  wrapperAddress:     string;
  amount:             string;           // pre-formatted decimal string
  numAmount:          number;           // numeric value for coin.UR|TRANSFER cap
  paymentKeyAddress:  string;           // Kadena k: address of payment key
  gasStationKey:      IKadenaKeypair;   // Payment key — signs GAS_PAYER + coin.UR|TRANSFER
  patronGuardKeys:    IKadenaKeypair[];
  wrapperGuardKeys:   IKadenaKeypair[];
}

export async function executeWrapUrStoa(params: WrapUrStoaParams): Promise<any> {
  const {
    patronAddress, wrapperAddress, amount, numAmount, paymentKeyAddress,
    gasStationKey, patronGuardKeys, wrapperGuardKeys,
  } = params;

  const buildTransaction = (gasLimitOverride?: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.LQD|C_WrapUrStoa "${patronAddress}" "${wrapperAddress}" ${amount})`
      )
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride ?? 2_000_000,
      })
      .setNetworkId(KADENA_NETWORK)
      // Payment key signs: GAS_PAYER + coin.UR|TRANSFER
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w("coin.UR|TRANSFER", paymentKeyAddress, STOA_AUTONOMIC_LIQUIDPOT, { decimal: String(numAmount) }),
      ]);

    // Pure guard signers (patron + wrapper) — no capabilities
    const addedPubs = new Set<string>([gasStationKey.publicKey]);
    for (const k of [...patronGuardKeys, ...wrapperGuardKeys]) {
      if (!addedPubs.has(k.publicKey)) {
        builder = (builder as any).addSigner(k.publicKey);
        addedPubs.add(k.publicKey);
      }
    }

    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // 1. Simulate with 2M (network max)
  const simTx = buildTransaction();
  const simulation = await dirtyRead(simTx);

  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Wrap UrStoa",
      simulation.result,
      `Patron: ${patronAddress} | Wrapper: ${wrapperAddress} | Amount: ${amount}`,
    );
    logDetailedError(error);
    throw error;
  }

  // 2. Adaptive gas
  const gasLimit = simulation.gas ? calculateAutoGasLimit(simulation.gas) : 2_000_000;
  const finalTx = buildTransaction(gasLimit);

  // 3. Collect all unique signers
  const allSigners: IKadenaKeypair[] = [gasStationKey];
  const seenPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [...patronGuardKeys, ...wrapperGuardKeys]) {
    if (!seenPubs.has(k.publicKey)) { allSigners.push(k); seenPubs.add(k.publicKey); }
  }

  // 4. Sign & submit
  const signed: any = await universalSignTransaction(
    finalTx,
    allSigners.map((s) => fromKeypair(s)),
  );

  return await submit(signed);
}

