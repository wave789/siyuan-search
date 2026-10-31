import { ProtyleMethod } from "siyuan";
import type { App } from "siyuan";
import { post } from "../api.ts";
import { matchRange } from "../search/document.ts";
import type { DocumentBlock } from "../search/document.ts";
import { readingBlocks, readingPreviewHTML } from "../search/reading-preview.ts";
import { searchTexts } from "../search/engine.ts";
import { SearchHighlighter } from "../search/highlighter.ts";
import type { PreviewSelection } from "../search/preview-model.ts";
import { previewFileLocation } from "../search/result-presentation.ts";
import type { SearchOptions, TextMatch } from "../search/matcher.ts";
import type { MatchResult } from "../search/matcher.ts";
import { button, el, errorText, isAbort } from "./shared.ts";
import { icon } from "./icons.ts";

interface Request { selection: PreviewSelection; query: string; options: SearchOptions; path: string }
interface Hit { block: DocumentBlock; match: TextMatch; ordinal: number; range?: Range }
interface View { key: string; element: HTMLElement; scroller: HTMLElement; highlighter: SearchHighlighter; observer?: MutationObserver; needsReveal: boolean }
const ENDPOINT = "/api/export/preview";

/** Use the same single-document HTML endpoint as SiYuan's reading mode. No Protyle instance. */
export class RenderedDocumentPreview {
  private view?: View;
  private current?: Request;
  private controller?: AbortController;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private pending?: { key: string; controller: AbortController; promise: Promise<string> };
  private readonly cache = new Map<string, string>();
  private pathLabel?: HTMLElement;
  private titleLabel?: HTMLElement;
  private info?: HTMLElement;
  private disposed = false;

  constructor(private readonly element: HTMLElement, private readonly open: () => void, _app: App) {
    element.setAttribute("aria-label", "思源文档阅读预览"); this.empty();
  }

  private empty(): void {
    const placeholder = el("div", "syp-preview-empty");
    placeholder.append(el("span", "", "选择一条结果"), el("small", "", "下方显示所选文档的渲染内容"));
    this.element.replaceChildren(placeholder);
  }

  private header(): HTMLElement {
    const head = el("div", "syp-preview-header");
    this.titleLabel = el("strong", "syp-preview-document-title");
    this.pathLabel = el("span", "syp-preview-path");
    this.updatePath(this.current?.path || "");
    const open = button("打开文档", "打开选中的搜索结果（Enter）", this.open, "syp-open-button"); open.append(icon("external"));
    head.append(this.titleLabel, this.pathLabel, open); return head;
  }

  updatePath(path: string): void {
    if (this.current) this.current.path = path;
    const { name, directory } = previewFileLocation(path);
    if (this.titleLabel) { this.titleLabel.textContent = name; this.titleLabel.title = name; }
    if (this.pathLabel) { this.pathLabel.textContent = directory; this.pathLabel.title = directory; }
  }

