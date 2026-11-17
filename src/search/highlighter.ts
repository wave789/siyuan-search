interface HighlightSet { clear(): void }
interface HighlightAPI { highlights: Map<string, HighlightSet> }
type HighlightWindow = Window & { Highlight?: new (...ranges: Range[]) => HighlightSet; CSS: HighlightAPI };
type HighlightClip = HTMLElement | (() => HTMLElement | undefined);
interface HighlightOptions { overlay?: boolean; overlayZIndex?: number }

/** Search marks leave the editable DOM and undo history untouched. */
export class SearchHighlighter {
  private readonly allName: string;
  private readonly activeName: string;
  private ranges: Range[] = [];
  private active?: Range;
  private overlay?: HTMLDivElement;
  private resizeObserver?: ResizeObserver;
  private observedClip?: HTMLElement;
  private frame = 0;
  private readonly clip?: HighlightClip;
  private readonly options: HighlightOptions;
  constructor(namespace = "syp-search", clip?: HighlightClip, options: HighlightOptions = {}) {
    this.clip = clip; this.options = options;
    this.allName = `${namespace}-all`; this.activeName = `${namespace}-active`;
  }
  private readonly repaint = () => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.paintFallback());
  };
  private get native() { const win = window as unknown as HighlightWindow; return !!(win.Highlight && win.CSS?.highlights); }

  set(ranges: Range[], active?: Range): void {
    this.ranges = ranges;
    this.active = active;
    if (this.native) {
      const win = window as unknown as HighlightWindow;
      win.CSS.highlights.set(this.allName, new win.Highlight!(...ranges));
      win.CSS.highlights.set(this.activeName, new win.Highlight!(...(active ? [active] : [])));
    }
    // Native Highlight registration can succeed without a visible paint in the host editor.
    // A character-sized overlay also keeps find usable in that case, without editing note DOM.
    if (!this.native || this.options.overlay) {
      if (!this.overlay) {
        this.overlay = document.createElement("div");
        this.overlay.className = "syp-highlight-overlay";
        if (this.options.overlayZIndex !== undefined || this.clip) this.overlay.style.zIndex = String(this.options.overlayZIndex ?? 10001);
        this.overlay.setAttribute("aria-hidden", "true");
        document.body.append(this.overlay);
        window.addEventListener("scroll", this.repaint, true);
        window.addEventListener("resize", this.repaint);
      }
      const clip = this.clipElement;
      if (clip !== this.observedClip) {
        this.resizeObserver?.disconnect();
        this.observedClip = clip;
        if (clip && typeof ResizeObserver !== "undefined") {
          this.resizeObserver ??= new ResizeObserver(this.repaint);
          this.resizeObserver.observe(clip);
        }
      }
      this.repaint();
    }
  }

  private get clipElement(): HTMLElement | undefined { return typeof this.clip === "function" ? this.clip() : this.clip; }

  private paintFallback(): void {
    if (!this.overlay) return;
    this.overlay.replaceChildren();
    const bounds = this.clipElement?.getBoundingClientRect();
    const clips = new Map<Element, { left: number; top: number; right: number; bottom: number }>();
    // Paint the current occurrence last, even when it is beyond the passive highlight limit.
    const ranges = this.ranges.filter(range => range !== this.active).slice(0, 2000);
    if (this.active) ranges.push(this.active);
    for (const range of ranges) {
      let leftBound = bounds?.left ?? 0, topBound = bounds?.top ?? 0;
      let rightBound = bounds?.right ?? innerWidth, bottomBound = bounds?.bottom ?? innerHeight;
      // Code blocks and tables may scroll inside the document's own scroller.
      const common = range.commonAncestorContainer;
      for (let parent = common?.nodeType === 1 ? common as Element : common?.parentElement; parent; parent = parent.parentElement) {
        let clip = clips.get(parent);
        if (!clip) {
          const style = window.getComputedStyle(parent), rect = parent.getBoundingClientRect();
          const x = /auto|scroll|hidden|clip/.test(style.overflowX), y = /auto|scroll|hidden|clip/.test(style.overflowY);
          clip = { left: x ? rect.left + parent.clientLeft : -Infinity, right: x ? rect.left + parent.clientLeft + parent.clientWidth : Infinity,
            top: y ? rect.top + parent.clientTop : -Infinity, bottom: y ? rect.top + parent.clientTop + parent.clientHeight : Infinity };
          clips.set(parent, clip);
        }
        leftBound = Math.max(leftBound, clip.left); rightBound = Math.min(rightBound, clip.right);
        topBound = Math.max(topBound, clip.top); bottomBound = Math.min(bottomBound, clip.bottom);
      }
      const painted = new Set<string>();
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
        const left = Math.max(rect.left, leftBound), top = Math.max(rect.top, topBound);
        const right = Math.min(rect.right, rightBound), bottom = Math.min(rect.bottom, bottomBound);
        if (right <= left || bottom <= top) continue;
        const key = `${left},${top},${right},${bottom}`;
        if (painted.has(key)) continue;
        painted.add(key);
        const marker = document.createElement("span");
        marker.className = range === this.active ? "syp-highlight syp-highlight--active" : "syp-highlight";
        Object.assign(marker.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
        this.overlay.append(marker);
      }
    }
  }

  clear(): void {
    cancelAnimationFrame(this.frame);
    const win = window as unknown as HighlightWindow;
    win.CSS?.highlights?.delete(this.allName);
    win.CSS?.highlights?.delete(this.activeName);
    window.removeEventListener("scroll", this.repaint, true);
    window.removeEventListener("resize", this.repaint);
    this.resizeObserver?.disconnect();
    this.observedClip = undefined;
    this.overlay?.remove();
    this.overlay = undefined;
    this.ranges = [];
    this.active = undefined;
  }
}
