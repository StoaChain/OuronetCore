/**
 * urStoaFunctions.ts — Native UrStoa on-chain interactions
 *
 * Balance:  (try 0.0 (coin.UR_UR|Balance "<account>"))
 * Guard:    (try false (coin.UR_UR|Guard "<account>"))
 * Transfer: coin.C_UR|Transfer / Transmit / TransferAnew / TransmitAnew
 */

import { Pact, createClient } from "@kadena/client";
import { calculateAutoGasLimit } from "../gas";
import { rawCalibratedDirtyRead } from "../reads";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE,
  KADENA_NETWORK,
  PACT_URL,
  STOA_AUTONOMIC_OURONETGASSTATION,
} from "../constants";
import { universalSignTransaction, fromKeypair } from "../signing";
import type { IKadenaKeypair } from "./ouroFunctions";
import { createSimulationError, logDetailedError } from "../errors";
import { ed25519 } from "@noble/curves/ed25519";

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}


// ── Signature verification ──────────────────────────────────────────────────

function hexToU8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

/**
 * Verify an Ed25519 signature against the transaction hash.
 * Works for both standard Ed25519 and BIP32-Ed25519 signatures
 * (both produce valid Ed25519 verify-able sigs).
 */
function verifyEd25519Sig(hashBase64Url: string, sigHex: string, pubKeyHex: string): boolean {
  try {
    // Decode base64url hash → raw bytes
    const b64 = hashBase64Url.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    const hashBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) hashBytes[i] = bin.charCodeAt(i);
    return ed25519.verify(hexToU8(sigHex), hashBytes, hexToU8(pubKeyHex));
  } catch {
    return false;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface UrStoaGuardResult {
  exists: boolean;
  guard?: any;
  isKeyset: boolean;
  keys: string[];
  pred: string;
}

// ── Balance ─────────────────────────────────────────────────────────────────

export async function getUrStoaBalance(account: string): Promise<number> {
  try {
    const pactCode = `(try 0.0 (coin.UR_UR|Balance "${account}"))`;
    const response = await rawCalibratedDirtyRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") {
      const data = (response.result as any).data;
      if (typeof data === "number") return data;
      if (data?.decimal !== undefined) return parseFloat(data.decimal);
      return parseFloat(String(data));
    }
    return 0;
  } catch (error) {
    console.error("Error fetching UrStoa balance:", error);
    return 0;
  }
}

// ── Describe keyset ref ─────────────────────────────────────────────────────

