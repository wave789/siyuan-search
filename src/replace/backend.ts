import type { IProtyle } from "siyuan";
import { blockQuery, post } from "../api.ts";
import type { IndexedBlock } from "../api.ts";
import { liveBlocks, readBlock, readBlocks } from "../search/document.ts";
import { searchTexts } from "../search/engine.ts";
import { applyTextEdits } from "./edits.ts";
import { replaceBlockDOM } from "./dom.ts";
import type { Change, EditableSource, ReplaceScope, ReplaceTarget, ReplacementBackend } from "./types.ts";

function parseBlock(dom: string, id: string): HTMLElement {
  const document = new DOMParser().parseFromString(dom, "text/html");
  const block = readBlocks(document.body).find(block => block.id === id)?.element;
  if (!block) throw new Error("无法读取可替换的内容块，原文可能已删除或不支持编辑。");
  return block;
}

export function createReplacementBackend(getEditors: () => IProtyle[]): ReplacementBackend {
  let affected = new Set<string>();
  const assertLive = (source: EditableSource) => {
    for (const editor of getEditors().filter(editor => editor.block.rootID === source.target.root && editor.element.isConnected)) {
      // Read-only search/backlink previews can show a different fragment of the same document.
      if (editor.disabled) continue;
      const live = liveBlocks(editor.element, source.target.root, editor.wysiwyg?.element).find(block => block.id === source.target.id);
      if (live && live.text !== source.text) throw new Error("编辑器中存在尚未保存或正在同步的内容，请稍后刷新搜索再重试。");
    }
  };
  const readStored = async (target: ReplaceTarget, signal?: AbortSignal): Promise<EditableSource> => {
    if (target.title) {
      const attrs = await post<Record<string, string>>("/api/attr/getBlockAttrs", { id: target.id, notebook: target.notebook }, signal);
      const title = attrs.title || "";
      return { target, raw: title, text: title, apply: edits => applyTextEdits(title, edits) };
    }
    const data = await post<{ dom: string }>("/api/block/getBlockDOM", { id: target.id, notebook: target.notebook }, signal);
    const block = parseBlock(data.dom, target.id);
    return { target, raw: data.dom, text: readBlock(block, target.id).text,
      apply: edits => replaceBlockDOM(parseBlock(data.dom, target.id), edits) };
  };
  return {
    find: searchTexts,
    equivalent(target, first, second) {
      if (target.title) return first === second;
      const normalized = (dom: string) => {
        const document = new DOMParser().parseFromString(dom, "text/html");
        document.body.querySelectorAll("[updated], [data-node-index]").forEach(element => {
          element.removeAttribute("updated"); element.removeAttribute("data-node-index");
        });
        return document.body.innerHTML;
      };
      // Each restore gets a new modification time and can get a new rendering index.
      return normalized(first) === normalized(second);
    },
    async prepare(scope: ReplaceScope, signal: AbortSignal) {
      affected = new Set();
      for (const editor of getEditors()) {
        if (editor.disabled) continue;
        if (scope.root && editor.block.rootID !== scope.root) continue;
        if (scope.notebook && editor.notebookId !== scope.notebook) continue;
        if (signal.aborted) throw new DOMException("已停止", "AbortError");
        const instance = editor.getInstance() as unknown as { flushPendingTransactions?: () => Promise<void> };
        await instance.flushPendingTransactions?.();
      }
      await post("/api/sqlite/flushTransaction", {}, signal);
    },
    async *candidates(scope, signal) {
      if (scope.root) {
        const [data, attrs] = await Promise.all([
          post<{ dom: string }>("/api/block/getBlockDOM", { id: scope.root, notebook: scope.notebook }, signal),
          post<Record<string, string>>("/api/attr/getBlockAttrs", { id: scope.root, notebook: scope.notebook }, signal),
        ]);
        const saved = readBlocks(new DOMParser().parseFromString(data.dom, "text/html").body);
        const texts = new Map(saved.map(block => [block.id, block.text]));
        texts.set(scope.root, attrs.title || "");
        for (const editor of getEditors().filter(editor => editor.block.rootID === scope.root && !editor.disabled)) {
          for (const live of liveBlocks(editor.element, scope.root, editor.wysiwyg?.element)) if (texts.get(live.id) !== live.text) {
            throw new Error("编辑器中有尚未保存的内容，请稍后重试全部替换。");
          }
        }
        const blocks: IndexedBlock[] = [{ id: scope.root, root_id: scope.root, box: scope.notebook || "", hpath: "", type: "d", content: attrs.title || "" },
          ...saved.map(block => ({ id: block.id, root_id: scope.root!, box: scope.notebook || "", hpath: "", type: "p", content: block.text }))];
        for (let index = 0; index < blocks.length; index += 500) yield blocks.slice(index, index + 500);
        return;
      }
      let cursor = "";
      while (!signal.aborted) {
        const batch = await post<IndexedBlock[]>("/api/query/sql", { stmt: blockQuery(cursor, scope) }, signal);
        if (!batch?.length) return;
        yield batch;
        const next = batch.at(-1)!.id;
        if (next <= cursor) throw new Error("搜索分页发生重复，请刷新后重试。");
        cursor = next;
        if (batch.length < 500) return;
      }
    },
    async read(target, signal) {
      const source = await readStored(target, signal);
      assertLive(source);
      return source;
    },
    async write(change: Change, raw: string) {
      affected.add(change.target.root);
      if (change.target.title) {
        await post("/api/filetree/renameDocByID", { id: change.target.id, title: raw, notebook: change.target.notebook });
        return (await readStored(change.target)).raw;
      }
      const transactions = await post<{ doOperations?: { id: string; data?: string }[] }[]>("/api/block/updateBlock", {
        id: change.target.id, dataType: "dom", data: raw, notebook: change.target.notebook,
      });
      const canonical = transactions?.flatMap(transaction => transaction.doOperations || []).find(operation => operation.id === change.target.id)?.data;
      try { return (await readStored(change.target)).raw; }
      catch (error) { if (canonical) return canonical; throw error; }
    },
    async changed() {
      try { await post("/api/sqlite/flushTransaction", {}); }
      finally {
        for (const editor of getEditors()) if (editor.block.rootID && affected.has(editor.block.rootID) && editor.element.isConnected) {
          try { editor.getInstance().reload(false); }
          catch (error) { console.warn("[siyuan-search] Could not refresh editor after replacement", error); }
        }
        affected.clear();
      }
    },
  };
}
