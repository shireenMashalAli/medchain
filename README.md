# MedChain — Patient Consent Management on a Hash-Chained Ledger

An academic demonstration of Algorithm 08, the Patient Consent Management Contract. A physician requests a patient's medical history, the hospital holding the records verifies the request, the smart contract applies three fixed rules, and every action is written to a SHA-256 hash-chained ledger shown live beside the page. Everything runs in the browser; the blockchain and contract deployment are simulated. All data is synthetic.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 (Node.js 20.9+). Use a window at least 1200px wide so the live ledger stays on the right.

## The four screens

| Screen | What it is for |
|---|---|
| **Request Workflow** | The whole process on one page, in six steps: physician signs in and is authorized → requests the patient's history → source hospital receives and verifies → Algorithm 08 runs Rules 1–3 → hospital approves or rejects → records released (or access denied). |
| **Patient Portal** | The patient grants consent (`grant`), revokes it (`revoke`), and sees who requested their records and what was decided. Includes a demo clock for the expired-consent test. |
| **Smart Contract Studio** | The contract (ID, version, SHA-256 hash), the three fixed rules, the actual executed TypeScript of `grant`/`check`/`revoke`, execution history and the simulated deployment receipt. |
| **Transaction Ledger** | Every event with transaction ID, request ID, actor and role, explanation, previous and current hash. Search, filters, hash inspection, Verify Ledger, tampering demonstration, CSV export, Reset Demo Data. |

## Algorithm 08

`src/lib/contract.ts`: `grant()`, `check()` (Rules 1→2→3, stopping at the first failure) and `revoke()`.

- **R1 — Identity and hospital:** signed in, credential verified, hospital registered and active, role permits the action.
- **R2 — Consent and scope:** a consent exists for the requesting hospital or professional, and every requested category is in scope.
- **R3 — Purpose, expiry, revocation:** purpose matches; consent active, not revoked, not expired.

A failed rule denies access. There is no override.

## Sample data

- Patient: Ayesha Khan (PAT-001), with LAB, ECG and MRI records at H2 General Hospital.
- Initial consent: H1 City Hospital may access LAB and ECG for Treatment until 31 December 2026.
- Hospitals: H1 City, H2 General, H3 Medical Centre, H4 Central (registered); H5 External (not registered).
- Users: Ayesha Khan (Patient), Dr. Ahmed Raza (Physician, H1), Dr. Victor Hale (Physician, H5 — unauthorized), Sara Malik (Records Officer, H2), Imran Qureshi (Hospital Administrator), Grace Mensah (Auditor).

## Demonstration scenarios

| Scenario | How | Result |
|---|---|---|
| Successful ECG request | Request Workflow with Dr. Ahmed Raza, ECG | R1–R3 pass, hospital approves, ECG released |
| MRI request | Same, tick MRI | Denied by Rule 2 |
| Unauthorized hospital | Choose Dr. Victor Hale (H5) | Denied by Rule 1 |
| Revoked consent | Patient Portal → Revoke, then request ECG | Denied by Rule 3 |
| Expired consent | Patient Portal → grant with +7 days, demo clock +7 twice, then request ECG | Denied by Rule 3 |
| Ledger tampering | Transaction Ledger → alter an event → Verify Ledger | Verification fails at that event |

Ledger events for one approved request: `REQUEST_CREATED`, `REQUEST_RECEIVED`, `REQUEST_REVIEW_STARTED`, `HOSPITAL_VERIFICATION_COMPLETED`, `CONTRACT_EXECUTION_STARTED`, `RULE_1/2/3_EVALUATED`, `CONTRACT_APPROVED`, `HOSPITAL_APPROVED`, `ACCESS_GRANTED`, `MEDICAL_RECORD_RELEASED`. Signing in adds `AUTHENTICATION_VERIFIED`, `CREDENTIAL_VERIFIED`, `HOSPITAL_VERIFIED`.

## How events are recorded

All changes go through one queue in `src/lib/store.tsx`. `recordLedgerEvent()` assigns the event ID, reuses the request's transaction ID and captures the actor, patient and request. Each event is chained with `currentHash = SHA256(previousHash + canonicalEventPayload)` (Web Crypto API, `src/lib/ledger.ts`) and saved to `localStorage` before the screen updates. Open tabs stay in sync.

A submission document with screenshots of every step and the live ledger is in `docs/MedChain_Submission.pdf` (regenerate with `docs/report-tools`).

The repository also contains extra demo pages from an earlier, broader brief (`/guided`, `/dashboard`, `/requests`, `/pbft`, `/governance`, `/network`, `/merkle`). They are not in the menu and are not needed for this assignment.
