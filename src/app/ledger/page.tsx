"use client";

import { ChevronDown, ChevronRight, Download, FileWarning, Receipt, RotateCcw, Search, ShieldCheck, Undo2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Fragment, Suspense, useMemo, useState } from "react";
import { Explain, Hash, KV, notify, PageHeader, ResultBadge, resultTone, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Tabs } from "@/components/ui/tabs";
import { Input, Select } from "@/components/ui/form";
import { canonicalEventPayload, computeEventHash, ledgerToCsv, type LedgerVerification } from "@/lib/ledger";
import { useApp } from "@/lib/store";
import type { EventKind, LedgerEvent } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const KIND_VARIANT: Record<EventKind, "neutral" | "violet" | "info" | "teal"> = { AUDIT: "neutral", PBFT: "violet", TRANSACTION: "info", BLOCK: "teal" };
const KIND_LABEL: Record<EventKind, string> = { AUDIT: "Audit event", PBFT: "PBFT message", TRANSACTION: "Transaction", BLOCK: "Committed block" };

function ReceiptView({ event }: { event: LedgerEvent }) {
  const { state } = useApp();
  const d = event.details as Record<string, unknown>;
  const block = state.blocks.find((b) => b.id === (event.blockId ?? ""));
  const txBlock = state.blocks.find((b) => b.txIds.includes(event.txId));
  const b = block ?? txBlock;
  const txEvents = state.ledger.filter((e) => e.txId === event.txId);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <KV label="Transaction" mono>{event.txId}</KV>
        <KV label="Events in transaction">{txEvents.length}</KV>
        <KV label="Event">{event.id}</KV>
        <KV label="Type">{KIND_LABEL[event.kind]} · {event.action}</KV>
        <KV label="Actor">{event.actor} ({event.actorRole})</KV>
        <KV label="Status"><ResultBadge result={event.result} /></KV>
        {"digest" in d && <KV label="Digest" mono><Hash value={String(d.digest)} n={12} /></KV>}
        {"sequence" in d && <KV label="Sequence">#{String(d.sequence)}</KV>}
        <KV label="Request" mono>{event.requestId ?? "—"}</KV>
        <KV label="Contract version">v{event.contractVersion}</KV>
        <KV label="Timestamp">{fmtDateTime(event.timestamp)}</KV>
      </div>
      {b ? (
        <div className="rounded-md border border-teal-200 bg-teal-50/60 p-3">
          <div className="mb-2 text-sm font-semibold text-teal-900">Block {b.id} · height {b.height}</div>
          <div className="grid grid-cols-2 gap-3">
            <KV label="Label">{b.label}</KV>
            <KV label="Committed by">{b.commitVotes.join(", ") || "—"}</KV>
            <KV label="Merkle root" mono><Hash value={b.merkleRoot} n={12} /></KV>
            <KV label="Block hash" mono><Hash value={b.hash} n={12} /></KV>
            <KV label="Previous block" mono><Hash value={b.previousBlockHash} n={12} /></KV>
            <KV label="Events anchored">{b.eventHashes.length}</KV>
          </div>
        </div>
      ) : (
        <Explain tone="warn">This transaction is not part of a committed block.</Explain>
      )}
      <div className="grid gap-1 text-xs">
        <div><span className="text-slate-500">previousHash</span> <span className="font-mono break-all">{event.previousHash}</span></div>
        <div><span className="text-slate-500">currentHash</span> <span className="font-mono break-all">{event.currentHash}</span></div>
      </div>
    </div>
  );
}

