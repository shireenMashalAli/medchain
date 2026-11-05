"use client";

import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Explain, Hash, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox, Label, Select } from "@/components/ui/form";
import { canonicalize, sha256 } from "@/lib/crypto";
import { buildMerkleTree, getMerkleProof, verifyMerkleProof, type MerkleLevels } from "@/lib/merkle";
import { useApp } from "@/lib/store";
import { cn } from "@/lib/utils";

const SYNTHETIC = [
  { id: "SYN-01", action: "CONSENT_GRANTED", actor: "Patient P-9001", result: "ACTIVE" },
  { id: "SYN-02", action: "REQUEST_CREATED", actor: "Dr. Test (H1)", result: "SUBMITTED" },
  { id: "SYN-03", action: "RULE_1_EVALUATED", actor: "Officer (H2)", result: "PASS" },
  { id: "SYN-04", action: "RULE_2_EVALUATED", actor: "Officer (H2)", result: "PASS" },
  { id: "SYN-05", action: "RULE_3_EVALUATED", actor: "Officer (H2)", result: "PASS" },
  { id: "SYN-06", action: "HOSPITAL_APPROVED", actor: "Officer (H2)", result: "APPROVED" },
  { id: "SYN-07", action: "ACCESS_GRANTED", actor: "Officer (H2)", result: "GRANTED" },
  { id: "SYN-08", action: "MEDICAL_RECORD_RELEASED", actor: "Officer (H2)", result: "RELEASED" },
];

type Source = "synthetic" | "latest" | string; // string = block id

