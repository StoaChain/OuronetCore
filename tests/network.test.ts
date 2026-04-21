/**
 * node-failover.ts regression suite — Phase -1.2 safety net.
 *
 * Tests the pure URL-construction + config + failover logic. The real
 * fetch calls are mocked so we never hit a network in CI.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getActiveBaseUrl,
  getActiveHost,
  getActivePactUrl,
  getActiveSpvUrl,
  getActiveGasLimit,
  getNodeGasLimit,
  getNodeConfig,
  getCurrentNodeStatus,
  setNodeConfig,
  withFailover,
  CHAINWEB_DEFAULT_GAS_LIMIT,
} from "../src/network";

const NODE2 = "https://node2.stoachain.com";
const NODE1 = "https://node1.stoachain.com";

// Reset to the default node2 state before every test
beforeEach(() => {
  setNodeConfig("node2");
});

// ══ setNodeConfig + getNodeConfig ═════════════════════════════════════════════
describe("setNodeConfig / getNodeConfig", () => {
  it("default (node2): primary=node2, fallback=node1", () => {
    setNodeConfig("node2");
    const cfg = getNodeConfig();
    expect(cfg.primary).toBe(NODE2);
    expect(cfg.fallback).toBe(NODE1);
  });

  it("node1 selected: primary=node1, fallback=node2", () => {
    setNodeConfig("node1");
    const cfg = getNodeConfig();
    expect(cfg.primary).toBe(NODE1);
    expect(cfg.fallback).toBe(NODE2);
  });

  it("custom URL: primary=custom, fallback=node2", () => {
    setNodeConfig("custom", "https://my-node.example.com");
    const cfg = getNodeConfig();
    expect(cfg.primary).toBe("https://my-node.example.com");
    expect(cfg.fallback).toBe(NODE2);
  });

  it("custom without URL falls through to node2 default", () => {
    setNodeConfig("custom", undefined);  // missing customUrl → default behaviour
    const cfg = getNodeConfig();
    expect(cfg.primary).toBe(NODE2);
    expect(cfg.fallback).toBe(NODE1);
  });

  it("setNodeConfig resets active host to primary", () => {
    setNodeConfig("node1");
    expect(getActiveHost()).toBe(NODE1);
    setNodeConfig("node2");
    expect(getActiveHost()).toBe(NODE2);
  });
});

// ══ getActiveGasLimit / getNodeGasLimit ═══════════════════════════════════════
describe("getActiveGasLimit / getNodeGasLimit", () => {
  it("node2 active → 2,000,000", () => {
    setNodeConfig("node2");
    expect(getActiveGasLimit()).toBe(2_000_000);
  });

  it("node1 active → 2,000,000 (both canonical Stoa nodes have same limit)", () => {
    setNodeConfig("node1");
    expect(getActiveGasLimit()).toBe(2_000_000);
  });

  it("custom node with override → uses the override", () => {
    setNodeConfig("custom", "https://unknown-host.example.com", 500_000);
    expect(getActiveGasLimit()).toBe(500_000);
  });

  it("custom node without override → falls back to chainweb default", () => {
    setNodeConfig("custom", "https://unknown-host.example.com");
    expect(getActiveGasLimit()).toBe(CHAINWEB_DEFAULT_GAS_LIMIT);
  });

  it("CHAINWEB_DEFAULT_GAS_LIMIT is 1_600_000", () => {
    expect(CHAINWEB_DEFAULT_GAS_LIMIT).toBe(1_600_000);
  });

  it("getNodeGasLimit queries presets by name", () => {
    setNodeConfig("custom", "x", 777_777);
    expect(getNodeGasLimit("node2")).toBe(2_000_000);
    expect(getNodeGasLimit("node1")).toBe(2_000_000);
    expect(getNodeGasLimit("custom")).toBe(777_777);
  });
});

// ══ URL construction ══════════════════════════════════════════════════════════
describe("URL construction (getActiveBaseUrl / getActivePactUrl / getActiveSpvUrl)", () => {
  beforeEach(() => {
    setNodeConfig("node2");
  });

  it("getActiveBaseUrl includes chainweb path + network", () => {
    const url = getActiveBaseUrl();
    expect(url).toBe(`${NODE2}/chainweb/0.0/stoa`);
  });

  it("getActivePactUrl builds chain-scoped Pact endpoint", () => {
    expect(getActivePactUrl("0")).toBe(`${NODE2}/chainweb/0.0/stoa/chain/0/pact`);
    expect(getActivePactUrl("3")).toBe(`${NODE2}/chainweb/0.0/stoa/chain/3/pact`);
  });

  it("getActiveSpvUrl builds chain-scoped SPV endpoint", () => {
    expect(getActiveSpvUrl("0")).toBe(`${NODE2}/chainweb/0.0/stoa/chain/0/pact/spv`);
  });

  it("reflects active host switch when node changes", () => {
    setNodeConfig("node1");
    expect(getActivePactUrl("0")).toBe(`${NODE1}/chainweb/0.0/stoa/chain/0/pact`);
  });
});

// ══ getCurrentNodeStatus ══════════════════════════════════════════════════════
describe("getCurrentNodeStatus", () => {
  it("returns primary + fallback + active + isOnPrimary flag", () => {
    setNodeConfig("node2");
    const s = getCurrentNodeStatus();
    expect(s.primary).toBe(NODE2);
    expect(s.fallback).toBe(NODE1);
    expect(s.active).toBe(NODE2);
    expect(s.isOnPrimary).toBe(true);
  });
});

// ══ withFailover — the actual resilience logic ═══════════════════════════════
describe("withFailover — primary-fallback retry", () => {
  beforeEach(() => {
    setNodeConfig("node2");
  });

  it("returns fn result immediately on success (no retry)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withFailover(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(`${NODE2}/chainweb/0.0/stoa`);
  });

  it("switches to fallback + retries on 'Failed to fetch' error", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce("ok-on-fallback");
    const result = await withFailover(fn);
    expect(result).toBe("ok-on-fallback");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, `${NODE2}/chainweb/0.0/stoa`);
    expect(fn).toHaveBeenNthCalledWith(2, `${NODE1}/chainweb/0.0/stoa`);
    expect(getCurrentNodeStatus().active).toBe(NODE1);
  });

  it("switches on NetworkError", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("NetworkError when attempting to fetch resource"))
      .mockResolvedValueOnce("ok");
    await withFailover(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("switches on ECONNREFUSED", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:443"))
      .mockResolvedValueOnce("ok");
    await withFailover(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("switches on AbortError (timeout signal)", async () => {
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    const fn = vi.fn()
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce("ok");
    await withFailover(fn);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT failover on non-network errors (Pact / business errors)", async () => {
    // Pact errors have messages like "tx-result: Failure" — not network failures
    const businessErr = new Error("tx-result: Failure: row-not-found");
    const fn = vi.fn().mockRejectedValue(businessErr);
    await expect(withFailover(fn)).rejects.toThrow("tx-result: Failure");
    // fn must be called only once — no retry on fallback
    expect(fn).toHaveBeenCalledTimes(1);
    // Active host stays on primary
    expect(getCurrentNodeStatus().active).toBe(NODE2);
  });

  it("does NOT retry if already on fallback and fails again", async () => {
    // First call: failover from NODE2 → NODE1 (first network error)
    const fn1 = vi.fn()
      .mockRejectedValueOnce(new Error("Failed to fetch"))
      .mockResolvedValueOnce("ok");
    await withFailover(fn1);
    expect(getCurrentNodeStatus().active).toBe(NODE1);

    // Second call: already on fallback, a network error must throw (no double-retry)
    const fn2 = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    await expect(withFailover(fn2)).rejects.toThrow("Failed to fetch");
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
