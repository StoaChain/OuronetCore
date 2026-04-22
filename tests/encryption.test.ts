/**
 * Encryption round-trip + smartDecrypt format-detection tests.
 *
 * Originally lived in OuronetUI as `src/lib/__tests__/encryption.test.ts`.
 * Moved here in Phase 4 when the primitives moved to
 * `@stoachain/ouronet-core/crypto` — this is now where the tests belong.
 *
 * V1 parameters:  PBKDF2-SHA256 / 10,000 iterations / AES-GCM-256
 * V2 parameters:  PBKDF2-SHA512 / 600,000 iterations / AES-GCM-256
 * Envelope:       btoa(JSON.stringify({ [v: 2,] ciphertext, iv, salt }))
 *
 * smartDecrypt auto-detects by `v` field. smartEncrypt is pure — it takes
 * `schemaVersion: string | null` directly instead of reading localStorage
 * (the localStorage read lives in OuronetUI's `smart-encrypt-browser.ts`).
 */

import { describe, it, expect } from "vitest";
import { encryptString, decryptString } from "../src/crypto/v1";
import {
  encryptStringV2,
  decryptStringV2,
  smartDecrypt,
  smartEncrypt,
  isEncryptedV2,
  allEncryptedV2,
  isCodexUpgraded,
} from "../src/crypto/v2";

const PASSWORD = "correct-horse-battery-staple";
const WRONG_PASSWORD = "wrong-horse-battery-staple";
const PLAINTEXT = "the quick brown fox jumps over the lazy dog";
const LONG_PLAINTEXT = "x".repeat(10_000);
const UNICODE_PLAINTEXT = "🔐 Ouroboros ™ ⚔ СтоаЧейн 区块链";

// Parse the btoa(JSON(...)) envelope to inspect shape without decrypting.
function parseEnvelope(enc: string): Record<string, unknown> {
  return JSON.parse(atob(enc));
}

describe("crypto/v1 — legacy format", () => {
  describe("round-trip", () => {
    it("decrypts what it encrypts with the right password", async () => {
      const enc = await encryptString(PLAINTEXT, PASSWORD);
      const dec = await decryptString(enc, PASSWORD);
      expect(dec).toBe(PLAINTEXT);
    });

    it("round-trips unicode text", async () => {
      const enc = await encryptString(UNICODE_PLAINTEXT, PASSWORD);
      const dec = await decryptString(enc, PASSWORD);
      expect(dec).toBe(UNICODE_PLAINTEXT);
    });

    it("round-trips large text (10k chars)", async () => {
      const enc = await encryptString(LONG_PLAINTEXT, PASSWORD);
      const dec = await decryptString(enc, PASSWORD);
      expect(dec).toBe(LONG_PLAINTEXT);
    });

    it("produces different ciphertext each call (fresh salt + IV)", async () => {
      const enc1 = await encryptString(PLAINTEXT, PASSWORD);
      const enc2 = await encryptString(PLAINTEXT, PASSWORD);
      expect(enc1).not.toBe(enc2);
      expect(await decryptString(enc1, PASSWORD)).toBe(PLAINTEXT);
      expect(await decryptString(enc2, PASSWORD)).toBe(PLAINTEXT);
    });
  });

  describe("wrong password", () => {
    it("throws on wrong password (AES-GCM auth tag fails)", async () => {
      const enc = await encryptString(PLAINTEXT, PASSWORD);
      await expect(decryptString(enc, WRONG_PASSWORD)).rejects.toThrow();
    });

    it("throws on corrupted ciphertext", async () => {
      const enc = await encryptString(PLAINTEXT, PASSWORD);
      const parsed = parseEnvelope(enc);
      const ct = parsed.ciphertext as string;
      parsed.ciphertext = ct.slice(0, 5) + (ct[5] === "A" ? "B" : "A") + ct.slice(6);
      const corrupted = btoa(JSON.stringify(parsed));
      await expect(decryptString(corrupted, PASSWORD)).rejects.toThrow();
    });
  });

  describe("envelope shape", () => {
    it("writes V1 envelope (no `v` field)", async () => {
      const enc = await encryptString(PLAINTEXT, PASSWORD);
      const parsed = parseEnvelope(enc);
      expect(parsed).toHaveProperty("ciphertext");
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("salt");
      expect(parsed).not.toHaveProperty("v");
    });
  });
});

