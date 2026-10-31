import { readBlock } from "../search/document.ts";
import type { TextMatch } from "../search/matcher.ts";
import { applyTextEdits, validateEdits } from "./edits.ts";

/** Work on a detached copy. Unmatched elements, inline styles, links and block IDs survive. */
export function replaceBlockDOM(element: HTMLElement, edits: TextMatch[]): string {
  const block = readBlock(element, element.dataset.nodeId || "");
  validateEdits(block.text, edits);
  const units = [...block.parts, ...(block.breaks || [])].sort((a, b) => a.start - b.start);
  const expected = applyTextEdits(block.text, edits);
  let referenceEdit = 0;
  for (const part of block.parts) {
    while (referenceEdit < edits.length && edits[referenceEdit].end <= part.start) referenceEdit++;
    if (referenceEdit === edits.length || edits[referenceEdit].start >= part.end) continue;
    const reference = part.node.parentElement?.closest('[data-type~="block-ref"]');
    // Editing a dynamic reference's visible label creates a static anchor to the same block.
    if (reference?.getAttribute("data-subtype") === "d") reference.setAttribute("data-subtype", "s");
  }
  // Most matches stay within one text node. Replace each such node once, even for dense code.
  const groups = new Map<(typeof block.parts)[number], TextMatch[]>();
  let partIndex = 0, isolated = true;
  for (const edit of edits) {
    while (partIndex < block.parts.length && block.parts[partIndex].end <= edit.start) partIndex++;
    const part = block.parts[partIndex];
    if (!part || edit.start < part.start || edit.end > part.end) { isolated = false; break; }
    if (!groups.has(part)) groups.set(part, []);
    groups.get(part)!.push({ ...edit, start: edit.start - part.start, end: edit.end - part.start });
  }
  if (isolated) {
    for (const [part, nodeEdits] of groups) {
      const next = applyTextEdits(part.node.data, nodeEdits);
      if (!next.includes("\n") || part.node.parentElement?.closest('[data-type="NodeCodeBlock"]')) part.node.data = next;
      else {
        const fragment = element.ownerDocument.createDocumentFragment();
        next.split("\n").forEach((line, index) => {
          if (index) fragment.append(element.ownerDocument.createElement("br"));
          fragment.append(element.ownerDocument.createTextNode(line));
        });
        part.node.replaceWith(fragment);
      }
    }
    if (readBlock(element, block.id).text !== expected) throw new Error("内容的格式结构不支持此次替换，原文未写入。");
    return element.outerHTML;
  }
  for (const edit of [...edits].reverse()) {
    const selected = units.filter(unit => unit.end > edit.start && unit.start < edit.end);
    const first = selected[0];
    if (!first) throw new Error("无法定位替换内容，请刷新搜索结果。");
    const document = element.ownerDocument;
    const fragment = document.createDocumentFragment();
    const inCode = !!first.node.parentElement?.closest('[data-type="NodeCodeBlock"]');
    if (inCode) fragment.append(document.createTextNode(edit.replacement!));
    else edit.replacement!.split("\n").forEach((line, index) => {
      if (index) fragment.append(document.createElement("br"));
      fragment.append(document.createTextNode(line));
    });
    // Keep the first text node in place, so earlier offsets remain valid when editing backwards.
    if (first.node.nodeType === Node.TEXT_NODE) {
      const text = first.node as Text;
      const start = Math.max(0, edit.start - first.start);
      const end = Math.min(text.length, edit.end - first.start);
      const suffix = text.data.slice(end);
      text.data = text.data.slice(0, start);
      if (suffix) fragment.append(document.createTextNode(suffix));
      text.parentNode!.insertBefore(fragment, text.nextSibling);
    } else {
      first.node.parentNode!.insertBefore(fragment, first.node);
      first.node.remove();
    }
    for (const unit of selected.slice(1)) {
      if (unit.node.nodeType === Node.TEXT_NODE) {
        const text = unit.node as Text;
        const start = Math.max(0, edit.start - unit.start), end = Math.min(text.length, edit.end - unit.start);
        text.data = text.data.slice(0, start) + text.data.slice(end);
      } else unit.node.remove();
    }
  }
  if (readBlock(element, block.id).text !== expected) throw new Error("内容的格式结构不支持此次替换，原文未写入。");
  return element.outerHTML;
}
