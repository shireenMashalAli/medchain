"use client";

import { Bell, Clock, Fingerprint, History, KeyRound, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, Explain, Hash, KV, PageHeader, RequestStatusBadge, ResultBadge, RoleGate, useAction } from "@/components/common";
import { ConsentStatusBadge, ConsentSummary, RecordCard } from "@/components/request-parts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Label, Select } from "@/components/ui/form";
import { granteeLabel } from "@/lib/contract";
import { CATEGORIES, CATEGORY_LABEL, PURPOSE_LABEL, purposesFor } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { Grantee, Purpose, RecordCategory } from "@/lib/types";
import { addDays, fmtDate, fmtDateTime } from "@/lib/utils";

function toDateInput(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function PatientPortalPage() {
  const { state, session, actions, activeContract, now, hospital, user } = useApp();
  const [patientId, setPatientId] = useState(session.patientId ?? "PAT-001");
  const patient = state.patients.find((p) => p.id === patientId)!;
  const { busy, run } = useAction();

  const [hospitals, setHospitals] = useState<string[]>(["H1"]);
  const [professionals, setProfessionals] = useState<string[]>([]);
  const [scope, setScope] = useState<RecordCategory[]>(["LAB", "ECG"]);
  const [purpose, setPurpose] = useState<Purpose>("TREATMENT");
  const [expiry, setExpiry] = useState(toDateInput(addDays(now, 30)));

  const consents = state.consents.filter((c) => c.patientId === patientId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const active = consents.filter((c) => c.status === "ACTIVE");
  const records = state.records.filter((r) => r.patientId === patientId);
  const requests = state.requests.filter((r) => r.patientId === patientId);
  const physicians = state.users.filter((u) => u.role === "PHYSICIAN");
  const purposes = purposesFor(activeContract.policy.emergencyPathway);
  const history = useMemo(
    () =>
      state.ledger
        .filter((e) => e.kind === "AUDIT" && !/^RULE_|AUTHENTICATION_VERIFIED|CREDENTIAL_VERIFIED/.test(e.action) && (e.subject?.patientId === patientId || (!!patient.did && e.actorDid === patient.did)))
        .reverse(),
     
    [state.ledger, patient.did, patientId],
  );

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const isPatientSession = session.role === "PATIENT";
  const grantees: Grantee[] = [...hospitals.map((id) => ({ kind: "HOSPITAL" as const, id })), ...professionals.map((id) => ({ kind: "PROFESSIONAL" as const, id }))];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Patient Portal"
        description="The patient decides who may see which records, for what purpose and until when. Every grant and revocation runs Algorithm 08 and is written to the ledger immediately."
        actions={
          <div className="w-64">
            <Label htmlFor="patient">Patient</Label>
            <Select id="patient" value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              {state.patients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </Select>
          </div>
        }
      />

      {!isPatientSession && <RoleGate roles={["PATIENT"]} purpose="manage consent" />}

      {requests.length > 0 && (
        <Card className="border-blue-200">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2"><Bell className="size-4 text-blue-600" />Requests for your records ({requests.length})</CardTitle>
              <CardDescription>Which hospital asked, what for, and what was decided.</CardDescription>
            </div>
            <Button size="sm" variant="outline" disabled={busy || !isPatientSession} onClick={() => run(() => actions.viewAccessHistory(patientId), "Access history viewed — recorded on the ledger")}>Mark as viewed</Button>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Request</th><th className="px-4 py-2">Requested by</th><th className="px-4 py-2">Records</th><th className="px-4 py-2">Purpose</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Decision and reason</th></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2"><Link className="font-mono text-xs text-teal-700 hover:underline" href={`/requests/${r.id}`}>{r.id}</Link><div className="text-xs text-slate-500">{fmtDateTime(r.createdAt)}</div></td>
                    <td className="px-4 py-2">{r.requestingHospitalId} {hospital(r.requestingHospitalId)?.name}<div className="text-xs text-slate-500">{user(r.requesterId)?.name}</div></td>
                    <td className="px-4 py-2">{r.categories.join(", ")}</td>
                    <td className="px-4 py-2">{PURPOSE_LABEL[r.purpose]}</td>
                    <td className="px-4 py-2"><RequestStatusBadge status={r.status} /></td>
                    <td className="max-w-xs px-4 py-2 text-xs text-slate-600">{r.finalDecision ? <><ResultBadge result={r.finalDecision.outcome} /> <span className="mt-1 block">{r.finalDecision.reason}</span></> : "Pending"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Fingerprint className="size-4 text-teal-600" />Profile and identity</CardTitle>
            <CardDescription>A DID is a self-owned identifier. Consents are signed with it so any hospital can check them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <KV label="Name">{patient.name}</KV>
              <KV label="Patient ID">{patient.id}</KV>
              <KV label="Date of birth">{fmtDate(patient.dob)}</KV>
              <KV label="Sex">{patient.sex === "F" ? "Female" : "Male"}</KV>
            </div>
            {patient.did ? (
              <>
                <Badge variant="success">DID registered</Badge>
                <div className="text-xs"><Hash value={patient.did} n={22} /></div>
                <details className="text-xs">
                  <summary className="cursor-pointer text-teal-700">View DID document</summary>
                  <pre className="mt-2 overflow-auto rounded bg-slate-900 p-2 text-[11px] text-slate-200">{JSON.stringify(patient.didDocument, null, 2)}</pre>
                </details>
              </>
            ) : (
              <>
                <Badge variant="pending">DID not registered</Badge>
                <p className="text-sm text-slate-600">Register a DID before granting consent.</p>
                <Button disabled={busy || !isPatientSession} onClick={() => run(() => actions.registerPatientDid(patientId), "DID registered and recorded on the ledger")}><KeyRound /> Register DID</Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Medical-history categories</CardTitle>
            <CardDescription>What is on file, where it is held, and who may currently see it.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Category</th><th className="px-4 py-2">Records on file</th><th className="px-4 py-2">Currently permitted to</th></tr></thead>
              <tbody>
                {CATEGORIES.map((c) => {
                  const recs = records.filter((r) => r.category === c);
                  const allowed = active.filter((a) => a.scope.includes(c) && new Date(a.expiry) > now);
                  return (
                    <tr key={c} className="border-t border-slate-100">
                      <td className="px-4 py-2 font-medium">{CATEGORY_LABEL[c]}</td>
                      <td className="px-4 py-2 text-slate-600">{recs.length ? recs.map((r) => `${r.hospitalId}`).join(", ") : <span className="text-slate-400">none</span>}</td>
                      <td className="px-4 py-2">{allowed.length ? allowed.map((a) => <Badge key={a.id} variant="teal" className="mr-1">{granteeLabel(a.grantee, state.users, state.hospitals)} · {a.purpose.toLowerCase()}</Badge>) : <span className="text-xs text-slate-400">nobody</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Grant consent — grant(patient, grantee, scope, purpose, expiry)</CardTitle>
            <CardDescription>Policy v{activeContract.version}: consent may last up to {activeContract.policy.maxConsentDays} days. One consent is created per grantee and replaces that grantee&apos;s previous active consent.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <div>
              <Label>Hospitals</Label>
              <div className="space-y-1.5">
                {state.hospitals.map((h) => (
                  <Checkbox key={h.id} checked={hospitals.includes(h.id)} onChange={() => setHospitals(toggle(hospitals, h.id))} label={<span>{h.id} {h.name} {h.status !== "ACTIVE" && <Badge variant="danger">{h.status.replace("_", " ")}</Badge>}</span>} />
                ))}
              </div>
              <Label className="mt-4">Or designated professionals</Label>
              <div className="space-y-1.5">
                {physicians.map((u) => <Checkbox key={u.id} checked={professionals.includes(u.id)} onChange={() => setProfessionals(toggle(professionals, u.id))} label={`${u.name} (${u.hospitalId})`} />)}
              </div>
            </div>
            <div>
              <Label>Permitted record categories</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {CATEGORIES.map((c) => <Checkbox key={c} checked={scope.includes(c)} onChange={() => setScope(toggle(scope, c))} label={CATEGORY_LABEL[c]} />)}
              </div>
              <Label className="mt-4" htmlFor="purpose">Purpose</Label>
              <Select id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value as Purpose)}>
                {purposes.map((p) => <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>)}
              </Select>
              <Label className="mt-4" htmlFor="expiry">Expiry date</Label>
              <Input id="expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              <div className="mt-1.5 flex flex-wrap gap-1">
                {[7, 30, 90].map((d) => <Button key={d} size="sm" variant="ghost" onClick={() => setExpiry(toDateInput(addDays(now, d)))}>+{d} days</Button>)}
                <Button size="sm" variant="ghost" onClick={() => setExpiry("2026-12-31")}>31 Dec 2026</Button>
              </div>
              <Button
                className="mt-4 w-full"
                disabled={busy || !isPatientSession}
                onClick={() => run(() => actions.grantConsent({ patientId, grantees, scope, purpose, expiry: new Date(`${expiry}T23:59:59`).toISOString() }), (cs) => `${cs.map((c) => c.id).join(", ")} granted and recorded`)}
              >
                Grant consent
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Clock className="size-4 text-slate-500" />Demo clock</CardTitle>
            <CardDescription>Moves contract time forward so you can watch a consent expire. Ledger timestamps stay real.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">Contract time: <b>{fmtDateTime(now.toISOString())}</b>{state.clockOffsetDays > 0 && <Badge variant="pending" className="ml-2">+{state.clockOffsetDays} days</Badge>}</div>
            <div className="flex flex-wrap gap-2">
              {[1, 7, 30].map((d) => <Button key={d} size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.advanceClock(d), `Clock advanced ${d} day(s)`)}>+{d} day{d > 1 ? "s" : ""}</Button>)}
              <Button size="sm" variant="ghost" disabled={busy || state.clockOffsetDays === 0} onClick={() => run(() => actions.resetClock(), "Clock reset")}>Reset</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active permissions</CardTitle>
          <CardDescription>The smart contract reads these on every request. Revoking calls revoke(patient, grantee) and takes effect for every later check.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {active.length === 0 ? (
            <div className="p-5"><EmptyState icon={ShieldOff} title="No active permissions">Grant consent above to let a hospital or professional request records.</EmptyState></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Consent</th><th className="px-4 py-2">Grantee</th><th className="px-4 py-2">Records</th><th className="px-4 py-2">Purpose</th><th className="px-4 py-2">Expiry</th><th className="px-4 py-2">Status</th><th className="px-4 py-2" /></tr></thead>
              <tbody>
                {active.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{c.id}</td>
                    <td className="px-4 py-2">{granteeLabel(c.grantee, state.users, state.hospitals)}<div className="text-xs text-slate-500">{c.grantee.kind === "HOSPITAL" ? "Hospital" : "Designated professional"}</div></td>
                    <td className="px-4 py-2">{c.scope.join(", ")}</td>
                    <td className="px-4 py-2">{PURPOSE_LABEL[c.purpose]}</td>
                    <td className="px-4 py-2 text-xs">{fmtDateTime(c.expiry)}</td>
                    <td className="px-4 py-2"><ConsentStatusBadge consent={c} /></td>
                    <td className="px-4 py-2 text-right">
                      <Button size="sm" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50" disabled={busy || !isPatientSession} onClick={() => run(() => actions.revokeConsent(patientId, c.grantee), `Permission for ${granteeLabel(c.grantee, state.users, state.hospitals)} revoked`)}>
                        Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>All consents</CardTitle><CardDescription>Including revoked, superseded and expired ones.</CardDescription></CardHeader>
          <CardContent className="space-y-3">
            {consents.length === 0 && <div className="text-sm text-slate-500">None yet.</div>}
            {consents.map((c) => <div key={c.id} className="rounded-md border border-slate-200 p-3"><ConsentSummary consent={c} /></div>)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Synthetic medical records</CardTitle>
            <CardDescription>Records stay at the hospital that created them. Only approved categories are released.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">{records.map((r) => <RecordCard key={r.id} record={r} />)}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><History className="size-4 text-slate-500" />Consent and access history</CardTitle>
          <CardDescription>Taken straight from the hash-chained ledger.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {history.length === 0 ? (
            <div className="p-5"><Explain>Nothing recorded for this patient yet.</Explain></div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Time</th><th className="px-4 py-2">Event</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Explanation</th><th className="px-4 py-2">Result</th></tr></thead>
              <tbody>
                {history.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-500">{fmtDateTime(e.timestamp)}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.id}</td>
                    <td className="px-4 py-2 text-xs font-medium">{e.action}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">{e.explanation}</td>
                    <td className="px-4 py-2"><ResultBadge result={e.result} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
