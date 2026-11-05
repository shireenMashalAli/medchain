"use client";

import { FlaskConical, Network } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EmptyState, Explain, PageHeader, ResultBadge, SimulationTag, useAction } from "@/components/common";
import { NetworkDiagram, NodeControls, PbftRunView } from "@/components/pbft-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { F, N, QUORUM, VALIDATORS } from "@/lib/pbft";
import { useApp } from "@/lib/store";
import { cn, fmtDateTime } from "@/lib/utils";

export default function PbftPage() {
  const { state, actions } = useApp();
  const { busy, run } = useAction();
  const [selected, setSelected] = useState<string | null>(null);
  const pending = state.requests.filter((r) => r.status === "HOSPITAL_APPROVED" || r.status === "CONSENSUS_FAILED");
  const current = state.pbftRuns.find((r) => r.id === selected) ?? state.pbftRuns[0];
  const inProgress = state.pbftRuns.some((r) => r.revealed < r.phases.length);

  return (
    <div className="space-y-6">
      <PageHeader
        title="PBFT Network"
        description="Practical Byzantine Fault Tolerance lets the four hospitals agree on the order of approved transactions even if one of them is offline or misbehaving."
        actions={<SimulationTag>PBFT simulation — runs in your browser, not a real network</SimulationTag>}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>How it works, in plain language</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p>One hospital is the <b>primary</b>. It proposes the next transaction (<b>pre-prepare</b>). The others check it and tell everyone they agree (<b>prepare</b>). Once enough agree, they all promise to apply it (<b>commit</b>).</p>
            <p>With n = {N} nodes the network tolerates f = {F} faulty node, because n ≥ 3f + 1. A decision needs <b>2f + 1 = {QUORUM}</b> matching nodes, so any two quorums always overlap in at least one honest node.</p>
            <p>Try setting one node offline: consensus still succeeds with 3. Set two offline and it fails, so nothing is committed and no record is released.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Live topology</CardTitle><CardDescription>Primary for the next view: {VALIDATORS[state.pbftView % N]} (view {state.pbftView}) · next sequence #{state.pbftSequence + 1}</CardDescription></CardHeader>
          <CardContent><NetworkDiagram nodeStatus={state.nodeStatus} primary={VALIDATORS[state.pbftView % N]} messages={[]} client="H2 gateway" /></CardContent>
        </Card>
      </div>

      <NodeControls disabled={inProgress} />
      {inProgress && <Explain tone="warn">A consensus round is in progress. Finish it before changing node availability.</Explain>}

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Transactions awaiting consensus</CardTitle>
            <CardDescription>Requests the smart contract approved. Approval alone does not release data.</CardDescription>
          </div>
          <Button variant="outline" disabled={busy || inProgress} onClick={async () => { const r = await run(() => actions.startPbft(null), "Test transaction submitted"); if (r) setSelected(r.id); }}>
            <FlaskConical /> Run test transaction
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 && <div className="text-sm text-slate-500">None right now. Approve a request on the execution screen, or run a test transaction.</div>}
          {pending.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2">
              <div className="text-sm"><span className="font-mono text-xs font-semibold">{r.id}</span> · {r.requestingHospitalId} → {r.sourceHospitalId} · {r.categories.join(", ")} <ResultBadge result={r.status === "CONSENSUS_FAILED" ? "RETRY" : "APPROVED"} /></div>
              <Button size="sm" variant="blue" disabled={busy || inProgress} onClick={async () => { const x = await run(() => actions.startPbft(r.id), "Submitted to primary"); if (x) setSelected(x.id); }}>Submit to PBFT</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      {current ? (
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <Card>
            <CardHeader><CardTitle>Consensus rounds</CardTitle></CardHeader>
            <CardContent className="max-h-[36rem] space-y-1.5 overflow-auto p-3">
              {state.pbftRuns.map((r) => (
                <button key={r.id} onClick={() => setSelected(r.id)} className={cn("w-full rounded-md border px-3 py-2 text-left text-xs hover:bg-slate-50", r.id === current.id ? "border-teal-400 bg-teal-50/50" : "border-slate-200")}>
                  <div className="flex items-center justify-between"><span className="font-mono font-semibold">{r.id}</span>{r.revealed < r.phases.length ? <ResultBadge result="PENDING" /> : <ResultBadge result={r.outcome} />}</div>
                  <div className="mt-0.5 text-slate-500">seq #{r.sequence} · {r.requestId ?? "test"} · {fmtDateTime(r.startedAt)}</div>
                </button>
              ))}
            </CardContent>
          </Card>
          <div>
            <PbftRunView run={current} />
            {current.requestId && <div className="mt-3 text-sm"><Link className="text-teal-700 hover:underline" href={`/requests/${current.requestId}`}>Open request {current.requestId}</Link></div>}
          </div>
        </div>
      ) : (
        <EmptyState icon={Network} title="No consensus rounds yet">Submit an approved request or a test transaction to watch the protocol run phase by phase.</EmptyState>
      )}
    </div>
  );
}
