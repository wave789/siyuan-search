interface HighlightSet { clear(): void }
interface HighlightAPI { highlights: Map<string, HighlightSet> }
type HighlightWindow = Window & { Highlight?: new (...ranges: Range[]) => HighlightSet; CSS: HighlightAPI };

/** CSS highlights leave the editable DOM and undo history untouched. */
export class SearchHighlighter {
  private readonly allName: string;
  private readonly activeName: string;
  private ranges: Range[] = [];
  private active?: Range;
  private overlay?: HTMLDivElement;
  private frame = 0;
  private readonly clip?: HTMLElement;
  constructor(namespace = "syp-search", clip?: HTMLElement) {
    this.clip = clip;
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
    } else {
      if (!this.overlay) {
        this.overlay = document.createElement("div");
        this.overlay.className = "syp-highlight-overlay";
        if (this.clip) this.overlay.style.zIndex = "10001";
        this.overlay.setAttribute("aria-hidden", "true");
        document.body.append(this.overlay);
        window.addEventListener("scroll", this.repaint, true);
        window.addEventListener("resize", this.repaint);
      }
      this.repaint();
    }
  }

  private paintFallback(): void {
    if (!this.overlay) return;
    this.overlay.replaceChildren();
    const bounds = this.clip?.getBoundingClientRect();
    for (const range of this.ranges.slice(0, 2000)) {
      for (const rect of range.getClientRects()) {
        if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
        const left = Math.max(rect.left, bounds?.left ?? 0), top = Math.max(rect.top, bounds?.top ?? 0);
        const right = Math.min(rect.right, bounds?.right ?? innerWidth), bottom = Math.min(rect.bottom, bounds?.bottom ?? innerHeight);
        if (right <= left || bottom <= top) continue;
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
    this.overlay?.remove();
    this.overlay = undefined;
    this.ranges = [];
    this.active = undefined;
  }
}
