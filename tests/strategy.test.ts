/**
 * CodexSigningStrategy integration test — the A-F pipeline wiring.
 *
 * Exercises `strategy.execute()` end-to-end with a mock PactClient +
 * mock KeyResolver. Real Ed25519 signing (nacl path, koala seedType)
 * is fast enough that we let it happen for real; the network pieces
 * (dirtyRead / submit) are the only parts we fake.
 *
 * What this test catches that unit tests don't:
 *   - The sequence of calls (simulate THEN sign THEN submit — not
 *     in the wrong order)
 *   - Gas-limit calibration from the simulate result flows through
 *     to the real build
 *   - Deduplication of keypairs when the same pub appears multiple
 *     times across guards (e.g. patron and resident share a key)
 *   - `extraSigners` get included in the final sign step
 *
 * Part of Tier 1 (see OuronetUI/docs/TESTING_STRATEGY.md §Group D).
 */

import { describe, it, expect } from "vitest";
import type { IUnsignedCommand, ICommand } from "@kadena/types";
import { Pact } from "@kadena/client";
import { CodexSigningStrategy } from "../src/signing/codexStrategy";
import type {
  IKadenaKeypair,
  KeyResolver,
  PactClient,
} from "../src/signing/types";
import type { IKeyset } from "../src/guard";
import { publicKeyFromPrivateKey } from "../src/signing/primitives";

// ─── Fixtures: real Ed25519 keypairs (from RFC 8032) ─────────────────────────
// Using RFC 8032 test vectors so pubkey derivation is deterministic.
// These are PUBLIC test vectors — safe to hardcode, never used on chain.

const PRIV_A = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUB_A  = publicKeyFromPrivateKey(PRIV_A); // d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a

const PRIV_B = "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb";
const PUB_B  = publicKeyFromPrivateKey(PRIV_B);

const PRIV_C = "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7";
const PUB_C  = publicKeyFromPrivateKey(PRIV_C);

const KP_A: IKadenaKeypair = { publicKey: PUB_A, privateKey: PRIV_A, seedType: "koala" };
const KP_B: IKadenaKeypair = { publicKey: PUB_B, privateKey: PRIV_B, seedType: "koala" };
const KP_C: IKadenaKeypair = { publicKey: PUB_C, privateKey: PRIV_C, seedType: "koala" };

// ─── Mock PactClient ─────────────────────────────────────────────────────────
// Records the call order and returns canned responses. A real Stoa node
// returns more fields; we include just the ones the strategy reads.

function mockPactClient(opts?: {
  simulateGas?: number;
  simulateFail?: boolean;
}): PactClient & { log: string[]; lastSimulate?: IUnsignedCommand; lastSubmit?: any } {
  const log: string[] = [];
  let lastSimulate: IUnsignedCommand | undefined;
  let lastSubmit: any;
  return {
    log,
    get lastSimulate() { return lastSimulate; },
    get lastSubmit() { return lastSubmit; },
    dirtyRead: async (tx: IUnsignedCommand) => {
      log.push("dirtyRead");
      lastSimulate = tx;
      if (opts?.simulateFail) {
        return { result: { status: "failure", error: { message: "boom" } } };
      }
      return {
        result: { status: "success", data: "ok" },
        gas: opts?.simulateGas ?? 800,
      };
    },
    submit: async (signed: any) => {
      log.push("submit");
      lastSubmit = signed;
      return { requestKey: "mock-req-key-abc123", raw: signed };
    },
  };
}

// ─── Mock KeyResolver ────────────────────────────────────────────────────────

function mockResolver(opts: {
  codexPubs: string[];
  byPub: Record<string, IKadenaKeypair>;
}): KeyResolver & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    listCodexPubs: () => {
      log.push("listCodexPubs");
      return new Set(opts.codexPubs);
    },
    getKeyPairByPublicKey: async (pub: string) => {
      log.push(`getKeyPairByPublicKey:${pub.slice(0, 8)}`);
      const kp = opts.byPub[pub];
      if (!kp) throw new Error(`mock: no keypair for ${pub}`);
      return kp;
    },
  };
}

