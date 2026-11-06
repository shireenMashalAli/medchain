"use client";

import { CheckCircle2, CircleDashed, Play, PlayCircle, XCircle } from "lucide-react";
import Link from "next/link";
import { Explain, PassFail, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { RULES } from "@/lib/contract-code";
import { useApp } from "@/lib/store";
import type { DataRequest } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

export function RulesPanel({ request, interactive = true }: { request: DataRequest; interactive?: boolean }) {
  const { actions, session, user } = useApp();
  const { busy, run } = useAction();
  const canRun = interactive && (request.status === "CONTRACT_PENDING" || request.status === "CONSENT_CHECKED") && !request.decision;
  const nextRule = request.rules.length + 1;
  const failedAt = request.rules.find((r) => r.result === "FAIL")?.ruleId;

  return (
    <div className="space-y-4">
      {interactive && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-slate-600">
            Processing as <b>{session.name}</b>. Contract version v{request.contractVersion ?? "—"} · rules run in order and stop at the first failure.
          </div>
          <Button disabled={!canRun || busy} onClick={() => run(() => actions.runAllRules(request.id))}>
            <PlayCircle /> Run All Rules
          </Button>
        </div>
      )}

      {RULES.map((rule) => {
        const ev = request.rules.find((r) => r.ruleId === rule.id);
        const halted = !ev && (failedAt !== undefined || request.decision === "DENY");
        return (
          <Card key={rule.id} className={cn(ev?.result === "PASS" && "border-emerald-200", ev?.result === "FAIL" && "border-red-300")}>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold", ev ? (ev.result === "PASS" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700") : "bg-slate-100 text-slate-600")}>
                    {ev ? ev.result === "PASS" ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" /> : rule.id}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Rule {rule.id} — {rule.name}</div>
                    <p className="mt-0.5 text-sm text-slate-600">{rule.plain}</p>
                  </div>
                </div>
                {ev ? (
                  <PassFail pass={ev.result === "PASS"} label={ev.result} />
                ) : halted ? (
                  <Badge variant="neutral"><CircleDashed className="size-3" />Not evaluated</Badge>
                ) : interactive ? (
                  <Button size="sm" variant="outline" disabled={!canRun || busy || nextRule !== rule.id} onClick={() => run(() => actions.evaluateRule(request.id, rule.id))}>
                    <Play /> Run Rule {rule.id}
                  </Button>
                ) : (
                  <Badge variant="pending">Waiting</Badge>
                )}
              </div>

              <pre className="overflow-x-auto rounded-md bg-slate-900 px-3 py-2 font-mono text-xs text-teal-200">{rule.condition}</pre>

              {ev && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
                    <div><span className="text-slate-400">Event ID</span> <Link href={`/ledger?q=${ev.eventId}`} className="font-mono text-teal-700 hover:underline">{ev.eventId}</Link></div>
                    <div><span className="text-slate-400">Timestamp</span> {fmtDateTime(ev.timestamp)}</div>
                    <div><span className="text-slate-400">Processor</span> {user(ev.processorId)?.name}</div>
                  </div>
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-slate-500">
                        <tr><th className="px-3 py-1.5 font-medium">Input</th><th className="px-3 py-1.5 font-medium">Actual value</th><th className="w-10 px-3 py-1.5" /></tr>
                      </thead>
                      <tbody>
                        {ev.inputs.map((i) => (
                          <tr key={i.label} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-600">{i.label}</td>
                            <td className="px-3 py-1.5 font-mono text-slate-900">{i.value}</td>
                            <td className="px-3 py-1.5">{i.ok === undefined ? null : i.ok ? <CheckCircle2 className="size-3.5 text-emerald-600" /> : <XCircle className="size-3.5 text-red-600" />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {ev && <div className={cn("rounded-md px-3 py-2 text-sm", ev.result === "PASS" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800")}><b>Reason:</b> {ev.reason}</div>}
              {halted && <div className="text-xs text-slate-500">The contract halted at Rule {failedAt}. Later rules are not executed once a rule fails.</div>}
            </CardContent>
          </Card>
        );
      })}

      {request.decision === "DENY" && (
        <Explain tone="warn" title={`Request denied${request.deniedByRule ? ` by Rule ${request.deniedByRule}` : " by emergency extension E1"}`}>
          The denial has been written to the ledger. The hospital cannot override it, and no record is released.
        </Explain>
      )}
      {request.decision === "APPROVE" && (
        <Explain tone="tip" title="All three rules passed">
          The contract approved the request, but approval alone does not release data. The source hospital must now approve it before the permitted records are released.
        </Explain>
      )}
    </div>
  );
}
