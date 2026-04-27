import { calculateAutoGasLimit } from "../gas";
import {
  KADENA_CHAIN_ID,
  KADENA_NAMESPACE, GAS_STATION, NATIVE_TOKEN_VAULT,
  KADENA_NETWORK,
  getPactUrl,
} from "../constants";
import { formatEU } from "../pact";
import { mayComeWithDeimal, formatDecimalForPact } from "../pact";
import { IKeyset } from "../guard";
import { Pact, createClient } from "@kadena/client";
import { universalSignTransaction, fromKeypair } from "../signing";
import { createSigningError, createSimulationError, logDetailedError } from "../errors";
import { pactRead } from "../reads";

export interface AccountSelectorData {
  "iz-activated": boolean;
  "ouronet-account": string;
  "ouronet-account-guard": any; // IKeyset or false
  "iz-smart": boolean | number; // true/false/-1
  "ouro-balance": number;
  "ignis-balance": number;
  "payment-key-existance": boolean;
  "payment-key": string;
  "payment-key-balance": number;
  "payment-key-guard": any;
  "ignis-discount": any;
  "stoa-discount": any;
  /**
   * On-chain public key for the account — the long base-49 string in the
   * DALOS `{prefixLenBase49}.{xyBase49}` format. Populated for both
   * Standard (Ѻ.) and Smart (Σ.) accounts. **This is the on-chain source
   * of truth** and is expected to match the codex-stored `publicKey` for
   * any account created through the standard flow. A mismatch would
   * indicate either (a) an admin-level key rotation performed on chain
   * (designed as a last-resort correction tool), or (b) a corrupted
   * codex entry. Added in ouronet-core v1.4.0 alongside the
   * `URC_0027_AccountSelectorMapper` Pact-side extension.
   */
  "public-key": string;
  /**
   * Sovereign — only populated for Smart accounts (iz-smart = true). The
   * Ѻ. Standard Ouronet Account that has sovereignty over this Smart
   * account; proving ownership of the sovereign proves ownership of the
   * Smart account's `sovereign` authorization path. Pact returns `false`
   * for Standard accounts and unactivated accounts. Added in v1.4.0.
   */
  "sovereign": string | false;
  /**
   * Governor — only populated for Smart accounts. A Pact guard used for
   * complex custom authorization logic (capability guards, module guards,
   * user guards, or additional keyset arrangements). For Smart accounts
   * where no custom governor has been set, this equals the account's own
   * `ouronet-account-guard`. Pact returns `false` for Standard accounts
   * and unactivated accounts. Added in v1.4.0.
   */
  "governor": any | false; // IKeyset / capability / module guard / false
}

export async function getAccountSelectorData(accounts: string[], options?: { skipTempWatcher?: boolean }): Promise<AccountSelectorData[]> {
  const accountsList = accounts.map(a => `"${a}"`).join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0027_AccountSelectorMapper [${accountsList}])`;
  const response = await pactRead(pactCode, { tier: "T5", skipTempWatcher: options?.skipTempWatcher });
  
  if (!response?.result || (response.result as any).status === "failure") {
    console.error("AccountSelectorMapper failed:", response);
    return [];
  }
  
  return ((response.result as any)?.data as AccountSelectorData[]) ?? [];
}

export interface StoaAccountSelectorData {
  "iz-activated": boolean;
  "account": string;
  "balance": number;
  "guard": any;
}

export async function getStoaAccountSelectorData(accounts: string[]): Promise<StoaAccountSelectorData[]> {
  if (accounts.length === 0) return [];
  const accountsList = accounts.map(a => `"${a}"`).join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0028_StoaAccountSelectorMapper [${accountsList}])`;
  const response = await pactRead(pactCode, { tier: "T5" });
  
  if (!response?.result || (response.result as any).status === "failure") {
    console.error("StoaAccountSelectorMapper failed:", response);
    return [];
  }
  
  return ((response.result as any)?.data as StoaAccountSelectorData[]) ?? [];
}

export interface AccountOverviewData {
  "global-administrative-pause": boolean;
  "iz-selected-activated": boolean;
  "stoa-costs": number;
}

export async function getAccountOverview(account: string): Promise<AccountOverviewData | null> {
  if (!account) return null;
  const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0029_AccountOverview "${account}")`;
  const response = await pactRead(pactCode, { tier: "T7" });

  if (!response?.result || (response.result as any).status === "failure") {
    console.error("AccountOverview failed:", response);
    return null;
  }

  return (response.result as any)?.data as AccountOverviewData ?? null;
}

/**
 * Safe creation time for Pact transactions.
 * Subtracts 30 seconds from current time to prevent "creation time too far in the future" errors
 * caused by minor clock drift between client and blockchain nodes.
 */
function safeCreationTime(): number {
  return Math.floor(Date.now() / 1000) - 30;
}

// import { kadenaSignWithKeyPair } from "@kadena/hd-wallet";

export async function isAdministrativePause(): Promise<boolean> {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DALOS.UR_GAP)`, { tier: "T7" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any).data;
}

export async function kadenaLedger(address: string): Promise<any> {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DALOS.UR_KadenaLedger "${address}")`, { tier: "T5" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return response.result;
}

// // (defun DPTF-DPMF-ATS|UR_OwnedTokens (account:string table-to-query:integer))
// export async function ownedTokens(address: string, tokenType: 1 | 2 | 3) {
//   const transaction = Pact.builder
//     .execution(
//       `(${KADENA_NAMESPACE}.DPTF-DPMF-ATS.UR_OwnedTokens "${address}" ${tokenType})`,
//     )
//     .setMeta({ chainId: KADENA_CHAIN_ID })
//     .setNetworkId(KADENA_NETWORK)
//     .createTransaction();

//   const { dirtyRead } = createClient(getPactUrl(KADENA_CHAIN_ID));

//   const response = await dirtyRead(transaction);

//   if (!response || !response.result) {
//     throw new Error("Failed to retrieve data from the transaction.");
//   }
//   console.log("response", response);
//   return response.result;
// }

export const getKadenaAccountOwner = async (
  address: string,
): Promise<string | null> => {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DALOS.UR_AccountKadena "${address}")`, { tier: "T5" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any)?.data || null;
};

export const readKeyset = async (namespace: string, keysetName: string) => {
  const response = await pactRead(`(describe-keyset "${namespace}.${keysetName}")`, { tier: "T7" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any)?.data || null;
};

/**
 * Resolve a guard value — if it's a keyset ref, fetch the actual keyset.
 * Handles both direct keyset objects and {keysetref: {ns, ksn}} references.
 */
export async function resolveGuard(guardData: any): Promise<any> {
  if (!guardData || guardData === false) return null;
  if (guardData.keysetref) {
    const ks = await readKeyset(guardData.keysetref.ns, guardData.keysetref.ksn);
    if (ks) ks.keysetRef = `${guardData.keysetref.ns}.${guardData.keysetref.ksn}`;
    return ks;
  }
  return guardData;
}

export const getKadenaAccountGuard = async (
  address: string,
): Promise<IKeyset | null> => {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DALOS.UR_AccountGuard "${address}")`, { tier: "T7" });
  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }
  const { data } = response.result as any;
  if (data?.hasOwnProperty("keysetref")) {
    const ks2 = await readKeyset(data.keysetref.ns, data.keysetref.ksn);
    if (ks2) ks2.keysetRef = `${data.keysetref.ns}.${data.keysetref.ksn}`;
    return ks2;
  }

  return data || null;
};

export async function getOuronetKdaDetails(address: string): Promise<any> {
  const owner = await getKadenaAccountOwner(address);
  const guard = await getKadenaAccountGuard(address);

  return {
    isActive: owner !== null,
    owner: owner,
    guard: guard,
  };
}

// (namespace.DSP.URC_PrimordialPrices)

export async function primordialPrices(): Promise<any> {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DSP.URC_PrimordialPrices)`, { tier: "T6" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any)?.data || null;
}

