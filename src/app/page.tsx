"use client";

import { CheckCircle2, Circle, LogIn, RotateCcw, Send, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useAction } from "@/components/common";
import { ConsentSummary, FinalDecisionCard, RecordCard, RejectRequest, RequestSummary, ReviewChecks } from "@/components/request-parts";
import { RulesPanel } from "@/components/rules-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox, Label, Select, Textarea } from "@/components/ui/form";
import { CATEGORIES, CATEGORY_LABEL, hasPermission, PURPOSE_LABEL, purposesFor, ROLE_LABEL } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { DataRequest, HospitalId, Purpose, RecordCategory, User } from "@/lib/types";
import { cn } from "@/lib/utils";

type StepState = "done" | "active" | "waiting" | "failed" | "skipped";

function Step({ n, title, who, state, children }: { n: number; title: string; who: string; state: StepState; children: React.ReactNode }) {
  return (
    <Card className={cn(state === "active" && "border-teal-400 ring-2 ring-teal-100", state === "waiting" && "opacity-60", state === "failed" && "border-red-300")}>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              state === "done" ? "bg-emerald-600 text-white" : state === "failed" ? "bg-red-600 text-white" : state === "active" ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500",
            )}
          >
            {state === "done" ? <CheckCircle2 className="size-4" /> : state === "failed" ? <XCircle className="size-4" /> : n}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">Step {n} — {title}</h2>
              {state === "done" && <Badge variant="success">Done</Badge>}
              {state === "failed" && <Badge variant="danger">Stopped</Badge>}
              {state === "skipped" && <Badge>Not reached</Badge>}
            </div>
            <div className="text-xs text-slate-500">Who acts: {who}</div>
          </div>
        </div>
        {state !== "waiting" && state !== "skipped" && <div className="pl-11">{children}</div>}
      </CardContent>
    </Card>
  );
}

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
      <span>{children}</span>
    </li>
  );
}

// Shown wherever the current user is not the person who must act in this step.
function ActAs({ user, why }: { user: User; why: string }) {
  const { session, actions } = useApp();
  const { busy, run } = useAction();
  if (session.id === user.id) return <div className="text-sm text-slate-600">Signed in as <b>{user.name}</b> ({ROLE_LABEL[user.role]}{user.hospitalId ? `, ${user.hospitalId}` : ""}).</div>;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span className="flex-1">{why} Right now you are signed in as {session.name}.</span>
      <Button size="sm" disabled={busy} onClick={() => run(() => actions.signIn(user.id), `Signed in as ${user.name}`)}><LogIn /> Sign in as {user.name}</Button>
    </div>
  );
}

const ORDER = ["SUBMITTED", "RECEIVED", "UNDER_REVIEW", "CONSENT_CHECKED", "CONTRACT_PENDING", "CONTRACT_APPROVED", "HOSPITAL_APPROVED", "PBFT_IN_PROGRESS", "CONSENSUS_FAILED", "COMMITTED", "RELEASED"];
const past = (r: DataRequest, s: string) => ORDER.indexOf(r.status) > ORDER.indexOf(s);

