"use client";

import { ArrowLeft, PackageOpen, ThumbsUp, Unlock } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { EmptyState, Explain, PageHeader, RoleGate, useAction } from "@/components/common";
import { FinalDecisionCard, RecordCard, RejectRequest, RequestSummary, RequestTimeline } from "@/components/request-parts";
import { RulesPanel } from "@/components/rules-panel";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const PHASES = ["Hospital verification", "Algorithm 08", "Hospital response", "Release"];

function phaseIndex(status: string) {
  if (["SUBMITTED", "RECEIVED", "UNDER_REVIEW"].includes(status)) return 0;
  if (["CONSENT_CHECKED", "CONTRACT_PENDING", "DENIED"].includes(status)) return 1;
  if (["CONTRACT_APPROVED", "REJECTED"].includes(status)) return 2;
  return 3;
}

export default function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const { state, actions, session } = useApp();
  const { busy, run } = useAction();
  const request = state.requests.find((r) => r.id === id);

  if (!request) {
    return <EmptyState icon={PackageOpen} title={`Request ${id} not found`}><Link className="text-teal-700 underline" href="/requests">Back to requests</Link></EmptyState>;
  }

  const pIdx = phaseIndex(request.status);
  const released = state.records.filter((r) => request.releasedRecordIds.includes(r.id));
  const isOfficer = session.role === "RECORDS_OFFICER" && session.hospitalId === request.sourceHospitalId;
  const canRelease = ["HOSPITAL_APPROVED", "COMMITTED", "CONSENSUS_FAILED"].includes(request.status);

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"><ArrowLeft className="size-4" /> Request Workflow</Link>
      <PageHeader
        title="Smart-contract execution"
        description={<>Algorithm 08 — <b>PatientConsentManagement</b> (SC-CONSENT-001) — evaluates the three fixed rules on live data. Records are released only if all rules pass <b>and</b> the source hospital approves.</>}
        actions={<Link href={`/ledger?q=${request.txRef}`} className={buttonVariants({ variant: "outline" })}>View transaction {request.txRef}</Link>}
      />

      <div className="flex flex-wrap gap-2">
        {PHASES.map((p, i) => (
          <div key={p} className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium", i < pIdx ? "border-emerald-200 bg-emerald-50 text-emerald-700" : i === pIdx ? (["DENIED", "CONSENSUS_FAILED", "REJECTED"].includes(request.status) ? "border-red-300 bg-red-50 text-red-700" : "border-teal-400 bg-teal-50 text-teal-800") : "border-slate-200 bg-white text-slate-400")}>
            <span>{i + 1}</span>{p}
          </div>
        ))}
      </div>

      <FinalDecisionCard request={request} />
      <RequestSummary request={request} />

      {pIdx === 0 && (
        <Explain tone="warn" title="Not ready for execution">
          The source hospital must receive, review and verify the request first.{" "}
          <Link className="font-medium underline" href={`/requests?tab=inbox&id=${request.id}`}>Open it in the source hospital inbox</Link>
        </Explain>
      )}

      {pIdx === 1 && !request.decision && <RoleGate roles={["RECORDS_OFFICER"]} hospitalId={request.sourceHospitalId} purpose="execute the contract" />}

      <Card>
        <CardHeader>
          <CardTitle>Algorithm 08 — three fixed rules</CardTitle>
          <CardDescription>check(patient, grantee, record_type). No user or administrator can change or override these rules. Each evaluation is recorded on the ledger with its inputs.</CardDescription>
        </CardHeader>
        <CardContent><RulesPanel request={request} interactive={pIdx >= 1} /></CardContent>
      </Card>

      {request.status === "CONTRACT_APPROVED" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ThumbsUp className="size-4 text-teal-600" />Hospital response</CardTitle>
            <CardDescription>All three rules passed. {request.sourceHospitalId} now approves or rejects the request. Nothing is released yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <RoleGate roles={["RECORDS_OFFICER"]} hospitalId={request.sourceHospitalId} purpose="respond to the request">
              <div className="flex flex-wrap items-start gap-2">
                <Button disabled={busy} onClick={() => run(() => actions.hospitalApprove(request.id), "Request approved by the source hospital")}>Approve request</Button>
                <RejectRequest request={request} />
              </div>
            </RoleGate>
          </CardContent>
        </Card>
      )}

      {(canRelease || request.status === "RELEASED") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Unlock className="size-4 text-emerald-600" />Medical record release</CardTitle>
            <CardDescription>Contract passed and hospital approved. Only the approved categories are released from {request.sourceHospitalId} to {request.requestingHospitalId}.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canRelease && (
              <RoleGate roles={["RECORDS_OFFICER"]} hospitalId={request.sourceHospitalId} purpose="release the records">
                <div className="flex flex-wrap items-start gap-2">
                  <Button disabled={busy} onClick={() => run(() => actions.releaseRecords(request.id), (r) => `${r.length} permitted record(s) released`)}>Release permitted records</Button>
                  {request.status !== "COMMITTED" && <RejectRequest request={request} />}
                </div>
                {request.status === "CONSENSUS_FAILED" && <div className="mt-2 text-sm text-red-700">The last consensus attempt failed, so nothing was released. Bring validators back online and try again.</div>}
              </RoleGate>
            )}
            {request.status === "RELEASED" && (
              <>
                <Explain tone="tip" title={`Received by ${request.requestingHospitalId}`}>These are the only records the requesting hospital can see for this request.</Explain>
                {released.length === 0 && <div className="text-sm text-slate-500">The source hospital holds no records in the approved categories.</div>}
                <div className="grid gap-3 md:grid-cols-2">{released.map((r) => <RecordCard key={r.id} record={r} released />)}</div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {!["DENIED", "RELEASED", "REJECTED", "COMMITTED", "PBFT_IN_PROGRESS", "CONTRACT_APPROVED", "HOSPITAL_APPROVED", "CONSENSUS_FAILED"].includes(request.status) && pIdx >= 1 && isOfficer && (
        <div className="flex justify-end"><RejectRequest request={request} /></div>
      )}

      <Card>
        <CardHeader><CardTitle>Status timeline</CardTitle></CardHeader>
        <CardContent><RequestTimeline request={request} /></CardContent>
      </Card>
    </div>
  );
}
