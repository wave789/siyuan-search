import { compilePattern } from "../search/matcher.ts";
import type { SearchOptions } from "../search/matcher.ts";
import { applyTextEdits } from "./edits.ts";
import type { Change, EditableSource, ReplaceResult, ReplaceScope, ReplaceTarget, ReplacementBackend } from "./types.ts";

const MAX_BLOCK_MATCHES = 100000;
const emptyResult = (): ReplaceResult => ({ count: 0, blocks: 0, documents: 0 });
const checkAbort = (signal: AbortSignal) => { if (signal.aborted) throw new DOMException("已停止", "AbortError"); };

export class ReplacementFailure extends Error {
  constructor(message: string, readonly result: ReplaceResult) { super(message); this.name = "ReplacementFailure"; }
}

/** Shared by both panels, so closing a panel does not lose the last replacement's undo data. */
export class ReplacementService {
  private readonly history: Change[][] = [];
  private readonly listeners = new Set<() => void>();
  private running = false;
  constructor(private readonly backend: ReplacementBackend) {}
  get busy(): boolean { return this.running; }
  get canUndo(): boolean { return !!this.history.length && !this.running; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(): void { this.listeners.forEach(listener => listener()); }
  private same(target: ReplaceTarget, first: string, second: string): boolean {
    return first === second || this.backend.equivalent?.(target, first, second) === true;
  }

  async replace(
    request: { query: string; options: SearchOptions; replacement: string; scope: ReplaceScope; target?: ReplaceTarget },
    signal: AbortSignal, progress: (message: string) => void = () => {},
  ): Promise<ReplaceResult> {
    if (this.running) throw new Error("另一个替换操作尚未完成。");
    if (!request.query) throw new Error("请先输入查找内容。");
    compilePattern(request.query, request.options);
    this.running = true;
    this.notify();
    const committed: Change[] = [];
    const result = emptyResult(), documents = new Set<string>();
    let recorded = false;
    try {
      await this.backend.prepare(request.scope, signal);
      checkAbort(signal);
      const plans: Change[] = [];
      if (request.target) {
        const source = await this.backend.read(request.target, signal);
        const change = await this.plan(source, request, signal);
        if (change) plans.push(change);
      } else {
        let scanned = 0;
        const seen = new Set<string>();
        for await (const batch of this.backend.candidates(request.scope, signal)) {
          checkAbort(signal);
          // A cap on candidate matches must never silently turn "all" into a partial replacement.
          const matches = await this.backend.find(batch.map(block => block.content || ""), request.query, request.options, signal, MAX_BLOCK_MATCHES);
          if (matches.truncated) throw new Error("单批匹配超过 100,000 处，请缩小替换范围。");
          for (const group of matches.blocks) {
            checkAbort(signal);
            const block = batch[group.index];
            if (seen.has(block.id)) continue;
            seen.add(block.id);
            const source = await this.backend.read({ id: block.id, root: block.root_id, notebook: block.box, title: block.type === "d" }, signal);
            const change = await this.plan(source, request, signal);
            if (change) plans.push(change);
          }
          scanned += batch.length;
          progress(`正在准备替换 · 已检索 ${scanned.toLocaleString()} 个内容块`);
        }
      }
      const total = plans.reduce((sum, change) => sum + change.count, 0);
      for (const change of plans) {
        checkAbort(signal);
        // Re-read immediately before writing; reject edits made after the replacement was planned.
        const current = await this.backend.read(change.target, signal);
        if (!this.same(change.target, current.raw, change.before)) throw new Error("原文在搜索后发生了变化，已停止替换；请刷新后重试。");
        checkAbort(signal);
        // Record before sending: a lost HTTP response must not discard the original snapshot.
        committed.push(change);
        if (!recorded) { this.history.push(committed); this.history.splice(0, Math.max(0, this.history.length - 10)); recorded = true; }
        // Do not abort an in-flight mutation: wait for its outcome before stopping the next block.
        change.after = await this.backend.write(change, change.after);
        result.count += change.count; result.blocks++; documents.add(change.target.root); result.documents = documents.size;
        progress(`已替换 ${result.count.toLocaleString()} / ${total.toLocaleString()} 处`);
      }
      return result;
    } catch (error) {
      const message = signal.aborted ? "替换已停止" : error instanceof Error ? error.message : "替换失败";
      throw new ReplacementFailure(`${message}${committed.length ? `（已确认替换 ${result.count} 处，可使用撤销）` : ""}`, result);
    } finally {
      try { if (committed.length) await this.backend.changed?.(); }
      catch (error) { throw new ReplacementFailure(`已确认替换 ${result.count} 处，但刷新搜索索引失败：${error instanceof Error ? error.message : String(error)}；可以撤销本次替换。`, result); }
      finally { this.running = false; this.notify(); }
    }
  }

  private async plan(source: EditableSource, request: { query: string; options: SearchOptions; replacement: string; target?: ReplaceTarget }, signal: AbortSignal): Promise<Change | undefined> {
    const selected = request.target?.selected;
    if (selected && source.text !== selected.text) throw new Error("原文已变化，请重新搜索后再替换当前匹配。");
    const result = await this.backend.find([source.text], request.query, request.options, signal, MAX_BLOCK_MATCHES, request.replacement);
    if (result.truncated) throw new Error("一个内容块中匹配超过 100,000 处，请缩小范围。");
    const edits = (result.blocks[0]?.matches || []).filter(match => !selected || (match.start === selected.start && match.end === selected.end));
    if (selected && !edits.length) throw new Error("当前匹配已失效，请重新搜索。");
    if (!edits.length) return;
    const afterText = applyTextEdits(source.text, edits);
    if (afterText === source.text) return;
    if (source.target.title && (!afterText.trim() || /[\r\n]/.test(afterText))) throw new Error("替换后文档标题不能为空或包含换行，请调整替换内容。");
    return { target: source.target, before: source.raw, after: source.apply(edits), count: edits.length };
  }

  async undo(signal: AbortSignal, progress: (message: string) => void = () => {}): Promise<number> {
    if (this.running) throw new Error("请等待当前替换操作完成。");
    const batch = this.history.at(-1);
    if (!batch) return 0;
    this.running = true;
    this.notify();
    let restored = 0;
    try {
      await this.backend.prepare({}, signal);
      while (batch.length) {
        checkAbort(signal);
        const change = batch.at(-1)!;
        const current = await this.backend.read(change.target, signal);
        if (this.same(change.target, current.raw, change.before)) { batch.pop(); continue; }
        if (!this.same(change.target, current.raw, change.after)) throw new Error("替换后的内容又被编辑，已停止撤销，以保留后续修改。");
        checkAbort(signal);
        await this.backend.write(change, change.before);
        restored += change.count; batch.pop();
        progress(`已撤销 ${restored} 处替换`);
      }
      this.history.pop();
      return restored;
    } catch (error) {
      const message = signal.aborted ? "撤销已停止" : error instanceof Error ? error.message : "撤销失败";
      throw new Error(`${message}（已撤销 ${restored} 处）`);
    } finally {
      try { await this.backend.changed?.(); }
      catch (error) { throw new Error(`已撤销 ${restored} 处，但刷新搜索索引失败：${error instanceof Error ? error.message : String(error)}`); }
      finally { this.running = false; this.notify(); }
    }
  }
}
