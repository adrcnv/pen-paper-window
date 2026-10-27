import type { Bridge } from "../core/bridge.ts";
import type { Bringable, CallingOption, CharacterOptions, PeopleOption, Spread } from "../core/protocol.ts";
import { h, settled, sleep } from "./dom.ts";
import type { Particles } from "./fx/particles.ts";
import type { Screen } from "./fx/screen.ts";
import { modClass, modOf, signed, stampMod } from "./mods.ts";
import { HARDY } from "./panels.ts";

// The player makes their character here, before the DM says a word: their
// people, the six scores rolled (one reroll) or spread, a calling, its first
// abilities, a name. A people adds to rolled scores and sets what a spread
// may be; the server says by how much. Every choice is the server's to
// allow; this only offers them and sends them. Made, the DM is told who has
// come (Bridge.begin). A supporter may bring someone from another of their
// runs instead, all they are and carry, which ends that run.

const STATS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"] as const;
type Stat = (typeof STATS)[number];
const ABBR: Record<Stat, string> = { strength: "STR", dexterity: "DEX", constitution: "CON", intelligence: "INT", wisdom: "WIS", charisma: "CHA" };

export interface CreationHooks {
  bridge: Bridge;
  particles: Particles;
  screen: Screen;
  made(tell: string, name: string, calling: string): void; // the character stands; the story can begin
}

export async function makeCharacter(host: HTMLElement, hooks: CreationHooks): Promise<void> {
  const options = await hooks.bridge.character();
  if (!options || options.error) {
    host.replaceChildren(h("div", { class: "creation" }, h("p", { class: "err" }, options?.error ?? "The world server is not answering.")));
    host.hidden = false;
    return;
  }
  new Creation(host, options, hooks).open();
}

class Creation {
  private host: HTMLElement;
  private o: CharacterOptions;
  private hooks: CreationHooks;
  private mode: "roll" | "spread" = "roll";
  private rolled: Record<string, number> | null;
  private mayReroll: boolean;
  private spread: Record<Stat, number>;
  private calling: CallingOption | null = null;
  private people: PeopleOption | null;
  private named = true; // the name is one suggested, not one typed
  private picks = new Set<string>();
  private gender: "female" | "male" = "female";
  private tiles = new Map<Stat, { score: HTMLElement; mod: HTMLElement; plus: HTMLElement; tile: HTMLElement }>();
  private els: Record<string, HTMLElement> = {};

  constructor(host: HTMLElement, o: CharacterOptions, hooks: CreationHooks) {
    this.host = host;
    this.o = o;
    this.hooks = hooks;
    this.rolled = o.rolled?.abilities ?? null;
    this.mayReroll = o.rolled?.may_reroll_one ?? true;
    this.people = o.peoples?.find((p) => p.id === "human") ?? o.peoples?.[0] ?? null;
    this.spread = this.even();
  }

  // What a spread may be for the people chosen.
  private rule(): Spread {
    return this.people?.spread ?? this.o.spread;
  }

  private cap(s: Stat): number {
    const r = this.rule();
    return r.caps?.[s] ?? r.max;
  }

  // The points spread as evenly as the people's caps allow.
  private even(): Record<Stat, number> {
    const r = this.rule();
    const out = Object.fromEntries(STATS.map((s) => [s, Math.min(Math.floor(r.points / STATS.length), this.cap(s))])) as Record<Stat, number>;
    let left = r.points - Object.values(out).reduce((a, b) => a + b, 0);
    while (left > 0) {
      const room = STATS.filter((s) => out[s] < this.cap(s));
      if (!room.length) break;
      for (const s of room) { if (left <= 0) break; out[s] += 1; left -= 1; }
    }
    return out;
  }

  // The rolled scores as the character is born with them: their people's
  // pluses added, never past the dice's reach.
  private born(): Record<string, number> | null {
    if (!this.rolled) return null;
    const most = this.people?.roll_most ?? 20;
    return Object.fromEntries(STATS.map((s) => [s, Math.max(1, Math.min(most, this.rolled![s] + (this.people?.pluses[s] ?? 0)))]));
  }

