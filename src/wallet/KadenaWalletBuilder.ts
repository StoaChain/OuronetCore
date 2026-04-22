/**
 * KadenaWalletBuilder — HD keypair derivation + mnemonic generation + the
 * inner AES-GCM encrypt/decrypt provided by @kadena/hd-wallet's own scheme
 * (distinct from the outer Codex encryption handled by core/crypto).
 *
 * Two derivation paths, picked by SeedType:
 *   - koala:      24-word BIP39 → kadenaMnemonicToSeed → kadenaGenKeypairFromSeed.
 *                 Output: standard 32-byte Ed25519 secretKey hex (usable by nacl).
 *   - chainweaver / eckowallet:
 *                 12-word Kadena mnemonic → kadenaMnemonicToRootKeypair →
 *                 kadenaGenKeypair. Output: an EncryptedString extended
 *                 secretKey; signing uses kadenaSign (WASM) with password
 *                 + that encrypted blob. DO NOT attempt to decrypt and
 *                 reuse the hex — Chainweaver's format isn't standard
 *                 BIP32-Ed25519 and the library owns the key lifecycle.
 *
 * Portability note: every call here is pure crypto — no React, no browser
 * globals, WebCrypto (@kadena/hd-wallet dependency) available in Node 20+.
 * Consumers instantiate the same way in both runtimes.
 */

import {
  EncryptedString,
  kadenaDecrypt,
  kadenaEncrypt,
  kadenaGenKeypairFromSeed,
  kadenaMnemonicToSeed,
} from "@kadena/hd-wallet";
import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import {
  kadenaCheckMnemonic,
  kadenaMnemonicToRootKeypair,
  kadenaGenMnemonic,
  kadenaGenKeypair,
} from "@kadena/hd-wallet/chainweaver";
import type { SeedType } from "./types";

class KadenaWalletBuilder {
  /** Standard SLIP-10 derivation from a pre-existing encrypted seed blob. */
  static async createWalletPair(
    password: string,
    seed: EncryptedString,
    index: number,
  ) {
    const wallet = await kadenaGenKeypairFromSeed(password, seed, index);
    return wallet;
  }

  /**
   * Derive a keypair directly from a mnemonic. Routes by seedType:
   *   - chainweaver / eckowallet → 12-word validation + BIP32-Ed25519
   *   - koala (default)          → 24-word BIP39 + SLIP-10 Ed25519
   * Throws on mismatched mnemonic length / checksum for the selected type.
   */
  static async createWalletPairFromMnemonic(
    password: string,
    mnemonic: string,
    index: number,
    seedType: SeedType = "koala",
  ) {
    switch (seedType) {
      case "chainweaver":
      case "eckowallet": {
        if (!kadenaCheckMnemonic(mnemonic)) {
          throw new Error("Invalid 12-word Chainweaver mnemonic.");
        }
        const chainweaverSeed = await kadenaMnemonicToRootKeypair(
          password,
          mnemonic,
        );
        const wallet = await kadenaGenKeypair(password, chainweaverSeed, index);
        return {
          publicKey: wallet.publicKey,
          secretKey: wallet.secretKey,
        };
      }
      case "koala":
      default: {
        if (!bip39.validateMnemonic(mnemonic, wordlist)) {
          throw new Error("Invalid 24-word BIP39 mnemonic.");
        }
        const standardSeed = await kadenaMnemonicToSeed(password, mnemonic);
        const [publicKey, secretKey] = await kadenaGenKeypairFromSeed(
          password,
          standardSeed,
          index,
        );
        return { publicKey, secretKey };
      }
    }
  }

  /** @kadena/hd-wallet's AES-GCM wrapper — used for per-seed encrypted blobs. */
  static async encrypt(
    password: string,
    data: string,
  ): Promise<EncryptedString> {
    return await kadenaEncrypt(password, data);
  }

  static async decrypt(
    password: string,
    encryptedData: EncryptedString,
  ): Promise<Uint8Array> {
    return await kadenaDecrypt(password, encryptedData);
  }

  /** Generate a fresh mnemonic of the requested length (12 or 24 words). */
  static async generateMnemonic(length: 12 | 24): Promise<string> {
    if (length === 12) {
      return kadenaGenMnemonic();
    }
    if (length === 24) {
      return bip39.generateMnemonic(wordlist, 256);
    }
    throw new Error("Invalid mnemonic length. Use 12 or 24.");
  }

  /**
   * Validate a mnemonic. If seedType is given, checks against that derivation
   * family's word-count and checksum. Without seedType, falls back to a
   * word-count-based dispatch (12 → Chainweaver, 24 → BIP39).
   */
  static async isValidMnemonic(mnemonic: string, seedType?: SeedType): Promise<boolean> {
    if (seedType) {
      switch (seedType) {
        case "chainweaver":
        case "eckowallet":
          return kadenaCheckMnemonic(mnemonic);
        case "koala":
        default:
          return bip39.validateMnemonic(mnemonic, wordlist);
      }
    }

    const words = mnemonic.trim().split(/\s+/);
    const mnemonicLength = words.length;

    if (mnemonicLength !== 12 && mnemonicLength !== 24) {
      return false;
    }
    if (mnemonicLength === 12) {
      return kadenaCheckMnemonic(mnemonic);
    }
    return bip39.validateMnemonic(mnemonic, wordlist);
  }
}

export default KadenaWalletBuilder;