// DALOS.UR_Elite account
export async function eliteAccount(address: string): Promise<any> {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DALOS.UR_Elite "${address}")`, { tier: "T6" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }
  return (response.result as any)?.data || null;
}


export async function filterKeysForInfo(
  address: string,
  table: number = 1,
  mode: boolean = true,
): Promise<any> {
  const pactCode = `(${KADENA_NAMESPACE}.TFT.DPTF-DPMF-ATS|UR_FilterKeysForInfo "${address}" ${table} ${mode})`;

  const response = await pactRead(pactCode, { tier: "T3" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any)?.data || null;
}
// (namespace.TFT.DPTF-DPMF-ATS|UR_FilterKeysForInfo account table mode)

// eliteAccount(
//   "Ѻ.UřØЭŻíεÇÔĂЪÝξæȘöźѺßXõÕчPŻț7$мαßуeÅEÒÝàSιpbψσ9₳JЧË9иΦpμчЙçκъЦmŻíъEαÒgы43ż2AWR0ńφżi₿íĄψMлæIĘÈĄдÂeиśrЩΓвĆЫo$ΨyЩΔ9żIwSщýкъщфŚ4ΔłÚřŻřůεğćβэDЪÂÉÂ9чøΨΠćýôyíśζыςΓp1αДεЬ",
// );

// filterKeysForInfo(
//   "Ѻ.éXødVțrřĄθ7ΛдUŒjeßćιiXTПЗÚĞqŸœÈэαLżØôćmч₱ęãΛě$êůáØCЗшõyĂźςÜãθΘзШË¥şEÈnxΞЗÚÏÛjDVЪжγÏŽнăъçùαìrпцДЖöŃȘâÿřh£1vĎO£κнβдłпČлÿáZiĐą8ÊHÂßĎЩmEBцÄĎвЙßÌ5Ï7ĘŘùrÑckeñëδšПχÌàî",
//   1,
//   true,
// );

// getKadenaAccountGuard(
//   "Ѻ.éXødVțrřĄθ7ΛдUŒjeßćιiXTПЗÚĞqŸœÈэαLżØôćmч₱ęãΛě$êůáØCЗшõyĂźςÜãθΘзШË¥şEÈnxΞЗÚÏÛjDVЪжγÏŽнăъçùαìrпцДЖöŃȘâÿřh£1vĎO£κнβдłпČлÿáZiĐą8ÊHÂßĎЩmEBцÄĎвЙßÌ5Ï7ĘŘùrÑckeñëδšПχÌàî",
// );

// (namespace.DALOS.UR_UsagePrice "standard)

// returns the price of the activation
export async function usagePrice(tokenType: string = "standard"): Promise<any> {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DALOS.UR_UsagePrice "${tokenType}")`, { tier: "T7" });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any)?.data || null;
}

// (namespace.DPL-UR.DALOS|URC_DeployStandardAccount) // should return the keysets

//(namespace.DPL-UR.URC_0001_Header account) 5000 gas
// Legacy: getHeaderData removed — replaced by URC_0027_AccountSelectorMapper for header.
// HeaderV3 is still used by Dashboard (IndexCardsGrid, OuroAccountCard, FirestarterSection).
export async function getHeaderData(address: string = "", options?: { skipTempWatcher?: boolean }): Promise<any> {
  const response = await pactRead(`(${KADENA_NAMESPACE}.DPL-UR.URC_0001_HeaderV3 "${address}")`, { tier: "T6", skipTempWatcher: options?.skipTempWatcher });

  if (!response || !response.result) {
    throw new Error("Failed to retrieve data from the transaction.");
  }

  return (response.result as any)?.data || null;
}

// getHeaderData(
//   "Ѻ.éXødVțrřĄθ7ΛдUŒjeßćιiXTПЗÚĞqŸœÈэαLżØôćmч₱ęãΛě$êůáØCЗшõyĂźςÜãθΘзШË¥şEÈnxΞЗÚÏÛjDVЪжγÏŽнăъçùαìrпцДЖöŃȘâÿřh£1vĎO£κнβдłпČлÿáZiĐą8ÊHÂßĎЩmEBцÄĎвЙßÌ5Ï7ĘŘùrÑckeñëδšПχÌàî",
// );

// (namespace.DPL-UR.URC_0002_Primordials account)
// Ѻ.éXødVțrřĄθ7ΛдUŒjeßćιiXTПЗÚĞqŸœÈэαLżØôćmч₱ęãΛě$êůáØCЗшõyĂźςÜãθΘзШË¥şEÈnxΞЗÚÏÛjDVЪжγÏŽнăъçùαìrпцДЖöŃȘâÿřh£1vĎO£κнβдłпČлÿáZiĐą8ÊHÂßĎЩmEBцÄĎвЙßÌ5Ï7ĘŘùrÑckeñëδšПχÌàî

export async function getPrimordials(
  currentAccount: string = "",
  codexAccounts: string[] = [],
  options?: { skipTempWatcher?: boolean }
): Promise<any> {
  const accountsList = codexAccounts.map((a) => `"${a}"`).join(" ");
  const pactCode = `(${KADENA_NAMESPACE}.DPL-UR.URC_0002_Primordials "${currentAccount}" [${accountsList}])`;

  const response = await pactRead(pactCode, { tier: "T5", skipTempWatcher: options?.skipTempWatcher });

  if (!response || !response.result) {
    return null; // network failure — caller should retry, not show ???
  }
  if (response.result.status === "failure") {
    return null; // pact failure — caller should retry, not show ???
  }
  return parseResponse(response.result.data as any[]);
}

const fmt = (v: any): string => formatEU(mayComeWithDeimal(v) ?? null);

