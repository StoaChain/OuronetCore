/**
 * Ouronet DPTF token IDs — global constants.
 * All share the same suffix: -8Nh-JO8JO4F5
 */

export const TOKEN_ID_OURO       = "OURO-8Nh-JO8JO4F5";
export const TOKEN_ID_IGNIS      = "GAS-8Nh-JO8JO4F5";
export const TOKEN_ID_AURYN      = "AURYN-8Nh-JO8JO4F5";
export const TOKEN_ID_ELITEAURYN = "ELITEAURYN-8Nh-JO8JO4F5";
export const TOKEN_ID_WSTOA      = "WSTOA-8Nh-JO8JO4F5";
export const TOKEN_ID_SSTOA      = "SSTOA-8Nh-JO8JO4F5";
export const TOKEN_ID_GSTOA      = "GSTOA-8Nh-JO8JO4F5";

/** Ordered array — same order as primordials tokens[] */
export const ALL_TOKEN_IDS = [
  TOKEN_ID_OURO,
  TOKEN_ID_IGNIS,
  TOKEN_ID_AURYN,
  TOKEN_ID_ELITEAURYN,
  TOKEN_ID_WSTOA,
  TOKEN_ID_SSTOA,
  TOKEN_ID_GSTOA,
] as const;
