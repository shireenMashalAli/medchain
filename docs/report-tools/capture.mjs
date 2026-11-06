// Drives the running MedChain app like a user and captures each step plus the ledger events it produced.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3100";
const OUT = path.resolve("out");
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  defaultViewport: { width: 1500, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  const style = () => {
    const s = document.createElement("style");
    s.textContent = "nextjs-portal{display:none!important} div.fixed.bottom-16{display:none!important}";
    document.head.appendChild(s);
  };
  if (document.head) style(); else document.addEventListener("DOMContentLoaded", style);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("medchain-state-v1")));
let seen = 0;
const steps = [];

async function capture(key, title, opts = {}) {
  await sleep(500);
  const s = await state();
  const events = s.ledger.slice(seen).map((e) => ({
    id: e.id, txId: e.txId, requestId: e.requestId, action: e.action, result: e.result, actor: e.actor, role: e.actorRole,
    hospital: e.hospitalId, timestamp: e.timestamp, prev: e.previousHash, hash: e.currentHash, explanation: e.explanation, subject: e.subject,
  }));
  seen = s.ledger.length;
  const file = `${key}.png`;
  await page.screenshot({ path: path.join(OUT, file), ...(opts.fullPage ? { fullPage: true } : {}) });
  steps.push({ key, title, file, events, totalEvents: s.ledger.length });
  console.log(`captured ${key}: +${events.length} events (${s.ledger.length} total)`);
}

async function click(text, { exact = false, scope = "main" } = {}) {
  const ok = await page.evaluate((text, exact, scope) => {
    const b = [...document.querySelectorAll(`${scope} button`)].find((b) => (exact ? b.textContent.trim() === text : b.textContent.trim().startsWith(text) || b.textContent.includes(text)) && !b.disabled);
    if (!b) return false;
    b.click();
    return true;
  }, text, exact, scope);
  if (!ok) throw new Error(`button not found: ${text}`);
  await sleep(1100);
}

async function scrollToText(selector, text, offset = 80) {
  await page.evaluate((selector, text, offset) => {
    // last match = innermost element containing the text (ancestors come first in document order)
    const el = [...document.querySelectorAll(selector)].filter((x) => x.textContent.includes(text)).pop();
    if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - offset);
  }, selector, text, offset);
  await sleep(400);
}

async function setSelect(id, value) {
  await page.evaluate((id, value) => {
    const s = document.getElementById(id);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, value);
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }, id, value);
  await sleep(400);
}

async function setCategories(wanted) {
  await page.evaluate((wanted) => {
    for (const l of document.querySelectorAll("main label")) {
      const input = l.querySelector("input[type=checkbox]");
      const name = l.textContent.trim();
      const map = { "Laboratory results": "LAB", ECG: "ECG", "MRI imaging": "MRI" };
      if (!input || !map[name]) continue;
      if (input.checked !== wanted.includes(map[name])) input.click();
    }
  }, wanted);
  await sleep(300);
}

