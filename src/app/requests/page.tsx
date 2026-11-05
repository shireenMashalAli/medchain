"use client";

import { ArrowRight, CheckCircle2, Inbox, Send } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { EmptyState, Explain, PageHeader, RequestStatusBadge, RoleGate, useAction } from "@/components/common";
import { FinalDecisionCard, RejectRequest, RequestSummary, RequestTimeline, ReviewChecks } from "@/components/request-parts";
import { CredentialStatus } from "@/components/session-selector";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Label, Select, Textarea } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { CATEGORIES, CATEGORY_LABEL, PURPOSE_LABEL, purposesFor, ROLE_LABEL } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { DataRequest, HospitalId, Purpose, RecordCategory } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

type Tab = "create" | "inbox" | "all";

function NewRequestForm({ onCreated }: { onCreated: (r: DataRequest) => void }) {
  const { state, actions, session, hospital, activeContract } = useApp();
  const { busy, run } = useAction();
  const [patientId, setPatientId] = useState("PAT-001");
  const [source, setSource] = useState<HospitalId>("H2");
  const [categories, setCategories] = useState<RecordCategory[]>(["ECG"]);
  const [purpose, setPurpose] = useState<Purpose>("TREATMENT");
  const [reason, setReason] = useState("Follow-up of recent chest pain; need prior ECG for comparison.");
  const own = hospital(session.hospitalId);

  if (session.role !== "PHYSICIAN") {
    return (
      <Card>
        <CardHeader><CardTitle>Patient history request</CardTitle><CardDescription>Only an authenticated physician can initiate a request.</CardDescription></CardHeader>
        <CardContent><RoleGate roles={["PHYSICIAN"]} purpose="request a patient's history" /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Patient history request</CardTitle>
        <CardDescription>Submitted by the signed-in physician on behalf of their hospital. It goes to the source hospital&apos;s inbox and is never approved automatically.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 p-3 text-sm">
            <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">Requesting as</div>
            <div className="mt-1 font-medium">{session.name} · {ROLE_LABEL[session.role]}</div>
            <div className="text-slate-600">{own?.id} {own?.name} <Badge variant={own?.status === "ACTIVE" ? "success" : "danger"}>{own?.status.replace("_", " ")}</Badge></div>
            <div className="mt-2"><CredentialStatus userId={session.id} /></div>
            {(own?.status !== "ACTIVE" || !state.verifications[session.id]?.verified) && (
              <div className="mt-2 text-xs text-amber-700">You can submit, but the smart contract will deny this request under Rule 1.</div>
            )}
          </div>
          <div>
            <Label htmlFor="rq-patient">Patient</Label>
            <Select id="rq-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              {state.patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="rq-src">Source hospital (holds the records)</Label>
            <Select id="rq-src" value={source} onChange={(e) => setSource(e.target.value as HospitalId)}>
              {state.hospitals.filter((h) => h.validator && h.id !== session.hospitalId).map((h) => <option key={h.id} value={h.id}>{h.id} {h.name}</option>)}
            </Select>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <Label>Medical-history categories</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {CATEGORIES.map((c) => <Checkbox key={c} checked={categories.includes(c)} onChange={() => setCategories(categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c])} label={CATEGORY_LABEL[c]} />)}
            </div>
          </div>
          <div>
            <Label htmlFor="rq-purpose">Purpose</Label>
            <Select id="rq-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
              {purposesFor(activeContract.policy.emergencyPathway).map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="rq-reason">Reason for access</Label>
            <Textarea id="rq-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button
            className="w-full"
            disabled={busy}
            onClick={async () => {
              const r = await run(() => actions.createRequest({ patientId, sourceHospitalId: source, categories, purpose, reason }), (r) => `${r.id} (transaction ${r.txRef}) sent to ${source}`);
              if (r) onCreated(r);
            }}
          >
            <Send /> Submit request to source hospital
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

const STEPS = [
  { key: "ack", label: "Receive request", button: "Receive" },
  { key: "review", label: "Open and start review", button: "Start review" },
  { key: "verify", label: "Verify professional, patient reference and requested data", button: "Complete verification" },
  { key: "process", label: "Execute Algorithm 08 (smart contract)", button: "Execute contract" },
] as const;
const ORDER = ["SUBMITTED", "RECEIVED", "UNDER_REVIEW", "CONSENT_CHECKED", "CONTRACT_PENDING"];

function RequestDetail({ request }: { request: DataRequest }) {
  const { actions, session } = useApp();
  const { busy, run } = useAction();
  const router = useRouter();
  const pos = ORDER.indexOf(request.status);
  const isOfficer = session.role === "RECORDS_OFFICER" && session.hospitalId === request.sourceHospitalId;
  const doStep = (key: (typeof STEPS)[number]["key"]) => {
    if (key === "ack") return run(() => actions.acknowledgeRequest(request.id), "Receipt acknowledged");
    if (key === "review") return run(() => actions.startReview(request.id), "Review started");
    if (key === "verify") return run(() => actions.completeVerification(request.id), "Hospital verification completed");
    return run(() => actions.startContractExecution(request.id), "Contract execution started").then((r) => { if (r) router.push(`/requests/${request.id}`); });
  };

  return (
    <div className="space-y-4">
      <RequestSummary request={request} />
      <FinalDecisionCard request={request} />
      <RoleGate roles={["RECORDS_OFFICER"]} hospitalId={request.sourceHospitalId} purpose="process this request" />
      <Card>
        <CardHeader><CardTitle>Source hospital verification</CardTitle><CardDescription>The officer verifies the request, then runs Algorithm 08. After the contract decides, the hospital approves or rejects on the execution screen. It can reject at any point, but it can never override patient consent or a failed rule.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {STEPS.map((s, i) => {
            const done = pos > i || (pos === -1 && request.status !== "REJECTED") || (request.status === "REJECTED" && request.history.some((h) => h.status === ORDER[i + 1]));
            const current = pos === i;
            return (
              <div key={s.key} className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2", done ? "border-emerald-200 bg-emerald-50/50" : current ? "border-teal-300" : "border-slate-200 opacity-60")}>
                <div className="flex items-center gap-2 text-sm">
                  {done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <span className="flex size-4 items-center justify-center rounded-full border border-slate-300 text-[10px]">{i + 1}</span>}
                  {s.label}
                </div>
                {current && <Button size="sm" disabled={busy || !isOfficer} onClick={() => doStep(s.key)}>{s.button}</Button>}
              </div>
            );
          })}
          <ReviewChecks request={request} />
          {request.consentCheck && (
            <Explain tone={request.consentCheck.found ? "info" : "warn"} title="Consent pre-check">
              {request.consentCheck.summary} The smart contract makes the binding decision.
            </Explain>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {isOfficer && <RejectRequest request={request} />}
            {!["SUBMITTED", "RECEIVED", "UNDER_REVIEW", "CONSENT_CHECKED", "REJECTED"].includes(request.status) && (
              <Link href={`/requests/${request.id}`} className={cn(buttonVariants({ variant: "blue" }))}>Open smart-contract execution <ArrowRight /></Link>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Status timeline</CardTitle></CardHeader>
        <CardContent><RequestTimeline request={request} /></CardContent>
      </Card>
    </div>
  );
}

function RequestsInner() {
  const { state, session } = useApp();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) ?? (session.role === "RECORDS_OFFICER" ? "inbox" : "create"));
  const [inboxHospital, setInboxHospital] = useState<HospitalId>(session.role === "RECORDS_OFFICER" && session.hospitalId ? session.hospitalId : "H2");
  const [selected, setSelected] = useState<string | null>(params.get("id"));
  const inbox = state.requests.filter((r) => r.sourceHospitalId === inboxHospital);
  const current = state.requests.find((r) => r.id === selected) ?? null;
  const newCount = state.requests.filter((r) => r.status === "SUBMITTED").length;

  return (
    <div className="space-y-6">
      <PageHeader title="Hospital Requests" description="A physician requests a patient's history from the hospital that holds it. That hospital's records officer verifies the request and responds; Algorithm 08 then decides." />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "create", label: "New request (physician)" },
          { value: "inbox", label: <span className="flex items-center gap-1.5">Source hospital inbox {newCount > 0 && <Badge variant="info">{newCount} new</Badge>}</span> },
          { value: "all", label: "Transaction tracking" },
        ]}
      />

      {tab === "create" && <NewRequestForm onCreated={(r) => { setInboxHospital(r.sourceHospitalId); setSelected(r.id); setTab("inbox"); }} />}

      {tab === "inbox" && (
        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <Label htmlFor="inbox-h">Viewing inbox of</Label>
              <Select id="inbox-h" value={inboxHospital} onChange={(e) => { setInboxHospital(e.target.value as HospitalId); setSelected(null); }}>
                {state.hospitals.filter((h) => h.validator).map((h) => <option key={h.id} value={h.id}>{h.id} {h.name}</option>)}
              </Select>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {inbox.length === 0 && <EmptyState icon={Inbox} title="Inbox empty">Requests addressed to {inboxHospital} will appear here.</EmptyState>}
              {inbox.map((r) => (
                <button key={r.id} onClick={() => setSelected(r.id)} className={cn("w-full rounded-md border px-3 py-2 text-left hover:bg-slate-50", selected === r.id ? "border-teal-400 bg-teal-50/50" : "border-slate-200")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">{r.id}</span>
                    <RequestStatusBadge status={r.status} />
                  </div>
                  <div className="mt-1 text-xs text-slate-600">From {r.requestingHospitalId} · {r.categories.join(", ")} · {PURPOSE_LABEL[r.purpose]}</div>
                  <div className="text-[11px] text-slate-400">{fmtDateTime(r.createdAt)}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          {current && current.sourceHospitalId === inboxHospital ? <RequestDetail request={current} /> : <EmptyState icon={Inbox} title="Select a request">Open a request to verify it and respond.</EmptyState>}
        </div>
      )}

      {tab === "all" && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            {state.requests.length === 0 ? (
              <div className="p-5"><EmptyState icon={Inbox} title="No requests yet" /></div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Request</th><th className="px-4 py-2">Transaction</th><th className="px-4 py-2">Patient</th><th className="px-4 py-2">From → To</th><th className="px-4 py-2">Records</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Final decision</th><th className="px-4 py-2" /></tr></thead>
                <tbody>
                  {state.requests.map((r) => (
                    <tr key={r.id} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-mono text-xs">{r.id}</td>
                      <td className="px-4 py-2 font-mono text-xs"><Link className="text-teal-700 hover:underline" href={`/ledger?q=${r.txRef}`}>{r.txRef}</Link></td>
                      <td className="px-4 py-2">{r.patientId}</td>
                      <td className="px-4 py-2">{r.requestingHospitalId} → {r.sourceHospitalId}</td>
                      <td className="px-4 py-2">{r.categories.join(", ")}</td>
                      <td className="px-4 py-2"><RequestStatusBadge status={r.status} />{r.deniedByRule && <span className="ml-1 text-xs text-red-600">Rule {r.deniedByRule}</span>}</td>
                      <td className="max-w-xs truncate px-4 py-2 text-xs text-slate-600" title={r.finalDecision?.reason}>{r.finalDecision?.reason ?? "—"}</td>
                      <td className="px-4 py-2 text-right"><Link href={`/requests/${r.id}`} className="text-xs font-medium text-teal-700 hover:underline">Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function RequestsPage() {
  return (
    <Suspense>
      <RequestsInner />
    </Suspense>
  );
}
