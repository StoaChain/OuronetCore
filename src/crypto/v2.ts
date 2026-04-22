/**
 * V2 encryption — the current codex format.
 *
 * PBKDF2 / SHA-512 / 600,000 iterations → AES-GCM-256 / 16-byte salt / 12-byte IV.
 * Envelope: btoa(JSON.stringify({ v: 2, ciphertext, iv, salt }))  (the `v: 2`
 * marker is what distinguishes this from V1 and what `smartDecrypt` keys off).
 *
 * This module also owns the format-detection + auto-decode helpers
 * (`isEncryptedV2`, `smartDecrypt`, `isCodexUpgraded`, `smartEncrypt`) so
 * consumers have one import site for every "encrypted blob" concern.
 *
 * Pure — no localStorage, no DOM. `smartEncrypt` takes the schema version
 * as an argument rather than reading `localStorage.codex_schema_version`,
 * so this file works in Node / HUB / tests identically to the browser.
 * The OuronetUI ships a tiny `smart-encrypt-browser.ts` wrapper that
 * reads localStorage and delegates here.
 */

export interface EncryptedDataV2 {
  v: 2;
  ciphertext: string;
  iv: string;
  salt: string;
}

export interface EncryptedDataV1 {
  ciphertext: string;
  iv: string;
  salt: string;
}

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  let s = "";
  for (let i = 0; i < copy.byteLength; i++) s += String.fromCharCode(copy[i]);
  return btoa(s);
}

function b642ab(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Return a fresh ArrayBuffer that's not shared
  return bytes.buffer.slice(0);
}

/** Encrypt plaintext to V2 envelope. */
export async function encryptStringV2(plaintext: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const saltArr = crypto.getRandomValues(new Uint8Array(16));
  const ivArr = crypto.getRandomValues(new Uint8Array(12));
  const salt = saltArr.slice();
  const iv = ivArr.slice();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-512" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  const data: EncryptedDataV2 = {
    v: 2,
    ciphertext: ab2b64(encrypted),
    iv: ab2b64(iv.buffer),
    salt: ab2b64(salt.buffer),
  };
  return btoa(JSON.stringify(data));
}

/**
 * Decrypt a V2 envelope. Includes a V1 fallback path: if the envelope lacks
 * `v: 2`, this still decodes it using V1 params. That keeps V2-only call
 * sites (e.g. a codex-wide re-encrypt job) safe when stray V1 blobs linger.
 */
export async function decryptStringV2(encryptedBase64: string, password: string): Promise<string> {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const parsed = JSON.parse(atob(encryptedBase64));

  // V2 format
  if (parsed.v === 2) {
    const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b642ab(parsed.salt), iterations: 600_000, hash: "SHA-512" },
      km,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b642ab(parsed.iv) },
      key,
      b642ab(parsed.ciphertext),
    );
    return dec.decode(decrypted);
  }

  // V1 fallback (10k SHA-256) — truncate IV/salt in case browser used pooled buffer
  const ivRaw = b642ab(parsed.iv);
  const saltRaw = b642ab(parsed.salt);
  const iv1 = ivRaw.byteLength > 12 ? ivRaw.slice(0, 12) : ivRaw;
  const salt1 = saltRaw.byteLength > 16 ? saltRaw.slice(0, 16) : saltRaw;
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt1, iterations: 10_000, hash: "SHA-256" },
    km,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv1 },
    key,
    b642ab(parsed.ciphertext),
  );
  return dec.decode(decrypted);
}

/** True iff the envelope is V2 (has `v: 2` after base64-JSON decode). */
export function isEncryptedV2(encryptedBase64: string): boolean {
  try {
    return JSON.parse(atob(encryptedBase64))?.v === 2;
  } catch {
    return false;
  }
}

/** True iff every string in the array is a V2 envelope. Empty array → false. */
export function allEncryptedV2(strings: string[]): boolean {
  return strings.length > 0 && strings.every(isEncryptedV2);
}

/**
 * Has the codex been upgraded to the V2-writes world? The answer comes
 * from whatever string the caller hands in. OuronetUI passes the value
 * of `localStorage.getItem("codex_schema_version")`; the HUB will pass
 * whatever it reads from its config.
 *
 * Pure — the storage lookup happens at the boundary.
 */
export function isCodexUpgraded(schemaVersion: string | null): boolean {
  try { return parseInt(schemaVersion || "0", 10) >= 1; } catch { return false; }
}

/**
 * Writes V2 if the codex has been upgraded, V1 otherwise. The caller
 * supplies the schema-version string (usually from localStorage on the
 * browser, from a persisted config on the server). Pure — no storage
 * I/O here.
 *
 * OuronetUI users with V1 codexes that haven't been upgraded still write
 * V1 blobs. The `upgradeCodexEncryption` flow (triggered on unlock) is
 * what migrates everything to V2, after which future smartEncrypt calls
 * see `schemaVersion >= 1` and take the V2 path.
 */
export async function smartEncrypt(
  plaintext: string,
  password: string,
  schemaVersion: string | null,
): Promise<string> {
  if (isCodexUpgraded(schemaVersion)) return encryptStringV2(plaintext, password);
  // Fallback to V1
  const { encryptString } = await import("./v1");
  return encryptString(plaintext, password);
}

/**
 * Decrypts either format transparently. Tries V1 primitives first (they're
 * cheaper — 10k vs 600k iterations), then the V1-fallback branch inside
 * decryptStringV2. This is the single entry point every "decrypt on login"
 * or "decrypt on recovery" call site should use.
 */
export async function smartDecrypt(encrypted: string, password: string): Promise<string> {
  if (isEncryptedV2(encrypted)) return decryptStringV2(encrypted, password);
  // Try V1 original first
  try {
    const { decryptString } = await import("./v1");
    return await decryptString(encrypted, password);
  } catch {
    // Fallback to V2 decoder (also handles V1 format)
    return decryptStringV2(encrypted, password);
  }
}

