/**
 * Seed-type migration — the naming layer between historical codex blobs
 * and the current canonical names.
 *
 * Background. Early OuronetUI wallets were written with `seedType: "legacy"`
 * (Chainweaver-derived WASM path) and `seedType: "new"` (Koala HD-wallet
 * nacl path). When ecko-wallet landed the third variant got a clean name
 * ("eckowallet"), but the existing "legacy" / "new" strings stayed live in
 * users' localStorage. Rather than break those codexes we migrate on load:
 * `legacy → chainweaver`, `new → koala`, everything else passes through.
 *
 * Canonical seed types are `"koala" | "chainweaver" | "eckowallet"`. The
 * migration is idempotent — applying it twice yields the same result.
 *
 * Moved out of OuronetUI's WalletStorage in Phase 4. It had no business
 * being there; it's a pure string-to-string mapping that every codex
 * consumer (UI + future HUB) needs.
 */

/** The three canonical seed types a Codex entry can have today. */
export type SeedType = "koala" | "chainweaver" | "eckowallet";

/** The string you might find in a raw codex blob — includes legacy names. */
export type RawSeedType = SeedType | "legacy" | "new" | string;

const SEED_TYPE_MIGRATION: Record<string, SeedType> = {
  "legacy":      "chainweaver",
  "new":         "koala",
  "chainweaver": "chainweaver",
  "koala":       "koala",
  "eckowallet":  "eckowallet",
};

/**
 * Map a raw seed-type string to the canonical form. Unknown strings default
 * to `"koala"` — this matches the UI's historical behaviour and avoids a
 * throw during load; the alternative (throw) would lock users out of their
 * codex over a typo.
 */
export function migrateSeedType(rawType: string): SeedType {
  return SEED_TYPE_MIGRATION[rawType] || "koala";
}