async function describeKeyset(ksRef: string): Promise<{ keys: string[]; pred: string } | null> {
  try {
    const pactCode = `(describe-keyset "${ksRef}")`;
    const response = await rawCalibratedDirtyRead(pactCode, { tier: "T7" });
    if (response?.result?.status === "success") {
      const data = (response.result as any).data;
      if (data && Array.isArray(data.keys)) {
        return { keys: data.keys, pred: data.pred ?? "keys-all" };
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Guard ───────────────────────────────────────────────────────────────────

export async function getUrStoaGuard(account: string): Promise<UrStoaGuardResult> {
  const empty: UrStoaGuardResult = { exists: false, isKeyset: false, keys: [], pred: "" };
  try {
    const pactCode = `(try false (coin.UR_UR|Guard "${account}"))`;
    const response = await rawCalibratedDirtyRead(pactCode, { tier: "T7" });
    if (response?.result?.status === "success") {
      const data = (response.result as any).data;
      if (data === false || data === "false") return empty;
      if (data && typeof data === "object") {
        // Case 1: Direct keyset — keys + pred directly on the guard object
        if (Array.isArray(data.keys) && data.keys.length > 0) {
          return {
            exists: true,
            guard: data,
            isKeyset: true,
            keys: data.keys,
            pred: data.pred ?? "keys-all",
          };
        }

        // Case 2: Keyset reference — unpack via (describe-keyset <ref>)
        if (data.keysetref && typeof data.keysetref === "string") {
          const resolved = await describeKeyset(data.keysetref);
          if (resolved) {
            return {
              exists: true,
              guard: data,
              isKeyset: true,
              keys: resolved.keys,
              pred: resolved.pred,
            };
          }
        }
        // Also handle keysetref nested in a ks-name field
        const ksName = data["ks-name"] ?? data.keysetref ?? data["keysetref-name"];
        if (ksName && typeof ksName === "string" && !data.keys?.length) {
          const resolved = await describeKeyset(ksName);
          if (resolved) {
            return {
              exists: true,
              guard: data,
              isKeyset: true,
              keys: resolved.keys,
              pred: resolved.pred,
            };
          }
        }

        // Case 3: Any other guard type — exists but not a usable keyset
        return {
          exists: true,
          guard: data,
          isKeyset: false,
          keys: [],
          pred: "",
        };
      }
      return empty;
    }
    return empty;
  } catch (error) {
    console.error("Error fetching UrStoa guard:", error);
    return empty;
  }
}

// ── Execute ─────────────────────────────────────────────────────────────────

/** Keypair with optional Chainweaver/Ecko signing fields */
export interface UrStoaKeypair {
  publicKey: string;
  privateKey?: string;
  secretKey?: string;
  seedType?: string;
  encryptedSecretKey?: any;
  password?: string;
}

export interface ExecuteNativeUrStoaParams {
  senderAddress: string;
  receiverAddress: string;
  amount: string;
  paymentKeyAddress: string;
  paymentKeypair: UrStoaKeypair;
  senderGuardKeys: UrStoaKeypair[];
  isTransferFamily: boolean;
  receiverExists: boolean;
  receiverKeyset?: { keys: string[]; pred: string };
}

export async function executeNativeUrStoaTransfer(params: ExecuteNativeUrStoaParams): Promise<any> {
  const {
    senderAddress, receiverAddress, amount,
    paymentKeyAddress, paymentKeypair, senderGuardKeys,
    isTransferFamily, receiverExists, receiverKeyset,
  } = params;

  const amountStr = parseFloat(amount).toFixed(3);
  const isAnew = !receiverExists;

  // Select pact code
  let pactCode: string;
  if (receiverExists && isTransferFamily) {
    pactCode = `(coin.C_UR|Transfer "${senderAddress}" "${receiverAddress}" ${amountStr})`;
  } else if (receiverExists && !isTransferFamily) {
    pactCode = `(coin.C_UR|Transmit "${senderAddress}" "${receiverAddress}" ${amountStr})`;
  } else if (!receiverExists && isTransferFamily) {
    pactCode = `(coin.C_UR|TransferAnew "${senderAddress}" "${receiverAddress}" (read-keyset "ks") ${amountStr})`;
  } else {
    pactCode = `(coin.C_UR|TransmitAnew "${senderAddress}" "${receiverAddress}" (read-keyset "ks") ${amountStr})`;
  }

  const buildTransaction = (gasLimitOverride?: number) => {
    let builder = Pact.builder
      .execution(pactCode)
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride ?? 2_000_000,
      })
      .setNetworkId(KADENA_NETWORK);

    // Add keyset data for Anew variants
    if (isAnew && receiverKeyset) {
      builder = builder.addData("ks", { keys: receiverKeyset.keys, pred: receiverKeyset.pred }) as any;
    }

    // Payment key signer — GAS_PAYER ALWAYS uses ("", 0, 0.0) as args
    if (isTransferFamily) {
      builder = builder.addSigner(paymentKeypair.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w(`coin.UR|TRANSFER`, senderAddress, receiverAddress, { decimal: amountStr }),
      ]) as any;
    } else {
      builder = builder.addSigner(paymentKeypair.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]) as any;
    }

    // Pure guard signers — only add 1 key (minimum needed for keys-any/keys-all)
    // For Transmit: payment key + 1 guard key = 2 signers total (matching on-chain convention)
    const addedPubs = new Set<string>([paymentKeypair.publicKey]);
    for (const k of senderGuardKeys) {
      if (!addedPubs.has(k.publicKey)) {
        builder = (builder as any).addSigner(k.publicKey);
        addedPubs.add(k.publicKey);
        break; // Only add 1 pure guard key signer
      }
    }

    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  // 1. Simulate
  const simTx = buildTransaction();
  const simulation = await dirtyRead(simTx);

  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Native UrStoa Transfer",
      simulation.result,
      `Sender: ${senderAddress} | Receiver: ${receiverAddress} | Amount: ${amountStr}`,
    );
    logDetailedError(error);
    throw error;
  }

  // 2. Adaptive gas
  const gasLimit = simulation.gas ? calculateAutoGasLimit(simulation.gas) : 2_000_000;

  // 3. Collect signers — payment key + 1 guard key only (matching on-chain convention)
  const allSigners: UrStoaKeypair[] = [paymentKeypair];
  const seenPubs = new Set<string>([paymentKeypair.publicKey]);
  for (const k of senderGuardKeys) {
    if (!seenPubs.has(k.publicKey)) {
      allSigners.push(k);
      seenPubs.add(k.publicKey);
      break; // Only 1 guard key needed
    }
  }

  // 4. Sign, verify, and filter invalid signatures
  //    Some guard keys may produce invalid signatures (e.g. signing algorithm
  //    mismatch between seed types). We verify each signature after signing
  //    and rebuild without the bad keys if the guard predicate still holds.
  let finalTx = buildTransaction(gasLimit);
  let signed: any = await universalSignTransaction(
    finalTx,
    allSigners.map((s) => fromKeypair(s)),
  );

  // Verify all signatures
  const cmd = JSON.parse(signed.cmd);
  const signerPubs: string[] = cmd.signers.map((s: any) => s.pubKey);
  const invalidIdxs: number[] = [];

  for (let i = 0; i < signed.sigs.length; i++) {
    const sig = signed.sigs[i];
    if (sig?.sig) {
      const valid = verifyEd25519Sig(signed.hash, sig.sig, signerPubs[i]);
      if (!valid) {
        console.warn(
          `[UrStoa] Invalid signature at position ${i} for key ${signerPubs[i]} — will rebuild without it.`,
        );
        invalidIdxs.push(i);
      }
    }
  }

  // If any guard key signatures are invalid, rebuild without those keys
  if (invalidIdxs.length > 0) {
    const invalidPubs = new Set(invalidIdxs.map((i) => signerPubs[i]));
    // Never remove the payment key (position 0)
    if (invalidPubs.has(paymentKeypair.publicKey)) {
      throw new Error(
        `Payment key signature is invalid (key: ${paymentKeypair.publicKey.slice(0, 16)}…). Cannot proceed.`,
      );
    }

    // Filter out guard keys with invalid signatures
    const validGuardKeys = senderGuardKeys.filter((k) => !invalidPubs.has(k.publicKey));
    if (validGuardKeys.length === 0) {
      throw new Error(
        "All guard key signatures are invalid. Check that the keys in Codex match the sender's guard " +
        "(possible signing algorithm mismatch between seed types).",
      );
    }

    console.info(
      `[UrStoa] Rebuilding transaction with ${validGuardKeys.length} valid guard key(s) ` +
      `(removed ${invalidIdxs.length} invalid).`,
    );

    // Rebuild with only valid guard keys
    const origGuardKeys = senderGuardKeys;
    (params as any)._filteredGuardKeys = validGuardKeys;

    const rebuildTransaction = (gasLimitOverride?: number) => {
      let builder = Pact.builder
        .execution(pactCode)
        .setMeta({
          senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
          chainId: KADENA_CHAIN_ID,
          gasLimit: gasLimitOverride ?? 2_000_000,
        })
        .setNetworkId(KADENA_NETWORK);

      if (isAnew && receiverKeyset) {
        builder = builder.addData("ks", { keys: receiverKeyset.keys, pred: receiverKeyset.pred }) as any;
      }

      if (isTransferFamily) {
        builder = builder.addSigner(paymentKeypair.publicKey, (w: any) => [
          w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, paymentKeyAddress, { int: 0 }, { decimal: "0.0" }),
          w(`coin.UR|TRANSFER`, senderAddress, receiverAddress, { decimal: amountStr }),
        ]) as any;
      } else {
        builder = builder.addSigner(paymentKeypair.publicKey, (w: any) => [
          w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, paymentKeyAddress, { int: 0 }, { decimal: "0.0" }),
        ]) as any;
      }

      const addedPubs = new Set<string>([paymentKeypair.publicKey]);
      for (const k of validGuardKeys) {
        if (!addedPubs.has(k.publicKey)) {
          builder = (builder as any).addSigner(k.publicKey);
          addedPubs.add(k.publicKey);
        }
      }

      return (builder as any).createTransaction();
    };

    finalTx = rebuildTransaction(gasLimit);

    const validSigners: UrStoaKeypair[] = [paymentKeypair];
    const seen2 = new Set<string>([paymentKeypair.publicKey]);
    for (const k of validGuardKeys) {
      if (!seen2.has(k.publicKey)) { validSigners.push(k); seen2.add(k.publicKey); }
    }

    signed = await universalSignTransaction(
      finalTx,
      validSigners.map((s) => fromKeypair(s)),
    );

    // Verify rebuilt transaction signatures
    const cmd2 = JSON.parse(signed.cmd);
    const pubs2: string[] = cmd2.signers.map((s: any) => s.pubKey);
    for (let i = 0; i < signed.sigs.length; i++) {
      const sig = signed.sigs[i];
      if (sig?.sig && !verifyEd25519Sig(signed.hash, sig.sig, pubs2[i])) {
        throw new Error(
          `Signature still invalid after rebuild at position ${i} (key: ${pubs2[i].slice(0, 16)}…). ` +
          `Possible key derivation mismatch in Codex.`,
        );
      }
    }
  }

  // 5. Submit
  return await submit(signed);
}

