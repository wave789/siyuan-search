import { readBlock } from "./document.ts";
import type { DocumentBlock } from "./document.ts";

const TAGS = new Set("DIV P SPAN BR H1 H2 H3 H4 H5 H6 STRONG B EM I U S STRIKE DEL INS MARK CODE PRE BLOCKQUOTE UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TD TH CAPTION COLGROUP COL HR A IMG AUDIO VIDEO SOURCE FIGURE FIGCAPTION SUP SUB KBD SAMP SMALL DETAILS SUMMARY INPUT".split(" "));
const DROP = new Set("SCRIPT STYLE IFRAME OBJECT EMBED LINK META BASE FORM BUTTON TEXTAREA SELECT TEMPLATE APPLET NOSCRIPT SVG MATH".split(" "));
const STYLES = ["color", "background-color", "font-weight", "font-style", "font-size", "text-align", "text-decoration", "width", "height", "max-width", "min-width", "vertical-align", "border-color", "border-width", "border-style", "list-style-type"];
const ATTRS = new Set(["alt", "title", "width", "height", "colspan", "rowspan", "start", "reversed", "open", "data-content", "data-type", "data-subtype", "data-language"]);
const blockID = /^\d{14}-[a-z\d]{7}$/i;

export function previewURL(value: string, base: string, media = false): string | undefined {
  if (!value.trim()) return;
  if (media && /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value.startsWith("assets/") ? `/${value}` : value, base);
    if (["https:", "http:"].includes(url.protocol) || (!media && ["siyuan:", "mailto:", "tel:"].includes(url.protocol))) return url.href;
  } catch { /* Invalid note URLs remain inert in the preview. */ }
}

/** Build new, noneditable nodes; kernel HTML never enters the live document through innerHTML. */
export function copyPreviewTree(source: Node, document: Document, base: string): DocumentFragment {
  const result = document.createDocumentFragment();
  const copy = (node: Node, parent: Node): void => {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(node.textContent || "")); return; }
    if (node.nodeType !== 1) return;
    const original = node as HTMLElement, tag = original.tagName.toUpperCase();
    if (DROP.has(tag) || original.matches(".protyle-action, .protyle-icons, .protyle-attr")) return;
    if (original.dataset.type === "NodeAttributeView" || original.classList.contains("av")) {
      const label = document.createElement("p"); label.textContent = "[数据库：请打开文档查看]"; parent.appendChild(label); return;
    }
    if (!TAGS.has(tag)) { for (const child of Array.from(original.childNodes)) copy(child, parent); return; }
    if (tag === "INPUT" && original.getAttribute("type") !== "checkbox") return;
    const element = document.createElement(tag.toLowerCase());
    for (const attribute of Array.from(original.attributes)) {
      const name = attribute.name.toLowerCase(), value = attribute.value;
      if (ATTRS.has(name)) element.setAttribute(name, value);
      else if (name === "class") {
        const classes = value.split(/\s+/).filter(name => /^(?:hljs(?:-[\w-]+)?|language-[\w-]+|code-block|render-node|math|katex[\w-]*|emoji|img|task-list-item)$/.test(name));
        if (classes.length) element.className = classes.join(" ");
      } else if (name === "id" || name === "data-node-id") {
        if (blockID.test(value)) element.dataset.sypBlockId = value;
        if (name === "id") element.dataset.sypAnchor = value;
      } else if (name === "href" && tag === "A") {
        if (value.startsWith("#")) { element.dataset.sypHash = value.slice(1); element.setAttribute("href", "#"); }
        else {
          const url = previewURL(value, base);
          if (url) { element.setAttribute("href", url); element.setAttribute("target", "_blank"); element.setAttribute("rel", "noopener noreferrer"); }
        }
      } else if (["src", "poster"].includes(name) && ["IMG", "AUDIO", "VIDEO", "SOURCE"].includes(tag)) {
        const url = previewURL(value, base, true); if (url) element.setAttribute(name, url);
      }
    }
    for (const property of STYLES) {
      const value = original.style.getPropertyValue(property);
      if (value && /^[#\w(),.%\s-]+$/.test(value) && !/url\s*\(|expression\s*\(|!important/i.test(value)) element.style.setProperty(property, value);
    }
    if (tag === "INPUT") { element.setAttribute("type", "checkbox"); element.setAttribute("disabled", ""); if (original.hasAttribute("checked")) element.setAttribute("checked", ""); }
    if (tag === "IMG") { element.setAttribute("loading", "lazy"); element.setAttribute("decoding", "async"); }
    if (["AUDIO", "VIDEO"].includes(tag)) { element.setAttribute("controls", ""); element.setAttribute("preload", "none"); }
    for (const child of Array.from(original.childNodes)) copy(child, element);
    parent.appendChild(element);
  };
  for (const child of Array.from(source.childNodes)) copy(child, result);
  return result;
}

export function readingPreviewHTML(html: string, document: Document): DocumentFragment {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return copyPreviewTree(parsed.body, document, document.baseURI);
}

export function readingBlocks(element: HTMLElement): DocumentBlock[] {
  return Array.from(element.querySelectorAll<HTMLElement>("[data-syp-block-id]"))
    .filter(block => !block.querySelector("[data-syp-block-id]"))
    .map(block => readBlock(block, block.dataset.sypBlockId!));
}