const parseResponse = (data: any[]): any => {
  const d = data[0];
  const codex = data[1] ?? {};

  const supplyHoverVal = (v: any) => {
    const raw = mayComeWithDeimal(v);
    return formatEU(raw !== null && raw !== undefined ? String(raw) : null);
  };

  const ouro = {
    id: d["ouro-id"],
    name: d["ouro-name"],
    icon: "/images/coins/OURO.svg",
    iconBgColor: "bg-primary/5",
    balance: {
      display: fmt(d["ouro-balance"]),
      value: fmt(d["ouro-balance-hover"]),
    },
    balanceUsd: fmt(d["ouro-balance-vid"]),
    pricePerUnit: fmt(d["ouro-price"]),
    totalSupply: {
      display: fmt(d["ouro-dispo-capacity"]),
      value: fmt(d["ouro-dispo-capacity-hover"]),
    },
    supplyUsdValue: fmt(d["ouro-dispo-capacity-vid"]),
    virtual: {
      display: fmt(d["ouro-v-balance"]),
      value: fmt(d["ouro-v-balance-hover"]),
      inUsd: fmt(d["ouro-v-balance-vid"]),
    },
    info: "",
    currencySymbol: "Ѻ",
    currencySymbolColor: "#7b4a1e",
    availableActions: ["Sublimate", "Coil", "Curl", "Transfer", "Bulk Transfer"],
    keepTransferNames: true,
    balanceLabel: "Balance",
    virtualLabel: "Virtual Balance",
    supplyLabel: "Dispo Capacity",
  };

  const ignis = {
    id: d["gas-id"],
    name: d["gas-name"],
    icon: "/images/coins/Ignis.svg",
    iconBgColor: "bg-primary/5",
    balance: {
      display: fmt(d["gas-balance"]),
      value: fmt(d["gas-balance-hover"]),
    },
    balanceUsd: fmt(d["gas-balance-vid"]),
    pricePerUnit: fmt(d["gas-price"]),
    totalSupply: {
      display: fmt(d["gas-supply"]),
      value: supplyHoverVal(d["gas-supply-hover"]),
    },
    supplyUsdValue: fmt(d["gas-supply-vid"]),
    virtual: null,
    info: d["gas-discount-text"] ?? "",
    currencySymbol: "Ω",
    currencySymbolColor: "#cc2200",
    availableActions: ["Compress", "Firestarter", "Transfer", "Bulk Transfer"],
    keepTransferNames: true,
    maxButtonsPerRow: 2,
    balanceLabel: "Balance",
    showCodexRow: true,
    supplyLabel: "Ouronet Total GAS",
    codexBalance: {
      display: fmt(codex["codex-balance"]),
      value: fmt(codex["codex-balance-hover"]),
      inUsd: fmt(codex["codex-balance-vid"]),
    },
  };

  const auryn = {
    id: d["auryn-id"],
    name: d["auryn-name"],
    icon: "/images/coins/AURYN.svg",
    iconBgColor: "bg-purple-50",
    balance: {
      display: fmt(d["auryn-balance"]),
      value: fmt(d["auryn-balance-hover"]),
    },
    balanceUsd: fmt(d["auryn-balance-vid"]),
    pricePerUnit: fmt(d["auryn-price"]),
    totalSupply: {
      display: fmt(d["auryn-supply"]),
      value: fmt(d["auryn-supply-hover"]),
    },
    supplyUsdValue: fmt(d["auryn-supply-vid"]),
    supplyLabel: "Auryn Supply",
    postSupplyRow: {
      label: "Ouroboros Supply",
      value: fmt(d["ouro-supply"]),
      hoverValue: fmt(d["ouro-supply-hover"]),
      usdValue: fmt(d["ouro-supply-vid"]),
      suffix: " Ѻ",
      suffixColor: "#7b4a1e",
    },
    virtual: null,
    info: "",
    currencySymbol: "₳",
    currencySymbolColor: "#d2d3d4",
    availableActions: ["Autostake (Coil)", "Recover (Uncoil)", "Transfer", "Bulk Transfer"],
    keepTransferNames: true,
    maxButtonsPerRow: 2,
    hideSupplySeparator: true,
  };

  const eauryn = {
    id: d["eauryn-id"],
    name: d["eauryn-name"],
    icon: "/images/coins/ELITE-AURYN.svg",
    iconBgColor: "bg-yellow-50",
    balance: {
      display: fmt(d["eauryn-balance"]),
      value: fmt(d["eauryn-balance-hover"]),
    },
    balanceUsd: fmt(d["eauryn-balance-vid"]),
    pricePerUnit: fmt(d["eauryn-price"]),
    totalSupply: {
      display: fmt(d["eauryn-supply"]),
      value: fmt(d["eauryn-supply-hover"]),
    },
    supplyUsdValue: fmt(d["eauryn-supply-vid"]),
    supplyLabel: "EliteAuryn Supply",
    virtual: null,
    info: "",
    currencySymbol: "Ξ₳",
    currencySymbolColor: "#ceac5f",
    availableActions: ["Clear Ouroboros Dispo", "Recover (Uncoil)", "Transfer", "Bulk Transfer"],
    keepTransferNames: true,
    notImplementedActions: [],
    maxButtonsPerRow: 2,
    hideSupplySeparator: true,
    extraBalanceRow: {
      label: "EA to Next Tier",
      value: fmt(d["eauryn-next"]),
      hoverValue: fmt(d["eauryn-next-hover"]),
      usdValue: fmt(d["eauryn-next-vid"]),
    },
  };

  const wstoa = {
    id: d["wstoa-id"],
    name: "WSTOA",
    icon: "/images/coins/WSTOA.svg",
    iconBgColor: "bg-primary/5",
    balance: {
      display: fmt(d["wstoa-wrapped-balance"]),
      value: fmt(d["wstoa-wrapped-balance-hover"]),
    },
    balanceUsd: fmt(d["wstoa-wrapped-balance-vid"]),
    pricePerUnit: fmt(d["wstoa-price"]),
    totalSupply: {
      display: fmt(d["wstoa-wrapped-total-supply"]),
      value: fmt(d["wstoa-wrapped-total-supply-hover"]),
    },
    supplyUsdValue: fmt(d["wstoa-wrapped-total-supply-vid"]),
    virtual: null,
    info: d["stoa-discount-text"] ?? "",
    currencySymbol: "\u2756",
    currencySymbolColor: "#ceac5f",
    displayName: "WrappedStoa",
    leadingBalanceRow: {
      label: "Native Balance",
      value: fmt(d["wstoa-native-balance"]),
      hoverValue: supplyHoverVal(d["wstoa-native-balance-hover"]),
      usdValue: fmt(d["wstoa-native-balance-vid"]),
      suffix: " \u2756",
      suffixColor: "#ceac5f",
    },
    balanceLabel: "Wrapped Balance",
    supplyLabel: "Total Wrapped Supply",
    hideSupplySeparator: true,
    keepTransferNames: true,
    availableActions: ["Coil", "Brumate", "Wrap", "Transfer", "Bulk Transfer", "Unwrap"],
  };

  const sstoa = {
    id: d["sstoa-id"],
    name: "SSTOA",
    icon: "/images/coins/SSTOA.svg",
    iconBgColor: "bg-primary/5",
    balance: {
      display: fmt(d["sstoa-balance"]),
      value: fmt(d["sstoa-balance-hover"]),
    },
    balanceUsd: fmt(d["sstoa-balance-vid"]),
    pricePerUnit: fmt(d["sstoa-price"]),
    totalSupply: {
      display: fmt(d["sstoa-supply"]),
      value: fmt(d["sstoa-supply-hover"]),
    },
    supplyUsdValue: fmt(d["sstoa-supply-vid"]),
    virtual: null,
    info: "",
    currencySymbol: "\u25C8",
    currencySymbolColor: "#e8e8e8",
    displayName: "SilverStoa",
    supplyLabel: "Total SilverStoa Supply",
    hideSupplySeparator: true,
    keepTransferNames: true,
    maxButtonsPerRow: 2,
    availableActions: ["Constrict", "Recover", "Transfer", "Bulk Transfer"],
    postSupplyRow: {
      label: "Total GoldenStoa Supply",
      value: fmt(d["gstoa-supply"]),
      hoverValue: fmt(d["gstoa-supply-hover"]),
      usdValue: fmt(d["gstoa-supply-vid"]),
      suffix: " \u25C8",
      suffixColor: "#ceac5f",
    },
  };

  const gstoa = {
    id: d["gstoa-id"],
    displayId: `${d["gstoa-id"] ?? "GSTOA"} | ${d["hgstoa-id"] ?? "H|GSTOA"}`,
    name: "GSTOA",
    icon: "/images/coins/SSTOA.svg",
    isGoldIcon: true,
    balance: {
      display: fmt(d["gstoa-balance"]),
      value: fmt(d["gstoa-balance-hover"]),
    },
    balanceUsd: fmt(d["gstoa-balance-vid"]),
    pricePerUnit: fmt(d["gstoa-price"]),
    totalSupply: {
      display: fmt(d["gstoa-supply"]),
      value: fmt(d["gstoa-supply-hover"]),
    },
    supplyUsdValue: fmt(d["gstoa-supply-vid"]),
    virtual: null,
    info: "",
    currencySymbol: "\u25C8",
    currencySymbolColor: "#ceac5f",
    displayName: "GoldenStoa",
    hideSupplySeparator: true,
    hideSupplyRow: true,
    middleBalanceRows: [
      {
        label: "Hibernated Balance (Nonces)",
        value: fmt(d["hgstoa-balance-nonces"]),
        hoverValue: d["hgstoa-balance-nonces-hover"] ?? undefined,
        usdValue: fmt(d["hgstoa-balance-nonces-vid"]),
        suffix: " \u25C8",
        suffixColor: "#ceac5f",
      },
      {
        label: "Total GoldenStoa",
        value: fmt(d["gstoa-total-balance"]),
        hoverValue: fmt(d["gstoa-total-balance-hover"]),
        usdValue: fmt(d["gstoa-total-balance-vid"]),
        suffix: " \u25C8",
        suffixColor: "#ceac5f",
      },
    ],
    availableActions: ["Recover", "Transfer", "Bulk Transfer", "Awake", "Slumber", "Transfer Nonces"],
    keepTransferNames: true,
    notImplementedActions: [],
  };

  const urstoa = {
    id: "URSTOA",
    displayId: "coin.UR|StoaTable",
    name: "UrStoa",
    icon: "/images/coins/WSTOA.svg",
    isStoneIcon: true,
    pricePerUnit: "—",
    balanceUsd: "—",
    balance: { display: "—", value: "0" },
    totalSupply: { display: "—", value: "0" },
    currencySymbol: "\u2726",
    currencySymbolColor: "#555555",
    hidePrice: true,
    hideSupplySeparator: true,
    textAlignTop: true,
    customBalanceRows: [
      {
        label: "Wrapped Balance",
        value: fmt(String(d["urstoa-wrapped-balance"] ?? 0)),
        suffix: " \u2726",
        suffixColor: "#555555",
      },
      {
        label: "Payment Key Balance",
        value: fmt(String(d["urstoa-payment-key-balance"] ?? 0)),
        suffix: " \u2726",
        suffixColor: "#555555",
      },
      {
        label: "UrStoa Vault Balance",
        value: fmt(String(d["urstoa-vault-balance"] ?? 0)),
        suffix: " \u2726",
        suffixColor: "#555555",
      },
      {
        label: "UrStoa Vault Earnings in STOA",
        value: fmt(d["urstoa-vault-earnings"]),
        hoverValue: fmt(String(d["urstoa-vault-earning-hover"] ?? 0)),
        suffix: " \u2756",
        suffixColor: "#ceac5f",
      },
      {
        label: "UrStoa Vault STOA Supply",
        value: fmt(d["urstoa-vault-stoa-supply"]),
        hoverValue: supplyHoverVal(d["urstoa-vault-stoa-supply-hover"]),
        suffix: " \u2756",
        suffixColor: "#ceac5f",
      },
    ],
    availableActions: ["Stake", "Unstake", "Wrap", "Collect", "Transfer", "Unwrap"],
    keepTransferNames: true,
    forceGoldActions: ["Transfer", "Stake", "Unstake", "Collect"],
    notImplementedActions: [],
    /** Wrapped UrStoa DPTF token ID (from primordials) */
    wrappedTokenId: d["urstoa-wrapped-id"] ?? null,
  };

  return {
    totalWithVirtual: formatEU(d["total-value-with-vouro"]),
    total: formatEU(d["total-value"]),
    tokens: [ouro, ignis, auryn, eauryn, wstoa, sstoa, gstoa, urstoa],
  };
};

