// Algorithm 01: PBFT consensus — a deterministic, single-process simulation of four validator nodes.
import type { NodeStatus, PbftMessage, PbftNodeResult, PbftPhase, ValidatorId } from "./types";

export const VALIDATORS: ValidatorId[] = ["H1", "H2", "H3", "H4"];
export const N = VALIDATORS.length;
export const F = Math.floor((N - 1) / 3); // 1
export const QUORUM = 2 * F + 1; // 3

const BAD_DIGEST = "ffffbad0";

export interface PbftInput {
  view: number;
  digest: string;
  client: string; // the hospital submitting the transaction
  nodeStatus: Record<ValidatorId, NodeStatus>;
}

export function simulatePbft({ view: startView, digest, client, nodeStatus }: PbftInput) {
  const d = digest.slice(0, 8);
  const phases: PbftPhase[] = [];
  const honestOnline = VALIDATORS.filter((v) => nodeStatus[v] === "ONLINE");

  // Primary is chosen round-robin by view number. A primary that is offline or faulty triggers a view change.
  let view = startView;
  let primary: ValidatorId | null = VALIDATORS[view % N];
  const viewChanges: string[] = [];
  let attempts = 0;
  while (primary && nodeStatus[primary] !== "ONLINE" && attempts < N) {
    if (honestOnline.length < QUORUM) {
      primary = null;
      break;
    }
    viewChanges.push(`Primary ${primary} is ${nodeStatus[primary].toLowerCase()} — backups time out and vote for view ${view + 1}.`);
    view += 1;
    primary = VALIDATORS[view % N];
    attempts++;
  }

  phases.push({
    name: "REQUEST",
    title: "Client request",
    explanation: `${client} sends the approved transaction to the primary node. Its SHA-256 digest (${d}…) identifies it in every later message.`,
    messages: primary
      ? [{ from: client, to: VALIDATORS[startView % N], type: "REQUEST", digest: d, status: "DELIVERED" }]
      : [],
    summary: primary ? `Transaction submitted with digest ${d}…` : "No primary can be elected.",
  });

  if (viewChanges.length || !primary) {
    const msgs: PbftMessage[] = [];
    honestOnline.forEach((from) =>
      VALIDATORS.filter((t) => t !== from).forEach((to) =>
        msgs.push({ from, to, type: "VIEW-CHANGE", digest: `v${view}`, status: nodeStatus[to] === "OFFLINE" ? "DROPPED" : "DELIVERED" }),
      ),
    );
    phases.push({
      name: "VIEW-CHANGE",
      title: "View change",
      explanation: "The expected primary did not respond correctly, so the other nodes agree to move to the next view and a new primary.",
      messages: msgs,
      summary: primary
        ? `${viewChanges.join(" ")} New primary: ${primary} (view ${view}).`
        : `Only ${honestOnline.length} honest node(s) online — a view change needs ${QUORUM}. Consensus cannot proceed.`,
    });
  }

  const nodes: PbftNodeResult[] = VALIDATORS.map((id) => ({
    id,
    status: nodeStatus[id],
    isPrimary: id === primary,
    receivedPrePrepare: false,
    matchingPrepares: 0,
    prepared: false,
    matchingCommits: 0,
    committed: false,
    response: "",
  }));
  const node = (id: ValidatorId) => nodes.find((n) => n.id === id)!;
  const reachable = (to: ValidatorId) => nodeStatus[to] !== "OFFLINE";

  if (primary) {
    // PRE-PREPARE: primary assigns the sequence number and broadcasts.
    const pre: PbftMessage[] = VALIDATORS.filter((v) => v !== primary).map((to) => ({
      from: primary!, to, type: "PRE-PREPARE" as const, digest: d, status: reachable(to) ? ("DELIVERED" as const) : ("DROPPED" as const),
    }));
    node(primary).receivedPrePrepare = true;
    pre.forEach((m) => { if (m.status === "DELIVERED") node(m.to as ValidatorId).receivedPrePrepare = true; });
    phases.push({
      name: "PRE-PREPARE",
      title: "Pre-prepare",
      explanation: `Primary ${primary} assigns a sequence number and broadcasts <PRE-PREPARE, view ${view}, digest> to the three backups.`,
      messages: pre,
      summary: `${pre.filter((m) => m.status === "DELIVERED").length} of ${pre.length} backups received the pre-prepare.`,
    });

    // PREPARE: each backup that accepted the pre-prepare broadcasts PREPARE. Faulty nodes send a wrong digest.
    const prep: PbftMessage[] = [];
    const backups = VALIDATORS.filter((v) => v !== primary && node(v).receivedPrePrepare);
    backups.forEach((from) => {
      const faulty = nodeStatus[from] === "FAULTY";
      VALIDATORS.filter((t) => t !== from).forEach((to) =>
        prep.push({ from, to, type: "PREPARE", digest: faulty ? BAD_DIGEST : d, status: !reachable(to) ? "DROPPED" : faulty ? "MISMATCH" : "DELIVERED" }),
      );
    });
    nodes.forEach((n) => {
      if (n.status !== "ONLINE") return;
      const own = !n.isPrimary && backups.includes(n.id) ? 1 : 0;
      n.matchingPrepares = own + prep.filter((m) => m.to === n.id && m.status === "DELIVERED").length;
      n.prepared = n.receivedPrePrepare && n.matchingPrepares >= 2 * F;
    });
    phases.push({
      name: "PREPARE",
      title: "Prepare",
      explanation: `Backups echo the digest to every node. A node is "prepared" once it holds the pre-prepare plus 2f = ${2 * F} matching PREPARE messages.`,
      messages: prep,
      summary: `${nodes.filter((n) => n.prepared).length} node(s) prepared.`,
    });

    // COMMIT: prepared nodes broadcast COMMIT; a node commits locally with 2f + 1 matching commits (including its own).
    const com: PbftMessage[] = [];
    const committers = nodes.filter((n) => n.prepared || (n.status === "FAULTY" && n.receivedPrePrepare));
    committers.forEach((c) => {
      const faulty = c.status === "FAULTY";
      VALIDATORS.filter((t) => t !== c.id).forEach((to) =>
        com.push({ from: c.id, to, type: "COMMIT", digest: faulty ? BAD_DIGEST : d, status: !reachable(to) ? "DROPPED" : faulty ? "MISMATCH" : "DELIVERED" }),
      );
    });
    nodes.forEach((n) => {
      if (n.status !== "ONLINE") return;
      n.matchingCommits = (n.prepared ? 1 : 0) + com.filter((m) => m.to === n.id && m.status === "DELIVERED").length;
      n.committed = n.prepared && n.matchingCommits >= QUORUM;
    });
    phases.push({
      name: "COMMIT",
      title: "Commit",
      explanation: `Prepared nodes broadcast COMMIT. A node commits once it sees 2f + 1 = ${QUORUM} matching commits, guaranteeing every honest node agrees on the same order.`,
      messages: com,
      summary: `${nodes.filter((n) => n.committed).length} node(s) reached the commit threshold of ${QUORUM}.`,
    });
  }

  const committedCount = nodes.filter((n) => n.committed).length;
  const outcome: "COMMITTED" | "FAILED" = committedCount >= QUORUM ? "COMMITTED" : "FAILED";
  nodes.forEach((n) => {
    n.response =
      n.status === "OFFLINE" ? "No response (offline)"
      : n.status === "FAULTY" ? "Sent conflicting digest — ignored by honest nodes"
      : n.committed ? "COMMITTED — replied to client"
      : n.prepared ? "Prepared but commit threshold not reached"
      : "Could not prepare";
  });
  phases.push({
    name: "REPLY",
    title: "Reply and decision",
    explanation: `Committed nodes reply to ${client}. With ${QUORUM} or more committed replicas the transaction is final and written to a block.`,
    messages: nodes.filter((n) => n.committed).map((n) => ({ from: n.id, to: client, type: "REPLY" as const, digest: d, status: "DELIVERED" as const })),
    summary:
      outcome === "COMMITTED"
        ? `Consensus reached: ${committedCount}/${N} nodes committed (threshold ${QUORUM}).`
        : `Consensus failed: only ${committedCount}/${N} nodes committed (threshold ${QUORUM}). The transaction is not committed.`,
  });

  return {
    view,
    primary,
    phases,
    nodes,
    committedCount,
    outcome,
    outcomeReason: phases[phases.length - 1].summary,
  };
}
