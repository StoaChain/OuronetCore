/**
 * OuronetCore ↔ DALOS integration tests.
 *
 * Verifies that the `./dalos` subpath:
 *   - Re-exports the registry surface cleanly
 *   - `createOuronetAccount` dispatches to the right primitive method
 *     for each of the six modes
 *   - The primitive's output reaches `createOuronetAccount`'s caller
 *     unchanged (byte-identity via DalosGenesis is already proven at
 *     the dalos-crypto package level)
 *
 * These are thin-adapter tests — the heavy cryptographic assertions
 * live in dalos-crypto's own suite (268 tests, all green).
 */

import { describe, expect, it } from "vitest";
import {
  createDefaultRegistry,
  createOuronetAccount,
  DalosGenesis,
  parseAsciiBitmap,
  type CryptographicRegistry,
} from "../src/dalos/index.js";

const registry: CryptographicRegistry = createDefaultRegistry();

describe("dalos subpath — re-exports", () => {
  it("exposes DalosGenesis identity", () => {
    expect(DalosGenesis.id).toBe("dalos-gen-1");
    expect(DalosGenesis.generation).toBe("genesis");
  });

  it("exposes a default registry with DalosGenesis pre-registered", () => {
    expect(registry.default()).toBe(DalosGenesis);
    expect(registry.has("dalos-gen-1")).toBe(true);
  });
});

describe("createOuronetAccount — dispatches to primitive", () => {
  it("mode=random produces a well-formed Genesis account", () => {
    const k = createOuronetAccount(registry, { mode: "random" });
    expect(k.standardAddress.startsWith("Ѻ.")).toBe(true);
    expect(k.smartAddress.startsWith("Σ.")).toBe(true);
    expect(k.keyPair.priv.length).toBeGreaterThan(0);
    expect(k.keyPair.publ).toContain(".");
  });

  it("mode=bitString reproduces from a fixed 1600-bit input", () => {
    const bits = "1".repeat(1600);
    const k1 = createOuronetAccount(registry, { mode: "bitString", data: bits });
    const k2 = createOuronetAccount(registry, { mode: "bitString", data: bits });
    expect(k1.keyPair.publ).toBe(k2.keyPair.publ);
    expect(k1.standardAddress).toBe(k2.standardAddress);
  });

  it("mode=seedWords reproduces the same account from the same words", () => {
    const words = ["hello", "world", "dalos", "genesis"];
    const k1 = createOuronetAccount(registry, { mode: "seedWords", data: words });
    const k2 = createOuronetAccount(registry, { mode: "seedWords", data: words });
    expect(k1.keyPair.publ).toBe(k2.keyPair.publ);
  });

  it("mode=bitmap dispatches to DalosGenesis.generateFromBitmap", () => {
    // 40×40 all-white bitmap — represents all-zero bit input
    const rows = Array(40).fill(".".repeat(40));
    const bmp = parseAsciiBitmap(rows);
    const k = createOuronetAccount(registry, { mode: "bitmap", data: bmp });
    expect(k.standardAddress.startsWith("Ѻ.")).toBe(true);
    expect(k.privateKey.bitString).toBe("0".repeat(1600));
  });

  it("mode=integerBase10 round-trips with mode=integerBase49", () => {
    // First mint a random account to get a valid priv_int10 / priv_int49
    const base = createOuronetAccount(registry, { mode: "random" });

    // Recompute from int10
    const fromInt10 = createOuronetAccount(registry, {
      mode: "integerBase10",
      data: base.privateKey.int10,
    });
    expect(fromInt10.keyPair.publ).toBe(base.keyPair.publ);

    // Recompute from int49
    const fromInt49 = createOuronetAccount(registry, {
      mode: "integerBase49",
      data: base.privateKey.int49,
    });
    expect(fromInt49.keyPair.publ).toBe(base.keyPair.publ);
  });

  it("throws when primitiveId is not registered", () => {
    expect(() =>
      createOuronetAccount(registry, {
        mode: "random",
        primitiveId: "nonexistent",
      }),
    ).toThrow(/not registered/);
  });
});

describe("createOuronetAccount — end-to-end account lifecycle", () => {
  it("mint → detect via registry → sign → verify", () => {
    // 1. Mint
    const account = createOuronetAccount(registry, { mode: "random" });

    // 2. Given only the address, the registry finds the right primitive
    const primitive = registry.detect(account.standardAddress);
    expect(primitive).toBe(DalosGenesis);

    // 3. Sign via the detected primitive
    const message = "approve tx abc-123";
    const sig = primitive!.sign!(account.keyPair, message);
    expect(sig.length).toBeGreaterThan(0);

    // 4. Verify
    expect(primitive!.verify!(sig, message, account.keyPair.publ)).toBe(true);
    expect(primitive!.verify!(sig, "tampered message", account.keyPair.publ)).toBe(false);
  });
});
