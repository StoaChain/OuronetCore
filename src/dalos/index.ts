/**
 * @stoachain/ouronet-core/dalos — thin integration surface over
 * `@stoachain/dalos-crypto`.
 *
 * This subpath exists so OuronetCore consumers have a single, stable
 * place to reach DALOS cryptography without needing a separate
 * dependency line in their own package.json. The entire underlying
 * `@stoachain/dalos-crypto/registry` surface is re-exported, plus a
 * small layer of OuronetCore-specific conveniences that compose the
 * DALOS primitives with the codex encryption.
 *
 * Imports available via this subpath:
 *   - `createDefaultRegistry`, `CryptographicRegistry`, `DalosGenesis`
 *     — the DALOS primitive system
 *   - `CryptographicPrimitive`, `KeyPair`, `FullKey`, `PrivateKeyForms`
 *     — types
 *   - `isDalosGenesisPrimitive` — type guard
 *   - `createOuronetAccount(options)` — OuronetCore convenience that
 *     routes an input through the registry and returns a fully-
 *     materialised account
 *
 * Example:
 *
 * ```ts
 * import {
 *   createDefaultRegistry,
 *   createOuronetAccount,
 * } from '@stoachain/ouronet-core/dalos';
 *
 * const registry = createDefaultRegistry();
 * const account = createOuronetAccount(registry, {
 *   mode: 'seedWords',
 *   data: ['hello', 'world', 'dalos', 'genesis'],
 * });
 * console.log(account.standardAddress); // Ѻ.xxxxx...
 * ```
 *
 * Integration with other ouronet-core surfaces:
 *   - The resulting `keyPair` (priv in base-49, publ in prefixed base-49)
 *     can be stored via the codex subsystem
 *   - The secret fields (priv, bitString, int10, int49) should be
 *     encrypted via `@stoachain/ouronet-core/crypto`'s `smartEncrypt`
 *     before codex storage
 *   - Signing is available via `primitive.sign(keyPair, message)`
 */

// Re-export the full DALOS registry surface so consumers can use either
// `@stoachain/dalos-crypto/registry` or `@stoachain/ouronet-core/dalos`
// interchangeably.
export type {
  KeyPair,
  PrivateKeyForms,
  FullKey,
  PrimitiveMetadata,
  CryptographicPrimitive,
  DalosGenesisPrimitive,
} from '@stoachain/dalos-crypto/registry';

export {
  isDalosGenesisPrimitive,
  DalosGenesis,
  CryptographicRegistry,
  createDefaultRegistry,
} from '@stoachain/dalos-crypto/registry';

// Re-export the bitmap type so consumers can construct bitmaps without
// a separate import from dalos-crypto.
export type { Bitmap } from '@stoachain/dalos-crypto/gen1';
export {
  BITMAP_ROWS,
  BITMAP_COLS,
  BITMAP_TOTAL_BITS,
  bitmapToBitString,
  parseAsciiBitmap,
  bitmapToAscii,
} from '@stoachain/dalos-crypto/gen1';

export { createOuronetAccount } from './account.js';
export type { CreateAccountOptions, CreateAccountMode } from './account.js';
