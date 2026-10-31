import { liveBlocks } from "./document.ts";
import type { DocumentBlock } from "./document.ts";

export interface SearchAnchor { blockId: string; start: number; end: number }
export interface SearchOrigin {
  editor: HTMLElement;
  anchor?: SearchAnchor;
  selection?: Range;
  scroll: { element: HTMLElement; top: number; left: number }[];
}

/** Use the same normalized text offsets as matching, including BRs and split inline nodes. */
export function pointOffset(block: DocumentBlock, container: Node, offset: number): number | undefined {
  if (!block.element?.contains(container)) return;
  const part = block.parts.find(part => part.node === container);
  if (part) return offset >= 0 && offset <= part.end - part.start ? part.start + offset : undefined;
  const lineBreak = block.breaks?.find(part => part.node === container);
  if (lineBreak) return lineBreak.start;
  const point = block.element.ownerDocument.createRange();
  point.setStart(container, offset); point.collapse(true);
  const units = [...block.parts, ...(block.breaks || [])].sort((first, second) => first.start - second.start);
  let end = 0;
  for (const unit of units) {
    if (point.comparePoint(unit.node, 0) >= 0) return unit.start;
    end = unit.end;
  }
  return end;
}

export function selectionAnchor(blocks: DocumentBlock[], range: Range): SearchAnchor | undefined {
  for (const block of blocks) {
    const start = pointOffset(block, range.startContainer, range.startOffset);
    if (start === undefined) continue;
    const end = pointOffset(block, range.endContainer, range.endOffset);
    if (end !== undefined && end >= start) return { blockId: block.id, start, end };
  }
}

export function anchoredHitIndex(hits: SearchAnchor[], anchor?: SearchAnchor): number {
  if (!hits.length) return -1;
  if (!anchor) return 0;
  const exact = hits.findIndex(hit => hit.blockId === anchor.blockId && hit.start === anchor.start && hit.end === anchor.end);
  if (exact >= 0) return exact;
  const containing = hits.findIndex(hit => hit.blockId === anchor.blockId && hit.start <= anchor.start && hit.end >= anchor.end);
  if (containing >= 0) return containing;
  const after = hits.findIndex(hit => hit.blockId === anchor.blockId && hit.start >= anchor.start);
  if (after >= 0) return after;
  for (let index = hits.length - 1; index >= 0; index--) if (hits[index].blockId === anchor.blockId) return index;
  return 0;
}

/** Capture before inserting the bar or focusing its input; those operations can change layout. */
export function captureSearchOrigin(editor: HTMLElement, rootId: string, range?: Range): SearchOrigin {
  const valid = range && editor.contains(range.startContainer) && editor.contains(range.endContainer) ? range : undefined;
  const elements = new Set<HTMLElement>(editor.querySelectorAll<HTMLElement>(".protyle-content"));
  elements.add(editor);
  let ancestor = valid?.startContainer.nodeType === 1 ? valid.startContainer as HTMLElement : valid?.startContainer.parentElement;
  while (ancestor && editor.contains(ancestor)) { elements.add(ancestor); if (ancestor === editor) break; ancestor = ancestor.parentElement; }
  return { editor, anchor: valid ? selectionAnchor(liveBlocks(editor, rootId), valid) : undefined,
    selection: valid?.cloneRange(), scroll: Array.from(elements, element => ({ element, top: element.scrollTop, left: element.scrollLeft })) };
}

export function restoreOriginScroll(origin: SearchOrigin): void {
  for (const { element, top, left } of origin.scroll) if (element.isConnected && origin.editor.contains(element)) {
    if (element.scrollTop !== top) element.scrollTop = top;
    if (element.scrollLeft !== left) element.scrollLeft = left;
  }
}
