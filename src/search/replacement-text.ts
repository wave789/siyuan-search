/** IDE-style replacement tokens. Plain-text replacement bypasses this expansion entirely. */
export function expandReplacement(template: string, match: RegExpExecArray, text: string): string {
  const decoded = template.replace(/\\(\\|n|r|t)/g, (_, escape: string) => ({ "\\": "\\", n: "\n", r: "\r", t: "\t" })[escape]!);
  return decoded.replace(/\$(\$|&|`|'|\d{1,2}|<[^>]+>|\{[^}]+\})/g, (token: string, key: string) => {
    if (key === "$") return "$";
    if (key === "&" || key === "0") return match[0];
    if (key === "`") return text.slice(0, match.index);
    if (key === "'") return text.slice(match.index + match[0].length);
    if (key.startsWith("<") || key.startsWith("{")) return match.groups ? (match.groups[key.slice(1, -1)] || "") : token;
    const index = Number(key);
    if (index > 0 && index < match.length) return match[index] || "";
    if (key.length === 2 && Number(key[0]) > 0 && Number(key[0]) < match.length) return (match[Number(key[0])] || "") + key[1];
    return token;
  });
}
