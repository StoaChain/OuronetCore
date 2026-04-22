import {
  KADENA_NAMESPACE,
} from "../constants";
import { formatDecimalForPact } from "../pact";
import { pactRead } from "../reads";

/**
 * Parse transfer preview data to extract relevant information
 */
export interface TransferPreviewData {
  ignisNeed: string;
  ignisText: string;
  preText: string[];
  postText: string[];
  kadenaFree: boolean;
}

export function parseTransferPreview(previewData: any): TransferPreviewData | null {
  if (!previewData?.result) return null;
  
  const data = previewData.result;
  
  return {
    ignisNeed: String(data.ignis?.["ignis-need"] || "0"),
    ignisText: data.ignis?.["ignis-text"] || "",
    preText: data["pre-text"] || [],
    postText: data["post-text"] || [],
    kadenaFree: data.kadena?.["kadena-need"] === 0,
  };
}

/**
 * Get transfer preview information
 * (INFO-ONE.DPTF|INFO_Transfer patron id sender receiver transfer-amount)
 */
export async function getTransferPreview(
  patronAddress: string,
  tokenId: string,
  senderAddress: string,
  receiverAddress: string,
  amount: string
): Promise<{ result: any } | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.DPTF|INFO_Transfer "${patronAddress}" "${tokenId}" "${senderAddress}" "${receiverAddress}" ${decimalAmount})`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return { result: response.result.data };
  } catch (error) {
    console.error("Error getting transfer preview:", error);
    return null;
  }
}

/**
 * Get coil preview information from INFO-ONE
 * (INFO-ONE.ATS|INFO_Coil patron coiler ats reward-token coil-amount)
 */
export async function getCoilPreviewInfo(
  patronAddress: string,
  coilerAddress: string,
  atsId: string,
  rewardTokenId: string,
  amount: string
): Promise<{ result: any } | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Coil "${patronAddress}" "${coilerAddress}" "${atsId}" "${rewardTokenId}" ${decimalAmount})`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return { result: response.result.data };
  } catch (error) {
    console.error("Error getting coil preview:", error);
    return null;
  }
}

/**
 * Get curl preview information from INFO-ONE
 * (INFO-ONE.ATS|INFO_Curl patron curler ats1 ats2 reward-token curl-amount)
 */
export async function getCurlPreviewInfo(
  patronAddress: string,
  curlerAddress: string,
  ats1Id: string,
  ats2Id: string,
  rewardTokenId: string,
  amount: string
): Promise<{ result: any } | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Curl "${patronAddress}" "${curlerAddress}" "${ats1Id}" "${ats2Id}" "${rewardTokenId}" ${decimalAmount})`, { tier: "T2" });



    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return { result: response.result.data };
  } catch (error) {
    console.error("Error getting curl preview:", error);
    return null;
  }
}

/**
 * Get brumate preview information from INFO-ONE
 * (INFO-ONE.ATS|INFO_Brumate patron brumator ats1 ats2 reward-token brumate-amount dayz)
 */
export async function getBrumatePreviewInfo(
  patronAddress: string,
  brumatorAddress: string,
  ats1Id: string,
  ats2Id: string,
  rewardTokenId: string,
  amount: string,
  lockDays: number
): Promise<{ result: any } | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Brumate "${patronAddress}" "${brumatorAddress}" "${ats1Id}" "${ats2Id}" "${rewardTokenId}" ${decimalAmount} ${lockDays})`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return { result: response.result.data };
  } catch (error) {
    console.error("Error getting brumate preview:", error);
    return null;
  }
}

/**
 * Get constrict preview information from INFO-ONE
 * (INFO-ONE.ATS|INFO_Constrict patron constricter ats reward-token constrict-amount dayz)
 */
export async function getConstrictPreviewInfo(
  patronAddress: string,
  constracterAddress: string,
  atsId: string,
  rewardTokenId: string,
  amount: string,
  lockDays: number
): Promise<{ result: any } | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Constrict "${patronAddress}" "${constracterAddress}" "${atsId}" "${rewardTokenId}" ${decimalAmount} ${lockDays})`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return { result: response.result.data };
  } catch (error) {
    console.error("Error getting constrict preview:", error);
    return null;
  }
}


/**
 * Get Sublimate info from INFO-ONE
 * (ouronet-ns.INFO-ONE.ORBR|INFO_Sublimate <client:string> <target:string> <ouro-amount:decimal>)
 */
export async function getSublimateInfo(client: string, target: string, amount: number): Promise<any> {
  try {
    const decimalAmount = amount % 1 === 0 ? `${amount}.0` : String(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.ORBR|INFO_Sublimate "${client}" "${target}" ${decimalAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting sublimate info:", error);
    return null;
  }
}

/**
 * Get Firestarter info from INFO-ONE
 * (ouronet-ns.INFO-ONE.SWP|INFO_Firestarter <firestarter:string>)
 */
export async function getFirestarterInfo(firestarter: string): Promise<any> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.SWP|INFO_Firestarter "${firestarter}")`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting firestarter info:", error);
    return null;
  }
}

