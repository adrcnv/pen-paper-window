import { h } from "./dom.ts";

// The world server draws its map for terminals, in ANSI colour; this turns
// it into coloured spans, as text nodes.
const BASE = ["#000000", "#cd3131", "#0dbc79", "#e5e510", "#2472c8", "#bc3fbc", "#11a8cd", "#e5e5e5",
              "#666666", "#f14c4c", "#23d18b", "#f5f543", "#3b8eea", "#d670d6", "#29b8db", "#ffffff"];

function color256(n: number): string {
  if (n < 16) return BASE[n];
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
  }
  const i = n - 16;
  const c = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${c(Math.floor(i / 36))},${c(Math.floor(i / 6) % 6)},${c(i % 6)})`;
}

export function ansiToNodes(text: string): HTMLElement {
  const pre = h("pre");
  let fg: string | null = null;
  let bold = false;
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  const push = (s: string) => {
    if (!s) return;
    if (!fg && !bold) return pre.append(document.createTextNode(s));
    const span = h("span", null, s);
    if (fg) span.style.color = fg;
    if (bold) span.style.fontWeight = "700";
    pre.append(span);
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    push(text.slice(last, m.index));
    last = re.lastIndex;
    const codes = (m[1] || "0").split(";").map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) { fg = null; bold = false; }
      else if (c === 1) bold = true;
      else if (c === 22) bold = false;
      else if (c === 39) fg = null;
      else if (c >= 30 && c <= 37) fg = BASE[c - 30];
      else if (c >= 90 && c <= 97) fg = BASE[c - 90 + 8];
      else if (c === 38 && codes[i + 1] === 5) { fg = color256(codes[i + 2]); i += 2; }
      else if (c === 38 && codes[i + 1] === 2) { fg = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
    }
  }
  push(text.slice(last));
  return pre;
}
