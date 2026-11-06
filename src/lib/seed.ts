// Synthetic demonstration data. No real patients.
import { sha256 } from "./crypto";
import { CONTRACT_ID, CONTRACT_NAME, generateContractCode } from "./contract-code";
import { CONSORTIUM_DID, makeDidDocument, patientDid, signCredential } from "./identity";
import type { AppState, Hospital, HospitalId, MedicalRecord, Patient, Policy, Role, User } from "./types";
import { addDays } from "./utils";

export const HOSPITALS: Hospital[] = [
  { id: "H1", name: "City Hospital", city: "Northgate", did: "did:medchain:hospital:h1", status: "ACTIVE", validator: true },
  { id: "H2", name: "General Hospital", city: "Riverside", did: "did:medchain:hospital:h2", status: "ACTIVE", validator: true },
  { id: "H3", name: "Medical Centre", city: "Eastfield", did: "did:medchain:hospital:h3", status: "ACTIVE", validator: true },
  { id: "H4", name: "Central Hospital", city: "Midtown", did: "did:medchain:hospital:h4", status: "ACTIVE", validator: true },
  { id: "H5", name: "External Hospital", city: "Outside consortium", did: "did:medchain:hospital:h5", status: "NOT_REGISTERED", validator: false },
];

export const DEFAULT_POLICY: Policy = { maxConsentDays: 365, emergencyPathway: false };

interface UserSeed {
  id: string;
  name: string;
  role: Role;
  hospitalId: HospitalId | null;
  licence: string;
  patientId?: string;
}

// One user per role the assignment names, plus an unregistered-hospital physician for the Rule 1 test.
const USER_SEEDS: UserSeed[] = [
  { id: "u-pat-001", name: "Ayesha Khan", role: "PATIENT", hospitalId: null, licence: "MRN PAT-001", patientId: "PAT-001" },
  { id: "u-phy-h1", name: "Dr. Ahmed Raza", role: "PHYSICIAN", hospitalId: "H1", licence: "GMC-448812" },
  { id: "u-phy-h5", name: "Dr. Victor Hale", role: "PHYSICIAN", hospitalId: "H5", licence: "EXT-00917" },
  { id: "u-rec-h2", name: "Sara Malik", role: "RECORDS_OFFICER", hospitalId: "H2", licence: "HRO-2201" },
  { id: "u-adm-h3", name: "Imran Qureshi", role: "GOVERNANCE_ADMIN", hospitalId: "H3", licence: "ADM-3004" },
  { id: "u-aud", name: "Grace Mensah", role: "AUDITOR", hospitalId: null, licence: "AUD-0099" },
];

const PATIENTS: Omit<Patient, "did" | "didDocument" | "guardianDid">[] = [
  { id: "PAT-001", name: "Ayesha Khan", dob: "1986-04-12", sex: "F" },
];

const RECORDS: MedicalRecord[] = [
  { id: "REC-001-LAB", patientId: "PAT-001", hospitalId: "H2", category: "LAB", title: "Full blood count & lipid panel", date: "2026-09-14", summary: "Routine bloods. Mild LDL elevation.", values: [{ label: "Haemoglobin", value: "13.4 g/dL" }, { label: "WBC", value: "6.8 ×10⁹/L" }, { label: "LDL cholesterol", value: "3.6 mmol/L" }] },
  { id: "REC-001-ECG", patientId: "PAT-001", hospitalId: "H2", category: "ECG", title: "12-lead resting ECG", date: "2026-10-02", summary: "Sinus rhythm, no acute ST changes.", values: [{ label: "Heart rate", value: "72 bpm" }, { label: "PR interval", value: "158 ms" }, { label: "QTc", value: "421 ms" }] },
  { id: "REC-001-MRI", patientId: "PAT-001", hospitalId: "H2", category: "MRI", title: "MRI brain without contrast", date: "2026-07-21", summary: "No acute intracranial abnormality.", values: [{ label: "Sequence", value: "T1/T2/FLAIR" }, { label: "Finding", value: "Normal study" }] },
];

export const SCHEMA_VERSION = 5;