export default function RequestWorkflowPage() {
  const { state, session, actions, hospital, activeContract, now } = useApp();
  const { busy, run } = useAction();
  const [requestId, setRequestId] = useState<string | null>(state.requests[0]?.id ?? null);
  const request = state.requests.find((r) => r.id === requestId) ?? null;

  // form
  const [physicianId, setPhysicianId] = useState("u-phy-h1");
  const [patientId, setPatientId] = useState("PAT-001");
  const [source, setSource] = useState<HospitalId>("H2");
  const [categories, setCategories] = useState<RecordCategory[]>(["ECG"]);
  const [purpose, setPurpose] = useState<Purpose>("TREATMENT");
  const [reason, setReason] = useState("Follow-up of recent chest pain; need prior ECG for comparison.");

  const physicians = state.users.filter((u) => u.role === "PHYSICIAN");
  const physician = request ? state.users.find((u) => u.id === request.requesterId)! : state.users.find((u) => u.id === physicianId)!;
  const sourceId = request?.sourceHospitalId ?? source;
  const officer = state.users.find((u) => u.role === "RECORDS_OFFICER" && u.hospitalId === sourceId);
  const officerHospitals = state.hospitals.filter((h) => state.users.some((u) => u.role === "RECORDS_OFFICER" && u.hospitalId === h.id) && h.id !== physician.hospitalId);

  // step 1 facts, all read from the shared state
  const authed = !!state.authentications[physician.id] && session.id === physician.id;
  const v = state.verifications[physician.id];
  const ph = hospital(physician.hospitalId);
  const canRequest = hasPermission(physician.role, "request:create");
  const patientConsents = state.consents.filter((c) => c.patientId === patientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const s1: StepState = request || authed ? "done" : "active";
  const s2: StepState = request ? "done" : authed ? "active" : "waiting";
  const s3: StepState = !request ? "waiting" : request.status === "REJECTED" && !request.review ? "failed" : past(request, "UNDER_REVIEW") || request.review ? "done" : "active";
  const s4: StepState = !request || !request.review ? "waiting" : request.decision === "DENY" ? "failed" : request.decision === "APPROVE" ? "done" : request.status === "REJECTED" ? "skipped" : "active";
  const s5: StepState = !request || request.decision !== "APPROVE" ? (request?.decision === "DENY" ? "skipped" : "waiting") : request.status === "REJECTED" ? "failed" : request.status === "CONTRACT_APPROVED" ? "active" : "done";
  const s6: StepState = !request || !["HOSPITAL_APPROVED", "COMMITTED", "CONSENSUS_FAILED", "RELEASED", "PBFT_IN_PROGRESS"].includes(request.status) ? (request && ["DENIED", "REJECTED"].includes(request.status) ? "skipped" : "waiting") : request.status === "RELEASED" ? "done" : request.status === "CONSENSUS_FAILED" ? "failed" : "active";

  const officerSignedIn = !!officer && session.id === officer.id;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold text-slate-900">Request Workflow</h1>
          <p className="mt-1 text-sm text-slate-600">
            One patient-history request, start to finish. Each step is a real action; watch it appear in the <b>live ledger on the right</b>. Algorithm 08 (the patient consent contract) makes the access decision, and nobody can override a failed rule.
          </p>
        </div>
        {request && (
          <Button variant="outline" onClick={() => setRequestId(null)}><RotateCcw /> Start a new request</Button>
        )}
      </div>

      {/* STEP 1 */}
      <Step n={1} title="Physician signs in and is authorized" who="Requesting physician" state={s1}>
        {!request && (
          <div className="mb-3 max-w-sm">
            <Label htmlFor="wf-phys">Physician</Label>
            <Select id="wf-phys" value={physicianId} onChange={(e) => setPhysicianId(e.target.value)}>
              {physicians.map((u) => <option key={u.id} value={u.id}>{u.name} — {u.hospitalId} {hospital(u.hospitalId)?.name}{hospital(u.hospitalId)?.status !== "ACTIVE" ? " (unregistered)" : ""}</option>)}
            </Select>
          </div>
        )}
        {!authed && !request ? (
          <Button disabled={busy} onClick={() => run(() => actions.signIn(physician.id), (r) => (r.verified && r.hospitalOk ? `${physician.name} signed in and verified` : `${physician.name} signed in, but verification failed`))}>
            <LogIn /> Sign in as {physician.name}
          </Button>
        ) : (
          <ul className="space-y-1">
            <Check ok={!!state.authentications[physician.id]}>Authenticated with DID <span className="font-mono text-xs">{physician.did}</span></Check>
            <Check ok={v?.verified === true}>Professional credential verified {v && !v.verified && <span className="text-red-700">— {v.checks.filter((c) => !c.passed).map((c) => c.label).join("; ")}</span>}</Check>
            <Check ok={ph?.status === "ACTIVE"}>Hospital {ph?.id} {ph?.name} is {ph?.status === "ACTIVE" ? "registered and active" : "NOT registered"}</Check>
            <Check ok={canRequest}>Role {ROLE_LABEL[physician.role]} may request patient history</Check>
          </ul>
        )}
        {authed && !request && (v?.verified !== true || ph?.status !== "ACTIVE") && (
          <p className="mt-2 text-sm text-amber-700">You can still submit, but Rule 1 of the contract will deny the request.</p>
        )}
      </Step>

      {/* STEP 2 */}
      <Step n={2} title="Request the patient's medical history" who={`${physician.name} (${physician.hospitalId})`} state={s2}>
        {request ? (
          <RequestSummary request={request} />
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label htmlFor="wf-patient">Patient</Label>
                <Select id="wf-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                  {state.patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="wf-source">Hospital holding the records</Label>
                <Select id="wf-source" value={source} onChange={(e) => setSource(e.target.value as HospitalId)}>
                  {officerHospitals.map((h) => <option key={h.id} value={h.id}>{h.id} {h.name}</option>)}
                </Select>
              </div>
              <div className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">This patient&apos;s consent on file (the contract reads this)</div>
                {patientConsents.length === 0 ? <div className="text-sm text-slate-500">No consent recorded.</div> : patientConsents.slice(0, 3).map((c) => <div key={c.id} className="border-t border-slate-100 py-2 first:border-0 first:pt-0"><ConsentSummary consent={c} /></div>)}
                <Link href="/patient" className="mt-1 inline-block text-xs text-teal-700 hover:underline">Grant or revoke consent in the Patient Portal</Link>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <Label>Record categories</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATEGORIES.map((c) => <Checkbox key={c} checked={categories.includes(c)} onChange={() => setCategories(categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c])} label={CATEGORY_LABEL[c]} />)}
                </div>
              </div>
              <div>
                <Label htmlFor="wf-purpose">Purpose</Label>
                <Select id="wf-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
                  {purposesFor(activeContract.policy.emergencyPathway).map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="wf-reason">Reason</Label>
                <Textarea id="wf-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
              <Button
                className="w-full"
                disabled={busy || !authed}
                onClick={async () => {
                  const r = await run(() => actions.createRequest({ patientId, sourceHospitalId: source, categories, purpose, reason }), (r) => `${r.id} sent to ${r.sourceHospitalId}`);
                  if (r) setRequestId(r.id);
                }}
              >
                <Send /> Submit request
              </Button>
            </div>
          </div>
        )}
      </Step>

      {/* STEP 3 */}
      <Step n={3} title="Source hospital receives and verifies the request" who={officer ? `${officer.name}, Records Officer at ${sourceId}` : `Records officer at ${sourceId}`} state={s3}>
        {request && officer && (
          <div className="space-y-3">
            <ActAs user={officer} why={`The records officer at ${sourceId} must handle this request.`} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy || !officerSignedIn || request.status !== "SUBMITTED"} onClick={() => run(() => actions.acknowledgeRequest(request.id), "Request received")}>1. Receive</Button>
              <Button size="sm" disabled={busy || !officerSignedIn || request.status !== "RECEIVED"} onClick={() => run(() => actions.startReview(request.id), "Review started")}>2. Start review</Button>
              <Button size="sm" disabled={busy || !officerSignedIn || request.status !== "UNDER_REVIEW"} onClick={() => run(() => actions.completeVerification(request.id), "Verification completed")}>3. Verify professional, patient and data</Button>
              {officerSignedIn && !request.decision && !["REJECTED", "DENIED"].includes(request.status) && <RejectRequest request={request} />}
            </div>
            <ReviewChecks request={request} />
          </div>
        )}
      </Step>

      {/* STEP 4 */}
      <Step n={4} title="Smart contract — Algorithm 08 applies the three fixed rules" who={`PatientConsentManagement (${activeContract.contractId} v${activeContract.version}), run by the records officer`} state={s4}>
        {request && officer && (
          <div className="space-y-3">
            {!request.decision && <ActAs user={officer} why="The contract runs at the source hospital." />}
            <p className="text-sm text-slate-600">
              check({request.patientId}, {physician.name} @ {request.requestingHospitalId}, [{request.categories.join(", ")}]) — contract time {now.toLocaleString()}. Run the rules one by one or all at once.
            </p>
            <RulesPanel request={request} interactive={officerSignedIn} />
          </div>
        )}
      </Step>

      {/* STEP 5 */}
      <Step n={5} title="Source hospital responds" who={officer ? `${officer.name} (${sourceId})` : "Records officer"} state={s5}>
        {request && officer && (
          <div className="space-y-3">
            {request.status === "CONTRACT_APPROVED" ? (
              <>
                <ActAs user={officer} why="Only the source hospital can approve or reject." />
                <p className="text-sm text-slate-600">All three rules passed. The hospital may approve, or reject with a reason. It cannot release anything the contract did not allow.</p>
                <div className="flex flex-wrap items-start gap-2">
                  <Button disabled={busy || !officerSignedIn} onClick={() => run(() => actions.hospitalApprove(request.id), "Approved by the hospital")}>Approve request</Button>
                  {officerSignedIn && <RejectRequest request={request} />}
                </div>
              </>
            ) : request.status === "REJECTED" ? (
              <FinalDecisionCard request={request} />
            ) : (
              <div className="text-sm text-emerald-700">Approved by {sourceId}.</div>
            )}
          </div>
        )}
      </Step>

      {/* STEP 6 */}
      <Step n={6} title="Access decision and record release" who={`${officer?.name ?? "Records officer"}, then the requesting hospital receives the records`} state={s6}>
        {request && officer && (
          <div className="space-y-3">
            {request.status !== "RELEASED" && (
              <>
                <ActAs user={officer} why="The source hospital releases the records." />
                <p className="text-sm text-slate-600">The decision is committed by the hospital validators (3 of 4 must agree, simulated), then only the approved categories are released.</p>
                <Button disabled={busy || !officerSignedIn} onClick={() => run(() => actions.releaseRecords(request.id), (r) => `${r.length} record(s) released`)}>Release permitted records</Button>
              </>
            )}
            <FinalDecisionCard request={request} />
            {request.status === "RELEASED" && (
              <div className="grid gap-3 md:grid-cols-2">
                {state.records.filter((r) => request.releasedRecordIds.includes(r.id)).map((r) => <RecordCard key={r.id} record={r} released />)}
              </div>
            )}
          </div>
        )}
      </Step>

      {/* Outcome for denied / rejected requests */}
      {request && ["DENIED", "REJECTED"].includes(request.status) && (
        <Card className="border-red-200">
          <CardContent className="space-y-3">
            <h2 className="text-base font-semibold text-slate-900">Outcome</h2>
            <FinalDecisionCard request={request} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setRequestId(null)}><RotateCcw /> Start a new request</Button>
              <Link href={`/ledger?q=${request.txRef}`} className="text-sm text-teal-700 hover:underline self-center">See all {state.ledger.filter((e) => e.txId === request.txRef).length} ledger events for {request.txRef}</Link>
            </div>
          </CardContent>
        </Card>
      )}
      {request?.status === "RELEASED" && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Circle className="size-3 fill-emerald-500 text-emerald-500" /> Complete.
          <Link href={`/ledger?q=${request.txRef}`} className="text-teal-700 hover:underline">See all {state.ledger.filter((e) => e.txId === request.txRef).length} ledger events for {request.txRef}</Link>
          <Link href="/patient" className="text-teal-700 hover:underline">See what the patient sees</Link>
        </div>
      )}
    </div>
  );
}