export function buildPlaceholderPrimordials(): any {
  const Q = "???";
  const mkToken = (name: string, extra: object = {}) => ({
    id: Q,
    name,
    balance: { display: Q, value: Q },
    balanceUsd: Q,
    pricePerUnit: Q,
    totalSupply: { display: Q, value: Q },
    supplyUsdValue: Q,
    virtual: null,
    info: "",
    currencySymbol: "",
    availableActions: [],
    ...extra,
  });

  return {
    totalWithVirtual: Q,
    total: Q,
    tokens: [
      mkToken("Ouroboros", {
        icon: "/images/coins/OURO.svg",
        currencySymbol: "Ѻ",
        currencySymbolColor: "#7b4a1e",
        virtual: { display: Q, value: Q, inUsd: Q },
        availableActions: ["Sublimate", "Coil", "Curl", "Transfer", "Bulk Transfer"],
        keepTransferNames: true,
        balanceLabel: "Balance",
        virtualLabel: "Virtual Balance",
        supplyLabel: "Dispo Capacity",
      }),
      mkToken("Ignis", {
        icon: "/images/coins/Ignis.svg",
        currencySymbol: "Ω",
        currencySymbolColor: "#cc2200",
        showCodexRow: true,
        codexBalance: { display: Q, value: Q, inUsd: Q },
        availableActions: ["Compress", "Firestarter", "Transfer", "Bulk Transfer"],
        keepTransferNames: true,
        maxButtonsPerRow: 2,
        supplyLabel: "Ouronet Total GAS",
      }),
      mkToken("Auryn", {
        icon: "/images/coins/AURYN.svg",
        currencySymbol: "₳",
        hideSupplySeparator: true,
        availableActions: ["Autostake (Coil)", "Recover (Uncoil)", "Transfer", "Bulk Transfer"],
        keepTransferNames: true,
        maxButtonsPerRow: 2,
      }),
      mkToken("EliteAuryn", {
        icon: "/images/coins/ELITE-AURYN.svg",
        currencySymbol: "Ξ₳",
        currencySymbolColor: "#ceac5f",
        hideSupplySeparator: true,
        hideSupplyRow: true,
        extraBalanceRow: { label: "EA to Next Tier", value: Q, usdValue: Q },
        availableActions: ["Clear Ouroboros Dispo", "Recover (Uncoil)", "Transfer", "Bulk Transfer"],
        keepTransferNames: true,
        notImplementedActions: [],
        maxButtonsPerRow: 2,
      }),
      mkToken("WSTOA", {
        icon: "/images/coins/WSTOA.svg",
        currencySymbol: "\u2756",
        currencySymbolColor: "#ceac5f",
        displayName: "WrappedStoa",
        leadingBalanceRow: { label: "Native Balance", value: Q, usdValue: Q },
        balanceLabel: "Wrapped Balance",
        supplyLabel: "Total Wrapped Supply",
        hideSupplySeparator: true,
        keepTransferNames: true,
        availableActions: ["Coil", "Brumate", "Wrap", "Transfer", "Bulk Transfer", "Unwrap"],
      }),
      mkToken("SSTOA", {
        icon: "/images/coins/SSTOA.svg",
        currencySymbol: "\u25C8",
        currencySymbolColor: "#e8e8e8",
        displayName: "SilverStoa",
        supplyLabel: "Total SilverStoa Supply",
        hideSupplySeparator: true,
        keepTransferNames: true,
        maxButtonsPerRow: 2,
        availableActions: ["Constrict", "Recover", "Transfer", "Bulk Transfer"],
      }),
      {
        id: Q,
        displayId: `${Q} | ${Q}`,
        name: "GSTOA",
        icon: "/images/coins/SSTOA.svg",
        isGoldIcon: true,
        balance: { display: Q, value: Q },
        balanceUsd: Q,
        pricePerUnit: Q,
        totalSupply: { display: Q, value: Q },
        supplyUsdValue: Q,
        virtual: null,
        info: "",
        currencySymbol: "\u25C8",
        currencySymbolColor: "#ceac5f",
        displayName: "GoldenStoa",
        hideSupplySeparator: true,
        hideSupplyRow: true,
        middleBalanceRows: [
          { label: "Hibernated Balance (Nonces)", value: Q, usdValue: Q },
          { label: "Total GoldenStoa", value: Q, usdValue: Q },
        ],
        availableActions: ["Recover", "Transfer", "Bulk Transfer", "Awake", "Slumber", "Transfer Nonces"],
        keepTransferNames: true,
        notImplementedActions: [],
      },
      {
        id: "URSTOA",
        displayId: "coin.UR|StoaTable",
        name: "UrStoa",
        icon: "/images/coins/WSTOA.svg",
        isStoneIcon: true,
        pricePerUnit: "—",
        balanceUsd: "—",
        balance: { display: "—", value: "0" },
        totalSupply: { display: "—", value: "0" },
        currencySymbol: "\u2726",
        currencySymbolColor: "#555555",
        hidePrice: true,
        hideSupplySeparator: true,
        textAlignTop: true,
        customBalanceRows: [
          { label: "Payment Key Balance", value: Q },
          { label: "UrStoa Vault Balance", value: Q },
          { label: "UrStoa Vault Earnings in STOA", value: Q },
          { label: "UrStoa Vault STOA Supply", value: Q },
        ],
        availableActions: ["Stake", "Unstake", "Collect", "Transfer"],
        keepTransferNames: true,
        notImplementedActions: ["Transfer"],
      },
    ],
  };
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

// Ouro to Ignis
// (namespace.T201-C2.ORBR|C_Sublimate client target ouro-amount)
export async function sublimateOuroToIgnis(
  ouroAccount: IOuroAccountKeypair,
  kadenaAccount: IKadenaKeypair,
  guard: IKadenaKeypair,
  targetAccount: string,
  ouroAmount: string
) {
  const keysetName = `ks`;
  
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(ouroAmount);
  
  let gasLimit = 2_000_000; // Default gas limit
  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.ORBR|C_Sublimate "${ouroAccount.address}" "${targetAccount}" ${decimalAmount})`)
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

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));
 
  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "OURO to IGNIS sublimation",
      simulation.result,
      `Amount: ${decimalAmount} OURO → Target: ${targetAccount}`
    );
    logDetailedError(error);
    throw error;
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  try {
    const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guard),
  ]);

    // Submit the signed transaction
    const result = await submit(signedTransaction);

    return result;
  } catch (originalError) {
    const error = createSigningError(
      "OURO to IGNIS sublimation",
      originalError,
      `Signers: ${kadenaAccount.publicKey.slice(0, 8)}... (payer), ${guard.publicKey.slice(0, 8)}... (guard)`
    );
    logDetailedError(error);
    throw error;
  }
}

// Ignis to Ouro is mainly the same as sublimateOuroToIgnis but has no target
// ORBR|C_Compress:decimal (client:string ignis-amount:decimal)
export async function compressIgnisToOuro(
  ouroAccount: IOuroAccountKeypair,
  kadenaAccount: IKadenaKeypair,
  guard: IKadenaKeypair,
  ignisAmount: string
) {
  const keysetName = `ks`;
  
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(ignisAmount);
  
  let gasLimit = 2_000_000; // Default gas limit
  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.ORBR|C_Compress "${ouroAccount.address}" ${decimalAmount})`)
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

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guard),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}

// Wrap Kadena
// (defun LQD|C_WrapStoa (patron:string wrapper:string amount:decimal))
// patron is current ouro account public key | wrapper by default is the same but can also be a different ouro account public key amount should be decimal
// as keys we need to use the ouro account kadena_ledger that has the capability coin.TRANSFER and the value of the amount. GAS_STATION
export async function wrapKadena(
  patronAccount: IOuroAccountKeypair,
  wrapperAccount: string, // Ouro address that will receive the wrapped KDA
  kadenaAccount: IKadenaKeypair, // The kadena account that will transfer KDA
  guardAccount: IKadenaKeypair, // The guard account from the Ouro account
  amount: string
) {
  const keysetName = `ks`;
  
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(amount);
  
  let gasLimit = 2_000_000; // Default gas limit for wrap operation
  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.LQD|C_WrapStoa "${patronAccount.address}" "${wrapperAccount}" ${decimalAmount})`)
      .addData(keysetName, {
        keys: [guardAccount.publicKey],
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
        withCapability(
          "coin.TRANSFER",
          `k:${kadenaAccount.publicKey}`,
          NATIVE_TOKEN_VAULT,
          { decimal: decimalAmount }
        ),
      ])
      .addSigner(guardAccount.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guardAccount),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}

// unwrap Kadena
// (ouronet-ns.TS01-C2.LQD|C_UnwrapStoa patron unwrapper amount)
export async function unwrapKadena(
  patronAccount: IOuroAccountKeypair, // Ouro account that owns the WSTOA
  unwrapperAccount: string, // Ouro address that will receive the unwrapped KDA
  kadenaAccount: IKadenaKeypair, // The kadena account (payer)
  guardAccount: IKadenaKeypair, // The guard account from the Ouro account
  amount: string
) {
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(amount);
  
  let gasLimit = 2_000_000; // Default gas limit for unwrap operation
  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.LQD|C_UnwrapStoa "${patronAccount.address}" "${unwrapperAccount}" ${decimalAmount})`)
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
        withCapability(
          "coin.TRANSFER",
          NATIVE_TOKEN_VAULT,
          `k:${kadenaAccount.publicKey}`,
          { decimal: decimalAmount }
        ),
      ])
      .addSigner(guardAccount.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guardAccount),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}

