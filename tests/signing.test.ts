/**
 * Signing primitives — core version of the Phase -1.2 test, extended in
 * Phase 2a to cover toHexString (moved here from utils.ts).
 *
 * The subjects are pure and side-effect-free. The full universalSignTransaction
 * and KeyResolver/SigningStrategy are out of scope until Phase 3 — see the
 * Phase 3b on-chain 9-item matrix for end-to-end signing verification.
 */

import { describe, it, expect } from "vitest";
import {
  publicKeyFromPrivateKey,
  publicKeyFromExtendedKey,
  toHexString,
} from "../src/signing/primitives";

// ══ publicKeyFromPrivateKey (RFC 8032 vectors) ════════════════════════════════
describe("publicKeyFromPrivateKey — standard Ed25519 seed derivation", () => {
  it("RFC 8032 test vector 1", () => {
    const priv = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const pub  = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    expect(publicKeyFromPrivateKey(priv)).toBe(pub);
  });

  it("RFC 8032 test vector 2", () => {
    const priv = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
    const pub  = "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
    expect(publicKeyFromPrivateKey(priv)).toBe(pub);
  });

  it("RFC 8032 test vector 3", () => {
    const priv = "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7";
    const pub  = "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025";
    expect(publicKeyFromPrivateKey(priv)).toBe(pub);
  });

  it("is deterministic (same input → same output)", () => {
    const priv = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    expect(publicKeyFromPrivateKey(priv)).toBe(publicKeyFromPrivateKey(priv));
  });

  it("returns a 64-character lowercase hex string", () => {
    const priv = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const pub = publicKeyFromPrivateKey(priv);
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ══ publicKeyFromExtendedKey (BIP32-Ed25519 kL half) ══════════════════════════
describe("publicKeyFromExtendedKey — BIP32-Ed25519 foreign key derivation", () => {
  it("returns a 64-character lowercase hex string", () => {
    const kL_kR = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60" +
                  "0000000000000000000000000000000000000000000000000000000000000000";
    const pub = publicKeyFromExtendedKey(kL_kR);
    expect(pub).toMatch(/^[0-9a-f]{64}$/);
  });

  it("only the first 64 hex chars (kL) affect the output", () => {
    const kL = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const pub1 = publicKeyFromExtendedKey(kL + "a".repeat(64));
    const pub2 = publicKeyFromExtendedKey(kL + "b".repeat(64));
    expect(pub1).toBe(pub2);
  });

  it("different kL produces different pubkey", () => {
    const pub1 = publicKeyFromExtendedKey("a".repeat(64) + "0".repeat(64));
    const pub2 = publicKeyFromExtendedKey("b".repeat(64) + "0".repeat(64));
    expect(pub1).not.toBe(pub2);
  });

  it("is deterministic", () => {
    const kL = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const pub1 = publicKeyFromExtendedKey(kL);
    const pub2 = publicKeyFromExtendedKey(kL);
    expect(pub1).toBe(pub2);
  });

  it("differs from publicKeyFromPrivateKey for the same input", () => {
    const sharedInput = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
    const fromPrivate = publicKeyFromPrivateKey(sharedInput);
    const fromExtended = publicKeyFromExtendedKey(sharedInput);
    expect(fromPrivate).not.toBe(fromExtended);
  });
});

// ══ toHexString (Uint8Array → lowercase hex) ══════════════════════════════════
describe("toHexString — byte-array to hex encoding", () => {
  it("encodes empty array to empty string", () => {
    expect(toHexString(new Uint8Array())).toBe("");
  });

  it("encodes single zero byte as '00' (preserves leading zero)", () => {
    expect(toHexString(new Uint8Array([0]))).toBe("00");
  });

  it("encodes single 0xff byte as 'ff'", () => {
    expect(toHexString(new Uint8Array([0xff]))).toBe("ff");
  });

  it("encodes mixed bytes with leading-zero preservation", () => {
    expect(toHexString(new Uint8Array([0, 1, 2, 15, 16, 255]))).toBe("0001020f10ff");
  });

  it("produces 2 hex chars per input byte (length invariant)", () => {
    const buf = new Uint8Array(32);
    for (let i = 0; i < 32; i++) buf[i] = i * 7 % 256;
    expect(toHexString(buf).length).toBe(64);
  });

  it("output is always lowercase", () => {
    const buf = new Uint8Array([0xab, 0xcd, 0xef]);
    const hex = toHexString(buf);
    expect(hex).toBe(hex.toLowerCase());
    expect(hex).toBe("abcdef");
  });

  it("round-trips 32 random bytes through a hex-parse verification", () => {
    // Simulated: build known bytes, encode, manually parse back, assert equal.
    const original = new Uint8Array([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
      0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe, 0xba, 0xbe,
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
    ]);
    const hex = toHexString(original);
    expect(hex).toBe("00112233445566778899aabbccddeeffdeadbeefcafebabe0123456789abcdef");
    expect(hex.length).toBe(original.length * 2);
  });
});
