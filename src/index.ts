import { Plugin, Menu, Setting, getAllEditor, openTab, showMessage } from "siyuan";
import type { IProtyle } from "siyuan";
import { ReplacementService } from "./replace/service.ts";
import { createReplacementBackend } from "./replace/backend.ts";
import { DEFAULT_OPTIONS } from "./search/matcher.ts";
import type { SearchOptions } from "./search/matcher.ts";
import { captureSearchOrigin } from "./search/origin.ts";
import { LocalSearch } from "./ui/local-search.ts";
import { GlobalSearch } from "./ui/global-search.ts";
import { el, errorText } from "./ui/shared.ts";
import { PLUGIN_ICON_ID, PLUGIN_ICON_SPRITE } from "./ui/icons.ts";
import "./style.css";

interface Preferences { takeOverShortcuts: boolean; popupFirst: boolean; closeTreeOnOutside: boolean; options: SearchOptions }
const STORAGE = "preferences.json";

export default class IdeSearchPlugin extends Plugin {
  private preferences: Preferences = { takeOverShortcuts: true, popupFirst: false, closeTreeOnOutside: false, options: { ...DEFAULT_OPTIONS } };
  private readonly replacements = new ReplacementService(createReplacementBackend(() => getAllEditor().map(editor => editor.protyle)));
  private local?: LocalSearch;
  private global?: GlobalSearch;
  private activeEditor?: IProtyle;
  private lastQuery = "";
  private saveTimer?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private revealing = 0;

  async onload(): Promise<void> {
    try {
      const saved = await this.loadData(STORAGE) as Partial<Preferences> | undefined;
      if (saved && typeof saved === "object") {
        if (typeof saved.takeOverShortcuts === "boolean") this.preferences.takeOverShortcuts = saved.takeOverShortcuts;
        if (typeof saved.popupFirst === "boolean") this.preferences.popupFirst = saved.popupFirst;
        if (typeof saved.closeTreeOnOutside === "boolean") this.preferences.closeTreeOnOutside = saved.closeTreeOnOutside;
        for (const key of Object.keys(DEFAULT_OPTIONS) as (keyof SearchOptions)[]) {
          if (typeof saved.options?.[key] === "boolean") this.preferences.options[key] = saved.options[key];
        }
      }
    } catch (error) { console.warn("[siyuan-search] Could not load preferences", error); }
    if (this.destroyed) return;
    this.addIcons(PLUGIN_ICON_SPRITE);
    this.addCommand({ langKey: "findInDocument", langText: "IDE 搜索：当前文档", hotkey: "", callback: () => this.openLocal() });
    this.addCommand({ langKey: "findInWorkspace", langText: "IDE 搜索：全局搜索", hotkey: "", callback: () => this.openGlobal() });
    // Window capture runs before SiYuan's document/editor handlers and avoids opening two search UIs.
    window.addEventListener("keydown", this.onKeyDown, true);
    document.addEventListener("focusin", this.onFocusIn, true);
    this.eventBus.on("switch-protyle", this.onSwitch);
    this.eventBus.on("destroy-protyle", this.onDestroyEditor);
    this.setupSettings();
  }

  onLayoutReady(): void {
    this.addTopBar({ icon: PLUGIN_ICON_ID, title: "IDE 搜索 · Ctrl+F / Ctrl+Shift+F", position: "right", callback: () => {
      const menu = new Menu("siyuan-ide-search-menu");
      menu.addItem({ icon: PLUGIN_ICON_ID, label: "查找当前文档", accelerator: "Ctrl+F", click: () => this.openLocal() });
      menu.addItem({ icon: PLUGIN_ICON_ID, label: "在笔记中查找", accelerator: "Ctrl+Shift+F", click: () => this.openGlobal() });
      menu.open({ x: window.innerWidth - 260, y: 40 });
    } });
  }

