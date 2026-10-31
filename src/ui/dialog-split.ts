const DEFAULT_RATIO = 0.44;
const DIVIDER_HEIGHT = 7;
interface Gesture { pointerId: number; position: number; first: number }

/** Resize only the result/preview panes; keep their contents and the search focus intact. */
export class DialogSplit {
  private readonly win: Window;
  private readonly observer: ResizeObserver;
  private ratio = DEFAULT_RATIO;
  private gesture?: Gesture;
  private destroyed = false;

  constructor(private readonly body: HTMLElement, private readonly separator: HTMLElement, private readonly axis: "rows" | "columns" = "rows") {
    this.win = body.ownerDocument.defaultView!;
    if (axis === "columns") { this.ratio = 0.45; body.classList.add("syp-dialog-body--columns"); }
    separator.className = `syp-pane-divider${axis === "columns" ? " syp-pane-divider--vertical" : ""}`;
    separator.setAttribute("role", "separator");
    separator.setAttribute("aria-orientation", axis === "columns" ? "vertical" : "horizontal");
    separator.setAttribute("aria-label", axis === "columns" ? "调整目录树与文档预览的宽度" : "调整搜索结果与文档预览的高度");
    separator.tabIndex = 0;
    separator.title = axis === "columns" ? "左右拖动调整比例，双击恢复；聚焦后可用 ← → 调整" : "上下拖动调整比例，双击恢复；聚焦后可用 ↑ ↓ 调整";
    separator.addEventListener("pointerdown", this.start);
    separator.addEventListener("keydown", this.keydown);
    separator.addEventListener("dblclick", this.reset);
    this.observer = new ResizeObserver(() => this.render());
    this.observer.observe(body);
    this.render();
  }

  private sizes(): { usable: number; min: number; max: number } {
    const columns = this.axis === "columns";
    const usable = Math.max(0, (columns ? this.body.clientWidth : this.body.clientHeight) - DIVIDER_HEIGHT);
    const first = columns ? 180 : 80, second = columns ? 220 : 100, scale = Math.min(1, usable / (first + second));
    return { usable, min: first * scale, max: usable - second * scale };
  }

  private render(top?: number): void {
    if (this.destroyed) return;
    const { usable, min, max } = this.sizes();
    if (usable > 0) this.ratio = Math.min(max, Math.max(min, top ?? this.ratio * usable)) / usable;
    const tracks = `minmax(0, ${this.ratio}fr) ${DIVIDER_HEIGHT}px minmax(0, ${1 - this.ratio}fr)`;
    this.body.style.gridTemplateRows = this.axis === "rows" ? tracks : "minmax(0, 1fr)";
    this.body.style.gridTemplateColumns = this.axis === "columns" ? tracks : "minmax(0, 1fr)";
    this.separator.setAttribute("aria-valuemin", String(usable ? Math.round(min / usable * 100) : 0));
    this.separator.setAttribute("aria-valuemax", String(usable ? Math.round(max / usable * 100) : 100));
    this.separator.setAttribute("aria-valuenow", String(Math.round(this.ratio * 100)));
    this.separator.setAttribute("aria-valuetext", `${this.axis === "columns" ? "目录树" : "搜索结果"} ${Math.round(this.ratio * 100)}%，文档预览 ${Math.round((1 - this.ratio) * 100)}%`);
  }

  private start = (event: PointerEvent): void => {
    if (this.destroyed || this.gesture || event.button !== 0 || event.isPrimary === false) return;
    const { usable } = this.sizes();
    if (!usable) return;
    event.preventDefault(); event.stopPropagation();
    this.gesture = { pointerId: event.pointerId, position: this.axis === "columns" ? event.clientX : event.clientY, first: usable * this.ratio };
    this.body.classList.add("syp-dialog-body--splitting");
    try { this.separator.setPointerCapture(event.pointerId); } catch { /* Window events also cover missing pointer capture. */ }
    this.win.addEventListener("pointermove", this.move, true);
    this.win.addEventListener("pointerup", this.end, true);
    this.win.addEventListener("pointercancel", this.end, true);
    this.win.addEventListener("blur", this.stop);
    this.separator.addEventListener("lostpointercapture", this.end);
  };

  private move = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    this.render(this.gesture.first + (this.axis === "columns" ? event.clientX : event.clientY) - this.gesture.position);
  };

  private end = (event: PointerEvent): void => {
    if (event.pointerId !== this.gesture?.pointerId) return;
    event.stopPropagation(); this.stop();
  };

  private stop = (): void => {
    const gesture = this.gesture;
    if (!gesture) return;
    this.gesture = undefined;
    this.win.removeEventListener("pointermove", this.move, true);
    this.win.removeEventListener("pointerup", this.end, true);
    this.win.removeEventListener("pointercancel", this.end, true);
    this.win.removeEventListener("blur", this.stop);
    this.separator.removeEventListener("lostpointercapture", this.end);
    try { if (this.separator.hasPointerCapture(gesture.pointerId)) this.separator.releasePointerCapture(gesture.pointerId); } catch { /* May already be detached. */ }
    this.body.classList.remove("syp-dialog-body--splitting");
  };

  private keydown = (event: KeyboardEvent): void => {
    const decrease = this.axis === "columns" ? "ArrowLeft" : "ArrowUp", increase = this.axis === "columns" ? "ArrowRight" : "ArrowDown";
    if (event.isComposing || ![decrease, increase, "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); this.stop();
    const { usable, min, max } = this.sizes();
    const step = event.shiftKey ? 50 : 16;
    this.render(event.key === "Home" ? min : event.key === "End" ? max : this.ratio * usable + (event.key === decrease ? -step : step));
  };

  private reset = (event: MouseEvent): void => {
    event.preventDefault(); event.stopPropagation(); this.stop();
    this.ratio = this.axis === "columns" ? 0.45 : DEFAULT_RATIO; this.render();
  };

  destroy(): void {
    this.destroyed = true; this.stop(); this.observer.disconnect();
    this.body.classList.remove("syp-dialog-body--columns");
    this.separator.removeEventListener("pointerdown", this.start);
    this.separator.removeEventListener("keydown", this.keydown);
    this.separator.removeEventListener("dblclick", this.reset);
  }
}