describe("crypto/v2 — current format", () => {
  describe("round-trip", () => {
    it("decrypts what it encrypts with the right password", async () => {
      const enc = await encryptStringV2(PLAINTEXT, PASSWORD);
      const dec = await decryptStringV2(enc, PASSWORD);
      expect(dec).toBe(PLAINTEXT);
    });

    it("round-trips unicode text", async () => {
      const enc = await encryptStringV2(UNICODE_PLAINTEXT, PASSWORD);
      const dec = await decryptStringV2(enc, PASSWORD);
      expect(dec).toBe(UNICODE_PLAINTEXT);
    });

    it("round-trips large text (10k chars)", async () => {
      const enc = await encryptStringV2(LONG_PLAINTEXT, PASSWORD);
      const dec = await decryptStringV2(enc, PASSWORD);
      expect(dec).toBe(LONG_PLAINTEXT);
    });

    it("produces different ciphertext each call (fresh salt + IV)", async () => {
      const enc1 = await encryptStringV2(PLAINTEXT, PASSWORD);
      const enc2 = await encryptStringV2(PLAINTEXT, PASSWORD);
      expect(enc1).not.toBe(enc2);
      expect(await decryptStringV2(enc1, PASSWORD)).toBe(PLAINTEXT);
      expect(await decryptStringV2(enc2, PASSWORD)).toBe(PLAINTEXT);
    });
  });

  describe("wrong password", () => {
    it("throws on wrong password", async () => {
      const enc = await encryptStringV2(PLAINTEXT, PASSWORD);
      await expect(decryptStringV2(enc, WRONG_PASSWORD)).rejects.toThrow();
    });
  });

  describe("envelope shape", () => {
    it("writes V2 envelope with `v: 2`", async () => {
      const enc = await encryptStringV2(PLAINTEXT, PASSWORD);
      const parsed = parseEnvelope(enc);
      expect(parsed).toHaveProperty("v", 2);
      expect(parsed).toHaveProperty("ciphertext");
      expect(parsed).toHaveProperty("iv");
      expect(parsed).toHaveProperty("salt");
    });
  });

  describe("V1 fallback inside decryptStringV2", () => {
    it("can decrypt V1-format ciphertext (same AES-GCM family, different KDF params)", async () => {
      // Belt-and-suspenders: if something calls decryptStringV2 on a V1
      // envelope, it falls through to V1 decode params (SHA-256 + 10k).
      const encV1 = await encryptString(PLAINTEXT, PASSWORD);
      const dec   = await decryptStringV2(encV1, PASSWORD);
      expect(dec).toBe(PLAINTEXT);
    });
  });
});

describe("isEncryptedV2 / allEncryptedV2", () => {
  it("isEncryptedV2 detects V2 envelopes", async () => {
    const encV2 = await encryptStringV2(PLAINTEXT, PASSWORD);
    expect(isEncryptedV2(encV2)).toBe(true);
  });

  it("isEncryptedV2 rejects V1 envelopes (no `v` field)", async () => {
    const encV1 = await encryptString(PLAINTEXT, PASSWORD);
    expect(isEncryptedV2(encV1)).toBe(false);
  });

  it("isEncryptedV2 rejects garbage input without throwing", () => {
    expect(isEncryptedV2("not-valid-base64!!!")).toBe(false);
    expect(isEncryptedV2("")).toBe(false);
    expect(isEncryptedV2(btoa("not json"))).toBe(false);
  });

  it("allEncryptedV2 is true only when every entry is V2", async () => {
    const v1 = await encryptString(PLAINTEXT, PASSWORD);
    const v2a = await encryptStringV2(PLAINTEXT, PASSWORD);
    const v2b = await encryptStringV2(UNICODE_PLAINTEXT, PASSWORD);

    expect(allEncryptedV2([])).toBe(false);            // empty → false (per source)
    expect(allEncryptedV2([v2a])).toBe(true);
    expect(allEncryptedV2([v2a, v2b])).toBe(true);
    expect(allEncryptedV2([v2a, v1])).toBe(false);     // mixed → false
    expect(allEncryptedV2([v1])).toBe(false);
  });
});

