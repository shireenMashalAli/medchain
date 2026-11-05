"use client";

import { Activity, Blocks, CheckCircle2, ClipboardList, FileCheck2, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, RequestStatusBadge, ResultBadge } from "@/components/common";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { verifyLedger } from "@/lib/ledger";
import { VALIDATORS } from "@/lib/pbft";
import { useApp } from "@/lib/store";
import type { RequestStatus } from "@/lib/types";
import { fmtDateTime, humanize } from "@/lib/utils";

const STATUS_COLOR: Record<string, string> = { good: "#059669", warn: "#d97706", bad: "#dc2626", info: "#2563eb" };
const STATUS_GROUP: { label: string; statuses: RequestStatus[]; tone: keyof typeof STATUS_COLOR }[] = [
  { label: "Awaiting review", statuses: ["SUBMITTED", "RECEIVED", "UNDER_REVIEW", "CONSENT_CHECKED"], tone: "info" },
  { label: "In contract / PBFT", statuses: ["CONTRACT_PENDING", "CONTRACT_APPROVED", "PBFT_IN_PROGRESS"], tone: "warn" },
  { label: "Awaiting final approval", statuses: ["COMMITTED"], tone: "warn" },
  { label: "Released", statuses: ["RELEASED"], tone: "good" },
  { label: "Denied by contract", statuses: ["DENIED"], tone: "bad" },
  { label: "Rejected by hospital", statuses: ["REJECTED"], tone: "bad" },
  { label: "Consensus failed", statuses: ["CONSENSUS_FAILED"], tone: "bad" },
];

function Stat({ label, value, icon: Icon, hint }: { label: string; value: React.ReactNode; icon: React.ComponentType<{ className?: string }>; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
          {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
        </div>
        <Icon className="size-5 text-slate-400" />
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="font-medium text-slate-900">{label}</div>
      <div className="text-slate-600">{payload[0].value}</div>
    </div>
  );
}

function SimpleBar({ data, color, horizontal }: { data: { name: string; value: number; color?: string }[]; color: string; horizontal?: boolean }) {
  if (horizontal) {
    // Long category labels read better down the side than squeezed under columns.
    return (
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid horizontal={false} stroke="#eef2f7" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={118} tick={{ fontSize: 11, fill: "#475569" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
          <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
            {data.map((d) => <Cell key={d.name} fill={d.color ?? color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={{ stroke: "#e2e8f0" }} tickLine={false} interval={0} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f1f5f9" }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {data.map((d) => <Cell key={d.name} fill={d.color ?? color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function DashboardPage() {
  const { state, activeContract, now } = useApp();
  const [integrity, setIntegrity] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    verifyLedger(state.ledger).then((r) => !cancelled && setIntegrity(r.valid));
    return () => { cancelled = true; };
  }, [state.ledger]);

  const reqs = state.requests;
  const released = reqs.filter((r) => r.status === "RELEASED").length;
  const denied = reqs.filter((r) => r.status === "DENIED").length;
  const activeConsents = state.consents.filter((c) => c.status === "ACTIVE" && new Date(c.expiry) > now).length;
  const online = VALIDATORS.filter((v) => state.nodeStatus[v] === "ONLINE").length;

  const byStatus = STATUS_GROUP.map((g) => ({ name: g.label, value: reqs.filter((r) => g.statuses.includes(r.status)).length, color: STATUS_COLOR[g.tone] }));
  const byRule = [
    { name: "Rule 1", value: reqs.filter((r) => r.deniedByRule === 1).length },
    { name: "Rule 2", value: reqs.filter((r) => r.deniedByRule === 2).length },
    { name: "Rule 3", value: reqs.filter((r) => r.deniedByRule === 3).length },
    { name: "E1", value: reqs.filter((r) => r.decision === "DENY" && !r.deniedByRule).length },
  ];
  const byKind = (["AUDIT", "PBFT", "TRANSACTION", "BLOCK"] as const).map((k) => ({ name: humanize(k), value: state.ledger.filter((e) => e.kind === k).length }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Live view of requests, consent, consensus and ledger state across the consortium." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Record requests" value={reqs.length} icon={ClipboardList} hint={`${released} released · ${denied} denied · ${reqs.filter((r) => r.status === "REJECTED").length} rejected`} />
        <Stat label="Active consents" value={activeConsents} icon={FileCheck2} hint={`${state.consents.length} total recorded`} />
        <Stat label="Ledger events" value={state.ledger.length} icon={Activity} hint={`${state.blocks.length} committed blocks`} />
        <Stat
          label="Chain integrity"
          value={integrity === null ? "…" : integrity ? <span className="flex items-center gap-1.5 text-emerald-700"><ShieldCheck className="size-5" />Valid</span> : <span className="flex items-center gap-1.5 text-red-700"><ShieldAlert className="size-5" />Broken</span>}
          icon={Blocks}
          hint={`Contract v${activeContract.version} · ${online}/4 validators online`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Requests by status</CardTitle><CardDescription>Green = completed, amber = in progress, red = stopped</CardDescription></CardHeader>
          <CardContent><SimpleBar data={byStatus} color="#2563eb" horizontal /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Denials by contract rule</CardTitle><CardDescription>Which rule stopped each denied request</CardDescription></CardHeader>
          <CardContent><SimpleBar data={byRule} color="#2563eb" /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ledger entries by type</CardTitle><CardDescription>Audit events, PBFT messages, transactions, blocks</CardDescription></CardHeader>
          <CardContent><SimpleBar data={byKind} color="#0d9488" /></CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Recent requests</CardTitle><Link href="/requests?tab=all" className="text-xs text-teal-700 hover:underline">All requests</Link></CardHeader>
          <CardContent className="space-y-2">
            {reqs.length === 0 && <div className="text-sm text-slate-500">No requests yet. Start with the <Link className="text-teal-700 underline" href="/">Request Workflow</Link>.</div>}
            {reqs.slice(0, 6).map((r) => (
              <Link key={r.id} href={`/requests/${r.id}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 hover:bg-slate-50">
                <div className="text-sm">
                  <span className="font-mono text-xs font-semibold">{r.id}</span> · {r.requestingHospitalId} → {r.sourceHospitalId} · {r.categories.join(", ")}
                </div>
                <div className="flex items-center gap-2">
                  {r.status === "DENIED" ? <XCircle className="size-4 text-red-500" /> : r.status === "RELEASED" ? <CheckCircle2 className="size-4 text-emerald-600" /> : null}
                  <RequestStatusBadge status={r.status} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between"><CardTitle>Latest ledger activity</CardTitle><Link href="/ledger" className="text-xs text-teal-700 hover:underline">Open ledger</Link></CardHeader>
          <CardContent className="space-y-1.5">
            {[...state.ledger].reverse().slice(0, 9).map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0 truncate"><span className="font-mono text-xs text-slate-500">{e.id}</span> <span className="font-medium">{e.action}</span> <span className="text-slate-500">· {e.actor}</span></div>
                <div className="flex shrink-0 items-center gap-2"><span className="hidden text-xs text-slate-400 sm:inline">{fmtDateTime(e.timestamp)}</span><ResultBadge result={e.result} /></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
