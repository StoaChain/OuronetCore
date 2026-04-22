/**
 * Encryption V1 → V2 upgrade-on-unlock flow tests.
 *
 * The scenario this protects: a user creates a codex on the original
 * OuronetUI (writes V1-encrypted blobs with PBKDF2-SHA256 10k), lets
 * the codex sit for months, then opens a newer OuronetUI that's
 * upgraded to V2 (PBKDF2-SHA512 600k). The user types their password,
 * the app decrypts each V1 blob via `smartDecrypt`, re-encrypts via
 * `smartEncrypt(plaintext, password, "1")` — which picks V2 because
 * schema version is now >= 1 — and writes the V2 blob back.
 *
 * If ANY step silently misbehaves, users lose access. This module
 * tests the pure-core primitives that power that flow.
 *
 * Tier 2 per OuronetUI/docs/TESTING_STRATEGY.md §Group 2.
 */

import { describe, it, expect } from "vitest";
import {
  encryptString,
  encryptStringV2,
  decryptString,
  decryptStringV2,
  smartDecrypt,
  smartEncrypt,
  isEncryptedV2,
  isCodexUpgraded,
} from "../src/crypto";

const PASSWORD = "correct-horse-battery-staple";
const PLAINTEXT = "the secret seed phrase that drives a wallet";

// ─── The canonical upgrade sequence ──────────────────────────────────────────

describe("V1 → V2 upgrade pipeline (the critical path)", () => {
  it("V1 blob decrypts, re-encrypts to V2, V2 decrypts back to same plaintext", async () => {
    // STEP 1: simulate the user's pre-upgrade state
    const v1Blob = await encryptString(PLAINTEXT, PASSWORD);
    expect(isEncryptedV2(v1Blob)).toBe(false);

    // STEP 2: on unlock, smartDecrypt handles either format
    const unlocked = await smartDecrypt(v1Blob, PASSWORD);
    expect(unlocked).toBe(PLAINTEXT);

    // STEP 3: app writes schemaVersion=1 to storage, then re-encrypts.
    // smartEncrypt takes the new schemaVersion and picks V2 because
    // isCodexUpgraded("1") === true.
    const v2Blob = await smartEncrypt(unlocked, PASSWORD, "1");
    expect(isEncryptedV2(v2Blob)).toBe(true);

    // STEP 4: future unlock reads the V2 blob cleanly
    const readAgain = await smartDecrypt(v2Blob, PASSWORD);
    expect(readAgain).toBe(PLAINTEXT);
  });

  it("upgrade is idempotent — re-running on an already-V2 blob is a no-op-ish", async () => {
    // If for any reason the app re-runs upgrade on a V2 blob (double-click
    // the unlock flow, race condition, etc.) the blob must still decrypt
    // correctly. V2 → decrypt → re-encrypt with schemaVersion=1 → still V2.
    const v2Blob = await encryptStringV2(PLAINTEXT, PASSWORD);
    const dec = await smartDecrypt(v2Blob, PASSWORD);
    const v2BlobAgain = await smartEncrypt(dec, PASSWORD, "1");

    expect(isEncryptedV2(v2BlobAgain)).toBe(true);
    expect(await smartDecrypt(v2BlobAgain, PASSWORD)).toBe(PLAINTEXT);
  });

  it("smartEncrypt writes V1 when schemaVersion is null / 0 (pre-upgrade state)", async () => {
    // The upgrade-on-unlock handler should only flip schemaVersion to "1"
    // AFTER all blobs are safely re-encrypted. If a blob re-encrypts BEFORE
    // the flag flips (or if the flag fails to persist), the blob lands as
    // V1 again — which is survivable, the next unlock just re-tries.
    const v1Blob = await smartEncrypt(PLAINTEXT, PASSWORD, null);
    expect(isEncryptedV2(v1Blob)).toBe(false);

    const v1BlobZero = await smartEncrypt(PLAINTEXT, PASSWORD, "0");
    expect(isEncryptedV2(v1BlobZero)).toBe(false);
  });

  it("mixed codex (some V1, some V2) — smartDecrypt handles each blob independently", async () => {
    // Realistic mid-upgrade state: user has 5 seeds, upgrade crashed after
    // re-encrypting 3 of them. On next login, 3 are V2, 2 are V1. Every
    // one must still decrypt with the same password via smartDecrypt.
    const blobs = [
      await encryptString(PLAINTEXT + "_seed1", PASSWORD),
      await encryptStringV2(PLAINTEXT + "_seed2", PASSWORD),
      await encryptString(PLAINTEXT + "_seed3", PASSWORD),
      await encryptStringV2(PLAINTEXT + "_seed4", PASSWORD),
      await encryptStringV2(PLAINTEXT + "_seed5", PASSWORD),
    ];

    const decrypted = await Promise.all(blobs.map(b => smartDecrypt(b, PASSWORD)));
    expect(decrypted).toEqual([
      PLAINTEXT + "_seed1",
      PLAINTEXT + "_seed2",
      PLAINTEXT + "_seed3",
      PLAINTEXT + "_seed4",
      PLAINTEXT + "_seed5",
    ]);
  });

  it("wrong password on a V1 blob throws — must not silently succeed with a V2 fallback", async () => {
    // Belt-and-suspenders: there's a V1-fallback path inside decryptStringV2
    // for legitimate edge cases. Make sure a WRONG password doesn't slip
    // through the fallback and return garbage.
    const v1Blob = await encryptString(PLAINTEXT, PASSWORD);
    await expect(smartDecrypt(v1Blob, "wrong-password")).rejects.toThrow();
  });

  it("wrong password on a V2 blob throws — must not silently succeed", async () => {
    const v2Blob = await encryptStringV2(PLAINTEXT, PASSWORD);
    await expect(smartDecrypt(v2Blob, "wrong-password")).rejects.toThrow();
  });
});

