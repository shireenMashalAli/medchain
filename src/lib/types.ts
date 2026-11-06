// Domain types for the MedChain simulation.

export type HospitalId = "H1" | "H2" | "H3" | "H4" | "H5";
export type ValidatorId = "H1" | "H2" | "H3" | "H4";

export type HospitalStatus = "ACTIVE" | "SUSPENDED" | "NOT_REGISTERED";
export type NodeStatus = "ONLINE" | "OFFLINE" | "FAULTY";

export interface Hospital {
  id: HospitalId;
  name: string;
  city: string;
  did: string;
  status: HospitalStatus;
  validator: boolean;
}

export type Role =
  | "PATIENT"
  | "PHYSICIAN"
  | "GOVERNANCE_ADMIN"
  | "RECORDS_OFFICER"
  | "VALIDATOR"
  | "AUDITOR";

export type Permission =
  | "consent:grant"
  | "consent:revoke"
  | "record:view-own"
  | "request:create"
  | "request:receive"
  | "request:process"
  | "record:release"
  | "contract:create"
  | "contract:deploy"
  | "governance:propose"
  | "governance:vote"
  | "pbft:participate"
  | "ledger:read"
  | "ledger:verify";

export interface VerifiableCredential {
  id: string;
  type: string[];
  issuer: string; // issuer DID
  subject: string; // holder DID
  claims: {
    name: string;
    role: Role;
    hospitalId: HospitalId | null;
    licence: string;
  };
  issuedAt: string;
  expiresAt: string;
  status: "VALID" | "REVOKED";
  proof: string; // SHA-256 over the canonical credential body (simulated signature)
}

export interface User {
  id: string;
  name: string;
  role: Role;
  hospitalId: HospitalId | null;
  did: string;
  patientId?: string;
  credential: VerifiableCredential;
}

export interface Verification {
  verified: boolean;
  verifiedAt: string;
  eventId: string;
  checks: { label: string; passed: boolean }[];
}

export type RecordCategory = "LAB" | "ECG" | "MRI" | "XRAY" | "PRESCRIPTION" | "DISCHARGE";

// Patients consent for Treatment or Research. EMERGENCY_CARE exists only once governance enables the E1 pathway.
export type Purpose = "TREATMENT" | "RESEARCH" | "EMERGENCY_CARE";

export interface Patient {
  id: string;
  name: string;
  dob: string;
  sex: "F" | "M";
  did: string | null;
  didDocument: DidDocument | null;
  guardianDid: string | null; // legal guardian who may also grant/revoke (Algorithm 08, line 2)
}

export interface DidDocument {
  id: string;
  controller: string;
  created: string;
  verificationMethod: { id: string; type: string; publicKeyMultibase: string }[];
}

export interface MedicalRecord {
  id: string;
  patientId: string;
  hospitalId: HospitalId; // custodian hospital
  category: RecordCategory;
  title: string;
  date: string;
  summary: string;
  values: { label: string; value: string }[];
}

export type ConsentStatus = "ACTIVE" | "REVOKED" | "SUPERSEDED";

// A grantee is either a whole hospital or one designated professional, identified by its DID (g in Algorithm 08).
export interface Grantee {
  kind: "HOSPITAL" | "PROFESSIONAL";
  id: string; // HospitalId or user id, for display
  did: string;
}
export type GranteeRef = Omit<Grantee, "did">;

// consents[p][g]: one ACTIVE entry per (patient DID, grantee DID).
export interface Consent {
  id: string;
  patientId: string;
  patientDid: string;
  grantee: Grantee;
  scope: RecordCategory[];
  purpose: Purpose;
  expiry: string;
  status: ConsentStatus;
  createdAt: string;
  revokedAt?: string;
  eventId: string;
  txId: string;
}

export type RequestStatus =
  | "SUBMITTED"
  | "RECEIVED"
  | "UNDER_REVIEW"
  | "CONSENT_CHECKED"
  | "CONTRACT_PENDING"
  | "DENIED"
  | "CONTRACT_APPROVED"
  | "PBFT_IN_PROGRESS"
  | "CONSENSUS_FAILED"
  | "HOSPITAL_APPROVED" // contract passed and the source hospital approved; release still requires consensus
  | "COMMITTED" // consensus committed the approval: records can be released
  | "RELEASED"
  | "REJECTED"; // rejected by the source hospital

export type RuleId = 1 | 2 | 3;

export interface RuleEvaluation {
  ruleId: RuleId;
  name: string;
  condition: string;
  inputs: { label: string; value: string; ok?: boolean }[];
  result: "PASS" | "FAIL";
  reason: string;
  eventId: string;
  timestamp: string;
  processorId: string;
}

export interface ConsentCheck {
  consentId: string | null;
  found: boolean;
  summary: string;
  eventId: string;
  timestamp: string;
}

export interface ReviewCheck {
  label: string;
  passed: boolean;
  detail: string;
}

export interface FinalDecision {
  outcome: "RELEASED" | "DENIED" | "REJECTED";
  reason: string;
  by: string;
  at: string;
  eventId: string;
}

export interface DataRequest {
  id: string;
  txRef: string; // transaction reference shared by every ledger event of this request
  patientId: string;
  sourceHospitalId: HospitalId; // Hospital B: holds the records
  requestingHospitalId: HospitalId; // Hospital A: asks for the records
  requesterId: string;
  categories: RecordCategory[];
  purpose: Purpose;
  reason: string;
  createdAt: string;
  status: RequestStatus;
  history: { status: RequestStatus; at: string; by: string; eventId: string }[];
  review?: { checks: ReviewCheck[]; eventId: string; at: string };
  consentCheck?: ConsentCheck;
  rules: RuleEvaluation[];
  contractVersion?: string;
  decision?: "APPROVE" | "DENY";
  deniedByRule?: RuleId;
  pbftRunIds: string[];
  blockId?: string;
  releasedRecordIds: string[];
  finalDecision?: FinalDecision;
}