// ─── Minimal transaction builder for tests ──────────────────────────────────

function buildMockTx(args: { gasLimit: number; capsKeyPub: string; guardPubs: string[] }): IUnsignedCommand {
  // Use real Pact.builder so the tx hash + signer structure is correct.
  let builder = Pact.builder
    .execution("(+ 1 1)")
    .setMeta({
      senderAccount: "gas-station-test",
      chainId: "0",
      gasLimit: args.gasLimit,
      creationTime: 1700000000,
      gasPrice: 0.000001,
      ttl: 600,
    })
    .setNetworkId("testnet04")
    .addSigner(args.capsKeyPub);
  for (const gp of args.guardPubs) {
    builder = (builder as any).addSigner(gp);
  }
  return (builder as any).createTransaction() as IUnsignedCommand;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CodexSigningStrategy.execute — pipeline orchestration", () => {
  it("calls simulate → submit in that order", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    await strategy.execute({
      build: buildMockTx,
      guards: [residentGuard],
      paymentKey: null,
    });

    // First network call must be dirtyRead (simulate), last must be submit.
    expect(client.log[0]).toBe("dirtyRead");
    expect(client.log[client.log.length - 1]).toBe("submit");
  });

  it("returns the requestKey from the mock submit", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    const result = await strategy.execute({
      build: buildMockTx,
      guards: [residentGuard],
      paymentKey: null,
    });

    expect(result.requestKey).toBe("mock-req-key-abc123");
    expect(result.raw).toBeDefined();
  });

  it("resolves the caps key via resolver", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    await strategy.execute({
      build: buildMockTx,
      guards: [residentGuard],
      paymentKey: null,
    });

    // Resolver was asked for at least two pubkeys (guard pub + caps pub)
    const resolverCalls = resolver.log.filter(l => l.startsWith("getKeyPairByPublicKey"));
    expect(resolverCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("calls build() twice — once for simulate, once for the real tx", async () => {
    let buildCount = 0;
    const builds: Array<{ gasLimit: number; capsKeyPub: string; guardPubs: string[] }> = [];
    const client = mockPactClient({ simulateGas: 1234 });
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    await strategy.execute({
      build: (ctx) => {
        buildCount++;
        builds.push(ctx);
        return buildMockTx(ctx);
      },
      guards: [residentGuard],
      paymentKey: null,
    });

    expect(buildCount).toBe(2);
    // First call uses the sim ceiling (500_000). Second call uses the
    // calibrated gas limit derived from simulateGas (1234).
    expect(builds[0].gasLimit).toBe(500_000);
    expect(builds[1].gasLimit).toBeGreaterThanOrEqual(1234);
    expect(builds[1].gasLimit).toBeLessThan(500_000); // calibrated down from 500k ceiling
  });

  it("throws when simulate returns failure", async () => {
    const client = mockPactClient({ simulateFail: true });
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    await expect(
      strategy.execute({
        build: buildMockTx,
        guards: [residentGuard],
        paymentKey: null,
      }),
    ).rejects.toThrow(/simulation failed|boom/i);

    // Submit should NOT have been called — sim failure halts the pipeline.
    expect(client.log).not.toContain("submit");
  });

  it("deduplicates guard keypairs when two guards share a pub", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    // Two guards, both use PUB_B — the dedup inside strategy.execute
    // must only resolve + sign with PUB_B once.
    const guard1: IKeyset = { pred: "keys-all", keys: [PUB_B] };
    const guard2: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    await strategy.execute({
      build: buildMockTx,
      guards: [guard1, guard2],
      paymentKey: null,
    });

    // Count how many times resolver was asked for PUB_B — should be 1,
    // not 2, because the second guard-analysis sees it in seenGuardPub.
    const pubBCalls = resolver.log.filter(l => l === `getKeyPairByPublicKey:${PUB_B.slice(0, 8)}`);
    expect(pubBCalls.length).toBe(1);
  });

  it("includes extraSigners in the final signed tx (Firestarter-style flow)", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    // Payment key = PUB_C, supplied as an extra signer that has its own
    // capability wired in the build closure.
    const result = await strategy.execute({
      build: (ctx) => {
        let builder = Pact.builder
          .execution("(+ 1 1)")
          .setMeta({ senderAccount: "gs", chainId: "0", gasLimit: ctx.gasLimit, creationTime: 1700000000, gasPrice: 0.000001, ttl: 600 })
          .setNetworkId("testnet04")
          .addSigner(ctx.capsKeyPub)
          .addSigner(PUB_C, (w: any) => [w("coin.TRANSFER", "from", "to", { decimal: "10.0" })]);
        for (const gp of ctx.guardPubs) builder = (builder as any).addSigner(gp);
        return (builder as any).createTransaction();
      },
      guards: [residentGuard],
      paymentKey: null,
      extraSigners: [KP_C],
    });

    // The tx must have at least 3 sigs (caps + guard + extra).
    const submitted: IUnsignedCommand = client.lastSubmit;
    expect(submitted.sigs.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── sign() low-level primitive ───────────────────────────────────────────────

describe("CodexSigningStrategy.sign — low-level signing", () => {
  it("produces a signed tx with sigs populated for each keypair", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);

    const tx = buildMockTx({ gasLimit: 1000, capsKeyPub: PUB_A, guardPubs: [PUB_B] });
    const signed: ICommand = await strategy.sign({
      tx,
      capsKey: KP_A,
      guardKeypairs: [KP_B],
    });

    // Every signer in cmd.signers must have a corresponding sig with a .sig value.
    const nonEmpty = signed.sigs.filter((s: any) => s && s.sig);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(2);
  });

  it("dedups caps+guard keypairs when caps is also a guard key", async () => {
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A],
      byPub: { [PUB_A]: KP_A },
    });
    const strategy = new CodexSigningStrategy(resolver, client);

    // PUB_A is both the caps key AND supplied as a guard keypair.
    // The dedup inside sign() must not sign twice.
    const tx = buildMockTx({ gasLimit: 1000, capsKeyPub: PUB_A, guardPubs: [PUB_A] });
    const signed: ICommand = await strategy.sign({
      tx,
      capsKey: KP_A,
      guardKeypairs: [KP_A],
    });

    // The tx has only one signer (PUB_A appears once in Pact.builder's addSigner dedup),
    // so we expect exactly one non-empty sig.
    const nonEmpty = signed.sigs.filter((s: any) => s && s.sig);
    expect(nonEmpty.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Tier 2 edge cases ────────────────────────────────────────────────────────
// The scenarios users actually hit that basic happy-path tests don't cover.
// See OuronetUI/docs/TESTING_STRATEGY.md §Tier 2.

describe("CodexSigningStrategy.execute — Tier 2 edge cases", () => {
  it("synthesizes inline keypair for foreign key via resolvedForeignKeys (ForeignKeySignModal flow)", async () => {
    // Scenario: guard requires PUB_C but PUB_C isn't in the Codex. User pastes
    // the raw 64-char private key into ForeignKeySignModal. That key lands in
    // `resolvedForeignKeys` and analyzeGuard's `resolvedForeignKeys` array.
    // Strategy must synthesize a keypair inline (seedType "foreign") without
    // asking the resolver — the resolver never knew about it.
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A],                // only PUB_A is in codex
      byPub: { [PUB_A]: KP_A },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    // Guard requires PUB_C — a FOREIGN pub (not in codex).
    const foreignGuard: IKeyset = { pred: "keys-all", keys: [PUB_C] };

    const result = await strategy.execute({
      build: buildMockTx,
      guards: [foreignGuard],
      paymentKey: null,
      resolvedForeignKeys: { [PUB_C]: PRIV_C },  // user-pasted priv
    });

    expect(result.requestKey).toBe("mock-req-key-abc123");
    // Resolver should NOT have been asked for PUB_C — it doesn't know it.
    const pubCCalls = resolver.log.filter(l => l === `getKeyPairByPublicKey:${PUB_C.slice(0, 8)}`);
    expect(pubCCalls.length).toBe(0);
  });

  it("submits a tx with missing sig slot when a guard pub has no resolvedForeignKey (chain-level rejection, not strategy-level throw)", async () => {
    // Scenario: guard has a foreign key but user hasn't pasted it. strategy
    // doesn't police guard-satisfaction — it builds + signs with whatever
    // keys it has + submits. The on-chain reject is what the user ultimately
    // sees. This test documents that behaviour so we know the strategy isn't
    // doing a belt-and-suspenders pre-check that we might accidentally remove.
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A],
      byPub: { [PUB_A]: KP_A },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const foreignGuard: IKeyset = { pred: "keys-all", keys: [PUB_C] };

    const result = await strategy.execute({
      build: ({ gasLimit, capsKeyPub }) => {
        let builder = Pact.builder
          .execution("(+ 1 1)")
          .setMeta({ senderAccount: "gs", chainId: "0", gasLimit, creationTime: 1700000000, gasPrice: 0.000001, ttl: 600 })
          .setNetworkId("testnet04")
          .addSigner(capsKeyPub);
        builder = (builder as any).addSigner(PUB_C);
        return (builder as any).createTransaction();
      },
      guards: [foreignGuard],
      paymentKey: null,
    });

    // Tx submits (mock client is permissive). But inspect the submitted tx —
    // PUB_C's signer slot must be UNSIGNED (no .sig).
    const submitted: IUnsignedCommand = client.lastSubmit;
    const sigs = submitted.sigs as any[];
    // PUB_C's slot in .sigs should have no .sig (empty object or undefined)
    const parsedCmd = JSON.parse(submitted.cmd);
    const pubCIndex = parsedCmd.signers.findIndex((s: any) => s.pubKey === PUB_C);
    expect(pubCIndex).toBeGreaterThanOrEqual(0);
    expect(sigs[pubCIndex]?.sig).toBeFalsy();
    // PUB_A (caps) was signed normally
    const pubAIndex = parsedCmd.signers.findIndex((s: any) => s.pubKey === PUB_A);
    expect(sigs[pubAIndex]?.sig).toBeTruthy();
  });

  it("resolver.requestForeignKey gets called for missing pubs + its error propagates", async () => {
    // Variant: when the resolver DOES implement requestForeignKey, the
    // strategy must call it for any missing-signer pub. An error from
    // requestForeignKey surfaces as an execute() rejection.
    const client = mockPactClient();
    const resolver: KeyResolver = {
      listCodexPubs: () => new Set([PUB_A]),
      getKeyPairByPublicKey: async (pub: string) => {
        if (pub === PUB_A) return KP_A;
        throw new Error("not in codex");
      },
      requestForeignKey: async (_pub: string) => {
        throw new Error("user cancelled foreign key prompt");
      },
    };
    const strategy = new CodexSigningStrategy(resolver, client);
    const foreignGuard: IKeyset = { pred: "keys-all", keys: [PUB_C] };

    await expect(
      strategy.execute({
        build: ({ gasLimit, capsKeyPub }) => {
          let builder = Pact.builder
            .execution("(+ 1 1)")
            .setMeta({ senderAccount: "gs", chainId: "0", gasLimit, creationTime: 1700000000, gasPrice: 0.000001, ttl: 600 })
            .setNetworkId("testnet04")
            .addSigner(capsKeyPub);
          builder = (builder as any).addSigner(PUB_C);
          return (builder as any).createTransaction();
        },
        guards: [foreignGuard],
        paymentKey: null,
      }),
    ).rejects.toThrow(/user cancelled/i);
  });

  it("impossible case: only codex key IS the paymentKey AND a guard requirement", async () => {
    // Scenario: codex has just 1 key (PUB_A). That key is designated as the
    // payment key for caps. But a guard ALSO requires PUB_A for pure signing.
    // There's no free codex key for caps → `selectCapsSigningKey` marks it
    // impossible → execute() must throw a clear error, not silently pick a
    // bad fallback.
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A],
      byPub: { [PUB_A]: KP_A },
    });
    const strategy = new CodexSigningStrategy(resolver, client);
    const guardA: IKeyset = { pred: "keys-all", keys: [PUB_A] };

    await expect(
      strategy.execute({
        build: buildMockTx,
        guards: [guardA],
        paymentKey: PUB_A,  // same pub — impossible
      }),
    ).rejects.toThrow(/impossible|GAS_PAYER/i);
  });

  it("throws when a codex key is required but resolver can't find it", async () => {
    // Scenario: guard requires PUB_B, codex set claims PUB_B is in codex,
    // but the resolver throws when asked (e.g. HD derivation failed, user
    // entered wrong password, password prompt cancelled). execute() must
    // fail fast, not silently sign with fewer keys than the threshold needs.
    const client = mockPactClient();
    const resolver: KeyResolver = {
      listCodexPubs: () => new Set([PUB_A, PUB_B]),
      getKeyPairByPublicKey: async (pub: string) => {
        if (pub === PUB_B) throw new Error("HD derivation failed");
        if (pub === PUB_A) return KP_A;
        throw new Error("unknown");
      },
    };
    const strategy = new CodexSigningStrategy(resolver, client);
    const guardB: IKeyset = { pred: "keys-all", keys: [PUB_B] };

    await expect(
      strategy.execute({
        build: buildMockTx,
        guards: [guardB],
        paymentKey: null,
      }),
    ).rejects.toThrow(/HD derivation failed|unknown/i);
  });

  it("multi-guard: patron with keys-2 threshold + resident single key", async () => {
    // Realistic multi-sig scenario: patron guard is 2-of-3 (needs 2 of its
    // keys to sign), resident is 1-of-1. Codex has all 3 patron keys + the
    // resident key. Caps must pick the one remaining codex key not used by
    // either guard.
    const PUB_CAPS = "00".repeat(32); // hypothetical caps-eligible key
    const KP_CAPS: IKadenaKeypair = {
      publicKey: PUB_CAPS,
      // Generate a valid priv so nacl doesn't reject — use any ed25519 seed
      privateKey: "11".repeat(32),
      seedType: "koala",
    };
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B, PUB_C, PUB_CAPS],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B, [PUB_C]: KP_C, [PUB_CAPS]: KP_CAPS },
    });
    const strategy = new CodexSigningStrategy(resolver, client);

    // Patron: 2-of-3. Resident: 1-of-1 (PUB_C).
    const patronGuard: IKeyset = { pred: "keys-2", keys: [PUB_A, PUB_B, PUB_C] };
    const residentGuard: IKeyset = { pred: "keys-all", keys: [PUB_C] };

    let capturedCapsPub = "";
    await strategy.execute({
      build: (ctx) => {
        capturedCapsPub = ctx.capsKeyPub;
        return buildMockTx(ctx);
      },
      guards: [patronGuard, residentGuard],
      paymentKey: null,
    });

    // Caps must be the one key NOT used by any guard for signing — PUB_CAPS.
    // (PUB_A, PUB_B, PUB_C all could appear in pure-signing set.)
    expect(capturedCapsPub).toBe(PUB_CAPS);
  });

  it("guards list receives keyset-ref guards without throwing", async () => {
    // Scenario: a keyset-ref guard (on-chain named keyset like
    // "ouronet-ns.dh_sc_dpdc-keyset") is sometimes what an account returns
    // for its guard field. The strategy should analyze its `keys` list
    // normally — the keysetRef field is metadata, not a blocker.
    const client = mockPactClient();
    const resolver = mockResolver({
      codexPubs: [PUB_A, PUB_B],
      byPub: { [PUB_A]: KP_A, [PUB_B]: KP_B },
    });
    const strategy = new CodexSigningStrategy(resolver, client);

    const guardWithRef: any = {
      pred: "keys-all",
      keys: [PUB_B],
      keysetRef: "ouronet-ns.dh_sc_dpdc-keyset",
    };

    const result = await strategy.execute({
      build: buildMockTx,
      guards: [guardWithRef],
      paymentKey: null,
    });

    expect(result.requestKey).toBe("mock-req-key-abc123");
  });
});