// Recomputes SHA256(previousHash + canonicalEventPayload) live so the stored hash can be checked by eye.
function HashInspector({ event }: { event: LedgerEvent }) {
  const [recomputed, setRecomputed] = useState<string | null>(null);
  const payload = canonicalEventPayload(event);
  return (
    <div className="space-y-1.5 rounded-md border border-slate-200 bg-white p-2.5" onClick={(ev) => ev.stopPropagation()}>
      <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">Hash inspection</div>
      <div><span className="text-slate-500">previousHash</span> <span className="font-mono break-all">{event.previousHash}</span></div>
      <details>
        <summary className="cursor-pointer text-teal-700">canonicalEventPayload ({payload.length} chars)</summary>
        <pre className="mt-1 max-h-40 overflow-auto rounded bg-slate-100 p-2 text-[10px] break-all whitespace-pre-wrap">{payload}</pre>
      </details>
      <div><span className="text-slate-500">stored currentHash</span> <span className="font-mono break-all">{event.currentHash}</span></div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={async () => setRecomputed(await computeEventHash(event.previousHash, event))}>Recompute SHA-256</Button>
        {recomputed && (recomputed === event.currentHash ? <Badge variant="success">Match</Badge> : <Badge variant="danger">Mismatch: event altered</Badge>)}
      </div>
      {recomputed && <div><span className="text-slate-500">recomputed</span> <span className="font-mono break-all">{recomputed}</span></div>}
    </div>
  );
}

