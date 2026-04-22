/**
 * V1 encryption — the LEGACY codex format.
 *
 * PBKDF2 / SHA-256 / 10,000 iterations → AES-GCM-256 / 16-byte salt / 12-byte IV.
 * Envelope: btoa(JSON.stringify({ ciphertext, iv, salt }))  (no `v` field).
 *
 * This exists for one reason: users who created their codex before the V2
 * upgrade store their encrypted blobs in this format. We MUST still decrypt
 * them on login, and `upgradeCodexEncryption` re-encrypts them as V2 after
 * a successful unlock. New codex writes go through V2 exclusively.
 *
 * Pure — no localStorage, no DOM. Works in browser + Node.js (any env with
 * a WebCrypto implementation).
 */

export interface EncryptedData {
  ciphertext: string; // base64 encoded
  iv: string;         // base64 encoded
  salt: string;       // base64 encoded
}

/** Encrypt a plaintext string. Returns base64(JSON({ciphertext, iv, salt})). */
export async function encryptString(
  plaintext: string,
  password: string,
): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(plaintext);
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 10000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      data,
    );

    const encryptedData: EncryptedData = {
      ciphertext: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv.slice().buffer),
      salt: arrayBufferToBase64(salt.slice().buffer),
    };

    return btoa(JSON.stringify(encryptedData));
  } catch (error) {
    console.error("Encryption error:", error);
    throw new Error("Failed to encrypt data");
  }
}

/** Decrypt a V1 envelope. Throws on wrong password or corrupted data. */
export async function decryptString(
  encryptedBase64String: string,
  password: string,
): Promise<string> {
  try {
    const jsonString = atob(encryptedBase64String);
    const encryptedData: EncryptedData = JSON.parse(jsonString);
    const { ciphertext, iv, salt } = encryptedData;

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const ciphertextArray = base64ToArrayBuffer(ciphertext);
    // IV must be exactly 12 bytes, salt exactly 16 bytes — truncate if
    // a legacy browser over-allocated the pooled buffer.
    const ivRaw = base64ToArrayBuffer(iv);
    const saltRaw = base64ToArrayBuffer(salt);
    const ivArray = ivRaw.byteLength > 12 ? ivRaw.slice(0, 12) : ivRaw;
    const saltArray = saltRaw.byteLength > 16 ? saltRaw.slice(0, 16) : saltRaw;

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      encoder.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltArray,
        iterations: 10000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivArray },
      key,
      ciphertextArray,
    );

    return decoder.decode(decrypted);
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(
      "Failed to decrypt data. Invalid password or corrupted data.",
    );
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}
