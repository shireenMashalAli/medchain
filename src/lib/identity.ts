// DID registration and Verifiable Credential verification (simulated, but the checks are real).
import { canonicalize, sha256 } from "./crypto";
import type { DidDocument, Hospital, VerifiableCredential } from "./types";

export const CONSORTIUM_DID = "did:medchain:consortium";

export function credentialBody(vc: VerifiableCredential) {
  const { proof: _proof, status: _status, ...body } = vc;
  void _proof;
  void _status;
  return canonicalize(body);
}

export async function signCredential(vc: Omit<VerifiableCredential, "proof">): Promise<VerifiableCredential> {
  const draft = { ...vc, proof: "" } as VerifiableCredential;
  return { ...draft, proof: await sha256(credentialBody(draft)) };
}

export function trustedIssuers(hospitals: Hospital[]) {
  return [CONSORTIUM_DID, ...hospitals.filter((h) => h.status === "ACTIVE").map((h) => h.did)];
}

export async function verifyCredential(vc: VerifiableCredential, hospitals: Hospital[], now = new Date()) {
  const recomputed = await sha256(credentialBody(vc));
  const issuers = trustedIssuers(hospitals);
  const checks = [
    { label: `Issuer ${vc.issuer} is a trusted consortium issuer`, passed: issuers.includes(vc.issuer) },
    { label: "Proof hash matches credential contents (not altered)", passed: recomputed === vc.proof },
    { label: `Credential not expired (expires ${vc.expiresAt.slice(0, 10)})`, passed: new Date(vc.expiresAt) > now },
    { label: "Credential not revoked", passed: vc.status === "VALID" },
  ];
  return { verified: checks.every((c) => c.passed), checks };
}

export async function patientDid(patientId: string) {
  return `did:medchain:patient:${(await sha256(`patient:${patientId}`)).slice(0, 16)}`;
}

export async function makeDidDocument(did: string, controller: string): Promise<DidDocument> {
  const key = await sha256(`key:${did}:${Date.now()}`);
  return {
    id: did,
    controller,
    created: new Date().toISOString(),
    verificationMethod: [
      { id: `${did}#key-1`, type: "Ed25519VerificationKey2020 (simulated)", publicKeyMultibase: `z${key.slice(0, 44)}` },
    ],
  };
}
