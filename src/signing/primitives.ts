/**
 * Signing primitives — pure public-key derivation.
 *
 * These functions are PHASE-1 TEMPORARY COPIES of the originals that still
 * live in OuronetUI at src/lib/universalSign.ts. They were duplicated here
 * so guardUtils.ts could be extracted to core without depending back into
 * OuronetUI. Phase 3 of the extraction plan consolidates — universalSign.ts
 * moves to core wholesale and this file becomes its canonical home.
 *
 * Do not add new functions here before Phase 3 unless they're in the
 * universalSign.ts originals. Keep these two implementations byte-identical
 * to their OuronetUI counterparts so both sides produce the same output for
 * the same input.
 */

import { restoreKeyPairFromSecretKey, binToHex } from "@kadena/cryptography-utils";
import { ed25519 } from "@noble/curves/ed25519";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2)
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  return bytes;
}

function bytesToNumberLE(bytes: Uint8Array): bigint {
  let r = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) r = r * 256n + BigInt(bytes[i]);
  return r;
}

/**
 * Derive public key from a 64-char standard Ed25519 seed (pact -g / Koala).
 */
export function publicKeyFromPrivateKey(privateKeyHex: string): string {
  return restoreKeyPairFromSecretKey(privateKeyHex).publicKey;
}

/**
 * Derive public key from a 128-char BIP32-Ed25519 foreign key [kL(32)|kR(32)].
 * Used ONLY for manually-entered foreign keys in KadenaKeys format.
 * NOT for chainweaver seed-derived keys (use kadenaSign for those).
 */
export function publicKeyFromExtendedKey(kLHex: string): string {
  const kL = hexToBytes(kLHex.slice(0, 64));
  const n = ed25519.CURVE.n;
  const point = ed25519.ExtendedPoint.BASE.multiply(bytesToNumberLE(kL) % n);
  return binToHex(point.toRawBytes());
}
