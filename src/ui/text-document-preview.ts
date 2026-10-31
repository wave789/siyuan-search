import { locatePreviewTarget } from "../search/preview-model.ts";
import type { DocumentMatch, PreparedPreview, PreviewDocument, PreviewSelection, PreviewTarget } from "../search/preview-model.ts";
import { PreviewStore } from "../search/preview-store.ts";
import type { SearchOptions } from "../search/matcher.ts";
import { button, el, errorText, isAbort } from "./shared.ts";
import { icon } from "./icons.ts";
import { syntaxSpans } from "../search/syntax.ts";
import type { SyntaxEngine, SyntaxSpan } from "../search/syntax.ts";
import { previewLineAt } from "../search/preview-model.ts";

export class TextDocumentPreview {
  private readonly store: PreviewStore;
  private controller?: AbortController;
  private prepared?: PreparedPreview;
  private readonly marks = new Map<DocumentMatch, HTMLElement[]>();
  private rows: HTMLElement[] = [];
  private activeMarks: HTMLElement[] = [];
  private activeRow?: HTMLElement;
  private scroller?: HTMLElement;
  private pathLabel?: HTMLElement;
  private info?: HTMLElement;
  private path = "";
  private disposed = false;
  private colored?: PreparedPreview;
  private readonly syntaxCache = new WeakMap<PreviewDocument, Map<string, SyntaxSpan[] | undefined>>();

  constructor(private readonly element: HTMLElement, private readonly open: () => void, store = new PreviewStore(), private readonly modeButton?: () => HTMLButtonElement,
    private readonly syntax?: () => Promise<SyntaxEngine | undefined>) {
    this.store = store; this.element.setAttribute("aria-label", "文档全文预览"); this.empty();
  }

  private empty(): void {
    const placeholder = el("div", "syp-preview-empty");
    placeholder.append(el("span", "", "选择一条结果"), el("small", "", "下方显示所选文档的完整内容"));
    this.element.replaceChildren(placeholder);
  }

  private header(title: string): HTMLElement {
    const head = el("div", "syp-preview-header");
    this.pathLabel = el("span", "syp-preview-path", this.path); this.pathLabel.title = this.path;
    const open = button("打开文档", "打开选中的搜索结果（Enter）", this.open, "syp-open-button");
    open.append(icon("external"));
    head.append(el("strong", "syp-preview-document-title", title), this.pathLabel);
    if (this.modeButton) head.append(this.modeButton());
    head.append(open);
    return head;
  }

  updatePath(path: string): void {
    this.path = path;
    if (this.pathLabel) { this.pathLabel.textContent = path; this.pathLabel.title = path; }
  }