// Get IGNIS generation preview for sublimation
// (namespace.OUROBOROS.URC_Sublimate ouro-amount)
export async function getSublimatPreview(
  ouroAmount: string
): Promise<{ ignis: number; fee: number } | null> {
  try {
    const decimalAmount = formatDecimalForPact(ouroAmount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.OUROBOROS.URC_Sublimate (at 0 (${KADENA_NAMESPACE}.U|ATS.UC_PromilleSplit 10.0 ${decimalAmount} 24)))`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    const data = response.result.data as any;    
    return {
      ignis: data,
      fee: 0,
    };
  } catch (error) {
    console.error("Error getting sublimate preview:", error);
    return null;
  }
}

// getCompressPreview 
// (at 0 (ouronet-ns.OUROBOROS.URC_Compress ignis-amount))
export async function getCompressPreview(
  ignisAmount: string
): Promise<{ ouro: number; fee: number } | null> {
  try {
    const decimalAmount = formatDecimalForPact(ignisAmount);
    
    const response = await pactRead(`(at 0 (${KADENA_NAMESPACE}.OUROBOROS.URC_Compress ${decimalAmount}))`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    const data = response.result.data as any;
    if (!data?.decimal) {
      return null;
    }
    
    return {
      ouro: parseFloat(data.decimal),
      fee: 0,
    };
  } catch (error) {
    console.error("Error getting compress preview:", error);
    return null;
  }
}

// Single Token Transfer
// (namespace.TS01-C1.DPTF|C_Transfer patron id sender receiver transfer-amount method)
export async function transferToken(
  patronAccount: IOuroAccountKeypair, // The patron account (owner)
  tokenId: string, // Token ID
  senderAccount: string, // Sender Ouro address (usually same as patron)
  receiverAccount: string, // Receiver Ouro address
  transferAmount: string, // Amount to transfer
  method: boolean, // false for standard accounts, true for smart accounts
  kadenaAccount: IKadenaKeypair, // The kadena account (payer)
  guardAccount: IKadenaKeypair // The guard account from the Ouro account
) {
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(transferAmount);
  
  let gasLimit = 2_000_000; // Default gas limit for transfer operation
  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C1.DPTF|C_Transfer "${patronAccount.address}" "${tokenId}" "${senderAccount}" "${receiverAccount}" ${decimalAmount} ${method})`)
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
      .addSigner(guardAccount.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // First do a simulation to check gas
  let transaction = buildTransaction();
  let simulation = await dirtyRead(transaction);
  

  // Check if simulation failed due to gas limit exceeded
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "";
    
    // Check if it's a gas limit exceeded error
    if (errorMessage.includes("Gas limit") && errorMessage.includes("exceeded")) {
      // Extract the required gas from error message or use a higher limit
      const gasMatch = errorMessage.match(/exceeded:\s*(\d+)/);
      if (gasMatch) {
        const requiredGas = parseInt(gasMatch[1]);
        gasLimit = calculateAutoGasLimit(requiredGas); // 20% buffer
        
        // Rebuild and retry simulation with higher gas limit
        transaction = buildTransaction(gasLimit);
        simulation = await dirtyRead(transaction);
        
      } else {
        // If we can't extract exact gas, increase by 50%
        gasLimit = Math.ceil(gasLimit * 1.5);
        
        transaction = buildTransaction(gasLimit);
        simulation = await dirtyRead(transaction);
      }
    }
    
    // If still failing after retry, throw error
    if (simulation.result.status === "failure") {
      const finalErrorMessage = simulation.result.error?.message || "Transaction simulation failed";
      throw new Error(`Simulation failed: ${finalErrorMessage}`);
    }
  }

  // Check if we need to adjust gas limit further (normal case)
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guardAccount),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}

