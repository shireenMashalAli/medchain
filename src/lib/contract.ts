// Algorithm 08: Patient Consent Management Contract — grant(), check(), revoke().
// Pure functions: outcomes depend only on the inputs passed in. The store records their results on the ledger.
import { CATEGORY_LABEL, hasPermission, PURPOSE_LABEL, ROLE_LABEL } from "./rbac";
import { RULES } from "./contract-code";
import type { Consent, Grantee, Hospital, Policy, Purpose, RecordCategory, RuleId, User, Verification } from "./types";
import { fmtDateTime } from "./utils";

// ---------- shared ----------

export interface ContractEnv {
  hospitals: Hospital[];
  users: User[];
  consents: Consent[];
  verifications: Record<string, Verification>;
  authentications: Record<string, { at: string; eventId: string }>;
  now: Date;
}

export function sameGrantee(a: Grantee, b: Grantee) {
  return a.kind === b.kind && a.id === b.id;
}

export function granteeLabel(g: Grantee, users: User[], hospitals: Hospital[]) {
  if (g.kind === "HOSPITAL") {
    const h = hospitals.find((x) => x.id === g.id);
    return `${g.id} ${h?.name ?? ""}`.trim();
  }
  const u = users.find((x) => x.id === g.id);
  return `${u?.name ?? g.id}${u?.hospitalId ? ` (${u.hospitalId})` : ""}`;
}

export function consentIsUsable(c: Consent, now: Date) {
  return c.status === "ACTIVE" && new Date(c.expiry) > now;
}

// ---------- grant(patient, grantee, scope, purpose, expiry) ----------

export interface GrantArgs {
  patientId: string;
  grantee: Grantee;
  scope: RecordCategory[];
  purpose: Purpose;
  expiry: Date;
}

export function grant(consents: Consent[], args: GrantArgs, env: { now: Date; patientRegistered: boolean; maxConsentDays: number }) {
  if (!env.patientRegistered) throw new Error("grant(): the patient must register a DID before granting consent.");
  if (!args.scope.length) throw new Error("grant(): select at least one record category.");
  if (args.expiry <= env.now) throw new Error("grant(): expiry must be in the future.");
  if (args.expiry.getTime() - env.now.getTime() > env.maxConsentDays * 86400000) {
    throw new Error(`grant(): the active policy limits consent to ${env.maxConsentDays} days.`);
  }
  const superseded = consents.filter((c) => c.patientId === args.patientId && c.status === "ACTIVE" && sameGrantee(c.grantee, args.grantee));
  return {
    superseded,
    consent: {
      patientId: args.patientId,
      grantee: args.grantee,
      scope: [...args.scope],
      purpose: args.purpose,
      expiry: args.expiry.toISOString(),
      status: "ACTIVE" as const,
    },
  };
}

// ---------- revoke(patient, grantee) ----------

export function revoke(consents: Consent[], patientId: string, grantee: Grantee) {
  const active = consents.filter((c) => c.patientId === patientId && c.status === "ACTIVE" && sameGrantee(c.grantee, grantee));
  if (!active.length) throw new Error("revoke(): there is no active consent for this grantee.");
  return active;
}

// ---------- check(patient, grantee, record_type) ----------

export interface CheckRequest {
  patientId: string;
  grantee: { professionalId: string; hospitalId: string }; // the requesting professional and their hospital
  recordTypes: RecordCategory[];
  purpose: Purpose;
  sourceHospitalId: string;
  processor: User; // records officer executing the contract at the source hospital
}

type Input = { label: string; value: string; ok?: boolean };
export type RuleOutcome = { ruleId: RuleId; name: string; condition: string; inputs: Input[]; result: "PASS" | "FAIL"; reason: string };

