export interface DialogBounds { left: number; top: number; width: number; height: number }
export interface ViewportSize { width: number; height: number }
export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

function limits(viewport: ViewportSize) {
  const margin = Math.min(8, viewport.width / 4, viewport.height / 4);
  const width = Math.max(1, viewport.width - margin * 2), height = Math.max(1, viewport.height - margin * 2);
  return { margin, width, height, minWidth: Math.min(480, width), minHeight: Math.min(320, height) };
}

/** Keep every edge reachable, including after the host window becomes smaller. */
export function fitDialog(bounds: DialogBounds, viewport: ViewportSize): DialogBounds {
  const limit = limits(viewport);
  const width = clamp(bounds.width, limit.minWidth, limit.width), height = clamp(bounds.height, limit.minHeight, limit.height);
  return { width, height,
    left: clamp(bounds.left, limit.margin, viewport.width - limit.margin - width),
    top: clamp(bounds.top, limit.margin, viewport.height - limit.margin - height) };
}

export function defaultDialog(viewport: ViewportSize): DialogBounds {
  const width = Math.min(1080, viewport.width - 48);
  return fitDialog({ left: (viewport.width - width) / 2, top: Math.min(viewport.height * 0.11, 100), width,
    height: Math.min(690, viewport.height * 0.8) }, viewport);
}

export function moveDialog(bounds: DialogBounds, dx: number, dy: number, viewport: ViewportSize): DialogBounds {
  return fitDialog({ ...bounds, left: bounds.left + dx, top: bounds.top + dy }, viewport);
}

export function resizeDialog(bounds: DialogBounds, edge: ResizeEdge, dx: number, dy: number, viewport: ViewportSize): DialogBounds {
  const start = fitDialog(bounds, viewport), limit = limits(viewport);
  let { left, top, width, height } = start;
  if (edge.includes("e")) width = clamp(start.width + dx, limit.minWidth, viewport.width - limit.margin - left);
  if (edge.includes("s")) height = clamp(start.height + dy, limit.minHeight, viewport.height - limit.margin - top);
  if (edge.includes("w")) { left = clamp(start.left + dx, limit.margin, start.left + start.width - limit.minWidth); width = start.left + start.width - left; }
  if (edge.includes("n")) { top = clamp(start.top + dy, limit.margin, start.top + start.height - limit.minHeight); height = start.top + start.height - top; }
  return { left, top, width, height };
}