// (ouronet-ns.MB.URC_TotalMBCost sparks)
export async function getTotalMBCost(sparks: number): Promise<string | null> {
  try {
    const integerSparks = Math.floor(sparks);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.MB.URC_TotalMBCost ${integerSparks})`, { tier: "T5" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return (response.result.data as any);
  } catch (error) {
    console.error("Error getting total MB cost:", error);
    return null;
  }
}

// (ouronet-ns.MB.C_MovieBoosterBuyer patron:string buyer:string mb-amount:integer iz-native:bool)
export async function movieBoosterBuy(
  patronAccount: IOuroAccountKeypair, // The patron account (owner)
  buyerAccount: string, // Buyer Ouro address (usually same as patron)
  mbAmount: number, // Amount of SPARK tokens to buy (integer)
  isNative: boolean, // true for KDA, false for WSTOA
  kadenaAccount: IKadenaKeypair, // The kadena account (payer)
  guardAccount: IKadenaKeypair // The guard account from the Ouro account
) {
  const keysetName = `ks`;
  
  // Ensure amount is integer
  const integerAmount = Math.floor(mbAmount);
  const kadenaCost = await getTotalMBCost(integerAmount);
  
  let gasLimit = 2_000_000; // Default gas limit for movie booster buy
  
  const buildTransaction = (gasLimitOverride?: number) => {
    const txBuilder = Pact.builder
      .execution(`(${KADENA_NAMESPACE}.MB.C_MovieBoosterBuyer "${patronAccount.address}" "${buyerAccount}" ${integerAmount} ${isNative})`)
      .addData(keysetName, {
        keys: [guardAccount.publicKey],
        pred: "keys-all",
      })
      .setMeta({
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimitOverride || gasLimit,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(kadenaAccount.publicKey, (withCapability: any) => {
        const capabilities: any[] = [
          withCapability(
            `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
            "",
            { int: 0 },
            { decimal: "0.0" },
          ),
        ];
        
        // If paying with native KDA, add coin.TRANSFER capability
        if (isNative) {
          // We'll need to calculate the KDA amount based on SPARK price
          // For now, we'll use a placeholder that will be replaced after simulation
          capabilities.push(
            withCapability(
              "coin.TRANSFER",
              `k:${kadenaAccount.publicKey}`,
              GAS_STATION,
              { decimal: `${kadenaCost}` } // This will be updated after simulation
            )
          );
        }
        
        return capabilities;
      })
      .addSigner(guardAccount.publicKey);
      
    return txBuilder.createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // First do a simulation to check gas and get the actual KDA amount if native
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  if (isNative && simulation.result.data) {

    if (kadenaCost && parseFloat(kadenaCost) <= 0) {
      throw new Error("Invalid KDA amount required for purchase");
    }
    
    // Rebuild transaction with correct KDA amount
    transaction = Pact.builder
      .execution(`(${KADENA_NAMESPACE}.MB.C_MovieBoosterBuyer "${patronAccount.address}" "${buyerAccount}" ${integerAmount} ${isNative})`)
      .addData(keysetName, {
        keys: [guardAccount.publicKey],
        pred: "keys-all",
      })
      .setMeta({
        senderAccount: GAS_STATION,
        creationTime: safeCreationTime(),
        chainId: KADENA_CHAIN_ID,
        gasLimit: gasLimit,
      })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(kadenaAccount.publicKey, (withCapability: any) => [
        withCapability(
          `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
          "",
          { int: 0 },
          { decimal: "0.0" },
        ),
        withCapability(
          "coin.TRANSFER",
          `k:${kadenaAccount.publicKey}`,
          GAS_STATION,
          { decimal: `${kadenaCost}` }
        ),
      ])
      .addSigner(guardAccount.publicKey)
      .createTransaction();
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guardAccount),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}

export async function getMaxBuyMovieBooster(
  account: string,
  native: boolean
): Promise<number> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.MB.URC_GetMaxBuy "${account}" ${native})`, { tier: "T5" });

    if (!response || !response.result || response.result.status === "failure") {
      return 0;
    }

    const data = response.result.data as any;
    return data?.int || 0;
  } catch (error) {
    console.error("Error getting max buy for movie booster:", error);
    return 0;
  }
}


export async function getSparksBalance(account: string): Promise<any> {
  try {
    const response = await pactRead(`(${KADENA_NAMESPACE}.MB.UR_Sparks "${account}")`, { tier: "T5" });

    if (!response || !response.result || response.result.status === "failure") {
      return null;
    }

    return response.result.data as any;
  } catch (error) {
    console.error("Error getting sparks balance:", error);
    return null;
  }
} 

// (ouronet-ns.TS01-C2.SWP|C_Firestarter ouro-account:string)
export async function firestarter(
  ouroAccount: IOuroAccountKeypair, // Ouro account that will receive the IGNIS
  kadenaAccount: IKadenaKeypair, // The kadena account that will transfer KDA
  guardAccount: IKadenaKeypair // The guard account from the Ouro account
) {
  const keysetName = `ks`;
  
  // Fixed amount of 10 KDA
  const kdaAmount = "10.0";
  
  let gasLimit = 2_000_000; // Default gas limit for firestarter operation
  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C3.SWP|C_Firestarter "${ouroAccount.address}")`)
      .addData(keysetName, {
        keys: [guardAccount.publicKey],
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
        withCapability(
          "coin.TRANSFER",
          `k:${kadenaAccount.publicKey}`,
          GAS_STATION,
          { decimal: kdaAmount }
        ),
      ])
      .addSigner(guardAccount.publicKey)
      .createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guardAccount),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}


// Get AURYN generation preview for coiling OURO
export async function getCoilPreview(
  ouroAmount: string
): Promise<{
  auryn: number;
  fee: number;
  kadenaInfo: {
    text: string;
    discount: number;
    full: number;
    need: number;
  };
  ignisInfo: {
    text: string;
    discount: number;
    full: number;
    need: number;
  };
  preText: string[];
  postText: string[];
} | null> {
  try {
    const decimalAmount = formatDecimalForPact(ouroAmount);
    
    const response = await pactRead(`(${KADENA_NAMESPACE}.INFO-ONE.ATS|INFO_Coil "preview" "preview" "Auryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" ${decimalAmount})`, { tier: "T2" });

    if (!response || !response.result || response.result.status === "failure") {
      console.log("Coil preview failed:", response?.result);
      return null;
    }

    const data = response.result.data as any;
    console.log("Coil preview response data:", data);
    
    // Extract AURYN amount from text arrays
    let aurynAmount = 0;
    
    // Check pre-text array for AURYN amount
    if (data && data['pre-text']) {
      for (const text of data['pre-text']) {
        const aurynMatch = text.match(/generates\s+([\d.]+)\s+AURYN/);
        if (aurynMatch) {
          aurynAmount = parseFloat(aurynMatch[1]);
          break;
        }
      }
    }
    
    // Fallback: check post-text array
    if (!aurynAmount && data && data['post-text']) {
      for (const text of data['post-text']) {
        const aurynMatch = text.match(/generating\s+([\d.]+)\s+AURYN/);
        if (aurynMatch) {
          aurynAmount = parseFloat(aurynMatch[1]);
          break;
        }
      }
    }
    
    // Return rich data structure
    return {
      auryn: aurynAmount,
      fee: 0,
      kadenaInfo: {
        text: data?.kadena?.[`kadena-text`] || "Kadena fee information not available",
        discount: data?.kadena?.[`kadena-discount`] || 1,
        full: data?.kadena?.[`kadena-full`] || 0,
        need: data?.kadena?.[`kadena-need`] || 0,
      },
      ignisInfo: {
        text: data?.ignis?.[`ignis-text`] || "IGNIS fee information not available",
        discount: data?.ignis?.[`ignis-discount`] || 1,
        full: data?.ignis?.[`ignis-full`] || 0,
        need: data?.ignis?.[`ignis-need`] || 0,
      },
      preText: data?.[`pre-text`] || [],
      postText: data?.[`post-text`] || [],
    };
  } catch (error) {
    console.error("Error getting coil preview:", error);
    return null;
  }
}

// Curl OURO to Elite AURYN
// (namespace.TS01-C2.ATS|C_Curl patron:string curler:string "Auryndex-O136CBn22ncY" "EliteAuryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" amount:decimal)
export async function curlOuroToEliteAuryn(
  ouroAccount: IOuroAccountKeypair,
  kadenaAccount: IKadenaKeypair,
  guard: IKadenaKeypair,
  targetAccount: string, // The account that will receive the Elite AURYN (same as patron per client explanation)
  ouroAmount: string
) {
  const keysetName = `ks`;
  
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(ouroAmount);
  
  let gasLimit = 2_000_000; // Default gas limit

  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Curl "${ouroAccount.address}" "${targetAccount}" "Auryndex-O136CBn22ncY" "EliteAuryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" ${decimalAmount})`)
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

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));
 
  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guard),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}

// Export new coiling functions for AURYN and WSTOA
export {
  getAurynCoilPreview,
  coilAurynToElite,
  getWkdaCoilPreview,
  coilWkdaToLkda,
  COIL_CONFIGS
} from "./coilFunctions";

// Export pension functions for WSTOA and SSTOA
export {
  brumateWkdaToPkda,
  constrictLkdaToPkda
} from "./pensionFunctions";

// Export INFO-ONE preview functions
export {
  getTransferPreview,
  getCoilPreviewInfo,
  getCurlPreviewInfo,
  getBrumatePreviewInfo,
  getConstrictPreviewInfo,
  parseTransferPreview,
  type TransferPreviewData
} from "./infoOneFunctions";

// Coil OURO to AURYN
// (namespace.TS01-C2.ATS|C_Coil patron:string coiler:string "Auryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" amount:decimal)
export async function coilOuroToAuryn(
  ouroAccount: IOuroAccountKeypair,
  kadenaAccount: IKadenaKeypair,
  guard: IKadenaKeypair,
  targetAccount: string, // The account that will receive the AURYN
  ouroAmount: string
) {
  const keysetName = `ks`;
  
  // Ensure amount is formatted as decimal
  const decimalAmount = formatDecimalForPact(ouroAmount);
  
  let gasLimit = 2_000_000; // Default gas limit

  
  const buildTransaction = (gasLimitOverride?: number) => {
    return Pact.builder
      .execution(`(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Coil "${ouroAccount.address}" "${targetAccount}" "Auryndex-O136CBn22ncY" "OURO-8Nh-JO8JO4F5" ${decimalAmount})`)
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

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));
 
  // First do a simulation to check gas
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);
  

  // Check if simulation failed
  if (simulation.result.status === "failure") {
    const errorMessage = simulation.result.error?.message || "Transaction simulation failed";
    throw new Error(`Simulation failed: ${errorMessage}`);
  }

  // Check if we need to adjust gas limit
  const requiredGas = simulation.gas;
  if (requiredGas && requiredGas > gasLimit) {
    // Rebuild transaction with adjusted gas limit (20% buffer)
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // Sign the transaction with both keypairs
  const signedTransaction: any = await universalSignTransaction(transaction, [
    fromKeypair(kadenaAccount),
    fromKeypair(guard),
  ]);

  // Submit the signed transaction
  const result = await submit(signedTransaction);

  return result;
}



/**
 * Fetch STOA price in USD from on-chain oracle.
 * Pact: (namespace.U|CT.UR|KDA-PID)
 * Returns a decimal (currently hardcoded at 1.0 on-chain).
 */
/**
 * Get IGNIS (GAS) balance for an Ouronet account.
 * Uses DPTF.UR_AccountSupply with the IGNIS token ID.
 */
import { TOKEN_ID_IGNIS } from "../constants";
export const IGNIS_TOKEN_ID = TOKEN_ID_IGNIS;

export async function getIgnisBalance(account: string): Promise<string> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPTF.UR_AccountSupply "${IGNIS_TOKEN_ID}" "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (response?.result?.status === "success") {
      return String(mayComeWithDeimal((response.result as any).data));
    }
    return "0";
  } catch {
    return "0";
  }
}

/**
 * Fetch DPTF token balance for any account via DPTF.UR_AccountSupply
 * (ouronet-ns.DPTF.UR_AccountSupply <token-id> <account>)
 */
export async function getAccountTokenSupply(tokenId: string, account: string): Promise<string> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPTF.UR_AccountSupply "${tokenId}" "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (response?.result?.status === "success") {
      return String(mayComeWithDeimal((response.result as any).data));
    }
    return "0";
  } catch {
    return "0";
  }
}

/**
 * Fetch OURO dispo capacity for an account via DALOS.UR_DISPOSupply
 */
