"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { canonicalize, sha256, ZERO_HASH } from "./crypto";
import { BASELINE_RULES, CONTRACT_ID, CONTRACT_NAME, generateContractCode } from "./contract-code";
import {
  check, consentIsUsable, evaluateEmergencyExtension, evaluateRule, grant, granteeLabel, latestConsentFor, revoke,
  type CheckRequest, type ContractEnv, type RuleOutcome,
} from "./contract";
import { CONSORTIUM_DID, makeDidDocument, patientDid, verifyCredential } from "./identity";
import { sealEvents, verifyLedger as verifyChain, type LedgerVerification } from "./ledger";
import { merkleRoot } from "./merkle";
import { QUORUM, simulatePbft, VALIDATORS } from "./pbft";
import { CATEGORY_LABEL, hasPermission, PERMISSION_LABEL, PURPOSE_LABEL, ROLE_LABEL } from "./rbac";
import { buildSeedState, SCHEMA_VERSION } from "./seed";
import type {
  AppState, Block, Consent, ContractVersion, DataRequest, EventKind, EventSubject, FinalDecision, Grantee, GranteeRef, GuidedState, HospitalId,
  LedgerEvent, NodeStatus, Permission, PbftRun, Policy, Proposal, ProposalType, Purpose, RecordCategory, RequestStatus,
  ReviewCheck, RuleEvaluation, RuleId, User, ValidatorId, Verification, Vote,
} from "./types";
import { fmtDateTime, pad } from "./utils";

const STORAGE_KEY = "medchain-state-v1";

interface Actor { name: string; did: string; role: string; hospitalId: HospitalId | null }
export interface LedgerEventInput {
  kind?: EventKind;
  action: string;
  result: string;
  explanation: string;
  requestId?: string | null;
  txId?: string;
  hospitalId?: HospitalId | null;
  actor?: Actor;
  details?: Record<string, unknown>;
  blockId?: string | null;
  patientId?: string; // for events not tied to a request (consent grant / revoke)
}
interface Ctx {
  now: Date; // demo-clock time used for contract decisions
  session: User;
  tx: () => string; // transaction ID for this action (allocated on first use)
  // The single entry point for writing to the ledger. Events are hashed (seal) and persisted
  // by commit() before any screen sees them.
  recordLedgerEvent: (e: LedgerEventInput) => LedgerEvent;
  seal: () => Promise<void>;
}

const NETWORK_ACTOR: Actor = { name: "PBFT Network (simulated)", did: CONSORTIUM_DID, role: "Consensus network", hospitalId: null };
const CONSORTIUM_ACTOR: Actor = { name: "MedChain Consortium", did: CONSORTIUM_DID, role: "System", hospitalId: null };
const CONTRACT_ACTOR: Actor = { name: `${CONTRACT_NAME} (${CONTRACT_ID})`, did: CONSORTIUM_DID, role: "Smart contract", hospitalId: null };

function actorOf(u: User): Actor {
  return { name: u.name, did: u.did, role: ROLE_LABEL[u.role], hospitalId: u.hospitalId };
}

// The demo clock moves "now" forward for consent-expiry checks. Event timestamps stay real.
export function demoNow(s: Pick<AppState, "clockOffsetDays">) {
  return new Date(Date.now() + s.clockOffsetDays * 86400000);
}

function subjectFor(draft: AppState, requestId: string | null, patientId: string | null): EventSubject {
  const req = requestId ? draft.requests.find((r) => r.id === requestId) : undefined;
  const pid = req?.patientId ?? patientId;
  const patient = pid ? draft.patients.find((p) => p.id === pid) : undefined;
  return {
    patientId: pid ?? null,
    patientName: patient?.name ?? null,
    requestingHospitalId: req?.requestingHospitalId ?? null,
    sourceHospitalId: req?.sourceHospitalId ?? null,
    categories: req ? [...req.categories] : [],
    purpose: req?.purpose ?? null,
    reason: req?.reason ?? null,
  };
}

function makeCtx(draft: AppState): Ctx {
  let sealedUpTo = draft.ledger.length;
  let txId: string | null = null;
  const session = draft.users.find((u) => u.id === draft.sessionUserId)!;
  const ctx: Ctx = {
    now: demoNow(draft),
    session,
    tx: () => (txId ??= `TX-${pad(++draft.counters.tx, 6)}`),
    recordLedgerEvent: (e) => {
      const actor = e.actor ?? actorOf(session);
      const ev: LedgerEvent = {
        index: draft.ledger.length,
        id: `EVT-${pad(draft.counters.event++, 6)}`,
        txId: e.txId ?? ctx.tx(),
        timestamp: new Date().toISOString(),
        kind: e.kind ?? "AUDIT",
        actor: actor.name,
        actorRole: actor.role,
        actorDid: actor.did,
        hospitalId: e.hospitalId !== undefined ? e.hospitalId : actor.hospitalId,
        action: e.action,
        result: e.result,
        requestId: e.requestId ?? null,
        contractVersion: draft.activeContractVersion,
        blockId: e.blockId ?? null,
        subject: subjectFor(draft, e.requestId ?? null, e.patientId ?? null),
        explanation: e.explanation,
        details: e.details ?? {},
        previousHash: "",
        currentHash: "",
      };
      draft.ledger.push(ev);
      return ev;
    },
    seal: async () => {
      await sealEvents(draft.ledger, sealedUpTo);
      sealedUpTo = draft.ledger.length;
    },
  };
  return ctx;
}

async function makeBlock(
  draft: AppState,
  opts: { label: string; txIds: string[]; requestId: string | null; eventHashes: string[]; sequence: number | null; view: number | null; primary: ValidatorId | null; commitVotes: ValidatorId[] },
): Promise<Block> {
  const prev = draft.blocks[draft.blocks.length - 1];
  const body = {
    id: `BLK-${pad(draft.counters.block++, 6)}`,
    height: draft.blocks.length,
    timestamp: new Date().toISOString(),
    ...opts,
    merkleRoot: await merkleRoot(opts.eventHashes),
    previousBlockHash: prev ? prev.hash : ZERO_HASH,
  };
  const block: Block = { ...body, hash: await sha256(body.previousBlockHash + canonicalize(body)) };
  draft.blocks.push(block);
  return block;
}

function setStatus(req: DataRequest, status: RequestStatus, by: string, eventId: string) {
  req.status = status;
  req.history.push({ status, at: new Date().toISOString(), by, eventId });
}

