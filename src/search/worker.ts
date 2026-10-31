import { matchTexts } from "./matcher.ts";
import type { SearchOptions } from "./matcher.ts";
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<{ texts: string[]; query: string; options: SearchOptions; limit: number; replacement?: string }>) => void;
  postMessage: (value: unknown) => void;
};
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ result: matchTexts(data.texts, data.query, data.options, data.limit, data.replacement) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
