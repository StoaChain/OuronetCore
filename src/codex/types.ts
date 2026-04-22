/**
 * PlaintextCodex — the portable shape of an Ouronet user's in-memory
 * codex state. Consumers decide the concrete element types for each list
 * via generics (OuronetUI plugs in its IKadenaSeed / IOuroAccount / etc;
 * the future HUB can supply its own if it prefers, or reuse UI's via a
 * shared `@ouronet/shared-types` package later).
 *
 * Why generic? Because the codec (serialize / deserialize) and any other
 * core-side consumer only cares about the SHAPE — "there are N wallets,
 * M accounts, K pure keypairs, an address book, and some ui settings".
 * The field contents are consumer-defined. Generics let the type carry
 * information without forcing core to own every wallet-domain type.
 *
 * Default type params are `unknown` so downstream code that doesn't need
 * field-level types still works — `PlaintextCodex` with no args treats
 * each list as `unknown[]`, which TypeScript allows assignment TO but
 * nothing structured FROM (exactly right for a generic serializer).
 */

export interface PlaintextCodex<
  KadenaSeed       = unknown,
  OuroAccount      = unknown,
  PureKeypair      = unknown,
  AddressBookEntry = unknown,
  UiSettings       = unknown,
> {
  /** HD seeds (koala / chainweaver / eckowallet variants) known to this codex. */
  kadenaWallets: KadenaSeed[];
  /** Resident OURO accounts the user controls. */
  ouronetWallets: OuroAccount[];
  /** Address-book entries (cached or user-added). */
  addressBook: AddressBookEntry[];
  /** Raw pure Pact keypairs stored directly (encrypted privateKey). */
  pureKeypairs: PureKeypair[];
  /** Non-sensitive UI preferences (dock position, zone state, etc). */
  uiSettings: UiSettings;

  /**
   * Schema version of this codex. `0` = pre-upgrade V1-encrypted; `1+` =
   * post-upgrade V2-encrypted. Consumers can read this to decide whether
   * to run the encryption upgrade on unlock.
   */
  schemaVersion: number;
  /** ISO timestamp of the last write to this codex (across any device). */
  lastUpdatedAt: string | null;
  /** Which device family last wrote — used for dev/main cross-sync UX. */
  lastUpdatedDevice: "dev" | "main";
}

/**
 * The exported-backup JSON shape (`version: "1.2"` — the historical string
 * that OuronetUI has written since well before the extraction began).
 *
 * A codex backup is a subset of PlaintextCodex: no schemaVersion /
 * lastUpdatedAt / lastUpdatedDevice (those are device-local), and no
 * pureKeypairs in this historical shape (they ship inside `cloud-backup`
 * alongside user settings — see the `downloadAsJson` → `exportForCloud`
 * split in OuronetUI's LocalStorageCodexAdapter). The `"1.2"` label
 * stays because a bump would break every existing user's recovery file.
 */
export interface CodexExportV1_2<
  KadenaSeed       = unknown,
  OuroAccount      = unknown,
  AddressBookEntry = unknown,
  UiSettings       = unknown,
> {
  version: "1.2";
  exportedAt: string;
  kadenaWallets: KadenaSeed[];
  ouronetWallets: OuroAccount[];
  addressBook: AddressBookEntry[];
  uiSettings: UiSettings;
}
