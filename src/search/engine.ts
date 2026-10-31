import type { MatchResult, SearchOptions } from "./matcher.ts";
declare const __SEARCH_WORKER_SOURCE__: string;

/** Regexes run off the editor thread and can be terminated, including catastrophic backtracking. */
export function searchTexts(texts: string[], query: string, options: SearchOptions, signal: AbortSignal, limit = 10000, replacement?: string): Promise<MatchResult> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([__SEARCH_WORKER_SOURCE__], { type: "text/javascript" }));
    let worker: Worker;
    try { worker = new Worker(url); }
    catch (error) { URL.revokeObjectURL(url); reject(error); return; }
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      URL.revokeObjectURL(url);
    };
    const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("匹配耗时过长，请缩小范围或简化正则表达式。")); }, 2000);
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<{ error?: string; result: MatchResult }>) => {
      cleanup();
      if (data.error) reject(new Error(`正则表达式无效：${data.error}`));
      else resolve(data.result);
    };
    worker.onerror = () => { cleanup(); reject(new Error("搜索线程启动失败，请检查思源版本或浏览器设置。")); };
    worker.postMessage({ texts, query, options, limit, replacement });
  });
}