/**
 * Get DPTF Transfer info from INFO-ONE
 * (ouronet-ns.INFO-ONE.DPTF|INFO_Transfer <patron> <token-id> <sender> <receiver> <amount>)
 */
export async function getTransferInfo(
  patron: string,
  tokenId: string,
  sender: string,
  receiver: string,
  amount: number
): Promise<any> {
  try {
    const decimalAmount = amount % 1 === 0 ? `${amount}.0` : String(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.DPTF|INFO_Transfer "${patron}" "${tokenId}" "${sender}" "${receiver}" ${decimalAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting transfer info:", error);
    return null;
  }
}

// ── Recovery Primordial read ─────────────────────────────────────────────────
// (ouronet-ns.DPL-UR.URC_0012_RecoveryPrimordial <ats:string> <resident:string>)

export async function getRecoveryPrimordial(
  atsId: string,
  residentAddress: string
): Promise<Record<string, any> | null> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.DPL-UR.URC_0012_RecoveryPrimordial "${atsId}" "${residentAddress}")`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return (response.result as any).data ?? null;
  } catch (error) {
    console.error("Error getting recovery primordial:", error);
    return null;
  }
}

// ── Cold Recovery Info ────────────────────────────────────────────────────────
// (ouronet-ns.INFO-ONE.ATS|INFO_ColdRecovery <patron:string> <recoverer:string> <ats:string> <ra:decimal>)

export async function getColdRecoveryInfo(
  patronAddress: string,
  recovererAddress: string,
  atsId: string,
  ra: string
): Promise<any | null> {
  try {
    const decimalRa = ra.includes(".") ? ra : ra + ".0";
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_ColdRecovery "${patronAddress}" "${recovererAddress}" "${atsId}" ${decimalRa})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response || !response.result || response.result.status === "failure") return null;
    return (response.result as any).data ?? null;
  } catch (error) {
    console.error("Error getting cold recovery info:", error);
    return null;
  }
}

// ── Direct Recovery Info ───────────────────────────────────────────────────────
// (ouronet-ns.INFO-ONE.ATS|INFO_DirectRecovery <patron:string> <recoverer:string> <ats:string> <ra:decimal>)

export async function getDirectRecoveryInfo(
  patronAddress: string,
  recovererAddress: string,
  atsId: string,
  ra: string
): Promise<any | null> {
  try {
    const decimalRa = ra.includes(".") ? ra : ra + ".0";
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_DirectRecovery "${patronAddress}" "${recovererAddress}" "${atsId}" ${decimalRa})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response || !response.result || response.result.status === "failure") return null;
    return (response.result as any).data ?? null;
  } catch (error) {
    console.error("Error getting direct recovery info:", error);
    return null;
  }
}

// ── Elite Max Recovery Amount ──────────────────────────────────────────────────
// (ouronet-ns.DPL-UR.URC_MaxRecoveryAmount <ats:string> <recoverer:string>)
// Returns the max RBT amount a resident can uncoil while preserving their Elite tier.

export async function getMaxRecoveryAmount(
  atsId: string,
  residentAddress: string
): Promise<string | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_MaxRecoveryAmount "${atsId}" "${residentAddress}")`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response || !response.result || response.result.status === "failure") return null;
    const raw = (response.result as any).data;
    if (raw === undefined || raw === null) return null;
    // Result may be decimal object {decimal:"..."} or plain number
    if (typeof raw === "object" && raw.decimal !== undefined) return String(raw.decimal);
    return String(raw);
  } catch (error) {
    console.error("Error getting max recovery amount:", error);
    return null;
  }
}

// ── Cull Info ─────────────────────────────────────────────────────────────────
// (ouronet-ns.INFO-ONE.ATS|INFO_Cull <patron:string> <culler:string> <ats:string>)

