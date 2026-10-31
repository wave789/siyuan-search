import type { IndexedBlock } from "../api.ts";
import type { TextMatch } from "./matcher.ts";

export interface SearchHit { block: IndexedBlock; match: TextMatch; ordinal: number }
export interface ResultBranch {
  key: string; kind: "notebook" | "directory" | "document"; label: string; path: string;
  count: number; first: number; children: ResultBranch[]; hits: number[];
}

/** IDs distinguish notebooks and documents even when their visible names are identical. */
export function buildResultTree(hits: readonly SearchHit[], notebooks: ReadonlyMap<string, string>): ResultBranch[] {
  const roots: ResultBranch[] = [], branches = new Map<string, ResultBranch>();
  hits.forEach((hit, index) => {
    const block = hit.block, parts = (block.hpath || "").split("/").filter(Boolean);
    const name = parts.pop() || (block.type === "d" ? block.content : "") || "未命名文档";
    const notebook = notebooks.get(block.box) || block.box || "笔记本";
    let siblings = roots, path = notebook;
    const add = (key: string, kind: ResultBranch["kind"], label: string): ResultBranch => {
      let branch = branches.get(key);
      if (!branch) { branch = { key, kind, label, path, count: 0, first: index, children: [], hits: [] }; branches.set(key, branch); siblings.push(branch); }
      branch.count++; siblings = branch.children; return branch;
    };
    add(JSON.stringify(["notebook", block.box]), "notebook", notebook);
    parts.forEach((part, depth) => { path += `/${part}`; add(JSON.stringify(["directory", block.box, ...parts.slice(0, depth + 1)]), "directory", part); });
    path += `/${name}`;
    add(JSON.stringify(["document", block.box, block.root_id]), "document", name).hits.push(index);
  });
  return roots;
}

export function resultAncestors(branches: readonly ResultBranch[], index: number): string[] {
  for (const branch of branches) {
    if (branch.hits.includes(index)) return [branch.key];
    const child = resultAncestors(branch.children, index);
    if (child.length) return [branch.key, ...child];
  }
  return [];
}
