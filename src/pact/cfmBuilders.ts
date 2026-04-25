/**
 * CFM Pact-code builders — string construction for every Pact function
 * the 23 OuronetUI CFM modals call.
 *
 * Background. Each CFM modal builds a Pact-code string like
 *   `(ouronet-ns.TS01-C2.ATS|C_Coil "<patron>" "<coiler>" "<ats>" "<rt>" <amount>)`
 * and hands it to `strategy.execute({ build })`. Historically these
 * strings lived inside the modal as a template literal — convenient
 * but impossible to test without rendering the React component, so
 * a typo (`C_Coyl`, missing quote, wrong namespace) only surfaced
 * when a user clicked the button and the chain rejected the tx.
 *
 * This module extracts each Pact-function-specific string builder
 * into a pure function. Modals import the builder and pass the
 * returned string to `Pact.builder.execution(...)`. Tests in
 * `tests/cfm-builders.test.ts` verify every builder produces the
 * exact expected shape for a canonical input set.
 *
 * No React, no @kadena/client, no crypto. Just string templating
 * with `formatDecimalForPact` for the amount fields. Works on
 * Node + browser + any JS environment.
 *
 * Naming convention. Each builder is `buildX_PactCode(params)`
 * where `X` is the Pact function name (C_Coil, C_Transfer, etc.).
 * Return type is always `string`.
 *
 * All Pact function names the ecosystem currently ships are covered.
 * When a new CFM modal lands, add its builder here + a test; don't
 * inline the Pact code in the modal.
 */

import { KADENA_NAMESPACE } from "../constants";
import { formatDecimalForPact } from "./format";

// ─── TS01-C1 family (DPTF — Dynamic Pooled Token Functions) ──────────────────

/**
 * Transfer. The most-called CFM function across the UI — all 9
 * Transfer* modals emit this shape, differing only in token-id.
 *
 *   (ouronet-ns.TS01-C1.DPTF|C_Transfer
 *     <patron> <token-id> <sender> <receiver> <amount:decimal> <method:bool>)
 *
 * `method` is `false` for standard accounts and `true` for smart
 * accounts. `amount` is formatted to `x.y` decimal form.
 */
export function buildTransferPactCode(p: {
  patron:   string;
  tokenId:  string;
  sender:   string;
  receiver: string;
  amount:   string;
  method:   boolean;
}): string {
  const dec = formatDecimalForPact(p.amount);
  return `(${KADENA_NAMESPACE}.TS01-C1.DPTF|C_Transfer "${p.patron}" "${p.tokenId}" "${p.sender}" "${p.receiver}" ${dec} ${p.method})`;
}

/**
 * Clear Ouroboros Dispo. Triggered when a resident has negative virtual
 * OURO; this zeroes the dispo by burning from the patron.
 *
 *   (ouronet-ns.TS01-C1.DPTF|C_ClearDispo <patron> <account>)
 */
export function buildClearDispoPactCode(p: {
  patron:  string;
  account: string;
}): string {
  return `(${KADENA_NAMESPACE}.TS01-C1.DPTF|C_ClearDispo "${p.patron}" "${p.account}")`;
}

// ─── TS01-C2.ORBR family (Ouroboros) ─────────────────────────────────────────

/**
 * Sublimate OURO → IGNIS. Patronless (gasless for the user —
 * STOA_AUTONOMIC_OURONETGASSTATION pays the chain gas). `target` is
 * usually the same as `client` (self-sublimate) but can be another
 * account for gift-style flows.
 *
 *   (ouronet-ns.TS01-C2.ORBR|C_Sublimate <client> <target> <amount:decimal>)
 */
export function buildSublimatePactCode(p: {
  client: string;
  target: string;
  amount: string;
}): string {
  const dec = formatDecimalForPact(p.amount);
  return `(${KADENA_NAMESPACE}.TS01-C2.ORBR|C_Sublimate "${p.client}" "${p.target}" ${dec})`;
}