export default function MerklePage() {
  const { state } = useApp();
  const [source, setSource] = useState<Source>("synthetic");
  const [leafIdx, setLeafIdx] = useState(2);
  const [tamper, setTamper] = useState(false);
  const [levels, setLevels] = useState<MerkleLevels | null>(null);
  const [tamperedLeaf, setTamperedLeaf] = useState<string | null>(null);
  const [verification, setVerification] = useState<{ valid: boolean; computedRoot: string; trail: string[] } | null>(null);

  const block = state.blocks.find((b) => b.id === source);
  const items = useMemo(() => {
    if (source === "synthetic") return SYNTHETIC.map((s) => ({ label: `${s.id} ${s.action}`, payload: s as Record<string, string>, hash: null as string | null }));
    const events = source === "latest" ? state.ledger.slice(-8) : state.ledger.filter((e) => block?.eventHashes.includes(e.currentHash));
    if (block && events.length !== block.eventHashes.length) {
      return block.eventHashes.map((h, i) => ({ label: `leaf ${i}`, payload: null, hash: h }));
    }
    return events.map((e) => ({ label: `${e.id} ${e.action}`, payload: null, hash: e.currentHash }));
  }, [source, state.ledger, block]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const leaves = await Promise.all(items.map(async (it) => it.hash ?? (await sha256(canonicalize(it.payload)))));
      const lv = await buildMerkleTree(leaves);
      if (!cancelled) { setLevels(lv); setVerification(null); }
    })();
    return () => { cancelled = true; };
  }, [items]);

  const safeIdx = Math.min(leafIdx, Math.max(items.length - 1, 0));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const it = items[safeIdx];
      if (!tamper || !it) { setTamperedLeaf(null); return; }
      const altered = it.payload ? { ...it.payload, result: "ALTERED" } : `${it.hash}-altered`;
      const h = await sha256(canonicalize(altered));
      if (!cancelled) setTamperedLeaf(h);
    })();
    return () => { cancelled = true; };
  }, [tamper, safeIdx, items]);

  if (!levels) return <div className="text-sm text-slate-500">Building tree…</div>;
  const root = levels[levels.length - 1][0];
  const proof = getMerkleProof(levels, safeIdx);

  // indices on the path from the selected leaf to the root, per level
  const pathIdx = levels.map((_, l) => Math.floor(safeIdx / 2 ** l));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Merkle Audit Proofs"
        description="A Merkle tree hashes events in pairs, level by level, down to a single root. To prove one event is included you only need its sibling hashes along the path, not the whole log."
      />

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div className="w-72">
            <Label htmlFor="m-src">Leaf data</Label>
            <Select id="m-src" value={source} onChange={(e) => { setSource(e.target.value); setLeafIdx(0); setTamper(false); }}>
              <option value="synthetic">Synthetic sample (8 events)</option>
              <option value="latest">Latest 8 ledger events</option>
              {state.blocks.map((b) => <option key={b.id} value={b.id}>{b.id} — {b.label}</option>)}
            </Select>
          </div>
          <div className="w-72">
            <Label htmlFor="m-leaf">Event to prove</Label>
            <Select id="m-leaf" value={safeIdx} onChange={(e) => { setLeafIdx(Number(e.target.value)); setVerification(null); }}>
              {items.map((it, i) => <option key={i} value={i}>{i}: {it.label}</option>)}
            </Select>
          </div>
          <Checkbox checked={tamper} onChange={(e) => { setTamper(e.target.checked); setVerification(null); }} label="Tamper with the selected event" />
          <Button
            onClick={async () => {
              const leaf = tamperedLeaf ?? levels[0][safeIdx];
              setVerification(await verifyMerkleProof(leaf, proof, root));
            }}
          >
            <ShieldCheck /> Verify proof
          </Button>
        </CardContent>
      </Card>

      {block && (
        <Explain tone={block.merkleRoot === root ? "tip" : "warn"} title={`Block ${block.id} stored root`}>
          {block.merkleRoot === root ? "Recomputed root matches the root stored in the block." : "Recomputed root does not match the block's stored root."} Stored: <span className="font-mono">{block.merkleRoot.slice(0, 16)}…</span>
        </Explain>
      )}

      <Card>
        <CardHeader><CardTitle>Tree</CardTitle><CardDescription>Bottom row = leaf hashes. Each parent = SHA256(left + right). An odd node is paired with itself. Blue = path to the root, amber = proof siblings.</CardDescription></CardHeader>
        <CardContent className="space-y-3 overflow-x-auto">
          {[...levels].reverse().map((level, ri) => {
            const l = levels.length - 1 - ri;
            return (
              <div key={l} className="flex items-center gap-3">
                <div className="w-20 shrink-0 text-xs text-slate-500">{l === levels.length - 1 ? "Root" : l === 0 ? "Leaves" : `Level ${l}`}</div>
                <div className="flex flex-1 justify-around gap-2">
                  {level.map((h, i) => {
                    const onPath = pathIdx[l] === i;
                    const isSibling = proof[l] && ((pathIdx[l] % 2 === 0 && i === pathIdx[l] + 1) || (pathIdx[l] % 2 === 1 && i === pathIdx[l] - 1));
                    return (
                      <div key={i} title={h} className={cn("min-w-24 rounded-md border px-2 py-1.5 text-center font-mono text-[11px]", onPath ? "border-blue-400 bg-blue-50 text-blue-900" : isSibling ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600")}>
                        {h.slice(0, 8)}
                        {l === 0 && <div className="mt-0.5 truncate font-sans text-[10px] text-slate-500">{items[i]?.label.split(" ")[0]}</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="pt-1 text-xs text-slate-600">Merkle root: <Hash value={root} n={20} /></div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Proof for leaf {safeIdx}</CardTitle><CardDescription>{proof.length} sibling hash{proof.length === 1 ? "" : "es"} for {items.length} leaves</CardDescription></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>Leaf hash: <Hash value={tamperedLeaf ?? levels[0][safeIdx]} n={14} /> {tamperedLeaf && <span className="text-xs text-red-600">(tampered)</span>}</div>
            <ol className="space-y-1">
              {proof.map((s, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-14 text-slate-500">Level {s.level}</span>
                  <span className="w-28 text-slate-600">sibling on {s.position}</span>
                  <Hash value={s.sibling} n={12} />
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Verification outcome</CardTitle></CardHeader>
          <CardContent>
            {!verification ? (
              <div className="text-sm text-slate-500">Press Verify proof to recompute the root from the leaf and its siblings.</div>
            ) : (
              <div className={cn("rounded-md border p-3 text-sm", verification.valid ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900")}>
                <div className="flex items-center gap-2 font-semibold">{verification.valid ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}{verification.valid ? "Proof valid — event is included" : "Proof invalid — event was altered or is not in this tree"}</div>
                <div className="mt-2 space-y-0.5 font-mono text-[11px]">
                  {verification.trail.map((h, i) => <div key={i}>{i === 0 ? "leaf " : `step ${i}`} → {h.slice(0, 24)}…</div>)}
                  <div className="pt-1">expected root → {root.slice(0, 24)}…</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
