import type { Bridge } from "../core/bridge.ts";
import type { Board, LevelAbility, LevelOptions, LevelPick } from "../core/protocol.ts";
import { h, settled, sleep } from "./dom.ts";
import type { Particles } from "./fx/particles.ts";
import type { Screen } from "./fx/screen.ts";
import { modClass, modOf, signed, stampMod } from "./mods.ts";

// What a new level brings, chosen here as the character was made: an
// ability of the calling's to learn, or, every third level, a point on a
// score in place of one, as many as the level gives. The server allows
// each; this offers them and sends them. The DM hears of the choice with
// the player's next words.

const ABBR: Record<string, string> = { strength: "STR", dexterity: "DEX", constitution: "CON", intelligence: "INT", wisdom: "WIS", charisma: "CHA" };

export interface LevelHooks {
  bridge: Bridge;
  particles: Particles;
  screen: Screen;
  chosen(board: Board | undefined, said: string[]): void; // the choices stand
}

export async function chooseLevel(host: HTMLElement, hooks: LevelHooks): Promise<void> {
  if (!host.hidden) return;
  const o = await hooks.bridge.levelOptions();
  if (!o || o.error) return;
  new LevelUp(host, o, hooks).open();
}

class LevelUp {
  private host: HTMLElement;
  private o: LevelOptions;
  private hooks: LevelHooks;
  private picks: LevelPick[] = [];
  private els: Record<string, HTMLElement> = {};
  private tiles = new Map<string, { score: HTMLElement; mod: HTMLElement; tile: HTMLElement; up: HTMLElement }>();

  constructor(host: HTMLElement, o: LevelOptions, hooks: LevelHooks) {
    this.host = host;
    this.o = o;
    this.hooks = hooks;
  }

