import { post } from "../api.ts";
import { readBlock } from "./document.ts";
import { buildPreviewDocument } from "./preview-model.ts";
import type { PreviewDocument, PreviewSelection } from "./preview-model.ts";

/** Parse into an inert document. User HTML is never inserted into the search dialog. */
export function previewBlocksFromDOM(dom: string, rootId: string): { id: string; text: string; language?: string }[] {
  const document = new DOMParser().parseFromString(dom, "text/html");
  return Array.from(document.body.querySelectorAll<HTMLElement>("[data-node-id]"))
    .filter(element => element.dataset.nodeId !== rootId && !element.querySelector("[data-node-id]"))
    .map(element => {
      const copy = element.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("img").forEach(image => image.replaceWith(document.createTextNode(`[图片${image.alt ? `：${image.alt}` : ""}]`)));
      copy.querySelectorAll<HTMLElement>(".render-node, [data-type~='inline-math']").forEach(node => {
        const source = node.getAttribute("data-content");
        if (source !== null) node.replaceWith(document.createTextNode(source));
      });
      const rows = Array.from(copy.querySelectorAll("tr"));
      rows.forEach((row, index) => {
        Array.from(row.querySelectorAll("td, th")).slice(1).forEach(cell => cell.before(document.createTextNode("\t")));
        if (index < rows.length - 1) row.append(document.createTextNode("\n"));
      });
      const source = element.getAttribute("data-content");
      const type = element.dataset.type || "";
      let text = source ?? readBlock(copy, element.dataset.nodeId!).text;
      if (type === "NodeAttributeView") text = "[数据库]";
      if (type === "NodeBlockQueryEmbed") text = "[嵌入块]";
      if (!text) {
        const media = copy.querySelector("audio, video, iframe");
        if (media) text = media.tagName === "AUDIO" ? "[音频]" : media.tagName === "VIDEO" ? "[视频]" : "[嵌入内容]";
      }
      const block: { id: string; text: string; language?: string } = { id: element.dataset.nodeId!, text };
      if (type === "NodeCodeBlock") block.language = (element.dataset.subtype ||
        element.querySelector(".protyle-action__language, .code-block__language, .protyle-action > span")?.textContent || "plaintext").trim().toLowerCase();
      return block;
    });
}

export async function loadPreviewDocument(selection: PreviewSelection, signal: AbortSignal): Promise<PreviewDocument> {
  const id = selection.block.root_id, notebook = selection.block.box;
  const [data, attrs] = await Promise.all([
    post<{ dom: string }>("/api/block/getBlockDOM", { id, notebook }, signal),
    post<Record<string, string>>("/api/attr/getBlockAttrs", { id, notebook }, signal),
  ]);
  const title = attrs.title ?? selection.block.hpath?.split("/").filter(Boolean).at(-1) ?? "未命名文档";
  return buildPreviewDocument(id, title, previewBlocksFromDOM(data.dom, id));
}
