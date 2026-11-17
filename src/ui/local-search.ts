import type { IProtyle } from "siyuan";
import { post } from "../api.ts";
import { searchTexts } from "../search/engine.ts";
import { liveBlocks, matchRange, mergeBlocks, readBlocks } from "../search/document.ts";
import type { DocumentBlock } from "../search/document.ts";
import { anchoredHitIndex, restoreOriginScroll } from "../search/origin.ts";
import type { SearchAnchor, SearchOrigin } from "../search/origin.ts";
import { SearchHighlighter } from "../search/highlighter.ts";
import { compilePattern } from "../search/matcher.ts";
import type { SearchOptions, TextMatch } from "../search/matcher.ts";
import type { ReplacementService } from "../replace/service.ts";
import { el, errorText, iconButton, isAbort, optionButtons, toggleByKey, ReplaceControls } from "./shared.ts";
import { icon } from "./icons.ts";

interface LocalHost {
  options: SearchOptions;
  replacements: ReplacementService;
  changed: () => void;
  remember: (query: string) => void;
  openGlobal: (query: string) => void;
  reveal: (id: string, editor: IProtyle) => Promise<IProtyle>;
}
interface Hit extends TextMatch { blockId: string; text: string }

export class LocalSearch {
  readonly element = el("div", "syp-searchbar");
  readonly input = el("input", "syp-input syp-query-input");
  private readonly counter = el("span", "syp-counter", "输入以搜索");
  private readonly status = el("div", "syp-local-status");
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly replaceControls: ReplaceControls;
  private readonly unsubscribeReplacement: () => void;
  private replacementController?: AbortController;
  private replacing = false;
  private searchReady = false;
  private feedback = "";
  private readonly highlighter = new SearchHighlighter("syp-search", () => this.editor.contentElement || this.editor.wysiwyg?.element.closest<HTMLElement>(".protyle-content") || this.editor.element,
    { overlay: true, overlayZIndex: 3 });
  private readonly observer: MutationObserver;
  private editor: IProtyle;
  private saved?: DocumentBlock[];
  private hits: Hit[] = [];
  private active = -1;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private navigating = 0;
  private truncated = false;
  private requestedHit?: SearchAnchor;
  private pendingOrigin?: SearchOrigin;
  private returnSelection?: Range;
  private refreshOnly = false;
  private explicitFocus = false;

