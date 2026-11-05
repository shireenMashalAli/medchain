"use client";

import { CheckCircle2, FilePlus2, Rocket, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { CodeViewer } from "@/components/code-viewer";
import { Explain, Hash, KV, PageHeader, ResultBadge, RoleGate, SimulationTag, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Input, Label } from "@/components/ui/form";
import { Tabs } from "@/components/ui/tabs";
import { BASELINE_RULES, CONTRACT_ID, CONTRACT_NAME, IMPLEMENTATION, RULES } from "@/lib/contract-code";
import { sha256 } from "@/lib/crypto";
import { hasPermission } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { ContractVersion } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

function baselineMarks(code: string) {
  const lines = code.split("\n");
  const base = BASELINE_RULES.split("\n");
  const start = lines.indexOf(base[0]);
  const marks: Record<number, "baseline"> = {};
  if (start >= 0) for (let i = 0; i < base.length; i++) if (lines[start + i] === base[i]) marks[start + i] = "baseline";
  return marks;
}

function Receipt({ cv }: { cv: ContractVersion }) {
  if (!cv.receipt) return null;
  const r = cv.receipt;
  return (
    <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold text-emerald-900">Deployment receipt</div>
        <SimulationTag>Simulated deployment</SimulationTag>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <KV label="Contract">{CONTRACT_ID} v{cv.version}</KV>
        <KV label="Deployed by">{r.deployer}</KV>
        <KV label="Transaction" mono>{r.txId}</KV>
        <KV label="Block" mono>{r.blockId}</KV>
        <KV label="Address (simulated)" mono><Hash value={r.address} n={12} /></KV>
        <KV label="Code hash" mono><Hash value={cv.codeHash} n={12} /></KV>
        <KV label="Deployed at">{fmtDateTime(r.deployedAt)}</KV>
        <KV label="Ledger event" mono>{r.eventId}</KV>
      </div>
    </div>
  );
}

export default function ContractStudioPage() {
  const { state, session, actions, activeContract } = useApp();
  const { busy, run } = useAction();
  const [selectedVersion, setSelectedVersion] = useState(activeContract.version);
  const [view, setView] = useState<"code" | "source" | "rules">("code");
  const [source, setSource] = useState<{ text: string; hash: string } | null>(null);
  const loadSource = async () => {
    if (source) return;
    const text = await fetch("/api/contract-source").then((r) => r.text());
    setSource({ text, hash: await sha256(text) });
  };
  const [notes, setNotes] = useState("Maintenance release: clarified event names");
  const [editBaseline, setEditBaseline] = useState(false);
  const cv = state.contracts.find((c) => c.version === selectedVersion) ?? activeContract;
  const isAdmin = hasPermission(session.role, "contract:deploy");
  const versions = [...state.contracts].reverse();
  const calls = (action: string) => state.ledger.filter((e) => e.action === action).length;
  const executions = state.requests.filter((r) => r.rules.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Studio"
        description={<>Algorithm 08 — <b>{CONTRACT_NAME}</b>. Author, validate and deploy versions. The three baseline rules are fixed: validation rejects any version that changes them, and no function exists to override a failed rule.</>}
        actions={<><Badge variant="teal">{CONTRACT_ID}</Badge><Badge variant="success">Active v{activeContract.version}</Badge><SimulationTag>Deployment is simulated</SimulationTag></>}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="space-y-1">
            <div className="text-xs text-slate-500">Contract</div>
            <div className="font-mono text-sm font-semibold">{CONTRACT_ID}</div>
            <div className="text-xs text-slate-600">v{activeContract.version} · hash <Hash value={activeContract.codeHash} n={8} /></div>
          </CardContent>
        </Card>
        {IMPLEMENTATION.map((f, i) => (
          <Card key={f.fn}>
            <CardContent className="space-y-1">
              <div className="font-mono text-xs font-semibold text-slate-900">{f.fn}</div>
              <div className="text-xs text-slate-500">{f.file} → {f.symbol}</div>
              <div className="text-sm">{i === 0 ? calls("CONSENT_GRANTED") : i === 1 ? calls("CONTRACT_APPROVED") + calls("CONTRACT_DENIED") : calls("CONSENT_REVOKED")} <span className="text-xs text-slate-500">recorded executions</span></div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!isAdmin && <RoleGate roles={["GOVERNANCE_ADMIN"]} purpose="create or deploy contract versions" />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>v{cv.version} <span className="ml-2"><ResultBadge result={cv.status} /></span></CardTitle>
              <CardDescription>Created by {cv.createdBy} · {fmtDateTime(cv.createdAt)} · {cv.notes}</CardDescription>
            </div>
            <Tabs value={view} onChange={(v) => { setView(v); if (v === "source") void loadSource(); }} tabs={[{ value: "code", label: "Pseudocode" }, { value: "source", label: "Executed TypeScript" }, { value: "rules", label: "Fixed rules" }]} />
          </CardHeader>
          <CardContent>
            {view === "source" ? (
              source ? (
                <>
                  <CodeViewer code={source.text} maxHeight="40rem" />
                  <div className="mt-2 text-xs text-slate-500">src/lib/contract.ts: the grant(), check(), revoke() and evaluateRule() functions every page calls. SHA-256 of this source: <Hash value={source.hash} n={12} /></div>
                </>
              ) : <div className="text-sm text-slate-500">Loading source…</div>
            ) : view === "code" ? (
              <>
                <CodeViewer code={cv.code} marks={baselineMarks(cv.code)} maxHeight="40rem" />
                <div className="mt-2 text-xs text-slate-500">Shaded lines are the immutable baseline rules. Code hash <Hash value={cv.codeHash} n={12} /></div>
              </>
            ) : (
              <div className="space-y-3">
                {RULES.map((r) => (
                  <div key={r.id} className="rounded-md border border-slate-200 p-3">
                    <div className="text-sm font-semibold">Rule {r.id} — {r.name}</div>
                    <p className="mt-1 text-sm text-slate-600">{r.plain}</p>
                    <pre className="mt-2 overflow-x-auto rounded bg-slate-900 px-3 py-2 font-mono text-xs text-teal-200">{r.condition}</pre>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Actions</CardTitle><CardDescription>Signed in as {session.name}</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="notes">Release notes</Label>
                <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                <Checkbox checked={editBaseline} onChange={(e) => setEditBaseline(e.target.checked)} label="Try to relax Rule 2 (tests the immutability guard)" />
                <Button className="w-full" variant="outline" disabled={busy || !isAdmin} onClick={async () => { const r = await run(() => actions.createContractDraft({ notes, editBaseline }), (c) => `Draft v${c.version} created`); if (r) setSelectedVersion(r.version); }}>
                  <FilePlus2 /> Create Contract
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={busy || !isAdmin || cv.status !== "DRAFT"} onClick={() => run(() => actions.validateContract(cv.version), (ok) => (ok ? `v${cv.version} passed validation` : `v${cv.version} failed validation`))}>
                  <ShieldCheck /> Validate
                </Button>
                <Button disabled={busy || !isAdmin || cv.status !== "VALIDATED"} onClick={() => run(() => actions.deployContract(cv.version), `v${cv.version} deployed (simulated)`)}>
                  <Rocket /> Deploy / Push
                </Button>
              </div>
              <Button className="w-full" variant="secondary" onClick={() => setSelectedVersion(activeContract.version)}>View Active Version</Button>
              {cv.status === "DRAFT" && <div className="text-xs text-slate-500">Select a draft, validate it, then deploy. Policy changes go through Governance.</div>}
            </CardContent>
          </Card>

          {cv.validation && (
            <Card>
              <CardHeader><CardTitle>Validation — v{cv.version}</CardTitle><CardDescription>{fmtDateTime(cv.validation.at)}</CardDescription></CardHeader>
              <CardContent className="space-y-2">
                {cv.validation.checks.map((c) => (
                  <div key={c.label} className="flex items-start gap-2 text-sm">
                    {c.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />}
                    <div><div className="font-medium text-slate-800">{c.label}</div><div className="text-xs text-slate-500">{c.detail}</div></div>
                  </div>
                ))}
                {!cv.validation.passed && <Explain tone="warn">This version cannot be deployed.</Explain>}
              </CardContent>
            </Card>
          )}

          <Receipt cv={cv} />

          <Card>
            <CardHeader><CardTitle>Version history</CardTitle><CardDescription>Previous versions are preserved.</CardDescription></CardHeader>
            <CardContent className="space-y-1.5 p-3">
              {versions.map((v) => (
                <button key={v.version} onClick={() => setSelectedVersion(v.version)} className={cn("flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-slate-50", v.version === cv.version ? "border-teal-400 bg-teal-50/50" : "border-slate-200")}>
                  <div>
                    <div className="font-medium">v{v.version} <span className="text-xs text-slate-500">· {v.source.toLowerCase()}</span></div>
                    <div className="text-xs text-slate-500">{v.createdBy} · {fmtDateTime(v.createdAt)}</div>
                  </div>
                  <ResultBadge result={v.status} />
                </button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Execution history — check(patient, grantee, record_type)</CardTitle>
          <CardDescription>Every contract run, with each rule&apos;s result as recorded on the ledger.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {executions.length === 0 ? (
            <div className="p-5 text-sm text-slate-500">The contract has not been executed yet. Run a request from the Guided Demonstration or the execution screen.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Request</th><th className="px-4 py-2">Transaction</th><th className="px-4 py-2">Executed</th><th className="px-4 py-2">Version</th><th className="px-4 py-2">Grantee</th><th className="px-4 py-2">Records</th><th className="px-4 py-2">Rule 1</th><th className="px-4 py-2">Rule 2</th><th className="px-4 py-2">Rule 3</th><th className="px-4 py-2">Decision</th></tr></thead>
              <tbody>
                {executions.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="px-4 py-2"><Link className="font-mono text-xs text-teal-700 hover:underline" href={`/requests/${r.id}`}>{r.id}</Link></td>
                    <td className="px-4 py-2 font-mono text-xs">{r.txRef}</td>
                    <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-500">{fmtDateTime(r.rules[0].timestamp)}</td>
                    <td className="px-4 py-2 text-xs">v{r.contractVersion}</td>
                    <td className="px-4 py-2 text-xs">{r.requestingHospitalId} · {state.users.find((u) => u.id === r.requesterId)?.name}</td>
                    <td className="px-4 py-2 text-xs">{r.categories.join(", ")}</td>
                    {([1, 2, 3] as const).map((n) => {
                      const ev = r.rules.find((x) => x.ruleId === n);
                      return <td key={n} className="px-4 py-2">{ev ? <ResultBadge result={ev.result} /> : <span className="text-xs text-slate-400">not run</span>}</td>;
                    })}
                    <td className="px-4 py-2">{r.decision ? <ResultBadge result={r.decision} /> : <span className="text-xs text-slate-400">pending</span>}</td>
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