  private setupSettings(): void {
    this.setting = new Setting({ width: "580px" });
    const shortcut = el("input", "b3-switch");
    shortcut.type = "checkbox"; shortcut.checked = this.preferences.takeOverShortcuts;
    shortcut.addEventListener("change", () => { this.preferences.takeOverShortcuts = shortcut.checked; this.savePreferences(); });
    this.setting.addItem({ title: "使用 PyCharm 搜索快捷键", description: "接管 Ctrl+F 和 Ctrl+Shift+F（macOS 使用 ⌘）。关闭后可使用顶栏菜单或在思源快捷键设置中为插件命令指定其他按键。", actionElement: shortcut });
    const popupFirst = el("input", "b3-switch"); popupFirst.type = "checkbox"; popupFirst.checked = this.preferences.popupFirst;
    popupFirst.addEventListener("change", () => { this.preferences.popupFirst = popupFirst.checked; this.savePreferences(); });
    this.setting.addItem({ title: "全局搜索先打开快速弹出框", description: "默认关闭，直接打开文档区底部的查找面板，左侧为目录树、右侧为文档预览。开启后先使用原有上下布局，再通过右下角「打开查找窗口」继续搜索。下次打开全局搜索时生效。", actionElement: popupFirst });
    const outside = el("input", "b3-switch"); outside.type = "checkbox"; outside.checked = this.preferences.closeTreeOnOutside;
    outside.addEventListener("change", () => { this.preferences.closeTreeOnOutside = outside.checked; this.savePreferences(); });
    this.setting.addItem({ title: "查找窗口在点击外部时关闭", description: "仅影响目录树查找窗口。默认关闭，可在窗口外操作笔记，点击右上角 × 关闭窗口；开启后，点击外部或按 Esc 关闭。原有快速弹出框仍支持点击外部和 Esc 关闭。", actionElement: outside });
    this.setting.addItem({ title: "匹配方式", description: "Cc：区分大小写；W：整词匹配；.*：正则表达式。全部关闭时按普通文本包含匹配。选项会自动保存。" });
    this.setting.addItem({ title: "搜索范围", description: "页内搜索包含整篇文档的标题和正文。全局搜索读取思源已建立索引的内容，不包含附件正文或已关闭、未索引的笔记本。" });
  }

