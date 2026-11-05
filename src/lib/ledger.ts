import { canonicalize, sha256, ZERO_HASH } from "./crypto";
import type { LedgerEvent } from "./types";

// Everything except the two hash fields goes into the hashed payload.
export function canonicalEventPayload(e: LedgerEvent): string {
  const { previousHash: _p, currentHash: _c, ...rest } = e;
  void _p;
  void _c;
  return canonicalize(rest);
}

// currentHash = SHA256(previousHash + canonicalEventPayload)
export async function computeEventHash(previousHash: string, e: LedgerEvent) {
  return sha256(previousHash + canonicalEventPayload(e));
}

// Fill in previousHash/currentHash for every event from `from` onward.
export async function sealEvents(ledger: LedgerEvent[], from: number) {
  for (let i = from; i < ledger.length; i++) {
    const prev = i === 0 ? ZERO_HASH : ledger[i - 1].currentHash;
    ledger[i].previousHash = prev;
    ledger[i].currentHash = await computeEventHash(prev, ledger[i]);
  }
}

export interface LedgerVerification {
  valid: boolean;
  checked: number;
  at: string;
  failure?: {
    index: number;
    eventId: string;
    reason: string;
    expected: string;
    stored: string;
  };
}

export async function verifyLedger(ledger: LedgerEvent[]): Promise<LedgerVerification> {
  const at = new Date().toISOString();
  for (let i = 0; i < ledger.length; i++) {
    const e = ledger[i];
    const expectedPrev = i === 0 ? ZERO_HASH : ledger[i - 1].currentHash;
    if (e.previousHash !== expectedPrev) {
      return {
        valid: false,
        checked: i + 1,
        at,
        failure: { index: i, eventId: e.id, reason: "previousHash does not match the hash of the event before it", expected: expectedPrev, stored: e.previousHash },
      };
    }
    const recomputed = await computeEventHash(e.previousHash, e);
    if (recomputed !== e.currentHash) {
      return {
        valid: false,
        checked: i + 1,
        at,
        failure: { index: i, eventId: e.id, reason: "Event contents changed after it was recorded — recomputed hash differs from the stored hash", expected: recomputed, stored: e.currentHash },
      };
    }
  }
  return { valid: true, checked: ledger.length, at };
}

export function ledgerToCsv(ledger: LedgerEvent[]) {
  const cols: (keyof LedgerEvent)[] = [
    "index", "id", "txId", "requestId", "timestamp", "kind", "actor", "actorRole", "actorDid", "hospitalId", "action", "result", "explanation",
    "contractVersion", "blockId", "previousHash", "currentHash", "details",
  ];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...ledger.map((e) => cols.map((c) => esc(e[c])).join(","))].join("\n");
}