function TransactionsView({ onOpen }: { onOpen: (txId: string) => void }) {
  const { state } = useApp();
  const txs = useMemo(() => {
    const map = new Map<string, LedgerEvent[]>();
    for (const e of state.ledger) map.set(e.txId, [...(map.get(e.txId) ?? []), e]);
    return [...map.entries()].map(([txId, events]) => ({ txId, events })).reverse();
  }, [state.ledger]);
  return (
    <Card>
      <CardHeader><CardTitle>Transaction history</CardTitle><CardDescription>Events grouped by transaction ID. A request keeps one transaction reference from creation to final decision.</CardDescription></CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Transaction</th><th className="px-4 py-2">Request</th><th className="px-4 py-2">Started</th><th className="px-4 py-2">Initiated by</th><th className="px-4 py-2">Events</th><th className="px-4 py-2">First and last action</th><th className="px-4 py-2">Latest result</th><th className="px-4 py-2" /></tr></thead>
          <tbody>
            {txs.map(({ txId, events }) => {
              const first = events[0];
              const last = events[events.length - 1];
              return (
                <tr key={txId} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-mono text-xs">{txId}</td>
                  <td className="px-4 py-2 font-mono text-xs">{first.requestId ?? "—"}</td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap text-slate-500">{fmtDateTime(first.timestamp)}</td>
                  <td className="px-4 py-2 text-xs">{first.actor}<div className="text-slate-500">{first.actorRole}</div></td>
                  <td className="px-4 py-2">{events.length}</td>
                  <td className="px-4 py-2 text-xs">{first.action}{events.length > 1 ? ` → ${last.action}` : ""}</td>
                  <td className="px-4 py-2"><ResultBadge result={last.result} /></td>
                  <td className="px-4 py-2 text-right"><Button size="sm" variant="ghost" onClick={() => onOpen(txId)}>View events</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function LedgerInner() {
  const { state, actions } = useApp();
  const params = useSearchParams();
  const { busy, run } = useAction();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState<EventKind | "ALL">("ALL");
  const [outcome, setOutcome] = useState<"ALL" | "success" | "danger" | "pending">("ALL");
  const [hospitalId, setHospitalId] = useState("ALL");
  const [action, setAction] = useState("ALL");
  const [actor, setActor] = useState("ALL");
  const [day, setDay] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(75);
  const [verification, setVerification] = useState<LedgerVerification | null>(null);
  const [receipt, setReceipt] = useState<LedgerEvent | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [tamperTarget, setTamperTarget] = useState("");
  const [view, setView] = useState<"events" | "transactions">("events");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...state.ledger].reverse().filter((e) => {
      if (kind !== "ALL" && e.kind !== kind) return false;
      if (outcome !== "ALL" && resultTone(e.result) !== outcome) return false;
      if (hospitalId !== "ALL" && e.hospitalId !== hospitalId && e.subject?.requestingHospitalId !== hospitalId && e.subject?.sourceHospitalId !== hospitalId) return false;
      if (action !== "ALL" && e.action !== action) return false;
      if (actor !== "ALL" && e.actor !== actor) return false;
      if (day && e.timestamp.slice(0, 10) !== day) return false;
      if (!needle) return true;
      return [e.id, e.txId, e.action, e.actor, e.actorRole, e.result, e.requestId, e.blockId, e.currentHash, e.explanation, e.subject?.patientId, e.subject?.patientName, JSON.stringify(e.details)].some((f) => f && String(f).toLowerCase().includes(needle));
    });
  }, [state.ledger, q, kind, outcome, hospitalId, action, actor, day]);
  const actionOptions = useMemo(() => [...new Set(state.ledger.map((e) => e.action))].sort(), [state.ledger]);
  const actorOptions = useMemo(() => [...new Set(state.ledger.map((e) => e.actor))].sort(), [state.ledger]);

  const counts = state.ledger.reduce<Record<string, number>>((acc, e) => ((acc[e.kind] = (acc[e.kind] ?? 0) + 1), acc), {});
  const tamperCandidates = state.ledger.filter((e) => ["ACCESS_GRANTED", "ACCESS_DENIED", "CONTRACT_APPROVED", "CONTRACT_DENIED", "FINAL_DECISION", "CONSENT_GRANTED", "CONSENT_REVOKED", "HOSPITAL_APPROVED", "HOSPITAL_REJECTED", "MEDICAL_RECORD_RELEASED", "MEDICAL_RECORD_WITHHELD", "REQUEST_CREATED"].includes(e.action) || /^RULE_/.test(e.action));

  const exportCsv = () => {
    const blob = new Blob([ledgerToCsv(state.ledger)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `medchain-ledger-${new Date().toISOString().slice(0, 19).replace(/:/g, "")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notify(`Exported ${state.ledger.length} events`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Transaction & Audit Ledger"
        description={<>Every meaningful action is appended here. Each entry stores <code className="rounded bg-slate-100 px-1 text-xs">currentHash = SHA256(previousHash + canonicalEventPayload)</code>, so changing any past entry breaks every link after it.</>}
        actions={
          <>
            <Button
              disabled={busy}
              onClick={async () => {
                const r = await run(() => actions.verifyLedger());
                if (!r) return;
                setVerification(r);
                notify(r.valid ? `Ledger valid — ${r.checked} events checked` : `Ledger INVALID at event ${r.failure?.eventId}`, r.valid ? "success" : "error");
              }}
            >
              <ShieldCheck /> Verify Ledger
            </Button>
            <Button variant="outline" onClick={exportCsv}><Download /> Export CSV</Button>
            <Button variant="outline" className="text-red-700" onClick={() => setConfirmReset(true)}><RotateCcw /> Reset Demo Data</Button>
          </>
        }
      />

      {verification && (
        verification.valid ? (
          <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <ShieldCheck className="size-5" />
            <div><b>Chain intact.</b> All {verification.checked} events recomputed and every previousHash link matches. Checked {fmtDateTime(verification.at)}.</div>
          </div>
        ) : (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            <div className="flex items-center gap-2 font-semibold"><FileWarning className="size-5" /> Integrity failure at event #{verification.failure!.index} ({verification.failure!.eventId})</div>
            <div className="mt-1">{verification.failure!.reason}.</div>
            <div className="mt-2 grid gap-1 font-mono text-xs break-all">
              <div>stored:     {verification.failure!.stored}</div>
              <div>recomputed: {verification.failure!.expected}</div>
            </div>
          </div>
        )
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(["AUDIT", "PBFT", "TRANSACTION", "BLOCK"] as EventKind[]).map((k) => (
          <button key={k} onClick={() => setKind(kind === k ? "ALL" : k)} className={cn("rounded-lg border bg-white p-3 text-left shadow-sm", kind === k ? "border-teal-400 ring-2 ring-teal-100" : "border-slate-200")}>
            <div className="text-xs text-slate-500">{KIND_LABEL[k]}s</div>
            <div className="text-xl font-semibold text-slate-900">{counts[k] ?? 0}</div>
          </button>
        ))}
        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="text-xs text-slate-500">Chain head</div>
          <div className="truncate font-mono text-sm font-semibold text-slate-900">{state.blocks[state.blocks.length - 1]?.id}</div>
          <div className="truncate font-mono text-[11px] text-slate-500">{state.ledger[state.ledger.length - 1]?.currentHash.slice(0, 16)}…</div>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle>Tampering demonstration</CardTitle><CardDescription>Simulates an attacker editing one stored entry directly, without recomputing hashes. Then press Verify Ledger.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          {state.tamper ? (
            <>
              <Badge variant="danger">Event {state.tamper.eventId} altered (was “{state.tamper.original}”)</Badge>
              <Button variant="outline" disabled={busy} onClick={() => run(() => actions.restoreTamper(), "Original value restored")}><Undo2 /> Restore original</Button>
            </>
          ) : (
            <>
              <Select aria-label="Event to tamper" className="w-auto min-w-72" value={tamperTarget} onChange={(e) => setTamperTarget(e.target.value)}>
                <option value="">Choose an event to alter…</option>
                {tamperCandidates.map((e) => <option key={e.id} value={e.id}>{e.id} · {e.action} · {e.result}{e.requestId ? ` · ${e.requestId}` : ""}</option>)}
              </Select>
              <Button variant="destructive" disabled={busy || !tamperTarget} onClick={() => run(() => actions.tamperEvent(tamperTarget), "Event altered in storage. Now verify the ledger.")}>Alter stored event</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Tabs value={view} onChange={setView} tabs={[{ value: "events", label: "Event log" }, { value: "transactions", label: "Transaction history" }]} />

      {view === "transactions" ? (
        <TransactionsView onOpen={(tx) => { setQ(tx); setView("events"); }} />
      ) : (
      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-60 flex-1">
              <Search className="absolute top-2.5 left-2.5 size-4 text-slate-400" />
              <Input className="pl-8" placeholder="Search transaction ID, request ID, patient (PAT-001 / name), actor, hash…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select aria-label="Event type" className="w-auto" value={kind} onChange={(e) => setKind(e.target.value as EventKind | "ALL")}>
              <option value="ALL">All types</option>
              {(["AUDIT", "PBFT", "TRANSACTION", "BLOCK"] as EventKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </Select>
            <Select aria-label="Result" className="w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
              <option value="ALL">All results</option><option value="success">Success</option><option value="danger">Denied / failed</option><option value="pending">Pending</option>
            </Select>
            <Select aria-label="Event type filter" className="w-auto" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="ALL">All event types</option>
              {actionOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
            <Select aria-label="Actor" className="w-auto" value={actor} onChange={(e) => setActor(e.target.value)}>
              <option value="ALL">All actors</option>
              {actorOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
            <Input aria-label="Date" type="date" className="w-auto" value={day} onChange={(e) => setDay(e.target.value)} />
            <Select aria-label="Hospital" className="w-auto" value={hospitalId} onChange={(e) => setHospitalId(e.target.value)}>
              <option value="ALL">All hospitals</option>
              {state.hospitals.map((h) => <option key={h.id} value={h.id}>{h.id}</option>)}
            </Select>
          </div>
          <div className="text-xs text-slate-500">{filtered.length} of {state.ledger.length} events · newest first</div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs whitespace-nowrap text-slate-500">
              <tr>
                <th className="w-6 px-2 py-2" /><th className="px-3 py-2">#</th><th className="px-3 py-2">Event ID</th><th className="px-3 py-2">Transaction</th><th className="px-3 py-2">Request</th><th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Actor (role)</th><th className="px-3 py-2">Hosp.</th><th className="px-3 py-2">Event type</th><th className="px-3 py-2">Result</th><th className="px-3 py-2">Explanation</th>
                <th className="px-3 py-2">Prev hash</th><th className="px-3 py-2">Current hash</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((e) => {
                const open = expanded === e.id;
                const tampered = state.tamper?.eventId === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className={cn("cursor-pointer border-t border-slate-100 hover:bg-slate-50", tampered && "bg-red-50")} onClick={() => setExpanded(open ? null : e.id)}>
                      <td className="px-2 py-2 text-slate-400">{open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                      <td className="px-3 py-2 text-xs text-slate-500">{e.index}</td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{e.id}</td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{e.txId}</td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{e.requestId ?? "—"}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-slate-500">{fmtDateTime(e.timestamp)}</td>
                      <td className="max-w-44 px-3 py-2 text-xs"><div className="truncate">{e.actor}</div><div className="truncate text-slate-500">{e.actorRole}</div></td>
                      <td className="px-3 py-2 text-xs">{e.hospitalId ?? "—"}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap"><Badge variant={KIND_VARIANT[e.kind]} className="mr-1">{e.kind}</Badge><span className="font-medium">{e.action}</span></td>
                      <td className="px-3 py-2"><ResultBadge result={e.result} /></td>
                      <td className="max-w-sm min-w-60 px-3 py-2 text-xs text-slate-600"><div className="line-clamp-2">{e.explanation}</div></td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.previousHash.slice(0, 8)}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{e.currentHash.slice(0, 8)}</td>
                    </tr>
                    {open && (
                      <tr className="border-t border-slate-100 bg-slate-50/60">
                        <td colSpan={13} className="px-6 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-2 text-xs">
                              <div className="text-sm text-slate-800">{e.explanation}</div>
                              <div><span className="text-slate-500">Actor</span> {e.actor} · {e.actorRole} · <span className="font-mono break-all">{e.actorDid}</span></div>
                              <div><span className="text-slate-500">Contract version</span> v{e.contractVersion} · <span className="text-slate-500">Block</span> {e.blockId ?? "—"}</div>
                              <HashInspector event={e} />
                              <div className="flex gap-2 pt-1">
                                <Button size="sm" variant="outline" onClick={(ev) => { ev.stopPropagation(); setReceipt(e); }}><Receipt /> Transaction receipt</Button>
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 text-[11px] font-medium tracking-wide text-slate-500 uppercase">Details</div>
                              <pre className="max-h-72 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-200">{JSON.stringify(e.details, null, 2)}</pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length > limit && <div className="p-3 text-center"><Button variant="ghost" onClick={() => setLimit(limit + 100)}>Show more ({filtered.length - limit} remaining)</Button></div>}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Committed blocks</CardTitle><CardDescription>Each block anchors a Merkle root of the events it covers and links to the previous block&apos;s hash.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">Height</th><th className="px-4 py-2">Block</th><th className="px-4 py-2">Label</th><th className="px-4 py-2">Tx</th><th className="px-4 py-2">Seq</th><th className="px-4 py-2">Votes</th><th className="px-4 py-2">Merkle root</th><th className="px-4 py-2">Prev</th><th className="px-4 py-2">Hash</th></tr></thead>
            <tbody>
              {[...state.blocks].reverse().map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">{b.height}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.id}</td>
                  <td className="px-4 py-2">{b.label}</td>
                  <td className="px-4 py-2 font-mono text-xs">{b.txIds.join(", ") || "—"}</td>
                  <td className="px-4 py-2">{b.sequence ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{b.commitVotes.join(", ")}</td>
                  <td className="px-4 py-2"><Hash value={b.merkleRoot} n={6} /></td>
                  <td className="px-4 py-2"><Hash value={b.previousBlockHash} n={6} /></td>
                  <td className="px-4 py-2"><Hash value={b.hash} n={6} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!receipt} onClose={() => setReceipt(null)} title="Transaction receipt">
        {receipt && <ReceiptView event={receipt} />}
      </Dialog>

      <Dialog open={confirmReset} onClose={() => setConfirmReset(false)} title="Reset demo data?">
        <p className="text-sm text-slate-700">This clears consents, requests, PBFT rounds, contract versions, proposals and the whole ledger, then rebuilds the genesis state. It cannot be undone.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
          <Button variant="destructive" onClick={async () => { await actions.resetDemo(); setVerification(null); setConfirmReset(false); notify("Demo data reset"); }}>Reset everything</Button>
        </div>
      </Dialog>
    </div>
  );
}

export default function LedgerPage() {
  return (
    <Suspense>
      <LedgerInner />
    </Suspense>
  );
}