// ─── isCodexUpgraded predicate drives smartEncrypt's format selection ────────

describe("isCodexUpgraded ↔ smartEncrypt contract", () => {
  it("smartEncrypt writes V2 iff isCodexUpgraded(schemaVersion) is true", async () => {
    const testCases: Array<[string | null, boolean]> = [
      [null,   false],  // no stored value
      ["",     false],  // empty
      ["0",    false],  // pre-upgrade
      ["1",    true],   // upgraded
      ["2",    true],   // future-upgraded
      ["99",   true],   // far-future-upgraded
      ["weird", false], // garbage falls back to V1 (fail-safe)
    ];

    for (const [schemaVersion, expectedV2] of testCases) {
      const predicate = isCodexUpgraded(schemaVersion);
      expect(predicate).toBe(expectedV2);

      const blob = await smartEncrypt(PLAINTEXT, PASSWORD, schemaVersion);
      expect(isEncryptedV2(blob)).toBe(expectedV2);
    }
  });
});

// ─── Password change during upgrade ──────────────────────────────────────────

describe("password change + upgrade interaction", () => {
  it("old V1 blob re-encrypted as V2 with a NEW password decrypts only with new password", async () => {
    // Scenario: user changes password while codex is being upgraded.
    // The upgrade handler should re-encrypt with the NEW password, and
    // the old password must no longer decrypt the re-encrypted blob.
    const oldPass = "old-password-123";
    const newPass = "new-password-456";

    const v1Blob = await encryptString(PLAINTEXT, oldPass);
    const decrypted = await smartDecrypt(v1Blob, oldPass);
    expect(decrypted).toBe(PLAINTEXT);

    // Re-encrypt with NEW password at schemaVersion=1 (V2)
    const v2Blob = await smartEncrypt(decrypted, newPass, "1");
    expect(isEncryptedV2(v2Blob)).toBe(true);

    // Old password must fail; new password must succeed.
    await expect(smartDecrypt(v2Blob, oldPass)).rejects.toThrow();
    expect(await smartDecrypt(v2Blob, newPass)).toBe(PLAINTEXT);
  });
});

// ─── Direct decryptStringV2 fallback path (belt-and-suspenders) ──────────────

describe("decryptStringV2 V1-fallback path", () => {
  it("can decrypt a V1 blob when called directly (not via smartDecrypt)", async () => {
    // Some call sites call decryptStringV2 directly (the "I know this is V2"
    // path). If they accidentally get a V1 blob, the decoder falls through
    // to V1 params internally. This covers that branch.
    const v1Blob = await encryptString(PLAINTEXT, PASSWORD);
    const decrypted = await decryptStringV2(v1Blob, PASSWORD);
    expect(decrypted).toBe(PLAINTEXT);
  });

  it("decryptString (V1-only) refuses V2 blobs — they have mismatched KDF params", async () => {
    // Inverse check: the V1-only decoder CAN'T read V2. (PBKDF2 iterations
    // mismatch produces a different key, AES-GCM auth tag fails.) This is
    // why smartDecrypt exists.
    const v2Blob = await encryptStringV2(PLAINTEXT, PASSWORD);
    await expect(decryptString(v2Blob, PASSWORD)).rejects.toThrow();
  });
});

// ─── A realistic "full codex" upgrade simulation ─────────────────────────────

describe("full-codex upgrade simulation", () => {
  it("upgrades a codex with wallets + accounts + pure keypairs, preserves all plaintexts", async () => {
    // Represents what LocalStorageCodexAdapter does on unlock: iterates
    // each encrypted field in each wallet/account/pure-keypair, decrypts
    // via smartDecrypt, re-encrypts via smartEncrypt with schemaVersion=1.
    const codexEntries = [
      { id: "seed-a", encField: "secret", plain: "wallet A 24-word seed phrase here" },
      { id: "seed-b", encField: "main",   plain: "wallet B encrypted main seed 64 hex chars" },
      { id: "acct-1", encField: "secret", plain: "account resident secret blob" },
      { id: "acct-1", encField: "backup", plain: "account resident backup blob" },
      { id: "pk-1",   encField: "encryptedPrivateKey", plain: "pure keypair priv hex" },
    ];

    // Pre-state: all encrypted with V1
    const preUpgrade = await Promise.all(
      codexEntries.map(async (e) => ({ ...e, blob: await encryptString(e.plain, PASSWORD) })),
    );

    // Ensure all are V1
    for (const e of preUpgrade) {
      expect(isEncryptedV2(e.blob)).toBe(false);
    }

    // THE UPGRADE: decrypt each, re-encrypt with schemaVersion=1
    const postUpgrade = await Promise.all(
      preUpgrade.map(async (e) => {
        const plain = await smartDecrypt(e.blob, PASSWORD);
        const newBlob = await smartEncrypt(plain, PASSWORD, "1");
        return { ...e, blob: newBlob };
      }),
    );

    // Every blob is now V2
    for (const e of postUpgrade) {
      expect(isEncryptedV2(e.blob)).toBe(true);
    }

    // Every plaintext round-trips
    for (let i = 0; i < postUpgrade.length; i++) {
      const decrypted = await smartDecrypt(postUpgrade[i].blob, PASSWORD);
      expect(decrypted).toBe(codexEntries[i].plain);
    }
  });
});