/**
 * Compress IGNIS → OURO. Patronless, integer-valued amount only.
 * `formatDecimalForPact` still runs on the amount string because the
 * Pact `decimal` lexer rejects bare integers.
 *
 *   (ouronet-ns.TS01-C2.ORBR|C_Compress <client> <ignis-amount:decimal>)
 */
export function buildCompressPactCode(p: {
  client:      string;
  ignisAmount: string;
}): string {
  const dec = formatDecimalForPact(p.ignisAmount);
  return `(${KADENA_NAMESPACE}.TS01-C2.ORBR|C_Compress "${p.client}" ${dec})`;
}

// ─── TS01-C2.ATS family (Autostake Pools) ────────────────────────────────────

/**
 * Coil — deposit reward-token into an autostake pool.
 *
 *   (ouronet-ns.TS01-C2.ATS|C_Coil
 *     <patron> <coiler> <ats> <rt> <amount:decimal>)
 */
export function buildCoilPactCode(p: {
  patron:        string;
  coiler:        string;
  atsId:         string;
  rewardTokenId: string;
  amount:        string;
}): string {
  const dec = formatDecimalForPact(p.amount);
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Coil "${p.patron}" "${p.coiler}" "${p.atsId}" "${p.rewardTokenId}" ${dec})`;
}

/**
 * Curl — deposit reward-token through TWO autostake pools (e.g. OURO
 * through Auryndex + EliteAuryndex in one call).
 *
 *   (ouronet-ns.TS01-C2.ATS|C_Curl
 *     <patron> <curler> <ats1> <ats2> <rt> <amount:decimal>)
 */
export function buildCurlPactCode(p: {
  patron:        string;
  curler:        string;
  ats1Id:        string;
  ats2Id:        string;
  rewardTokenId: string;
  amount:        string;
}): string {
  const dec = formatDecimalForPact(p.amount);
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Curl "${p.patron}" "${p.curler}" "${p.ats1Id}" "${p.ats2Id}" "${p.rewardTokenId}" ${dec})`;
}

/**
 * Brumate — locked Curl. Same shape as Curl plus a `dayz` lock-period
 * integer.
 *
 *   (ouronet-ns.TS01-C2.ATS|C_Brumate
 *     <patron> <brumator> <ats1> <ats2> <rt> <amount:decimal> <dayz:integer>)
 */
export function buildBrumatePactCode(p: {
  patron:        string;
  brumator:      string;
  ats1Id:        string;
  ats2Id:        string;
  rewardTokenId: string;
  amount:        string;
  lockDays:      number;
}): string {
  const dec = formatDecimalForPact(p.amount);
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Brumate "${p.patron}" "${p.brumator}" "${p.ats1Id}" "${p.ats2Id}" "${p.rewardTokenId}" ${dec} ${p.lockDays})`;
}

/**
 * Constrict — locked Coil. Same shape as Coil plus a `dayz` lock-period
 * integer.
 *
 *   (ouronet-ns.TS01-C2.ATS|C_Constrict
 *     <patron> <constricter> <ats> <rt> <amount:decimal> <dayz:integer>)
 */
export function buildConstrictPactCode(p: {
  patron:        string;
  constricter:   string;
  atsId:         string;
  rewardTokenId: string;
  amount:        string;
  lockDays:      number;
}): string {
  const dec = formatDecimalForPact(p.amount);
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Constrict "${p.patron}" "${p.constricter}" "${p.atsId}" "${p.rewardTokenId}" ${dec} ${p.lockDays})`;
}

/**
 * Cold recovery — withdraw from an autostake pool with the full lockout
 * reward schedule.
 *
 *   (ouronet-ns.TS01-C2.ATS|C_ColdRecovery
 *     <patron> <recoverer> <ats> <ra:decimal>)
 */
