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
  PACT_URL,
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
    const { dirtyRead } = createClient(PACT_URL);
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
    const { dirtyRead } = createClient(PACT_URL);
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
    const { dirtyRead } = createClient(PACT_URL);
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

  const { dirtyRead, submit } = createClient(PACT_URL);

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
    const { dirtyRead } = createClient(PACT_URL);
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

  const { dirtyRead, submit } = createClient(PACT_URL);

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

// ─── Execute Firestarter ──────────────────────────────────────────────────────
/**
 * (ouronet-ns.TS01-C3.SWP|C_Firestarter <firestarter:string>)
 * Wraps 10 native STOA → wSTOA. Payment key signs coin.TRANSFER to LIQUIDPOT.
 */
export async function executeFirestarter(params: {
  firestarter: string;
  paymentKeyAddress: string;
  gasStationKey: IKadenaKeypair;
  paymentSignerKey: IKadenaKeypair;
  firestaterGuardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { firestarter, paymentKeyAddress, gasStationKey, paymentSignerKey, firestaterGuardKeys } = params;
  const STOA_AMOUNT = 10.0;

  const w = (cap: string, ...args: any[]) => ({ name: cap, args });

  const buildTx = (gasLimit: number) =>
    Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C3.SWP|C_Firestarter "${firestarter}")`)
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (withCapability: any) => [
        withCapability(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ])
      .addSigner(paymentSignerKey.publicKey, (withCapability: any) => [
        withCapability("coin.TRANSFER", paymentKeyAddress, STOA_AUTONOMIC_LIQUIDPOT, { decimal: String(STOA_AMOUNT) }),
      ])
      .addSigner(firestaterGuardKeys.map((k) => k.publicKey) as any)
      .createTransaction();

  const { dirtyRead, submit } = createClient(PACT_URL);

  // Simulate first
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error((simResult.result as any)?.error?.message || "Firestater simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);

  const tx = buildTx(gasLimit);
  const allSigners = [gasStationKey, paymentSignerKey, ...firestaterGuardKeys];
  const signed: any = await universalSignTransaction(
    tx,
    allSigners.map((s) => fromKeypair(s)),
  );
  return await submit(signed);
}

// ── executeSublimate ─────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ORBR|C_Sublimate <client:string> <target:string> <ouro-amount:decimal>)
// Patronless — gasless. gasStationKey signs GAS_PAYER; guardKeys sign pure.

export async function executeSublimate(params: {
  clientAddress: string;
  targetAddress: string;
  amount: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { clientAddress, targetAddress, amount, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ORBR|C_Sublimate "${clientAddress}" "${targetAddress}" ${decimalAmount})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Sublimate simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);

  const tx = buildTx(gasLimit);
  // Deduplicate: gasStationKey might overlap with guardKeys
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeCompress ──────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ORBR|C_Compress <client:string> <ignis-amount:decimal>)
// Patronless — gasless. gasStationKey signs GAS_PAYER; guardKeys sign pure.

export async function executeCompress(params: {
  clientAddress: string;
  amount: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { clientAddress, amount, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ORBR|C_Compress "${clientAddress}" ${decimalAmount})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Compress simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);

  const tx = buildTx(gasLimit);
  // Deduplicate signers
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeTransferToken ──────────────────────────────────────────────────────
// (ouronet-ns.TS01-C1.DPTF|C_Transfer <patron:string> <id:string> <sender:string> <receiver:string> <amount:decimal> <method:bool>)
// patron signs GAS_PAYER; guardKeys (resident guard) sign pure.

export async function executeTransferToken(params: {
  patronAddress: string;
  tokenId: string;
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  method: boolean;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, tokenId, senderAddress, receiverAddress, amount, method, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C1.DPTF|C_Transfer "${patronAddress}" "${tokenId}" "${senderAddress}" "${receiverAddress}" ${decimalAmount} ${method})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  // Simulate
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Transfer simulation failed");
  }
  const gasLimit = calculateAutoGasLimit(simResult.gas ?? 500_000);

  // Build + sign
  const tx = buildTx(gasLimit);
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeCoil ──────────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_Coil <patron:string> <coiler:string> <ats:string> <rt:string> <amount:decimal>)
// patron signs GAS_PAYER; guardKeys (resident/coiler guard) sign pure.

export async function executeCoil(params: {
  patronAddress: string;
  coilerAddress: string;
  atsId: string;
  rewardTokenId: string;
  amount: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, coilerAddress, atsId, rewardTokenId, amount, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Coil "${patronAddress}" "${coilerAddress}" "${atsId}" "${rewardTokenId}" ${decimalAmount})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  // Simulate
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Coil simulation failed");
  }
  const gasLimit = calculateAutoGasLimit(simResult.gas ?? 500_000);

  // Build + sign
  const tx = buildTx(gasLimit);
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeCurl ──────────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_Curl <patron:string> <curler:string> <ats1:string> <ats2:string> <rt:string> <amount:decimal>)

export async function executeCurl(params: {
  patronAddress: string;
  curlerAddress: string;
  ats1Id: string;
  ats2Id: string;
  rewardTokenId: string;
  amount: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, curlerAddress, ats1Id, ats2Id, rewardTokenId, amount, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Curl "${patronAddress}" "${curlerAddress}" "${ats1Id}" "${ats2Id}" "${rewardTokenId}" ${decimalAmount})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Curl simulation failed");
  }
  const gasLimit = calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeBrumate ───────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_Brumate <patron:string> <brumator:string> <ats1:string> <ats2:string> <rt:string> <amount:decimal> <dayz:integer>)

export async function executeBrumate(params: {
  patronAddress: string;
  brumatorAddress: string;
  ats1Id: string;
  ats2Id: string;
  rewardTokenId: string;
  amount: string;
  lockDays: number;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, brumatorAddress, ats1Id, ats2Id, rewardTokenId, amount, lockDays, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Brumate "${patronAddress}" "${brumatorAddress}" "${ats1Id}" "${ats2Id}" "${rewardTokenId}" ${decimalAmount} ${lockDays})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Brumate simulation failed");
  }
  const gasLimit = calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeConstrict ─────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_Constrict <patron:string> <constricter:string> <ats:string> <rt:string> <amount:decimal> <dayz:integer>)

export async function executeConstrict(params: {
  patronAddress: string;
  constricterAddress: string;
  atsId: string;
  rewardTokenId: string;
  amount: string;
  lockDays: number;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, constricterAddress, atsId, rewardTokenId, amount, lockDays, gasStationKey, guardKeys } = params;
  const decimalAmount = formatDecimalForPact(amount);

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Constrict "${patronAddress}" "${constricterAddress}" "${atsId}" "${rewardTokenId}" ${decimalAmount} ${lockDays})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Constrict simulation failed");
  }
  const gasLimit = calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);
  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeColdRecovery ──────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_ColdRecovery <patron:string> <recoverer:string> <ats:string> <ra:decimal>)

export async function executeColdRecovery(params: {
  patronAddress: string;
  recovererAddress: string;
  atsId: string;
  ra: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, recovererAddress, atsId, ra, gasStationKey, guardKeys } = params;
  const decimalRa = ra.includes(".") ? ra : ra + ".0";

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_ColdRecovery "${patronAddress}" "${recovererAddress}" "${atsId}" ${decimalRa})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "ColdRecovery simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);

  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeDirectRecovery ─────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_DirectRecovery <patron:string> <recoverer:string> <ats:string> <ra:decimal>)

export async function executeDirectRecovery(params: {
  patronAddress: string;
  recovererAddress: string;
  atsId: string;
  ra: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, recovererAddress, atsId, ra, gasStationKey, guardKeys } = params;
  const decimalRa = ra.includes(".") ? ra : ra + ".0";

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_DirectRecovery "${patronAddress}" "${recovererAddress}" "${atsId}" ${decimalRa})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "DirectRecovery simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);

  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeCull ───────────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.ATS|C_Cull <patron:string> <culler:string> <ats:string>)

export async function executeCull(params: {
  patronAddress: string;
  cullerAddress: string;
  atsId: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, cullerAddress, atsId, gasStationKey, guardKeys } = params;

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Cull "${patronAddress}" "${cullerAddress}" "${atsId}")`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Cull simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);

  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── buildNativeTransferTx ─────────────────────────────────────────────────────
