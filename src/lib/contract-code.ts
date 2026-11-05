import type { Policy } from "./types";

export const CONTRACT_ID = "SC-CONSENT-001";
export const CONTRACT_NAME = "PatientConsentManagement";

export const RULES = [
  {
    id: 1 as const,
    name: "Identity and hospital authorization",
    condition: "user.authenticated && user.credentialVerified && hospital.status == ACTIVE && role.hasPermission",
    plain:
      "The requesting professional must be signed in, hold a verified credential, work at a registered and active hospital, and have a role that allows the request. The same applies to the records officer processing it.",
  },
  {
    id: 2 as const,
    name: "Patient consent and record scope",
    condition: "consent != null && grantee IN consent.grantees && requestedRecordType IN consent.allowedScope",
    plain:
      "A consent from the patient must exist for the requesting hospital or the designated professional, and every requested record category must be inside it.",
  },
  {
    id: 3 as const,
    name: "Purpose, expiry and revocation",
    condition: "request.purpose == consent.purpose && consent.status == ACTIVE && currentTime < consent.expiry",
    plain:
      "The request's purpose must match the purpose the patient agreed to, and the consent must still be active: not revoked and not expired.",
  },
];

// Implementation map shown in Contract Studio, so readers can find the real code.
export const IMPLEMENTATION = [
  { fn: "grant(patient, grantee, scope, purpose, expiry)", file: "src/lib/contract.ts", symbol: "grant()" },
  { fn: "check(patient, grantee, record_type)", file: "src/lib/contract.ts", symbol: "check() → evaluateRule(1..3)" },
  { fn: "revoke(patient, grantee)", file: "src/lib/contract.ts", symbol: "revoke()" },
];

// The three fixed rules. Validation compares this block byte-for-byte, so any edit is rejected.
export const BASELINE_RULES = `  // ===== FIXED BASELINE RULES — immutable, no user or administrator can edit or override them =====
  rule R1_IdentityAndHospital(grantee, processor) returns (bool) {
    return grantee.authenticated && credentials[grantee].verified
        && hospitals[grantee.hospital].status == ACTIVE
        && RBAC.has(grantee.role, "request:create")
        && processor.authenticated && credentials[processor].verified
        && RBAC.has(processor.role, "request:process")
        && hospitals[request.sourceHospital].status == ACTIVE
        && processor.hospital == request.sourceHospital;
  }

  rule R2_ConsentAndScope(consent, grantee, record_type) returns (bool) {
    return consent != null
        && (consent.grantee == grantee.hospital || consent.grantee == grantee)
        && all(t IN consent.allowedScope for t in record_type);
  }

  rule R3_PurposeExpiryRevocation(consent, purpose, now) returns (bool) {
    return purpose == consent.purpose
        && consent.status == ACTIVE        // not revoked or superseded
        && now < consent.expiry;           // not expired
  }`;

const TAMPERED_RULE2_LINE = "        && all(t IN consent.allowedScope for t in record_type);";
const TAMPERED_RULE2_REPLACEMENT = "        && true;  // scope check relaxed: any record type allowed";

export function generateContractCode(version: string, policy: Policy, opts: { editBaseline?: boolean } = {}) {
  const baseline = opts.editBaseline ? BASELINE_RULES.replace(TAMPERED_RULE2_LINE, TAMPERED_RULE2_REPLACEMENT) : BASELINE_RULES;
  const emergency = policy.emergencyPathway
    ? `

  // ===== GOVERNANCE EXTENSION: emergency-access pathway =====
  // Adds checks on top of R1–R3. It cannot bypass them.
  rule E1_EmergencyPathway(request) returns (bool) {
    if (request.purpose != EMERGENCY_CARE) return true;
    flagForRetrospectiveReview(request.id);     // break-glass audit flag
    return length(request.reason) >= 20;        // documented clinical justification
  }`
    : "";

  return `contract ${CONTRACT_NAME} {
  id      = "${CONTRACT_ID}";
  version = "${version}";

  // ----- governance parameters -----
  param maxConsentDays    = ${policy.maxConsentDays};
  param emergencyPathway  = ${policy.emergencyPathway};

  struct Consent { patient; grantee; allowedScope[]; purpose; expiry; status; }

  // Algorithm 08 — grant(patient, grantee, scope, purpose, expiry)
  function grant(patient, grantee, scope, purpose, expiry) {
    require(caller == patient && did.isRegistered(patient));
    require(scope.length > 0);
    require(now < expiry && expiry <= now + days(maxConsentDays));
    for (c in consents.active(patient, grantee)) c.status = SUPERSEDED;
    consents.add(Consent(patient, grantee, scope, purpose, expiry, ACTIVE));
    emit ConsentGranted(patient, grantee, scope, purpose, expiry);
  }

  // Algorithm 08 — check(patient, grantee, record_type)
  // grantee = requesting professional and their hospital; the request supplies purpose and processor.
  function check(patient, grantee, record_type) returns (Decision) {
    consent = consents.latestFor(patient, grantee);   // newest ACTIVE, else newest of any status
    if (!R1_IdentityAndHospital(grantee, processor))                return deny(R1);
    if (!R2_ConsentAndScope(consent, grantee, record_type))         return deny(R2);
    if (!R3_PurposeExpiryRevocation(consent, request.purpose, now)) return deny(R3);${policy.emergencyPathway ? "\n    if (!E1_EmergencyPathway(request))                              return deny(E1);" : ""}
    emit ContractDecision(request.id, APPROVE);
    return APPROVE;   // eligible: consensus, then the source hospital's final approval
  }

  // Algorithm 08 — revoke(patient, grantee)
  function revoke(patient, grantee) {
    require(caller == patient);
    require(consents.active(patient, grantee).length > 0);
    for (c in consents.active(patient, grantee)) { c.status = REVOKED; c.revokedAt = now; }
    emit ConsentRevoked(patient, grantee, now);
  }

  // A failed rule always denies. There is no override function.

${baseline}${emergency}
}`;
}