// ─── Execute Stake UrStoa ─────────────────────────────────────────────────────
/**
 * (coin.C_URV|Stake <account:string> <urstoa-amount:decimal>)
 * Caps: GAS_PAYER + coin.URV|STAKE(account, amount) — both on payment key
 */
export interface StakeUrStoaParams {
  paymentKeyAddress: string;
  amount: string;
  numAmount: number;
  gasStationKey: IKadenaKeypair;
}

export async function executeStakeUrStoa(params: StakeUrStoaParams): Promise<any> {
  const { paymentKeyAddress, amount, numAmount, gasStationKey } = params;

  const buildTransaction = (gasLimitOverride?: number) =>
    Pact.builder
      .execution(`(coin.C_URV|Stake "${paymentKeyAddress}" ${amount})`)
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride ?? 2_000_000,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w("coin.URV|STAKE", paymentKeyAddress, { decimal: String(numAmount) }),
      ])
      .createTransaction();

  const { dirtyRead, submit } = createClient(PACT_URL);

  const simTx = buildTransaction();
  const simulation = await dirtyRead(simTx);
  if (simulation.result.status === "failure") {
    const error = createSimulationError("Stake UrStoa", simulation.result, `Account: ${paymentKeyAddress} | Amount: ${amount}`);
    logDetailedError(error); throw error;
  }

  const gasLimit = simulation.gas ? calculateAutoGasLimit(simulation.gas) : 2_000_000;
  const finalTx = buildTransaction(gasLimit);
  const signed = await universalSignTransaction(finalTx, [fromKeypair(gasStationKey)]);
  return await submit(signed as any);
}

