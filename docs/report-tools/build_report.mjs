// Builds the MedChain submission PDF from the captured screenshots and the real ledger data.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve("out");
const PDF = process.argv[2];
const data = JSON.parse(fs.readFileSync(path.join(OUT, "data.json"), "utf8"));
const step = (key) => data.steps.find((s) => s.key === key);

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const reqs = data.requests;
const reqA = reqs.find((r) => r.status === "RELEASED");
const reqB = reqs.find((r) => r.deniedByRule === 2);
const reqC = reqs.find((r) => r.deniedByRule === 1);
const r3 = reqs.filter((r) => r.deniedByRule === 3 && r.decision === "DENY").sort((a, b) => a.id.localeCompare(b.id));
const reqF = reqs.find((r) => r.status === "DENIED" && r.decision === "APPROVE");
const reqD = r3[0];
const reqE = r3[1];
const contract = data.contract;
const fmt = (iso) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const conv = await browser.newPage();
await conv.setContent("<html><body></body></html>");
const images = {};
for (const s of data.steps) {
  const b64 = fs.readFileSync(path.join(OUT, s.file)).toString("base64");
  images[s.key] = await conv.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * 0.62);
    c.height = Math.round(img.height * 0.62);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  }, b64);
}

let fig = 0;
function figure(key, caption) {
  fig++;
  return `<figure><img src="${images[key]}"/><figcaption><b>Figure ${fig}.</b> ${esc(caption)}</figcaption></figure>`;
}

