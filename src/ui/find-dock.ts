interface Area { left: number; top: number; width: number; height: number }
interface Gesture { pointerId: number; y: number; height: number }

export function fitFindDock(area: Area, requested: number): Area {
  const minimum = Math.min(240, area.height * .65), maximum = Math.max(minimum, area.height - 120);
  const height = Math.max(0, Math.min(maximum, Math.max(minimum, requested)));
  return { left: area.left, top: area.top + area.height - height, width: area.width, height };
}

/** Reserve space inside the editor center, leaving both sidebars at their full height. */
export class FindDock {
  private readonly win: Window;
  private readonly resizeObserver: ResizeObserver;
  private readonly layoutObserver: MutationObserver;
  private readonly handle: HTMLElement;
  private anchor?: HTMLElement;
  private height?: number;
  private gesture?: Gesture;
  private destroyed = false;

  constructor(private readonly dialog: HTMLElement, private readonly preferred?: HTMLElement) {
    const doc = dialog.ownerDocument; this.win = doc.defaultView!;
    this.handle = doc.createElement("div"); this.handle.className = "syp-find-dock-resize"; this.handle.tabIndex = 0;
    this.handle.setAttribute("role", "separator"); this.handle.setAttribute("aria-orientation", "horizontal");
    this.handle.setAttribute("aria-label", "调整底部查找面板的高度");
    this.handle.title = "上下拖动调整面板高度，双击恢复；聚焦后可用 ↑ ↓ 调整";
    this.handle.addEventListener("pointerdown", this.start);
    this.handle.addEventListener("keydown", this.keydown);
    this.handle.addEventListener("dblclick", this.reset);
    dialog.append(this.handle);
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.layoutObserver = new MutationObserver(() => { if (!this.anchor?.isConnected) this.render(); });
    this.layoutObserver.observe(doc.body, { subtree: true, childList: true });
    this.win.addEventListener("resize", this.resize);
    this.render();
  }

  private resolveAnchor(): HTMLElement {
    const doc = this.dialog.ownerDocument, preferred = this.preferred?.isConnected ? this.preferred : undefined;
    return preferred?.closest<HTMLElement>(".layout__center") || doc.querySelector<HTMLElement>(".layout__center") ||
      preferred?.closest<HTMLElement>(".layout-tab-container") || doc.querySelector<HTMLElement>(".layout-tab-container") || doc.body;
  }
  private releaseAnchor(): void {
    this.anchor?.classList.remove("syp-find-host");
    this.anchor?.style.removeProperty("--syp-find-height"); this.anchor?.style.removeProperty("--syp-find-base-padding");
  }
  private area(): Area {
    const rect = this.anchor!.getBoundingClientRect();
    const left = Math.max(0, rect.left), top = Math.max(0, rect.top);
    return { left, top, width: Math.max(0, Math.min(this.win.innerWidth, rect.right) - left), height: Math.max(0, Math.min(this.win.innerHeight, rect.bottom) - top) };
  }
  private render(): void {
    if (this.destroyed) return;
    const anchor = this.resolveAnchor();
    if (anchor !== this.anchor) {
      this.releaseAnchor(); this.resizeObserver.disconnect(); this.anchor = anchor;
      const padding = this.win.getComputedStyle(anchor).paddingBottom || "0px";
      anchor.style.setProperty("--syp-find-base-padding", padding); anchor.classList.add("syp-find-host");
      this.resizeObserver.observe(anchor);
    }
    const area = this.area(), rect = fitFindDock(area, this.height ?? area.height * .48);
    this.height = rect.height;
    anchor.style.setProperty("--syp-find-height", `${rect.height}px`);
    Object.assign(this.dialog.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    this.dialog.classList.toggle("syp-dialog--compact", rect.width <= 760);
    const min = fitFindDock(area, 0).height, max = fitFindDock(area, Infinity).height;
    this.handle.setAttribute("aria-valuemin", String(Math.round(min))); this.handle.setAttribute("aria-valuemax", String(Math.round(max)));
    this.handle.setAttribute("aria-valuenow", String(Math.round(rect.height))); this.handle.setAttribute("aria-valuetext", `查找面板高度 ${Math.round(rect.height)} 像素`);
  }
  private start = (event: PointerEvent): void => {
    if (this.destroyed || this.gesture || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    this.gesture = { pointerId: event.pointerId, y: event.clientY, height: this.height || 0 };
    this.dialog.classList.add("syp-find-dock--resizing");
    try { this.handle.setPointerCapture(event.pointerId); } catch { /* Window listeners cover hosts without capture. */ }
    this.win.addEventListener("pointermove", this.move, true); this.win.addEventListener("pointerup", this.end, true);
    this.win.addEventListener("pointercancel", this.end, true); this.win.addEventListener("blur", this.stop);
    this.handle.addEventListener("lostpointercapture", this.end);
  };
  private move = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    this.height = this.gesture.height + this.gesture.y - event.clientY; this.render();
  };
  private end = (event: PointerEvent): void => { if (event.pointerId === this.gesture?.pointerId) { event.stopPropagation(); this.stop(); } };
  private stop = (): void => {
    const gesture = this.gesture; if (!gesture) return; this.gesture = undefined;
    this.win.removeEventListener("pointermove", this.move, true); this.win.removeEventListener("pointerup", this.end, true);
    this.win.removeEventListener("pointercancel", this.end, true); this.win.removeEventListener("blur", this.stop);
    this.handle.removeEventListener("lostpointercapture", this.end);
    try { if (this.handle.hasPointerCapture(gesture.pointerId)) this.handle.releasePointerCapture(gesture.pointerId); } catch { /* May be detached. */ }
    this.dialog.classList.remove("syp-find-dock--resizing");
  };
  private keydown = (event: KeyboardEvent): void => {
    if (event.isComposing || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); this.stop();
    this.height = event.key === "Home" ? 0 : event.key === "End" ? Infinity : (this.height || 0) + (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 60 : 20);
    this.render();
  };
  private resize = (): void => { this.stop(); this.render(); };
  private reset = (event: MouseEvent): void => { event.preventDefault(); event.stopPropagation(); this.stop(); this.height = undefined; this.render(); };
  destroy(): void {
    this.destroyed = true; this.stop(); this.resizeObserver.disconnect(); this.layoutObserver.disconnect();
    this.win.removeEventListener("resize", this.resize);
    this.handle.removeEventListener("pointerdown", this.start); this.handle.removeEventListener("keydown", this.keydown); this.handle.removeEventListener("dblclick", this.reset);
    this.handle.remove(); this.releaseAnchor();
  }
}
