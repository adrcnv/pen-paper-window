import { h, settled } from "./dom.ts";

// What a score adds to a roll, and its colour, one scale wherever it shows:
// the weaker the redder, nothing grey, the stronger greener to gold. The
// rules that make a score are the server's; this only reads one.

export function modOf(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function signed(n: number): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
}

export function modClass(n: number): string {
  const c = Math.max(-3, Math.min(5, n));
  return `mod ${c < 0 ? `mn${-c}` : `mp${c}`}`;
}

// A modifier as a coloured number.
export function modTag(n: number, tag: "span" | "b" | "div" = "span"): HTMLElement {
  return h(tag, { class: modClass(n) }, signed(n));
}

// A modifier landing: it stamps in and flashes its colour, harder the
// further from nothing.
export function stampMod(el: HTMLElement, n: number): Promise<void> {
  const k = Math.min(Math.abs(n), 5);
  return settled(el.animate([
    { transform: `scale(${1.3 + k * 0.18})`, opacity: 0, filter: "brightness(2)" },
    { transform: "scale(0.9)", opacity: 1, filter: `brightness(${1 + k * 0.2})`, offset: 0.55 },
    { transform: "scale(1)", opacity: 1, filter: "brightness(1)" },
  ], { duration: 220 + k * 30, easing: "cubic-bezier(.2,.9,.3,1.2)" }));
}