async function nav(href) {
  await page.evaluate((href) => document.querySelector(`nav a[href="${href}"]`).click(), href);
  await sleep(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function hospitalSteps() {
  await click("Sign in as Sara Malik");
  await click("1. Receive");
  await click("2. Start review");
  await click("3. Verify");
}

// ---------- fresh start ----------
await page.goto(BASE + "/", { waitUntil: "networkidle2" });
await page.evaluate(() => localStorage.clear());
await page.goto(BASE + "/", { waitUntil: "networkidle2" });
await page.waitForFunction(() => document.body.innerText.includes("Step 1"));
await sleep(800);
seen = 0;
await capture("a0_start", "Starting point: fresh demo data");

// ---------- CASE A: approved ECG request ----------
await click("Sign in as Dr. Ahmed Raza");
await capture("a1_signin", "Step 1: physician signs in and is authorized");

await setCategories(["ECG"]);
await click("Submit request");
await scrollToText("main h2", "Step 2");
await capture("a2_request", "Step 2: request for the patient's ECG history");

await hospitalSteps();
await scrollToText("main h2", "Step 3");
await capture("a3_verify", "Step 3: source hospital receives and verifies");

await click("Run Rule 1", { exact: true });
await click("Run Rule 2", { exact: true });
await click("Run Rule 3", { exact: true });
await scrollToText("main h2", "Step 4");
await capture("a4_contract", "Step 4: Algorithm 08 evaluates Rule 1 (inputs and result)");
await scrollToText("main div", "Rule 2 — Patient consent and record scope", 120);
await capture("a4b_contract", "Step 4: Rules 2 and 3 pass and the contract approves");

await click("Approve request", { exact: true });
await scrollToText("main h2", "Step 5");
await capture("a5_approve", "Step 5: source hospital approves");

await click("Release permitted records", { exact: true });
await scrollToText("main h2", "Step 6");
await capture("a6_release", "Step 6: access granted and only the ECG released");

await page.evaluate(() => document.querySelector("[data-testid=live-ledger] > li button").click());
await sleep(600);
await capture("a7_event_detail", "Live ledger: one event expanded (who, which patient, from where, why, hashes)");
await page.evaluate(() => document.querySelector("[data-testid=live-ledger] > li button").click());

// ---------- CASE B: MRI outside consent (Rule 2) ----------
await page.evaluate(() => window.scrollTo(0, 0));
await click("Start a new request");
await click("Sign in as Dr. Ahmed Raza");
await setCategories(["MRI"]);
await click("Submit request");
await scrollToText("main h2", "Step 2");
await capture("b2_request", "MRI request submitted");
await hospitalSteps();
await click("Run Rule 1", { exact: true });
await click("Run Rule 2", { exact: true });
await scrollToText("main div", "Rule 2 — Patient consent and record scope", 120);
await capture("b4_denied", "Rule 2 fails: MRI is outside the consent scope");
await scrollToText("main h2", "Step 5");
await capture("b5_outcome", "Steps 5 and 6 not reached: access denied, nothing released");

// ---------- CASE C: unauthorized hospital H5 (Rule 1) ----------
await page.evaluate(() => window.scrollTo(0, 0));
await click("Start a new request");
await setSelect("wf-phys", "u-phy-h5");
await click("Sign in as Dr. Victor Hale");
await setCategories(["ECG"]);
await capture("c1_signin", "Dr. Victor Hale (H5) signs in: credential and hospital checks fail");
await click("Submit request");
await hospitalSteps();
await click("Run All Rules");
await scrollToText("main h2", "Step 4");
await capture("c4_denied", "Rule 1 fails: unregistered hospital and unverified credential");

// ---------- CASE D: revoked consent (Rule 3) ----------
await nav("/patient");
await click("Sign in as Ayesha Khan");
await scrollToText("main h3", "Active permissions", 90);
await capture("d0_portal", "Patient Portal before revocation: City Hospital may access LAB and ECG");
await click("Revoke", { exact: true });
await scrollToText("main h3", "Active permissions", 90);
await capture("d1_revoked", "Patient revokes City Hospital: revoke(PAT-001, H1)");
await nav("/");
await click("Start a new request");
await setSelect("wf-phys", "u-phy-h1");
await click("Sign in as Dr. Ahmed Raza");
await setCategories(["ECG"]);
await click("Submit request");
await hospitalSteps();
await click("Run All Rules");
await scrollToText("main div", "Rule 3 — Purpose, expiry and revocation", 120);
await capture("d4_denied", "Rule 3 fails: consent CON-0001 is revoked");

// ---------- CASE E: expired consent (Rule 3) ----------
await nav("/patient");
await click("Sign in as Ayesha Khan");
await page.evaluate(() => {
  const card = [...document.querySelectorAll("main h3")].find((h) => h.textContent.startsWith("Grant consent")).closest("div.rounded-lg");
  [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "+7 days").click();
});
await sleep(400);
await click("Grant consent", { exact: true });
await page.evaluate(() => {
  const card = [...document.querySelectorAll("main h3")].find((h) => h.textContent.includes("Demo clock")).closest("div.rounded-lg");
  const b = [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "+7 days");
  b.click();
});
await sleep(1100);
await page.evaluate(() => {
  const card = [...document.querySelectorAll("main h3")].find((h) => h.textContent.includes("Demo clock")).closest("div.rounded-lg");
  [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "+7 days").click();
});
await sleep(1100);
await scrollToText("main h3", "Grant consent", 90);
await capture("e1_clock", "New 7-day consent granted, then the demo clock moves 14 days ahead");
await nav("/");
await click("Start a new request");
await click("Sign in as Dr. Ahmed Raza");
await setCategories(["ECG"]);
await click("Submit request");
await hospitalSteps();
await click("Run All Rules");
await scrollToText("main div", "Rule 3 — Purpose, expiry and revocation", 120);
await capture("e4_denied", "Rule 3 fails: consent has expired");

// reset the demo clock so later screens show real time
await nav("/patient");
await page.evaluate(() => {
  const card = [...document.querySelectorAll("main h3")].find((h) => h.textContent.includes("Demo clock")).closest("div.rounded-lg");
  [...card.querySelectorAll("button")].find((b) => b.textContent.trim() === "Reset").click();
});
await sleep(1100);

// ---------- Patient notification ----------
await page.evaluate(() => window.scrollTo(0, 0));
await capture("g1_patient", "Patient Portal: every request for Ayesha's records with the decision and reason");

// ---------- Contract Studio ----------
await nav("/contracts");
await capture("f1_contract", "Smart Contract Studio: contract ID, version, hash and Algorithm 08 pseudocode");
await click("Executed TypeScript", { exact: true });
await sleep(1500);
await capture("f2_source", "Smart Contract Studio: the TypeScript the app actually executes");
await scrollToText("main h3", "Execution history", 90);
await capture("f3_history", "Smart Contract Studio: execution history of check()");

// ---------- Ledger integrity ----------
await nav("/ledger");
await click("Verify Ledger");
await capture("h1_verify", "Ledger verification: chain intact");
const target = await page.evaluate(() => JSON.parse(localStorage.getItem("medchain-state-v1")).ledger.find((e) => e.action === "ACCESS_DENIED").id);
await setSelect_aria("Event to tamper", target);
async function setSelect_aria(label, value) {
  await page.evaluate((label, value) => {
    const s = document.querySelector(`select[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(s, value);
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }, label, value);
  await sleep(400);
}
await click("Alter stored event");
await click("Verify Ledger");
await page.evaluate(() => window.scrollTo(0, 0));
await capture("h2_tampered", `Tampering: ${target} changed in storage; verification fails at that event`);
await click("Restore original");
await click("Verify Ledger");
await capture("h3_restored", "Original value restored: chain intact again");

// expanded event with hash inspector
await page.evaluate(() => {
  const row = [...document.querySelectorAll("main table tbody tr")].find((r) => r.textContent.includes("MEDICAL_RECORD_RELEASED"));
  row.click();
});
await sleep(600);
await page.evaluate(() => [...document.querySelectorAll("main button")].find((b) => b.textContent.includes("Recompute SHA-256")).click());
await sleep(800);
await scrollToText("main div", "Hash inspection", 160);
await capture("h4_hash", "Hash inspection: SHA256(previousHash + canonicalEventPayload) recomputed and matched");

const final = await state();
fs.writeFileSync(path.join(OUT, "data.json"), JSON.stringify({ steps, ledger: final.ledger, requests: final.requests, consents: final.consents, contract: final.contracts.find((c) => c.version === final.activeContractVersion) }, null, 2));
await browser.close();
console.log("done");
