"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, Compass, FastForward, Play, RotateCcw, ScrollText, SkipForward, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Explain, PageHeader, ResultBadge, SimulationTag, useAction } from "@/components/common";
import { PbftRunView } from "@/components/pbft-panel";
import { ConsentSummary, FinalDecisionCard, RecordCard, RequestSummary, ReviewChecks } from "@/components/request-parts";
import { RulesPanel } from "@/components/rules-panel";
import { CredentialStatus } from "@/components/session-selector";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GLOSSARY, SCENARIOS, STAGES } from "@/lib/guided";
import { useApp } from "@/lib/store";
import type { ScenarioId, ValidatorId } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const LINKS = ["/patient", "/network", "/requests", "/requests?tab=inbox", "/requests?tab=inbox", "", "/pbft", "", "/patient", "/ledger"];

function StageResult({ index }: { index: number }) {
  const { state } = useApp();
  const g = state.guided;
  const sc = SCENARIOS.find((s) => s.id === g.scenario)!;
  const request = state.requests.find((r) => r.id === g.requestId);
  const done = g.completed[index];
  if (!done) return null;
  if (done.skipped) return <Explain tone="warn" title="Skipped">{done.note}</Explain>;

  const events = done.from !== undefined && done.to !== undefined ? state.ledger.slice(done.from, done.to) : [];
  let body: React.ReactNode = null;
  const consents = state.consents.filter((c) => g.consentIds.includes(c.id));
  if (index === 0) body = <div className="space-y-2">{consents.map((c) => <div key={c.id} className="rounded-md border border-slate-200 p-3"><ConsentSummary consent={c} /></div>)}</div>;
  if (index === 1) {
    const u = state.users.find((x) => x.id === sc.request.requesterId)!;
    const v = state.verifications[u.id];
    const h = state.hospitals.find((x) => x.id === u.hospitalId);
    body = (
      <div className="rounded-md border border-slate-200 p-3 text-sm">
        <div className="flex items-center justify-between gap-2"><b>{u.name}</b><CredentialStatus userId={u.id} /></div>
        <ul className="mt-2 space-y-1 text-xs">
          <li className="flex items-start gap-1.5"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />Authenticated with DID {u.did}</li>
          {v?.checks.map((c) => <li key={c.label} className="flex items-start gap-1.5">{c.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />}{c.label}</li>)}
          {h && <li className="flex items-start gap-1.5">{h.status === "ACTIVE" ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-3.5 shrink-0 text-red-600" />}Hospital {h.id} {h.name}: {h.status.replace("_", " ")}</li>}
        </ul>
      </div>
    );
  }
  if (index === 2 && request) body = <RequestSummary request={request} />;
  if (index === 3 && request) body = <ReviewChecks request={request} />;
  if (index === 5 && request) body = <RulesPanel request={request} interactive={false} />;
  if (index === 6 && g.pbftRunId) {
    const run = state.pbftRuns.find((r) => r.id === g.pbftRunId);
    if (run) body = <PbftRunView run={run} interactive={false} />;
  }
  if (index === 7 && request) body = <div className="space-y-3"><FinalDecisionCard request={request} /><div className="grid gap-3 md:grid-cols-2">{state.records.filter((r) => request.releasedRecordIds.includes(r.id)).map((r) => <RecordCard key={r.id} record={r} released />)}</div></div>;
  if (index === 8 && request) body = <FinalDecisionCard request={request} />;

  return (
    <div className="space-y-4">
      <div className={cn("flex items-start gap-2 rounded-md border px-4 py-3 text-sm", done.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
        {done.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
        <span>{done.note}</span>
      </div>
      {body}
      {events.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-medium tracking-wide text-slate-500 uppercase">Ledger entries written by this step ({events.length})</div>
          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="w-full text-xs">
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-1.5 font-mono"><Link className="text-teal-700 hover:underline" href={`/ledger?q=${e.id}`}>{e.id}</Link></td>
                    <td className="px-3 py-1.5"><Badge variant={e.kind === "PBFT" ? "violet" : e.kind === "TRANSACTION" ? "info" : e.kind === "BLOCK" ? "teal" : "neutral"}>{e.kind}</Badge></td>
                    <td className="px-3 py-1.5 font-medium">{e.action}</td>
                    <td className="px-3 py-1.5 text-slate-600">{e.actor}</td>
                    <td className="px-3 py-1.5"><ResultBadge result={e.result} /></td>
                    <td className="px-3 py-1.5 font-mono text-slate-500">{e.currentHash.slice(0, 10)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GuidedDemoPage() {
  const { state, getState, actions } = useApp();
  const { busy, run } = useAction();
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  const g = state.guided;
  const scenario = SCENARIOS.find((s) => s.id === g.scenario)!;
  const stage = STAGES[g.stage];
  const doneCount = Object.keys(g.completed).length;
  const firstOpen = STAGES.findIndex((_, i) => !g.completed[i]);
  const finished = firstOpen === -1;
  const api = { actions, getState };

  const runStage = async (i: number) => {
    const before = getState().guided;
    const missing = STAGES.findIndex((_, j) => j < i && !before.completed[j]);
    if (missing !== -1) throw new Error(`Run stage ${missing + 1} first.`);
    if (before.completed[i]) return;
    const from = getState().ledger.length;
    const res = await STAGES[i].run(api, scenario);
    const to = getState().ledger.length;
    const completed = { ...getState().guided.completed, [i]: { ok: res.ok, note: res.note, from, to } };
    for (const k of res.skip ?? []) completed[k] = { ok: false, skipped: true, note: `Skipped — the request stopped at stage ${i + 1}, so this step cannot run and no record is released.` };
    await actions.setGuided({ ...res.patch, completed });
  };

  const runAll = async () => {
    for (let i = 0; i < STAGES.length; i++) {
      if (!getState().guided.completed[i]) await runStage(i);
    }
    await actions.setGuided({ stage: STAGES.length - 1 });
  };

  const startOver = async (scenarioId: ScenarioId = g.scenario) => {
    for (const v of ["H1", "H2", "H3", "H4"] as ValidatorId[]) if (getState().nodeStatus[v] !== "ONLINE") await actions.setNodeStatus(v, "ONLINE");
    if (getState().tamper) await actions.restoreTamper();
    if (getState().clockOffsetDays) await actions.resetClock();
    await actions.setGuided({ scenario: scenarioId, stage: 0, completed: {}, requestId: null, consentIds: [], pbftRunId: null, ledgerCheck: null });
  };

  const current = g.completed[g.stage];
  const recommended = finished
    ? "Walkthrough complete. Open the ledger to inspect every entry, try the tampering demo, or start another scenario."
    : current
      ? `Press Next to continue to stage ${Math.min(g.stage + 2, STAGES.length)}.`
      : g.stage === firstOpen
        ? `Press Run Step to perform “${stage.title}”.`
        : `Go back to stage ${firstOpen + 1} — stages run in order.`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Guided Demonstration"
        description="Patient grants consent → physician authenticates → history is requested → source hospital receives and verifies → hospital responds → Algorithm 08 evaluates three fixed rules → access approved or denied → records released → every step recorded in the SHA-256 hash-chained ledger. Each step performs the real action in the app; nothing is pre-scripted."
        actions={<SimulationTag>Blockchain operations are simulated in your browser</SimulationTag>}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            disabled={busy}
            onClick={() => s.id !== g.scenario && run(() => startOver(s.id), `Scenario ${s.id} selected`)}
            className={cn("rounded-lg border bg-white p-3 text-left shadow-sm transition-colors hover:border-teal-300", s.id === g.scenario ? "border-teal-500 ring-2 ring-teal-100" : "border-slate-200")}
          >
            <div className="flex items-center gap-2"><Badge variant={s.id === g.scenario ? "teal" : "neutral"}>{s.id}</Badge><span className="text-sm font-semibold text-slate-900">{s.title}</span></div>
            <p className="mt-1.5 text-xs text-slate-600">{s.summary}</p>
            <p className="mt-1.5 text-xs font-medium text-slate-800">Expected: {s.expected}</p>
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 flex justify-between text-xs text-slate-600"><span>Scenario {scenario.id} progress</span><span>{doneCount} / {STAGES.length} stages</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-teal-600 transition-all" style={{ width: `${(doneCount / STAGES.length) * 100}%` }} /></div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardContent className="p-2">
            <ol className="space-y-0.5">
              {STAGES.map((s, i) => {
                const c = g.completed[i];
                return (
                  <li key={i}>
                    <button onClick={() => actions.setGuided({ stage: i })} className={cn("flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm", i === g.stage ? "bg-teal-50 text-teal-900" : "hover:bg-slate-50")}>
                      <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold", c ? (c.skipped ? "bg-slate-200 text-slate-500" : c.ok ? "bg-emerald-600 text-white" : "bg-red-600 text-white") : i === firstOpen ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-500")}>
                        {c ? (c.skipped ? <SkipForward className="size-3" /> : c.ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />) : i + 1}
                      </span>
                      <span className={cn(c?.skipped && "text-slate-400 line-through")}>{s.title}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium tracking-wide text-teal-700 uppercase">Stage {g.stage + 1} of {STAGES.length}</div>
                <CardTitle className="mt-1 text-lg">{stage.title}</CardTitle>
                <div className="mt-0.5 text-sm text-slate-500">Acting: {stage.actor}</div>
              </div>
              {current ? (current.skipped ? <Badge>Skipped</Badge> : current.ok ? <Badge variant="success">Done</Badge> : <Badge variant="danger">Stopped</Badge>) : <Badge variant="pending"><CircleDashed className="size-3" />Not run</Badge>}
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-700">{stage.explain}</p>
              <div className="flex flex-wrap gap-1.5">
                {stage.concepts.map((t) => (
                  <button key={t} onClick={() => setOpenTerm(openTerm === t ? null : t)} className={cn("rounded-full border px-2.5 py-0.5 text-xs", openTerm === t ? "border-blue-400 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600 hover:bg-slate-50")}>
                    What is {t}?
                  </button>
                ))}
              </div>
              {openTerm && stage.concepts.includes(openTerm) && <Explain title={openTerm}>{GLOSSARY[openTerm]}</Explain>}

              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <Button variant="outline" disabled={g.stage === 0} onClick={() => actions.setGuided({ stage: g.stage - 1 })}><ArrowLeft /> Back</Button>
                <Button disabled={busy || !!current || g.stage !== firstOpen} onClick={() => run(() => runStage(g.stage), "Step completed")}><Play /> Run Step</Button>
                <Button variant="outline" disabled={g.stage === STAGES.length - 1} onClick={() => actions.setGuided({ stage: g.stage + 1 })}>Next <ArrowRight /></Button>
                <Button variant="blue" disabled={busy || finished} onClick={() => run(runAll, "All remaining steps completed")}><FastForward /> Run All</Button>
                <Button variant="ghost" disabled={busy} onClick={() => run(() => startOver(), "Walkthrough reset. Ledger history is kept.")}><RotateCcw /> Start Over</Button>
                <Link href={g.requestId ? `/ledger?q=${g.requestId}` : "/ledger"} className={buttonVariants({ variant: "ghost" })}><ScrollText /> View Ledger</Link>
              </div>

              <div className="flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <Compass className="mt-0.5 size-4 shrink-0 text-teal-600" />
                <span><b>Next recommended action:</b> {recommended}{LINKS[g.stage] && !finished && <> Or do it by hand on <Link className="text-teal-700 underline" href={LINKS[g.stage]}>this page</Link>.</>}</span>
              </div>
            </CardContent>
          </Card>

          <StageResult index={g.stage} />

          {finished && (
            <Card>
              <CardHeader><CardTitle>Scenario {scenario.id} outcome</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm text-slate-700">
                <div>Expected: <b>{scenario.expected}</b></div>
                {g.requestId && (() => {
                  const r = state.requests.find((x) => x.id === g.requestId);
                  return r ? <div>Actual: <ResultBadge result={r.status} /> {r.deniedByRule ? `by Rule ${r.deniedByRule}` : ""} · <Link className="text-teal-700 underline" href={`/requests/${r.id}`}>open {r.id}</Link></div> : null;
                })()}
                {g.ledgerCheck && <div>Ledger check: <ResultBadge result={g.ledgerCheck.valid ? "VALID" : "INVALID"} /> ({g.ledgerCheck.checked} events, {fmtDateTime(g.ledgerCheck.at)})</div>}
                {state.tamper && <div className="pt-1 text-slate-600">A ledger entry is currently altered. <Link className="text-teal-700 underline" href="/ledger">Restore it on the ledger page</Link> or press Start Over.</div>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
