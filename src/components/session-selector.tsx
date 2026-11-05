"use client";

import { BadgeCheck, ChevronDown, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Hash, notify, useAction } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import { cn, fmtDateTime } from "@/lib/utils";

export function CredentialStatus({ userId }: { userId: string }) {
  const { state } = useApp();
  const v = state.verifications[userId];
  if (!v) return <Badge variant="pending"><ShieldQuestion className="size-3" />Not verified</Badge>;
  return v.verified ? <Badge variant="success"><BadgeCheck className="size-3" />Credential verified</Badge> : <Badge variant="danger"><ShieldAlert className="size-3" />Verification failed</Badge>;
}

export function SessionSelector() {
  const { state, session, actions, hospital } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { busy, run } = useAction();

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const h = hospital(session.hospitalId);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-left shadow-sm hover:bg-slate-50">
        <div className="flex size-8 items-center justify-center rounded-full bg-teal-600 text-xs font-semibold text-white">
          {session.name.replace("Dr. ", "").split(" ").map((p) => p[0]).join("").slice(0, 2)}
        </div>
        <div className="hidden sm:block">
          <div className="text-sm font-medium text-slate-900">{session.name}</div>
          <div className="text-xs text-slate-500">{ROLE_LABEL[session.role]}{h ? ` · ${h.id} ${h.name}` : ""}</div>
        </div>
        <ChevronDown className="size-4 text-slate-500" />
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,420px)] rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-4">
            <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">Signed in</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{session.name}</div>
            <div className="mt-2 grid gap-1 text-xs text-slate-600">
              <div>Role: {ROLE_LABEL[session.role]}</div>
              <div>Hospital: {h ? `${h.id} — ${h.name} (${h.status})` : "None"}</div>
              <div className="flex items-center gap-1">DID: <Hash value={session.did} n={18} /></div>
              {state.authentications[session.id] && <div>Authenticated {fmtDateTime(state.authentications[session.id].at)} · {state.authentications[session.id].eventId}</div>}
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <CredentialStatus userId={session.id} />
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => run(() => actions.verifyIdentity(session.id), (v) => (v.verified ? "Credential verified" : "Credential verification failed"))}
              >
                Verify credential
              </Button>
            </div>
          </div>
          <div className="max-h-80 overflow-auto p-2">
            <div className="px-2 py-1 text-xs font-medium tracking-wide text-slate-500 uppercase">Demo sign-in — choose a user</div>
            {state.users.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setOpen(false);
                  actions.signIn(u.id).then(() => notify(`Signed in as ${u.name}`, "info"));
                }}
                className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left hover:bg-slate-50", u.id === session.id && "bg-teal-50")}
              >
                <div>
                  <div className="text-sm font-medium text-slate-900">{u.name}</div>
                  <div className="text-xs text-slate-500">{ROLE_LABEL[u.role]}{u.hospitalId ? ` · ${u.hospitalId}` : ""}</div>
                </div>
                <CredentialStatus userId={u.id} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
