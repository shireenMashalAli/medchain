// Algorithm 03: Merkle-tree audit proofs.
import { sha256, ZERO_HASH } from "./crypto";

export type MerkleLevels = string[][]; // levels[0] = leaves, last level = [root]

export async function buildMerkleTree(leaves: string[]): Promise<MerkleLevels> {
  if (leaves.length === 0) return [[ZERO_HASH]];
  const levels: MerkleLevels = [leaves];
  let level = leaves;
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] ?? level[i]; // odd count: duplicate the last node
      next.push(await sha256(left + right));
    }
    levels.push(next);
    level = next;
  }
  return levels;
}

export async function merkleRoot(leaves: string[]) {
  const levels = await buildMerkleTree(leaves);
  return levels[levels.length - 1][0];
}

export interface ProofStep {
  sibling: string;
  position: "left" | "right"; // where the sibling sits when hashing
  level: number;
}

export function getMerkleProof(levels: MerkleLevels, leafIndex: number): ProofStep[] {
  const proof: ProofStep[] = [];
  let idx = leafIndex;
  for (let l = 0; l < levels.length - 1; l++) {
    const level = levels[l];
    const isRight = idx % 2 === 1;
    const siblingIdx = isRight ? idx - 1 : idx + 1;
    proof.push({ sibling: level[siblingIdx] ?? level[idx], position: isRight ? "left" : "right", level: l });
    idx = Math.floor(idx / 2);
  }
  return proof;
}

export async function verifyMerkleProof(leaf: string, proof: ProofStep[], root: string) {
  let hash = leaf;
  const trail: string[] = [hash];
  for (const step of proof) {
    hash = step.position === "left" ? await sha256(step.sibling + hash) : await sha256(hash + step.sibling);
    trail.push(hash);
  }
  return { valid: hash === root, computedRoot: hash, trail };
}
