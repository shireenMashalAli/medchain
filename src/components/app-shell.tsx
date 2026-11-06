"use client";

import {
  Blocks, BookOpenCheck, FileCode2, GitBranch, Hospital, LayoutDashboard, Loader2, Menu, Network, Radio, Workflow, ScrollText, ShieldCheck, Users, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";
import { Toaster } from "@/components/common";
import { LiveLedger } from "@/components/live-ledger";
import { SessionSelector } from "@/components/session-selector";
import { StoreProvider, useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/", label: "Request Workflow", icon: Workflow },
  { href: "/guided", label: "Guided Demonstration", icon: BookOpenCheck },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/patient", label: "Patient Portal", icon: Users },
  { href: "/requests", label: "Hospital Requests", icon: Hospital },
  { href: "/contracts", label: "Contract Studio", icon: FileCode2 },
  { href: "/pbft", label: "PBFT Network", icon: Network },
  { href: "/governance", label: "Governance", icon: GitBranch },
  { href: "/ledger", label: "Transaction & Audit Ledger", icon: ScrollText },
  { href: "/network", label: "Network & Identities", icon: ShieldCheck },
  { href: "/merkle", label: "Merkle Audit Proofs", icon: Blocks },
];

function ActiveNavList({ onNavigate }: { onNavigate?: () => void }) {
  return <NavList pathname={usePathname()} onNavigate={onNavigate} />;
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="flex-1 space-y-0.5 px-3">
      {NAV.map((item, i) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active ? "bg-white/10 font-medium text-white" : "hover:bg-white/5 hover:text-white",
              )}
            >
              <span className="w-4 text-right text-[11px] text-slate-500">{i + 1}</span>
              <item.icon className={cn("size-4", active ? "text-teal-300" : "text-slate-400")} />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex h-full flex-col bg-[#0b1d36] text-slate-300">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex size-8 items-center justify-center rounded-md bg-teal-500 text-white">
          <ShieldCheck className="size-5" />
        </div>
        <div>
          <div className="text-sm font-semibold text-white">MedChain</div>
          <div className="text-[11px] text-slate-400">Healthcare governance</div>
        </div>
      </div>
      <Suspense fallback={<NavList pathname="" />}>
        <ActiveNavList onNavigate={onNavigate} />
      </Suspense>
      <div className="m-3 rounded-md border border-white/10 p-3 text-[11px] leading-relaxed text-slate-400">
        Academic demonstration. Blockchain, PBFT and deployment are simulated in your browser. All patient data is synthetic.
      </div>
    </nav>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  if (!state)
    return (
      <div className="flex h-64 items-center justify-center gap-2 text-sm text-slate-500">
        <Loader2 className="size-4 animate-spin" /> Initialising ledger and hashing genesis block…
      </div>
    );
  return <>{children}</>;
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { state } = useStore();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-8">
      <div className="flex items-center gap-2">
        <button onClick={onMenu} className="rounded p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open navigation">
          <Menu className="size-5" />
        </button>
        <span className="text-sm font-medium text-slate-700">
          MedChain<span className="hidden md:inline"> — Blockchain Governance System for Healthcare</span>
        </span>
      </div>
      {state && <SessionSelector />}
    </header>
  );
}

function LedgerToggle({ onOpen }: { onOpen: () => void }) {
  const { state } = useStore();
  if (!state) return null;
  return (
    <button onClick={onOpen} className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-[#0b1d36] px-4 py-2.5 text-sm font-medium text-white shadow-lg min-[1200px]:hidden">
      <Radio className="size-4 text-teal-300" /> Live ledger ({state.ledger.length})
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  return (
    <StoreProvider>
      <div className="flex min-h-screen bg-slate-50">
        <aside className="fixed inset-y-0 left-0 hidden w-64 lg:block">
          <Sidebar />
        </aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-64">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
              <button onClick={() => setMobileOpen(false)} className="absolute top-4 right-3 text-slate-300" aria-label="Close navigation">
                <X className="size-5" />
              </button>
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-64 min-[1200px]:pr-[320px] 2xl:pr-[360px]">
          <TopBar onMenu={() => setMobileOpen(true)} />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8">
            <Gate>{children}</Gate>
          </main>
        </div>
        {/* Right: permanent live ledger on wide screens, a drawer on smaller ones */}
        <aside className="fixed inset-y-0 right-0 hidden w-[320px] border-l border-slate-200 min-[1200px]:block 2xl:w-[360px]">
          <LiveLedger />
        </aside>
        {ledgerOpen && (
          <div className="fixed inset-0 z-50 min-[1200px]:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setLedgerOpen(false)} />
            <div className="absolute inset-y-0 right-0 w-[min(92vw,380px)] shadow-xl">
              <LiveLedger onClose={() => setLedgerOpen(false)} />
            </div>
          </div>
        )}
        <LedgerToggle onOpen={() => setLedgerOpen(true)} />
      </div>
      <Toaster />
    </StoreProvider>
  );
}