export type EventKind = "AUDIT" | "PBFT" | "TRANSACTION" | "BLOCK";

// Who requested which patient's data, from which hospital, and why. Copied into the event when it is recorded.
export interface EventSubject {
  patientId: string | null;
  patientName: string | null;
  requestingHospitalId: HospitalId | null;
  sourceHospitalId: HospitalId | null;
  categories: RecordCategory[];
  purpose: Purpose | null;
  reason: string | null;
}

export interface LedgerEvent {
  index: number;
  id: string;
  txId: string;
  timestamp: string;
  kind: EventKind;
  actor: string;
  actorRole: string;
  actorDid: string;
  hospitalId: HospitalId | null;
  action: string;
  result: string;
  requestId: string | null;
  contractVersion: string;
  blockId: string | null;
  subject: EventSubject;
  explanation: string;
  details: Record<string, unknown>;
  previousHash: string;
  currentHash: string;
}

export interface Block {
  id: string;
  height: number;
  timestamp: string;
  sequence: number | null;
  view: number | null;
  primary: ValidatorId | null;
  txIds: string[];
  requestId: string | null;
  label: string;
  eventHashes: string[];
  merkleRoot: string;
  commitVotes: ValidatorId[];
  previousBlockHash: string;
  hash: string;
}

export type PbftPhaseName = "REQUEST" | "VIEW-CHANGE" | "PRE-PREPARE" | "PREPARE" | "COMMIT" | "REPLY";

export interface PbftMessage {
  from: string;
  to: string;
  type: PbftPhaseName;
  digest: string;
  status: "DELIVERED" | "DROPPED" | "MISMATCH";
}

export interface PbftPhase {
  name: PbftPhaseName;
  title: string;
  explanation: string;
  messages: PbftMessage[];
  summary: string;
}

export interface PbftNodeResult {
  id: ValidatorId;
  status: NodeStatus;
  isPrimary: boolean;
  receivedPrePrepare: boolean;
  matchingPrepares: number;
  prepared: boolean;
  matchingCommits: number;
  committed: boolean;
  response: string;
}

export interface PbftRun {
  id: string;
  requestId: string | null;
  txId: string;
  digest: string;
  sequence: number;
  view: number;
  primary: ValidatorId | null;
  nodeStatus: Record<ValidatorId, NodeStatus>;
  phases: PbftPhase[];
  nodes: PbftNodeResult[];
  committedCount: number;
  quorum: number;
  faultTolerance: number;
  outcome: "COMMITTED" | "FAILED";
  outcomeReason: string;
  revealed: number; // number of phases already executed
  blockId: string | null;
  startedAt: string;
}

export interface Policy {
  maxConsentDays: number;
  emergencyPathway: boolean;
}

export type ContractStatus = "DRAFT" | "VALIDATED" | "INVALID" | "DEPLOYED" | "SUPERSEDED";

export interface ContractVersion {
  contractId: string;
  name: string;
  version: string;
  status: ContractStatus;
  createdBy: string;
  createdByDid: string;
  createdAt: string;
  notes: string;
  policy: Policy;
  code: string;
  codeHash: string;
  source: "STUDIO" | "GOVERNANCE" | "GENESIS";
  proposalId?: string;
  validation?: { checks: { label: string; passed: boolean; detail: string }[]; passed: boolean; at: string };
  receipt?: {
    txId: string;
    blockId: string;
    deployedAt: string;
    deployer: string;
    address: string;
    eventId: string;
  };
}

export type ProposalType = "POLICY_UPDATE" | "EMERGENCY_PATHWAY";
export type Vote = "APPROVE" | "REJECT";

export interface Proposal {
  id: string;
  type: ProposalType;
  title: string;
  description: string;
  creatorId: string;
  createdAt: string;
  baseVersion: string;
  proposedVersion: string;
  policy: Policy;
  votes: Record<ValidatorId, { vote: Vote; at: string; eventId: string } | null>;
  status: "OPEN" | "APPROVED" | "REJECTED" | "DEPLOYED";
}

export type ScenarioId = "1" | "2" | "3" | "4" | "5" | "6" | "7";

export interface GuidedState {
  scenario: ScenarioId;
  stage: number; // index of the stage being viewed
  completed: Record<number, { ok: boolean; note: string; skipped?: boolean; from?: number; to?: number }>;
  requestId: string | null;
  consentIds: string[];
  pbftRunId: string | null;
  ledgerCheck: { valid: boolean; checked: number; at: string } | null;
}

export interface AppState {
  schema: number;
  revision: number; // incremented on every committed change; lets tabs detect newer state
  hospitals: Hospital[];
  users: User[];
  patients: Patient[];
  records: MedicalRecord[];
  consents: Consent[];
  requests: DataRequest[];
  ledger: LedgerEvent[];
  blocks: Block[];
  pbftRuns: PbftRun[];
  nodeStatus: Record<ValidatorId, NodeStatus>;
  pbftView: number;
  pbftSequence: number;
  contracts: ContractVersion[];
  activeContractVersion: string;
  proposals: Proposal[];
  sessionUserId: string;
  verifications: Record<string, Verification>;
  authentications: Record<string, { at: string; eventId: string }>;
  clockOffsetDays: number; // demo clock: lets the expiry scenario move time forward
  tamper: { eventId: string; original: string } | null;
  guided: GuidedState;
  counters: Record<"event" | "request" | "consent" | "tx" | "block" | "pbft" | "proposal", number>;
}
