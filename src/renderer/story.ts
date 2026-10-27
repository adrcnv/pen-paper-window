import type { Paragraph, Run } from "../core/protocol.ts";
import type { Speed } from "../core/bridge.ts";
import { h } from "./dom.ts";

// The narration, inked in letter by letter. Every letter is its own element
// carrying its run's meaning as classes (a name's kind, a quote's stance,
// emphasis), laid out from the start but invisible, so the text never
// reflows while it appears. Letters are grouped into unbreakable words, so a
// line breaks only where the text has a space. Once told, letters that need
// not move fold back into plain spans.

const CPS: Record<Speed, number> = { off: Infinity, fast: 260, normal: 95, slow: 38 };
const PAUSE: Record<string, number> = { ".": 9, "!": 9, "?": 9, "…": 12, ",": 3, ";": 4, ":": 4, "—": 4 };
const MOVING = ".q-hostile, .q-guarded, .q-trusting, .q-warm";

export interface Inked {
  root: HTMLElement;
  letters: HTMLElement[];
}

export function ink(paragraphs: Paragraph[]): Inked {
  const root = h("div", { class: "narration" });
  const letters: HTMLElement[] = [];
  let index = 0;
  let names = 0;
  for (const para of paragraphs) {
    const p = h("p");
    let word: HTMLElement | null = null;
    // A quote that shouts shakes harder: every letter of it knows.
    const loud = new Set<number>();
    let quote = 0;
    let inQuote: string | undefined;
    const mine: [HTMLElement, number][] = [];
    for (const run of para) {
      if (run.q !== inQuote) {
        inQuote = run.q;
        if (run.q) quote++;
      }
      if (run.q === "hostile" && run.t.includes("!")) loud.add(quote);
      const cls = classesOf(run);
      const name = run.e ? ++names : 0;
      let last: HTMLElement | null = null;
      for (const piece of run.t.split(/(\s+)/)) {
        if (!piece) continue;
        if (/^\s+$/.test(piece)) {
          word = null;
          const breaks = piece.split("\n").length - 1;
          if (breaks) for (let i = 0; i < breaks; i++) p.append(h("br"));
          else p.append(document.createTextNode(" "));
          continue;
        }
        if (!word) p.append((word = h("span", { class: "w" })));
        for (const ch of piece) {
          const c = h("span", { class: `c ${cls}` }, ch);
          c.style.setProperty("--d", `${(-Math.random() * 0.3).toFixed(2)}s`);
          c.style.setProperty("--wave", `${(-(index % 40) * 0.065).toFixed(2)}s`);
          if (name) c.dataset.name = String(name);
          if (run.w) c.title = run.w;
          word.append(c);
          letters.push(c);
          mine.push([c, run.q ? quote : 0]);
          last = c;
          index++;
        }
      }
      if (name && last) last.dataset.last = "1";
    }
    root.append(p);
    for (const [c, q] of mine) if (loud.has(q)) c.classList.add("loud");
  }
  return { root, letters };
}

function classesOf(run: Run): string {
  return [run.q ? `q-${run.q}` : "", run.e ? `e-${run.e}` : "", run.i ? "em" : "", run.b ? "strong" : ""].filter(Boolean).join(" ");
}

// Lets the letters appear at the chosen speed, pausing a beat at the end of
// a sentence. Resolves when all are shown; `skip()` shows the rest at once.
export class Typewriter {
  private skipping = false;
  speed: Speed = "normal";
  onProgress: (() => void) | null = null;

  skip(): void {
    this.skipping = true;
  }

  async reveal(inked: Inked): Promise<void> {
    this.skipping = false;
    const { letters, root } = inked;
    const cps = CPS[this.speed];
    if (cps === Infinity) return showAll(letters, 0);
    let i = 0;
    let budget = 0;
    let last = performance.now();
    await new Promise<void>((done) => {
      const frame = (now: number) => {
        if (this.skipping) {
          showAll(letters, i);
          return done();
        }
        budget += ((now - last) / 1000) * cps;
        last = now;
        while (budget >= 1 && i < letters.length) {
          const c = letters[i++];
          c.classList.add("on");
          budget -= 1 + (PAUSE[c.textContent ?? ""] ?? 0);
          // a name glows once, as its last letter lands
          if (c.dataset.last) root.querySelectorAll(`[data-name="${c.dataset.name}"]`).forEach((l) => l.classList.add("lit"));
        }
        this.onProgress?.();
        if (i >= letters.length) return done();
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  }
}

function showAll(letters: HTMLElement[], from: number): void {
  for (let i = from; i < letters.length; i++) letters[i].classList.add("on");
}

// After the telling: letters fold back into spans of one style each
// (kerning back, far fewer elements) — all but a moving quote's, while its
// turn is the newest.
export function settle(root: HTMLElement, keepMoving: boolean): void {
  for (const word of root.querySelectorAll<HTMLElement>(".w")) {
    if (keepMoving && word.querySelector(MOVING)) continue;
    const spans: HTMLElement[] = [];
    let style = "\0";
    for (const c of word.children) {
      const cls = [...c.classList].filter((k) => !["c", "on", "lit", "loud"].includes(k)).join(" ");
      if (cls !== style) {
        spans.push(h("span", cls ? { class: cls } : null));
        style = cls;
      }
      spans[spans.length - 1].append(c.textContent ?? "");
    }
    word.replaceWith(...spans);
  }
}

// Painted runs as still text, for the journal.
export function still(paragraphs: Paragraph[]): HTMLElement[] {
  return paragraphs.map((para) => h("p", null, ...para.map((run) => h("span", { class: classesOf(run) || undefined }, run.t))));
}