// consents.latestFor(patient, grantee): newest ACTIVE consent for the professional or their hospital, else the newest of any status.
export function latestConsentFor(patientId: string, grantee: CheckRequest["grantee"], consents: Consent[]) {
  const matching = consents
    .filter((c) => c.patientId === patientId && ((c.grantee.kind === "HOSPITAL" && c.grantee.id === grantee.hospitalId) || (c.grantee.kind === "PROFESSIONAL" && c.grantee.id === grantee.professionalId)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return matching.find((c) => c.status === "ACTIVE") ?? matching[0] ?? null;
}

export function evaluateRule(ruleId: RuleId, req: CheckRequest, env: ContractEnv): RuleOutcome {
  const meta = RULES[ruleId - 1];
  const base = { ruleId, name: meta.name, condition: meta.condition };
  const { hospitals, users, consents, verifications, authentications, now } = env;

  if (ruleId === 1) {
    const reqHosp = hospitals.find((h) => h.id === req.grantee.hospitalId)!;
    const srcHosp = hospitals.find((h) => h.id === req.sourceHospitalId)!;
    const requester = users.find((u) => u.id === req.grantee.professionalId)!;
    const processor = req.processor;
    const reqAuth = !!authentications[requester.id];
    const reqVerified = verifications[requester.id]?.verified === true;
    const reqPerm = hasPermission(requester.role, "request:create");
    const procAuth = !!authentications[processor.id];
    const procVerified = verifications[processor.id]?.verified === true;
    const procPerm = hasPermission(processor.role, "request:process");
    const procAtSource = processor.hospitalId === srcHosp.id;
    const inputs: Input[] = [
      { label: `Requester ${requester.name} authenticated`, value: String(reqAuth), ok: reqAuth },
      { label: `Requester credential verified`, value: String(reqVerified), ok: reqVerified },
      { label: `Requesting hospital ${reqHosp.id} status`, value: reqHosp.status, ok: reqHosp.status === "ACTIVE" },
      { label: `Requester role (${ROLE_LABEL[requester.role]}) has request:create`, value: String(reqPerm), ok: reqPerm },
      { label: `Processor ${processor.name} authenticated`, value: String(procAuth), ok: procAuth },
      { label: `Processor credential verified`, value: String(procVerified), ok: procVerified },
      { label: `Processor role (${ROLE_LABEL[processor.role]}) has request:process`, value: String(procPerm), ok: procPerm },
      { label: `Source hospital ${srcHosp.id} status`, value: srcHosp.status, ok: srcHosp.status === "ACTIVE" },
      { label: "Processor belongs to source hospital", value: `${processor.hospitalId ?? "none"} vs ${srcHosp.id}`, ok: procAtSource },
    ];
    const problems = [
      !reqAuth && `${requester.name} is not authenticated`,
      !reqVerified && `${requester.name}'s credential is not verified`,
      reqHosp.status !== "ACTIVE" && `${reqHosp.id} ${reqHosp.name} is ${reqHosp.status.replace("_", " ").toLowerCase()}, not an active registered hospital`,
      !reqPerm && `the ${ROLE_LABEL[requester.role]} role cannot request records`,
      !procAuth && `${processor.name} is not authenticated`,
      !procVerified && `${processor.name}'s credential is not verified`,
      !procPerm && `the ${ROLE_LABEL[processor.role]} role cannot process requests`,
      srcHosp.status !== "ACTIVE" && `${srcHosp.id} ${srcHosp.name} is not active`,
      !procAtSource && `${processor.name} does not work at the source hospital ${srcHosp.id}`,
    ].filter(Boolean);
    return {
      ...base,
      inputs,
      result: problems.length ? "FAIL" : "PASS",
      reason: problems.length
        ? `Denied: ${problems.join("; ")}.`
        : "Both professionals are signed in with verified credentials, work at active registered hospitals, and hold the required role permissions.",
    };
  }

  const consent = latestConsentFor(req.patientId, req.grantee, consents);
  const requesterName = users.find((u) => u.id === req.grantee.professionalId)?.name ?? req.grantee.professionalId;

  if (ruleId === 2) {
    if (!consent) {
      return {
        ...base,
        inputs: [
          { label: "Requested record types", value: req.recordTypes.join(", ") },
          { label: `Consent for ${req.grantee.hospitalId} or ${requesterName}`, value: "none found", ok: false },
        ],
        result: "FAIL",
        reason: `Denied: the patient has not authorized ${req.grantee.hospitalId} or ${requesterName}.`,
      };
    }
    const outside = req.recordTypes.filter((c) => !consent.scope.includes(c));
    const inputs: Input[] = [
      { label: "Consent ID", value: consent.id, ok: true },
      { label: "consent.grantee", value: `${consent.grantee.kind === "HOSPITAL" ? "Hospital" : "Professional"} ${granteeLabel(consent.grantee, users, hospitals)}`, ok: true },
      { label: "Requested record types", value: req.recordTypes.join(", ") },
      { label: "consent.allowedScope", value: consent.scope.join(", ") },
      { label: "Requested types outside scope", value: outside.length ? outside.join(", ") : "none", ok: outside.length === 0 },
    ];
    return {
      ...base,
      inputs,
      result: outside.length ? "FAIL" : "PASS",
      reason: outside.length
        ? `Denied: ${outside.map((c) => CATEGORY_LABEL[c]).join(", ")} ${outside.length > 1 ? "are" : "is"} not in the patient's consent scope (${consent.scope.join(", ")}).`
        : `Consent ${consent.id} authorizes ${granteeLabel(consent.grantee, users, hospitals)} and covers all requested types (${req.recordTypes.join(", ")}).`,
    };
  }

  // Rule 3
  if (!consent) {
    return { ...base, inputs: [{ label: "Consent", value: "none found", ok: false }], result: "FAIL", reason: "Denied: no consent exists to check purpose and expiry against." };
  }
  const purposeOk = req.purpose === consent.purpose;
  const statusOk = consent.status === "ACTIVE";
  const expiryOk = now < new Date(consent.expiry);
  const inputs: Input[] = [
    { label: "request.purpose", value: PURPOSE_LABEL[req.purpose] },
    { label: "consent.purpose", value: PURPOSE_LABEL[consent.purpose], ok: purposeOk },
    { label: "consent.status", value: consent.status, ok: statusOk },
    { label: "currentTime", value: fmtDateTime(now.toISOString()) },
    { label: "consent.expiry", value: fmtDateTime(consent.expiry), ok: expiryOk },
  ];
  const problems = [
    !purposeOk && `purpose "${PURPOSE_LABEL[req.purpose]}" does not match the consented purpose "${PURPOSE_LABEL[consent.purpose]}"`,
    !statusOk && `consent ${consent.id} is ${consent.status}${consent.revokedAt ? ` (revoked ${fmtDateTime(consent.revokedAt)})` : ""}`,
    !expiryOk && `consent ${consent.id} expired on ${fmtDateTime(consent.expiry)}`,
  ].filter(Boolean);
  return {
    ...base,
    inputs,
    result: problems.length ? "FAIL" : "PASS",
    reason: problems.length ? `Denied: ${problems.join("; ")}.` : "Purpose matches and the consent is active, not revoked and not expired.",
  };
}

// check(patient, grantee, record_type): runs R1 → R2 → R3 and stops at the first failure.
export function check(req: CheckRequest, env: ContractEnv, alreadyEvaluated = 0) {
  const rules: RuleOutcome[] = [];
  for (const r of RULES) {
    if (r.id <= alreadyEvaluated) continue;
    const outcome = evaluateRule(r.id, req, env);
    rules.push(outcome);
    if (outcome.result === "FAIL") return { decision: "DENY" as const, deniedByRule: r.id, rules };
  }
  return { decision: "APPROVE" as const, deniedByRule: undefined, rules };
}

// Governance extension E1 — only exists when the active contract version enables it.
export function evaluateEmergencyExtension(purpose: Purpose, reason: string, policy: Policy) {
  if (!policy.emergencyPathway || purpose !== "EMERGENCY_CARE") return null;
  const ok = reason.trim().length >= 20;
  return {
    result: ok ? ("PASS" as const) : ("FAIL" as const),
    reason: ok
      ? "Emergency justification documented. Request flagged for retrospective review (break-glass audit)."
      : "Denied: emergency requests must include a clinical justification of at least 20 characters.",
  };
}
