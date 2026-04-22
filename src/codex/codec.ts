/**
 * Codex serialization / deserialization — the shared codec between
 * OuronetUI's "Export Codex" button and any future consumer that reads
 * the same backup JSON (HUB's codex-import flow, CLI recovery tools,
 * etc.).
 *
 * The format is `CodexExportV1_2` — the `"version": "1.2"` string has
 * been in OuronetUI since commit 2025-01-13. Do NOT bump it: it's what
 * every user's downloaded `OuronetCodex_*.json` file says, and changing
 * it would break existing recoveries. A V2 codex export (if ever needed)
 * adds a new CodexExportV2 type rather than reusing this one.
 *
 * All pure. No password handling in here — the BYTES INSIDE the JSON are
 * already encrypted at the codex-entry level (each wallet's `secret` field
 * is a V1 or V2 blob). Serializing the codex doesn't touch those blobs;
 * it just wraps them in the portable envelope.
 */

import type { CodexExportV1_2, PlaintextCodex } from "./types";

/**
 * Build a `CodexExportV1_2` payload from a PlaintextCodex. Stamps
 * `exportedAt` with the current ISO time. Returns the object — the
 * caller stringifies it (so callers in a memory-constrained environment
 * can stream it out instead of holding the whole string in RAM).
 *
 * Fields left out intentionally: `pureKeypairs`, `schemaVersion`,
 * `lastUpdatedAt`, `lastUpdatedDevice` — see CodexExportV1_2 JSDoc for
 * the rationale (historical shape, device-local fields don't travel).
 */
export function buildCodexExport<
  KS, OA, PK, AB, UI,
>(
  codex: PlaintextCodex<KS, OA, PK, AB, UI>,
): CodexExportV1_2<KS, OA, AB, UI> {
  return {
    version: "1.2",
    exportedAt: new Date().toISOString(),
    kadenaWallets: codex.kadenaWallets,
    ouronetWallets: codex.ouronetWallets,
    addressBook: codex.addressBook,
    uiSettings: codex.uiSettings,
  };
}

/**
 * Stringify a PlaintextCodex into the `"1.2"` backup JSON format, the
 * exact output of OuronetUI's LocalStorageCodexAdapter.downloadAsJson.
 * Pretty-prints with 2-space indent because the file lands on disk and
 * a human occasionally opens it to sanity-check account addresses.
 */
export function serializeCodex<
  KS, OA, PK, AB, UI,
>(
  codex: PlaintextCodex<KS, OA, PK, AB, UI>,
): string {
  return JSON.stringify(buildCodexExport(codex), null, 2);
}

/**
 * Parse a codex-export JSON string. Does NOT decrypt any enclosed blobs
 * — the returned object's `kadenaWallets[i].secret` etc. are still V1/V2
 * encrypted strings. Caller is responsible for decrypting them with the
 * codex password once they've validated the parse.
 *
 * Throws on:
 *   - invalid JSON
 *   - missing `"version"` field (malformed)
 *   - version mismatch (not `"1.2"`)
 *
 * The version check exists to fail-fast rather than silently mis-decoding
 * a future V2 export format. Callers that want best-effort partial reads
 * can catch the throw and fall through to a recovery path.
 */
export function deserializeCodex<
  KS = unknown,
  OA = unknown,
  AB = unknown,
  UI = unknown,
>(
  json: string,
): CodexExportV1_2<KS, OA, AB, UI> {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("deserializeCodex: not an object");
  }
  if (parsed.version !== "1.2") {
    throw new Error(
      `deserializeCodex: unsupported version ${String(parsed.version)} — expected "1.2"`,
    );
  }
  return parsed as CodexExportV1_2<KS, OA, AB, UI>;
}
