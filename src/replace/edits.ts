import type { TextMatch } from "../search/matcher.ts";

/** Validate once before applying any edit; snapshots always use the original text offsets. */
export function validateEdits(text: string, edits: TextMatch[]): void {
  let end = 0;
  for (const edit of edits) {
    if (edit.start < end || edit.end <= edit.start || edit.end > text.length || edit.replacement === undefined) {
      throw new Error("替换位置已失效，请重新搜索。");
    }
    end = edit.end;
  }
}

export function applyTextEdits(text: string, edits: TextMatch[]): string {
  validateEdits(text, edits);
  const pieces: string[] = [];
  let cursor = 0;
  for (const edit of edits) { pieces.push(text.slice(cursor, edit.start), edit.replacement!); cursor = edit.end; }
  pieces.push(text.slice(cursor));
  return pieces.join("");
}
