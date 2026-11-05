"use client";

import { GitBranch, Rocket, ThumbsDown, ThumbsUp } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DiffViewer } from "@/components/code-viewer";
import { EmptyState, Explain, KV, PageHeader, ResultBadge, RoleGate, SimulationTag, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label, Select, Textarea } from "@/components/ui/form";
import { generateContractCode } from "@/lib/contract-code";
import { QUORUM, VALIDATORS } from "@/lib/pbft";
import { hasPermission } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { ProposalType } from "@/lib/types";
import { cn, fmtDateTime } from "@/lib/utils";

const TEMPLATES: Record<ProposalType, { title: string; description: string }> = {
  POLICY_UPDATE: { title: "Shorten maximum consent duration", description: "Limit new consents to 180 days so patients re-confirm sharing at least twice a year." },
  EMERGENCY_PATHWAY: { title: "Add emergency-access pathway (E1)", description: "Requests for emergency care must carry a documented clinical justification and are flagged for retrospective review. The three baseline rules still apply in full." },
};

export default function GovernancePage() {
  const { state, session, actions, activeContract, user, hospital } = useApp();
  const { busy, run } = useAction();
  const [type, setType] = useState<ProposalType>("EMERGENCY_PATHWAY");
  const [title, setTitle] = useState(TEMPLATES.EMERGENCY_PATHWAY.title);
  const [description, setDescription] = useState(TEMPLATES.EMERGENCY_PATHWAY.description);
  const [days, setDays] = useState(180);
  const [selected, setSelected] = useState<string | null>(null);
  const proposal = state.proposals.find((p) => p.id === selected) ?? state.proposals[0];
  const isAdmin = hasPermission(session.role, "governance:propose");

  const changeType = (t: ProposalType) => {
    setType(t);
    setTitle(TEMPLATES[t].title);
    setDescription(TEMPLATES[t].description);
  };

  const base = proposal ? state.contracts.find((c) => c.version === proposal.baseVersion) : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Governance"
        description="Administrators propose changes to contract policy. The four hospital validators vote, and a proposal passes with 3 of 4 approvals (2f + 1). The three baseline rules cannot be changed here."
        actions={<SimulationTag>Votes and deployment are simulated</SimulationTag>}
      />

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>New proposal</CardTitle><CardDescription>Based on active version v{activeContract.version}</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {!isAdmin && <RoleGate roles={["GOVERNANCE_ADMIN"]} purpose="create proposals" />}
              <div>
                <Label htmlFor="g-type">Change type</Label>
                <Select id="g-type" value={type} onChange={(e) => changeType(e.target.value as ProposalType)}>
                  <option value="EMERGENCY_PATHWAY">Additional emergency-access pathway</option>
                  <option value="POLICY_UPDATE">Policy update: maximum consent duration</option>
                </Select>
              </div>
              {type === "POLICY_UPDATE" && (
                <div>
                  <Label htmlFor="g-days">maxConsentDays (currently {activeContract.policy.maxConsentDays})</Label>
                  <Input id="g-days" type="number" min={1} max={730} value={days} onChange={(e) => setDays(Number(e.target.value))} />
                </div>
              )}
              <div><Label htmlFor="g-title">Title</Label><Input id="g-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div><Label htmlFor="g-desc">Description</Label><Textarea id="g-desc" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
              <Explain tone="tip">Baseline Rules 1–3 are not editable. Proposals can only change policy parameters or add extra checks.</Explain>
              <Button
                className="w-full"
                disabled={busy || !isAdmin}
                onClick={async () => {
                  const policy = type === "POLICY_UPDATE" ? { ...activeContract.policy, maxConsentDays: days } : { ...activeContract.policy, emergencyPathway: true };
                  const p = await run(() => actions.createProposal({ type, title, description, policy }), (p) => `${p.id} opened for voting`);
                  if (p) setSelected(p.id);
                }}
              >
                Submit proposal
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Proposals</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 p-3">
              {state.proposals.length === 0 && <div className="px-2 text-sm text-slate-500">No proposals yet.</div>}
              {state.proposals.map((p) => (
                <button key={p.id} onClick={() => setSelected(p.id)} className={cn("w-full rounded-md border px-3 py-2 text-left hover:bg-slate-50", p.id === proposal?.id ? "border-teal-400 bg-teal-50/50" : "border-slate-200")}>
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-semibold">{p.id}</span><ResultBadge result={p.status} /></div>
                  <div className="mt-0.5 text-sm">{p.title}</div>
                </button>
              ))}
            </CardContent>
          </Card>
        </div>

        {proposal ? (
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div><CardTitle>{proposal.title}</CardTitle><CardDescription>{proposal.description}</CardDescription></div>
                <ResultBadge result={proposal.status} />
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <KV label="Proposal ID" mono>{proposal.id}</KV>
                <KV label="Creator">{user(proposal.creatorId)?.name}</KV>
                <KV label="Existing version">v{proposal.baseVersion}</KV>
                <KV label="Proposed version">v{proposal.proposedVersion}</KV>
                <KV label="Created">{fmtDateTime(proposal.createdAt)}</KV>
                <KV label="Type">{proposal.type === "EMERGENCY_PATHWAY" ? "Emergency pathway" : "Policy update"}</KV>
                <KV label="maxConsentDays">{base?.policy.maxConsentDays} → {proposal.policy.maxConsentDays}</KV>
                <KV label="emergencyPathway">{String(base?.policy.emergencyPathway)} → {String(proposal.policy.emergencyPathway)}</KV>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Validator votes</CardTitle>
                <CardDescription>Each button simulates that hospital&apos;s validator operator casting a vote. Offline nodes cannot vote. Approval threshold: {QUORUM} of 4.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {VALIDATORS.map((v) => {
                    const vote = proposal.votes[v];
                    const offline = state.nodeStatus[v] === "OFFLINE";
                    return (
                      <div key={v} className="rounded-md border border-slate-200 p-3">
                        <div className="flex items-center justify-between"><span className="text-sm font-semibold">{v}</span>{offline && <Badge>Offline</Badge>}</div>
                        <div className="mb-2 text-xs text-slate-500">{hospital(v)?.name}</div>
                        {vote ? (
                          <div><ResultBadge result={vote.vote} /><div className="mt-1 font-mono text-[11px] text-slate-500">{vote.eventId}</div></div>
                        ) : (
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="outline" disabled={busy || offline || proposal.status !== "OPEN"} onClick={() => run(() => actions.castVote(proposal.id, v, "APPROVE"), `${v} approved`)}><ThumbsUp />Approve</Button>
                            <Button size="sm" variant="outline" disabled={busy || offline || proposal.status !== "OPEN"} onClick={() => run(() => actions.castVote(proposal.id, v, "REJECT"), `${v} rejected`)}><ThumbsDown /></Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                  <span>Approvals: <b>{Object.values(proposal.votes).filter((x) => x?.vote === "APPROVE").length}</b> / {QUORUM} needed</span>
                  <span>Rejections: <b>{Object.values(proposal.votes).filter((x) => x?.vote === "REJECT").length}</b></span>
                  <span>Outcome: <ResultBadge result={proposal.status} /></span>
                </div>
                {proposal.status === "APPROVED" && (
                  <div className="mt-4 space-y-2">
                    {!hasPermission(session.role, "contract:deploy") && <RoleGate roles={["GOVERNANCE_ADMIN"]} purpose="deploy the approved version" />}
                    <Button disabled={busy || !hasPermission(session.role, "contract:deploy")} onClick={() => run(() => actions.deployProposal(proposal.id), `v${proposal.proposedVersion} deployed (simulated)`)}>
                      <Rocket /> Deploy v{proposal.proposedVersion} (simulated)
                    </Button>
                  </div>
                )}
                {proposal.status === "DEPLOYED" && (
                  <Explain tone="tip" className="mt-4">v{proposal.proposedVersion} is now active. <Link className="font-medium underline" href="/contracts">See the receipt in Contract Studio</Link>. Earlier versions are preserved.</Explain>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Contract version comparison</CardTitle><CardDescription>v{proposal.baseVersion} → v{proposal.proposedVersion}. Green lines are added, red lines removed. Baseline rules are unchanged.</CardDescription></CardHeader>
              <CardContent>{base && <DiffViewer from={base.code} to={generateContractCode(proposal.proposedVersion, proposal.policy)} />}</CardContent>
            </Card>
          </div>
        ) : (
          <EmptyState icon={GitBranch} title="No proposal selected">Create a proposal to start a vote.</EmptyState>
        )}
      </div>
    </div>
  );
}
