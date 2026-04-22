/**
 * KadenaWallet — runtime account object with a lazy-fetched balance.
 *
 * Minimal data bag + a `getBalance()` that hits the chain via
 * `interactions/kadenaFunctions.getBalance`. Browser and server consume it
 * identically. Constructed from an HD-derived publicKey + derivation
 * metadata; `address` is always `k:<publicKey>`.
 *
 * Purity note: the constructor is synchronous and allocation-only — no
 * network, no cache, no React — so instantiation works in any environment.
 * The `getBalance()` method is the only side-effect and it's opt-in.
 */

import { getBalance } from "../interactions/kadenaFunctions";

class KadenaWallet {
  public parentId: string;
  public index: number;
  public secret: string;
  public address: string;
  public publicKey: string;
  public derivationPath: string;
  public balance: string;

  constructor({
    parentId,
    index,
    secret,
    publicKey,
    derivationPath,
  }: {
    parentId: string;
    index: number;
    secret: string;
    publicKey: string;
    derivationPath: string;
  }) {
    this.parentId = parentId;
    this.index = index;
    this.secret = secret;
    this.address = `k:${publicKey}`;
    this.publicKey = publicKey;
    this.derivationPath = derivationPath;
    this.balance = "0";
  }

  /** Fetch the current balance from chain and update this.balance. */
  async getBalance(): Promise<string> {
    const balance = await getBalance(this.address);
    this.balance = balance.balance ?? "0";
    return this.balance;
  }
}

export default KadenaWallet;