export async function getCullInfo(patronAddress: string, cullerAddress: string, atsId: string): Promise<any> {
  const r = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Cull "${patronAddress}" "${cullerAddress}" "${atsId}")`, { tier: "T2" });
  if (!r?.result || r.result.status === "failure") return null;
  return (r.result as any).data ?? null;
}

// ── Hibernated GSTOA Nonces ──────────────────────────────────────────────────
// (ouronet-ns.INFO-ONE.VST|INFO-HibernatedNoncesDisplay <resident-account> <dpof>)

export interface HibernatedNonce {
  nonce: number;
  "nonce-supply": number;
  "mint-time": string;
  "release-time": string;
  "hibernating-fee-promile": number;
  remainder: number;
  "hibernating-fee": number;
}

/** Normalize Pact primitive wrappers → plain JS values.
 *  Handles: {int: N} → number, {decimal: "..."} → number
 *  Time objects are handled separately by normalizePactTime. */
function normalizePactValue(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ("int" in o)     return Number(o["int"]);
    if ("decimal" in o) return parseFloat(String(o["decimal"]));
  }
  return v;
}

/**
 * Normalize a Pact time value to an ISO 8601 string that new Date() can parse.
 * Pact returns time as: {time: "YYYY-MM-DDThh:mm:ss.000000Z"} or similar.
 * We extract the inner string and ensure it's a valid ISO string.
 */
function normalizePactTime(v: unknown): string {
  let raw = "";
  if (typeof v === "string") {
    raw = v;
  } else if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    // Pact wraps time as {timep: "..."} (Pact's actual key)
    // Also handle {time: "..."} as fallback
    if ("timep" in o) raw = String(o["timep"]);
    else if ("time" in o) raw = String(o["time"]);
  }
  if (!raw) return "";
  // Ensure it ends with Z if no timezone info
  if (!raw.endsWith("Z") && !raw.includes("+")) raw = raw + "Z";
  return raw;
}

function normalizeNonce(raw: Record<string, unknown>): HibernatedNonce {
  return {
    nonce:                     Number(normalizePactValue(raw["nonce"]) ?? 0),
    "nonce-supply":            Number(normalizePactValue(raw["nonce-supply"]) ?? 0),
    "mint-time":               normalizePactTime(raw["mint-time"]),
    "release-time":            normalizePactTime(raw["release-time"]),
    "hibernating-fee-promile": Number(normalizePactValue(raw["hibernating-fee-promile"]) ?? 0),
    remainder:                 Number(normalizePactValue(raw["remainder"]) ?? 0),
    "hibernating-fee":         Number(normalizePactValue(raw["hibernating-fee"]) ?? 0),
  };
}

export async function getHibernatedNoncesDisplay(
  residentAccount: string,
  dpof: string,
  sortBy?: "nonce" | "fee-promile",
): Promise<HibernatedNonce[] | null> {
  try {
    const inner = `(${KADENA_NAMESPACE}.INFO-ONE.VST|INFO-HibernatedNoncesDisplay "${residentAccount}" "${dpof}")`;
    const pactCode = sortBy === "fee-promile"
      ? `(sort ["hibernating-fee-promile"] ${inner})`
      : inner;

    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") return null;
    const data = (response.result as any).data;
    if (!Array.isArray(data)) return null;
    // Normalize all Pact primitive wrappers ({int:N}, {decimal:"..."}, {time:"..."})
    return (data as Record<string, unknown>[]).map(normalizeNonce);
  } catch (error) {
    console.error("Error getting hibernated nonces:", error);
    return null;
  }
}

// ── Awake Info ────────────────────────────────────────────────────────────────
// (ouronet-ns.INFO-ONE.VST|INFO_Awake <patron> <awaker> <dpof> <nonce>)

export async function getAwakeInfo(
  patron: string,
  awaker: string,
  dpof: string,
  nonce: number,
): Promise<Record<string, unknown> | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.VST|INFO_Awake "${patron}" "${awaker}" "${dpof}" ${nonce})`;
    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") return null;
    return (response.result as any).data ?? null;
  } catch (error) {
    console.error("Error getting awake info:", error);
    return null;
  }
}

// ── Slumber Info ──────────────────────────────────────────────────────────────
// (ouronet-ns.INFO-ONE.VST|INFO_Slumber <patron> <merger> <dpof> <nonces:[integer]>)

