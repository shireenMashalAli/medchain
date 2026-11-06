import type { Permission, Purpose, RecordCategory, Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  PATIENT: "Patient",
  PHYSICIAN: "Physician",
  GOVERNANCE_ADMIN: "Hospital Administrator",
  RECORDS_OFFICER: "Hospital Records Officer",
  VALIDATOR: "Validator",
  AUDITOR: "Auditor",
};

export const PERMISSION_LABEL: Record<Permission, string> = {
  "consent:grant": "Grant consent",
  "consent:revoke": "Revoke consent",
  "record:view-own": "View own records",
  "request:create": "Create record request",
  "request:receive": "Receive incoming requests",
  "request:process": "Process requests (run contract)",
  "record:release": "Release records",
  "contract:create": "Create contract versions",
  "contract:deploy": "Deploy contract versions",
  "governance:propose": "Propose governance changes",
  "governance:vote": "Vote on proposals",
  "pbft:participate": "Operate a PBFT validator",
  "ledger:read": "Read the audit ledger",
  "ledger:verify": "Verify ledger integrity",
};

// Role-Based Access Control matrix. Fixed for the demonstration.
export const RBAC: Record<Role, Permission[]> = {
  PATIENT: ["consent:grant", "consent:revoke", "record:view-own"],
  PHYSICIAN: ["request:create", "ledger:read"],
  RECORDS_OFFICER: ["request:receive", "request:process", "record:release", "ledger:read"],
  GOVERNANCE_ADMIN: ["contract:create", "contract:deploy", "governance:propose", "ledger:read"],
  VALIDATOR: ["pbft:participate", "governance:vote", "ledger:read"],
  AUDITOR: ["ledger:read", "ledger:verify"],
};

export function hasPermission(role: Role, permission: Permission) {
  return RBAC[role].includes(permission);
}

// The record categories used in the assignment.
export const CATEGORIES: RecordCategory[] = ["LAB", "ECG", "MRI"];

export const CATEGORY_LABEL: Record<RecordCategory, string> = {
  LAB: "Laboratory results",
  ECG: "ECG",
  MRI: "MRI imaging",
  XRAY: "X-ray imaging",
  PRESCRIPTION: "Prescriptions",
  DISCHARGE: "Discharge summary",
};

export const PURPOSES: Purpose[] = ["TREATMENT", "RESEARCH"];

// Emergency care becomes selectable only when the active contract enables the E1 pathway.
export function purposesFor(emergencyPathway: boolean): Purpose[] {
  return emergencyPathway ? [...PURPOSES, "EMERGENCY_CARE"] : PURPOSES;
}

export const PURPOSE_LABEL: Record<Purpose, string> = {
  TREATMENT: "Treatment",
  RESEARCH: "Research",
  EMERGENCY_CARE: "Emergency care",
};
