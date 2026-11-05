// Scenario definitions and stage runners for the Guided Demonstration.
// Every stage calls the same store actions the pages use, so outcomes come from the real algorithm.
import type { useStore } from "./store";
import type { AppState, HospitalId, Purpose, RecordCategory, ScenarioId, ValidatorId } from "./types";
import { addDays } from "./utils";

type Actions = ReturnType<typeof useStore>["actions"];
export interface GuidedApi {
  actions: Actions;
  getState: () => AppState;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  summary: string;
  expected: string;
  consent: { hospitalIds: HospitalId[]; scope: RecordCategory[]; purpose: Purpose; expiryDays?: number };
  revokeAfterGrant?: boolean;
  expireAfterGrant?: boolean; // move the demo clock past the expiry
  request: { requesterId: string; sourceHospitalId: HospitalId; categories: RecordCategory[]; purpose: Purpose; reason: string };
  offlineNode?: ValidatorId;
  tamperLedger?: boolean;
}

const PATIENT = "PAT-001";
const PATIENT_USER = "u-pat-001";
const OFFICER = "u-rec-h2";
const AUDITOR = "u-aud";

const BASE_CONSENT = { hospitalIds: ["H1"] as HospitalId[], scope: ["LAB", "ECG"] as RecordCategory[], purpose: "TREATMENT" as Purpose };
const BASE_REQUEST = { requesterId: "u-phy-h1", sourceHospitalId: "H2" as HospitalId, categories: ["ECG"] as RecordCategory[], purpose: "TREATMENT" as Purpose, reason: "Follow-up of recent chest pain; need prior ECG for comparison." };

export const SCENARIOS: Scenario[] = [
  { id: "1", title: "Successful ECG request", summary: "City Hospital requests the ECG the patient consented to share.", expected: "All rules pass; records released after hospital approval", consent: BASE_CONSENT, request: BASE_REQUEST },
  { id: "2", title: "MRI request", summary: "Consent covers LAB and ECG, but the physician asks for the MRI.", expected: "Denied by Rule 2 (outside consent scope)", consent: BASE_CONSENT, request: { ...BASE_REQUEST, categories: ["MRI"], reason: "Neurology review requested; asking for prior brain MRI." } },
  { id: "3", title: "Unauthorized hospital", summary: "A physician at External Hospital H5 (not registered) requests the ECG.", expected: "Denied by Rule 1", consent: BASE_CONSENT, request: { ...BASE_REQUEST, requesterId: "u-phy-h5" } },
  { id: "4", title: "Revoked consent", summary: "The patient grants consent, then revokes it before the request.", expected: "Denied by Rule 3 (revoked)", consent: BASE_CONSENT, revokeAfterGrant: true, request: BASE_REQUEST },
  { id: "5", title: "Expired consent", summary: "Consent is granted for 7 days, then the demo clock moves 8 days ahead.", expected: "Denied by Rule 3 (expired)", consent: { ...BASE_CONSENT, expiryDays: 7 }, expireAfterGrant: true, request: BASE_REQUEST },
  { id: "6", title: "Ledger tampering", summary: "A valid request completes, then someone edits a stored ledger event.", expected: "Hash verification fails at the altered event", consent: BASE_CONSENT, request: BASE_REQUEST, tamperLedger: true },
  { id: "7", title: "One PBFT node offline", summary: "A valid ECG request while Medical Centre (H3) is offline.", expected: "3 of 4 nodes still commit; records released", consent: BASE_CONSENT, request: BASE_REQUEST, offlineNode: "H3" },
];

export const GLOSSARY: Record<string, string> = {
  DID: "A decentralised identifier — an ID the owner controls, linked to a public key so others can check their signatures.",
  "Verifiable Credential": "A signed digital certificate (e.g. ‘licensed physician at City Hospital’) that anyone can check without contacting the issuer.",
  RBAC: "Role-based access control: what you may do depends on your role, not your name.",
  "Smart contract": "Rules written as code that run the same way for every party. Here: Algorithm 08 with three fixed rules.",
  PBFT: "A voting protocol where hospitals agree on each transaction. With 4 nodes it still works if 1 is down or dishonest.",
  Hash: "A fingerprint of data (SHA-256). Change one character and the fingerprint changes completely.",
  "Ledger entry": "An append-only record. Each entry includes the previous entry's hash, forming a chain that exposes any edit.",
  Consent: "The patient's permission: who, which records, for what purpose, until when.",
};

export interface StageResult {
  ok: boolean;
  note: string;
  skip?: number[]; // later stage indexes that can no longer run
  patch?: Partial<AppState["guided"]>;
}

export interface Stage {
  title: string;
  actor: string;
  explain: string;
  concepts: string[];
  run: (api: GuidedApi, sc: Scenario) => Promise<StageResult>;
}

async function signIn(api: GuidedApi, userId: string) {
  return api.actions.signIn(userId);
}

