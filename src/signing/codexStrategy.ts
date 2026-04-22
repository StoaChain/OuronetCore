/**
 * CodexSigningStrategy — the canonical SigningStrategy implementation.
 *
 * Reproduces the A–F pipeline that every CFM modal's `handleExecute`
 * currently duplicates (see OuronetUI commit history — 23 identical copies
 * with ~43 lines each). When a CFM modal calls `strategy.execute({...})`
 * with a build closure + guards, this class runs the full simulate →
 * calibrate gas → sign → submit dance and returns the request key.
 *
 * Not tied to browser or server. Consumers supply:
 *   - a `KeyResolver` (OuronetUI: ReduxCodexResolver; HUB: FileCodexResolver)
 *   - a `PactClient` (browser: cf-worker URL; server: direct Stoa URL)
 * and the strategy does the rest.
 *
 * The `sign(...)` method is a lower-level primitive for callers that need
 * to control their own simulation flow — it just takes a pre-built tx +
 * specific keypairs and produces a signed result.
 */

import type { ICommand, IUnsignedCommand } from "@kadena/types";
import { analyzeGuard, selectCapsSigningKey } from "../guard";
import type { IKeyset } from "../guard";
import { calculateAutoGasLimit } from "../gas";
import { fromKeypair, universalSignTransaction } from "./universalSign";
import type {
  IKadenaKeypair,
  KeyResolver,
  PactClient,
  SigningStrategy,
} from "./types";

export class CodexSigningStrategy implements SigningStrategy {
  constructor(
    public readonly resolver: KeyResolver,
    public readonly client:   PactClient,
  ) {}

  /**
   * Full execute pipeline. Mirrors the A–F shape from CFM handleExecute:
   *   A. Read guards (caller provides)
   *   B. Build codex pub set (resolver)
   *   C. Analyze each guard → codexKeys / foreignKeys / threshold
   *   D. Collect keypairs for every required signer (resolver)
   *   E. Select GAS_PAYER caps key, avoiding pure-signer overlap
   *   F. Build tx → simulate → calibrate gas → rebuild → sign → submit
   */
  async execute(args: {
    build: (ctx: {
      gasLimit: number;
      capsKeyPub: string;
      guardPubs: string[];
    }) => IUnsignedCommand;
    guards: IKeyset[];
    paymentKey?: string | null;
    resolvedForeignKeys?: Record<string, string>;
  }): Promise<{ requestKey: string; raw: any }> {
    const { build, guards, paymentKey = null, resolvedForeignKeys = {} } = args;

    // ── B. Codex pub set ─────────────────────────────────────────────
    const codexPubs = await this.resolver.listCodexPubs();

    // ── C + D. Analyze each guard and collect pure-signer keypairs ───
    const guardKeypairs: IKadenaKeypair[] = [];
    const seenGuardPub = new Set<string>();
    const pureSigningPubs = new Set<string>();

    for (const guard of guards) {
      const analysis = analyzeGuard(guard, codexPubs, resolvedForeignKeys);
      // Iterate codex-signable keys then resolved-foreign keys, stopping
      // at the threshold (analyzeGuard already deduped them).
      const available = [
        ...analysis.codexKeys,
        ...analysis.resolvedForeignKeys,
      ];
      const needed = available.slice(0, analysis.threshold);

      for (const pub of needed) {
        if (seenGuardPub.has(pub)) continue;
        seenGuardPub.add(pub);
        pureSigningPubs.add(pub);

        // Resolved-foreign keys came in via resolvedForeignKeys (a raw
        // 64-char private key the user pasted into ForeignKeySignModal
        // or similar). The resolver doesn't know them — synthesize the
        // keypair inline. Codex keys go through the resolver which
        // handles password prompts + HD derivation.
        let kp: IKadenaKeypair;
        if (analysis.resolvedForeignKeys.includes(pub)) {
          const privateKey = resolvedForeignKeys[pub];
          kp = { publicKey: pub, privateKey, seedType: "foreign" };
        } else {
          kp = await this.resolver.getKeyPairByPublicKey(pub);
        }
        guardKeypairs.push(kp);
      }
    }

    // ── E. Select the GAS_PAYER caps key ─────────────────────────────
    const caps = selectCapsSigningKey(paymentKey, codexPubs, pureSigningPubs);
    if (caps.impossible) {
      throw new Error(
        "[CodexSigningStrategy] No GAS_PAYER key available — the payment " +
          "key is the only Codex key and it's already required for guard signing. " +
          "Rotate the guard to include another Codex key, or switch payment key.",
      );
    }
    if (!caps.key) {
      throw new Error(
        "[CodexSigningStrategy] No Codex key available for GAS_PAYER. " +
          "At least one Codex key must be free of guard-signing duty.",
      );
    }
    const capsKeypair = await this.resolver.getKeyPairByPublicKey(caps.key);

    // ── F. Build → simulate → calibrate gas → rebuild → sign → submit
    const guardPubs = guardKeypairs.map((k) => k.publicKey);
    const buildCtx = (gasLimit: number) => ({
      gasLimit,
      capsKeyPub: capsKeypair.publicKey,
      guardPubs,
    });

    const sim = build(buildCtx(500_000));
    const simResult = await this.client.dirtyRead(sim);
    if (simResult?.result?.status === "failure") {
      const msg =
        simResult.result?.error?.message ||
        "[CodexSigningStrategy] Simulation failed";
      throw new Error(msg);
    }
    const gasLimit = await calculateAutoGasLimit(simResult?.gas ?? 500_000);

    const tx = build(buildCtx(gasLimit));

    // Dedup all signers by pubkey (caps might overlap with a guard pub in
    // edge cases where selectCapsSigningKey fell through; we still safely
    // collapse duplicates before handing them to universalSignTransaction).
    const signed = await this.sign({
      tx,
      capsKey: capsKeypair,
      guardKeypairs,
    });

    const raw = await this.client.submit(signed);
    const requestKey: string = (raw as any)?.requestKey ?? "";
    return { requestKey, raw };
  }

  /**
   * Sign a pre-built tx with the supplied keypairs. Pure — doesn't touch
   * the resolver or the client. Useful for callers that simulate via
   * their own path or batch-build multiple txs before signing.
   */
  async sign(args: {
    tx:            IUnsignedCommand;
    capsKey:       IKadenaKeypair;
    guardKeypairs: IKadenaKeypair[];
  }): Promise<ICommand> {
    const { tx, capsKey, guardKeypairs } = args;

    const seen = new Set<string>();
    const deduped: IKadenaKeypair[] = [];
    for (const kp of [capsKey, ...guardKeypairs]) {
      if (seen.has(kp.publicKey)) continue;
      seen.add(kp.publicKey);
      deduped.push(kp);
    }

    // Forward requestForeignKey if the resolver supports it — universalSign
    // calls it when a signer pubkey in the tx isn't in the supplied pairs.
    const onMissingKey = this.resolver.requestForeignKey
      ? (pub: string) => this.resolver.requestForeignKey!(pub)
      : undefined;

    const universalKeypairs = deduped.map((kp) => fromKeypair(kp));
    const signed = await universalSignTransaction(
      tx,
      universalKeypairs,
      onMissingKey,
    );
    return signed as ICommand;
  }
}
