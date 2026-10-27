// A small element builder. Text always goes in as text nodes: what the DM
// writes is never parsed as HTML.
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// When an animation is done, or would have been: a window hidden or
// throttled holds its animations still, and nothing waits on them forever.
export function settled(a: Animation): Promise<void> {
  const ms = Number(a.effect?.getComputedTiming().endTime ?? 0) + 120;
  return Promise.race([a.finished.then(() => undefined, () => undefined), sleep(ms)]);
}