  open(): void {
    const e = this.els;
    e.left = h("span", { class: "left" });
    e.learn = h("div", { class: "firsts" }, ...this.o.abilities.map((a) => this.card(a)));
    e.grow = h("div", { class: "tiles growable" }, ...this.o.scores.map((s) => this.tile(s.name)));
    e.go = h("button", { type: "button", class: "primary go", disabled: "" }, "Take it");
    e.go.addEventListener("click", () => this.take());
    const later = h("button", { type: "button", class: "quiet" }, "later");
    later.addEventListener("click", () => this.close());
    e.err = h("p", { class: "err" });
    const box = h("div", { class: "creation levelup" },
      h("div", { class: "head" }, h("div", { class: "title" }, `Level ${this.o.level}`), h("div", { class: "rule" }),
        h("div", { class: "note" }, this.o.class ?? "", " ", e.left)),
      this.o.abilities.length ? h("section", null, h("h3", null, "learn"), e.learn) : null,
      this.o.scores.length ? h("section", null, h("h3", null, `${this.o.abilities.length ? "or grow" : "grow"}${(this.o.raises ?? 0) > 1 ? ` · ${this.o.raises} points` : ""}`), e.grow) : null,
      h("div", { class: "row end" }, e.err, later, e.go));
    this.host.replaceChildren(box);
    this.host.hidden = false;
    this.paint();
    if (this.hooks.screen.mode === "off") return;
    box.animate([{ opacity: 0, transform: "translateY(10px) scale(0.98)" }, { opacity: 1, transform: "none" }], { duration: 460, easing: "cubic-bezier(.2,.8,.3,1)" });
    const r = box.querySelector(".title")!.getBoundingClientRect();
    this.hooks.particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 40, speed: 4, shape: "star", colors: ["#fff3a6", "#ffd77a", "#ffffff"], life: 1.1 });
  }

  private card(a: LevelAbility): HTMLElement {
    const meta = [a.kind, a.dice ?? null, a.per_level ? `grows ${a.per_level} every ${a.every ?? 3} lvl` : null, a.uses ? `${a.uses}× a rest` : null,
      a.runs_on ? `on ${ABBR[a.runs_on] ?? a.runs_on}` : null, a.from && a.from > 1 ? `from level ${a.from}` : null].filter(Boolean).join(" · ");
    const chip = h("button", { type: "button", class: "first", "data-id": a.id, title: a.what ?? "" },
      h("span", { class: "fname" }, a.name), h("span", { class: "fmeta" }, meta), a.what ? h("span", { class: "fwhat" }, a.what) : null);
    chip.addEventListener("click", () => this.learn(a.id, chip));
    return chip;
  }

  private tile(name: string): HTMLElement {
    const score = h("b");
    const mod = h("span", { class: "mod mp0" });
    const up = h("span", { class: "up" });
    const tile = h("button", { type: "button", class: "tile", "data-s": name }, h("span", { class: "k" }, ABBR[name] ?? name), score, mod, up);
    tile.addEventListener("click", () => this.grow(name));
    tile.addEventListener("contextmenu", (ev) => { ev.preventDefault(); this.ungrow(name); });
    this.tiles.set(name, { score, mod, tile, up });
    return tile;
  }

  private left(): number {
    return this.o.picks - this.picks.length;
  }

  private raisedBy(name: string): number {
    return this.picks.filter((p) => "score" in p && p.score === name).length;
  }

  private learn(id: string, chip: HTMLElement): void {
    const at = this.picks.findIndex((p) => "ability" in p && p.ability === id);
    if (at >= 0) this.picks.splice(at, 1);
    else if (this.left() > 0) this.picks.push({ ability: id });
    else return void chip.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 180 });
    const on = at < 0;
    chip.classList.toggle("picked", on);
    if (on) chip.animate([{ transform: "scale(1.06)" }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    this.paint();
  }

  // A point on a score, as many times as picks and its height allow;
  // right-click takes one back.
  private grow(name: string): void {
    const s = this.o.scores.find((x) => x.name === name)!;
    const t = this.tiles.get(name)!;
    const raised = this.picks.filter((p) => "score" in p).length;
    if (this.left() <= 0 || raised >= (this.o.raises ?? this.o.picks) || s.score + this.raisedBy(name) >= s.top) {
      t.tile.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 180 });
      return;
    }
    const before = modOf(s.score + this.raisedBy(name));
    this.picks.push({ score: name });
    this.paint();
    const now = modOf(s.score + this.raisedBy(name));
    t.tile.animate([{ transform: "scale(1.12)" }, { transform: "scale(0.97)", offset: 0.6 }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    if (now !== before) {
      void stampMod(t.mod, now);
      const r = t.tile.getBoundingClientRect();
      if (this.hooks.screen.mode !== "off") this.hooks.particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 14 + now * 4, speed: 2.4, shape: "star", size: 1.4, colors: ["#6fd3ff", "#d8f4ff", "#fff3a6"], life: 0.7 });
    }
  }

  private ungrow(name: string): void {
    const at = this.picks.findIndex((p) => "score" in p && p.score === name);
    if (at < 0) return;
    this.picks.splice(at, 1);
    this.paint();
  }

  private paint(): void {
    for (const s of this.o.scores) {
      const t = this.tiles.get(s.name)!;
      const by = this.raisedBy(s.name);
      const v = s.score + by;
      const m = modOf(v);
      t.score.textContent = String(v);
      t.mod.className = modClass(m);
      t.mod.textContent = signed(m);
      t.up.textContent = by ? `+${by}` : s.score >= s.top ? "at its height" : `to ${s.top}`;
      t.tile.classList.toggle("raised", by > 0);
      t.tile.classList.toggle("full", v >= s.top);
    }
    const left = this.left();
    this.els.left.textContent = left ? `· choose ${left}` : "· chosen";
    const go = this.els.go as HTMLButtonElement;
    const was = go.disabled;
    go.disabled = left !== 0;
    if (was && !go.disabled) go.animate([{ transform: "scale(1.08)", filter: "brightness(1.6)" }, { transform: "none", filter: "none" }], { duration: 320 });
  }

  private async take(): Promise<void> {
    const go = this.els.go as HTMLButtonElement;
    if (this.left() !== 0) return;
    go.disabled = true;
    this.els.err.textContent = "";
    const out = await this.hooks.bridge.chooseLevel(this.picks);
    if (!out || out.error || !out.tell) {
      go.disabled = false;
      this.els.err.textContent = out?.error ?? "The world server is not answering.";
      return;
    }
    const said = this.picks.map((p) => "score" in p ? `${ABBR[p.score] ?? p.score} +1` : this.o.abilities.find((a) => a.id === p.ability)?.name ?? p.ability);
    if (this.hooks.screen.mode !== "off") {
      const r = go.getBoundingClientRect();
      this.hooks.particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 60, speed: 7, shape: "star", colors: ["#ffd77a", "#fff3a6", "#ffffff"] });
      await sleep(60);
    }
    await this.close();
    this.hooks.chosen(out.board, said);
  }

  private async close(): Promise<void> {
    const box = this.host.querySelector<HTMLElement>(".creation");
    if (box && this.hooks.screen.mode !== "off") {
      await settled(box.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-14px) scale(0.98)" }], { duration: 360, easing: "ease-in", fill: "forwards" }));
    }
    this.host.hidden = true;
    this.host.replaceChildren();
  }
}
