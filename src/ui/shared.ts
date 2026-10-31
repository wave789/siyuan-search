import type { SearchOptions, TextMatch } from "../search/matcher.ts";
import { icon } from "./icons.ts";
import type { IconName } from "./icons.ts";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(text: string, title: string, onClick: () => void, className = "syp-button"): HTMLButtonElement {
  const node = el("button", className, text);
  node.type = "button";
  node.title = title;
  node.setAttribute("aria-label", title);
  node.addEventListener("click", onClick);
  return node;
}

export function iconButton(name: IconName, title: string, onClick: () => void, className = "syp-button"): HTMLButtonElement {
  const node = button("", title, onClick, `${className} syp-icon-button`);
  node.append(icon(name));
  return node;
}

export function optionButtons(options: SearchOptions, changed: () => void): HTMLElement {
  const group = el("div", "syp-options");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "匹配选项");
  const defs: [keyof SearchOptions, string, string][] = [
    ["caseSensitive", "Cc", "区分大小写（Alt+C）"],
    ["wholeWord", "W", "整词匹配（Alt+W）"],
    ["regex", ".*", "正则表达式（Alt+R）"],
  ];
  const buttons = new Map<string, HTMLButtonElement>();
  for (const [key, text, title] of defs) {
    const node = button(text, title, () => toggle(key), "syp-button syp-option");
    node.dataset.option = key;
    node.setAttribute("aria-pressed", String(options[key]));
    buttons.set(key, node);
    group.append(node);
  }
  function toggle(key: keyof SearchOptions) {
    options[key] = !options[key];
    buttons.get(key)!.setAttribute("aria-pressed", String(options[key]));
    changed();
  }
  // The group is used by its owning toolbar for Alt shortcuts.
  group.addEventListener("syp-toggle", ((event: CustomEvent<keyof SearchOptions>) => toggle(event.detail)) as EventListener);
  return group;
}

export function toggleByKey(event: KeyboardEvent, group: HTMLElement): boolean {
  const key = ({ c: "caseSensitive", w: "wholeWord", r: "regex" } as Record<string, keyof SearchOptions>)[event.key.toLowerCase()];
  if (!event.altKey || event.ctrlKey || event.metaKey || !key) return false;
  event.preventDefault();
  event.stopPropagation();
  group.dispatchEvent(new CustomEvent("syp-toggle", { detail: key }));
  return true;
}

/** All note content is inserted as text; search results cannot introduce HTML. */
export function highlightedText(text: string, match: TextMatch, context = 65): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const start = Math.max(0, match.start - context), end = Math.min(text.length, match.end + context);
  fragment.append(document.createTextNode(`${start ? "…" : ""}${text.slice(start, match.start)}`));
  fragment.append(el("mark", "syp-mark", text.slice(match.start, match.end)));
  fragment.append(document.createTextNode(`${text.slice(match.end, end)}${end < text.length ? "…" : ""}`));
  return fragment;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "搜索失败，请重试。";
}

export function isAbort(error: unknown): boolean { return error instanceof DOMException && error.name === "AbortError"; }

let replaceId = 0;
export class ReplaceControls {
  readonly row = el("div", "syp-replace-row");
  readonly input = el("input", "syp-input syp-replacement-input");
  readonly toggle: HTMLButtonElement;
  readonly replace: HTMLButtonElement;
  readonly all: HTMLButtonElement;
  readonly undo: HTMLButtonElement;
  private expanded = false;

  constructor(actions: { single: () => void; all: () => void; undo: () => void }, allLabel = "全部替换") {
    this.row.id = `syp-replace-${++replaceId}`;
    this.row.hidden = true;
    this.input.placeholder = "替换为…（留空则删除匹配内容）";
    this.input.setAttribute("aria-label", "替换文本");
    this.input.autocomplete = "off"; this.input.spellcheck = false;
    this.toggle = iconButton("chevronRight", "展开替换", () => this.setExpanded(!this.expanded), "syp-button syp-replace-toggle");
    this.toggle.setAttribute("aria-expanded", "false"); this.toggle.setAttribute("aria-controls", this.row.id);
    this.replace = button("替换", "替换当前匹配", actions.single, "syp-action");
    this.all = button(allLabel, "替换当前搜索范围内的全部匹配", actions.all, "syp-action");
    this.undo = button("撤销替换", "撤销上一次由插件执行的替换", actions.undo, "syp-action syp-undo-replace");
    const symbol = el("span", "syp-replace-symbol"); symbol.append(icon("replace"));
    this.row.append(symbol, this.input, this.replace, this.all, this.undo);
    this.input.addEventListener("keydown", event => {
      if (event.isComposing || event.key !== "Enter") return;
      event.preventDefault(); event.stopPropagation();
      if (event.ctrlKey || event.metaKey) { if (!this.all.disabled) actions.all(); }
      else if (!this.replace.disabled) actions.single();
    });
    this.update(false, false, false);
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded; this.row.hidden = !expanded;
    this.toggle.title = expanded ? "收起替换" : "展开替换";
    this.toggle.setAttribute("aria-label", this.toggle.title);
    this.toggle.setAttribute("aria-expanded", String(expanded));
    if (expanded) this.input.focus();
  }

  update(single: boolean, all: boolean, canUndo: boolean, busy = false): void {
    this.replace.disabled = busy || !single; this.all.disabled = busy || !all;
    this.undo.disabled = busy || !canUndo; this.undo.hidden = !canUndo && !busy;
    this.input.disabled = busy; this.toggle.disabled = busy;
  }
}