export function buildColdRecoveryPactCode(p: {
  patron:    string;
  recoverer: string;
  atsId:     string;
  ra:        string;
}): string {
  const dec = formatDecimalForPact(p.ra);
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_ColdRecovery "${p.patron}" "${p.recoverer}" "${p.atsId}" ${dec})`;
}

/**
 * Direct recovery — withdraw immediately with the smaller non-lockout
 * reward.
 *
 *   (ouronet-ns.TS01-C2.ATS|C_DirectRecovery
 *     <patron> <recoverer> <ats> <ra:decimal>)
 */
export function buildDirectRecoveryPactCode(p: {
  patron:    string;
  recoverer: string;
  atsId:     string;
  ra:        string;
}): string {
  const dec = formatDecimalForPact(p.ra);
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_DirectRecovery "${p.patron}" "${p.recoverer}" "${p.atsId}" ${dec})`;
}

/**
 * Cull — harvest rewards from a single autostake pool position.
 *
 *   (ouronet-ns.TS01-C2.ATS|C_Cull <patron> <culler> <ats>)
 */
export function buildCullPactCode(p: {
  patron:  string;
  culler:  string;
  atsId:   string;
}): string {
  return `(${KADENA_NAMESPACE}.TS01-C2.ATS|C_Cull "${p.patron}" "${p.culler}" "${p.atsId}")`;
}

// ─── TS01-C2.VST family (Virtual Stoa Tokens — GSTOA hibernation) ────────────

/**
 * Awake — wake a hibernated GSTOA nonce.
 *
 *   (ouronet-ns.TS01-C2.VST|C_Awake
 *     <patron> <awaker> <dpof> <nonce:integer>)
 */
export function buildAwakePactCode(p: {
  patron: string;
  awaker: string;
  dpof:   string;
  nonce:  number;
}): string {
  return `(${KADENA_NAMESPACE}.TS01-C2.VST|C_Awake "${p.patron}" "${p.awaker}" "${p.dpof}" ${p.nonce})`;
}

/**
 * Slumber — hibernate one or more GSTOA nonces. The `nonces` list is
 * rendered as Pact's `[n1 n2 n3]` integer-list literal.
 *
 *   (ouronet-ns.TS01-C2.VST|C_Slumber
 *     <patron> <merger> <dpof> <nonces:[integer]>)
 */
export function buildSlumberPactCode(p: {
  patron: string;
  merger: string;
  dpof:   string;
  nonces: number[];
}): string {
  const nonceList = `[${p.nonces.join(" ")}]`;
  return `(${KADENA_NAMESPACE}.TS01-C2.VST|C_Slumber "${p.patron}" "${p.merger}" "${p.dpof}" ${nonceList})`;
}

// ─── TS01-C3.SWP family (Swap — Firestarter) ─────────────────────────────────

/**
 * Firestarter — wrap 10 native STOA → 10 wSTOA. One-time, gasless for
 * the user, payment key signs coin.TRANSFER.
 *
 *   (ouronet-ns.TS01-C3.SWP|C_Firestarter <firestarter>)
 */
export function buildFirestarterPactCode(p: {
  firestarter: string;
}): string {
  return `(${KADENA_NAMESPACE}.TS01-C3.SWP|C_Firestarter "${p.firestarter}")`;
}

// ─── TS01-C1.DALOS family (Smart Ouronet Account mutations) ──────────────────

/**
 * Rotate Sovereign — change the sovereign account that has primary
 * authority over a Smart Ouronet Account (Σ. prefix).
 *
 * Smart-account auth is `enforce-one` over three branches:
 *   (a) the Smart account's own guard,
 *   (b) the current sovereign account's guard,
 *   (c) the Smart account's governor.
 * Any one branch satisfying its predicate authorises the rotation.
 *
 *   (ouronet-ns.TS01-C1.DALOS|C_RotateSovereign
 *     <patron> <account> <new-sovereign>)
 *
 * `account` is the Σ. Smart account being modified. `new-sovereign`
 * must be an existing Standard Ouronet Account (Ѻ. prefix); the chain
 * rejects Σ. → Σ. rotations because Smart accounts cannot be
 * sovereigns themselves.
 *
 * Added in v1.6.0.
 */
export function buildRotateSovereignPactCode(p: {
  patron:       string;
  account:      string;
  newSovereign: string;
}): string {
  return `(${KADENA_NAMESPACE}.TS01-C1.DALOS|C_RotateSovereign "${p.patron}" "${p.account}" "${p.newSovereign}")`;
}