export async function getOuroDispoCapacity(account: string): Promise<string> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DALOS.UR_DISPOSupply "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });

    if (response?.result?.status === "success") {
      return String(mayComeWithDeimal((response.result as any).data));
    }
    return "0";
  } catch {
    return "0";
  }
}

/**
 * Fetch Virtual OURO balance for an account
 * (ouronet-ns.TFT.URC_VirtualOuro <account>)
 */
export async function getVirtualOuro(account: string): Promise<string> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.TFT.URC_VirtualOuro "${account}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") {
      return String(mayComeWithDeimal((response.result as any).data));
    }
    return "0";
  } catch {
    return "0";
  }
}

/**
 * Query RotateKadena info object from the chain.
 * (ouronet-ns.INFO-ZERO.DALOS-INFO|URC_RotateKadena <patron> <account>)
 */
export async function getRotateKadenaInfo(
  patron: string,
  account: string
): Promise<any | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ZERO.DALOS-INFO|URC_RotateKadena "${patron}" "${account}")`;
    const response = await pactRead(pactCode, { tier: "T3" });

    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting RotateKadena info:", error);
    return null;
  }
}

/**
 * Rotate Payment Key (Kadena Ledger) for an Ouronet account.
 * (ouronet-ns.TS01-C1.DALOS|C_RotateKadena patron account newPaymentKey)
 *
 * Requires two signers:
 * 1. patronKadenaKey — key from patron's guard (pays IGNIS, has GAS_PAYER cap)
 * 2. accountGuardKey — key from the target account's guard (ownership proof)
 *
 * If patron == account, these may be the same key, requiring only 1 signer.
 */
export async function rotateKadenaPaymentKey(
  patronAddress: string,
  accountAddress: string,
  newPaymentKey: string,
  gasStationKey: IKadenaKeypair,
  patronGuardKeys: IKadenaKeypair[],
  accountGuardKeys: IKadenaKeypair[],
  patronGuard: IKeyset | null,
  accountGuard: IKeyset | null,
) {
  let gasLimit = 2_000_000;

  // Collect all unique signers: gasStation + patronGuard + accountGuard
  const allSigners: IKadenaKeypair[] = [gasStationKey];
  const addedPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [...patronGuardKeys, ...accountGuardKeys]) {
    if (!addedPubs.has(k.publicKey)) {
      allSigners.push(k);
      addedPubs.add(k.publicKey);
    }
  }

  const buildTransaction = (gasLimitOverride?: number) => {
    let builder = Pact.builder
      .execution(
        `(${KADENA_NAMESPACE}.TS01-C1.DALOS|C_RotateKadena "${patronAddress}" "${accountAddress}" "${newPaymentKey}")`
      );

    // Add keyset data for patron guard
    if (patronGuard) {
      builder = builder.addData("ks", {
        keys: patronGuard.keys,
        pred: patronGuard.pred,
      });
    }

    // Add keyset data for account guard (if different from patron)
    if (accountGuard && accountAddress !== patronAddress) {
      builder = builder.addData("ks-account", {
        keys: accountGuard.keys,
        pred: accountGuard.pred,
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
      // Gas Station key: GAS_PAYER capability (SEPARATE from guard keys)
      .addSigner(gasStationKey.publicKey, (withCapability: any) => [
        withCapability(
          `${KADENA_NAMESPACE}.DALOS.GAS_PAYER`,
          "",
          { int: 0 },
          { decimal: "0.0" }
        ),
      ]);

    // Patron guard signers — pure signing (ownership)
    const addedSignerPubs = new Set<string>([gasStationKey.publicKey]);
    for (const k of patronGuardKeys) {
      if (!addedSignerPubs.has(k.publicKey)) {
        builder = builder.addSigner(k.publicKey);
        addedSignerPubs.add(k.publicKey);
      }
    }

    // Account guard signers — pure signing (ownership)
    for (const k of accountGuardKeys) {
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
      "Rotate Payment Key",
      simulation.result,
      `Patron: ${patronAddress} | Account: ${accountAddress} | New Key: ${newPaymentKey}`
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

export async function getStoaPriceUSD(options?: { skipTempWatcher?: boolean }): Promise<number> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.U|CT.UR|KDA-PID)`;
    const response = await pactRead(pactCode, { tier: "T6", skipTempWatcher: options?.skipTempWatcher });

    if (response?.result?.status === "success") {
      return Number(mayComeWithDeimal((response.result as any).data)) || 1.0;
    }
    return 1.0;
  } catch {
    return 1.0;
  }
}

/**
 * Resolve the target Kadena address for an Ouronet unwrapper account.
 * (ouronet-ns.DALOS.UR_AccountKadena <unwrapper>)
 */
export async function getUnwrapStoaTarget(unwrapper: string): Promise<string | null> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DALOS.UR_AccountKadena "${unwrapper}")`;
    const response = await pactRead(pactCode, { tier: "T5" });
    if (response?.result?.status === "success") {
      return String((response.result as any).data);
    }
    return null;
  } catch (error) {
    console.error("Error resolving UnwrapStoa target:", error);
    return null;
  }
}

/**
 * Check if a coin account exists.
 * (try false (coin.get-balance <address>))
 * Returns: true = exists, false = doesn't exist, null = error
 */
export async function checkCoinAccountExists(address: string): Promise<boolean | null> {
  try {
    const pactCode = `(try false (coin.get-balance "${address}"))`;
    const response = await pactRead(pactCode, { tier: "T3" });
    const data = (response?.result as any)?.data;
    if (data === false || data === "false") return false;
    if (typeof data === "number" || (data && typeof data === "object" && "decimal" in data)) return true;
    return false;
  } catch (error) {
    console.error("Error checking coin account:", error);
    return null;
  }
}

/**
 * Get INFO for UnwrapStoa function.
 * (ouronet-ns.INFO-ONE.LIQUID|INFO_UnwrapStoa <patron> <unwrapper> <amount:decimal>)
 */
export async function getDPTFIssueInfo(
  patron: string,
  resident: string,
  tokens: string[]
): Promise<any | null> {
  try {
    const tokenList = tokens.map(t => `"${t}"`).join(" ");
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.DPTF|INFO_Issue "${patron}" "${resident}" [${tokenList}])`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") return (response.result as any).data;
    return null;
  } catch { return null; }
}

export async function getSublimateInfo(
  patron: string,
  resident: string,
  amount: string
): Promise<any | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.ORBR|INFO_Sublimate "${patron}" "${resident}" ${decimalAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") return (response.result as any).data;
    return null;
  } catch { return null; }
}

export async function getCompressInfo(
  client: string,
  amount: string
): Promise<any | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.ORBR|INFO_Compress "${client}" ${decimalAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") return (response.result as any).data;
    return null;
  } catch { return null; }
}

export async function getUnwrapStoaInfo(
  patron: string,
  unwrapper: string,
  amount: string
): Promise<any | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.LIQUID|INFO_UnwrapStoa "${patron}" "${unwrapper}" ${decimalAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting UnwrapStoa info:", error);
    return null;
  }
}

// ─── executeUnwrapStoa ────────────────────────────────────────────────────────
// Handles both execution cases for UnwrapStoa:
//   Case 2 — target exists → simple unwrap
//   Case 1 — target is new k: account → create account + unwrap
// Adaptive gas: simulate first, then rebuild with calculateAutoGasLimit.

export interface UnwrapStoaParams {
  patronAddress: string;
  unwrapperAddress: string;
  amount: string;          // pre-formatted decimal string (formatDecimalForPact)
  numAmount: number;       // numeric value (for coin.TRANSFER capability param)
  targetAddress: string;
  targetExists: boolean;   // true = Case 2, false = Case 1 (new k: creation)
  gasStationKey: IKadenaKeypair;
  patronGuardKeys: IKadenaKeypair[];
  accountGuardKeys: IKadenaKeypair[];
}

