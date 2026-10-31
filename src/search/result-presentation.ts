import type { IndexedBlock } from "../api.ts";
import { linePosition } from "./matcher.ts";
import type { TextMatch } from "./matcher.ts";

/** Split the document's full display path into its name and containing directory. */
export function previewFileLocation(path: string): { name: string; directory: string } {
  const parts = path.split("/").filter(Boolean);
  return { name: parts.pop() || "未命名文档", directory: parts.join("/") || "/" };
}

export function relativeResultPath(block: IndexedBlock, scope: { root?: string; notebook?: string }, notebooks: ReadonlyMap<string, string>): string {
  const path = (block.hpath || "").split("/").filter(Boolean).join("/") || (block.type === "d" ? block.content : "未命名文档");
  if (scope.root) return path.split("/").at(-1)!;
  if (scope.notebook) return path;
  return `${notebooks.get(block.box) || block.box || "笔记本"}/${path}`;
}

/** The whole matching line is available; CSS handles narrow-window ellipsis. */
export function matchingLine(text: string, match: TextMatch): { text: string; match: TextMatch; line: number; column: number; newline: boolean } {
  const offset = Math.min(text.length, Math.max(0, match.start));
  const start = offset ? text.lastIndexOf("\n", offset - 1) + 1 : 0;
  const newline = text.indexOf("\n", offset), end = newline < 0 ? text.length : newline;
  return { text: text.slice(start, end), match: { start: offset - start, end: Math.max(offset - start, Math.min(match.end, end) - start) },
    ...linePosition(text, offset), newline: offset === end && match.end > offset && end < text.length };
}
