/**
 * universalSignTransaction + shape helpers — the core of local-Codex signing.
 *
 * Same logic as OuronetUI's src/lib/universalSign.ts. Phase 3 of the extraction
 * plan will collapse the duplicate and introduce KeyResolver + SigningStrategy
 * abstractions; for Phase 2b this file is a TEMP duplicate so the Pact builder
 * functions (executeCoil, executeCurl, etc.) in `../interactions/` can call
 * `universalSignTransaction` without reaching back into OuronetUI.
 *
 * Routing rules (unchanged from the OuronetUI original):
 *   - Koala seed (64-char secretKey, no encryptedSecretKey)   → nacl Ed25519
 *   - Chainweaver / Ecko (encryptedSecretKey + password)      → kadenaSign WASM
 *   - Foreign 64-char raw pact -g key                         → nacl Ed25519
 *
 * The `onMissingKey` callback covers foreign-key signing — if a signer pubkey
 * in the tx isn't in the supplied keypairs, this callback resolves it to a raw
 * private key. OuronetUI implements it via `ForeignKeySignModal`; the HUB will
 * implement it via whatever its admin flow dictates (throw / allow-list /
 * terminal prompt / HSM fetch).
 */

import { createSignWithKeypair, addSignatures } from "@kadena/client";
import { base64UrlDecodeArr, binToHex } from "@kadena/cryptography-utils";
import { kadenaSign } from "@kadena/hd-wallet/chainweaver";
import type { IUnsignedCommand, ICommand } from "@kadena/types";
import { publicKeyFromPrivateKey } from "./primitives";

/**
 * Universal keypair shape — one of:
 *   - 64-char secretKey + seedType "koala"   → standard Ed25519 (nacl)
 *   - 64-char secretKey + seedType "foreign" → standard Ed25519 (nacl)
 *   - encryptedSecretKey + password + seedType "chainweaver"/"eckowallet" → WASM
 *
 * `password` and `encryptedSecretKey` are ONLY used for the chainweaver/eckowallet
 * path; they must survive the `@stoachain/ouronet-core` boundary for that path
 * to work.
 */
export interface UniversalKeypair {
  publicKey?: string;
  secretKey: string;
  seedType?: "koala" | "chainweaver" | "eckowallet" | "foreign";
  encryptedSecretKey?: any;
  password?: string;
}

/**
 * Normalize a loosely-shaped keypair record into a UniversalKeypair.
 * Accepts either `secretKey` or `privateKey` for the private component.
 */
export function fromKeypair(kp: {
  publicKey?: string;
  privateKey?: string;
  secretKey?: string;
  seedType?: string;
  encryptedSecretKey?: any;
  password?: string;
}): UniversalKeypair {
  return {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey ?? kp.privateKey ?? "",
    seedType: kp.seedType as UniversalKeypair["seedType"],
    encryptedSecretKey: kp.encryptedSecretKey,
    password: kp.password,
  };
}

/**
 * Sign a Pact transaction by routing each keypair through the algorithm its
 * `seedType` demands. Returns the tx with signatures attached (always an
 * `ICommand` in practice, though the union with `IUnsignedCommand` preserves
 * the `@kadena/client` type contract).
 *
 * If `onMissingKey` is supplied and a signer pubkey in the tx isn't in
 * `keypairs`, it's invoked to resolve the missing key just-in-time.
 */
export async function universalSignTransaction(
  transaction: IUnsignedCommand,
  keypairs: UniversalKeypair[],
  onMissingKey?: (pubKey: string) => Promise<string>,
): Promise<IUnsignedCommand | ICommand> {
  const cmdPayload = JSON.parse(transaction.cmd);
  const signerPubKeys: string[] =
    cmdPayload.signers?.map((s: any) => s.pubKey) ?? [];

  const naclPairs: { publicKey: string; secretKey: string }[] = [];
  const chainweaverPairs: UniversalKeypair[] = [];
  const handledPubKeys = new Set<string>();

  for (const kp of keypairs) {
    const pubKey = kp.publicKey ?? "";
    if (!signerPubKeys.includes(pubKey)) continue;
    handledPubKeys.add(pubKey);

    const isChainweaver =
      (kp.seedType === "chainweaver" || kp.seedType === "eckowallet") &&
      !!kp.encryptedSecretKey &&
      !!kp.password;

    if (isChainweaver) {
      chainweaverPairs.push(kp);
    } else {
      naclPairs.push({ publicKey: pubKey, secretKey: kp.secretKey });
    }
  }

  // Foreign-key flow — paste-at-sign-time resolution for signer pubkeys we
  // don't already hold in the Codex. Consumers supply the collection UX.
  if (onMissingKey) {
    for (const pubKey of signerPubKeys) {
      if (handledPubKeys.has(pubKey)) continue;
      const rawKey = await onMissingKey(pubKey);
      const derivedPubKey = publicKeyFromPrivateKey(rawKey);
      if (derivedPubKey !== pubKey) {
        throw new Error(
          `Key mismatch.\nExpected: ${pubKey}\nDerived:  ${derivedPubKey}`,
        );
      }
      naclPairs.push({ publicKey: pubKey, secretKey: rawKey });
      handledPubKeys.add(pubKey);
    }
  }

  let signed: IUnsignedCommand | ICommand = transaction;

  if (naclPairs.length > 0) {
    const signWithKeypair = createSignWithKeypair(naclPairs);
    signed = await signWithKeypair(signed as IUnsignedCommand);
  }

  // Chainweaver/Ecko path — NEVER roll custom BIP32 math; the hd-wallet
  // library owns the extended-key format.
  for (const kp of chainweaverPairs) {
    const hashBytes = base64UrlDecodeArr(
      (signed as IUnsignedCommand).hash,
    ) as unknown as Uint8Array;
    const sigBuf = await kadenaSign(
      kp.password!,
      hashBytes as any,
      kp.encryptedSecretKey,
    );
    const sigHex = binToHex(new Uint8Array(sigBuf));
    signed = addSignatures(signed as IUnsignedCommand, {
      sig: sigHex,
      pubKey: kp.publicKey!,
    });
  }

  return signed;
}