function eventsTable(events, { caption, full = false } = {}) {
  if (!events.length) return `<p class="muted">No new ledger events in this step (view only).</p>`;
  const rows = events.map((e) => `
    <tr>
      <td class="mono">${esc(e.id)}<br><span class="muted">${esc(e.txId)}${e.requestId ? "<br>" + esc(e.requestId) : ""}</span></td>
      <td><b>${esc(e.action)}</b><div class="expl">${esc(e.explanation)}</div></td>
      <td>${esc(e.actor)}<br><span class="muted">${esc(e.role)}${e.hospital ? ", " + esc(e.hospital) : ""}</span></td>
      <td><span class="res ${/(FAIL|DENY|DENIED|INVALID|REVOKED|NOT|WITHHELD)/.test(e.result) ? "bad" : /(RUNNING|SUBMITTED|UNDER_REVIEW)/.test(e.result) ? "pend" : "ok"}">${esc(e.result)}</span></td>
      <td class="mono small">${full ? esc(e.prev) : esc(e.prev.slice(0, 12)) + "…"}<br>↓<br><b>${full ? esc(e.hash) : esc(e.hash.slice(0, 12)) + "…"}</b></td>
    </tr>`).join("");
  return `${caption ? `<div class="tcap">${esc(caption)}</div>` : ""}
  <table class="ev${full ? " full" : ""}"><thead><tr><th style="width:${full ? 15 : 16}%">Event / Tx / Request</th><th>Event type and explanation (as recorded)</th><th style="width:${full ? 13 : 15}%">Actor (role)</th><th style="width:${full ? 14 : 15}%">Result</th><th style="width:${full ? 30 : 16}%">previousHash → currentHash</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function stepBlock({ n, title, req, does, logic, why, shots, key }) {
  const ev = key ? step(key).events : [];
  return `
  <section class="step">
    <h3>${n ? `Step ${n} — ` : ""}${esc(title)}</h3>
    ${req ? `<p class="req"><b>Assignment requirement:</b> ${req}</p>` : ""}
    ${does ? `<p><b>What the user does:</b> ${does}</p>` : ""}
    ${logic ? `<p><b>What the system checks (logic):</b> ${logic}</p>` : ""}
    ${why ? `<p><b>Why:</b> ${why}</p>` : ""}
    ${shots.map(([k, c]) => figure(k, c)).join("")}
    ${key ? eventsTable(ev, { caption: `Live ledger: events written by this step (${ev.length})` }) : ""}
  </section>`;
}

const txA = data.ledger.filter((e) => e.txId === reqA.txRef);
const users = [
  ["Ayesha Khan", "Patient", "—", "Grants and revokes consent; views requests and decisions"],
  ["Dr. Ahmed Raza", "Physician", "H1 City Hospital", "Authorized requester"],
  ["Dr. Victor Hale", "Physician", "H5 External Hospital (not registered)", "Unauthorized requester for the Rule 1 test"],
  ["Sara Malik", "Hospital Records Officer", "H2 General Hospital", "Receives, verifies, runs the contract, approves or rejects, releases"],
  ["Imran Qureshi", "Hospital Administrator", "H3 Medical Centre", "Creates and deploys contract versions; cannot override rules"],
  ["Grace Mensah", "Auditor", "—", "Verifies the ledger"],
];

const compliance = [
  ["Algorithm 08 implemented as a reusable TypeScript module with grant(), check(), revoke()", "src/lib/contract.ts; used by every page through the central store", "§4, Fig. (Contract Studio)"],
  ["Three fixed rules R1–R3 evaluated individually with inputs, PASS/FAIL and explanation", "evaluateRule(1..3); each result stored and shown with its event ID", "§6 Step 4"],
  ["Any failed rule denies access; no override", "check() stops at the first failure; the UI offers no approve/release action after a denial; the store rejects approval unless status is CONTRACT_APPROVED", "§7, §8"],
  ["Step 1 — authentication, credential, hospital, role", "Sign-in records AUTHENTICATION_VERIFIED, CREDENTIAL_VERIFIED, HOSPITAL_VERIFIED", "§6 Step 1"],
  ["Step 2 — patient history request with request ID and transaction reference", `REQUEST_CREATED; e.g. ${reqA.id} / ${reqA.txRef}`, "§6 Step 2"],
  ["Step 3 — source hospital receives and reviews", "REQUEST_RECEIVED, REQUEST_REVIEW_STARTED", "§6 Step 3"],
  ["Step 4 — hospital verification and response (approve or reject with reason)", "HOSPITAL_VERIFICATION_COMPLETED; HOSPITAL_APPROVED or HOSPITAL_REJECTED", "§6 Steps 3 and 5"],
  ["Step 5 — smart-contract execution", "CONTRACT_EXECUTION_STARTED, RULE_1/2/3_EVALUATED, CONTRACT_APPROVED / CONTRACT_DENIED", "§6 Step 4, §7"],
  ["Step 6 — final decision; records released only if rules pass and hospital approves", "ACCESS_GRANTED + MEDICAL_RECORD_RELEASED, or ACCESS_DENIED; only requested and consented categories released", "§6 Step 6"],
  ["Step 7 — patient notification and access history", "Patient Portal lists every request, hospital, decision and reason", "§9"],
  ["Patient Portal: profile, categories, grant, purpose (Treatment/Research), expiry, active permissions, revoke, history", "Patient Portal screen", "§8, §9"],
  ["Revocation immediately affects later checks", `Revoked consent → ${reqD.id} denied by Rule 3`, "§8.2"],
  ["Lecture line 2: require caller ∈ {p, guardian(p)}", "requirePatientOrGuardian() in grant() and revoke(); caller DID compared with the patient and guardian DIDs", "§4.1"],
  ["Lecture line 3: consents[p][g] keyed by DIDs", "Consent stores patientDid and grantee DID; key shown on screen and in ledger events", "§4.1"],
  ["Lecture line 6: every access path calls check() first", `check() re-run at release; ${reqF.id} blocked after a late revocation`, "§4.4, §8.4"],
  ["Every meaningful activity recorded; Event ID, Transaction ID, Request ID, timestamp, actor and role, hospital, event type, result, explanation, previous and current hash", "recordLedgerEvent() in src/lib/store.tsx", "§5, all event tables"],
  ["currentHash = SHA256(previousHash + payload), chained to the previous event", "Web Crypto API; canonical JSON payload; genesis previousHash = 64 zeros", "§5, Appendix A"],
  ["Live ledger updates, transaction history, event details, hash inspection, verification, tampering demo, CSV export", "Right-side live ledger; Transaction Ledger screen", "§10"],
  ["Tampering detected", `Altered event detected at its exact position`, "§10"],
  ["Smart Contract Studio: algorithm, rules, functions, ID, version, hash, execution history, simulated deployment", `${contract.contractId} v${contract.version}, hash ${contract.codeHash.slice(0, 16)}…`, "§11"],
  ["Roles: Patient, Physician, Records Officer, Hospital Administrator, Auditor", "One demo user per role (table in §3)", "§3"],
  ["Sample data: Ayesha Khan (PAT-001); H1–H5; consent H1, LAB+ECG, not MRI, Treatment, 31 Dec 2026, ACTIVE", "Seed data, shown in the Patient Portal and in SEED_CONSENT_LOADED", "§3"],
  ["Scenarios 1–6 executed by the real algorithm", "Approved ECG; MRI (R2); H5 (R1); revoked (R3); expired (R3); tampering", "§6–§10"],
  ["Next.js, TypeScript, Tailwind, central state, localStorage, Web Crypto SHA-256", "Next.js 16 App Router; React Context store; persisted after each committed action", "§2"],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><title>MedChain — Submission</title>
<style>
@page { size: A4; margin: 16mm 14mm 18mm 14mm; }
* { box-sizing: border-box; }
body { font-family: "Segoe UI", Arial, sans-serif; color: #0f172a; font-size: 10pt; line-height: 1.45; }
h1 { font-size: 26pt; color: #0b1d36; margin: 0 0 6px; }
h2 { font-size: 15pt; color: #0b1d36; border-bottom: 2px solid #0d9488; padding-bottom: 4px; margin: 0 0 10px; page-break-after: avoid; }
h3 { font-size: 12pt; color: #0f766e; margin: 14px 0 6px; page-break-after: avoid; }
h4 { font-size: 10.5pt; margin: 10px 0 4px; }
p { margin: 5px 0; }
.chapter { page-break-before: always; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover .sub { font-size: 13pt; color: #334155; }
.cover .meta { margin-top: 24px; font-size: 10pt; color: #475569; }
.badge { display: inline-block; background: #ccfbf1; color: #115e59; padding: 2px 8px; border-radius: 10px; font-size: 9pt; font-weight: 600; }
.req { background: #eff6ff; border-left: 3px solid #2563eb; padding: 5px 8px; }
.muted { color: #64748b; }
.small { font-size: 7.5pt; }
.mono { font-family: Consolas, "Courier New", monospace; font-size: 8pt; }
figure { margin: 8px 0 10px; page-break-inside: avoid; }
figure img { width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; }
figcaption { font-size: 8.5pt; color: #475569; margin-top: 3px; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 10px; font-size: 8.5pt; }
th { background: #0b1d36; color: white; text-align: left; padding: 4px 5px; font-weight: 600; }
td { border-bottom: 1px solid #e2e8f0; padding: 4px 5px; vertical-align: top; }
tr { page-break-inside: avoid; }
table.ev td { font-size: 8pt; }
table.ev { table-layout: fixed; }
table.ev td { overflow-wrap: anywhere; }
table.ev.full td.mono.small { font-size: 6.6pt; word-break: break-all; }
table.ev td:first-child { word-break: keep-all; overflow-wrap: normal; }
.expl { color: #475569; font-size: 7.5pt; margin-top: 2px; }
.tcap { font-weight: 600; font-size: 9pt; margin-top: 6px; color: #0f766e; }
.res { font-weight: 700; font-size: 6.8pt; padding: 1px 4px; border-radius: 8px; white-space: nowrap; display: inline-block; }
.res.ok { background: #d1fae5; color: #065f46; } .res.bad { background: #fee2e2; color: #991b1b; } .res.pend { background: #fef3c7; color: #92400e; }
pre { background: #0b1d36; color: #e2e8f0; padding: 8px 10px; border-radius: 4px; font-size: 7.6pt; line-height: 1.35; white-space: pre-wrap; page-break-inside: auto; }
.box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin: 8px 0; background: #f8fafc; page-break-inside: avoid; }
.flow { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 8.5pt; margin: 6px 0; }
.flow span { background: #0f766e; color: white; padding: 3px 7px; border-radius: 4px; }
.flow i { color: #64748b; font-style: normal; }
.step { page-break-inside: auto; }
ul { margin: 4px 0 6px 18px; padding: 0; } li { margin: 2px 0; }
</style></head><body>

<section class="cover">
  <span class="badge">Academic submission</span>
  <h1>MedChain</h1>
  <div class="sub"><b>Blockchain-Based Patient Consent Management and Secure Medical History Sharing</b><br>Algorithm 08 — Patient Consent Management Contract</div>
  <div class="meta">
    Implementation: Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Web Crypto API (SHA-256), localStorage persistence.<br>
    Evidence in this document was captured from the running application on ${fmt(data.ledger[0].timestamp)}. Every event ID, transaction ID and hash shown is taken from that run; nothing is typed in by hand.<br><br>
    The blockchain network, smart-contract deployment and credential signatures are simulated in the browser, as allowed for the initial demonstration. The access-decision logic and the SHA-256 hash chain are real and execute as described. All patient data is synthetic.
  </div>
</section>

<section class="chapter">
<h2>Contents</h2>
<ol>
<li>Objective</li><li>Running the application</li><li>Users, roles and sample data</li><li>Algorithm 08 — mapping to the lecture definition, logic and reasoning</li><li>Hash-chained ledger — design and reasoning</li>
<li>Case 1 — successful ECG request (approved), step by step with the live ledger</li><li>Case 2 — MRI request outside consent (denied by Rule 2)</li>
<li>Further denial cases — unauthorized hospital (Rule 1), revoked consent, expired consent (Rule 3), and consent revoked after approval (check() at release)</li><li>Patient Portal — consent and access history</li><li>Ledger integrity — verification, tampering and hash inspection</li>
<li>Smart Contract Studio</li><li>Requirement compliance matrix</li><li>Test results summary</li><li>Appendix A — full hash chain of the approved transaction</li><li>Appendix B — contract code as deployed</li>
</ol>

<h2 style="margin-top:18px">1. Objective</h2>
<p>MedChain demonstrates how a smart contract can control access to a patient's medical history when it is shared between hospitals. A record is released only when <b>all</b> of these hold:</p>
<ul>
<li>the requesting healthcare professional is authenticated, verified and authorized (Rule 1);</li>
<li>the patient has granted consent to that hospital or professional, and the requested records are within the consented scope (Rule 2);</li>
<li>the request's purpose matches the consent, and the consent is active, not expired and not revoked (Rule 3);</li>
<li>and the source hospital approves the request.</li>
</ul>
<p>Every action in the process is written to a SHA-256 hash-chained ledger that is visible live on the right side of the screen.</p>
<div class="flow"><span>Patient grants consent</span><i>→</i><span>Physician authenticates</span><i>→</i><span>History requested</span><i>→</i><span>Source hospital receives and verifies</span><i>→</i><span>Algorithm 08: R1, R2, R3</span><i>→</i><span>Hospital responds</span><i>→</i><span>Access granted / denied</span><i>→</i><span>Records released</span><i>→</i><span>Ledger</span></div>
</section>

<section class="chapter">
<h2>2. Running the application</h2>
<pre>npm install
npm run dev
# open http://localhost:3000 (window at least 1200 px wide so the live ledger stays on the right)</pre>
<p>The application has four screens, matching the assignment:</p>
<table><thead><tr><th style="width:24%">Screen</th><th>Purpose</th></tr></thead><tbody>
<tr><td><b>Request Workflow</b></td><td>The complete process on one page in six numbered steps. Each step states who acts; a "Sign in as …" button appears when the next step needs a different person.</td></tr>
<tr><td><b>Patient Portal</b></td><td>Profile, record categories, grant() and revoke() of consent, active permissions, requests for the patient's records with decisions, consent and access history, demo clock (for the expiry test).</td></tr>
<tr><td><b>Smart Contract Studio</b></td><td>Contract ID, version and SHA-256 hash; the three fixed rules; the pseudocode and the actual TypeScript executed; execution history; simulated deployment receipt.</td></tr>
<tr><td><b>Transaction Ledger</b></td><td>All events with search and filters, transaction history, expandable details with hash inspection, Verify Ledger, tampering demonstration, CSV export, Reset Demo Data.</td></tr>
</tbody></table>
<p><b>Layout.</b> Left: navigation. Centre: the workspace. Right: the <b>live transaction ledger</b>, which shows each event as soon as it has been hashed and saved: event ID, transaction ID, request ID, event type, actor and role, requesting and source hospitals, patient, record categories, purpose, timestamp, status, previous and current hash. The newest event is highlighted, and each event expands to its full details.</p>

<h2 style="margin-top:16px">3. Users, roles and sample data</h2>
<table><thead><tr><th>Demo user</th><th>Role</th><th>Hospital</th><th>Used for</th></tr></thead><tbody>
${users.map((u) => `<tr>${u.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}
</tbody></table>
<p><b>Patient:</b> Ayesha Khan (PAT-001) with synthetic LAB, ECG and MRI records held at H2 General Hospital.</p>
<p><b>Hospitals:</b> H1 City Hospital, H2 General Hospital, H3 Medical Centre, H4 Central Hospital (registered and active); H5 External Hospital (not registered, unauthorized).</p>
<p><b>Initial consent (CON-0001):</b> authorized hospital City Hospital (H1); permitted records LAB and ECG; MRI not permitted; purpose TREATMENT; expiry 31 December 2026; status ACTIVE.</p>
<p><b>Why these users:</b> one user per role named in the assignment, plus one unauthorized physician so that Rule 1 can be shown failing on real data rather than on a hard-coded flag.</p>
</section>

<section class="chapter">
<h2>4. Algorithm 08 — Patient Consent Management Contract</h2>
<p>The algorithm is one TypeScript module, <span class="mono">src/lib/contract.ts</span>, with the three functions of the lecture definition. Every screen calls these functions through the central store; there is no second copy of the decision logic. The functions are pure: the same inputs always give the same decision.</p>
<p><b>Variables (as in the lecture):</b> <span class="mono">p</span> = patient DID; <span class="mono">g</span> = grantee DID (a hospital or a designated professional); <span class="mono">scope</span> = record types allowed; <span class="mono">type</span> = record type requested; <span class="mono">purpose</span> = TREATMENT | RESEARCH; <span class="mono">exp</span> = expiry; <span class="mono">now</span> = block time; <span class="mono">guardian(p)</span> = the patient's legal guardian.</p>

<h3>4.1 Mapping to the lecture's Algorithm 08</h3>
<table><thead><tr><th style="width:4%">#</th><th style="width:27%">Lecture line</th><th style="width:33%">Implementation</th><th>Notes</th></tr></thead><tbody>
<tr><td>1</td><td class="mono">grant(p, g, scope, purpose, exp)</td><td><span class="mono">grant()</span> in contract.ts, called by the Patient Portal</td><td>Same five inputs. Also requires a registered patient DID, a non-empty scope and an expiry in the future within the policy limit (365 days).</td></tr>
<tr><td>2</td><td class="mono">require caller ∈ {p, guardian(p)}</td><td><span class="mono">requirePatientOrGuardian()</span> inside <span class="mono">grant()</span> and <span class="mono">revoke()</span></td><td>The signed-in caller's DID must equal the patient's DID or the patient's guardian DID. Ayesha is an adult, so she has no guardian in the demo data.</td></tr>
<tr><td>3</td><td class="mono">consents[p][g] ← {scope, purpose, exp}</td><td>Consent stored with <span class="mono">patientDid</span> and <span class="mono">grantee.did</span>; the key <span class="mono">consents[p][g]</span> is shown on screen and in the ledger</td><td>A new grant for the same (p, g) replaces the previous entry, so there is one active entry per pair.</td></tr>
<tr><td>4</td><td class="mono">check(p, g, type): type ∈ scope ∧ now &lt; exp</td><td><span class="mono">check()</span> → <span class="mono">evaluateRule(1..3)</span></td><td><span class="mono">type ∈ scope</span> is Rule 2; <span class="mono">now &lt; exp</span> is Rule 3. The assignment's fixed rules add identity checks (Rule 1), and the purpose match and revocation status (Rule 3).</td></tr>
<tr><td>5</td><td class="mono">revoke(p, g): delete consents[p][g]; emit</td><td><span class="mono">revoke()</span>; CONSENT_REVOKED is recorded</td><td>The entry is marked REVOKED instead of being physically deleted. For access the effect is identical (check() can never pass again), but the assignment's Rule 3 must report "revoked", and the audit trail must keep the record.</td></tr>
<tr><td>6</td><td>every access path calls check() first</td><td><span class="mono">check()</span> runs at the contract step, <b>and again at the moment of release</b> (ACCESS_CHECK_AT_RELEASE)</td><td>A consent revoked or expired after approval still blocks the release (demonstrated in §8.4).</td></tr>
<tr><td>—</td><td>now = block time</td><td>Browser clock (plus the demo clock for the expiry test)</td><td>Simulated: there are no real blocks.</td></tr>
<tr><td>—</td><td>Sample input: scope {LAB, ECG}, TREATMENT, exp 2026-12-31; check(…, MRI) → false</td><td>Seed consent CON-0001 has exactly these values</td><td>The MRI request is denied by Rule 2 (§7).</td></tr>
</tbody></table>

<h3>4.2 grant(p, g, scope, purpose, exp)</h3>
<pre>require caller == p  or  caller == guardian(p)           (line 2)
require p has a registered DID, scope is not empty
require now &lt; exp &lt;= now + maxConsentDays
consents[p][g] = {scope, purpose, exp, ACTIVE}            (line 3; previous entry for (p, g) superseded)
emit CONSENT_GRANTED</pre>
<p><b>Reasoning.</b> Only the patient, or someone legally acting for them, can share their data. Keeping one entry per (p, g) means check() never has to choose between conflicting consents, and the expiry limit stops open-ended sharing.</p>

<h3>4.3 check(p, g, type)</h3>
<pre>consent = consents[p][g]      (newest ACTIVE entry for the professional's DID or their hospital's DID; else the latest one)
if not R1(g, processor)                       → DENY (Rule 1)
if not R2(consent, g, type)                   → DENY (Rule 2)   type ∈ scope
if not R3(consent, request.purpose, now)      → DENY (Rule 3)   now &lt; exp, purpose matches, not revoked
→ APPROVE</pre>
<p><b>Why this order.</b> Identity is checked first so that an unauthorized party is stopped before the contract reads the patient's consent at all. Scope (R2) is checked before validity (R3) because a request for records the patient never consented to is best explained as out of scope. Evaluation stops at the first failure, like <span class="mono">require()</span> in a smart contract.</p>
<p><b>Why the latest entry is used when none is active.</b> If a consent was revoked or has expired, Rule 3 can then say exactly that ("consent CON-0001 is REVOKED") instead of "no consent found".</p>

<h3>4.4 revoke(p, g) and line 6 (every access path calls check() first)</h3>
<pre>revoke(p, g):
  require caller == p  or  caller == guardian(p)
  consents[p][g].status = REVOKED                        (line 5; equivalent to delete for access)
  emit CONSENT_REVOKED

releaseRecords(request):                                 (line 6)
  require contract decision == APPROVE and hospital approved
  require check(p, g, type) == APPROVE                   (re-run at the moment of access)
  release only records whose type was requested and is in scope</pre>
<p><b>Reasoning.</b> Consent can change between the contract decision and the moment the records leave the hospital. Re-running check() at release means the patient's latest decision always wins.</p>

<h3>4.5 The three fixed rules</h3>
<table><thead><tr><th style="width:15%">Rule</th><th style="width:30%">Condition</th><th>Checks (actual inputs shown on screen)</th><th style="width:22%">Why it exists</th></tr></thead><tbody>
<tr><td><b>R1</b> Identity and hospital authorization</td><td class="mono">user.authenticated && user.credentialVerified && hospital.status == ACTIVE && role.hasPermission</td><td>Requester signed in; requester credential verified (trusted issuer, unaltered, in date, not revoked); requesting hospital ACTIVE; role Physician has request:create; the processing records officer is signed in, verified, has request:process and works at the source hospital; source hospital ACTIVE.</td><td>Only known, verified professionals at registered hospitals may request or process patient data.</td></tr>
<tr><td><b>R2</b> Patient consent and record scope</td><td class="mono">consent != null && grantee IN consent.grantees && requestedRecordType IN consent.allowedScope</td><td>A consent exists for the requesting hospital or the designated professional; every requested category is in the consented scope.</td><td>The patient decides who sees which records (data minimisation).</td></tr>
<tr><td><b>R3</b> Purpose, expiry and revocation</td><td class="mono">request.purpose == consent.purpose && consent.status == ACTIVE && currentTime &lt; consent.expiry</td><td>Purpose matches; consent ACTIVE (not revoked or superseded); current time before expiry.</td><td>Consent is purpose-bound and time-limited, and the patient can withdraw it at any time.</td></tr>
</tbody></table>

<h3>4.6 No override, and release only after hospital approval</h3>
<ul>
<li>A failed rule records CONTRACT_DENIED and ACCESS_DENIED and ends the request. The screens then show no Approve or Release action, and the store itself refuses approval unless the request's status is CONTRACT_APPROVED. No role, including the Hospital Administrator, has an override function.</li>
<li>The baseline rules are fixed. Contract Studio validation rejects any new version whose rule text differs from the fixed rules.</li>
<li>Release requires both: check() returned APPROVE <b>and</b> the source hospital approved. Only records that are both requested and inside the consent are released.</li>
</ul>
</section>

<section class="chapter">
<h2>5. Hash-chained ledger — design and reasoning</h2>
<p>Every meaningful action is written through one function, <span class="mono">recordLedgerEvent()</span>, inside a single queued commit (<span class="mono">src/lib/store.tsx</span>):</p>
<ol>
<li>The action changes the application state and records its events with the actual actor, role, hospital, patient and request.</li>
<li>Each new event gets an event ID; events of the same request reuse the request's transaction ID.</li>
<li>Each event is hashed in order: <span class="mono"><b>currentHash = SHA256(previousHash + canonicalEventPayload)</b></span>, using the browser's Web Crypto API.</li>
<li>The new state is saved to localStorage. Only then does any screen, including the live ledger, update. If saving fails, the action is rejected and reported.</li>
</ol>
<table><thead><tr><th style="width:28%">Design choice</th><th>Reason</th></tr></thead><tbody>
<tr><td>Genesis previousHash = 64 zeros</td><td>The first event has nothing before it; a fixed starting value makes the chain verifiable from the start.</td></tr>
<tr><td>Canonical payload (JSON with sorted keys, hash fields excluded)</td><td>The same event always produces the same text, and so the same hash, on any machine.</td></tr>
<tr><td>Sequential processing queue</td><td>Two quick actions can never compute their hashes from the same previous hash (no race in the chain).</td></tr>
<tr><td>Hash before display, persist before display</td><td>No event is ever shown as recorded unless it has been hashed and saved.</td></tr>
<tr><td>Shared state across browser tabs</td><td>A write always builds on the newest saved ledger, so one tab cannot overwrite events written by another.</td></tr>
<tr><td>Verification recomputes every hash</td><td>Changing any stored field changes that event's recomputed hash, so verification reports the exact event that was altered.</td></tr>
</tbody></table>
<p><b>Fields of every event:</b> Event ID, Transaction ID, Request ID, timestamp, actor, actor role, hospital, event type, execution result, explanation, contract version, patient and request context (patient, requesting hospital, source hospital, categories, purpose, reason), previousHash, currentHash.</p>
<p><b>Event types used:</b> AUTHENTICATION_VERIFIED, CREDENTIAL_VERIFIED, HOSPITAL_VERIFIED, CONSENT_GRANTED, CONSENT_REVOKED, REQUEST_CREATED, REQUEST_RECEIVED, REQUEST_REVIEW_STARTED, HOSPITAL_VERIFICATION_COMPLETED, CONTRACT_EXECUTION_STARTED, RULE_1_EVALUATED, RULE_2_EVALUATED, RULE_3_EVALUATED, CONTRACT_APPROVED, CONTRACT_DENIED, HOSPITAL_APPROVED, HOSPITAL_REJECTED, ACCESS_GRANTED, ACCESS_DENIED, MEDICAL_RECORD_RELEASED, plus LEDGER_VERIFIED and the genesis events.</p>
${figure("a0_start", "Starting point after Reset Demo Data: three genesis events in the live ledger (right). The first has previousHash 000000…")}
${eventsTable(step("a0_start").events, { caption: "Genesis events" })}
</section>

<section class="chapter">
<h2>6. Case 1 — successful ECG request (approved)</h2>
<p>Dr. Ahmed Raza (City Hospital, H1) requests Ayesha Khan's ECG from General Hospital (H2) for treatment. The consent allows LAB and ECG for H1, so all rules should pass. Request <b>${esc(reqA.id)}</b>, transaction <b>${esc(reqA.txRef)}</b>. Each step below shows the screen at that moment, with the live ledger on the right, and the events that step wrote.</p>
${stepBlock({ n: 1, title: "Physician signs in and is authorized", key: "a1_signin",
  req: "A healthcare professional logs in; the system verifies identity, role, credentials and hospital registration.",
  does: "Selects Dr. Ahmed Raza and clicks <i>Sign in</i>.",
  logic: "The credential is verified (issuer is a trusted consortium hospital, proof hash matches the credential content, not expired, not revoked), the hospital's registry status is checked, and the role's permissions are read.",
  why: "These are the facts Rule 1 will rely on, so they are established and recorded when the user signs in.",
  shots: [["a1_signin", "Step 1 complete: four green checks; three events appear at the top of the live ledger."]] })}
${stepBlock({ n: 2, title: "Request the patient's medical history", key: "a2_request",
  req: "The physician selects a patient, the medical-history categories, the purpose and reason, and submits to the source hospital; a unique request ID and transaction reference are generated.",
  does: "Chooses Ayesha Khan, ECG, Treatment, a reason and source hospital H2, then clicks <i>Submit request</i>. The patient's consent on file is shown next to the form.",
  logic: "Only a signed-in user whose role has request:create can submit. The request is placed in H2's inbox in the same saved change that records REQUEST_CREATED.",
  why: "The transaction ID ties every later event of this request together in the ledger.",
  shots: [["a2_request", `Request ${reqA.id} (transaction ${reqA.txRef}) created. The live ledger shows who requested which patient's ECG, from which hospital and why.`]] })}
${stepBlock({ n: 3, title: "Source hospital receives and verifies the request", key: "a3_verify",
  req: "The source hospital receives the request; an authorized Records Officer reviews it and verifies the patient details, requesting hospital, physician and requested records.",
  does: "Signs in as Sara Malik (Records Officer, H2), then clicks <i>Receive</i>, <i>Start review</i> and <i>Verify</i>.",
  logic: "Verification checks: patient reference (DID registered), requesting hospital status, requesting physician's credential, whether H2 holds the requested records, and whether a usable consent is on file.",
  why: "This is the hospital's own check. It cannot approve anything by itself; the contract still decides.",
  shots: [["a3_verify", "Step 3: receipt, review and verification recorded; verification checklist shown."]] })}
${stepBlock({ n: 4, title: "Smart contract — Algorithm 08 applies the three rules", key: "a4_contract",
  req: "Algorithm 08 executes; all three rules are evaluated individually, each showing its actual inputs, PASS/FAIL result and explanation.",
  does: "Clicks <i>Run Rule 1</i>, <i>Run Rule 2</i> and <i>Run Rule 3</i> (or <i>Run All Rules</i>).",
  logic: `R1: both professionals authenticated and verified, H1 and H2 active, roles permitted → PASS. R2: consent ${esc(reqA.rules[1]?.inputs.find((i) => i.label === "Consent ID")?.value ?? "CON-0001")} grants H1, scope LAB and ECG includes ECG → PASS. R3: purpose Treatment = Treatment, ACTIVE, before 31 Dec 2026 → PASS. Result: CONTRACT_APPROVED.`,
  why: "Each rule is recorded as its own event with its inputs, so the decision can be audited later.",
  shots: [["a4_contract", "Rule 1 with every actual input and its result; the rule events appear in the live ledger."], ["a4b_contract", "Rules 2 and 3 with their inputs; the contract approves (CONTRACT_APPROVED at the top of the live ledger)."]] })}
${stepBlock({ n: 5, title: "Source hospital responds", key: "a5_approve",
  req: "The Records Officer approves or rejects with a reason; the hospital cannot override patient consent or the rules.",
  does: "Clicks <i>Approve request</i>. (A <i>Reject with reason</i> button is also available.)",
  logic: "Approval is accepted only when the request's status is CONTRACT_APPROVED, so a denied request can never be approved.",
  shots: [["a5_approve", "HOSPITAL_APPROVED recorded."]] })}
${stepBlock({ n: 6, title: "Access decision and medical record release", key: "a6_release",
  req: "If the hospital approves and all rules pass, the permitted medical history is released; the final decision and reason are displayed.",
  does: "Clicks <i>Release permitted records</i>.",
  logic: "Released records = records of this patient, held by the source hospital, whose category was requested <b>and</b> is inside the consent. Here only REC-001-ECG is released; LAB (consented but not requested) and MRI (not consented) are not.",
  shots: [["a6_release", "Final decision: records released. Only the ECG record is delivered."], ["a7_event_detail", "Live ledger with the MEDICAL_RECORD_RELEASED event expanded: event, transaction and request IDs, actor and role, requesting and source hospitals, patient, records, purpose, reason, timestamp and both full hashes."]] })}
</section>

<section class="chapter">
<h2>7. Case 2 — MRI request outside consent (denied by Rule 2)</h2>
<p>Same physician and patient, but the request asks for <b>MRI</b>, which the consent does not include. Request <b>${esc(reqB.id)}</b>, transaction <b>${esc(reqB.txRef)}</b>.</p>
${stepBlock({ title: "Request submitted", key: "b2_request", does: "Starts a new request, signs in as Dr. Ahmed Raza again, ticks MRI only, submits.", shots: [["b2_request", "MRI request submitted; REQUEST_CREATED at the top of the live ledger."]] })}
${stepBlock({ title: "Hospital verification and contract execution", key: "b4_denied",
  logic: "R1 passes (same authorized people). R2: requested MRI is not in the allowed scope (LAB, ECG) → FAIL. check() stops; R3 is not evaluated. CONTRACT_DENIED and ACCESS_DENIED are recorded.",
  why: "The patient never consented to MRI sharing, so no hospital decision can release it.",
  shots: [["b4_denied", "Rule 2 FAIL with its inputs: requested MRI, allowed LAB and ECG."]] })}
${stepBlock({ title: "Outcome", shots: [["b5_outcome", "Steps 5 and 6 are 'Not reached'. No Approve or Release action exists. Final decision: denied by the smart contract; no medical records released."]] })}
</section>

<section class="chapter">
<h2>8. Further denial cases</h2>
<h3>8.1 Unauthorized hospital — denied by Rule 1 (${esc(reqC.id)})</h3>
<p>Dr. Victor Hale works at H5 External Hospital, which is not registered. His credential is issued by H5, which is not a trusted consortium issuer.</p>
${figure("c1_signin", "Sign-in: authenticated, but credential verification fails and the hospital is not registered. Submitting is allowed so that the contract makes the decision.")}
${eventsTable(step("c1_signin").events, { caption: "Events written at sign-in" })}
${figure("c4_denied", "Rule 1 FAIL: requester credential not verified and H5 not ACTIVE. Rules 2 and 3 are not evaluated.")}
${eventsTable(step("c4_denied").events.filter((e) => e.requestId), { caption: "Events of this request" })}

<h3>8.2 Revoked consent — denied by Rule 3 (${esc(reqD.id)})</h3>
<p>Ayesha revokes City Hospital's permission in the Patient Portal (<span class="mono">revoke(PAT-001, H1)</span>). Dr. Ahmed Raza then requests the ECG again.</p>
${figure("d0_portal", "Before: City Hospital may access LAB and ECG for Treatment until 31 Dec 2026.")}
${figure("d1_revoked", "After revoke(): no active permissions; CONSENT_REVOKED at the top of the live ledger.")}
${eventsTable(step("d1_revoked").events, { caption: "Revocation event" })}
${figure("d4_denied", "R1 and R2 pass (the revoked consent still names H1 and ECG), R3 fails: consent.status = REVOKED.")}
${eventsTable(step("d4_denied").events.filter((e) => e.requestId && /RULE|CONTRACT|ACCESS/.test(e.action)), { caption: "Contract and access events of this request" })}
<p><b>Reasoning:</b> revocation takes effect on the very next check because check() reads the current consent status at execution time; nothing is cached.</p>

<h3>8.3 Expired consent — denied by Rule 3 (${esc(reqE.id)})</h3>
<p>Ayesha grants a new 7-day consent to City Hospital. The demo clock (used only for contract time) is then moved 14 days ahead to simulate the consent running out. Ledger timestamps stay real.</p>
${figure("e1_clock", "New 7-day consent granted; the demo clock is advanced. Each action is recorded in the live ledger.")}
${eventsTable(step("e1_clock").events.filter((e) => !/AUTHENTICATION|CREDENTIAL/.test(e.action)), { caption: "Consent and clock events" })}
${figure("e4_denied", "R3 FAIL: currentTime is after consent.expiry.")}
${eventsTable(step("e4_denied").events.filter((e) => e.requestId && /RULE|CONTRACT|ACCESS/.test(e.action)), { caption: "Contract and access events of this request" })}
</section>

<section class="chapter">
<h3>8.4 Consent revoked after approval — blocked at release (${esc(reqF.id)})</h3>
<p>This demonstrates line 6 of Algorithm 08 (every access path calls check() first). The contract approves the request and the hospital approves it. Before the records are released, Ayesha revokes City Hospital's permission. When the officer clicks Release, check() is run again.</p>
${figure("r1_approved", "Contract approved and hospital approved. No record has been released yet.")}
${figure("r2_revoked", "Ayesha revokes City Hospital: revoke(p, g). CONSENT_REVOKED appears in the live ledger.")}
${figure("r3_blocked", "Release re-runs check(): Rule 3 fails (consent REVOKED). ACCESS_CHECK_AT_RELEASE FAIL and ACCESS_DENIED are recorded, and nothing is released.")}
${eventsTable(step("r3_blocked").events.filter((e) => e.requestId), { caption: "Events written by the release attempt" })}
</section>

<section class="chapter">
<h2>9. Patient Portal — consent and access history</h2>
<p>The patient can see their profile, record categories and who may currently see each one; grant consent (to hospitals or designated professionals; purpose Treatment or Research; expiry); see active permissions and revoke them; and see every request for their records with the requesting hospital, the decision and the reason.</p>
${figure("g1_patient", "Patient Portal: all requests for Ayesha's records with status, decision and reason.")}
</section>

<section class="chapter">
<h2>10. Ledger integrity — verification, tampering and hash inspection</h2>
<p><b>Verification logic:</b> for every event in order, check that its previousHash equals the stored hash of the event before it, then recompute SHA256(previousHash + canonicalEventPayload) and compare it with the stored currentHash. The first mismatch is reported with its position.</p>
${figure("h1_verify", "Verify Ledger: chain intact; every event recomputed.")}
<p><b>Tampering demonstration:</b> the tool edits one stored event directly, the way an attacker editing storage would, without recomputing any hash and without writing a ledger event.</p>
${figure("h2_tampered", "An ACCESS_DENIED event was changed to GRANTED in storage. Verification fails at exactly that event and shows the stored hash next to the recomputed one.")}
${figure("h3_restored", "After 'Restore original', verification passes again.")}
${figure("h4_hash", "Hash inspection for one event: previousHash, the canonical payload, the stored hash and the hash recomputed live with SHA-256 — they match.")}
<p>The ledger screen also provides search by transaction ID, request ID or patient; filters by event type, actor, hospital, date and outcome; a transaction-history view grouping events by transaction ID; a transaction receipt per event; and CSV export of all events with every field.</p>
</section>

<section class="chapter">
<h2>11. Smart Contract Studio</h2>
<p><b>Contract:</b> ${esc(contract.name)} — ID <b>${esc(contract.contractId)}</b>, version <b>${esc(contract.version)}</b>, SHA-256 code hash <span class="mono">${esc(contract.codeHash)}</span>. Deployment is simulated and produces a receipt (transaction, block, deployer, simulated address).</p>
${figure("f1_contract", "Contract ID, active version and hash; pseudocode with grant(), check(), revoke(); the shaded lines are the fixed rules.")}
${figure("f2_source", "The TypeScript the application actually executes (src/lib/contract.ts), served from the source file, with its SHA-256 hash, so the displayed algorithm matches the executed code.")}
${figure("f3_history", "Execution history of check() for every request: result of each rule and the decision.")}
</section>

<section class="chapter">
<h2>12. Requirement compliance matrix</h2>
<table><thead><tr><th style="width:38%">Requirement</th><th>How it is met</th><th style="width:16%">Evidence</th></tr></thead><tbody>
${compliance.map(([a, b, c]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td><td>${esc(c)}</td></tr>`).join("")}
</tbody></table>

<h2 style="margin-top:16px">13. Test results summary</h2>
<table><thead><tr><th>Scenario</th><th>Request</th><th>Rules</th><th>Outcome</th><th>Records released</th></tr></thead><tbody>
${[["1. Successful ECG request", reqA], ["2. MRI outside consent", reqB], ["3. Unauthorized hospital H5", reqC], ["4. Revoked consent", reqD], ["5. Expired consent", reqE]].map(([n, r]) => `<tr><td>${esc(n)}</td><td class="mono">${esc(r.id)}<br>${esc(r.txRef)}</td><td>${r.rules.map((x) => `R${x.ruleId} ${x.result}`).join(", ")}</td><td>${esc(r.finalDecision?.outcome ?? r.status)}<div class="expl">${esc(r.finalDecision?.reason ?? "")}</div></td><td>${r.releasedRecordIds.length ? esc(r.releasedRecordIds.join(", ")) : "none"}</td></tr>`).join("")}
<tr><td>5b. Consent revoked after approval</td><td class="mono">${esc(reqF.id)}<br>${esc(reqF.txRef)}</td><td>${reqF.rules.map((x) => `R${x.ruleId} ${x.result}`).join(", ")}; at release R3 FAIL</td><td>${esc(reqF.finalDecision?.outcome ?? reqF.status)}<div class="expl">${esc(reqF.finalDecision?.reason ?? "")}</div></td><td>none</td></tr>
<tr><td>6. Ledger tampering</td><td>—</td><td>—</td><td>Verification failed at the altered event; passed again after restore</td><td>—</td></tr>
</tbody></table>
<p>All outcomes above come from the same algorithm, run on the data at the time of each request. No outcome is hard-coded.</p>

<h3>Limitations (simulated parts)</h3>
<ul>
<li>The ledger runs in one browser and is persisted in localStorage; there is no distributed network.</li>
<li>Credential "signatures" are SHA-256 proofs over the credential content, standing in for real digital signatures.</li>
<li>Contract deployment is simulated and produces a receipt but no real on-chain transaction.</li>
</ul>
</section>

<section class="chapter">
<h2>Appendix A — Full hash chain of the approved transaction (${esc(reqA.txRef)})</h2>
<p>Each event's previousHash is the currentHash of the event immediately before it in the whole ledger, so the chain links across transactions as well.</p>
${eventsTable(txA.map((e) => ({ ...e, role: e.actorRole, hospital: e.hospitalId, prev: e.previousHash, hash: e.currentHash })), { full: true })}
</section>

<section class="chapter">
<h2>Appendix B — Contract code as deployed (${esc(contract.contractId)} v${esc(contract.version)})</h2>
<pre>${esc(contract.code)}</pre>
</section>

</body></html>`;

fs.writeFileSync(path.join(OUT, "report.html"), html);
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "load" });
await page.pdf({
  path: PDF,
  format: "A4",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:7px;color:#64748b;width:100%;padding:0 14mm;">MedChain — Patient Consent Management (Algorithm 08)</div>`,
  footerTemplate: `<div style="font-size:7px;color:#64748b;width:100%;padding:0 14mm;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log("pdf written", PDF);
