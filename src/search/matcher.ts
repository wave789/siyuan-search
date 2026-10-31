import { expandReplacement } from "./replacement-text.ts";

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface TextMatch { start: number; end: number; replacement?: string }
export interface BlockMatches { index: number; matches: TextMatch[] }
export interface MatchResult { blocks: BlockMatches[]; truncated: boolean }

export const DEFAULT_OPTIONS: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };
const WORD = /[\p{L}\p{N}\p{M}_]/u;

export function compilePattern(query: string, options: SearchOptions): RegExp {
  const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(source, `gmu${options.caseSensitive ? "" : "i"}`);
}

function previousPoint(text: string, index: number): string {
  if (index === 0) return "";
  const last = text.charCodeAt(index - 1);
  return last >= 0xdc00 && last <= 0xdfff ? text.slice(Math.max(0, index - 2), index) : text[index - 1];
}

/** Bounds and offsets use UTF-16, the same indexing as DOM Range. */
export function matchTexts(texts: string[], query: string, options: SearchOptions, limit = 10000, replacement?: string): MatchResult {
  if (!query || limit < 1) return { blocks: [], truncated: false };
  const pattern = compilePattern(query, options);
  const blocks: BlockMatches[] = [];
  let count = 0;
  for (let index = 0; index < texts.length; index++) {
    const text = texts[index];
    const matches: TextMatch[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index, end = start + match[0].length;
      if (end > start && (!options.wholeWord ||
        (!WORD.test(previousPoint(text, start)) && !WORD.test(String.fromCodePoint(text.codePointAt(end) ?? 0))))) {
        // Look for one extra match, so exactly `limit` hits is not labelled truncated.
        if (count === limit) return { blocks: [...blocks, ...(matches.length ? [{ index, matches }] : [])], truncated: true };
        matches.push(replacement === undefined ? { start, end } : { start, end, replacement: options.regex ? expandReplacement(replacement, match, text) : replacement });
        count++;
      }
      // Ignore zero-width hits; advance a full code point to prevent an infinite loop.
      if (pattern.lastIndex === start) pattern.lastIndex += (text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1;
    }
    if (matches.length) blocks.push({ index, matches });
  }
  return { blocks, truncated: false };
}

export function linePosition(text: string, offset: number): { line: number; column: number } {
  const prefix = text.slice(0, offset);
  return { line: prefix.split("\n").length, column: Array.from(prefix.slice(prefix.lastIndexOf("\n") + 1)).length + 1 };
}