  async show(selection: PreviewSelection, query: string, options: SearchOptions, path: string): Promise<void> {
    this.controller?.abort();
    const controller = new AbortController(); this.controller = controller;
    this.updatePath(path);
    const sameDocument = this.prepared?.document.rootId === selection.block.root_id;
    if (!sameDocument) {
      this.prepared = undefined; this.rows = []; this.marks.clear();
      const loading = el("div", "syp-preview-empty", "正在加载文档全文…"); loading.setAttribute("role", "status");
      this.element.replaceChildren(this.header(selection.block.hpath?.split("/").at(-1) || "全文预览"), loading);
    }
    this.element.setAttribute("aria-busy", "true");
    try {
      const prepared = await this.store.get(selection, query, options, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      const target = locatePreviewTarget(prepared, selection);
      if (this.prepared !== prepared) await this.render(prepared, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      this.focus(prepared, target);
      void this.colorize(prepared, controller.signal);
    } catch (error) {
      if (controller.signal.aborted || isAbort(error) || this.disposed) return;
      this.prepared = undefined;
      const message = el("div", "syp-preview-empty");
      message.setAttribute("role", "status");
      message.append(el("strong", "", "全文加载失败"), el("span", "", errorText(error)),
        button("重新加载", "重试加载文档全文", () => { this.store.reset(); void this.show(selection, query, options, this.path); }, "syp-action"));
      this.element.replaceChildren(this.header("全文预览"), message);
    } finally { if (this.controller === controller) this.element.setAttribute("aria-busy", "false"); }
  }

  private async render(prepared: PreparedPreview, signal: AbortSignal): Promise<void> {
    this.colored = undefined;
    this.rows = []; this.marks.clear(); this.activeMarks = []; this.activeRow = undefined;
    this.info = el("div", "syp-preview-info"); this.info.setAttribute("role", "status");
    this.scroller = el("div", "syp-preview-scroll"); this.scroller.tabIndex = 0;
    this.scroller.setAttribute("role", "region"); this.scroller.setAttribute("aria-label", "文档全文，可上下及左右滚动");
    const content = el("div", "syp-preview-content");
    this.scroller.append(content); this.element.replaceChildren(this.header(prepared.document.title), this.info, this.scroller);
    for (let index = 0; index < prepared.lines.length; index++) {
      if (signal.aborted) return;
      const line = prepared.lines[index], row = el("div", "syp-preview-line"); row.dataset.line = String(index + 1);
      const number = el("span", "syp-preview-line-number", String(index + 1)); number.setAttribute("aria-hidden", "true");
      const text = el("span", "syp-preview-line-text");
      let cursor = 0;
      for (const span of line.spans) {
        text.append(document.createTextNode(line.text.slice(cursor, span.start)));
        const mark = el("mark", "syp-mark", span.newline ? "↵" : line.text.slice(span.start, span.end));
        mark.dataset.matchOffset = String(span.match.offset);
        if (!this.marks.has(span.match)) this.marks.set(span.match, []);
        this.marks.get(span.match)!.push(mark); text.append(mark); cursor = span.end;
      }
      text.append(document.createTextNode(line.text.slice(cursor)));
      row.append(number, text); content.append(row); this.rows.push(row);
      // Render the entire document in batches; long notes do not block typing in the search field.
      if (index % 400 === 399) await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    if (!signal.aborted && !this.disposed) this.prepared = prepared;
  }

  private focus(prepared: PreparedPreview, target: PreviewTarget): void {
    for (const mark of this.activeMarks) mark.classList.remove("syp-mark--active");
    this.activeRow?.classList.remove("syp-preview-line--active");
    this.activeMarks = target.match ? this.marks.get(target.match) || [] : [];
    this.activeMarks.forEach(mark => mark.classList.add("syp-mark--active"));
    this.activeRow = this.rows[target.line]; this.activeRow?.classList.add("syp-preview-line--active");
    if (this.info) this.info.textContent = `第 ${target.line + 1} 行，第 ${target.column} 列 · 全文 ${prepared.document.lines.length.toLocaleString()} 行 · ${prepared.matches.length.toLocaleString()}${prepared.truncated ? "+" : ""} 处匹配${target.warning ? ` · ${target.warning}` : ""}`;
    const anchor = this.activeMarks[0] || this.activeRow;
    if (anchor && this.scroller) {
      const rect = anchor.getBoundingClientRect(), view = this.scroller.getBoundingClientRect();
      this.scroller.scrollTop += rect.top - view.top - this.scroller.clientHeight / 2 + rect.height / 2;
      if (rect.left < view.left + 52 || rect.right > view.right) this.scroller.scrollLeft += rect.left - view.left - Math.min(120, this.scroller.clientWidth / 3);
    }
  }

  private async colorize(prepared: PreparedPreview, signal: AbortSignal): Promise<void> {
    const blocks = prepared.document.blocks.filter(block => block.language && block.language !== "plaintext" && block.text.length <= 250000);
    if (!blocks.length || !this.syntax || this.colored === prepared) return;
    try {
      // Paint the searchable document first. Syntax assets are optional and never gate first content.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      const engine = await this.syntax();
      if (!engine || signal.aborted || this.disposed || this.prepared !== prepared) return;
      let cache = this.syntaxCache.get(prepared.document);
      if (!cache) { cache = new Map(); this.syntaxCache.set(prepared.document, cache); }
      let budget = 1000000;
      for (const block of blocks) {
        if (signal.aborted || this.disposed || this.prepared !== prepared) return;
        if (block.text.length > budget || !engine.getLanguage(block.language!)) continue;
        budget -= block.text.length;
        if (!cache.has(block.id)) cache.set(block.id, syntaxSpans(block.text, engine.highlight(block.text, { language: block.language!, ignoreIllegals: true }).value));
        const spans = cache.get(block.id);
        if (spans) {
          const first = previewLineAt(prepared.document, block.offset), last = previewLineAt(prepared.document, block.offset + block.text.length);
          for (let index = first; index <= last; index++) {
            if (signal.aborted || this.disposed || this.prepared !== prepared) return;
            this.colorizeLine(prepared, index, block.offset, spans);
            if (index % 200 === 199) await new Promise<void>(resolve => setTimeout(resolve, 0));
          }
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (!signal.aborted && this.prepared === prepared) this.colored = prepared;
    } catch { /* Keep the already visible, safe full text when a language/asset is unavailable. */ }
  }

  private colorizeLine(prepared: PreparedPreview, index: number, blockOffset: number, spans: SyntaxSpan[]): void {
    const line = prepared.lines[index], element = this.rows[index]?.querySelector<HTMLElement>(".syp-preview-line-text");
    if (!element) return;
    const selection = window.getSelection();
    if (selection?.rangeCount && (element.contains(selection.anchorNode) || element.contains(selection.focusNode))) return;
    const from = (offset: number) => {
      let low = 0, high = spans.length;
      while (low < high) { const middle = (low + high) >>> 1; if (spans[middle].end <= offset) low = middle + 1; else high = middle; }
      return low;
    };
    const first = from(line.offset - blockOffset);
    if (first === spans.length || spans[first].start >= line.offset + line.text.length - blockOffset) return;
    const append = (target: Node, start: number, end: number) => {
      let cursor = start;
      for (let index = from(line.offset + start - blockOffset); index < spans.length; index++) {
        const span = spans[index];
        if (span.start >= line.offset + end - blockOffset) break;
        const left = Math.max(start, blockOffset + span.start - line.offset), right = Math.min(end, blockOffset + span.end - line.offset);
        if (right <= left) continue;
        if (left > cursor) target.appendChild(document.createTextNode(line.text.slice(cursor, left)));
        const token = el("span", `syp-syntax ${span.classes}`, line.text.slice(left, right)); target.appendChild(token); cursor = right;
      }
      if (cursor < end) target.appendChild(document.createTextNode(line.text.slice(cursor, end)));
    };
    const fragment = document.createDocumentFragment(), marks = Array.from(element.querySelectorAll<HTMLElement>(".syp-mark"));
    let cursor = 0, markIndex = 0;
    for (const span of line.spans) {
      append(fragment, cursor, span.start);
      const mark = marks[markIndex++];
      if (!mark) return;
      mark.replaceChildren();
      if (span.newline) mark.append(document.createTextNode("↵")); else append(mark, span.start, span.end);
      fragment.append(mark); cursor = span.end;
    }
    append(fragment, cursor, line.text.length); element.replaceChildren(fragment);
  }

  reset(): void {
    this.colored = undefined;
    this.controller?.abort(); this.store.reset(); this.prepared = undefined; this.rows = []; this.marks.clear();
    this.activeMarks = []; this.activeRow = undefined;
    this.pathLabel = undefined; this.info = undefined; this.scroller = undefined; this.empty(); this.element.setAttribute("aria-busy", "false");
  }

  destroy(): void { this.disposed = true; this.controller?.abort(); this.store.reset(); this.prepared = undefined; this.rows = []; this.marks.clear(); this.activeMarks = []; this.activeRow = undefined; }
}