function req(api: GuidedApi) {
  const id = api.getState().guided.requestId;
  const r = api.getState().requests.find((x) => x.id === id);
  if (!r) throw new Error("No request yet — run stage 3 first.");
  return r;
}

function consentExpiry(sc: Scenario, now: Date) {
  if (sc.consent.expiryDays) return addDays(now, sc.consent.expiryDays);
  const fixed = new Date("2026-12-31T23:59:59");
  return fixed > now ? fixed : addDays(now, 30);
}

const userName = (api: GuidedApi, id: string) => api.getState().users.find((u) => u.id === id)!.name;

export const STAGES: Stage[] = [
  {
    title: "Patient grants consent",
    actor: "Patient — Ayesha Khan (PAT-001)",
    explain: "Ayesha signs in and calls grant(): City Hospital may see her LAB and ECG records for treatment until the expiry date. A new grant replaces her previous consent for the same hospital. It is written to the ledger straight away.",
    concepts: ["DID", "Consent", "Ledger entry"],
    run: async (api, sc) => {
      await signIn(api, PATIENT_USER);
      const created = await api.actions.grantConsent({
        patientId: PATIENT, grantees: sc.consent.hospitalIds.map((id) => ({ kind: "HOSPITAL" as const, id })),
        scope: sc.consent.scope, purpose: sc.consent.purpose, expiry: consentExpiry(sc, new Date(Date.now() + api.getState().clockOffsetDays * 86400000)).toISOString(),
      });
      const ids = created.map((c) => c.id);
      if (sc.revokeAfterGrant) {
        await api.actions.revokeConsent(PATIENT, { kind: "HOSPITAL", id: "H1" });
        return { ok: true, note: `${ids.join(", ")} granted, then revoke(PAT-001, H1) withdrew it.`, patch: { consentIds: ids } };
      }
      if (sc.expireAfterGrant) {
        await api.actions.advanceClock((sc.consent.expiryDays ?? 7) + 1);
        return { ok: true, note: `${ids.join(", ")} granted for ${sc.consent.expiryDays} days. The demo clock then moved ${(sc.consent.expiryDays ?? 7) + 1} days ahead, so it has now expired.`, patch: { consentIds: ids } };
      }
      return { ok: true, note: `${ids.join(", ")} granted to ${sc.consent.hospitalIds.join(", ")} for ${sc.consent.scope.join(" + ")} (${sc.consent.purpose}).`, patch: { consentIds: ids } };
    },
  },
  {
    title: "Physician authenticates",
    actor: "Requesting physician",
    explain: "The physician signs in. The system checks their identity (DID), verifies their professional credential, confirms their role, and checks that their hospital is registered and active. Each check is logged.",
    concepts: ["Verifiable Credential", "RBAC", "DID"],
    run: async (api, sc) => {
      const r = await signIn(api, sc.request.requesterId);
      const name = userName(api, sc.request.requesterId);
      const ok = r.verified && r.hospitalOk !== false;
      return { ok, note: `${name}: credential ${r.verified ? "verified" : "NOT verified (issuer not trusted)"}, hospital ${r.hospitalOk ? "registered and active" : "NOT registered"}.${ok ? "" : " The request can still be submitted, but Rule 1 will deny it."}` };
    },
  },
  {
    title: "Patient history request",
    actor: "Requesting physician",
    explain: "The physician selects the patient, the record categories, the purpose and a reason, and submits the request to the hospital that holds the records. A unique request ID and transaction reference are generated.",
    concepts: ["Ledger entry"],
    run: async (api, sc) => {
      const r = await api.actions.createRequest({ patientId: PATIENT, ...sc.request });
      return { ok: true, note: `${r.id} (transaction ${r.txRef}): ${r.requestingHospitalId} asks ${r.sourceHospitalId} for ${r.categories.join(", ")}.`, patch: { requestId: r.id } };
    },
  },
  {
    title: "Source hospital receives the request",
    actor: "Records Officer — Sara Malik (H2)",
    explain: "The request arrives in General Hospital's inbox. The records officer signs in, receives it and opens it for review.",
    concepts: ["RBAC", "Ledger entry"],
    run: async (api) => {
      await signIn(api, OFFICER);
      const r = req(api);
      await api.actions.acknowledgeRequest(r.id);
      await api.actions.startReview(r.id);
      return { ok: true, note: `${r.id} received by ${r.sourceHospitalId} and opened for review.` };
    },
  },
  {
    title: "Hospital verification",
    actor: "Records Officer — Sara Malik (H2)",
    explain: "The officer verifies the requesting professional, the patient reference, the requested data and the consent on file. The hospital can reject with a reason, but it can never override patient consent or the contract.",
    concepts: ["Consent", "Verifiable Credential"],
    run: async (api) => {
      const r = req(api);
      await api.actions.completeVerification(r.id);
      const flagged = req(api).review!.checks.filter((c) => !c.passed).map((c) => c.label.toLowerCase());
      return { ok: true, note: `Verification completed.${flagged.length ? ` Flagged for the contract: ${flagged.join(", ")}.` : " All details check out."}` };
    },
  },
  {
    title: "Smart contract executes Algorithm 08",
    actor: "PatientConsentManagement contract",
    explain: "check(patient, grantee, record_type) evaluates Rule 1 (identity and hospital), Rule 2 (consent and scope) and Rule 3 (purpose, expiry, revocation) on live data. The first failing rule denies the request and no records are released.",
    concepts: ["Smart contract", "RBAC", "Consent"],
    run: async (api) => {
      const r = req(api);
      await api.actions.runAllRules(r.id);
      const after = req(api);
      if (after.decision === "DENY") {
        return { ok: false, note: `Denied by Rule ${after.deniedByRule}: ${after.rules.find((x) => x.result === "FAIL")?.reason ?? ""} No records released.`, skip: [6, 7] };
      }
      return { ok: true, note: "All three rules passed. The source hospital must now approve or reject." };
    },
  },
  {
    title: "Hospital response",
    actor: "Records Officer — Sara Malik (H2)",
    explain: "The contract passed, so General Hospital sends its response. Here it approves; it could also reject with a reason, and then nothing would be released.",
    concepts: ["RBAC"],
    run: async (api) => {
      await signIn(api, OFFICER);
      await api.actions.hospitalApprove(req(api).id);
      return { ok: true, note: `${req(api).sourceHospitalId} approved ${req(api).id}. Records may now be released.` };
    },
  },
  {
    title: "Consensus and medical record release",
    actor: "Validators H1–H4 (simulated PBFT) and the records officer",
    explain: "Releasing first commits the approval through consensus: 3 of 4 hospital validators must agree. Then only the permitted record categories are released and the final access decision is recorded.",
    concepts: ["PBFT", "Hash", "Ledger entry"],
    run: async (api, sc) => {
      const state = api.getState();
      for (const v of ["H1", "H2", "H3", "H4"] as ValidatorId[]) {
        const target = sc.offlineNode === v ? "OFFLINE" : "ONLINE";
        if (state.nodeStatus[v] !== target) await api.actions.setNodeStatus(v, target);
      }
      try {
        const recs = await api.actions.releaseRecords(req(api).id);
        const run = api.getState().pbftRuns.find((x) => x.id === req(api).pbftRunIds[0])!;
        return { ok: true, note: `${run.committedCount}/4 validators committed${sc.offlineNode ? ` (${sc.offlineNode} offline)` : ""} in block ${run.blockId}. Released ${recs.map((r) => r.title).join(", ") || "no matching records"}.`, patch: { pbftRunId: run.id } };
      } catch (e) {
        return { ok: false, note: e instanceof Error ? e.message : String(e), patch: { pbftRunId: req(api).pbftRunIds[0] ?? null } };
      }
    },
  },
  {
    title: "Patient notification",
    actor: "Patient — Ayesha Khan (PAT-001)",
    explain: "Ayesha signs in and sees who requested her records, what was decided and why, alongside her consent grants and revocations.",
    concepts: ["Consent", "Ledger entry"],
    run: async (api) => {
      await signIn(api, PATIENT_USER);
      await api.actions.viewAccessHistory(PATIENT);
      const r = req(api);
      return { ok: true, note: `Ayesha sees ${r.id} from ${r.requestingHospitalId}: ${r.finalDecision?.outcome ?? r.status}. ${r.finalDecision?.reason ?? ""}` };
    },
  },
  {
    title: "Verify the hash-chained ledger",
    actor: "Auditor — Grace Mensah",
    explain: "The auditor recomputes every SHA-256 hash in the chain. If anyone had edited an entry, its hash and every link after it would no longer match.",
    concepts: ["Hash", "Ledger entry"],
    run: async (api, sc) => {
      await signIn(api, AUDITOR);
      let tampered = "";
      if (sc.tamperLedger) {
        if (api.getState().tamper) await api.actions.restoreTamper();
        const target = [...api.getState().ledger].reverse().find((e) => e.requestId === api.getState().guided.requestId && e.action === "FINAL_DECISION");
        if (target) {
          await api.actions.tamperEvent(target.id);
          tampered = ` ${target.id} (FINAL_DECISION) was edited in storage to "${api.getState().ledger[target.index].result}" without re-hashing.`;
        }
      }
      const v = await api.actions.verifyLedger();
      const n = api.getState().ledger.filter((e) => e.requestId === api.getState().guided.requestId).length;
      return {
        ok: sc.tamperLedger ? !v.valid : v.valid,
        note: v.valid
          ? `Ledger intact: ${v.checked} events verified. ${n} entries belong to this request.`
          : `${tampered} Verification FAILED at ${v.failure?.eventId}: recomputed hash ${v.failure?.expected.slice(0, 12)}… ≠ stored ${v.failure?.stored.slice(0, 12)}…. Restore it on the ledger page.`,
        patch: { ledgerCheck: { valid: v.valid, checked: v.checked, at: v.at } },
      };
    },
  },
];
