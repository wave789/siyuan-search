import { blockQuery, post } from "../api.ts";
import type { App } from "siyuan";
import type { IndexedBlock, Notebook } from "../api.ts";
import { searchTexts } from "../search/engine.ts";
import { compilePattern } from "../search/matcher.ts";
import type { SearchOptions, TextMatch } from "../search/matcher.ts";
import { restoreOriginScroll } from "../search/origin.ts";
import type { SearchOrigin } from "../search/origin.ts";
import type { ReplacementService } from "../replace/service.ts";
import { matchingLine, relativeResultPath } from "../search/result-presentation.ts";
import { DocumentPreview } from "./document-preview.ts";
import { DialogWindow } from "./dialog-window.ts";
import { DialogSplit } from "./dialog-split.ts";
import { ResultTree } from "./result-tree.ts";
import { FindDock } from "./find-dock.ts";
import { button, el, errorText, highlightedText, iconButton, isAbort, optionButtons, toggleByKey, ReplaceControls } from "./shared.ts";
import { icon } from "./icons.ts";

interface GlobalHost {
  app: App;
  options: SearchOptions;
  replacements: ReplacementService;
  rootId?: string;
  notebookId?: string;
  origin?: SearchOrigin;
  presentation?: "popup" | "tree";
  closeOnOutside?: () => boolean;
  changed: () => void;
  remember: (query: string) => void;
  open: (block: IndexedBlock, match: TextMatch, query: string) => Promise<void>;
}
interface Hit { block: IndexedBlock; match: TextMatch; ordinal: number }
const RESULT_LIMIT = 1000;

export class GlobalSearch {
  readonly element = el("div", "syp-modal-backdrop");
  readonly input = el("input", "syp-input syp-query-input");
  private readonly dialog = el("section", "syp-dialog");
  private windowControls: DialogWindow | FindDock;
  private splitControls: DialogSplit;
  private mode: "popup" | "tree" = "popup";
  private readonly body = el("div", "syp-dialog-body");
  private readonly separator = el("div", "syp-pane-divider");
  private readonly heading = el("header", "syp-dialog-header");
  private readonly searchRow = el("div", "syp-global-search-row");
  private readonly closeButton = iconButton("close", "关闭（Esc）", () => this.close());
  private readonly openWindow: HTMLButtonElement;
  private readonly resultTree: ResultTree;
  private readonly list = el("div", "syp-results");
  private readonly preview = el("div", "syp-preview");
  private readonly documentPreview: DocumentPreview;
  private readonly notebookNames = new Map<string, string>();
  private readonly summary = el("div", "syp-summary", "输入关键词，在笔记中查找");
  private readonly scope = el("select", "syp-select");
  private readonly replaceControls: ReplaceControls;
  private readonly unsubscribeReplacement: () => void;
  private replacementController?: AbortController;
  private replacing = false;
  private searchReady = false;
  private feedback = "";
  private readonly stop: HTMLButtonElement;
  private readonly more: HTMLButtonElement;
  private readonly progress = el("span", "syp-progress");
  private readonly previousFocus = document.activeElement as HTMLElement | null;
  private outsideFocus?: HTMLElement;
  private controller?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private hits: Hit[] = [];
  private selected = -1;
  private shown = 100;
  private disposed = false;
  private searchQuery = "";
  private resultOptions: SearchOptions;

