import { buildResultTree, resultAncestors } from "../search/result-tree.ts";
import type { ResultBranch, SearchHit } from "../search/result-tree.ts";
import { matchingLine } from "../search/result-presentation.ts";
import { el, highlightedText } from "./shared.ts";
import { icon } from "./icons.ts";

interface Row { key: string; element: HTMLElement; branch?: ResultBranch; index?: number; parent?: string }

export class ResultTree {
  private branches: ResultBranch[] = [];
  private readonly expansion = new Map<string, boolean>();
  private rows: Row[] = [];
  private hits: readonly SearchHit[] = [];
  private selected = -1;
  private shown = 100;
  private active?: string;
  private enabled = false;

  constructor(private readonly list: HTMLElement, private readonly choose: (index: number) => void, private readonly open: () => void) {
    list.addEventListener("keydown", this.keydown);
  }

  render(hits: readonly SearchHit[], selected: number, shown: number, notebooks: ReadonlyMap<string, string>): void {
    this.enabled = true; this.hits = hits; this.selected = selected; this.shown = shown;
    if (this.active?.startsWith("hit:")) this.active = selected >= 0 ? `hit:${selected}` : undefined;
    this.branches = buildResultTree(hits, notebooks); this.paint();
  }

  private paint(): void {
    const top = this.list.scrollTop, left = this.list.scrollLeft;
    const content = el("div", "syp-tree-content"); this.rows = [];
    const walk = (branches: readonly ResultBranch[], parent: HTMLElement, depth: number, parentKey?: string): void => {
      for (const branch of branches) {
        if (branch.first >= this.shown) continue;
        const expanded = this.isExpanded(branch), item = el("div", "syp-tree-item"); item.setAttribute("role", "none");
        const row = el("div", "syp-tree-branch"); row.style.paddingLeft = `${10 + depth * 18}px`;
        row.dataset.kind = branch.kind;
        row.setAttribute("role", "treeitem"); row.setAttribute("aria-level", String(depth + 1)); row.setAttribute("aria-expanded", String(expanded));
        row.title = `${branch.path} · ${branch.count} 处匹配`;
        const arrow = icon("chevronRight", "syp-icon syp-tree-chevron");
        row.append(arrow, icon(branch.kind === "document" ? "document" : "folder"), el("span", "syp-tree-label", branch.label), el("span", "syp-tree-count", `${branch.count} 处匹配`));
        this.addRow({ key: branch.key, branch, element: row, parent: parentKey });
        row.addEventListener("click", () => { this.active = branch.key; this.toggle(branch); this.list.focus({ preventScroll: true }); });
        item.append(row);
        if (expanded) {
          const group = el("div", "syp-tree-group"); group.setAttribute("role", "group");
          group.id = `${row.id}-children`; row.setAttribute("aria-owns", group.id);
          for (const index of branch.hits) {
            if (index >= this.shown) continue;
            const hit = this.hits[index]!, line = matchingLine(hit.block.content, hit.match);
            const match = el("div", "syp-result syp-tree-match"); match.style.paddingLeft = `${28 + depth * 18}px`;
            match.id = `syp-result-${index}`; match.dataset.index = String(index);
            match.setAttribute("role", "treeitem"); match.setAttribute("aria-level", String(depth + 2)); match.setAttribute("aria-selected", String(index === this.selected));
            match.title = `${branch.path} · 块内第 ${line.line} 行，第 ${line.column} 列\n${line.text}`;
            const snippet = el("span", "syp-tree-line"); snippet.append(highlightedText(line.text, line.match, Infinity));
            if (line.newline) snippet.append(el("mark", "syp-mark", "↵"));
            const number = el("span", "syp-tree-line-number", String(line.line)); number.title = "匹配所在内容块内的行号";
            match.append(number, snippet);
            this.addRow({ key: `hit:${index}`, index, element: match, parent: branch.key });
            match.addEventListener("click", () => this.choose(index));
            match.addEventListener("dblclick", () => { this.choose(index); this.open(); });
            group.append(match);
          }
          walk(branch.children, group, depth + 1, branch.key); item.append(group);
        }
        parent.append(item);
      }
    };
    walk(this.branches, content, 0); this.list.replaceChildren(content);
    this.list.scrollTop = top; this.list.scrollLeft = left;
    this.activeRow();
  }

  private addRow(row: Row): void {
    if (row.branch) row.element.id = `syp-tree-node-${this.rows.length}`;
    this.rows.push(row);
  }
  private activeRow(): void {
    const ancestors = resultAncestors(this.branches, this.selected).reverse();
    const row = this.rows.find(row => row.key === this.active) || this.rows.find(row => row.index === this.selected) ||
      ancestors.map(key => this.rows.find(row => row.key === key)).find(Boolean) || this.rows[0];
    this.active = row?.key;
    this.rows.forEach(item => {
      item.element.classList.toggle("syp-tree-row--active", item === row);
      if (item.index !== undefined) item.element.setAttribute("aria-selected", String(item.index === this.selected));
      else if (item.branch?.kind === "document") item.element.setAttribute("aria-selected", String(!this.isExpanded(item.branch) && item.branch.hits.includes(this.selected)));
    });
    if (row) this.list.setAttribute("aria-activedescendant", row.element.id);
  }
  private isExpanded(branch: ResultBranch): boolean {
    return this.expansion.get(branch.key) ?? branch.kind !== "document";
  }
  private toggle(branch: ResultBranch): void {
    this.expansion.set(branch.key, !this.isExpanded(branch));
    this.paint();
  }
  select(index: number, revealMatch = true): void {
    this.selected = index; this.active = `hit:${index}`;
    if (revealMatch && !this.rows.some(row => row.index === index)) {
      resultAncestors(this.branches, index).forEach(key => this.expansion.set(key, true)); this.paint();
    }
    this.activeRow();
  }
  private keydown = (event: KeyboardEvent): void => {
    if (!this.enabled || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "Enter", " "];
    if (!keys.includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    let position = Math.max(0, this.rows.findIndex(row => row.key === this.active));
    const current = this.rows[position]; if (!current) return;
    if (event.key === "ArrowLeft") {
      if (current.branch && this.isExpanded(current.branch)) { this.toggle(current.branch); return; }
      position = Math.max(0, this.rows.findIndex(row => row.key === current.parent));
    } else if (event.key === "ArrowRight") {
      if (!current.branch) return;
      if (!this.isExpanded(current.branch)) { this.toggle(current.branch); return; }
      position = Math.min(this.rows.length - 1, position + 1);
    } else if (["Enter", " "].includes(event.key)) {
      if (current.branch) this.toggle(current.branch);
      else if (current.index !== undefined) { this.choose(current.index); if (event.key === "Enter") this.open(); }
      return;
    } else position = event.key === "Home" ? 0 : event.key === "End" ? this.rows.length - 1 : Math.max(0, Math.min(this.rows.length - 1, position + (event.key === "ArrowDown" ? 1 : -1)));
    const next = this.rows[position]!; this.active = next.key;
    if (next.index !== undefined) this.choose(next.index); else this.activeRow();
    const bounds = next.element.getBoundingClientRect(), view = this.list.getBoundingClientRect();
    if (bounds.top < view.top) this.list.scrollTop += bounds.top - view.top;
    else if (bounds.bottom > view.bottom) this.list.scrollTop += bounds.bottom - view.bottom;
  };
  reset(): void { this.expansion.clear(); this.rows = []; this.branches = []; this.hits = []; this.active = undefined; }
  destroy(): void { this.enabled = false; this.reset(); this.list.removeEventListener("keydown", this.keydown); }
}
