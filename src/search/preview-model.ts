import type { IndexedBlock } from "../api.ts";
import { linePosition } from "./matcher.ts";
import type { MatchResult, TextMatch } from "./matcher.ts";

export interface PreviewSelection { block: IndexedBlock; match: TextMatch; ordinal: number }
export interface PreviewBlock { id: string; text: string; offset: number; language?: string }
export interface PreviewLine { text: string; offset: number }
export interface PreviewDocument { rootId: string; title: string; text: string; blocks: PreviewBlock[]; lines: PreviewLine[] }
export interface DocumentMatch extends TextMatch { blockId: string; offset: number; endOffset: number }
export interface PreviewSpan { match: DocumentMatch; start: number; end: number; newline: boolean }
export interface PreparedPreview { document: PreviewDocument; matches: DocumentMatch[]; lines: { text: string; offset: number; spans: PreviewSpan[] }[]; truncated: boolean }
export interface PreviewTarget { offset: number; line: number; column: number; match?: DocumentMatch; warning?: string }

export function buildPreviewDocument(rootId: string, title: string, body: { id: string; text: string; language?: string }[]): PreviewDocument {
  let offset = 0;
  const seen = new Set<string>();
  const blocks: PreviewBlock[] = [];
  for (const block of [{ id: rootId, text: title }, ...body]) {
    if (seen.has(block.id)) continue;
    seen.add(block.id); blocks.push({ ...block, offset }); offset += block.text.length + 1;
  }
  const text = blocks.map(block => block.text).join("\n"), lines: PreviewLine[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index++) if (index === text.length || text[index] === "\n") {
    lines.push({ text: text.slice(start, index), offset: start }); start = index + 1;
  }
  return { rootId, title, text, blocks, lines };
}

/** Zero-based line index, including the final empty line. Offsets use DOM/JS UTF-16. */
export function previewLineAt(document: PreviewDocument, offset: number): number {
  let low = 0, high = document.lines.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (document.lines[middle].offset <= offset) low = middle; else high = middle - 1;
  }
  return low;
}

export function preparePreview(document: PreviewDocument, result: MatchResult): PreparedPreview {
  const matches: DocumentMatch[] = result.blocks.flatMap(group => {
    const block = document.blocks[group.index];
    return group.matches.map(match => ({ ...match, blockId: block.id, offset: block.offset + match.start, endOffset: block.offset + match.end }));
  });
  const lines = document.lines.map(line => ({ ...line, spans: [] as PreviewSpan[] }));
  for (const match of matches) {
    const first = previewLineAt(document, match.offset), last = previewLineAt(document, Math.max(match.offset, match.endOffset - 1));
    for (let index = first; index <= last; index++) {
      const line = lines[index], end = line.offset + line.text.length;
      const start = Math.max(0, match.offset - line.offset), stop = Math.max(start, Math.min(end, match.endOffset) - line.offset);
      const newline = start === stop && match.endOffset > end && index < lines.length - 1;
      if (stop > start || newline) line.spans.push({ match, start, end: stop, newline });
    }
  }
  return { document, matches, lines, truncated: result.truncated };
}

export function locatePreviewTarget(preview: PreparedPreview, selected: PreviewSelection): PreviewTarget {
  const { document, matches } = preview;
  const block = document.blocks.find(block => block.id === selected.block.id);
  const candidates = matches.filter(match => match.blockId === selected.block.id);
  const exact = block?.text === selected.block.content ? candidates.find(match => match.start === selected.match.start && match.end === selected.match.end) : undefined;
  const match = exact || candidates[selected.ordinal] || candidates[0];
  const offset = match?.offset ?? block?.offset ?? 0, index = previewLineAt(document, offset);
  const column = linePosition(document.lines[index].text, Math.max(0, offset - document.lines[index].offset)).column;
  return { offset, line: index, column, match,
    warning: match ? undefined : "该处内容已变化，请重新搜索以更新匹配位置。" };
}
