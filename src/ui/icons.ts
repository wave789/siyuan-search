/** Original geometry drawn for this plugin; no icon font, network asset or external sprite. */
const paths = {
  brand: ["M8 20H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l5 5v2", "M12 2v5h5M7 8h2", "M20 15a5 5 0 1 1-10 0 5 5 0 0 1 10 0M18.6 18.6 22 22M13 15h4"],
  search: ["M16.5 10.25a6.25 6.25 0 1 1-12.5 0 6.25 6.25 0 0 1 12.5 0M15 15l5.25 5.25"],
  chevronRight: ["m9 5.5 6.5 6.5L9 18.5"],
  chevronDown: ["m5.5 9 6.5 6.5L18.5 9"],
  arrowUp: ["M12 19V5m-5.5 5.5L12 5l5.5 5.5"],
  arrowDown: ["M12 5v14m-5.5-5.5L12 19l5.5-5.5"],
  external: ["M14 4h6v6M20 4l-9.5 9.5M9 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"],
  close: ["m6.5 6.5 11 11m0-11-11 11"],
  folder: ["M3 7V5a1 1 0 0 1 1-1h6l2 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z"],
  document: ["M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h6"],
  replace: ["M6 4v8a3 3 0 0 0 3 3h11m-5-5 5 5-5 5"],
} as const;

export type IconName = keyof typeof paths;
export const PLUGIN_ICON_ID = "iconSiyuanIdeSearch";
export const PLUGIN_ICON_SPRITE = `<symbol id="${PLUGIN_ICON_ID}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths.brand.map(d => `<path d="${d}"/>`).join("")}</symbol>`;

export function icon(name: IconName, className = "syp-icon"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ viewBox: "0 0 24 24", width: "20", height: "20", fill: "none", stroke: "currentColor",
    "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false", class: className })) svg.setAttribute(key, value);
  for (const d of paths[name]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d); svg.append(path);
  }
  return svg;
}
