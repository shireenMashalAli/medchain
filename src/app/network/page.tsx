"use client";

import { Check, CheckCircle2, Minus, XCircle } from "lucide-react";
import { useState } from "react";
import { Explain, Hash, PageHeader, ResultBadge, useAction } from "@/components/common";
import { CredentialStatus } from "@/components/session-selector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { trustedIssuers } from "@/lib/identity";
import { PERMISSION_LABEL, RBAC, ROLE_LABEL } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { Permission, Role, User } from "@/lib/types";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export default function NetworkPage() {
  const { state, actions, hospital } = useApp();
  const { busy, run } = useAction();
  const [vcUser, setVcUser] = useState<User | null>(null);
  const permissions = Object.keys(PERMISSION_LABEL) as Permission[];
  const issuers = trustedIssuers(state.hospitals);

  return (
    <div className="space-y-6">
      <PageHeader title="Network & Identities" description="Who is in the consortium, how each person proves who they are, and what each role is allowed to do." />

      <div className="grid gap-4 md:grid-cols-3">
        <Explain title="DID — decentralised identifier">A unique ID such as <code>did:medchain:…</code> that its owner controls. It points to a DID document holding a public key, so anyone can check a signature without asking a central server.</Explain>
        <Explain title="Verifiable Credential">A digitally signed statement, e.g. “City Hospital certifies Dr. Siddiqui is a physician”. Verifying it checks the issuer is trusted, the content wasn&apos;t changed, and it hasn&apos;t expired or been revoked.</Explain>
        <Explain title="RBAC — role-based access control">Permissions belong to roles, not people. A physician can create requests but cannot release records; a records officer can release but cannot change the contract.</Explain>
      </div>

      <Card>
        <CardHeader><CardTitle>Hospital network</CardTitle><CardDescription>Four authorised validator nodes plus one unregistered external hospital used for testing.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="px-4 py-2">ID</th><th className="px-4 py-2">Hospital</th><th className="px-4 py-2">DID</th><th className="px-4 py-2">Registry status</th><th className="px-4 py-2">Validator</th><th className="px-4 py-2">Node</th><th className="px-4 py-2">Trusted issuer</th></tr></thead>
            <tbody>
              {state.hospitals.map((h) => (
                <tr key={h.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 font-semibold">{h.id}</td>
                  <td className="px-4 py-2">{h.name}<div className="text-xs text-slate-500">{h.city}</div></td>
                  <td className="px-4 py-2"><Hash value={h.did} n={14} /></td>
                  <td className="px-4 py-2"><Badge variant={h.status === "ACTIVE" ? "success" : "danger"}>{h.status.replace("_", " ")}</Badge></td>
                  <td className="px-4 py-2">{h.validator ? "Yes" : "No"}</td>
                  <td className="px-4 py-2">{h.validator ? <ResultBadge result={state.nodeStatus[h.id as "H1"]} /> : "—"}</td>
                  <td className="px-4 py-2">{issuers.includes(h.did) ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-500" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>People, DIDs and credentials</CardTitle><CardDescription>Verifying a credential records a CREDENTIAL_VERIFIED event. Signing in records AUTHENTICATION_VERIFIED, CREDENTIAL_VERIFIED and HOSPITAL_VERIFIED. Rule 1 of the contract relies on this result.</CardDescription></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {state.users.map((u) => {
            const v = state.verifications[u.id];
            const h = hospital(u.hospitalId);
            return (
              <div key={u.id} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{u.name}</div>
                    <div className="text-xs text-slate-500">{ROLE_LABEL[u.role]}{h ? ` · ${h.id} ${h.name}` : ""}</div>
                  </div>
                  <CredentialStatus userId={u.id} />
                </div>
                <div className="mt-2 text-xs"><Hash value={u.did} n={16} /></div>
                <div className="mt-1 text-xs text-slate-500">Issuer: {u.credential.issuer}</div>
                {v && <div className="mt-1 text-[11px] text-slate-500">Last verified {fmtDateTime(v.verifiedAt)} · {v.eventId}</div>}
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => actions.verifyIdentity(u.id), (r) => (r.verified ? `${u.name}: verified` : `${u.name}: verification failed`))}>Verify credential</Button>
                  <Button size="sm" variant="ghost" onClick={() => setVcUser(u)}>View credential</Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>RBAC permission matrix</CardTitle><CardDescription>Fixed for the demonstration. Rule 1 checks <code>role.hasPermission</code> against this table.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr><th className="px-4 py-2">Permission</th>{(Object.keys(RBAC) as Role[]).map((r) => <th key={r} className="px-3 py-2 text-center">{ROLE_LABEL[r]}</th>)}</tr>
            </thead>
            <tbody>
              {permissions.map((p) => (
                <tr key={p} className="border-t border-slate-100">
                  <td className="px-4 py-2"><div>{PERMISSION_LABEL[p]}</div><div className="font-mono text-[11px] text-slate-400">{p}</div></td>
                  {(Object.keys(RBAC) as Role[]).map((r) => (
                    <td key={r} className="px-3 py-2 text-center">{RBAC[r].includes(p) ? <Check className="mx-auto size-4 text-emerald-600" /> : <Minus className="mx-auto size-4 text-slate-300" />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!vcUser} onClose={() => setVcUser(null)} title={`Verifiable credential — ${vcUser?.name ?? ""}`}>
        {vcUser && (
          <div className="space-y-3">
            <div className="text-xs text-slate-600">Issued {fmtDate(vcUser.credential.issuedAt)} · expires {fmtDate(vcUser.credential.expiresAt)} · proof is SHA-256 of the canonical credential body (a simulated signature).</div>
            <pre className="max-h-80 overflow-auto rounded-md bg-slate-900 p-3 text-[11px] text-slate-200">{JSON.stringify(vcUser.credential, null, 2)}</pre>
            {state.verifications[vcUser.id] && (
              <div className="space-y-1">
                {state.verifications[vcUser.id].checks.map((c) => (
                  <div key={c.label} className="flex items-center gap-2 text-sm">{c.passed ? <CheckCircle2 className="size-4 text-emerald-600" /> : <XCircle className="size-4 text-red-600" />}{c.label}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