export async function getSlumberInfo(
  patron: string,
  merger: string,
  dpof: string,
  nonces: number[],
): Promise<Record<string, unknown> | null> {
  try {
    const nonceList = `[${nonces.join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.VST|INFO_Slumber "${patron}" "${merger}" "${dpof}" ${nonceList})`;
    const response = await pactRead(pactCode, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") return null;
    return (response.result as any).data ?? null;
  } catch (error) {
    console.error("Error getting slumber info:", error);
    return null;
  }
}

/**
 * Get ClearDispo preview info from INFO-ONE
 * (ouronet-ns.INFO-ONE.DPTF|INFO_ClearDispo <patron:string> <account:string>)
 */
export async function getClearDispoInfo(
  patronAddress: string,
  accountAddress: string
): Promise<any> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.DPTF|INFO_ClearDispo "${patronAddress}" "${accountAddress}")`, { tier: "T2" });
    if (response.result.status === "failure") return null;
    return (response.result as any).data ?? null;
  } catch {
    return null;
  }
}

// ── Add Liquidity INFO function ───────────────────────────────────────────────

/**
 * INFO_AddLiquidity — dirty read for add liquidity preview.
 * (ouronet-ns.INFO-ONE.SWP|INFO_AddLiquidity patron account swpair input-amounts kda-pid)
 */
export async function getInfoAddLiquidity(
  patron: string,
  account: string,
  swpair: string,
  inputAmounts: string[],
  kdaPid: string
): Promise<any | null> {
  try {
    const pactInputAmounts = `[${inputAmounts.map(a => {
      const s = String(a || "0");
      return s.includes(".") ? s : s + ".0";
    }).join(" ")}]`;
    const decKdaPid = kdaPid.includes(".") ? kdaPid : kdaPid + ".0";
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.SWP|INFO_AddLiquidity "${patron}" "${account}" "${swpair}" ${pactInputAmounts} ${decKdaPid})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response?.result || response.result.status === "failure") return null;
    return response.result.data;
  } catch (error) {
    console.error("getInfoAddLiquidity error:", error);
    return null;
  }
}

/**
 * INFO_Fuel — dirty read for fuel preview.
 * (ouronet-ns.INFO-ONE.SWP|INFO_Fuel patron account swpair input-amounts)
 */
export async function getInfoFuel(
  patron: string,
  account: string,
  swpair: string,
  inputAmounts: string[],
): Promise<any | null> {
  try {
    const pactInputAmounts = `[${inputAmounts.map(a => {
      const s = String(a || "0");
      return s.includes(".") ? s : s + ".0";
    }).join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.SWP|INFO_Fuel "${patron}" "${account}" "${swpair}" ${pactInputAmounts})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response?.result || response.result.status === "failure") return null;
    return response.result.data;
  } catch (error) {
    console.error("getInfoFuel error:", error);
    return null;
  }
}

// ── Swap INFO functions ───────────────────────────────────────────────────────

/**
 * INFO_SinglePoolSwap — dirty read for single-input swap preview.
 * (ouronet-ns.INFO-ONE.SWP|INFO_SinglePoolSwap patron account swpair input-id input-amount output-id)
 */
export async function getInfoSinglePoolSwap(
  patron: string,
  account: string,
  swpair: string,
  inputId: string,
  inputAmount: string,
  outputId: string
): Promise<any | null> {
  try {
    const decAmount = formatDecimalForPact(inputAmount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.SWP|INFO_SinglePoolSwap "${patron}" "${account}" "${swpair}" "${inputId}" ${decAmount} "${outputId}")`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response?.result || response.result.status === "failure") return null;
    return response.result.data;
  } catch (error) {
    console.error("getInfoSinglePoolSwap error:", error);
    return null;
  }
}

/**
 * INFO_MultiPoolSwap — dirty read for multi-input swap preview.
 * (ouronet-ns.INFO-ONE.SWP|INFO_MultiPoolSwap patron account swpair input-ids input-amounts output-id)
 */
export async function getInfoMultiPoolSwap(
  patron: string,
  account: string,
  swpair: string,
  inputIds: string[],
  inputAmounts: string[],
  outputId: string
): Promise<any | null> {
  try {
    const pactInputIds = `[${inputIds.map(id => `"${id}"`).join(" ")}]`;
    const pactInputAmounts = `[${inputAmounts.map(a => {
      const s = String(a);
      return s.includes(".") ? s : s + ".0";
    }).join(" ")}]`;
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.SWP|INFO_MultiPoolSwap "${patron}" "${account}" "${swpair}" ${pactInputIds} ${pactInputAmounts} "${outputId}")`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (!response?.result || response.result.status === "failure") return null;
    return response.result.data;
  } catch (error) {
    console.error("getInfoMultiPoolSwap error:", error);
    return null;
  }
}

/**
 * INFO_RemoveLiquidity — dirty read for remove liquidity (unfold) preview.
 * (ouronet-ns.INFO-ONE.SWP|INFO_RemoveLiquidity patron account swpair lp-amount)
 */
export async function getInfoRemoveLiquidity(
  patron: string,
  account: string,
  swpair: string,
  lpAmount: string,
): Promise<any | null> {
  try {
    const decLpAmount = lpAmount.includes(".") ? lpAmount : lpAmount + ".0";
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.SWP|INFO_RemoveLiquidity "${patron}" "${account}" "${swpair}" ${decLpAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    console.log("[INFO_RemoveLiquidity] pactCode:", pactCode);
    console.log("[INFO_RemoveLiquidity] response:", JSON.stringify(response?.result, null, 2));
    if (!response?.result || response.result.status === "failure") {
      console.warn("[INFO_RemoveLiquidity] FAILED:", (response?.result as any)?.error?.message);
      return null;
    }
    return response.result.data;
  } catch (error) {
    console.error("getInfoRemoveLiquidity error:", error);
    return null;
  }
}