// ─── Execute Unstake UrStoa ───────────────────────────────────────────────────
/**
 * (coin.C_URV|Unstake <account:string> <urstoa-amount:decimal>)
 * Caps: GAS_PAYER + coin.URV|UNSTAKE(account, amount) — both on payment key
 */
export interface UnstakeUrStoaParams {
  paymentKeyAddress: string;
  amount: string;
  numAmount: number;
  gasStationKey: IKadenaKeypair;
}

export async function executeUnstakeUrStoa(params: UnstakeUrStoaParams): Promise<any> {
  const { paymentKeyAddress, amount, numAmount, gasStationKey } = params;

  const buildTransaction = (gasLimitOverride?: number) =>
    Pact.builder
      .execution(`(coin.C_URV|Unstake "${paymentKeyAddress}" ${amount})`)
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride ?? 2_000_000,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w("coin.URV|UNSTAKE", paymentKeyAddress, { decimal: String(numAmount) }),
      ])
      .createTransaction();

  const { dirtyRead, submit } = createClient(PACT_URL);

  const simTx = buildTransaction();
  const simulation = await dirtyRead(simTx);
  if (simulation.result.status === "failure") {
    const error = createSimulationError("Unstake UrStoa", simulation.result, `Account: ${paymentKeyAddress} | Amount: ${amount}`);
    logDetailedError(error); throw error;
  }

  const gasLimit = simulation.gas ? calculateAutoGasLimit(simulation.gas) : 2_000_000;
  const finalTx = buildTransaction(gasLimit);
  const signed = await universalSignTransaction(finalTx, [fromKeypair(gasStationKey)]);
  return await submit(signed as any);
}