  constructor(private readonly host: GlobalHost, query: string) {
    this.resultOptions = { ...host.options };
    this.dialog.setAttribute("role", "dialog");
    this.dialog.setAttribute("aria-modal", "true");
    this.dialog.setAttribute("aria-label", "在笔记中查找");
    const heading = this.heading;
    const title = el("div", "syp-dialog-title");
    const brand = el("span", "syp-brand-icon"); brand.append(icon("brand"));
    title.append(brand, el("strong", "", "在笔记中查找"), el("span", "syp-subtitle", "Find in Notes"));
    heading.append(title, this.closeButton);
    const search = this.searchRow;
    this.input.placeholder = "搜索文本或正则表达式…";
    this.input.setAttribute("aria-label", "全局搜索文本");
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    const options = optionButtons(host.options, () => { this.feedback = ""; host.changed(); this.schedule(0); });
    this.replaceControls = new ReplaceControls({ single: () => void this.replace(false), all: () => void this.replace(true), undo: () => void this.undoReplace() }, "全局替换");
    this.unsubscribeReplacement = host.replacements.subscribe(() => { if (!this.disposed) this.updateReplaceControls(); });
    const searchIcon = el("span", "syp-search-icon"); searchIcon.append(icon("search"));
    search.append(this.replaceControls.toggle, searchIcon, this.input, options);
    const filters = el("div", "syp-filters");
    const label = el("label", "syp-scope-label", "作用域");
    this.scope.setAttribute("aria-label", "搜索范围");
    this.addScope("all", "全部笔记本");
    if (host.rootId) this.addScope("document", "当前文档");
    const scopeSelect = el("span", "syp-select-wrap");
    scopeSelect.append(this.scope, icon("chevronDown", "syp-icon syp-select-chevron"));
    label.append(scopeSelect);
    this.stop = button("停止", "停止当前搜索", () => this.cancel());
    this.stop.hidden = true;
    filters.append(label, this.progress, this.stop);
    const body = this.body;
    const resultPane = el("div", "syp-result-pane");
    this.list.setAttribute("role", "listbox");
    this.list.setAttribute("aria-label", "搜索结果");
    this.list.tabIndex = 0;
    this.more = button("显示更多结果", "显示接下来的 100 条结果", () => { this.shown += 100; this.renderList(); }, "syp-more");
    this.more.hidden = true;
    resultPane.append(this.list, this.more);
    const separator = this.separator;
    body.append(resultPane, separator, this.preview);
    this.documentPreview = new DocumentPreview(this.preview, () => void this.openSelected(), host.app);
    this.summary.setAttribute("role", "status");
    this.summary.setAttribute("aria-live", "polite");
    const footer = el("footer", "syp-dialog-footer");
    this.openWindow = button("打开查找窗口", "在目录树查找窗口中继续当前搜索", () => this.openFindWindow(), "syp-action syp-open-find-window");
    footer.append(this.summary, el("span", "syp-keyboard-hint", "↑ ↓ 选择　Enter 打开"), this.openWindow);
    this.dialog.append(heading, search, this.replaceControls.row, filters, body, footer);
    this.element.append(this.dialog);
    document.body.append(this.element);
    this.windowControls = new DialogWindow(this.dialog, heading);
    this.splitControls = new DialogSplit(body, separator);
    this.resultTree = new ResultTree(this.list, index => this.select(index, false), () => void this.openSelected());
    if (host.presentation === "tree") this.openFindWindow();
    this.renderEmpty();
    this.element.addEventListener("mousedown", event => { if (this.mode === "popup" && event.target === this.element) this.close(); });
    this.element.addEventListener("keydown", event => {
      if (event.isComposing) return;
      if (toggleByKey(event, options)) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (this.dismissOnEscape) this.close(); }
      if (["ArrowDown", "ArrowUp"].includes(event.key) && event.target !== this.scope && !(event.target as Element).closest(".syp-preview")) {
        event.preventDefault(); event.stopPropagation();
        if (this.hits.length) this.select((this.selected + (event.key === "ArrowDown" ? 1 : -1) + this.hits.length) % this.hits.length);
      }
      if (event.key === "Enter" && (event.target === this.input || event.target === this.list || (event.target as Element).closest(".syp-result"))) {
        event.preventDefault(); event.stopPropagation();
        if (this.hits.length) void this.openSelected();
        else if (this.input.value && !this.controller) this.schedule(0);
      }
      if (event.key === "Tab" && this.mode === "popup") this.trapFocus(event);
    });
    this.input.addEventListener("input", event => { if (!(event as InputEvent).isComposing) { this.feedback = ""; this.schedule(); } });
    this.input.addEventListener("compositionend", () => this.schedule());
    this.scope.addEventListener("change", () => { this.replaceControls.all.textContent = this.scope.value === "all" ? "全局替换" : "全部替换"; this.feedback = ""; this.schedule(0); });
    void this.loadNotebooks();
    this.setQuery(query);
    if (host.origin) restoreOriginScroll(host.origin);
  }

  get isOpen(): boolean { return !this.disposed; }
  get presentation(): "popup" | "tree" { return this.mode; }
  get dismissOnEscape(): boolean { return this.mode === "popup" || this.host.closeOnOutside?.() === true; }

  /** Promote the current search without a second scan, preview request or loss of selection. */
  openFindWindow(): void {
    if (this.disposed || this.mode === "tree") return;
    this.mode = "tree";
    this.element.className = "syp-modal-backdrop syp-tree-window";
    this.dialog.classList.add("syp-dialog--tree");
    this.windowControls.destroy(); this.windowControls = new FindDock(this.dialog, this.host.origin?.editor);
    this.heading.title = "";
    this.dialog.setAttribute("aria-modal", "false"); this.dialog.setAttribute("aria-label", "目录树查找窗口");
    this.list.setAttribute("role", "tree"); this.list.setAttribute("aria-label", "按目录分组的搜索结果");
    this.heading.append(this.searchRow, this.closeButton);
    this.openWindow.hidden = true;
    this.closeButton.title = "关闭查找窗口"; this.closeButton.setAttribute("aria-label", "关闭查找窗口");
    this.splitControls.destroy(); this.splitControls = new DialogSplit(this.body, this.separator, "columns");
    document.addEventListener("mousedown", this.onOutside, true);
    document.addEventListener("focusin", this.onOutsideFocus, true);
    this.renderList();
    if (this.selected >= 0) this.resultTree.select(this.selected, false);
    this.input.focus({ preventScroll: true });
  }

  private onOutside = (event: MouseEvent): void => {
    if (this.disposed || this.mode !== "tree" || !this.host.closeOnOutside?.() || event.button !== 0) return;
    if (event.target instanceof Node && !this.dialog.contains(event.target)) this.close(false);
  };
  private onOutsideFocus = (event: FocusEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && typeof target.focus === "function" && !this.dialog.contains(target)) this.outsideFocus = target;
  };
  setQuery(query?: string): void {
    if (query !== undefined) { this.input.value = query; this.feedback = ""; }
    this.input.focus({ preventScroll: true }); this.input.select(); this.schedule(0);
  }

  private addScope(value: string, text: string): void {
    const option = el("option", "", text); option.value = value; this.scope.append(option);
  }

  private readonly lifetime = new AbortController();
  private async loadNotebooks(): Promise<void> {
    try {
      const data = await post<{ notebooks: Notebook[] }>("/api/notebook/lsNotebooks", {}, this.lifetime.signal);
      if (this.disposed) return;
      for (const notebook of data.notebooks || []) if (!notebook.closed) { this.notebookNames.set(notebook.id, notebook.name); this.addScope(`notebook:${notebook.id}`, notebook.name); }
      this.refreshPaths();
    } catch (error) {
      if (!this.disposed) this.scope.title = `笔记本列表加载失败：${errorText(error)}`;
    }
  }

  private schedule(delay = 250): void {
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = undefined;
    if (this.disposed || this.replacing) return;
    this.searchReady = false;
    this.updateReplaceControls();
    this.hits = []; this.selected = -1; this.shown = 100;
    this.resultTree.reset();
    this.list.setAttribute("aria-busy", "false");
    this.list.removeAttribute("aria-activedescendant");
    this.list.replaceChildren(); this.documentPreview.reset(); this.more.hidden = true;
    this.progress.textContent = ""; this.stop.hidden = true;
    this.summary.textContent = this.input.value ? "正在准备搜索…" : "输入关键词，在笔记中查找";
    this.renderEmpty();
    this.timer = setTimeout(() => void this.search(), delay);
  }

  private async search(): Promise<void> {
    const query = this.input.value;
    if (!query || this.disposed) return;
    const controller = new AbortController();
    this.controller = controller;
    this.searchQuery = query;
    this.resultOptions = { ...this.host.options };
    const scopeValue = this.scope.value;
    const scope = scopeValue === "document" ? { root: this.host.rootId } :
      scopeValue.startsWith("notebook:") ? { notebook: scopeValue.slice(9) } : {};
    let cursor = "", scanned = 0, truncated = false;
    this.stop.hidden = false;
    this.list.setAttribute("aria-busy", "true");
    try {
      compilePattern(query, this.resultOptions);
      while (!controller.signal.aborted) {
        const blocks = await post<IndexedBlock[]>("/api/query/sql", { stmt: blockQuery(cursor, scope) }, controller.signal);
        if (controller.signal.aborted || this.disposed) return;
        if (!blocks?.length) break;
        const result = await searchTexts(blocks.map(block => block.content || ""), query, this.resultOptions, controller.signal, RESULT_LIMIT - this.hits.length);
        if (controller.signal.aborted || this.disposed) return;
        for (const group of result.blocks) {
          const block = blocks[group.index];
          group.matches.forEach((match, ordinal) => this.hits.push({ block, match, ordinal }));
        }
        scanned += blocks.length;
        this.progress.textContent = `已检索 ${scanned.toLocaleString()} 个内容块`;
        this.updateSummary(true);
        this.renderList();
        if (this.selected < 0 && this.hits.length) this.select(0, false, false);
        if (result.truncated || this.hits.length >= RESULT_LIMIT) { truncated = true; break; }
        const next = blocks.at(-1)!.id;
        if (next <= cursor) throw new Error("思源返回了重复的分页数据，请重试。");
        cursor = next;
        if (blocks.length < 500) break;
      }
      if (controller.signal.aborted || this.disposed) return;
      this.searchReady = true;
      this.updateSummary(false);
      if (truncated) this.summary.textContent += " · 已达 1,000 处上限，请缩小范围";
      if (!this.hits.length) this.renderEmpty("没有找到匹配项", "尝试关闭整词匹配，或切换搜索范围。");
    } catch (error) {
      if (controller.signal.aborted || isAbort(error) || this.disposed) return;
      this.summary.textContent = `搜索失败：${errorText(error)}`;
      if (!this.hits.length) this.renderEmpty("搜索未完成", errorText(error));
    } finally {
      if (this.controller === controller) {
        this.controller = undefined;
        this.stop.hidden = true;
        this.list.setAttribute("aria-busy", "false");
        this.updateReplaceControls();
      }
    }
  }

  private updateSummary(searching: boolean): void {
    const documents = new Set(this.hits.map(hit => hit.block.root_id));
    this.summary.textContent = `${this.hits.length.toLocaleString()} 处匹配 · ${documents.size} 篇文档${searching ? " · 搜索中…" : this.feedback ? ` · ${this.feedback}` : ""}`;
  }

  private renderEmpty(title = "搜索你的笔记", description = "支持普通文本、整词与正则表达式搜索"): void {
    if (!this.hits.length) {
      const empty = el("div", "syp-empty");
      const searchIcon = el("div", "syp-empty-icon"); searchIcon.append(icon("search"));
      empty.append(searchIcon, el("strong", "", title), el("span", "", description));
      this.list.replaceChildren(empty);
    }
  }

  private pathFor(block: IndexedBlock): string { return relativeResultPath(block, this.replacementScope(), this.notebookNames); }
  private previewPathFor(block: IndexedBlock): string { return relativeResultPath(block, {}, this.notebookNames); }

  private refreshPaths(): void {
    if (this.mode === "tree") this.renderList();
    this.list.querySelectorAll<HTMLElement>(".syp-result-path").forEach(node => {
      const hit = this.hits[Number(node.dataset.index)];
      if (hit) { const path = this.pathFor(hit.block); node.textContent = path; node.title = path; }
    });
    const selected = this.hits[this.selected];
    if (selected) this.documentPreview.updatePath(this.previewPathFor(selected.block));
  }

  private renderList(): void {
    if (!this.hits.length) return;
    const scrollTop = this.list.scrollTop;
    const current = this.hits[this.selected];
    this.hits.sort((first, second) => `${first.block.box}/${first.block.hpath}/${first.block.root_id}`.localeCompare(`${second.block.box}/${second.block.hpath}/${second.block.root_id}`, undefined, { numeric: true }) ||
      first.block.id.localeCompare(second.block.id) || first.match.start - second.match.start);
    if (current) this.selected = this.hits.indexOf(current);
    if (this.selected >= this.shown) this.shown = Math.ceil((this.selected + 1) / 100) * 100;
    if (this.mode === "tree") {
      this.resultTree.render(this.hits, this.selected, this.shown, this.notebookNames);
      this.more.hidden = this.hits.length <= this.shown;
      return;
    }
    const fragment = document.createDocumentFragment();
    this.hits.slice(0, this.shown).forEach((hit, index) => {
      const row = el("div", "syp-result");
      row.id = `syp-result-${index}`; row.dataset.index = String(index);
      row.setAttribute("role", "option"); row.setAttribute("aria-selected", String(index === this.selected));
      const line = matchingLine(hit.block.content, hit.match);
      const snippet = el("span", "syp-result-text");
      snippet.append(highlightedText(line.text, line.match, Infinity));
      if (line.newline) snippet.append(el("mark", "syp-mark", "↵"));
      snippet.title = line.text;
      const path = el("span", "syp-result-path", this.pathFor(hit.block));
      path.dataset.index = String(index); path.title = path.textContent!;
      row.append(snippet, path);
      row.addEventListener("click", () => this.select(this.hits.indexOf(hit), false));
      row.addEventListener("dblclick", () => { this.select(this.hits.indexOf(hit), false); void this.openSelected(); });
      fragment.append(row);
    });
    this.list.replaceChildren(fragment); this.list.scrollTop = scrollTop;
    this.more.hidden = this.hits.length <= this.shown;
    if (this.selected >= 0) this.list.setAttribute("aria-activedescendant", `syp-result-${this.selected}`);
  }

  private select(index: number, scroll = true, revealMatch = true): void {
    if (!this.hits[index]) return;
    this.selected = index;
    if (index >= this.shown) { this.shown = Math.ceil((index + 1) / 100) * 100; this.renderList(); }
    if (this.mode === "tree") this.resultTree.select(index, revealMatch);
    else {
      this.list.querySelectorAll("[aria-selected]").forEach(node => node.setAttribute("aria-selected", String((node as HTMLElement).dataset.index === String(index))));
      this.list.setAttribute("aria-activedescendant", `syp-result-${index}`);
    }
    if (scroll) {
      const row = this.list.querySelector<HTMLElement>(`[data-index="${index}"]`);
      if (row) {
        const rect = row.getBoundingClientRect(), view = this.list.getBoundingClientRect();
        if (rect.top < view.top) this.list.scrollTop += rect.top - view.top;
        else if (rect.bottom > view.bottom) this.list.scrollTop += rect.bottom - view.bottom;
      }
    }
    const hit = this.hits[index];
    void this.documentPreview.show(hit, this.searchQuery, this.resultOptions, this.previewPathFor(hit.block));
    this.updateReplaceControls();
  }

  private opening = false;
  private async openSelected(): Promise<void> {
    const hit = this.hits[this.selected];
    if (!hit || this.opening || this.replacing) return;
    this.opening = true;
    try {
      await this.host.open(hit.block, hit.match, this.searchQuery);
      if (this.mode === "popup") this.close(false);
    } catch (error) {
      if (!this.disposed) this.summary.textContent = `无法打开结果：${errorText(error)}`;
    } finally { this.opening = false; }
  }

  private updateReplaceControls(): void {
    this.replaceControls.update(this.searchReady && this.selected >= 0 && !!this.hits[this.selected], this.searchReady && !!this.input.value,
      this.host.replacements.canUndo, this.replacing || this.host.replacements.busy);
  }

  private replacementScope() {
    const value = this.scope.value;
    return value === "document" ? { root: this.host.rootId, notebook: this.host.notebookId } :
      value.startsWith("notebook:") ? { notebook: value.slice(9) } : {};
  }

  private async replace(all: boolean): Promise<void> {
    if (this.replacing || !this.searchReady || !this.input.value) return;
    const hit = this.hits[this.selected];
    if (!all && !hit) return;
    await this.runReplacement(async (signal, progress) => {
      const result = await this.host.replacements.replace({
        query: this.input.value, options: { ...this.host.options }, replacement: this.replaceControls.input.value,
        scope: this.replacementScope(),
        target: all ? undefined : { id: hit.block.id, root: hit.block.root_id, notebook: hit.block.box, title: hit.block.type === "d",
          selected: { text: hit.block.content, start: hit.match.start, end: hit.match.end } },
      }, signal, progress);
      return `已替换 ${result.count} 处 · ${result.documents} 篇文档`;
    });
  }

  private async undoReplace(): Promise<void> {
    await this.runReplacement(async (signal, progress) => `已撤销 ${await this.host.replacements.undo(signal, progress)} 处替换`);
  }

  private async runReplacement(action: (signal: AbortSignal, progress: (text: string) => void) => Promise<string>): Promise<void> {
    if (this.replacing || this.disposed) return;
    this.replacing = true;
    const controller = new AbortController(); this.replacementController = controller;
    clearTimeout(this.timer); this.controller?.abort(); this.controller = undefined;
    this.input.disabled = true; this.scope.disabled = true;
    this.dialog.querySelectorAll<HTMLButtonElement>(".syp-option").forEach(node => { node.disabled = true; });
    this.stop.hidden = false; this.stop.textContent = "停止替换";
    this.updateReplaceControls();
    this.summary.textContent = "正在准备替换…";
    try { this.feedback = await action(controller.signal, text => { if (!this.disposed) this.summary.textContent = text; }); }
    catch (error) { this.feedback = errorText(error); }
    finally {
      this.replacing = false; this.replacementController = undefined;
      if (!this.disposed) {
        this.input.disabled = false; this.scope.disabled = false;
        this.dialog.querySelectorAll<HTMLButtonElement>(".syp-option").forEach(node => { node.disabled = false; });
        this.stop.hidden = true; this.stop.textContent = "停止";
        this.updateReplaceControls(); this.schedule(0); this.replaceControls.input.focus();
      }
    }
  }

  private trapFocus(event: KeyboardEvent): void {
    const focusable = Array.from(this.dialog.querySelectorAll<HTMLElement>("button, input, select, [tabindex='0']")).filter(node => !node.hidden && !node.hasAttribute("disabled") && node.getClientRects().length > 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  private cancel(): void {
    if (this.replacing) { this.replacementController?.abort(); return; }
    this.searchReady = !!this.searchQuery;
    this.updateReplaceControls();
    this.controller?.abort(); this.controller = undefined;
    this.stop.hidden = true; this.list.setAttribute("aria-busy", "false");
    this.updateSummary(false); this.summary.textContent += " · 已停止，保留已有结果";
  }

  close(restoreFocus = true): void {
    if (this.disposed) return;
    this.disposed = true;
    this.windowControls.destroy();
    this.splitControls.destroy();
    this.resultTree.destroy();
    if (this.mode === "tree") {
      document.removeEventListener("mousedown", this.onOutside, true);
      document.removeEventListener("focusin", this.onOutsideFocus, true);
    }
    this.documentPreview.destroy();
    this.unsubscribeReplacement();
    this.replacementController?.abort();
    this.host.remember(this.input.value);
    clearTimeout(this.timer); this.controller?.abort(); this.lifetime.abort();
    this.element.remove();
    if (restoreFocus) {
      if (this.mode === "tree") {
        const focus = this.outsideFocus || this.previousFocus;
        if (focus?.isConnected) focus.focus({ preventScroll: true });
        return;
      }
      if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
      const origin = this.host.origin, range = origin?.selection;
      if (origin && range?.startContainer.isConnected && range.endContainer.isConnected &&
        origin.editor.contains(range.startContainer) && origin.editor.contains(range.endContainer)) {
        const selection = window.getSelection();
        selection?.removeAllRanges(); selection?.addRange(range);
      }
      // Focus/selection handlers can scroll the editor even when browser scrolling is disabled.
      if (origin) restoreOriginScroll(origin);
    }
  }
}