export async function executeUnwrapStoa(params: UnwrapStoaParams): Promise<any> {
  const {
    patronAddress, unwrapperAddress, amount, numAmount,
    targetAddress, targetExists,
    gasStationKey, patronGuardKeys, accountGuardKeys,
  } = params;

  // All unique signers (gas station first, then guard keys de-duped)
  const allSigners: IKadenaKeypair[] = [gasStationKey];
  const addedPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [...patronGuardKeys, ...accountGuardKeys]) {
    if (!addedPubs.has(k.publicKey)) { allSigners.push(k); addedPubs.add(k.publicKey); }
  }

  let gasLimit = 2_000_000;

  const buildTransaction = (gasLimitOverride?: number) => {
    const effectiveGasLimit = gasLimitOverride ?? gasLimit;

    let builder = targetExists
      // Case 2 — target exists: simple unwrap
      ? Pact.builder.execution(
          `(${KADENA_NAMESPACE}.TS01-C2.LQD|C_UnwrapStoa "${patronAddress}" "${unwrapperAddress}" ${amount})`
        )
      // Case 1 — new k: account: create + unwrap
      : Pact.builder
          .execution(
            `(namespace "${KADENA_NAMESPACE}")\n` +
            `(IGNIS.C_Collect "${patronAddress}" (IGNIS.UDC_CustomCodeCumulator))\n` +
            `(let\n` +
            `  (\n` +
            `    (wp:string "${unwrapperAddress}")\n` +
            `    (target:string (DALOS.UR_AccountKadena wp))\n` +
            `  )\n` +
            `  [\n` +
            `    (coin.C_CreateAccount target (read-keyset "ks"))\n` +
            `    (TS01-C2.LQD|C_UnwrapStoa "${patronAddress}" "${unwrapperAddress}" ${amount})\n` +
            `  ]\n` +
            `)`
          )
          .addData("ks", {
            keys: [targetAddress.slice(2)], // k:<pubkey> → strip "k:"
            pred: "keys-all",
          });

    builder = builder
      .setMeta({ senderAccount: GAS_STATION, chainId: KADENA_CHAIN_ID, creationTime: safeCreationTime(),
        gasLimit: effectiveGasLimit })
      .setNetworkId(KADENA_NETWORK)
      // Gas Station: GAS_PAYER + coin.TRANSFER
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
        w("coin.TRANSFER", NATIVE_TOKEN_VAULT, targetAddress, { decimal: String(numAmount) }),
      ]);

    // Patron + account guard keys: pure signers
    const addedSignerPubs = new Set<string>([gasStationKey.publicKey]);
    for (const k of [...patronGuardKeys, ...accountGuardKeys]) {
      if (!addedSignerPubs.has(k.publicKey)) {
        builder = (builder as any).addSigner(k.publicKey);
        addedSignerPubs.add(k.publicKey);
      }
    }

    return builder.createTransaction();
  };

  const { dirtyRead, submit } = createClient(getPactUrl(KADENA_CHAIN_ID));

  // 1. Simulate with 2M (network max)
  let transaction = buildTransaction();
  const simulation = await dirtyRead(transaction);

  if (simulation.result.status === "failure") {
    const error = createSimulationError(
      "Unwrap STOA",
      simulation.result,
      `Patron: ${patronAddress} | Unwrapper: ${unwrapperAddress} | Target: ${targetAddress} | Amount: ${amount}`
    );
    logDetailedError(error);
    throw error;
  }

  // 2. Adaptive gas: rebuild with calibrated limit
  const requiredGas = simulation.gas;
  if (requiredGas) {
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  // 3. Sign & submit
  const signed: any = await universalSignTransaction(
    transaction,
    allSigners.map((s) => fromKeypair(s)),
  );

  return await submit(signed);
}

/**
 * Fetch the minimum transfer amount for a DPTF token.
 * (ouronet-ns.DPTF.UR_MinMove <token-id>) → decimal
 */
export async function getDPTFMinMove(tokenId: string): Promise<number> {
  try {
    const pactCode = `(${KADENA_NAMESPACE}.DPTF.UR_MinMove "${tokenId}")`;
    const response = await pactRead(pactCode, { tier: "T7" });
    if (response?.result?.status === "success") {
      return parseFloat(String(mayComeWithDeimal((response.result as any).data))) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

// ─── Unwrap UrStoa ────────────────────────────────────────────────────────────

/**
 * Check if an account exists in the UrStoa table.
 * (if (= (typeof (try false (coin.UR_UR|Balance "<address>"))) "bool") false true)
 */
export async function checkUrStoaAccountExists(address: string): Promise<boolean | null> {
  try {
    const pactCode = `(if (= (typeof (try false (coin.UR_UR|Balance "${address}"))) "bool") false true)`;
    const response = await pactRead(pactCode, { tier: "T3" });
    const data = (response?.result as any)?.data;
    if (data === true) return true;
    if (data === false) return false;
    return null;
  } catch (error) {
    console.error("Error checking UrStoa account:", error);
    return null;
  }
}

/**
 * Get INFO for UnwrapUrStoa function.
 * (ouronet-ns.INFO-ONE.LIQUID|INFO_UnwrapUrStoa <patron> <wrapper> <amount:decimal>)
 */
export async function getUnwrapUrStoaInfo(
  patron: string,
  wrapper: string,
  amount: string,
): Promise<any | null> {
  try {
    const decimalAmount = formatDecimalForPact(amount);
    const pactCode = `(${KADENA_NAMESPACE}.INFO-ONE.LIQUID|INFO_UnwrapUrStoa "${patron}" "${wrapper}" ${decimalAmount})`;
    const response = await pactRead(pactCode, { tier: "T2" });
    if (response?.result?.status === "success") {
      return (response.result as any).data;
    }
    return null;
  } catch (error) {
    console.error("Error getting UnwrapUrStoa info:", error);
    return null;
  }
}

// ─── executeUnwrapUrStoa ──────────────────────────────────────────────────────
// Handles both cases:
//   target exists → simple unwrap via C_UnwrapUrStoa
//   target new k: → create UrStoa account + unwrap

export interface UnwrapUrStoaParams {
  patronAddress: string;
  unwrapperAddress: string;
  amount: string;
  targetAddress: string;
  targetExists: boolean;
  gasStationKey: IKadenaKeypair;
  patronGuardKeys: IKadenaKeypair[];
  accountGuardKeys: IKadenaKeypair[];
}

export async function executeUnwrapUrStoa(params: UnwrapUrStoaParams): Promise<any> {
  const {
    patronAddress, unwrapperAddress, amount,
    targetAddress, targetExists,
    gasStationKey, patronGuardKeys, accountGuardKeys,
  } = params;

  const allSigners: IKadenaKeypair[] = [gasStationKey];
  const addedPubs = new Set<string>([gasStationKey.publicKey]);
  for (const k of [...patronGuardKeys, ...accountGuardKeys]) {
    if (!addedPubs.has(k.publicKey)) { allSigners.push(k); addedPubs.add(k.publicKey); }
  }

  let gasLimit = 2_000_000;

  const buildTransaction = (gasLimitOverride?: number) => {
    const effectiveGasLimit = gasLimitOverride ?? gasLimit;

    let builder = targetExists
      ? Pact.builder.execution(
          `(${KADENA_NAMESPACE}.TS01-C2.LQD|C_UnwrapUrStoa "${patronAddress}" "${unwrapperAddress}" ${amount})`
        )
      : Pact.builder
          .execution(
            `(namespace "${KADENA_NAMESPACE}")\n` +
            `(IGNIS.C_Collect "${patronAddress}" (IGNIS.UDC_CustomCodeCumulator))\n` +
            `(let\n` +
            `  (\n` +
            `    (wp:string "${unwrapperAddress}")\n` +
            `    (target:string (DALOS.UR_AccountKadena wp))\n` +
            `  )\n` +
            `  [\n` +
            `    (coin.C_UR|CreateAccount target (read-keyset "ks"))\n` +
            `    (TS01-C2.LQD|C_UnwrapUrStoa "${patronAddress}" "${unwrapperAddress}" ${amount})\n` +
            `  ]\n` +
            `)`
          )
          .addData("ks", {
            keys: [targetAddress.slice(2)],
            pred: "keys-all",
          });

    builder = builder
      .setMeta({ senderAccount: GAS_STATION, chainId: KADENA_CHAIN_ID, creationTime: safeCreationTime(),
        gasLimit: effectiveGasLimit })
      .setNetworkId(KADENA_NETWORK)
      .addSigner(gasStationKey.publicKey, (w: any) => [
        w(`${KADENA_NAMESPACE}.DALOS.GAS_PAYER`, "", { int: 0 }, { decimal: "0.0" }),
      ]);

    const addedSignerPubs = new Set<string>([gasStationKey.publicKey]);
    for (const k of [...patronGuardKeys, ...accountGuardKeys]) {
      if (!addedSignerPubs.has(k.publicKey)) {
        builder = (builder as any).addSigner(k.publicKey);
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
      "Unwrap UrStoa",
      simulation.result,
      `Patron: ${patronAddress} | Unwrapper: ${unwrapperAddress} | Target: ${targetAddress} | Amount: ${amount}`
    );
    logDetailedError(error);
    throw error;
  }

  const requiredGas = simulation.gas;
  if (requiredGas) {
    gasLimit = calculateAutoGasLimit(requiredGas);
    transaction = buildTransaction(gasLimit);
  }

  const signed: any = await universalSignTransaction(
    transaction,
    allSigners.map((s) => fromKeypair(s)),
  );

  return await submit(signed);
}
