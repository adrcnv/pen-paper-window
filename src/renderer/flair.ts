import type { Board, Rarity } from "../core/protocol.ts";
import { h, settled, sleep } from "./dom.ts";
import type { Particles } from "./fx/particles.ts";
import type { Tab } from "./panels.ts";

// The small rewards between turns: a glyph that flies to the tab it belongs
// to, a dot on a tab with something new in it, and the reveal of a fine thing
// come into the player's hands, brighter the rarer it is.

const TIER: Record<Rarity, { label: string; color: string; burst: string[]; count: number }> = {
  uncommon: { label: "UNCOMMON", color: "var(--uncommon)", burst: ["#9ff0a6", "#e2ffe4"], count: 18 },
  rare: { label: "RARE", color: "var(--rare)", burst: ["#8cc8ff", "#d8ecff", "#ffffff"], count: 44 },
  "very rare": { label: "VERY RARE", color: "var(--very-rare)", burst: ["#c59bff", "#efe0ff", "#ffffff", "#8cc8ff"], count: 80 },
  relic: { label: "RELIC", color: "var(--relic)", burst: ["#ffd77a", "#fff3a6", "#ffb347", "#ffffff"], count: 160 },
};
const ORDER: (Rarity | undefined)[] = [undefined, "uncommon", "rare", "very rare", "relic"];

export class Flair {
  mode: "full" | "calm" | "off" = "full";
  private particles: Particles;
  private queue: Promise<void> = Promise.resolve();

  constructor(particles: Particles) {
    this.particles = particles;
  }

  // A glyph lifts off `from` and arcs into the tab, which lights up.
  toTab(tab: Tab, from: Element | null, glyph: string, color: string): void {
    const button = document.querySelector<HTMLElement>(`#tabs [data-tab="${tab}"]`);
    if (!button) return;
    mark(button);
    if (this.mode !== "full" || !from) return void ping(button);
    const a = centre(from), b = centre(button);
    const el = h("div", { class: "flyer" }, glyph);
    el.style.color = color;
    document.body.append(el);
    const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 90 };
    el.animate([
      { transform: `translate(${a.x}px, ${a.y}px) translate(-50%, -50%) scale(0.6)`, opacity: 0 },
      { transform: `translate(${a.x}px, ${a.y - 20}px) translate(-50%, -50%) scale(1.5)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${mid.x}px, ${mid.y}px) translate(-50%, -50%) scale(1.2) rotate(-12deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(${b.x}px, ${b.y}px) translate(-50%, -50%) scale(0.5)`, opacity: 0.4 },
    ], { duration: 1050, easing: "cubic-bezier(.45, 0, .25, 1)" }).finished.then(() => {
      el.remove();
      ping(button);
      this.particles.burst(b.x, b.y, { count: 14, speed: 2.6, colors: ["#ffd77a", "#fff3a6"], life: 0.6, shape: "star", size: 1.6 });
    });
  }

  // After a turn: what came new onto the board shows on its tab, and each
  // fine thing that came into the player's hands is revealed.
  turnEnded(before: Board | null, after: Board): void {
    if (!before?.sheet || !after.sheet) return;
    const gained = gains(before.sheet.carrying, after.sheet.carrying);
    for (const g of gained) {
      const at = ORDER.indexOf(g.rarity);
      if (at >= 2) this.queue = this.queue.then(() => this.reveal(g.name, g.rarity!)).catch(() => {});
    }
    if (gained.length || before.sheet.level !== after.sheet.level || before.sheet.powers.length !== after.sheet.powers.length) markTab("sheet");
    if (JSON.stringify(before.deals ?? []) !== JSON.stringify(after.deals ?? [])) markTab("deals");
    const known = new Set((before.people ?? []).map((p) => p.name));
    if ((after.people ?? []).some((p) => !known.has(p.name))) markTab("people");
  }

  // A card turns up from a ring of light, says how fine the thing is, and
  // goes into the sheet.
  private async reveal(name: string, rarity: Rarity): Promise<void> {
    const t = TIER[rarity];
    const button = document.querySelector<HTMLElement>(`#tabs [data-tab="sheet"]`);
    if (this.mode === "off") return;
    const card = h("div", { class: "reveal-card" }, h("div", { class: "tier" }, t.label), h("div", { class: "name" }, name));
    const box = h("div", { class: `reveal r-${rarity.replace(" ", "-")}` }, h("div", { class: "rays" }), card);
    box.style.setProperty("--tier", t.color);
    document.body.append(box);
    await sleep(380);
    const at = centre(card);
    this.particles.burst(at.x, at.y, { count: t.count, speed: rarity === "relic" ? 10 : 6, colors: t.burst, shape: "star", gravity: 0.06, life: rarity === "relic" ? 1.8 : 1.2 });
    if (rarity === "relic") {
      await sleep(500);
      this.particles.burst(at.x, at.y, { count: 90, speed: 13, colors: t.burst, gravity: 0.1, life: 1.6 });
    }
    await sleep(rarity === "relic" ? 2600 : 1500);
    if (this.mode === "full" && button) {
      const b = centre(button);
      await settled(card.animate([
        { transform: "translate(-50%, -50%) scale(1)", opacity: 1 },
        { transform: `translate(calc(-50% + ${b.x - at.x}px), calc(-50% + ${b.y - at.y}px)) scale(0.1)`, opacity: 0.2 },
      ], { duration: 650, easing: "cubic-bezier(.6, 0, .4, 1)", fill: "forwards" }));
      ping(button);
    }
    box.classList.add("gone");
    await sleep(400);
    box.remove();
  }
}

// What is carried now that was not before, counting duplicates.
export function gains(before: { name: string; rarity?: Rarity }[], after: { name: string; rarity?: Rarity }[]): { name: string; rarity?: Rarity }[] {
  const had = new Map<string, number>();
  for (const i of before) had.set(i.name, (had.get(i.name) ?? 0) + 1);
  return after.filter((i) => {
    const n = had.get(i.name) ?? 0;
    if (n > 0) {
      had.set(i.name, n - 1);
      return false;
    }
    return true;
  });
}

export function markTab(tab: Tab): void {
  const button = document.querySelector<HTMLElement>(`#tabs [data-tab="${tab}"]`);
  if (button && button.getAttribute("aria-selected") !== "true") mark(button);
}

function mark(button: HTMLElement): void {
  if (button.getAttribute("aria-selected") !== "true") button.classList.add("fresh");
}

function ping(button: HTMLElement): void {
  button.classList.remove("ping");
  void button.offsetWidth;
  button.classList.add("ping");
  button.addEventListener("animationend", () => button.classList.remove("ping"), { once: true });
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// The class an item's name is shown with, by how fine it is.
export function rarityClass(r?: Rarity): string {
  return r ? ` r-${r.replace(" ", "-")}` : "";
}
