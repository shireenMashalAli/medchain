"use client";

import { ChevronRight, Crown, FastForward, StepForward } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Hash, SimulationTag, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/form";
import { F, QUORUM, VALIDATORS } from "@/lib/pbft";
import { useApp } from "@/lib/store";
import type { NodeStatus, PbftMessage, PbftRun, ValidatorId } from "@/lib/types";
import { cn } from "@/lib/utils";

const POS: Record<string, { x: number; y: number }> = {
  CLIENT: { x: 70, y: 150 },
  H1: { x: 240, y: 55 },
  H2: { x: 450, y: 55 },
  H3: { x: 450, y: 245 },
  H4: { x: 240, y: 245 },
};

const STATUS_FILL: Record<NodeStatus, string> = { ONLINE: "#0d9488", OFFLINE: "#94a3b8", FAULTY: "#d97706" };

export function NodeControls({ disabled }: { disabled?: boolean }) {
  const { state, actions, hospital } = useApp();
  const { run } = useAction();
  const online = VALIDATORS.filter((v) => state.nodeStatus[v] === "ONLINE").length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Validator node availability</CardTitle>
        <CardDescription>
          n = 4 nodes tolerates f = {F} fault. Commit needs 2f + 1 = {QUORUM} matching nodes. Currently {online} honest node{online === 1 ? "" : "s"} online.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {VALIDATORS.map((v) => (
          <div key={v} className="rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">{v}</div>
              <span className="size-2.5 rounded-full" style={{ background: STATUS_FILL[state.nodeStatus[v]] }} />
            </div>
            <div className="mb-2 text-xs text-slate-500">{hospital(v)?.name}</div>
            <Select
              aria-label={`${v} status`}
              value={state.nodeStatus[v]}
              disabled={disabled}
              onChange={(e) => run(() => actions.setNodeStatus(v, e.target.value as NodeStatus), `${v} set to ${e.target.value.toLowerCase()}`)}
            >
              <option value="ONLINE">Online (honest)</option>
              <option value="OFFLINE">Offline</option>
              <option value="FAULTY">Faulty (Byzantine)</option>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function lineFor(m: PbftMessage, offset: number) {
  const a = POS[m.from.startsWith("H") && m.from.length === 2 ? m.from : "CLIENT"];
  const b = POS[m.to.startsWith("H") && m.to.length === 2 ? m.to : "CLIENT"];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * offset, ny = (dx / len) * offset;
  const shrink = 30 / len;
  return { x1: a.x + dx * shrink + nx, y1: a.y + dy * shrink + ny, x2: b.x - dx * shrink + nx, y2: b.y - dy * shrink + ny };
}

export function NetworkDiagram({ nodeStatus, primary, messages, client = "Client", committed }: { nodeStatus: Record<ValidatorId, NodeStatus>; primary: ValidatorId | null; messages: PbftMessage[]; client?: string; committed?: ValidatorId[] }) {
  return (
    <svg viewBox="0 0 540 300" className="h-auto w-full" role="img" aria-label="PBFT network diagram">
      <defs>
        {(["ok", "drop", "bad"] as const).map((k) => (
          <marker key={k} id={`arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={k === "ok" ? "#0d9488" : k === "drop" ? "#ef4444" : "#d97706"} />
          </marker>
        ))}
      </defs>
      {/* mesh */}
      {VALIDATORS.flatMap((a, i) => VALIDATORS.slice(i + 1).map((b) => (
        <line key={a + b} x1={POS[a].x} y1={POS[a].y} x2={POS[b].x} y2={POS[b].y} stroke="#e2e8f0" strokeWidth="1.5" />
      )))}
      {messages.map((m, i) => {
        const l = lineFor(m, m.from < m.to ? 4 : -4);
        const k = m.status === "DELIVERED" ? "ok" : m.status === "DROPPED" ? "drop" : "bad";
        return (
          <line key={i} {...l} stroke={k === "ok" ? "#0d9488" : k === "drop" ? "#ef4444" : "#d97706"} strokeWidth="1.75" strokeDasharray={k === "ok" ? undefined : "5 4"} markerEnd={`url(#arrow-${k})`} opacity="0.85">
            <title>{`${m.type} ${m.from} → ${m.to}: ${m.status}`}</title>
          </line>
        );
      })}
      {/* client */}
      <g>
        <rect x={POS.CLIENT.x - 46} y={POS.CLIENT.y - 22} width="92" height="44" rx="8" fill="#eff6ff" stroke="#3b82f6" />
        <text x={POS.CLIENT.x} y={POS.CLIENT.y - 3} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1e3a8a">Client</text>
        <text x={POS.CLIENT.x} y={POS.CLIENT.y + 12} textAnchor="middle" fontSize="10" fill="#1e40af">{client}</text>
      </g>
      {VALIDATORS.map((v) => {
        const p = POS[v];
        const st = nodeStatus[v];
        const isCommitted = committed?.includes(v);
        return (
          <g key={v}>
            <circle cx={p.x} cy={p.y} r="27" fill={STATUS_FILL[st]} stroke={isCommitted ? "#059669" : v === primary ? "#1d4ed8" : "#fff"} strokeWidth={isCommitted || v === primary ? 4 : 2} />
            <text x={p.x} y={p.y + 5} textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff">{v}</text>
            <text x={p.x} y={p.y + (p.y < 150 ? -36 : 45)} textAnchor="middle" fontSize="10" fill="#475569">
              {v === primary ? "PRIMARY · " : ""}{st.toLowerCase()}{isCommitted ? " · committed" : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function PbftRunView({ run, interactive = true }: { run: PbftRun; interactive?: boolean }) {
  const { actions, state } = useApp();
  const { busy, run: exec } = useAction();
  const [selected, setSelected] = useState<number | null>(null);
  const shownIdx = selected !== null && selected < run.revealed ? selected : run.revealed - 1;
  const shown = shownIdx >= 0 ? run.phases[shownIdx] : null;
  const done = run.revealed >= run.phases.length;
  const after = (name: string) => run.phases.findIndex((p) => p.name === name) < run.revealed && run.phases.some((p) => p.name === name);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
          <SimulationTag>PBFT simulation — not a real distributed network</SimulationTag>
          <span className="font-mono text-xs">{run.id}</span>
          <span className="text-slate-400">·</span>
          <span>Sequence #{run.sequence}</span>
          <span className="text-slate-400">·</span>
          <span>View {run.view}</span>
          <span className="text-slate-400">·</span>
          <span>Primary {run.primary ?? "none"}</span>
        </div>
        {interactive && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={done || busy} onClick={() => { setSelected(null); exec(() => actions.advancePbft(run.id)); }}>
              <StepForward /> Next phase
            </Button>
            <Button size="sm" disabled={done || busy} onClick={() => { setSelected(null); exec(() => actions.runPbftToEnd(run.id)); }}>
              <FastForward /> Run all phases
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {run.phases.map((p, i) => (
          <div key={p.name} className="flex items-center gap-1">
            <button
              disabled={i >= run.revealed}
              onClick={() => setSelected(i)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium",
                i === shownIdx ? "border-blue-600 bg-blue-600 text-white" : i < run.revealed ? "border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100" : "border-slate-200 bg-white text-slate-400",
              )}
            >
              {i + 1}. {p.name}
            </button>
            {i < run.phases.length - 1 && <ChevronRight className="size-3 text-slate-300" />}
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card>
          <CardContent>
            <NetworkDiagram
              nodeStatus={run.nodeStatus}
              primary={run.primary}
              messages={shown?.messages ?? []}
              client={`${state.requests.find((r) => r.id === run.requestId)?.sourceHospitalId ?? "H2"} gateway`}
              committed={done ? run.nodes.filter((n) => n.committed).map((n) => n.id) : undefined}
            />
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-teal-600" /> delivered</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-red-500" /> dropped (offline)</span>
              <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-amber-600" /> conflicting digest</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{shown ? shown.title : "Ready to start"}</CardTitle>
            <CardDescription>{shown ? shown.explanation : "Press Next phase to send the client request to the primary node."}</CardDescription>
          </CardHeader>
          <CardContent>
            {shown && (
              <>
                <div className="mb-2 text-sm font-medium text-slate-800">{shown.summary}</div>
                <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1">From</th><th className="px-2 py-1">To</th><th className="px-2 py-1">Digest</th><th className="px-2 py-1">Status</th></tr></thead>
                    <tbody>
                      {shown.messages.map((m, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 py-1">{m.from}</td>
                          <td className="px-2 py-1">{m.to}</td>
                          <td className="px-2 py-1 font-mono">{m.digest}</td>
                          <td className="px-2 py-1"><Badge variant={m.status === "DELIVERED" ? "success" : m.status === "DROPPED" ? "danger" : "pending"}>{m.status}</Badge></td>
                        </tr>
                      ))}
                      {shown.messages.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-center text-slate-400">No messages in this phase</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Individual node responses</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2">Node</th><th className="px-4 py-2">Availability</th><th className="px-4 py-2">Pre-prepare</th>
                <th className="px-4 py-2">Prepares (need {2 * F})</th><th className="px-4 py-2">Commits (need {QUORUM})</th><th className="px-4 py-2">Response</th>
              </tr>
            </thead>
            <tbody>
              {run.nodes.map((n) => (
                <tr key={n.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-medium">{n.id} {n.isPrimary && <Crown className="inline size-3.5 text-blue-600" />}</td>
                  <td className="px-4 py-2"><Badge variant={n.status === "ONLINE" ? "success" : n.status === "OFFLINE" ? "neutral" : "pending"}>{n.status}</Badge></td>
                  <td className="px-4 py-2">{after("PRE-PREPARE") ? (n.receivedPrePrepare ? "received" : "—") : "…"}</td>
                  <td className="px-4 py-2">{after("PREPARE") ? `${n.matchingPrepares}${n.prepared ? " ✓ prepared" : ""}` : "…"}</td>
                  <td className="px-4 py-2">{after("COMMIT") ? `${n.matchingCommits}${n.committed ? " ✓ committed" : ""}` : "…"}</td>
                  <td className="px-4 py-2 text-slate-600">{done ? n.response : "…"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className={cn("grid gap-4 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5", !done ? "border-slate-200 bg-white" : run.outcome === "COMMITTED" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50")}>
        <div className="lg:col-span-2">
          <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Consensus outcome</div>
          <div className={cn("mt-1 text-base font-semibold", !done ? "text-amber-700" : run.outcome === "COMMITTED" ? "text-emerald-700" : "text-red-700")}>
            {!done ? "In progress…" : run.outcome === "COMMITTED" ? `Committed (${run.committedCount}/4 ≥ ${QUORUM})` : `Failed (${run.committedCount}/4 < ${QUORUM})`}
          </div>
          {done && <div className="mt-1 text-xs text-slate-600">{run.outcomeReason}</div>}
        </div>
        <div><div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Transaction</div><div className="mt-1 font-mono text-xs">{run.txId}</div><Hash value={run.digest} n={8} /></div>
        <div><div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Sequence</div><div className="mt-1 text-sm">#{run.sequence}</div></div>
        <div>
          <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Block reference</div>
          <div className="mt-1 text-sm">{run.blockId ? <Link className="font-mono text-teal-700 hover:underline" href={`/ledger?q=${run.blockId}`}>{run.blockId}</Link> : done ? "None — not committed" : "Pending"}</div>
        </div>
      </div>
    </div>
  );
}