  constructor(editor: IProtyle, private readonly host: LocalHost, query: string, origin?: SearchOrigin) {
    this.editor = editor;
    this.element.setAttribute("role", "search");
    this.element.setAttribute("aria-label", "当前文档查找");
    this.input.type = "text";
    this.input.placeholder = "在当前文档中查找…";
    this.input.setAttribute("aria-label", "当前文档搜索文本");
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.counter.setAttribute("role", "status");
    this.counter.setAttribute("aria-live", "polite");
    const row = el("div", "syp-searchbar-row");
    const searchIcon = el("span", "syp-search-icon"); searchIcon.append(icon("search"));
    const options = optionButtons(host.options, () => { this.feedback = ""; host.changed(); this.schedule(0); });
    this.previous = iconButton("arrowUp", "上一个（Shift+Enter）", () => void this.move(-1));
    this.next = iconButton("arrowDown", "下一个（Enter）", () => void this.move(1));
    this.replaceControls = new ReplaceControls({ single: () => void this.replace(false), all: () => void this.replace(true), undo: () => void this.undoReplace() });
    this.unsubscribeReplacement = host.replacements.subscribe(() => { if (!this.disposed) this.updateReplaceControls(); });
    row.append(this.replaceControls.toggle, searchIcon, this.input, options, this.counter, this.previous, this.next,
      iconButton("external", "在全局搜索中查找", () => host.openGlobal(this.input.value)),
      iconButton("close", "关闭（Esc）", () => this.close(true)));
    this.status.setAttribute("role", "status");
    this.status.hidden = true;
    this.element.append(row, this.replaceControls.row, this.status);
    this.input.addEventListener("input", (event) => {
      if (!(event as InputEvent).isComposing) { this.clearOrigin(); this.feedback = ""; this.schedule(); }
    });
    this.input.addEventListener("compositionend", () => { this.clearOrigin(); this.schedule(); });
    this.element.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (toggleByKey(event, options)) return;
      if (event.key === "Enter" && event.target === this.input) { event.preventDefault(); event.stopPropagation(); void this.move(event.shiftKey ? -1 : 1); }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.close(true); }
    });
    this.observer = new MutationObserver(() => {
      this.saved = undefined;
      // Editing can remove the active hit. Refresh its marks without navigating to another hit.
      const focus = document.activeElement, selection = window.getSelection();
      if (focus && this.editor.element.contains(focus) && !this.element.contains(focus)) {
        this.clearOrigin(); this.explicitFocus = false;
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        if (range && this.editor.element.contains(range.startContainer) && this.editor.element.contains(range.endContainer)) this.returnSelection = range.cloneRange();
      }
      this.schedule(250, true);
    });
    this.attach(editor);
    this.setQuery(query, origin);
  }

  get protyle(): IProtyle { return this.editor; }
  focusMatch(blockId: string, match: TextMatch): void { this.clearOrigin(); this.requestedHit = { blockId, ...match }; this.explicitFocus = true; }
  get isOpen(): boolean { return !this.disposed && this.element.isConnected; }

  setQuery(query?: string, origin?: SearchOrigin): void {
    if (query !== undefined) { this.input.value = query; this.feedback = ""; }
    this.pendingOrigin = origin;
    this.returnSelection = origin?.selection;
    if (origin?.anchor) this.requestedHit = origin.anchor;
    this.input.focus({ preventScroll: true });
    this.input.select();
    this.schedule(0);
    if (origin) restoreOriginScroll(origin);
  }

  private clearOrigin(): void { this.pendingOrigin = undefined; this.returnSelection = undefined; }

  attach(editor: IProtyle): void {
    this.controller?.abort();
    this.observer.disconnect();
    this.editor = editor;
    this.clearOrigin(); this.requestedHit = undefined;
    this.saved = undefined;
    this.highlighter.clear();
    editor.element.prepend(this.element);
    const content = editor.wysiwyg?.element || editor.element.querySelector(".protyle-wysiwyg");
    const title = editor.element.querySelector(".protyle-title__input");
    for (const target of [content, title]) if (target) this.observer.observe(target, { subtree: true, characterData: true, childList: true, attributes: true, attributeFilter: ["fold"] });
    this.schedule(0);
  }

  private schedule(delay = 120, refreshOnly = false): void {
    clearTimeout(this.timer);
    this.controller?.abort();
    if (this.disposed || this.replacing) return;
    this.refreshOnly = refreshOnly;
    if (!refreshOnly) this.explicitFocus = false;
    this.searchReady = false;
    const current = this.hits[this.active];
    if (current && !this.requestedHit) this.requestedHit = current;
    this.hits = [];
    this.active = -1;
    this.previous.disabled = this.next.disabled = true;
    this.updateReplaceControls();
    this.highlighter.clear();
    this.counter.textContent = this.input.value ? "查找中…" : "输入以搜索";
    this.timer = setTimeout(() => void this.search(), delay);
  }

  private async search(): Promise<void> {
    const query = this.input.value;
    const rootId = this.editor.block.rootID;
    if (!query || !rootId || this.disposed) { this.message(""); return; }
    const controller = new AbortController();
    this.controller = controller;
    const editor = this.editor;
    let warning = "";
    try {
      compilePattern(query, this.host.options);
      if (!this.saved) {
        try {
          const data = await post<{ dom: string }>("/api/block/getBlockDOM", { id: rootId, notebook: editor.notebookId }, controller.signal);
          const doc = new DOMParser().parseFromString(data.dom, "text/html");
          this.saved = readBlocks(doc.body);
        } catch (error) {
          if (controller.signal.aborted) throw error;
          warning = `无法读取整篇文档，当前只搜索已加载内容：${errorText(error)}`;
        }
      }
      if (controller.signal.aborted || this.disposed) return;
      const blocks = mergeBlocks(this.saved || [], liveBlocks(editor.element, rootId, editor.wysiwyg?.element));
      const result = await searchTexts(blocks.map(block => block.text), query, { ...this.host.options }, controller.signal);
      if (controller.signal.aborted || this.disposed) return;
      this.hits = result.blocks.flatMap(block => block.matches.map(match => ({ ...match, blockId: blocks[block.index].id, text: blocks[block.index].text })));
      this.truncated = result.truncated;
      this.searchReady = true;
      const requested = this.requestedHit;
      const preserveViewport = !!this.pendingOrigin || (this.refreshOnly && !this.explicitFocus);
      this.active = anchoredHitIndex(this.hits, requested);
      this.requestedHit = undefined;
      this.pendingOrigin = undefined;
      this.explicitFocus = false;
      this.message(warning || this.feedback || (result.truncated ? "匹配超过 10,000 处，请缩小搜索条件。" : ""));
      this.updateHighlights();
      this.updateCounter();
      // Opening find and passive document refreshes preserve the current editing position.
      if (!preserveViewport && this.active >= 0 && !this.scrollToActive(false)) void this.move(0);
    } catch (error) {
      if (controller.signal.aborted || isAbort(error) || this.disposed) return;
      this.hits = [];
      this.active = -1;
      this.highlighter.clear();
      this.counter.textContent = "搜索失败";
      this.message(errorText(error));
      this.updateReplaceControls();
    }
  }

  private message(text: string): void { this.status.textContent = text; this.status.hidden = !text; }
  private updateCounter(): void {
    this.counter.textContent = this.hits.length ? `${this.active + 1} / ${this.hits.length}${this.truncated ? "+" : ""}` : "无匹配";
    this.previous.disabled = this.next.disabled = !this.hits.length;
    this.updateReplaceControls();
    this.input.setAttribute("aria-invalid", String(!!this.input.value && !this.hits.length));
  }

  private updateHighlights(): void {
    const blocks = new Map(liveBlocks(this.editor.element, this.editor.block.rootID || "", this.editor.wysiwyg?.element).map(block => [block.id, block]));
    const ranges: Range[] = [];
    let active: Range | undefined;
    this.hits.forEach((hit, index) => {
      const block = blocks.get(hit.blockId);
      const range = block && matchRange(block, hit);
      if (range) { ranges.push(range); if (index === this.active) active = range; }
    });
    this.highlighter.set(ranges, active);
  }

  private scrollToActive(force: boolean): boolean {
    const hit = this.hits[this.active];
    if (!hit) return false;
    const block = liveBlocks(this.editor.element, this.editor.block.rootID || "", this.editor.wysiwyg?.element).find(item => item.id === hit.blockId);
    const range = block && matchRange(block, hit);
    if (!range || !block?.element || block.element.getClientRects().length === 0) return false;
    const rect = range.getBoundingClientRect();
    const bounds = this.editor.element.getBoundingClientRect();
    if (force || rect.top < bounds.top + this.element.offsetHeight + 48 || rect.bottom > bounds.bottom - 36) {
      const scroller = block.element.closest<HTMLElement>(".protyle-content");
      if (scroller) scroller.scrollTop += rect.top - scroller.getBoundingClientRect().top - scroller.clientHeight / 2;
      else block.element.scrollIntoView({ block: "center", behavior: "instant" });
    }
    return true;
  }

  async move(direction: number): Promise<void> {
    if (!this.hits.length || this.disposed || this.replacing) return;
    this.clearOrigin();
    this.active = (this.active + direction + this.hits.length) % this.hits.length;
    this.updateCounter();
    this.updateHighlights();
    if (this.scrollToActive(true)) return;
    const hit = this.hits[this.active], index = this.active, token = ++this.navigating;
    // A native block jump loads lazy/folded content. Ignore observer changes until it finishes.
    this.observer.disconnect();
    try {
      const editor = await this.host.reveal(hit.blockId, this.editor);
      if (this.disposed || token !== this.navigating) return;
      this.editor = editor;
      editor.element.prepend(this.element);
      this.active = index;
      this.updateHighlights();
      this.scrollToActive(true);
      this.input.focus();
    } catch (error) { if (!this.disposed) this.message(errorText(error)); }
    finally {
      if (!this.disposed) {
        const content = this.editor.wysiwyg?.element || this.editor.element.querySelector(".protyle-wysiwyg");
        if (content) this.observer.observe(content, { subtree: true, characterData: true, childList: true, attributes: true, attributeFilter: ["fold"] });
      }
    }
  }

  private updateReplaceControls(): void {
    this.replaceControls.update(this.searchReady && this.active >= 0, this.searchReady && !!this.input.value,
      this.host.replacements.canUndo, this.replacing || this.host.replacements.busy);
  }

  private async replace(all: boolean): Promise<void> {
    if (this.replacing || !this.searchReady || !this.input.value) return;
    if (this.editor.disabled) { this.message("当前编辑器处于只读状态，不能替换。"); return; }
    const hit = this.hits[this.active];
    if (!all && !hit) return;
    const root = this.editor.block.rootID!;
    await this.runReplacement(async (signal, progress) => {
      const result = await this.host.replacements.replace({
        query: this.input.value, options: { ...this.host.options }, replacement: this.replaceControls.input.value,
        scope: { root, notebook: this.editor.notebookId },
        target: all ? undefined : { id: hit.blockId, root, notebook: this.editor.notebookId, title: hit.blockId === root,
          selected: { text: hit.text, start: hit.start, end: hit.end } },
      }, signal, progress);
      return `已替换 ${result.count} 处匹配`;
    });
  }

  private async undoReplace(): Promise<void> {
    await this.runReplacement(async (signal, progress) => `已撤销 ${await this.host.replacements.undo(signal, progress)} 处替换`);
  }

  private async runReplacement(action: (signal: AbortSignal, progress: (text: string) => void) => Promise<string>): Promise<void> {
    if (this.replacing || this.disposed) return;
    this.clearOrigin();
    this.replacing = true;
    const controller = new AbortController(); this.replacementController = controller;
    clearTimeout(this.timer); this.controller?.abort(); this.observer.disconnect();
    this.highlighter.clear();
    this.input.disabled = true;
    this.element.querySelectorAll<HTMLButtonElement>(".syp-option").forEach(node => { node.disabled = true; });
    this.previous.disabled = this.next.disabled = true;
    this.updateReplaceControls();
    this.message("正在准备替换…");
    try { this.feedback = await action(controller.signal, text => { if (!this.disposed) this.message(text); }); }
    catch (error) { this.feedback = errorText(error); }
    finally {
      this.replacing = false; this.replacementController = undefined;
      if (!this.disposed) {
        this.input.disabled = false;
        this.element.querySelectorAll<HTMLButtonElement>(".syp-option").forEach(node => { node.disabled = false; });
        this.saved = undefined;
        const content = this.editor.wysiwyg?.element || this.editor.element.querySelector(".protyle-wysiwyg");
        const title = this.editor.element.querySelector(".protyle-title__input");
        for (const node of [content, title]) if (node) this.observer.observe(node, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["fold"] });
        this.message(this.feedback); this.updateReplaceControls(); this.schedule(0);
        this.replaceControls.input.focus();
      }
    }
  }

  close(restoreFocus = false): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeReplacement();
    this.replacementController?.abort();
    this.host.remember(this.input.value);
    clearTimeout(this.timer);
    this.controller?.abort();
    this.observer.disconnect();
    this.highlighter.clear();
    this.element.remove();
    if (restoreFocus && this.editor.element.isConnected) {
      const hit = this.hits[this.active];
      const block = hit && liveBlocks(this.editor.element, this.editor.block.rootID || "", this.editor.wysiwyg?.element).find(item => item.id === hit.blockId);
      const original = this.returnSelection;
      const range = original && original.startContainer.isConnected && original.endContainer.isConnected &&
        this.editor.element.contains(original.startContainer) && this.editor.element.contains(original.endContainer) ? original : block && matchRange(block, hit);
      const title = this.editor.element.querySelector<HTMLElement>(".protyle-title__input");
      const focus = range && title?.contains(range.startContainer) && title.contains(range.endContainer) ? title : this.editor.wysiwyg?.element;
      focus?.focus({ preventScroll: true });
      if (range) { const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); }
    }
  }
}
