import { searchTexts } from "./engine.ts";
import type { MatchResult, SearchOptions } from "./matcher.ts";
import { preparePreview } from "./preview-model.ts";
import type { PreparedPreview, PreviewDocument, PreviewSelection } from "./preview-model.ts";
import { loadPreviewDocument } from "./preview-source.ts";

interface PreviewDependencies {
  load: (selection: PreviewSelection, signal: AbortSignal) => Promise<PreviewDocument>;
  find: (texts: string[], query: string, options: SearchOptions, signal: AbortSignal, limit: number) => Promise<MatchResult>;
}
const abort = () => new DOMException("Aborted", "AbortError");

export class PreviewStore {
  private readonly documents = new Map<string, PreviewDocument>();
  private readonly prepared = new Map<string, PreparedPreview>();
  private pending?: { key: string; controller: AbortController; promise: Promise<PreviewDocument> };
  constructor(private readonly deps: PreviewDependencies = { load: loadPreviewDocument, find: searchTexts }) {}

  async get(selection: PreviewSelection, query: string, options: SearchOptions, signal: AbortSignal): Promise<PreparedPreview> {
    if (signal.aborted) throw abort();
    const key = `${selection.block.box}/${selection.block.root_id}`;
    let document = this.documents.get(key);
    if (!document) {
      if (this.pending?.key !== key) {
        this.pending?.controller.abort();
        const controller = new AbortController();
        const pending = { key, controller, promise: undefined as unknown as Promise<PreviewDocument> };
        pending.promise = this.deps.load(selection, controller.signal).then(result => {
          if (controller.signal.aborted) throw abort();
          this.documents.set(key, result);
          if (this.documents.size > 8) this.documents.delete(this.documents.keys().next().value!);
          return result;
        }).catch(error => { controller.abort(); throw error; })
          .finally(() => { if (this.pending === pending) this.pending = undefined; });
        this.pending = pending;
      }
      document = await this.pending!.promise;
    }
    if (signal.aborted) throw abort();
    const preparedKey = JSON.stringify([key, query, options.caseSensitive, options.wholeWord, options.regex]);
    const cached = this.prepared.get(preparedKey);
    if (cached?.document === document) return cached;
    const result = await this.deps.find(document.blocks.map(block => block.text), query, options, signal, 100000);
    if (signal.aborted) throw abort();
    const prepared = preparePreview(document, result);
    this.prepared.set(preparedKey, prepared);
    if (this.prepared.size > 8) this.prepared.delete(this.prepared.keys().next().value!);
    return prepared;
  }

  reset(): void { this.pending?.controller.abort(); this.pending = undefined; this.documents.clear(); this.prepared.clear(); }
}