// Builds a native STOA transfer tx (simulate + build with auto gas).
// ONE signer: senderPubKey carries both DALOS.GAS_PAYER + coin.TRANSFER caps.
// Returns the unsigned tx ready for signing.

export async function buildNativeTransferTx(params: {
  senderAddress: string;
  receiverAddress: string;
  amount: number;
  isNew: boolean;
  senderPubKey: string;
}): Promise<import("@kadena/types").IUnsignedCommand> {
  const { senderAddress, receiverAddress, amount, isNew, senderPubKey } = params;
  const decimalStr = formatDecimalForPact(String(amount));

  const buildTx = (gasLimit: number) => {
    if (isNew) {
      const ks = { keys: [receiverAddress.slice(2)], pred: "keys-all" };
      return Pact.builder
        .execution(`(coin.C_TransferAnew "${senderAddress}" "${receiverAddress}" (read-keyset "ks") ${decimalStr})`)
        .addData("ks", ks)
        .addSigner(senderPubKey, (w: any) => [
          w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
          w("coin.TRANSFER", senderAddress, receiverAddress, amount),
        ])
        .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
        .setNetworkId(KADENA_NETWORK)
        .createTransaction();
    }
    return Pact.builder
      .execution(`(coin.C_Transfer "${senderAddress}" "${receiverAddress}" ${decimalStr})`)
      .addSigner(senderPubKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w("coin.TRANSFER", senderAddress, receiverAddress, amount),
      ])
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .createTransaction();
  };

  const { dirtyRead } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if ((simResult.result as any)?.status === "failure") {
    throw new Error((simResult.result as any)?.error?.message || "Native transfer simulation failed");
  }
  const gasLimit = calculateAutoGasLimit(simResult.gas ?? 500_000);
  return buildTx(gasLimit) as import("@kadena/types").IUnsignedCommand;
}