describe("smartDecrypt — the format-auto-detecting decrypt", () => {
  it("decrypts V1 envelope", async () => {
    const encV1 = await encryptString(PLAINTEXT, PASSWORD);
    const dec   = await smartDecrypt(encV1, PASSWORD);
    expect(dec).toBe(PLAINTEXT);
  });

  it("decrypts V2 envelope", async () => {
    const encV2 = await encryptStringV2(PLAINTEXT, PASSWORD);
    const dec   = await smartDecrypt(encV2, PASSWORD);
    expect(dec).toBe(PLAINTEXT);
  });

  it("decrypts a freshly-imported V1 backup even after the user upgraded to V2 locally (commit 23bc3f5 regression guard)", async () => {
    // Simulates the bug commit 23bc3f5 fixed: handleRecoverFromFile used
    // V1-only decryptString, which failed for users who had upgraded to V2
    // before exporting. smartDecrypt handles both shapes transparently.
    const encV1 = await encryptString(PLAINTEXT, PASSWORD);
    const encV2 = await encryptStringV2(UNICODE_PLAINTEXT, PASSWORD);
    const decV1 = await smartDecrypt(encV1, PASSWORD);
    const decV2 = await smartDecrypt(encV2, PASSWORD);
    expect(decV1).toBe(PLAINTEXT);
    expect(decV2).toBe(UNICODE_PLAINTEXT);
  });

  it("throws on wrong password for either format", async () => {
    const encV1 = await encryptString(PLAINTEXT, PASSWORD);
    const encV2 = await encryptStringV2(PLAINTEXT, PASSWORD);
    await expect(smartDecrypt(encV1, WRONG_PASSWORD)).rejects.toThrow();
    await expect(smartDecrypt(encV2, WRONG_PASSWORD)).rejects.toThrow();
  });
});

describe("isCodexUpgraded — pure predicate on the schema-version string", () => {
  it("returns false for null (no stored value)", () => {
    expect(isCodexUpgraded(null)).toBe(false);
  });

  it("returns false for '0'", () => {
    expect(isCodexUpgraded("0")).toBe(false);
  });

  it("returns true for '1'", () => {
    expect(isCodexUpgraded("1")).toBe(true);
  });

  it("returns true for higher versions (forward-compat)", () => {
    expect(isCodexUpgraded("2")).toBe(true);
    expect(isCodexUpgraded("99")).toBe(true);
  });

  it("returns false for garbage (fail-safe)", () => {
    expect(isCodexUpgraded("not-a-number")).toBe(false);
    expect(isCodexUpgraded("")).toBe(false);
  });
});

describe("smartEncrypt — writes V1 or V2 based on the supplied schemaVersion string", () => {
  // Now pure (no localStorage read) — the caller passes the schemaVersion
  // directly. OuronetUI's smart-encrypt-browser.ts reads the localStorage
  // value and passes it through; this test exercises the pure function.

  it("writes V1 when schemaVersion is null (codex never upgraded)", async () => {
    const enc = await smartEncrypt(PLAINTEXT, PASSWORD, null);
    expect(isEncryptedV2(enc)).toBe(false);
    const dec = await smartDecrypt(enc, PASSWORD);
    expect(dec).toBe(PLAINTEXT);
  });

  it("writes V1 when schemaVersion is '0'", async () => {
    const enc = await smartEncrypt(PLAINTEXT, PASSWORD, "0");
    expect(isEncryptedV2(enc)).toBe(false);
  });

  it("writes V2 when schemaVersion is '1'", async () => {
    const enc = await smartEncrypt(PLAINTEXT, PASSWORD, "1");
    expect(isEncryptedV2(enc)).toBe(true);
    const dec = await smartDecrypt(enc, PASSWORD);
    expect(dec).toBe(PLAINTEXT);
  });

  it("writes V2 when schemaVersion is higher than 1 (forward-compat)", async () => {
    const enc = await smartEncrypt(PLAINTEXT, PASSWORD, "99");
    expect(isEncryptedV2(enc)).toBe(true);
  });
});
