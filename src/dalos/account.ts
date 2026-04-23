/**
 * `createOuronetAccount` — the OuronetCore high-level entry point for
 * minting new Ouronet accounts.
 *
 * Wraps `CryptographicRegistry` + primitive-of-your-choice with a
 * discriminated-union options shape. Every consumer (OuronetUI, the
 * AncientHoldings hub, CLI tools) goes through this helper instead of
 * calling the registry methods directly — this standardises error
 * handling and gives us a single place to add audit logs / telemetry
 * in the future.
 *
 * By default uses the registry's default primitive (DalosGenesis).
 * A specific primitive can be selected with `primitiveId`.
 *
 * Copyright (C) 2026 AncientHoldings GmbH. All rights reserved.
 */

import type { Bitmap } from '@stoachain/dalos-crypto/gen1';
import type {
  CryptographicRegistry,
  FullKey,
} from '@stoachain/dalos-crypto/registry';

/**
 * Discriminator for the input mode. Each mode has a matching `data`
 * shape defined in the `CreateAccountOptions` union below.
 */
export type CreateAccountMode =
  | 'random'
  | 'bitString'
  | 'integerBase10'
  | 'integerBase49'
  | 'seedWords'
  | 'bitmap';

/**
 * Options for `createOuronetAccount`. Discriminated on `mode` — each
 * mode specifies the required `data` shape.
 *
 * `primitiveId` (optional): which primitive in the registry to use.
 * Defaults to `registry.default()` (= DalosGenesis in a default registry).
 *
 * `strict` (optional, default true): when true, throws if the selected
 * primitive doesn't support the requested `mode` (e.g., `bitmap` on a
 * non-DalosGenesis primitive). When false, throws only at the call site.
 */
export type CreateAccountOptions =
  | {
      readonly mode: 'random';
      readonly primitiveId?: string;
    }
  | {
      readonly mode: 'bitString';
      readonly data: string;
      readonly primitiveId?: string;
    }
  | {
      readonly mode: 'integerBase10';
      readonly data: string;
      readonly primitiveId?: string;
    }
  | {
      readonly mode: 'integerBase49';
      readonly data: string;
      readonly primitiveId?: string;
    }
  | {
      readonly mode: 'seedWords';
      readonly data: readonly string[];
      readonly primitiveId?: string;
    }
  | {
      readonly mode: 'bitmap';
      readonly data: Bitmap;
      readonly primitiveId?: string;
    };

/**
 * Mint a new Ouronet account using the registered cryptographic
 * primitive.
 *
 * Resolution order:
 *   1. If `options.primitiveId` is given, use `registry.get(id)`;
 *      throws if not registered.
 *   2. Otherwise use `registry.default()`; throws if registry empty.
 *
 * The selected primitive must support the requested `mode` (e.g.,
 * `bitmap` requires a `DalosGenesisPrimitive` or equivalent that
 * implements `generateFromBitmap`). Throws a descriptive error if
 * the primitive doesn't support the mode.
 *
 * @returns A `FullKey` with key pair, private-key representations,
 *          and both address forms (Ѻ. standard and Σ. smart).
 */
export function createOuronetAccount(
  registry: CryptographicRegistry,
  options: CreateAccountOptions,
): FullKey {
  // 1. Resolve the primitive to use.
  const primitive =
    options.primitiveId !== undefined
      ? registry.get(options.primitiveId)
      : registry.default();

  if (primitive === undefined) {
    throw new Error(
      `createOuronetAccount: primitive "${options.primitiveId ?? '(default)'}" not registered`,
    );
  }

  // 2. Dispatch to the right primitive method based on mode.
  switch (options.mode) {
    case 'random':
      return primitive.generateRandom();

    case 'bitString':
      return primitive.generateFromBitString(options.data);

    case 'integerBase10':
      return primitive.generateFromInteger(options.data, 10);

    case 'integerBase49':
      return primitive.generateFromInteger(options.data, 49);

    case 'seedWords':
      return primitive.generateFromSeedWords(options.data);

    case 'bitmap': {
      // Bitmap is Gen-1-specific. Narrow via duck type — we check for
      // the method rather than importing the type guard so that this
      // helper works across primitive packages if they follow the same
      // naming convention.
      const bmPrimitive = primitive as unknown as {
        generateFromBitmap?: (b: Bitmap) => FullKey;
      };
      if (typeof bmPrimitive.generateFromBitmap !== 'function') {
        throw new Error(
          `createOuronetAccount: primitive "${primitive.id}" does not support bitmap input`,
        );
      }
      return bmPrimitive.generateFromBitmap(options.data);
    }
  }
}