// Initial consent from the project brief: City Hospital, LAB + ECG, Treatment, valid until the end of 31 December 2026 (local time).
export const initialConsentExpiry = () => new Date(2026, 11, 31, 23, 59, 59).toISOString();

// Builds the initial state without ledger hashes; the store seals the genesis events.
export async function buildSeedState(): Promise<AppState> {
  const now = new Date();
  const hospitals = HOSPITALS.map((h) => ({ ...h }));

  const users: User[] = [];
  for (const s of USER_SEEDS) {
    const did = s.patientId ? await patientDid(s.patientId) : `did:medchain:user:${(await sha256(`user:${s.id}`)).slice(0, 16)}`;
    const hospital = hospitals.find((h) => h.id === s.hospitalId);
    // Patients get identity credentials from their registering hospital; H5 issues its own (not trusted).
    const issuer = s.role === "PATIENT" ? hospitals[1].did : s.role === "AUDITOR" ? CONSORTIUM_DID : hospital!.did;
    const credential = await signCredential({
      id: `urn:vc:medchain:${s.id}`,
      type: ["VerifiableCredential", s.role === "PATIENT" ? "PatientIdentityCredential" : "HealthcareProfessionalCredential"],
      issuer,
      subject: did,
      claims: { name: s.name, role: s.role, hospitalId: s.hospitalId, licence: s.licence },
      issuedAt: "2026-01-05T09:00:00.000Z",
      expiresAt: "2027-12-31T23:59:59.000Z",
      status: "VALID",
    });
    users.push({ id: s.id, name: s.name, role: s.role, hospitalId: s.hospitalId, did, patientId: s.patientId, credential });
  }

  const patients: Patient[] = [];
  for (const p of PATIENTS) {
    const did = await patientDid(p.id);
    const registered = true;
    // Ayesha is an adult, so she has no guardian; the contract still accepts a guardian DID when one is set.
    patients.push({ ...p, did: registered ? did : null, didDocument: registered ? await makeDidDocument(did, did) : null, guardianDid: null });
  }

  const code = generateContractCode("1.0.0", DEFAULT_POLICY);
  const genesisContract = {
    contractId: CONTRACT_ID,
    name: CONTRACT_NAME,
    version: "1.0.0",
    status: "DEPLOYED" as const,
    createdBy: "MedChain Consortium",
    createdByDid: CONSORTIUM_DID,
    createdAt: now.toISOString(),
    notes: "Genesis deployment of the three fixed baseline rules.",
    policy: DEFAULT_POLICY,
    code,
    codeHash: await sha256(code),
    source: "GENESIS" as const,
  };

  return {
    schema: SCHEMA_VERSION,
    revision: 0,
    hospitals,
    users,
    patients,
    records: RECORDS.map((r) => ({ ...r, values: r.values.map((v) => ({ ...v })) })),
    // eventId / txId are filled in when the store records the genesis events.
    consents: [
      {
        id: "CON-0001",
        patientId: "PAT-001",
        patientDid: patients[0].did!,
        grantee: { kind: "HOSPITAL", id: "H1", did: hospitals[0].did },
        scope: ["LAB", "ECG"],
        purpose: "TREATMENT",
        expiry: initialConsentExpiry(),
        status: "ACTIVE",
        createdAt: addDays(now, -14).toISOString(),
        eventId: "",
        txId: "",
      },
    ],
    requests: [],
    ledger: [],
    blocks: [],
    pbftRuns: [],
    nodeStatus: { H1: "ONLINE", H2: "ONLINE", H3: "ONLINE", H4: "ONLINE" },
    pbftView: 0,
    pbftSequence: 0,
    contracts: [genesisContract],
    activeContractVersion: "1.0.0",
    proposals: [],
    sessionUserId: "u-pat-001",
    verifications: {},
    authentications: {},
    clockOffsetDays: 0,
    tamper: null,
    guided: { scenario: "1", stage: 0, completed: {}, requestId: null, consentIds: [], pbftRunId: null, ledgerCheck: null },
    counters: { event: 0, request: 0, consent: 1, tx: 0, block: 0, pbft: 0, proposal: 0 },
  };
}
