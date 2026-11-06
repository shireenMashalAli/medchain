"use client";

import { CheckCircle2, FileText, ShieldX, Unlock, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { KV, RequestStatusBadge, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/form";
import { consentKey, granteeLabel } from "@/lib/contract";
import { CATEGORY_LABEL, PURPOSE_LABEL } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { Consent, DataRequest, MedicalRecord } from "@/lib/types";
import { cn, fmtDate, fmtDateTime, humanize } from "@/lib/utils";

export function RequestSummary({ request }: { request: DataRequest }) {
  const { patient, hospital, user } = useApp();
  const from = hospital(request.requestingHospitalId)!;
  const to = hospital(request.sourceHospitalId)!;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle className="font-mono">{request.id}</CardTitle>
          <div className="text-xs text-slate-500">Transaction ref <span className="font-mono">{request.txRef}</span> · created {fmtDateTime(request.createdAt)}</div>
        </div>
        <RequestStatusBadge status={request.status} />
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <KV label="Patient">{patient(request.patientId)?.name} ({request.patientId})</KV>
        <KV label="Requesting hospital">{from.id} {from.name}</KV>
        <KV label="Source hospital">{to.id} {to.name}</KV>
        <KV label="Requesting physician">{user(request.requesterId)?.name}</KV>
        <KV label="Purpose">{PURPOSE_LABEL[request.purpose]}</KV>
        <KV label="Record categories">
          <span className="flex flex-wrap gap-1">{request.categories.map((c) => <Badge key={c} variant="info">{c}</Badge>)}</span>
        </KV>
        <div className="col-span-2 md:col-span-3"><KV label="Reason">{request.reason}</KV></div>
        {request.blockId && <KV label="Block" mono><Link className="text-teal-700 hover:underline" href={`/ledger?q=${request.blockId}`}>{request.blockId}</Link></KV>}
      </CardContent>
    </Card>
  );
}

export function ReviewChecks({ request }: { request: DataRequest }) {
  if (!request.review) return null;
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Records officer verification · {request.review.eventId}</div>
      <ul className="space-y-1.5">
        {request.review.checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2 text-sm">
            {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />}
            <span><b className="font-medium">{c.label}:</b> <span className="text-slate-600">{c.detail}</span></span>
          </li>
        ))}
      </ul>
      {request.review.checks.some((c) => !c.passed) && <div className="mt-2 text-xs text-slate-500">Flagged items are for the officer&apos;s judgement. The contract still decides independently, and the officer cannot override it.</div>}
    </div>
  );
}

export function FinalDecisionCard({ request }: { request: DataRequest }) {
  const f = request.finalDecision;
  if (!f) return null;
  const ok = f.outcome === "RELEASED";
  return (
    <div className={cn("flex items-start gap-3 rounded-lg border p-4", ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
      {ok ? <Unlock className="mt-0.5 size-5 shrink-0" /> : <ShieldX className="mt-0.5 size-5 shrink-0" />}
      <div>
        <div className="font-semibold">Final decision: {ok ? "records released" : f.outcome === "REJECTED" ? "rejected by the source hospital" : "denied by the smart contract"}</div>
        <div className="mt-0.5 text-sm">{f.reason}</div>
        <div className="mt-1 text-xs opacity-80">{f.by} · {fmtDateTime(f.at)} · <Link className="underline" href={`/ledger?q=${f.eventId}`}>{f.eventId}</Link>{!ok && " · no medical records were released"}</div>
      </div>
    </div>
  );
}

// Hospital response: reject with a reason. Hidden once the request is final.
export function RejectRequest({ request }: { request: DataRequest }) {
  const { actions } = useApp();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (["DENIED", "RELEASED", "REJECTED", "PBFT_IN_PROGRESS"].includes(request.status)) return null;
  if (!open) return <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}>Reject with reason</Button>;
  return (
    <div className="w-full space-y-2 rounded-md border border-red-200 bg-red-50/50 p-3">
      <Textarea aria-label="Rejection reason" placeholder="e.g. Requested records are not relevant to the stated clinical reason." value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button variant="destructive" disabled={busy} onClick={async () => { const r = await run(() => actions.rejectRequest(request.id, reason), "Request rejected. No records released."); if (r !== undefined || reason.trim().length >= 5) setOpen(false); }}>Confirm rejection</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function RequestTimeline({ request }: { request: DataRequest }) {
  return (
    <ol className="relative space-y-3 border-l border-slate-200 pl-5">
      {request.history.map((h, i) => (
        <li key={i} className="relative">
          <span className={cn("absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-white", ["DENIED", "CONSENSUS_FAILED", "REJECTED"].includes(h.status) ? "bg-red-500" : h.status === "RELEASED" || h.status === "COMMITTED" ? "bg-emerald-500" : "bg-teal-500")} />
          <div className="text-sm font-medium text-slate-800">{humanize(h.status)}</div>
          <div className="text-xs text-slate-500">
            {fmtDateTime(h.at)} · {h.by} · <Link href={`/ledger?q=${h.eventId}`} className="font-mono text-teal-700 hover:underline">{h.eventId}</Link>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function RecordCard({ record, released }: { record: MedicalRecord; released?: boolean }) {
  return (
    <div className={cn("rounded-md border p-3", released ? "border-emerald-200 bg-emerald-50/50" : "border-slate-200 bg-white")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 size-4 text-slate-400" />
          <div>
            <div className="text-sm font-medium text-slate-900">{record.title}</div>
            <div className="text-xs text-slate-500">{record.id} · {fmtDate(record.date)} · held by {record.hospitalId}</div>
          </div>
        </div>
        <Badge variant="info">{record.category}</Badge>
      </div>
      <p className="mt-2 text-sm text-slate-600">{record.summary}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        {record.values.map((v) => (
          <div key={v.label} className="flex justify-between gap-2 border-b border-dashed border-slate-200 py-0.5">
            <dt className="text-slate-500">{v.label}</dt>
            <dd className="font-medium text-slate-800">{v.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ConsentStatusBadge({ consent }: { consent: Consent }) {
  const { now } = useApp();
  const expired = new Date(consent.expiry) <= now;
  if (consent.status === "ACTIVE" && expired) return <Badge variant="danger">Expired</Badge>;
  return <Badge variant={consent.status === "ACTIVE" ? "success" : consent.status === "REVOKED" ? "danger" : "neutral"}>{consent.status}</Badge>;
}

export function ConsentSummary({ consent }: { consent: Consent }) {
  const { state } = useApp();
  return (
    <div className="space-y-1.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-semibold">{consent.id}</span>
        <ConsentStatusBadge consent={consent} />
        <span className="text-xs text-slate-500">expires {fmtDateTime(consent.expiry)}</span>
      </div>
      <div className="text-slate-700">
        <b>{granteeLabel(consent.grantee, state.users, state.hospitals)}</b> may access{" "}
        {consent.scope.map((c) => CATEGORY_LABEL[c]).join(", ")} for <b>{PURPOSE_LABEL[consent.purpose]}</b>.
      </div>
      <div className="text-xs text-slate-500">{consent.grantee.kind === "HOSPITAL" ? "Grantee: hospital" : "Grantee: designated professional"} · {consent.eventId} · {consent.txId}</div>
      <div className="font-mono text-[10px] break-all text-slate-400">{consentKey(consent)}</div>
    </div>
  );
}
