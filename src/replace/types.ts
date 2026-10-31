import type { IndexedBlock } from "../api.ts";
import type { MatchResult, SearchOptions, TextMatch } from "../search/matcher.ts";

export interface ReplaceScope { root?: string; notebook?: string }
export interface ReplaceTarget {
  id: string; root: string; notebook?: string; title?: boolean;
  /** A single replace must still refer to the same snapshot and occurrence the user selected. */
  selected?: { text: string; start: number; end: number };
}
export interface EditableSource {
  target: ReplaceTarget;
  raw: string;
  text: string;
  apply: (edits: TextMatch[]) => string;
}
export interface Change {
  target: ReplaceTarget;
  before: string; after: string;
  count: number;
}
export interface ReplaceResult { count: number; blocks: number; documents: number }
export type FindMatches = (texts: string[], query: string, options: SearchOptions, signal: AbortSignal, limit?: number, replacement?: string) => Promise<MatchResult>;
export interface ReplacementBackend {
  prepare: (scope: ReplaceScope, signal: AbortSignal) => Promise<void>;
  /** All candidates in scope, independent of the UI's preview limit. */
  candidates: (scope: ReplaceScope, signal: AbortSignal) => AsyncIterable<IndexedBlock[]>;
  read: (target: ReplaceTarget, signal?: AbortSignal) => Promise<EditableSource>;
  write: (change: Change, raw: string) => Promise<string>;
  find: FindMatches;
  equivalent?: (target: ReplaceTarget, first: string, second: string) => boolean;
  changed?: () => void | Promise<void>;
}
