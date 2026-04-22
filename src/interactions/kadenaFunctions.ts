import { KADENA_CHAIN_ID, KADENA_NETWORK, PACT_URL } from "../constants";
import { Pact, createClient } from "@kadena/client";

export interface BalanceItem {
  account: string;
  balance: string;
}

export async function getBalance(account: string): Promise<BalanceItem> {
  const transaction = Pact.builder
    .execution((Pact.modules as any).coin["get-balance"](account))
    .setMeta({ senderAccount: account, chainId: KADENA_CHAIN_ID })
    .setNetworkId(KADENA_NETWORK)
    .createTransaction();

  const { dirtyRead } = createClient(PACT_URL);

  const response = await dirtyRead(transaction);

  const raw = (response.result as any).data;
  // Kadena may return { decimal: "..." } — unwrap to plain string
  const balance = raw && typeof raw === "object" && "decimal" in raw
    ? String(raw.decimal)
    : String(raw ?? "0");

  return { account, balance };
}

export async function accountDescription(address: string) {
  const transaction = Pact.builder
    .execution((Pact.modules as any).coin.details(address))
    .setMeta({ senderAccount: address, chainId: KADENA_CHAIN_ID })
    .setNetworkId(KADENA_NETWORK)
    .createTransaction();

  const { dirtyRead } = createClient(PACT_URL);

  const { result }: any = await dirtyRead(transaction);

  return {
    isNewAccount: result?.status === "failure",
    balance: result?.data?.balance || "0",
    account: result?.data?.account || address,
    guard: result?.data?.guard || null,
  };
}
