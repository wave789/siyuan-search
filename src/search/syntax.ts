export interface SyntaxSpan { start: number; end: number; classes: string }
export interface SyntaxEngine {
  getLanguage(language: string): unknown;
  highlight(text: string, options: { language: string; ignoreIllegals: boolean }): { value: string };
}

function decode(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (original, key: string) => {
    if (!key.startsWith("#")) return named[key.toLowerCase()] ?? original;
    const value = key[1].toLowerCase() === "x" ? Number.parseInt(key.slice(2), 16) : Number.parseInt(key.slice(1), 10);
    return value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : original;
  });
}

/** Read only the highlighter's span grammar. Never insert its HTML into the live document. */
export function syntaxSpans(source: string, html: string): SyntaxSpan[] | undefined {
  const token = /<span\s+class=(?:"([^"]*)"|'([^']*)')\s*>|<\/span\s*>|([^<]+)/g;
  const stack: string[][] = [], spans: SyntaxSpan[] = [];
  let cursor = 0, text = "", match: RegExpExecArray | null;
  while ((match = token.exec(html))) {
    if (match.index !== cursor) return;
    cursor = token.lastIndex;
    if (match[3] !== undefined) {
      const chunk = decode(match[3]), start = text.length;
      text += chunk;
      const classes = Array.from(new Set(stack.flat())).join(" ");
      if (chunk && classes) {
        const last = spans.at(-1);
        if (last?.end === start && last.classes === classes) last.end = text.length;
        else spans.push({ start, end: text.length, classes });
      }
    } else if (match[0].startsWith("</")) {
      if (!stack.length) return;
      stack.pop();
    } else stack.push((match[1] ?? match[2]).split(/\s+/).filter(name => /^hljs-[a-z\d_-]+$/i.test(name)));
  }
  return cursor === html.length && !stack.length && text === source ? spans : undefined;
}

let pending: Promise<SyntaxEngine | undefined> | undefined;
const currentEngine = () => (window as unknown as { hljs?: SyntaxEngine }).hljs;

/** Load only SiYuan's code-coloring assets, not a complete editor or a rendered document. */
export function loadSyntaxEngine(start: (element: HTMLElement) => void): Promise<SyntaxEngine | undefined> {
  const current = currentEngine();
  if (current) return Promise.resolve(current);
  if (pending) return pending;
  pending = new Promise(resolve => {
    const host = document.createElement("div"), block = document.createElement("pre"), code = document.createElement("code");
    host.className = "b3-typography"; block.className = "code-block"; block.setAttribute("data-language", "plaintext");
    code.textContent = " "; block.append(code); host.append(block);
    try { start(host); } catch { resolve(undefined); return; }
    const started = Date.now();
    const check = () => {
      const engine = currentEngine();
      if (engine || Date.now() - started >= 2000) resolve(engine);
      else setTimeout(check, 50);
    };
    check();
  });
  return pending;
}