  show(selection: PreviewSelection, query: string, options: SearchOptions, path: string): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.current = { selection, query, options: { ...options }, path }; this.updatePath(path);
    return this.update(true);
  }

  private async load(request: Request): Promise<string> {
    const key = `${request.selection.block.box}/${request.selection.block.root_id}`, cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    if (this.pending?.key !== key) {
      this.pending?.controller.abort();
      const controller = new AbortController();
      const pending = { key, controller, promise: undefined as unknown as Promise<string> };
      // Deliberately pass one selected root ID, never the list of search results.
      pending.promise = post<{ html: string }>(ENDPOINT, { id: request.selection.block.root_id }, controller.signal).then(result => {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (typeof result?.html !== "string" || !result.html.trim()) throw new Error(`${ENDPOINT} 未返回文档 HTML。`);
        if (result.html.length <= 2000000) {
          this.cache.set(key, result.html); if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!);
        }
        return result.html;
      }).catch(error => {
        if (controller.signal.aborted) throw error;
        throw new Error(`文档读取失败（${ENDPOINT}）：${errorText(error)}`);
      }).finally(() => { if (this.pending === pending) this.pending = undefined; });
      this.pending = pending;
    }
    return this.pending!.promise;
  }

  private mount(request: Request, html: string): View {
    const scroller = el("div", "syp-preview-rich-scroll"); scroller.tabIndex = 0;
    scroller.setAttribute("role", "region"); scroller.setAttribute("aria-label", "只读文档预览，可上下及左右滚动");
    const content = el("div", "syp-preview-reading b3-typography");
    content.append(readingPreviewHTML(html, content.ownerDocument)); scroller.append(content);
    const rootID = request.selection.block.root_id;
    const titleBlock = readingBlocks(content).find(block => block.id === rootID && block.text.trim());
    if (!titleBlock) {
      content.querySelectorAll<HTMLElement>("[data-syp-block-id]").forEach(node => { if (node.dataset.sypBlockId === rootID) node.removeAttribute("data-syp-block-id"); });
      const title = request.selection.block.type === "d" ? request.selection.block.content : request.selection.block.hpath.split("/").at(-1) || "文档预览";
      const heading = el("h1", "", title); heading.dataset.sypBlockId = rootID; content.prepend(heading);
    }
    for (const type of ["beforeinput", "paste", "drop"]) scroller.addEventListener(type, event => { event.preventDefault(); event.stopPropagation(); }, true);
    content.addEventListener("click", event => {
      const link = (event.target as Element).closest?.("a"), hash = (link as HTMLElement | null)?.dataset.sypHash;
      if (hash === undefined) return;
      event.preventDefault(); event.stopPropagation();
      const target = Array.from(content.querySelectorAll<HTMLElement>("[data-syp-anchor]")).find(node => node.dataset.sypAnchor === hash);
      if (target) scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    });
    this.info = el("div", "syp-preview-info", "正在定位匹配…"); this.info.setAttribute("role", "status");
    this.element.replaceChildren(this.header(), this.info, scroller);
    const view: View = { key: `${request.selection.block.box}/${request.selection.block.root_id}`, element: content, scroller,
      highlighter: new SearchHighlighter("syp-preview", scroller), needsReveal: true };
    this.view = view;
    view.observer = new MutationObserver(() => {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => { if (this.view === view && !this.disposed) void this.update(false); }, 80);
    });
    view.observer.observe(content, { subtree: true, childList: true, characterData: true });
    // Text and layout are already visible. Optional code/formula/diagram assets enhance them asynchronously.
    for (const name of ["highlightRender", "mathRender", "mermaidRender", "flowchartRender", "graphvizRender", "chartRender", "abcRender", "plantumlRender"] as const) {
      const render = ProtyleMethod?.[name];
      try { if (typeof render === "function") render(content); }
      catch (error) { console.warn("[siyuan-search] Optional reading preview enhancement failed", error); }
    }
    return view;
  }

  private async update(reveal: boolean): Promise<void> {
    const request = this.current; if (!request || this.disposed) return;
    this.controller?.abort(); const controller = new AbortController(); this.controller = controller;
    this.element.setAttribute("aria-busy", "true");
    try {
      const key = `${request.selection.block.box}/${request.selection.block.root_id}`;
      if (this.view?.key !== key) {
        this.releaseView();
        const loading = el("div", "syp-preview-empty", "正在读取所选文档…"); loading.setAttribute("role", "status");
        this.element.replaceChildren(this.header(), loading);
        const html = await this.load(request);
        if (controller.signal.aborted || this.disposed) return;
        this.mount(request, html);
      }
      const view = this.view!; if (reveal) view.needsReveal = true;
      const blocks = readingBlocks(view.element);
      let result: MatchResult;
      try { result = await searchTexts(blocks.map(block => block.text), request.query, request.options, controller.signal, 100000); }
      catch (error) {
        if (controller.signal.aborted || isAbort(error) || this.disposed || this.view !== view) return;
        view.highlighter.clear();
        if (this.info) this.info.textContent = `文档已显示，匹配高亮暂不可用：${errorText(error)}`;
        return;
      }
      if (controller.signal.aborted || this.disposed || this.view !== view) return;
      const hits: Hit[] = result.blocks.flatMap(group => group.matches.map((match, ordinal) => {
        const block = blocks[group.index]; return { block, match, ordinal, range: matchRange(block, match) };
      }));
      const selected = request.selection, candidates = hits.filter(hit => hit.block.id === selected.block.id);
      const target = candidates.find(hit => hit.block.text === selected.block.content && hit.match.start === selected.match.start && hit.match.end === selected.match.end) ||
        candidates.find(hit => hit.ordinal === selected.ordinal) || candidates[0];
      view.highlighter.set(hits.flatMap(hit => hit.range ? [hit.range] : []), target?.range);
      if (this.info) this.info.textContent = `渲染预览 · ${hits.length.toLocaleString()}${result.truncated ? "+" : ""} 处匹配${target ? "" : " · 该匹配暂未显示，可打开文档查看"}`;
      if (view.needsReveal) { this.reveal(view, target); view.needsReveal = false; }
    } catch (error) {
      if (controller.signal.aborted || isAbort(error) || this.disposed) return;
      this.releaseView();
      const message = el("div", "syp-preview-empty"); message.setAttribute("role", "status");
      message.append(el("strong", "", "渲染预览未能加载"), el("span", "", errorText(error)),
        button("重新加载", "重试读取所选文档", () => { this.cache.clear(); void this.update(true); }, "syp-action"));
      this.element.replaceChildren(this.header(), message);
    } finally { if (this.controller === controller) this.element.setAttribute("aria-busy", "false"); }
  }

  private reveal(view: View, target?: Hit): void {
    const fragments = target?.range?.getClientRects?.();
    const rect = (fragments && Array.from(fragments).find(rect => rect.width && rect.height)) ||
      target?.range?.getBoundingClientRect() || target?.block.element?.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)) return;
    const scroller = view.scroller, bounds = scroller.getBoundingClientRect();
    scroller.scrollTop += rect.top - bounds.top - scroller.clientHeight / 2 + rect.height / 2;
    if (rect.left < bounds.left + 16 || rect.right > bounds.right - 16) scroller.scrollLeft += rect.left - bounds.left - Math.min(80, scroller.clientWidth / 3);
  }

  private releaseView(): void {
    clearTimeout(this.refreshTimer); this.view?.observer?.disconnect(); this.view?.highlighter.clear();
    this.view?.element.querySelectorAll<HTMLMediaElement>("audio, video").forEach(media => { media.pause(); });
    this.view = undefined;
  }
  reset(): void {
    this.current = undefined; this.controller?.abort(); this.pending?.controller.abort(); this.pending = undefined;
    this.cache.clear(); this.releaseView(); this.empty(); this.element.setAttribute("aria-busy", "false");
  }
  destroy(): void {
    this.disposed = true; this.current = undefined; this.controller?.abort(); this.pending?.controller.abort(); this.pending = undefined;
    this.cache.clear(); this.releaseView();
  }
}
