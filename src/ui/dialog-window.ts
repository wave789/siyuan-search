import { defaultDialog, fitDialog, moveDialog, resizeDialog } from "./dialog-geometry.ts";
import type { DialogBounds, ResizeEdge, ViewportSize } from "./dialog-geometry.ts";

const EDGES: ResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const INTERACTIVE = 'button, input, textarea, select, a, [contenteditable="true"]';
interface Gesture {
  pointerId: number; x: number; y: number; initial: DialogBounds;
  edge?: ResizeEdge; capture: HTMLElement;
}

/** Native pointer events keep dragging independent of the host's mouse/keyboard handlers. */
export class DialogWindow {
  private readonly win: Window;
  private readonly handles: HTMLElement[] = [];
  private bounds: DialogBounds;
  private gesture?: Gesture;
  private destroyed = false;

  constructor(private readonly dialog: HTMLElement, private readonly header: HTMLElement) {
    this.win = dialog.ownerDocument.defaultView!;
    this.bounds = defaultDialog(this.viewport());
    this.render();
    header.title = "拖动移动窗口，双击恢复默认位置和大小";
    header.addEventListener("pointerdown", this.startMove);
    header.addEventListener("dblclick", this.reset);
    for (const edge of EDGES) {
      const handle = dialog.ownerDocument.createElement("div");
      handle.className = `syp-resize-handle syp-resize-handle--${edge}`;
      handle.dataset.resize = edge;
      handle.setAttribute("aria-hidden", "true");
      handle.title = "拖动调整窗口大小";
      handle.addEventListener("pointerdown", event => this.start(event, handle, edge));
      this.handles.push(handle); dialog.append(handle);
    }
    this.win.addEventListener("resize", this.onViewportResize);
  }

  private viewport(): ViewportSize { return { width: this.win.innerWidth, height: this.win.innerHeight }; }
  private isControl(event: Event): boolean { return !!(event.target as Element | null)?.closest?.(INTERACTIVE); }

  private render(): void {
    Object.assign(this.dialog.style, { left: `${this.bounds.left}px`, top: `${this.bounds.top}px`, width: `${this.bounds.width}px`, height: `${this.bounds.height}px` });
    this.dialog.classList.toggle("syp-dialog--compact", this.bounds.width <= 760);
  }

  private startMove = (event: PointerEvent): void => {
    if (!this.isControl(event)) this.start(event, this.header);
  };

  private start(event: PointerEvent, capture: HTMLElement, edge?: ResizeEdge): void {
    if (this.destroyed || this.gesture || event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    this.gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, initial: { ...this.bounds }, capture, edge };
    this.dialog.classList.add("syp-dialog--manipulating");
    this.dialog.style.cursor = edge ? `${edge}-resize` : "move";
    try { capture.setPointerCapture(event.pointerId); } catch { /* Window listeners also cover hosts without pointer capture. */ }
    this.win.addEventListener("pointermove", this.move, true);
    this.win.addEventListener("pointerup", this.end, true);
    this.win.addEventListener("pointercancel", this.end, true);
    this.win.addEventListener("blur", this.stop);
    capture.addEventListener("lostpointercapture", this.end);
  }

  private move = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    this.bounds = gesture.edge ? resizeDialog(gesture.initial, gesture.edge, dx, dy, this.viewport()) :
      moveDialog(gesture.initial, dx, dy, this.viewport());
    this.render();
  };

  private end = (event: PointerEvent): void => {
    if (!this.gesture || event.pointerId !== this.gesture.pointerId) return;
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
    gesture.capture.removeEventListener("lostpointercapture", this.end);
    try { if (gesture.capture.hasPointerCapture(gesture.pointerId)) gesture.capture.releasePointerCapture(gesture.pointerId); } catch { /* The dialog may already be detached. */ }
    this.dialog.classList.remove("syp-dialog--manipulating");
    this.dialog.style.cursor = "";
  };

  private onViewportResize = (): void => {
    this.stop(); this.bounds = fitDialog(this.bounds, this.viewport()); this.render();
  };

  private reset = (event: MouseEvent): void => {
    if (this.isControl(event)) return;
    event.preventDefault(); event.stopPropagation(); this.stop();
    this.bounds = defaultDialog(this.viewport()); this.render();
  };

  destroy(): void {
    this.destroyed = true; this.stop();
    this.win.removeEventListener("resize", this.onViewportResize);
    this.header.removeEventListener("pointerdown", this.startMove);
    this.header.removeEventListener("dblclick", this.reset);
    this.handles.forEach(handle => handle.remove());
  }
}