  private savePreferences = (): void => {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.saveData(STORAGE, this.preferences).catch(error => { if (!this.destroyed) showMessage(`搜索设置保存失败：${errorText(error)}`); });
    }, 250);
  };

  private visible(editor?: IProtyle): editor is IProtyle {
    return !!(editor?.block.rootID && editor.element.isConnected && editor.element.getClientRects().length && !editor.element.closest(".fn__none, .syp-preview"));
  }

  private findEditor(target?: Node | null): IProtyle | undefined {
    const editors = getAllEditor().map(editor => editor.protyle).filter(editor => this.visible(editor));
    if (target) {
      const found = editors.find(editor => editor.element.contains(target));
      if (found) return found;
    }
    if (this.local?.isOpen && this.visible(this.local.protyle)) return this.local.protyle;
    if (this.visible(this.activeEditor)) return this.activeEditor;
    // Main document editors take precedence over search/backlink preview editors.
    return editors.find(editor => editor.element.closest('.layout__wnd--active, .layout-tab-container')) || editors[0];
  }

  private selectedText(editor?: IProtyle): string | undefined {
    if (document.activeElement?.closest(".syp-searchbar, .syp-dialog")) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !editor?.element.contains(selection.anchorNode)) return;
    const text = selection.toString();
    return text.length && text.length <= 10000 ? text : undefined;
  }

  private onFocusIn = (event: FocusEvent): void => {
    if (!(event.target instanceof Node) || (event.target as Element).closest?.(".syp-searchbar")) return;
    const editor = getAllEditor().map(item => item.protyle).find(item => item.element.contains(event.target as Node));
    if (editor && this.visible(editor)) this.activeEditor = editor;
  };

  private onSwitch = ({ detail }: CustomEvent<{ protyle: IProtyle }>): void => {
    this.activeEditor = detail.protyle;
    if (this.revealing || this.global?.isOpen || !this.local?.isOpen) return;
    if (this.visible(detail.protyle) && this.local.protyle !== detail.protyle) this.local.attach(detail.protyle);
  };

  private onDestroyEditor = ({ detail }: CustomEvent<{ protyle: IProtyle }>): void => {
    if (this.local?.protyle === detail.protyle) { this.lastQuery = this.local.input.value; this.local.close(); }
    if (this.activeEditor === detail.protyle) this.activeEditor = undefined;
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing || this.destroyed) return;
    const target = event.target instanceof Element ? event.target : undefined;
    // SiYuan can consume Escape before it reaches the search bar's bubble listener.
    // Closing an open search remains available even when shortcut takeover is disabled.
    if (event.key === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (target?.closest('.b3-dialog, [role="dialog"], .b3-menu') && !target.closest(".syp-dialog")) return;
      if (this.global?.isOpen || this.local?.isOpen) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (this.global?.isOpen) { if (this.global.dismissOnEscape !== false) this.global.close(); }
        else this.local?.close(true);
        return;
      }
    }
    if (event.altKey) return;
    if (this.local?.isOpen && !this.global?.isOpen && event.key === "F3") {
      event.preventDefault(); event.stopImmediatePropagation(); void this.local.move(event.shiftKey ? -1 : 1); return;
    }
    if (!this.preferences.takeOverShortcuts || event.key.toLowerCase() !== "f" || !(event.ctrlKey || event.metaKey)) return;
    if (target?.closest('.b3-dialog, [role="dialog"]') && !target.closest(".syp-dialog")) return;
    const editor = this.findEditor(target);
    // Respect native find behavior in unrelated text fields and PDF/asset tabs.
    if (!event.shiftKey && !target?.closest(".syp-searchbar, .syp-dialog")) {
      if (target?.closest('input, textarea, [contenteditable="true"]') && !target.closest(".protyle")) return;
      if (!editor) return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.shiftKey) this.openGlobal(); else this.openLocal();
  };

  private openLocal(query?: string): void {
    const editor = this.findEditor(window.getSelection()?.anchorNode || document.activeElement);
    if (!editor) { showMessage("请先打开一篇笔记，再使用页内搜索。"); return; }
    const selected = query ?? this.selectedText(editor);
    const selection = document.activeElement?.closest(".syp-searchbar, .syp-dialog") ? null : window.getSelection();
    const origin = captureSearchOrigin(editor.element, editor.block.rootID!, selection?.rangeCount ? selection.getRangeAt(0) : undefined);
    const fromGlobal = this.global?.isOpen ? this.global.input.value : undefined;
    this.global?.close(false);
    if (this.local?.isOpen) {
      if (this.local.protyle !== editor) this.local.attach(editor);
      this.local.setQuery(selected ?? fromGlobal, origin);
    } else {
      this.local = new LocalSearch(editor, this.localHost(), selected ?? fromGlobal ?? this.lastQuery, origin);
    }
    this.activeEditor = editor;
  }

  private localHost() {
    return { options: this.preferences.options, replacements: this.replacements, changed: this.savePreferences,
      remember: (query: string) => { this.lastQuery = query; },
      openGlobal: (query: string) => this.openGlobal(query),
      reveal: (id: string, editor: IProtyle) => this.openBlock(id, editor.block.rootID!, editor),
    };
  }

  private openGlobal(query?: string): void {
    const editor = this.findEditor(window.getSelection()?.anchorNode || document.activeElement);
    const selected = query ?? this.selectedText(editor);
    if (this.global?.isOpen) { this.global.setQuery(selected); return; }
    const selection = window.getSelection();
    const origin = editor ? captureSearchOrigin(editor.element, editor.block.rootID!, selection?.rangeCount ? selection.getRangeAt(0) : undefined) : undefined;
    if (this.local?.isOpen) { this.lastQuery = this.local.input.value; this.local.close(); }
    this.global = new GlobalSearch({
      app: this.app,
      options: this.preferences.options, replacements: this.replacements, changed: this.savePreferences,
      remember: (query: string) => { this.lastQuery = query; },
      rootId: editor?.block.rootID, notebookId: editor?.notebookId,
      origin,
      presentation: this.preferences.popupFirst ? "popup" : "tree",
      closeOnOutside: () => this.preferences.closeTreeOnOutside,
      open: async (block, match, searchQuery) => {
        const opened = await this.openBlock(block.id, block.root_id);
        if (this.destroyed) return;
        this.local?.close();
        this.lastQuery = searchQuery;
        this.local = new LocalSearch(opened, this.localHost(), searchQuery);
        this.local.focusMatch(block.id, match);
      },
    }, selected ?? this.lastQuery);
  }

  private async openBlock(id: string, rootId: string, preferred?: IProtyle): Promise<IProtyle> {
    this.revealing++;
    try {
      const open = async (): Promise<IProtyle> => {
        // Keep the complete document; SearchHighlighter paints the match without native block flash.
        const tab = await openTab({ app: this.app, doc: { id, action: ["cb-get-context", "cb-get-focus"], zoomIn: false }, keepCursor: false });
        const tabEditor = (tab?.model as unknown as { editor?: { protyle: IProtyle } } | undefined)?.editor?.protyle;
        return this.waitForEditor(() => {
          const candidates = [tabEditor, preferred, ...getAllEditor().map(item => item.protyle)];
          return candidates.find(editor => {
            if (!this.visible(editor) || editor.block.rootID !== rootId) return false;
            if (id === rootId) return true;
            const block = editor.element.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
            return !!block?.getClientRects().length;
          });
        });
      };
      let editor = await open();
      const focused = editor.block.showAll && editor.block.id && editor.block.id !== rootId;
      const fragment = editor.block.mode === 0 && editor.options?.blockId && editor.options.blockId !== rootId &&
        !editor.block.action?.includes("cb-get-context");
      // SiYuan may reuse an existing editor without applying the new context action.
      // Use its native controls to restore the document before locating the requested hit again.
      const restore = editor.element.querySelector<HTMLButtonElement>(focused ? '[data-type="exit-focus"]' : '[data-type="context"]');
      if (focused || (fragment && restore && !restore.classList.contains("block__icon--active"))) {
        if (!restore) throw new Error("无法恢复完整文档，请先在思源中退出块聚焦后重试。");
        const restoring = editor;
        restore.click();
        await this.waitForEditor(() => {
          if (!this.visible(restoring)) return;
          const ready = focused ? !restoring.block.showAll && restoring.block.id === rootId : restoring.block.mode === 3;
          return ready ? restoring : undefined;
        });
        editor = await open();
      }
      this.activeEditor = editor;
      return editor;
    } finally { this.revealing--; }
  }

  private waitForEditor(find: () => IProtyle | undefined): Promise<IProtyle> {
    const ready = find();
    if (ready) return Promise.resolve(ready);
    return new Promise<IProtyle>((resolve, reject) => {
      const observer = new MutationObserver(() => { const found = find(); if (found) { cleanup(); resolve(found); } });
      const timer = setTimeout(() => { cleanup(); reject(new Error("文档尚未加载完成，请重新打开结果。")); }, 6000);
      const cleanup = () => { observer.disconnect(); clearTimeout(timer); };
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "fold"] });
    });
  }

  onunload(): void {
    this.destroyed = true;
    clearTimeout(this.saveTimer);
    this.local?.close(); this.global?.close(false);
    window.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("focusin", this.onFocusIn, true);
    this.eventBus.off("switch-protyle", this.onSwitch);
    this.eventBus.off("destroy-protyle", this.onDestroyEditor);
  }
}
