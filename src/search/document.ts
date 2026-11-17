import type { TextMatch } from "./matcher.ts";

export interface TextPart { node: Text; start: number; end: number }
export interface BreakPart { node: HTMLBRElement; start: number; end: number }
export interface DocumentBlock { breaks?: BreakPart[]; id: string; text: string; element?: HTMLElement; parts: TextPart[] }
const SKIP = '.protyle-action, .protyle-attr, .hljs-ln-numbers, .code-block__language, .render-node, script, style, [data-type="NodeBlockQueryEmbed"], [data-type="NodeAttributeView"]';

export function readBlock(element: HTMLElement, id: string): DocumentBlock {
  const parts: TextPart[] = [];
  const breaks: BreakPart[] = [];
  let text = "";
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if ((node as Element).matches(SKIP)) return NodeFilter.FILTER_REJECT;
        if ((node as Element).tagName === "BR") return NodeFilter.FILTER_ACCEPT;
        return NodeFilter.FILTER_SKIP;
      }
      return node.textContent && !/^[\u200b\ufeff]+$/.test(node.textContent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.ELEMENT_NODE) { breaks.push({ node: node as HTMLBRElement, start: text.length, end: text.length + 1 }); text += "\n"; continue; }
    const value = node.textContent || "";
    parts.push({ node: node as Text, start: text.length, end: text.length + value.length });
    text += value;
  }
  return { id, text, element, parts, breaks };
}

/** Search leaf blocks once; container text repeats the contents of its child blocks. */
export function readBlocks(container: HTMLElement): DocumentBlock[] {
  const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-node-id]"));
  if (container.dataset.nodeId) elements.unshift(container);
  return elements.filter(element => !element.querySelector("[data-node-id]") && !element.closest(SKIP))
    .map(element => readBlock(element, element.dataset.nodeId!));
}

export function liveBlocks(editor: HTMLElement, rootId: string, preferred?: HTMLElement): DocumentBlock[] {
  // Since 3.8.10 a rich title contains its own Protyle before the document body.
  // Prefer the SDK's body element; DOM-only callers must skip nested editors.
  const content = preferred && editor.contains(preferred) ? preferred :
    Array.from(editor.querySelectorAll<HTMLElement>(".protyle-wysiwyg")).find(element => {
      const owner = element.closest(".protyle");
      return !element.closest(".protyle-title__rich") && (!owner || owner === editor);
    });
  const blocks = content ? readBlocks(content) : [];
  const title = editor.querySelector<HTMLElement>(".protyle-title__input");
  if (title) blocks.unshift(readBlock(title, rootId));
  return blocks;
}

export function mergeBlocks(saved: DocumentBlock[], live: DocumentBlock[]): DocumentBlock[] {
  const replacements = new Map(live.map(block => [block.id, block]));
  const merged = saved.map(block => replacements.get(block.id) || block);
  const known = new Set(saved.map(block => block.id));
  // New unsaved blocks are inserted relative to their live predecessor.
  live.forEach((block, index) => {
    if (known.has(block.id)) return;
    const previous = live[index - 1];
    const before = previous ? merged.findIndex(item => item.id === previous.id) + 1 : 0;
    merged.splice(before, 0, block);
    known.add(block.id);
  });
  return merged;
}

export function matchRange(block: DocumentBlock, match: TextMatch): Range | undefined {
  const first = block.parts.find(part => part.end >= match.start);
  const last = block.parts.find(part => part.end >= match.end);
  if (!first || !last || !first.node.isConnected || !last.node.isConnected) return;
  const range = first.node.ownerDocument.createRange();
  range.setStart(first.node, Math.max(0, match.start - first.start));
  range.setEnd(last.node, Math.max(0, match.end - last.start));
  return range;
}