// ─── Check if account exists in coin table ───────────────────────────────────
/**
 * Polls for account existence using:
 * (if (= (typeof (try false (coin.UR_Balance account))) "bool") false true)
 * Returns true if account exists, false otherwise.
 */
export async function checkCoinAccountExists(account: string): Promise<boolean> {
  const pactCode = `(if (= (typeof (try false (coin.UR_Balance "${account}"))) "bool") false true)`;
  try {
    const r = await rawCalibratedDirtyRead(pactCode, { tier: "T5" });
    if (r?.result?.status === "success") return r.result.data === true;
    return false;
  } catch { return false; }
}

// ─── Execute Collect UrStoa ───────────────────────────────────────────────────
/**
 * (coin.C_URV|Collect <account:string>)
 * Caps: GAS_PAYER + coin.URV|COLLECT(account)
 *
 * If accountExists=false, wraps in 2-line tx:
 * (coin.C_CreateAccount <account> (read-keyset "ks"))
 * (coin.C_URV|Collect <account>)
 */
export interface CollectUrStoaParams {
  paymentKeyAddress: string;
  gasStationKey: IKadenaKeypair;
  accountExists?: boolean;
}

export async function executeCollectUrStoa(params: CollectUrStoaParams): Promise<any> {
  const { paymentKeyAddress, gasStationKey, accountExists = true } = params;

  // Extract pubkey from k: address for keyset
  const pubkey = paymentKeyAddress.startsWith("k:") ? paymentKeyAddress.slice(2) : paymentKeyAddress;

  const buildTransaction = (gasLimitOverride?: number) => {
    const code = accountExists
      ? `(coin.C_URV|Collect "${paymentKeyAddress}")`
      : `(coin.C_CreateAccount "${paymentKeyAddress}" (read-keyset "ks"))\n(coin.C_URV|Collect "${paymentKeyAddress}")`;

    let builder = Pact.builder
      .execution(code)
      .setMeta({
        senderAccount: STOA_AUTONOMIC_OURONETGASSTATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride ?? 2_000_000,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w("coin.URV|COLLECT", paymentKeyAddress),
      ]);

    // Add keyset data for account creation
    if (!accountExists) {
      builder = (builder as any).addData("ks", { keys: [pubkey], pred: "keys-all" });
    }

    return (builder as any).createTransaction();
  };

  const { dirtyRead, submit } = createClient(PACT_URL);

  const simTx = buildTransaction();
  const simulation = await dirtyRead(simTx);
  if (simulation.result.status === "failure") {
    const error = createSimulationError("Collect UrStoa", simulation.result, `Account: ${paymentKeyAddress}`);
    logDetailedError(error); throw error;
  }

  const gasLimit = simulation.gas ? calculateAutoGasLimit(simulation.gas) : 2_000_000;
  const finalTx = buildTransaction(gasLimit);
  const signed = await universalSignTransaction(finalTx, [fromKeypair(gasStationKey)]);
  return await submit(signed as any);
}