function bumpVersion(versions: string[], part: "minor" | "patch") {
  const parsed = versions.map((v) => v.split(".").map(Number) as [number, number, number]);
  parsed.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const [maj, min, pat] = parsed[parsed.length - 1];
  return part === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`;
}

function requirePermission(user: User, p: Permission) {
  if (!hasPermission(user.role, p)) throw new Error(`${user.name} (${ROLE_LABEL[user.role]}) does not have permission to ${PERMISSION_LABEL[p].toLowerCase()}.`);
}

function requireOfficerAt(user: User, hospitalId: HospitalId, p: Permission) {
  requirePermission(user, p);
  if (user.hospitalId !== hospitalId) throw new Error(`Only a records officer at ${hospitalId} can do this. ${user.name} works at ${user.hospitalId ?? "no hospital"}.`);
}

function policyOf(d: AppState): Policy {
  return d.contracts.find((c) => c.version === d.activeContractVersion)!.policy;
}

// g in Algorithm 08 is a DID: a hospital's DID or a professional's DID.
function resolveGrantee(d: AppState, ref: GranteeRef): Grantee {
  const did = ref.kind === "HOSPITAL" ? d.hospitals.find((h) => h.id === ref.id)?.did : d.users.find((u) => u.id === ref.id)?.did;
  if (!did) throw new Error(`Unknown grantee ${ref.id}.`);
  return { ...ref, did };
}

function contractEnv(d: AppState, now: Date): ContractEnv {
  return { hospitals: d.hospitals, users: d.users, consents: d.consents, verifications: d.verifications, authentications: d.authentications, now };
}

function checkRequestOf(d: AppState, req: DataRequest, processor: User): CheckRequest {
  return {
    patientId: req.patientId,
    patientDid: d.patients.find((p) => p.id === req.patientId)!.did ?? "",
    grantee: {
      professionalId: req.requesterId,
      hospitalId: req.requestingHospitalId,
      professionalDid: d.users.find((u) => u.id === req.requesterId)!.did,
      hospitalDid: d.hospitals.find((h) => h.id === req.requestingHospitalId)!.did,
    },
    recordTypes: req.categories,
    purpose: req.purpose,
    sourceHospitalId: req.sourceHospitalId,
    processor,
  };
}

const TERMINAL: RequestStatus[] = ["DENIED", "RELEASED", "REJECTED"];

function startExecution(d: AppState, ctx: Ctx, req: DataRequest) {
  const ev = ctx.recordLedgerEvent({
    action: "CONTRACT_EXECUTION_STARTED", result: "RUNNING", requestId: req.id, txId: req.txRef, hospitalId: req.sourceHospitalId,
    explanation: `${ctx.session.name} started ${CONTRACT_NAME} v${d.activeContractVersion}: check(${req.patientId}, ${req.requesterId}@${req.requestingHospitalId}, [${req.categories.join(", ")}]).`,
    details: { contract: CONTRACT_ID, version: d.activeContractVersion },
  });
  setStatus(req, "CONTRACT_PENDING", ctx.session.name, ev.id);
}

// Records the final access decision. Only a RELEASED outcome releases records.
function finalize(d: AppState, ctx: Ctx, req: DataRequest, outcome: FinalDecision["outcome"], reason: string, by: Actor) {
  const base = { requestId: req.id, txId: req.txRef, actor: by };
  let last: LedgerEvent;
  if (outcome === "RELEASED") {
    const recs = d.records.filter((r) => r.patientId === req.patientId && r.hospitalId === req.sourceHospitalId && req.categories.includes(r.category));
    req.releasedRecordIds = recs.map((r) => r.id);
    ctx.recordLedgerEvent({ ...base, action: "ACCESS_GRANTED", result: "GRANTED", explanation: "Access granted: all three contract rules passed and the source hospital approved." });
    last = ctx.recordLedgerEvent({
      ...base, hospitalId: req.sourceHospitalId, action: "MEDICAL_RECORD_RELEASED", result: recs.length ? "RELEASED" : "NO_MATCHING_RECORDS",
      explanation: recs.length ? `Released ${recs.map((r) => `${r.id} (${r.category})`).join(", ")} from ${req.sourceHospitalId} to ${req.requestingHospitalId}. Nothing outside the approved categories was released.` : `${req.sourceHospitalId} holds no records in the approved categories.`,
      details: { records: recs.map((r) => r.id), to: req.requestingHospitalId },
    });
  } else {
    last = ctx.recordLedgerEvent({ ...base, action: "ACCESS_DENIED", result: "DENIED", explanation: `Access denied. ${reason} No medical records were released.`, details: { reason } });
  }
  req.finalDecision = { outcome, reason, by: by.name, at: last.timestamp, eventId: last.id };
  setStatus(req, outcome === "RELEASED" ? "RELEASED" : outcome === "REJECTED" ? "REJECTED" : "DENIED", by.name, last.id);
}

// Writes one rule evaluation to the request and the ledger, and settles the contract decision when reached.
function recordRule(d: AppState, ctx: Ctx, req: DataRequest, outcome: RuleOutcome) {
  const ev = ctx.recordLedgerEvent({
    actor: CONTRACT_ACTOR, hospitalId: req.sourceHospitalId, requestId: req.id, txId: req.txRef,
    action: `RULE_${outcome.ruleId}_EVALUATED`, result: outcome.result,
    explanation: `Rule ${outcome.ruleId} (${outcome.name}): ${outcome.reason}`,
    details: { rule: outcome.name, condition: outcome.condition, inputs: outcome.inputs, processor: ctx.session.name },
  });
  const evaluation: RuleEvaluation = { ...outcome, eventId: ev.id, timestamp: ev.timestamp, processorId: ctx.session.id };
  req.rules.push(evaluation);
  req.contractVersion = d.activeContractVersion;

  const deny = (reason: string, rule?: RuleId) => {
    req.decision = "DENY";
    req.deniedByRule = rule;
    ctx.recordLedgerEvent({
      actor: CONTRACT_ACTOR, hospitalId: req.sourceHospitalId, requestId: req.id, txId: req.txRef, action: "CONTRACT_DENIED", result: "DENY",
      explanation: `check() returned DENY at ${rule ? `Rule ${rule}` : "extension E1"}. A failed rule cannot be overridden.`, details: { deniedByRule: rule ?? "E1", reason },
    });
    finalize(d, ctx, req, "DENIED", reason, CONTRACT_ACTOR);
  };

  if (outcome.result === "FAIL") deny(outcome.reason, outcome.ruleId);
  else if (outcome.ruleId === 3) {
    const ext = evaluateEmergencyExtension(req.purpose, req.reason, policyOf(d));
    if (ext) ctx.recordLedgerEvent({ actor: CONTRACT_ACTOR, requestId: req.id, txId: req.txRef, action: "EMERGENCY_PATHWAY_CHECK", result: ext.result, explanation: ext.reason });
    if (ext?.result === "FAIL") deny(ext.reason);
    else {
      req.decision = "APPROVE";
      const dec = ctx.recordLedgerEvent({
        actor: CONTRACT_ACTOR, hospitalId: req.sourceHospitalId, requestId: req.id, txId: req.txRef, action: "CONTRACT_APPROVED", result: "APPROVE",
        explanation: "check() returned APPROVE: all three fixed rules passed. The source hospital must now approve or reject.",
        details: { flaggedForReview: !!ext },
      });
      setStatus(req, "CONTRACT_APPROVED", "Smart contract", dec.id);
    }
  }
  return evaluation;
}

async function validateVersion(draft: AppState, cv: ContractVersion, ctx: Ctx) {
  const creator = draft.users.find((u) => u.did === cv.createdByDid);
  const versions = draft.contracts.filter((c) => c !== cv).map((c) => c.version);
  const checks = [
    { label: "Baseline rules R1–R3 unchanged", passed: cv.code.includes(BASELINE_RULES), detail: cv.code.includes(BASELINE_RULES) ? "Byte-for-byte match with the fixed baseline." : "The fixed baseline rules were modified. Baseline rules are immutable." },
    { label: "Algorithm 08 functions grant(), check(), revoke()", passed: ["function grant(", "function check(", "function revoke("].every((f) => cv.code.includes(f)), detail: "Contract interface is complete." },
    { label: "No override function", passed: !/function\s+override/i.test(cv.code), detail: "Failed rules cannot be bypassed." },
    { label: "Version number is unique", passed: !versions.includes(cv.version), detail: `v${cv.version}` },
    { label: "Creator holds contract:create permission", passed: !!creator && hasPermission(creator.role, "contract:create"), detail: creator ? creator.name : "Unknown creator" },
    { label: "Policy parameters within bounds", passed: cv.policy.maxConsentDays >= 1 && cv.policy.maxConsentDays <= 730, detail: `maxConsentDays = ${cv.policy.maxConsentDays} (allowed 1–730)` },
    { label: "Code hash matches stored hash", passed: (await sha256(cv.code)) === cv.codeHash, detail: cv.codeHash.slice(0, 16) + "…" },
  ];
  const passed = checks.every((c) => c.passed);
  cv.validation = { checks, passed, at: new Date().toISOString() };
  cv.status = passed ? "VALIDATED" : "INVALID";
  ctx.recordLedgerEvent({
    action: "CONTRACT_VALIDATED", result: passed ? "PASS" : "FAIL",
    explanation: passed ? `Contract v${cv.version} passed all ${checks.length} validation checks.` : `Contract v${cv.version} failed validation: ${checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}.`,
    details: { version: cv.version, checks },
  });
  return passed;
}

async function deployVersion(draft: AppState, cv: ContractVersion, ctx: Ctx) {
  const online = VALIDATORS.filter((v) => draft.nodeStatus[v] === "ONLINE");
  if (online.length < QUORUM) throw new Error(`Deployment needs ${QUORUM} online validators; only ${online.length} are online.`);
  const txId = ctx.tx();
  ctx.recordLedgerEvent({ kind: "TRANSACTION", action: "CONTRACT_DEPLOY_TX", result: "COMMITTED", explanation: `Simulated deployment transaction for v${cv.version}, signed by validators ${online.join(", ")}.`, details: { version: cv.version, codeHash: cv.codeHash, validatorsSigned: online } });
  await ctx.seal();
  const block = await makeBlock(draft, {
    label: `Contract deployment v${cv.version}`, txIds: [txId], requestId: null,
    eventHashes: draft.ledger.slice(-3).map((e) => e.currentHash), sequence: null, view: null, primary: null, commitVotes: online,
  });
  const previous = draft.contracts.find((c) => c.version === draft.activeContractVersion);
  if (previous) previous.status = "SUPERSEDED";
  cv.status = "DEPLOYED";
  draft.activeContractVersion = cv.version;
  const ev = ctx.recordLedgerEvent({ kind: "BLOCK", action: "BLOCK_COMMITTED", result: "COMMITTED", blockId: block.id, actor: NETWORK_ACTOR, explanation: `Block ${block.id} committed with the contract deployment.`, details: { label: block.label, hash: block.hash, merkleRoot: block.merkleRoot } });
  cv.receipt = {
    txId, blockId: block.id, deployedAt: new Date().toISOString(), deployer: ctx.session.name,
    address: `0x${(await sha256(`${CONTRACT_ID}:${cv.version}`)).slice(0, 40)}`, eventId: ev.id,
  };
  ctx.recordLedgerEvent({ action: "CONTRACT_DEPLOYED", result: "ACTIVE", blockId: block.id, explanation: `Contract v${cv.version} is now active${previous ? `; v${previous.version} is preserved as superseded` : ""}. (Simulated deployment.)`, details: { version: cv.version, previousVersion: previous?.version, address: cv.receipt.address } });
}

// Sign-in: authenticate, verify the credential, and check the hospital registry.
async function authenticate(d: AppState, ctx: Ctx, u: User) {
  d.sessionUserId = u.id;
  const actor = actorOf(u);
  const auth = ctx.recordLedgerEvent({ actor, action: "AUTHENTICATION_VERIFIED", result: "OK", explanation: `${u.name} signed in as ${ROLE_LABEL[u.role]} using DID ${u.did} (demo authentication).`, details: { did: u.did, role: u.role } });
  d.authentications[u.id] = { at: auth.timestamp, eventId: auth.id };
  const { verified, checks } = await verifyCredential(u.credential, d.hospitals, ctx.now);
  const vEv = ctx.recordLedgerEvent({
    actor, action: "CREDENTIAL_VERIFIED", result: verified ? "VERIFIED" : "FAILED",
    explanation: verified ? `Credential ${u.credential.id} verified: trusted issuer, intact, in date, not revoked.` : `Credential verification failed: ${checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}.`,
    details: { credentialId: u.credential.id, issuer: u.credential.issuer, checks },
  });
  d.verifications[u.id] = { verified, verifiedAt: vEv.timestamp, eventId: vEv.id, checks };
  let hospitalOk: boolean | null = null;
  if (u.hospitalId) {
    const h = d.hospitals.find((x) => x.id === u.hospitalId)!;
    hospitalOk = h.status === "ACTIVE";
    ctx.recordLedgerEvent({
      actor, action: "HOSPITAL_VERIFIED", result: hospitalOk ? "ACTIVE" : h.status,
      explanation: hospitalOk ? `${h.id} ${h.name} is registered and active in the consortium registry.` : `${h.id} ${h.name} is ${h.status.replace("_", " ").toLowerCase()} in the consortium registry.`,
      details: { hospital: h.id, did: h.did, status: h.status },
    });
  }
  return { verified, hospitalOk, checks };
}

async function initialiseState(): Promise<AppState> {
  const draft = await buildSeedState();
  const ctx = makeCtx(draft);
  const c = { actor: CONSORTIUM_ACTOR };
  ctx.recordLedgerEvent({ ...c, action: "LEDGER_GENESIS", result: "OK", explanation: "Genesis event. Its previousHash is 64 zeros; every later event links to the one before it." });
  const deployed = ctx.recordLedgerEvent({ ...c, kind: "TRANSACTION", action: "CONTRACT_DEPLOYED", result: "ACTIVE", explanation: `${CONTRACT_NAME} (${CONTRACT_ID}) v1.0.0 deployed with the three fixed rules (simulated deployment).`, details: { contractId: CONTRACT_ID, version: "1.0.0" } });
  for (const consent of draft.consents) {
    const p = draft.patients.find((x) => x.id === consent.patientId)!;
    const tx = `TX-${pad(++draft.counters.tx, 6)}`;
    const ev = ctx.recordLedgerEvent({
      txId: tx, patientId: p.id, action: "SEED_CONSENT_LOADED", result: "ACTIVE", actor: CONSORTIUM_ACTOR,
      explanation: `Initial demonstration data (not a user action): ${p.name} (${p.id}) allows ${granteeLabel(consent.grantee, draft.users, draft.hospitals)} to access ${consent.scope.join(" and ")} for ${PURPOSE_LABEL[consent.purpose]} until ${consent.expiry.slice(0, 10)}.`,
      details: { consentId: consent.id, grantee: consent.grantee, scope: consent.scope, purpose: consent.purpose, expiry: consent.expiry },
    });
    consent.eventId = ev.id;
    consent.txId = tx;
  }
  await ctx.seal();
  const block = await makeBlock(draft, { label: "Genesis block", txIds: [], requestId: null, eventHashes: draft.ledger.map((e) => e.currentHash), sequence: null, view: null, primary: null, commitVotes: [...VALIDATORS] });
  draft.contracts[0].receipt = { txId: deployed.txId, blockId: block.id, deployedAt: draft.contracts[0].createdAt, deployer: "MedChain Consortium", address: `0x${(await sha256(`${CONTRACT_ID}:1.0.0`)).slice(0, 40)}`, eventId: deployed.id };
  // Nobody is signed in yet: authentication events come only from real sign-ins.
  return draft;
}

// ---------------------------------------------------------------------------

export interface NewConsentInput {
  patientId: string;
  grantees: GranteeRef[];
  scope: RecordCategory[];
  purpose: Purpose;
  expiry: string;
}
export interface NewRequestInput {
  patientId: string;
  sourceHospitalId: HospitalId;
  categories: RecordCategory[];
  purpose: Purpose;
  reason: string;
}

function useStoreValue() {
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const started = useRef(false);

  const persist = (s: AppState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return true;
    } catch {
      return false; // quota exceeded or storage blocked
    }
  };

  const readStored = (): AppState | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AppState;
      return parsed.schema === SCHEMA_VERSION ? parsed : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const s = readStored() ?? (await initialiseState());
      stateRef.current = s;
      setState(s);
      persist(s);
    })();
  }, []);

  // Another tab committed a change: adopt it so this tab's ledger is never stale.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      try {
        const next = JSON.parse(e.newValue) as AppState;
        if (next.schema === SCHEMA_VERSION && next.revision > (stateRef.current?.revision ?? -1)) {
          stateRef.current = next;
          setState(next);
        }
      } catch {
        /* ignore malformed writes */
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Every mutation runs here, one at a time: clone → mutate + emit events → hash-chain → persist.
  const commit = useCallback(<T,>(fn: (draft: AppState, ctx: Ctx) => T | Promise<T>): Promise<T> => {
    const run = async () => {
      if (!stateRef.current) throw new Error("State not loaded yet");
      // Build on the newest saved state, so an event written by another tab is never overwritten.
      const stored = readStored();
      const base = stored && stored.revision > stateRef.current.revision ? stored : stateRef.current;
      const draft = structuredClone(base);
      const ctx = makeCtx(draft);
      const result = await fn(draft, ctx);
      await ctx.seal(); // SHA-256 for every new event, chained to the previous one
      draft.revision = base.revision + 1;
      // Only show the change once it is hashed and saved.
      if (!persist(draft)) throw new Error("Browser storage is full or blocked, so this action was not recorded. Export the ledger as CSV, then use Reset Demo Data.");
      stateRef.current = draft;
      setState(draft);
      return result;
    };
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);

  const getState = useCallback(() => stateRef.current!, []);

  const actions = useMemo(() => {
    const findReq = (d: AppState, id: string) => {
      const r = d.requests.find((x) => x.id === id);
      if (!r) throw new Error(`Request ${id} not found`);
      return r;
    };
    const patientActor = (d: AppState, patientId: string): Actor => {
      const p = d.patients.find((x) => x.id === patientId)!;
      return { name: p.name, did: p.did ?? "", role: "Patient", hospitalId: null };
    };

    const evaluateOne = (requestId: string, ruleId: RuleId) =>
      commit((d, ctx) => {
        const req = findReq(d, requestId);
        if (req.decision) throw new Error("The contract has already reached a decision for this request.");
        if (req.status === "CONSENT_CHECKED") startExecution(d, ctx, req);
        if (req.status !== "CONTRACT_PENDING") throw new Error("The source hospital must complete its verification first.");
        if (req.rules.length !== ruleId - 1) throw new Error(`Run Rule ${req.rules.length + 1} first — rules execute in order.`);
        return recordRule(d, ctx, req, evaluateRule(ruleId, checkRequestOf(d, req, ctx.session), contractEnv(d, ctx.now)));
      });

    const advance = (runId: string) =>
      commit(async (d, ctx) => {
        const run = d.pbftRuns.find((r) => r.id === runId);
        if (!run) throw new Error("PBFT run not found");
        if (run.revealed >= run.phases.length) return run;
        const phase = run.phases[run.revealed];
        const delivered = phase.messages.filter((m) => m.status === "DELIVERED").length;
        const pbftBase = { kind: "PBFT" as const, requestId: run.requestId, txId: run.txId, actor: NETWORK_ACTOR };
        ctx.recordLedgerEvent({
          ...pbftBase, action: `PBFT_${phase.name.replace("-", "_")}`, result: `${delivered}/${phase.messages.length} delivered`,
          explanation: `${phase.title}: ${phase.summary}`,
          details: { runId, sequence: run.sequence, view: run.view, primary: run.primary, messages: phase.messages },
        });
        run.revealed++;
        if (run.revealed < run.phases.length) return run;

        const req = run.requestId ? findReq(d, run.requestId) : null;
        if (run.outcome === "COMMITTED") {
          ctx.recordLedgerEvent({ ...pbftBase, kind: "TRANSACTION", action: "TX_COMMITTED", result: "COMMITTED", explanation: `Transaction ${run.txId} committed at sequence #${run.sequence}.`, details: { digest: run.digest, sequence: run.sequence } });
          ctx.recordLedgerEvent({ ...pbftBase, action: "CONSENSUS_OUTCOME", result: "COMMITTED", explanation: run.outcomeReason, details: { committed: run.committedCount, quorum: run.quorum } });
          await ctx.seal();
          const hashes = run.requestId ? d.ledger.filter((e) => e.requestId === run.requestId).map((e) => e.currentHash) : d.ledger.slice(-run.phases.length - 3).map((e) => e.currentHash);
          const block = await makeBlock(d, {
            label: req ? `Contract approval ${req.id}` : "Test transaction", txIds: [run.txId], requestId: run.requestId, eventHashes: hashes,
            sequence: run.sequence, view: run.view, primary: run.primary, commitVotes: run.nodes.filter((n) => n.committed).map((n) => n.id),
          });
          run.blockId = block.id;
          const bEv = ctx.recordLedgerEvent({ ...pbftBase, kind: "BLOCK", action: "BLOCK_COMMITTED", result: "COMMITTED", blockId: block.id, explanation: `Block ${block.id} (height ${block.height}) anchors ${hashes.length} ledger events in its Merkle root.`, details: { hash: block.hash, merkleRoot: block.merkleRoot } });
          if (req) {
            req.blockId = block.id;
            setStatus(req, "COMMITTED", "PBFT network", bEv.id);
          }
        } else {
          ctx.recordLedgerEvent({ ...pbftBase, action: "CONSENSUS_OUTCOME", result: "FAILED", explanation: run.outcomeReason, details: { committed: run.committedCount, quorum: run.quorum } });
          ctx.recordLedgerEvent({ ...pbftBase, kind: "TRANSACTION", action: "TX_REJECTED", result: "NOT COMMITTED", explanation: `Transaction ${run.txId} was not committed. No record can be released until consensus succeeds.` });
          if (req) setStatus(req, "CONSENSUS_FAILED", "PBFT network", d.ledger[d.ledger.length - 1].id);
        }
        return run;
      });

    const startPbft = (requestId: string | null) =>
        commit(async (d, ctx) => {
          const req = requestId ? findReq(d, requestId) : null;
          if (req && !["HOSPITAL_APPROVED", "CONSENSUS_FAILED"].includes(req.status)) throw new Error("Only requests the contract and the source hospital have approved can be submitted to consensus.");
          const txId = req ? req.txRef : ctx.tx();
          const payload = req
            ? { txId, requestId: req.id, patientId: req.patientId, categories: req.categories, purpose: req.purpose, decision: "APPROVE", contractVersion: req.contractVersion, ruleEvents: req.rules.map((r) => r.eventId) }
            : { txId, type: "TEST", createdAt: new Date().toISOString() };
          const digest = await sha256(canonicalize(payload));
          const client = req ? req.sourceHospitalId : "H2";
          const sim = simulatePbft({ view: d.pbftView, digest, client: `${client} gateway`, nodeStatus: d.nodeStatus });
          d.pbftView = sim.view;
          const run: PbftRun = {
            id: `PBFT-${pad(++d.counters.pbft)}`, requestId, txId, digest, sequence: ++d.pbftSequence, view: sim.view, primary: sim.primary,
            nodeStatus: { ...d.nodeStatus }, phases: sim.phases, nodes: sim.nodes, committedCount: sim.committedCount, quorum: QUORUM, faultTolerance: 1,
            outcome: sim.outcome, outcomeReason: sim.outcomeReason, revealed: 0, blockId: null, startedAt: new Date().toISOString(),
          };
          d.pbftRuns.unshift(run);
          const ev = ctx.recordLedgerEvent({ kind: "TRANSACTION", action: "TX_SUBMITTED", result: "PENDING", requestId, txId, actor: req ? actorOf(ctx.session) : NETWORK_ACTOR, explanation: `Transaction ${txId} (digest ${digest.slice(0, 12)}…) submitted to the validators for consensus.`, details: { digest, sequence: run.sequence, payload } });
          if (req) {
            req.pbftRunIds.unshift(run.id);
            setStatus(req, "PBFT_IN_PROGRESS", "PBFT network", ev.id);
          }
          return run;
        });

    const runToEnd = async (runId: string) => {
      let run = stateRef.current!.pbftRuns.find((r) => r.id === runId)!;
      while (run.revealed < run.phases.length) run = await advance(runId);
      return run;
    };

    return {
      // Demo sign-in. Authenticates, verifies the credential and checks the hospital registry.
      signIn: (userId: string) =>
        commit(async (d, ctx) => authenticate(d, ctx, d.users.find((x) => x.id === userId)!)),

      verifyIdentity: (userId: string) =>
        commit(async (d, ctx) => {
          const u = d.users.find((x) => x.id === userId)!;
          const { verified, checks } = await verifyCredential(u.credential, d.hospitals, ctx.now);
          const ev = ctx.recordLedgerEvent({
            actor: actorOf(u), action: "CREDENTIAL_VERIFIED", result: verified ? "VERIFIED" : "FAILED",
            explanation: verified ? `Credential ${u.credential.id} verified.` : `Credential verification failed: ${checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}.`,
            details: { credentialId: u.credential.id, issuer: u.credential.issuer, checks },
          });
          const v: Verification = { verified, verifiedAt: ev.timestamp, eventId: ev.id, checks };
          d.verifications[u.id] = v;
          return v;
        }),

      registerPatientDid: (patientId: string) =>
        commit(async (d, ctx) => {
          const p = d.patients.find((x) => x.id === patientId)!;
          if (p.did) return p.did;
          const did = await patientDid(p.id);
          p.did = did;
          p.didDocument = await makeDidDocument(did, did);
          ctx.recordLedgerEvent({ action: "DID_REGISTERED", result: "REGISTERED", actor: patientActor(d, patientId), explanation: `${p.name} (${p.id}) registered DID ${did} and published a DID document.`, details: { patientId: p.id, did, didDocument: p.didDocument } });
          return did;
        }),

      // Algorithm 08 grant(): one consent per grantee.
      grantConsent: (input: NewConsentInput) =>
        commit((d, ctx) => {
          if (!input.grantees.length) throw new Error("Select at least one hospital or professional.");
          const p = d.patients.find((x) => x.id === input.patientId)!;
          const actor = actorOf(ctx.session); // the caller: the patient, or their guardian
          const created: Consent[] = [];
          for (const ref of input.grantees) {
            const grantee = resolveGrantee(d, ref);
            const res = grant(
              d.consents,
              { patientId: p.id, patientDid: p.did ?? "", grantee, scope: input.scope, purpose: input.purpose, expiry: new Date(input.expiry) },
              { now: ctx.now, patientRegistered: !!p.did, maxConsentDays: policyOf(d).maxConsentDays, callerDid: ctx.session.did, guardianDid: p.guardianDid },
            );
            for (const old of res.superseded) {
              old.status = "SUPERSEDED";
              ctx.recordLedgerEvent({ actor, action: "CONSENT_SUPERSEDED", result: "SUPERSEDED", explanation: `Consent ${old.id} for ${granteeLabel(grantee, d.users, d.hospitals)} was replaced by a newer grant.`, details: { consentId: old.id } });
            }
            const id = `CON-${pad(++d.counters.consent)}`;
            const ev = ctx.recordLedgerEvent({
              actor, action: "CONSENT_GRANTED", result: "ACTIVE",
              explanation: `grant(${p.did}, ${grantee.did}, [${input.scope.join(", ")}], ${input.purpose}, ${input.expiry.slice(0, 10)}): ${p.name} allowed ${granteeLabel(grantee, d.users, d.hospitals)} to access ${input.scope.map((c) => CATEGORY_LABEL[c]).join(", ")} for ${PURPOSE_LABEL[input.purpose]}. Stored as consents[p][g].`,
              details: { consentId: id, key: `consents[${p.did}][${grantee.did}]`, grantee, scope: input.scope, purpose: input.purpose, expiry: res.consent.expiry, caller: ctx.session.did },
            });
            const consent: Consent = { id, ...res.consent, createdAt: ev.timestamp, eventId: ev.id, txId: ev.txId };
            d.consents.push(consent);
            created.push(consent);
          }
          return created;
        }),

      // Algorithm 08 revoke(patient, grantee).
      revokeConsent: (patientId: string, ref: GranteeRef) =>
        commit((d, ctx) => {
          const p = d.patients.find((x) => x.id === patientId)!;
          const grantee = resolveGrantee(d, ref);
          const revoked = revoke(d.consents, p.did ?? "", grantee, { callerDid: ctx.session.did, guardianDid: p.guardianDid });
          for (const c of revoked) {
            c.status = "REVOKED";
            c.revokedAt = ctx.now.toISOString();
          }
          ctx.recordLedgerEvent({
            actor: actorOf(ctx.session), action: "CONSENT_REVOKED", result: "REVOKED",
            explanation: `revoke(${p.did}, ${grantee.did}): ${p.name}'s permission for ${granteeLabel(grantee, d.users, d.hospitals)} withdrawn. Every later check() for this pair fails Rule 3.`,
            details: { consentIds: revoked.map((c) => c.id), key: `consents[${p.did}][${grantee.did}]`, grantee, caller: ctx.session.did },
          });
          return revoked;
        }),

      advanceClock: (days: number) =>
        commit((d, ctx) => {
          d.clockOffsetDays += days;
          ctx.recordLedgerEvent({ actor: CONSORTIUM_ACTOR, action: "DEMO_CLOCK_ADVANCED", result: `+${d.clockOffsetDays} days`, explanation: `Demo clock moved forward ${days} day(s). Contract time is now ${fmtDateTime(demoNow(d).toISOString())}. Event timestamps stay real.` });
        }),

      resetClock: () =>
        commit((d, ctx) => {
          if (d.clockOffsetDays === 0) return;
          d.clockOffsetDays = 0;
          ctx.recordLedgerEvent({ actor: CONSORTIUM_ACTOR, action: "DEMO_CLOCK_RESET", result: "OK", explanation: "Demo clock reset to real time." });
        }),

      // The signed-in physician submits the request on behalf of their own hospital.
      createRequest: (input: NewRequestInput) =>
        commit((d, ctx) => {
          const requester = ctx.session;
          if (!d.authentications[requester.id]) throw new Error("Sign in before submitting a request.");
          requirePermission(requester, "request:create");
          if (!requester.hospitalId) throw new Error("The requester must belong to a hospital.");
          if (!input.categories.length) throw new Error("Select at least one record category.");
          if (input.sourceHospitalId === requester.hospitalId) throw new Error("The source hospital must be different from your own.");
          if (input.reason.trim().length < 5) throw new Error("Give a short clinical reason.");
          const id = `REQ-${new Date().getFullYear()}-${pad(++d.counters.request)}`;
          const txRef = ctx.tx();
          const patient = d.patients.find((p) => p.id === input.patientId)!;
          const req: DataRequest = {
            id, txRef, patientId: input.patientId, sourceHospitalId: input.sourceHospitalId, requestingHospitalId: requester.hospitalId, requesterId: requester.id,
            categories: input.categories, purpose: input.purpose, reason: input.reason, createdAt: "", status: "SUBMITTED",
            history: [], rules: [], pbftRunIds: [], releasedRecordIds: [],
          };
          d.requests.unshift(req); // in the inbox of the source hospital as soon as this commit is saved
          const ev = ctx.recordLedgerEvent({
            action: "REQUEST_CREATED", result: "SUBMITTED", requestId: id, txId: txRef, hospitalId: requester.hospitalId,
            explanation: `${requester.name} (${requester.hospitalId}) requested ${patient.name}'s ${input.categories.join(", ")} from ${input.sourceHospitalId} for ${PURPOSE_LABEL[input.purpose]}. Reason: ${input.reason}`,
          });
          req.createdAt = ev.timestamp;
          req.history.push({ status: "SUBMITTED", at: ev.timestamp, by: requester.name, eventId: ev.id });
          return req;
        }),

      acknowledgeRequest: (id: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (req.status !== "SUBMITTED") throw new Error("Request already received.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "request:receive");
          const ev = ctx.recordLedgerEvent({ action: "REQUEST_RECEIVED", result: "RECEIVED", requestId: id, txId: req.txRef, hospitalId: req.sourceHospitalId, explanation: `${req.sourceHospitalId} received ${id} in its inbox; ${ctx.session.name} acknowledged it.` });
          setStatus(req, "RECEIVED", ctx.session.name, ev.id);
        }),

      // The records officer opens the request and starts reviewing it.
      startReview: (id: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (req.status !== "RECEIVED") throw new Error("Acknowledge receipt first.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "request:receive");
          const ev = ctx.recordLedgerEvent({ action: "REQUEST_REVIEW_STARTED", result: "UNDER_REVIEW", requestId: id, txId: req.txRef, hospitalId: req.sourceHospitalId, explanation: `${ctx.session.name} opened ${id} and started reviewing it.` });
          setStatus(req, "UNDER_REVIEW", ctx.session.name, ev.id);
        }),

      // The officer verifies the requesting professional, the patient reference and the requested data.
      completeVerification: (id: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (req.status !== "UNDER_REVIEW") throw new Error("Start the review first.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "request:receive");
          const patient = d.patients.find((p) => p.id === req.patientId)!;
          const reqHosp = d.hospitals.find((h) => h.id === req.requestingHospitalId)!;
          const physician = d.users.find((u) => u.id === req.requesterId)!;
          const held = d.records.filter((r) => r.patientId === req.patientId && r.hospitalId === req.sourceHospitalId);
          const missing = req.categories.filter((c) => !held.some((r) => r.category === c));
          const cr = checkRequestOf(d, req, ctx.session);
          const consent = latestConsentFor(cr.patientDid, cr.grantee, d.consents);
          const consentSummary = !consent
            ? `No consent from ${req.patientId} to ${req.requestingHospitalId} or the requesting physician was found.`
            : `Found ${consent.id}: ${consent.status}, scope ${consent.scope.join("/")}, purpose ${consent.purpose}, ${consentIsUsable(consent, ctx.now) ? "in date" : "not usable (expired or inactive)"}.`;
          const checks: ReviewCheck[] = [
            { label: "Patient reference", passed: !!patient.did, detail: `${patient.name} (${patient.id}), DOB ${patient.dob}${patient.did ? ", DID registered" : ", no DID registered"}` },
            { label: "Requesting hospital", passed: reqHosp.status === "ACTIVE", detail: `${reqHosp.id} ${reqHosp.name}: ${reqHosp.status.replace("_", " ")}` },
            { label: "Requesting professional", passed: d.verifications[physician.id]?.verified === true, detail: `${physician.name}, ${ROLE_LABEL[physician.role]}, credential ${d.verifications[physician.id]?.verified ? "verified" : "not verified"}` },
            { label: "Requested data held here", passed: missing.length === 0, detail: missing.length ? `${req.sourceHospitalId} holds no ${missing.join(", ")} record for this patient` : `${req.categories.join(", ")} available at ${req.sourceHospitalId}` },
            { label: "Patient consent on file", passed: !!consent && consentIsUsable(consent, ctx.now), detail: consentSummary },
          ];
          const ev = ctx.recordLedgerEvent({
            action: "HOSPITAL_VERIFICATION_COMPLETED", result: checks.every((c) => c.passed) ? "VERIFIED" : "ISSUES_FOUND", requestId: id, txId: req.txRef, hospitalId: req.sourceHospitalId,
            explanation: `${ctx.session.name} verified ${id}: ${checks.map((c) => `${c.label.toLowerCase()} ${c.passed ? "OK" : "flagged"}`).join(", ")}. This is the hospital's check; Algorithm 08 still decides independently.`,
            details: { checks },
          });
          req.review = { checks, eventId: ev.id, at: ev.timestamp };
          req.consentCheck = { consentId: consent?.id ?? null, found: !!consent, summary: consentSummary, eventId: ev.id, timestamp: ev.timestamp };
          setStatus(req, "CONSENT_CHECKED", ctx.session.name, ev.id);
        }),

      // Starts Algorithm 08 for this request. Rules are then evaluated one by one or all at once.
      startContractExecution: (id: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (req.status !== "CONSENT_CHECKED") throw new Error("Complete the hospital verification first.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "request:process");
          startExecution(d, ctx, req);
          return req.id;
        }),

      // Hospital response: reject with a reason (any time before release).
      rejectRequest: (id: string, reason: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (TERMINAL.includes(req.status)) throw new Error(`Request is already ${req.status.toLowerCase()}.`);
          if (req.status === "PBFT_IN_PROGRESS") throw new Error("Wait for the consensus round to finish.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "request:process");
          if (reason.trim().length < 5) throw new Error("Give a reason for the rejection.");
          ctx.recordLedgerEvent({ action: "HOSPITAL_REJECTED", result: "REJECTED", requestId: id, txId: req.txRef, hospitalId: req.sourceHospitalId, explanation: `${ctx.session.name} rejected ${id}. Reason: ${reason}`, details: { reason, atStatus: req.status } });
          finalize(d, ctx, req, "REJECTED", `Rejected by ${req.sourceHospitalId}: ${reason}`, actorOf(ctx.session));
        }),

      evaluateRule: evaluateOne,

      // Algorithm 08 check(): evaluates every remaining rule in one contract call, stopping at the first failure.
      runAllRules: (requestId: string) =>
        commit((d, ctx) => {
          const req = findReq(d, requestId);
          if (req.decision) throw new Error("The contract has already reached a decision for this request.");
          if (req.status === "CONSENT_CHECKED") startExecution(d, ctx, req);
          if (req.status !== "CONTRACT_PENDING") throw new Error("The source hospital must complete its verification first.");
          const result = check(checkRequestOf(d, req, ctx.session), contractEnv(d, ctx.now), req.rules.length);
          return result.rules.map((r) => recordRule(d, ctx, req, r));
        }),

      setNodeStatus: (node: ValidatorId, status: NodeStatus) =>
        commit((d, ctx) => {
          d.nodeStatus[node] = status;
          ctx.recordLedgerEvent({ kind: "PBFT", action: "NODE_STATUS_CHANGED", result: status, hospitalId: node, explanation: `Validator ${node} set to ${status.toLowerCase()} (simulated availability change).` });
        }),

      startPbft,

      advancePbft: advance,

      runPbftToEnd: runToEnd,

      // Hospital response: approve. Only possible after Algorithm 08 approved; does not release anything by itself.
      hospitalApprove: (id: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (req.status !== "CONTRACT_APPROVED") throw new Error(req.decision === "DENY" ? "The contract denied this request. A failed rule cannot be overridden." : "The hospital can approve only after all three contract rules pass.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "request:process");
          const ev = ctx.recordLedgerEvent({ action: "HOSPITAL_APPROVED", result: "APPROVED", requestId: id, txId: req.txRef, hospitalId: req.sourceHospitalId, explanation: `${ctx.session.name} (${req.sourceHospitalId}) approved ${id}. Contract passed and hospital approved: the permitted records may now be released.` });
          setStatus(req, "HOSPITAL_APPROVED", ctx.session.name, ev.id);
        }),

      // Release: only after the contract approved and the source hospital approved, and
      // Algorithm 08 line 6 — this access path calls check() again first, so a consent revoked or
      // expired after approval still blocks the release.
      releaseRecords: (id: string) =>
        commit((d, ctx) => {
          const req = findReq(d, id);
          if (req.status !== "HOSPITAL_APPROVED") throw new Error("Records are released only after all contract rules pass and the source hospital approves.");
          requireOfficerAt(ctx.session, req.sourceHospitalId, "record:release");
          const recheck = check(checkRequestOf(d, req, ctx.session), contractEnv(d, ctx.now));
          const failed = recheck.rules.find((r) => r.result === "FAIL");
          ctx.recordLedgerEvent({
            actor: CONTRACT_ACTOR, hospitalId: req.sourceHospitalId, requestId: req.id, txId: req.txRef,
            action: "ACCESS_CHECK_AT_RELEASE", result: recheck.decision === "APPROVE" ? "PASS" : "FAIL",
            explanation: recheck.decision === "APPROVE"
              ? "check() re-run at the moment of access: Rules 1–3 still pass, so the release may go ahead."
              : `check() re-run at the moment of access failed Rule ${recheck.deniedByRule}: ${failed?.reason.replace(/^Denied: /, "") ?? ""}`,
            details: { rules: recheck.rules.map((r) => ({ rule: r.ruleId, result: r.result, reason: r.reason })) },
          });
          if (recheck.decision === "DENY") {
            req.deniedByRule = recheck.deniedByRule;
            finalize(d, ctx, req, "DENIED", `At release, check() failed Rule ${recheck.deniedByRule}: ${failed?.reason.replace(/^Denied: /, "") ?? ""}`, CONTRACT_ACTOR);
            return [];
          }
          finalize(d, ctx, req, "RELEASED", "All three contract rules passed, the source hospital approved, and check() passed again at release.", actorOf(ctx.session));
          return d.records.filter((r) => req.releasedRecordIds.includes(r.id));
        }),

      // Patient notification: the patient opens their access history.
      viewAccessHistory: (patientId: string) =>
        commit((d, ctx) => {
          const reqs = d.requests.filter((r) => r.patientId === patientId);
          ctx.recordLedgerEvent({
            actor: patientActor(d, patientId), action: "PATIENT_VIEWED_ACCESS_HISTORY", result: "OK",
            explanation: `${d.patients.find((p) => p.id === patientId)!.name} viewed ${reqs.length} request(s) for their records and the decisions.`,
            details: { requests: reqs.map((r) => `${r.id}: ${r.status}`) },
          });
          return reqs;
        }),

      createContractDraft: (opts: { notes: string; editBaseline: boolean }) =>
        commit(async (d, ctx) => {
          requirePermission(ctx.session, "contract:create");
          const version = bumpVersion([...d.contracts.map((c) => c.version), ...d.proposals.map((p) => p.proposedVersion)], "patch");
          const policy = policyOf(d);
          const code = generateContractCode(version, policy, { editBaseline: opts.editBaseline });
          const cv: ContractVersion = { contractId: CONTRACT_ID, name: CONTRACT_NAME, version, status: "DRAFT", createdBy: ctx.session.name, createdByDid: ctx.session.did, createdAt: new Date().toISOString(), notes: opts.notes || "Maintenance release", policy: { ...policy }, code, codeHash: await sha256(code), source: "STUDIO" };
          d.contracts.push(cv);
          ctx.recordLedgerEvent({ action: "CONTRACT_CREATED", result: "DRAFT", explanation: `Draft v${version} created by ${ctx.session.name}${opts.editBaseline ? " with an attempted edit to Rule 2" : ""}.`, details: { version, codeHash: cv.codeHash, notes: cv.notes } });
          return cv;
        }),

      validateContract: (version: string) =>
        commit(async (d, ctx) => {
          requirePermission(ctx.session, "contract:create");
          return validateVersion(d, d.contracts.find((c) => c.version === version)!, ctx);
        }),

      deployContract: (version: string) =>
        commit(async (d, ctx) => {
          requirePermission(ctx.session, "contract:deploy");
          const cv = d.contracts.find((c) => c.version === version)!;
          if (cv.status !== "VALIDATED") throw new Error("Only a validated version can be deployed.");
          const active = policyOf(d);
          if (cv.policy.emergencyPathway !== active.emergencyPathway || cv.policy.maxConsentDays !== active.maxConsentDays) throw new Error("Policy changes must go through governance voting.");
          await deployVersion(d, cv, ctx);
          return cv;
        }),

      createProposal: (input: { type: ProposalType; title: string; description: string; policy: Policy }) =>
        commit((d, ctx) => {
          requirePermission(ctx.session, "governance:propose");
          if (input.title.trim().length < 4) throw new Error("Give the proposal a title.");
          const id = `GOV-${pad(++d.counters.proposal)}`;
          const proposedVersion = bumpVersion([...d.contracts.map((c) => c.version), ...d.proposals.map((p) => p.proposedVersion)], "minor");
          const p: Proposal = { id, ...input, creatorId: ctx.session.id, createdAt: new Date().toISOString(), baseVersion: d.activeContractVersion, proposedVersion, votes: { H1: null, H2: null, H3: null, H4: null }, status: "OPEN" };
          d.proposals.unshift(p);
          ctx.recordLedgerEvent({ action: "GOV_PROPOSAL_CREATED", result: "OPEN", explanation: `${ctx.session.name} proposed "${input.title}" (v${p.baseVersion} → v${proposedVersion}).`, details: { proposalId: id, type: input.type, policy: input.policy } });
          return p;
        }),

      castVote: (proposalId: string, node: ValidatorId, vote: Vote) =>
        commit((d, ctx) => {
          const p = d.proposals.find((x) => x.id === proposalId)!;
          if (p.status !== "OPEN") throw new Error("Voting is closed.");
          if (d.nodeStatus[node] === "OFFLINE") throw new Error(`${node} is offline and cannot vote.`);
          if (p.votes[node]) throw new Error(`${node} has already voted.`);
          const hospital = d.hospitals.find((h) => h.id === node)!;
          const ev = ctx.recordLedgerEvent({ action: "GOV_VOTE", result: vote, actor: { name: `${node} validator (${hospital.name})`, did: hospital.did, role: "Validator", hospitalId: node }, explanation: `${node} voted ${vote} on ${proposalId} (simulated validator operator).`, details: { proposalId } });
          p.votes[node] = { vote, at: ev.timestamp, eventId: ev.id };
          const votes = Object.values(p.votes).filter(Boolean);
          const approvals = votes.filter((v) => v!.vote === "APPROVE").length;
          const rejections = votes.length - approvals;
          if (approvals >= QUORUM) p.status = "APPROVED";
          else if (rejections > VALIDATORS.length - QUORUM) p.status = "REJECTED";
          if (p.status !== "OPEN") ctx.recordLedgerEvent({ action: "GOV_OUTCOME", result: p.status, actor: NETWORK_ACTOR, explanation: `${proposalId} ${p.status.toLowerCase()} with ${approvals} approval(s) and ${rejections} rejection(s); threshold ${QUORUM}.` });
          return p;
        }),

      deployProposal: (proposalId: string) =>
        commit(async (d, ctx) => {
          requirePermission(ctx.session, "contract:deploy");
          const p = d.proposals.find((x) => x.id === proposalId)!;
          if (p.status !== "APPROVED") throw new Error("Only an approved proposal can be deployed.");
          const code = generateContractCode(p.proposedVersion, p.policy);
          const cv: ContractVersion = { contractId: CONTRACT_ID, name: CONTRACT_NAME, version: p.proposedVersion, status: "DRAFT", createdBy: ctx.session.name, createdByDid: ctx.session.did, createdAt: new Date().toISOString(), notes: `${p.id}: ${p.title}`, policy: { ...p.policy }, code, codeHash: await sha256(code), source: "GOVERNANCE", proposalId: p.id };
          d.contracts.push(cv);
          ctx.recordLedgerEvent({ action: "CONTRACT_CREATED", result: "DRAFT", explanation: `Draft v${cv.version} generated from approved proposal ${p.id}.` });
          if (!(await validateVersion(d, cv, ctx))) throw new Error("Validation failed.");
          await deployVersion(d, cv, ctx);
          p.status = "DEPLOYED";
          return cv;
        }),

      verifyLedger: async (): Promise<LedgerVerification> => {
        const result = await verifyChain(stateRef.current!.ledger);
        await commit((d, ctx) => {
          ctx.recordLedgerEvent({
            action: "LEDGER_VERIFIED", result: result.valid ? "VALID" : "INVALID",
            explanation: result.valid ? `All ${result.checked} events recomputed with SHA-256; every previousHash link matches.` : `Integrity failure at ${result.failure?.eventId}: ${result.failure?.reason}.`,
            details: { checked: result.checked, failure: result.failure ?? null },
          });
        });
        return result;
      },

      tamperEvent: (eventId: string) =>
        commit((d) => {
          if (d.tamper) throw new Error("Restore the previous tampering first.");
          const e = d.ledger.find((x) => x.id === eventId)!;
          d.tamper = { eventId, original: e.result };
          e.result = e.result === "DENIED" ? "GRANTED" : e.result === "FAIL" ? "PASS" : e.result === "DENY" ? "APPROVE" : e.result === "WITHHELD" ? "RELEASED" : `${e.result} (ALTERED)`;
          // deliberately no ledger event and no re-hash — this simulates an attacker editing storage
        }),

      restoreTamper: () =>
        commit((d) => {
          if (!d.tamper) return;
          const e = d.ledger.find((x) => x.id === d.tamper!.eventId)!;
          e.result = d.tamper.original;
          d.tamper = null;
        }),

      setGuided: (patch: Partial<GuidedState>) =>
        commit((d) => {
          d.guided = { ...d.guided, ...patch };
        }),

      resetDemo: async () => {
        await queue.current;
        const s = await initialiseState();
        s.revision = Math.max(stateRef.current?.revision ?? 0, readStored()?.revision ?? 0) + 1; // newer, so other tabs adopt it
        if (!persist(s)) throw new Error("Browser storage is blocked.");
        stateRef.current = s;
        setState(s);
      },
    };
  }, [commit]);

  return { state, getState, actions };
}

type StoreValue = ReturnType<typeof useStoreValue>;
const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const value = useStoreValue();
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

// Convenience hook for pages rendered after the state has loaded.
export function useApp() {
  const { state, getState, actions } = useStore();
  const s = state!;
  const session = s.users.find((u) => u.id === s.sessionUserId)!;
  const activeContract = s.contracts.find((c) => c.version === s.activeContractVersion)!;
  return {
    state: s,
    getState,
    actions,
    session,
    activeContract,
    now: demoNow(s),
    user: (id: string) => s.users.find((u) => u.id === id),
    hospital: (id: string | null | undefined) => s.hospitals.find((h) => h.id === id),
    patient: (id: string) => s.patients.find((p) => p.id === id),
    isVerified: (userId: string) => s.verifications[userId]?.verified === true,
    isAuthenticated: (userId: string) => !!s.authentications[userId],
  };
}
