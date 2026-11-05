# MedChain — Blockchain Governance System for Healthcare

An interactive academic demonstration of consent-driven medical-record sharing between hospitals. It runs entirely in the browser: no backend, no paid service, no real blockchain node. Blockchain operations (PBFT consensus, contract deployment, blocks) are **simulated** and labelled as such. All patient data is synthetic.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 (Node.js 20.9+). The landing page, **Request Workflow**, walks one request through every step on a single page with the live ledger beside it. State is saved in `localStorage`; **Reset Demo Data** on the ledger page restores the initial data.

## Layout

Left: navigation. Centre: the workspace. Right: the **live transaction ledger**, which shows every event the moment it has been hashed and saved: who acted, their role, the patient, the requesting and source hospitals, the record categories, the purpose, the transaction and request IDs, and the previous and current SHA-256 hashes. On screens narrower than 1280px it opens as a drawer from the "Live ledger" button. It reads the same event collection as the full ledger page.

## The workflow (as performed in the GUI)

1. **Sign in** (session menu, top right) → `AUTHENTICATION_VERIFIED`, `CREDENTIAL_VERIFIED`, `HOSPITAL_VERIFIED`.
2. **Physician requests a patient's history** (Hospital Requests → New request) → `REQUEST_CREATED`, with a request ID and a transaction ID that every later event of the request reuses.
3. **Source hospital records officer**: Receive → `REQUEST_RECEIVED`; Start review → `REQUEST_REVIEW_STARTED`; Complete verification (professional, patient reference, requested data, consent on file) → `HOSPITAL_VERIFICATION_COMPLETED`.
4. **Algorithm 08** (execution screen): `CONTRACT_EXECUTION_STARTED`, `RULE_1_EVALUATED`, `RULE_2_EVALUATED`, `RULE_3_EVALUATED`, then `CONTRACT_APPROVED` or `CONTRACT_DENIED`. A failed rule ends the request (`ACCESS_DENIED`, `MEDICAL_RECORD_WITHHELD`) and cannot be overridden.
5. **Hospital response**: Approve → `HOSPITAL_APPROVED`, or Reject with reason → `HOSPITAL_REJECTED` and `ACCESS_DENIED`.
6. **Release**: consensus commits the approval (PBFT phases recorded), then `ACCESS_GRANTED` and `MEDICAL_RECORD_RELEASED` for the permitted categories only, followed by `FINAL_DECISION` and `PATIENT_NOTIFIED`.
7. **Patient Portal**: grant (`CONSENT_GRANTED`) or revoke (`CONSENT_REVOKED`) consent, and see every request for their records with its decision and reason.

## How events are recorded

All changes go through one queue in `src/lib/store.tsx`:

- `commit()` rebases on the newest saved state (so another tab's events are never overwritten), applies the change, and records events with `recordLedgerEvent()`.
- `recordLedgerEvent()` assigns the event ID, reuses the transaction ID, captures the signed-in actor, role and hospital, and attaches the patient and request context.
- Every new event is hashed in order: `currentHash = SHA256(previousHash + canonicalEventPayload)` using the Web Crypto API (`src/lib/ledger.ts`).
- The state is saved to `localStorage` **before** any screen updates. If saving fails, the action is rejected and shown as an error.
- Other open tabs pick up the change through the `storage` event.

The initial demonstration data (two consents, two patient DIDs, the contract) is labelled as genesis/seed data on the ledger, not as user actions.

## Algorithm 08 — Patient Consent Management Contract

`src/lib/contract.ts` holds the code every page runs: `grant()`, `check()` (which calls `evaluateRule(1..3)`), and `revoke()`. Contract Studio shows this file as-is ("Executed TypeScript") with its SHA-256 hash, alongside the contract pseudocode.

- **R1 — Identity and hospital:** requester and processor authenticated, credentials verified, hospitals registered and active, roles permit the action.
- **R2 — Consent and scope:** a consent exists for the requesting hospital or designated professional, and every requested category is in scope.
- **R3 — Purpose, expiry, revocation:** purpose matches; consent is active, not revoked, not expired.

## Test scenarios

On the Guided Demonstration, pick a card and press **Run All**, or do the same steps by hand.

| | Scenario | Result |
|---|---|---|
| 1 | Successful ECG request | All rules pass, hospital approves, ECG released |
| 2 | MRI request | Denied by Rule 2 |
| 3 | Unauthorized hospital (H5) | Denied by Rule 1 |
| 4 | Revoked consent | Denied by Rule 3 |
| 5 | Expired consent (demo clock moves past expiry) | Denied by Rule 3 |
| 6 | Ledger tampering | Verification fails at the altered event |
| 7 | One PBFT node offline | 3 of 4 validators commit; ECG released |

Sample data: patient Ayesha Khan (PAT-001); initial consent to H1 City Hospital for LAB and ECG, purpose Treatment, expiring 31 December 2026. Hospitals H1–H4 are active validators; H5 External Hospital is unregistered. Demo users include Dr. Ahmed Raza (physician, H1), Sara Malik (records officer, H2), an administrator, a validator and an auditor.

## Project layout

```
src/
  app/                 pages (App Router), one folder per sidebar entry; api/contract-source serves contract.ts
  components/          app shell, live ledger, session selector, rules panel, PBFT panel, code viewer
  components/ui/       shadcn-style primitives
  lib/                 types, seed data, Algorithm 08, PBFT, ledger, Merkle, identity, store
```
