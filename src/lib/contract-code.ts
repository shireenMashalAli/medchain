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
  { fn: "check(patient, grantee, record_type)", file: "src/lib/contract.ts", symbol: "check() → evaluateRule(1..3); re-run at release" },
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

  // p = patient DID, g = grantee DID (hospital or professional), now = block time
  mapping consents[p][g] -> Consent { allowedScope[]; purpose; expiry; status; }

  // Algorithm 08 — grant(p, g, scope, purpose, exp)
  function grant(p, g, scope, purpose, exp) {
    require(caller == p || caller == guardian(p));                      // line 2
    require(did.isRegistered(p) && scope.length > 0);
    require(now < exp && exp <= now + days(maxConsentDays));
    consents[p][g] = Consent(scope, purpose, exp, ACTIVE);              // line 3 (replaces the previous entry)
    emit ConsentGranted(p, g, scope, purpose, exp);
  }

  // Algorithm 08 — check(p, g, type): type in scope && now < exp     // line 4
  // g = the requesting professional and their hospital; the request supplies purpose and processor.
  function check(p, g, type) returns (Decision) {
    consent = consents[p][g];                                           // newest ACTIVE entry, else the latest one
    if (!R1_IdentityAndHospital(g, processor))                  return deny(R1);
    if (!R2_ConsentAndScope(consent, g, type))                  return deny(R2);   // type in scope
    if (!R3_PurposeExpiryRevocation(consent, request.purpose, now)) return deny(R3); // now < exp, not revoked${policy.emergencyPathway ? "\n    if (!E1_EmergencyPathway(request))                              return deny(E1);" : ""}
    emit ContractDecision(request.id, APPROVE);
    return APPROVE;
  }

  // Algorithm 08 — revoke(p, g)                                        // line 5
  function revoke(p, g) {
    require(caller == p || caller == guardian(p));
    consents[p][g].status = REVOKED;   // equivalent to delete for access; kept so Rule 3 can say "revoked" and the audit trail stays complete
    emit ConsentRevoked(p, g, now);
  }

  // Algorithm 08 — line 6: every access path calls check() first
  function releaseRecords(request) {
    require(request.contractDecision == APPROVE && request.hospitalApproved);
    require(check(request.patient, request.grantee, request.recordTypes) == APPROVE);   // re-checked at the moment of access
    release(records where type in request.recordTypes);
  }

  // A failed rule always denies. There is no override function.

${baseline}${emergency}
}`;
}
