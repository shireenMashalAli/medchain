"use client";

import { ChevronDown, ChevronRight, Radio, ScrollText, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ResultBadge } from "@/components/common";
import { PURPOSE_LABEL } from "@/lib/rbac";
import { useStore } from "@/lib/store";
import type { LedgerEvent } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const SHOWN = 60;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="min-w-0 break-all text-slate-800">{children}</span>
    </div>
  );
}

function EventRow({ e, newest }: { e: LedgerEvent; newest: boolean }) {
  const [open, setOpen] = useState(false);
  const s = e.subject;
  return (
    <li className={cn("border-b border-slate-100 px-3 py-2.5 text-xs", newest && "bg-teal-50 ring-1 ring-teal-300 ring-inset")}>
      <button className="w-full text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1">
            {open ? <ChevronDown className="size-3.5 shrink-0 text-slate-400" /> : <ChevronRight className="size-3.5 shrink-0 text-slate-400" />}
            <span className="truncate font-semibold text-slate-900">{e.action}</span>
          </div>
          <ResultBadge result={e.result} />
        </div>
        <div className="mt-0.5 pl-4.5 font-mono text-[10px] text-slate-500">
          {e.id} · {e.txId}{e.requestId ? ` · ${e.requestId}` : ""}
        </div>
        <div className="mt-1 pl-4.5 text-slate-700">
          <b className="font-medium">{e.actor}</b> <span className="text-slate-500">({e.actorRole}{e.hospitalId ? `, ${e.hospitalId}` : ""})</span>
        </div>
        {s?.patientId && (
          <div className="mt-0.5 pl-4.5 text-slate-600">
            {s.requestingHospitalId ? <>{s.requestingHospitalId} → {s.patientName} ({s.patientId}) {s.categories.join(", ")} from {s.sourceHospitalId}{s.purpose ? ` · ${PURPOSE_LABEL[s.purpose]}` : ""}</> : <>Patient {s.patientName} ({s.patientId})</>}
          </div>
        )}
        <div className="mt-1 flex items-center justify-between pl-4.5 font-mono text-[10px] text-slate-400">
          <span>{fmtDateTime(e.timestamp)}</span>
          <span title={`${e.previousHash} → ${e.currentHash}`}>{e.previousHash.slice(0, 6)} → <span className="text-teal-700">{e.currentHash.slice(0, 10)}</span></span>
        </div>
      </button>
      {open && (
        <div className="mt-2 space-y-1 rounded-md border border-slate-200 bg-white p-2 text-[11px]">
          <div className="pb-1 text-slate-700">{e.explanation}</div>
          <Field label="Event ID">{e.id}</Field>
          <Field label="Transaction">{e.txId}</Field>
          <Field label="Request">{e.requestId ?? "—"}</Field>
          <Field label="Event type">{e.kind} · {e.action}</Field>
          <Field label="Actor">{e.actor}</Field>
          <Field label="Role">{e.actorRole}</Field>
          <Field label="Requesting">{s?.requestingHospitalId ?? "—"}</Field>
          <Field label="Source">{s?.sourceHospitalId ?? "—"}</Field>
          <Field label="Patient">{s?.patientId ? `${s.patientName} (${s.patientId})` : "—"}</Field>
          <Field label="Records">{s?.categories.length ? s.categories.join(", ") : "—"}</Field>
          <Field label="Purpose">{s?.purpose ? PURPOSE_LABEL[s.purpose] : "—"}</Field>
          {s?.reason && <Field label="Reason">{s.reason}</Field>}
          <Field label="Timestamp">{e.timestamp}</Field>
          <Field label="Status">{e.result}</Field>
          <Field label="Prev hash"><span className="font-mono">{e.previousHash}</span></Field>
          <Field label="Current hash"><span className="font-mono">{e.currentHash}</span></Field>
          <Link href={`/ledger?q=${e.id}`} className="inline-block pt-1 text-teal-700 hover:underline">Open in full ledger</Link>
        </div>
      )}
    </li>
  );
}

// The same event collection the Ledger page reads (state.ledger). Events appear only after commit() has hashed and saved them.
export function LiveLedger({ onClose }: { onClose?: () => void }) {
  const { state } = useStore();
  if (!state) return null;
  const events = state.ledger.slice(-SHOWN).reverse();
  return (
    <div className="flex h-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-900 uppercase">
            <Radio className="size-3.5 text-teal-600" /> Live transaction ledger
          </div>
          <div className="text-[11px] text-slate-500">{state.ledger.length} events · SHA-256 chained · newest first</div>
        </div>
        <div className="flex items-center gap-1">
          <Link href="/ledger" className="rounded p-1.5 text-slate-500 hover:bg-slate-100" title="Open full ledger" aria-label="Open full ledger"><ScrollText className="size-4" /></Link>
          {onClose && <button onClick={onClose} className="rounded p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close live ledger"><X className="size-4" /></button>}
        </div>
      </div>
      <ol className="flex-1 overflow-y-auto" aria-live="polite" data-testid="live-ledger">
        {events.map((e, i) => <EventRow key={e.id} e={e} newest={i === 0} />)}
      </ol>
      {state.ledger.length > SHOWN && (
        <Link href="/ledger" className="border-t border-slate-200 px-3 py-2 text-center text-xs text-teal-700 hover:bg-slate-50">
          Showing the latest {SHOWN} of {state.ledger.length} — open the full ledger
        </Link>
      )}
    </div>
  );
}
