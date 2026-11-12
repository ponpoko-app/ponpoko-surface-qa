import type { AxNode } from "../src/contracts/qa";
import { readJson, runHands } from "./hands";

export function emptyNode(): AxNode {
  return { role: "AXApplication", label: "", value: "", rect: null, children: [] };
}

export async function readAxTree(
  dataDir: string,
  pid: number,
  maxNodes = 400,
  maxDepth = 12,
): Promise<{ node: AxNode; error: string | null }> {
  const run = await runHands(dataDir, ["axtree", String(pid), String(maxNodes), String(maxDepth)], 45_000);
  if (!run.ok) return { node: emptyNode(), error: run.error };
  return { node: readJson<AxNode>(run, emptyNode()), error: null };
}

export function flatten(node: AxNode, out: AxNode[] = []): AxNode[] {
  out.push(node);
  for (const child of node.children) flatten(child, out);
  return out;
}

export function countTree(tree: AxNode): { nodes: number; labelled: number; webArea: boolean } {
  const all = flatten(tree);
  let labelled = 0;
  let webArea = false;
  for (const node of all) {
    if (node.label.trim().length > 0 || node.value.trim().length > 0) labelled += 1;
    if (node.role.includes("AXWebArea")) webArea = true;
  }
  return { nodes: all.length, labelled, webArea };
}

export function findNode(tree: AxNode, match: (node: AxNode) => boolean): AxNode | null {
  if (match(tree)) return tree;
  for (const child of tree.children) {
    const found = findNode(child, match);
    if (found !== null) return found;
  }
  return null;
}

export async function hitTest(
  dataDir: string,
  pid: number,
  x: number,
  y: number,
): Promise<{ role: string; label: string } | null> {
  const run = await runHands(dataDir, ["hit", String(pid), String(Math.round(x)), String(Math.round(y))], 15_000);
  const parsed = readJson<{ found?: boolean; role?: string; label?: string }>(run, {});
  if (parsed.found !== true) return null;
  return { role: parsed.role ?? "", label: parsed.label ?? "" };
}