// ── executeAwake ──────────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.VST|C_Awake <patron:string> <awaker:string> <dpof:string> <nonce:integer>)
// gasStationKey signs GAS_PAYER; guardKeys (patron + resident) sign pure.

export async function executeAwake(params: {
  patron: string;
  awaker: string;
  dpof: string;
  nonce: number;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patron, awaker, dpof, nonce, gasStationKey, guardKeys } = params;

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.VST|C_Awake "${patron}" "${awaker}" "${dpof}" ${nonce})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Awake simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);

  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeSlumber ─────────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C2.VST|C_Slumber <patron:string> <merger:string> <dpof:string> <nonces:[integer]>)
// gasStationKey signs GAS_PAYER; guardKeys (patron + resident) sign pure.

export async function executeSlumber(params: {
  patron: string;
  merger: string;
  dpof: string;
  nonces: number[];
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patron, merger, dpof, nonces, gasStationKey, guardKeys } = params;
  const nonceList = `[${nonces.join(" ")}]`;

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C2.VST|C_Slumber "${patron}" "${merger}" "${dpof}" ${nonceList})`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "Slumber simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);

  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}

// ── executeClearDispo ─────────────────────────────────────────────────────────
// (ouronet-ns.TS01-C1.DPTF|C_ClearDispo <patron:string> <account:string>)
// patron signs GAS_PAYER; guardKeys (resident guard) sign pure.

export async function executeClearDispo(params: {
  patronAddress: string;
  accountAddress: string;
  gasStationKey: IKadenaKeypair;
  guardKeys: IKadenaKeypair[];
}): Promise<any> {
  const { patronAddress, accountAddress, gasStationKey, guardKeys } = params;

  const buildTx = (gasLimit: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C1.DPTF|C_ClearDispo "${patronAddress}" "${accountAddress}")`
      )
      .setMeta({ senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(), chainId: KADENA_CHAIN_ID, gasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);
    for (const gk of guardKeys) builder = (builder as any).addSigner(gk.publicKey);
    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);
  const sim = buildTx(500_000);
  const simResult = await dirtyRead(sim);
  if (simResult.result?.status === "failure") {
    throw new Error(simResult.result?.error?.message || "ClearDispo simulation failed");
  }
  const gasLimit = await calculateAutoGasLimit(simResult.gas ?? 500_000);
  const tx = buildTx(gasLimit);

  const seenPub = new Set<string>();
  const allSigners: IKadenaKeypair[] = [];
  for (const kp of [gasStationKey, ...guardKeys]) {
    if (seenPub.has(kp.publicKey)) continue;
    seenPub.add(kp.publicKey);
    allSigners.push(kp);
  }
  const signed: any = await universalSignTransaction(tx, allSigners.map((s) => fromKeypair(s)));
  return await submit(signed);
}
