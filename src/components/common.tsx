"use client";

import { AlertTriangle, CheckCircle2, Copy, FlaskConical, Info, Lightbulb, UserCog, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROLE_LABEL } from "@/lib/rbac";
import { useApp } from "@/lib/store";
import type { HospitalId, RequestStatus, Role } from "@/lib/types";
import { cn, humanize, shortHash } from "@/lib/utils";

// ---------- toasts ----------
type ToastMsg = { id: number; text: string; tone: "success" | "error" | "info" };
const TOAST_EVENT = "medchain-toast";

export function notify(text: string, tone: ToastMsg["tone"] = "success") {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { text, tone } }));
}

export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const { text, tone } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs, { id, text, tone }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);
  return (
    <div className="fixed bottom-16 left-4 z-[60] flex w-80 flex-col gap-2 lg:left-[272px] xl:bottom-4" aria-live="polite">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "flex items-start gap-2 rounded-md border bg-white px-3 py-2 text-sm shadow-lg",
            t.tone === "error" ? "border-red-200 text-red-800" : t.tone === "info" ? "border-blue-200 text-blue-800" : "border-emerald-200 text-emerald-800",
          )}
        >
          {t.tone === "error" ? <XCircle className="mt-0.5 size-4 shrink-0" /> : t.tone === "info" ? <Info className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

// Runs an async action, tracks busy state, and turns thrown errors into toasts.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string)): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) notify(typeof success === "function" ? success(r) : success);
      return r;
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

// ---------- layout bits ----------
export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Explain({ title, children, tone = "info", className }: { title?: string; children: React.ReactNode; tone?: "info" | "tip" | "warn"; className?: string }) {
  const Icon = tone === "tip" ? Lightbulb : tone === "warn" ? AlertTriangle : Info;
  return (
    <div
      className={cn(
        "flex gap-3 rounded-md border px-4 py-3 text-sm",
        tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "tip" ? "border-teal-200 bg-teal-50 text-teal-900" : "border-blue-200 bg-blue-50 text-blue-900",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <div>
        {title && <div className="font-semibold">{title}</div>}
        <div className={cn(title && "mt-0.5", "leading-relaxed")}>{children}</div>
      </div>
    </div>
  );
}

export function SimulationTag({ children = "Simulation" }: { children?: React.ReactNode }) {
  return (
    <Badge variant="violet" className="normal-case tracking-normal">
      <FlaskConical className="size-3" />
      {children}
    </Badge>
  );
}

export function Hash({ value, n = 10, className }: { value: string | null | undefined; n?: number; className?: string }) {
  if (!value) return <span className="text-slate-400">—</span>;
  return (
    <button
      title={`${value} (click to copy)`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => notify("Copied to clipboard", "info"), () => undefined);
      }}
      className={cn("inline-flex items-center gap-1 font-mono text-xs text-slate-600 hover:text-teal-700", className)}
    >
      {shortHash(value, n)}
      <Copy className="size-3 opacity-50" />
    </button>
  );
}

export function KV({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={cn("mt-0.5 truncate text-sm text-slate-900", mono && "font-mono text-xs")}>{children}</div>
    </div>
  );
}

const STATUS_TONE: Record<RequestStatus, "neutral" | "success" | "pending" | "danger" | "info" | "teal"> = {
  SUBMITTED: "info",
  RECEIVED: "info",
  UNDER_REVIEW: "pending",
  CONSENT_CHECKED: "pending",
  CONTRACT_PENDING: "pending",
  DENIED: "danger",
  CONTRACT_APPROVED: "teal",
  PBFT_IN_PROGRESS: "pending",
  CONSENSUS_FAILED: "danger",
  HOSPITAL_APPROVED: "teal",
  COMMITTED: "teal",
  RELEASED: "success",
  REJECTED: "danger",
};

const STATUS_LABEL: Partial<Record<RequestStatus, string>> = {
  CONSENT_CHECKED: "Verified by hospital",
  CONTRACT_PENDING: "Contract executing",
  CONTRACT_APPROVED: "Contract approved — awaiting hospital",
  HOSPITAL_APPROVED: "Hospital approved",
  COMMITTED: "Consensus committed",
  DENIED: "Denied by contract",
  REJECTED: "Rejected by hospital",
};

export function RequestStatusBadge({ status }: { status: RequestStatus }) {
  return <Badge variant={STATUS_TONE[status]}>{STATUS_LABEL[status] ?? humanize(status)}</Badge>;
}

export function resultTone(result: string): "success" | "danger" | "pending" | "neutral" | "info" {
  const r = result.toUpperCase();
  if (/(FAIL|DENY|DENIED|INVALID|REVOKED|REJECT|NOT|WITHHELD|OFFLINE|FAULTY|ALTERED)/.test(r)) return "danger";
  if (/(PENDING|OPEN|DRAFT|SUPERSEDED|UNDER_REVIEW)/.test(r)) return "pending";
  if (/(PASS|OK|APPROVE|GRANTED|VERIFIED|VALID|COMMITTED|ACTIVE|RELEASED|REGISTERED|FOUND|ONLINE|DEPLOYED|RECEIVED)/.test(r)) return "success";
  return "neutral";
}

export function ResultBadge({ result }: { result: string }) {
  return <Badge variant={resultTone(result)}>{result}</Badge>;
}

export function PassFail({ pass, label }: { pass: boolean; label?: string }) {
  return pass ? (
    <Badge variant="success"><CheckCircle2 className="size-3" />{label ?? "Pass"}</Badge>
  ) : (
    <Badge variant="danger"><XCircle className="size-3" />{label ?? "Fail"}</Badge>
  );
}

// Shows who the current session is and, if they lack the needed role, offers a one-click switch.
export function RoleGate({ roles, hospitalId, purpose, children }: { roles: Role[]; hospitalId?: HospitalId; purpose: string; children?: React.ReactNode }) {
  const { session, state, actions } = useApp();
  const ok = roles.includes(session.role) && (!hospitalId || session.hospitalId === hospitalId);
  if (ok) return <>{children}</>;
  const candidates = state.users.filter((u) => roles.includes(u.role) && (!hospitalId || u.hospitalId === hospitalId));
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <UserCog className="size-4 shrink-0" />
      <span className="flex-1">
        You are signed in as <b>{session.name}</b> ({ROLE_LABEL[session.role]}). To {purpose}, sign in as a{" "}
        {roles.map((r) => ROLE_LABEL[r]).join(" / ")}
        {hospitalId ? ` at ${hospitalId}` : ""}. (RBAC)
      </span>
      {candidates.slice(0, 3).map((u) => (
        <Button key={u.id} size="sm" variant="outline" onClick={() => actions.signIn(u.id).then(() => notify(`Signed in as ${u.name}`, "info"))}>
          Sign in as {u.name}
        </Button>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center">
      <Icon className="size-8 text-slate-400" />
      <div className="mt-2 text-sm font-medium text-slate-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}