  open(): void {
    const e = this.els;
    e.statsNote = h("div", { class: "note" });
    e.tiles = h("div", { class: "tiles" }, ...STATS.map((s) => this.tile(s)));
    e.rollBtn = h("button", { type: "button", class: "primary" }, "Roll the dice");
    e.rollBtn.addEventListener("click", () => this.roll());
    e.modeBtn = h("button", { type: "button", class: "quiet" });
    e.modeBtn.addEventListener("click", () => this.setMode(this.mode === "roll" ? "spread" : "roll"));
    e.callings = h("div", { class: "callings" }, ...this.o.callings.map((c) => this.card(c)));
    e.peoples = h("div", { class: "callings peoples" }, ...(this.o.peoples ?? []).map((p) => this.peopleCard(p)));
    e.firsts = h("div", { class: "firsts" });
    e.name = h("input", { type: "text", class: "name-in", placeholder: "a name", maxlength: "40", spellcheck: "false" }) as HTMLInputElement;
    e.name.addEventListener("input", () => { this.named = false; this.check(); });
    const suggest = h("button", { type: "button", class: "quiet dice", title: "a name of the land" }, "⚂");
    suggest.addEventListener("click", () => this.suggest());
    e.genders = h("div", { class: "genders" }, ...(["female", "male"] as const).map((g) => {
      const b = h("button", { type: "button", "data-g": g }, g === "female" ? "woman" : "man");
      b.addEventListener("click", () => { this.gender = g; this.paintGender(); });
      return b;
    }));
    e.go = h("button", { type: "button", class: "primary go", disabled: "" }, "Set out");
    e.go.addEventListener("click", () => this.make());
    e.err = h("p", { class: "err" });
    const box = h("div", { class: "creation" },
      h("div", { class: "head" }, h("div", { class: "title" }, "Who sets out"), h("div", { class: "rule" })),
      this.o.bring?.length ? h("section", { class: "bring" }, h("h3", null, "someone from another world"),
        h("div", { class: "ways" }, ...this.o.bring.map((b) => this.bringCard(b))),
        h("p", { class: "note" }, "They come as they are, with all they carry, however out of place here; nothing of their world comes with them, and their run there ends."),
        h("h3", null, "or someone new")) : null,
      this.o.peoples?.length ? h("section", null, h("h3", null, "your people"), e.peoples) : null,
      h("section", null, h("h3", null, "what you were born with"), e.tiles, h("div", { class: "row" }, e.rollBtn, e.modeBtn), e.statsNote),
      h("section", null, h("h3", null, "your calling"), e.callings),
      h("section", { class: "firsts-sec" }, h("h3", null, `what you can do first: choose ${this.o.picks}`), e.firsts),
      h("section", null, h("h3", null, "your name"), h("div", { class: "row" }, e.name, suggest, e.genders)),
      h("div", { class: "row end" }, e.err, e.go));
    this.host.replaceChildren(box);
    this.host.hidden = false;
    this.paintPeople();
    this.setMode("roll");
    this.paintGender();
    this.suggest();
    if (this.rolled) this.show(this.born()!, false);
    box.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.8,.3,1)" });
  }

  // ── the six ─────────────────────────────────────────────────────────

  private tile(s: Stat): HTMLElement {
    const score = h("b", null, "–");
    const mod = h("span", { class: "mod mp0" }, "");
    const plus = h("span", { class: "plus" }, "");
    const minus = h("button", { type: "button", class: "step", "aria-label": `less ${s}` }, "−");
    minus.addEventListener("click", (ev) => { ev.stopPropagation(); this.step(s, -1); });
    const more = h("button", { type: "button", class: "step", "aria-label": `more ${s}` }, "+");
    more.addEventListener("click", (ev) => { ev.stopPropagation(); this.step(s, 1); });
    const tile = h("div", { class: "tile", "data-s": s }, h("span", { class: "k" }, ABBR[s]), score, mod, plus, h("div", { class: "steps" }, minus, more));
    tile.addEventListener("click", () => this.reroll(s));
    this.tiles.set(s, { score, mod, plus, tile });
    return tile;
  }

  // What the people adds on each tile when rolled; where it lets a score
  // go further or less far when spread.
  private paintPluses(): void {
    for (const s of STATS) {
      const t = this.tiles.get(s)!;
      if (this.mode === "roll") {
        // What it adds to this roll: less where the dice's reach stops it.
        const born = this.born();
        const n = born && this.rolled ? born[s] - this.rolled[s] : (this.people?.pluses[s] ?? 0);
        t.plus.textContent = n ? `${n > 0 ? "+" : "−"}${Math.abs(n)} ${this.people!.name.toLowerCase()}` : "";
        t.plus.className = `plus ${n > 0 ? "up" : n < 0 ? "down" : ""}`;
      } else {
        const c = this.cap(s);
        t.plus.textContent = c !== this.o.spread.max ? `to ${c}` : "";
        t.plus.className = `plus ${c > this.o.spread.max ? "up" : c < this.o.spread.max ? "down" : ""}`;
      }
    }
  }

  private setMode(m: "roll" | "spread"): void {
    this.mode = m;
    this.host.querySelector(".creation")?.classList.toggle("spreading", m === "spread");
    this.els.modeBtn.textContent = m === "roll" ? `or spread ${this.rule().points} points` : "or roll the dice";
    this.els.rollBtn.hidden = m === "spread" || !!this.rolled;
    if (m === "spread") this.show(this.spread, false);
    else if (this.rolled) this.show(this.born()!, false);
    else for (const t of this.tiles.values()) { t.score.textContent = "–"; t.mod.textContent = ""; }
    this.paintPluses();
    this.note();
    this.check();
  }

  private scores(): Record<string, number> | null {
    return this.mode === "spread" ? this.spread : this.born();
  }

  private show(values: Record<string, number>, landed: boolean): void {
    for (const s of STATS) {
      const t = this.tiles.get(s)!;
      const m = modOf(values[s]);
      t.score.textContent = String(values[s]);
      t.mod.className = modClass(m);
      t.mod.textContent = signed(m);
      if (landed) void stampMod(t.mod, m);
    }
    this.paintFit();
  }

  private async roll(): Promise<void> {
    const btn = this.els.rollBtn as HTMLButtonElement;
    btn.disabled = true;
    const r = await this.hooks.bridge.rollCharacter();
    if (!r || r.error) return this.fail(r?.error ?? "The world server is not answering.");
    this.rolled = r.abilities;
    this.mayReroll = r.may_reroll_one ?? false;
    btn.hidden = true;
    await this.tumble(STATS.slice());
    this.note();
    this.check();
  }

  private async reroll(s: Stat): Promise<void> {
    if (this.mode !== "roll" || !this.rolled || !this.mayReroll) return;
    this.mayReroll = false;
    const r = await this.hooks.bridge.rerollStat(s);
    if (!r || r.error) return this.fail(r?.error ?? "The world server is not answering.");
    const was = this.born()![s];
    this.rolled = r.abilities;
    await this.tumble([s]);
    const t = this.tiles.get(s)!;
    t.tile.classList.add("again");
    t.tile.title = `was ${was}`;
    this.note();
    this.check();
  }

  // Each die tumbles, then they land one after another, each modifier
  // stamping in its colour; a fine score throws sparks. Each lands as the
  // people chosen when it lands would have it.
  private async tumble(which: Stat[]): Promise<void> {
    const still = this.hooks.screen.mode === "off";
    for (const s of which) this.tiles.get(s)!.tile.classList.add("rolling");
    if (!still) {
      for (let t = 0; t < 11; t++) {
        for (const s of which) this.tiles.get(s)!.score.textContent = String(2 + Math.floor(Math.random() * 19));
        await sleep(50 + t * 7);
      }
    }
    for (const s of which) {
      const t = this.tiles.get(s)!;
      t.tile.classList.remove("rolling");
      const v = this.born()![s];
      const m = modOf(v);
      t.score.textContent = String(v);
      t.mod.className = modClass(m);
      t.mod.textContent = signed(m);
      if (still) continue;
      t.tile.animate([{ transform: "scale(1.15)" }, { transform: "scale(0.96)", offset: 0.6 }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
      void stampMod(t.mod, m);
      if (m >= 3) {
        const r = t.tile.getBoundingClientRect();
        this.hooks.particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 10 + m * 6, speed: 2 + m * 0.5, shape: "star", size: 1.4,
          colors: m >= 4 ? ["#ffd77a", "#fff3a6", "#ffffff"] : ["#6fd3ff", "#d8f4ff"], life: 0.7 });
      }
      await sleep(110);
    }
    this.paintFit();
  }

  private step(s: Stat, by: number): void {
    if (this.mode !== "spread") return;
    const { min, points } = this.rule();
    const next = this.spread[s] + by;
    const left = points - Object.values(this.spread).reduce((a, b) => a + b, 0);
    if (next < min || next > this.cap(s) || (by > 0 && left <= 0)) return;
    this.spread[s] = next;
    const t = this.tiles.get(s)!;
    const m = modOf(next);
    t.score.textContent = String(next);
    if (t.mod.textContent !== signed(m)) {
      t.mod.className = modClass(m);
      t.mod.textContent = signed(m);
      void stampMod(t.mod, m);
    }
    this.paintFit();
    this.note();
    this.check();
  }

  private note(): void {
    if (this.mode === "spread") {
      const r = this.rule();
      const left = r.points - Object.values(this.spread).reduce((a, b) => a + b, 0);
      const own = STATS.filter((s) => this.cap(s) !== this.o.spread.max).map((s) => `${ABBR[s]} ${this.cap(s)}`);
      this.els.statsNote.textContent = left
        ? `${left} point${left === 1 ? "" : "s"} to spend · each ${r.min} to ${this.o.spread.max}${own.length ? ` (${own.join(", ")})` : ""}`
        : "all spent";
    } else if (!this.rolled) this.els.statsNote.textContent = `${this.o.dice ? `${this.o.dice} each; ` : ""}the dice fall once, and one may fall again`;
    else this.els.statsNote.textContent = this.mayReroll ? "click one score to roll it again, once" : "these stand";
    this.host.querySelector(".tiles")?.classList.toggle("rerollable", this.mode === "roll" && !!this.rolled && this.mayReroll);
  }

  // ── the people ──────────────────────────────────────────────────────

  private peopleCard(p: PeopleOption): HTMLElement {
    // What being of them does to each score, the gifts first.
    const mods = Object.entries(p.pluses).sort((a, b) => b[1] - a[1]).map(([s, v]) => `${ABBR[s as Stat]} ${v > 0 ? "+" : "−"}${Math.abs(v)}`).join(" · ");
    const card = h("button", { type: "button", class: "calling-card people-card", "data-id": p.id },
      h("div", { class: "name" }, p.plural),
      h("div", { class: "what" }, p.looks),
      h("div", { class: "facts" }, h("span", null, mods || "even in every score"), h("span", null, `${p.spread.points} points`)));
    card.addEventListener("click", () => this.choosePeople(p));
    return card;
  }

  private choosePeople(p: PeopleOption): void {
    if (this.people?.id === p.id) return;
    this.people = p;
    this.spread = this.even();
    this.paintPeople();
    this.els.peoples.querySelector<HTMLElement>(".chosen")?.animate([{ transform: "scale(1.04)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    if (this.mode === "spread") this.show(this.spread, false);
    else if (this.rolled) this.show(this.born()!, true);
    this.els.modeBtn.textContent = this.mode === "roll" ? `or spread ${this.rule().points} points` : "or roll the dice";
    this.paintPluses();
    this.note();
    if (this.named) this.suggest();
    this.check();
  }

  private paintPeople(): void {
    for (const el of this.els.peoples?.children ?? []) el.classList.toggle("chosen", (el as HTMLElement).dataset.id === this.people?.id);
  }

  // ── the calling ─────────────────────────────────────────────────────

  private card(c: CallingOption): HTMLElement {
    const card = h("button", { type: "button", class: "calling-card", "data-id": c.id },
      h("div", { class: "name" }, c.name),
      h("div", { class: "what" }, c.what),
      h("div", { class: "facts" }, c.leans_on ? h("span", { class: "leans" }, `on ${c.leans_on.slice(0, 3).toUpperCase()} `, h("span", { class: "fitmod" })) : null,
        c.hardiness ? h("span", null, HARDY[c.hardiness] ?? "") : null),
      c.carries?.length ? h("div", { class: "carries" }, c.carries.join(" · ")) : null,
      h("div", { class: "fit" }, "suits you"));
    card.addEventListener("click", () => this.choose(c));
    return card;
  }

  private choose(c: CallingOption): void {
    this.calling = c;
    this.picks.clear();
    for (const el of this.els.callings.children) el.classList.toggle("chosen", (el as HTMLElement).dataset.id === c.id);
    const chosen = this.els.callings.querySelector<HTMLElement>(".chosen");
    chosen?.animate([{ transform: "scale(1.04)" }, { transform: "none" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    this.els.firsts.replaceChildren(...c.first.map((a) => {
      const chip = h("button", { type: "button", class: "first", "data-id": a.id, title: a.what },
        h("span", { class: "fname" }, a.name),
        h("span", { class: "fmeta" }, [a.kind, a.dice, a.per_level ? `grows ${a.per_level} every ${a.every ?? 3} lvl` : null, a.uses ? `${a.uses}× a rest` : null].filter(Boolean).join(" · ")),
        h("span", { class: "fwhat" }, a.what));
      chip.addEventListener("click", () => this.pick(a.id, chip));
      return chip;
    }));
    this.host.querySelector(".firsts-sec")?.classList.add("open");
    this.check();
  }

  private pick(id: string, chip: HTMLElement): void {
    if (this.picks.has(id)) this.picks.delete(id);
    else if (this.picks.size < this.o.picks) this.picks.add(id);
    else return void chip.animate([{ transform: "translateX(-3px)" }, { transform: "translateX(3px)" }, { transform: "none" }], { duration: 180 });
    chip.classList.toggle("picked", this.picks.has(id));
    if (this.picks.has(id)) chip.animate([{ transform: "scale(1.06)" }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(.2,.9,.3,1.3)" });
    this.check();
  }

  // The calling whose work leans on the player's best score suits them,
  // and each card shows what that score adds.
  private paintFit(): void {
    const v = this.scores();
    for (const el of this.els.callings?.children ?? []) {
      const c = this.o.callings.find((x) => x.id === (el as HTMLElement).dataset.id);
      const fm = el.querySelector<HTMLElement>(".fitmod");
      if (!c || !fm) continue;
      if (!v || !c.leans_on) { fm.textContent = ""; el.classList.remove("suits"); continue; }
      const m = modOf(v[c.leans_on]);
      fm.className = `fitmod ${modClass(m)}`;
      fm.textContent = signed(m);
      const best = Math.max(...STATS.map((s) => v[s]));
      el.classList.toggle("suits", v[c.leans_on] === best);
    }
  }

  // ── the name ────────────────────────────────────────────────────────

  private paintGender(): void {
    for (const b of this.els.genders.children) b.classList.toggle("on", (b as HTMLElement).dataset.g === this.gender);
    this.check();
  }

  private suggest(): void {
    const pool = this.people?.names?.[this.gender] ?? this.o.names?.[this.gender] ?? [];
    if (!pool.length) return;
    this.named = true;
    const input = this.els.name as HTMLInputElement;
    const others = pool.filter((n) => n !== input.value);
    input.value = (others.length ? others : pool)[Math.floor(Math.random() * (others.length || pool.length))];
    input.animate([{ opacity: 0.3 }, { opacity: 1 }], { duration: 200 });
    this.check();
  }

  // ── setting out ─────────────────────────────────────────────────────

  private ready(): boolean {
    const v = this.scores();
    const spent = this.mode === "roll" || Object.values(this.spread).reduce((a, b) => a + b, 0) === this.rule().points;
    return !!v && spent && !!this.calling && this.picks.size === this.o.picks && (this.els.name as HTMLInputElement).value.trim().length > 0;
  }

  private check(): void {
    const go = this.els.go as HTMLButtonElement | undefined;
    if (!go) return;
    const was = go.disabled;
    go.disabled = !this.ready();
    if (was && !go.disabled) go.animate([{ transform: "scale(1.08)", filter: "brightness(1.6)" }, { transform: "none", filter: "none" }], { duration: 320 });
  }

  private fail(message: string): void {
    this.els.err.textContent = message;
    (this.els.rollBtn as HTMLButtonElement).disabled = false;
  }

  // Someone from another of the player's runs: pressed once, it asks to be
  // sure (their run there ends); pressed again, they come.
  private bringCard(b: Bringable): HTMLElement {
    const what = [b.glance, b.calling, `level ${b.level}`].filter(Boolean).join(" · ");
    const card = h("button", { type: "button", class: "way" }, h("span", { class: "fname" }, b.name), h("span", { class: "fwhat" }, what)) as HTMLButtonElement;
    let sure = false;
    card.addEventListener("click", async () => {
      if (!sure) {
        sure = true;
        card.querySelector(".fwhat")!.textContent = `Bring ${b.name}? Their run in that world ends. Press again to bring them.`;
        return;
      }
      for (const x of this.host.querySelectorAll<HTMLButtonElement>("button")) x.disabled = true;
      this.els.err.textContent = "";
      const made = await this.hooks.bridge.bringCharacter(b.run);
      if (!made || made.error || !made.tell) {
        for (const x of this.host.querySelectorAll<HTMLButtonElement>("button")) x.disabled = false;
        this.check();
        return this.fail(made?.error ?? "The world server is not answering.");
      }
      await this.leave(card);
      this.hooks.made(made.tell, made.sheet?.name ?? b.name, made.sheet?.class ?? b.calling ?? "");
    });
    return card;
  }

  // The screen gone, with a burst where it was left from.
  private async leave(from: HTMLElement): Promise<void> {
    const box = this.host.querySelector<HTMLElement>(".creation");
    if (box && this.hooks.screen.mode !== "off") {
      const r = from.getBoundingClientRect();
      this.hooks.particles.burst(r.left + r.width / 2, r.top + r.height / 2, { count: 60, speed: 7, shape: "star", colors: ["#ffd77a", "#fff3a6", "#ffffff"] });
      await settled(box.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-14px) scale(0.98)" }], { duration: 380, easing: "ease-in", fill: "forwards" }));
    }
    this.host.hidden = true;
    this.host.replaceChildren();
  }

  private async make(): Promise<void> {
    if (!this.ready() || !this.calling) return;
    const go = this.els.go as HTMLButtonElement;
    go.disabled = true;
    this.els.err.textContent = "";
    const name = (this.els.name as HTMLInputElement).value.trim();
    const made = await this.hooks.bridge.makeCharacter({
      name, gender: this.gender, calling: this.calling.id, abilities: [...this.picks], ...(this.people ? { people: this.people.id } : {}),
      ...(this.mode === "spread" ? { stats: this.spread } : {}),
    });
    if (!made || made.error || !made.tell) {
      go.disabled = false;
      return this.fail(made?.error ?? "The world server is not answering.");
    }
    await this.leave(go);
    this.hooks.made(made.tell, made.sheet?.name ?? name, made.sheet?.class ?? this.calling.name);
  }
}
