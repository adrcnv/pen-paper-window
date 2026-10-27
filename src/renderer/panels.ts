import type { DmChoice, Settings } from "../core/bridge.ts";
import type { Atlas, Board, Looks, Lore, Power, Rarity, Stance, Status } from "../core/protocol.ts";
import { $, h } from "./dom.ts";
import { modClass, signed } from "./mods.ts";
import { ansiToNodes } from "./ansi.ts";
import { atlasView } from "./atlas.ts";
import { still } from "./story.ts";
import { restart } from "./fx/screen.ts";
import { rarityClass } from "./flair.ts";
import { helpView } from "./help.ts";

// The side of the window: the hour, the weather, where you stand, your
// health and purse, and the panels the / commands open — all drawn from the
// board the world server hands back after each turn.

export const TABS = ["scene", "sheet", "people", "deals", "journal", "lore", "map", "help"] as const;
export type Tab = (typeof TABS)[number];

const PHASE_GLYPH: Record<string, string> = { morning: "☀", day: "☀", evening: "☾", night: "☾" };
const SKY_GLYPH: Record<string, string> = { storm: "⚡", snow: "❄", rain: "☂", fog: "≋", overcast: "☁", fair: "⛅", clear: "✧" };
const STANCE_COLOR: Record<Stance, string> = { hostile: "var(--hostile)", guarded: "var(--guarded)", neutral: "var(--neutral)", warm: "var(--warm)", trusting: "var(--trusting)", you: "var(--said)" };


// A fact about a place as words: a plain value, or a list of them. Anything
// else is a record's own business, not for reading.
function words(v: unknown): string | null {
  const plain = (x: unknown) => typeof x === "string" || typeof x === "number" || typeof x === "boolean";
  if (plain(v)) return String(v);
  return Array.isArray(v) && v.length && v.every(plain) ? v.join(", ") : null;
}

export class Panels {
  board: Board | null = null;
  tab: Tab = "scene";
  dm = ""; // who plays the DM, shown under the status
  settings: Settings | null = null; // the window's settings, changed from the help tab
  onSettings: ((patch: Partial<Settings>) => void) | null = null;
  onMenu: (() => void) | null = null; // back to the launch menu
  private dmPick: { get: () => Promise<DmChoice>; set: (model: string, effort: string) => Promise<{ ok: true; label: string } | { error: string }> } | null = null;
  private picking: DmChoice | null = null; // the DM's model being chosen
  private pickNote = "";
  private hp = { now: 0, max: 0 };
  private coins = 0;
  private map: () => Promise<string>;
  private atlas: () => Promise<Atlas | null>;
  private loreOf: () => Promise<Lore | null>;
  private loreCache: { world: string; lore: Lore | null } | null = null;
  private opened = new Set<string>(["How it began"]);
  private mapCache: HTMLElement | null = null;

  constructor(map: () => Promise<string>, atlas: () => Promise<Atlas | null>, lore: () => Promise<Lore | null>,
              dm?: { get: () => Promise<DmChoice>; set: (model: string, effort: string) => Promise<{ ok: true; label: string } | { error: string }> }) {
    this.dmPick = dm ?? null;
    this.map = map;
    this.atlas = atlas;
    this.loreOf = lore;
    const view = $("#mapview");
    view.addEventListener("click", (e) => (e.target === view || (e.target as Element).closest(".close")) && this.closeMap());
    const tabs = $("#tabs");
    for (const t of TABS) {
      const b = h("button", { role: "tab", "aria-selected": String(t === this.tab), "data-tab": t }, t);
      b.addEventListener("click", () => this.show(t));
      tabs.append(b);
    }
  }

  update(board: Board): void {
    this.board = board;
    this.mapCache = null;
    this.status();
    this.show(this.tab, false);
  }

  show(tab: Tab, flash = true): void {
    if (tab === "map") return this.openMap();
    this.tab = tab;
    for (const b of document.querySelectorAll<HTMLElement>("#tabs button")) {
      b.setAttribute("aria-selected", String(b.dataset.tab === tab));
      if (b.dataset.tab === tab) b.classList.remove("fresh");
    }
    const panel = $("#panel");
    panel.replaceChildren(...this.render(tab));
    if (flash) {
      restart($("#side"), "flash");
      restart(panel, "swap");
    }
  }

  // ── the status block ───────────────────────────────────────────────

  private status(): void {
    const s = this.board?.status;
    const box = $("#status");
    if (!s) {
      box.replaceChildren();
      return;
    }
    const [now, max] = (s.hp ?? "0/0").split("/").map(Number);
    this.hp = { now, max };
    this.coins = s.coins ?? 0;
    const where = h("div", { class: "where" });
    (s.where ?? []).forEach((w, i) => {
      if (i) where.append(h("span", { class: "sep" }, "›"));
      where.append(w);
    });
    const clock = (s.time ?? "").match(/(\d{1,2}:\d{2})/)?.[1] ?? "";
    const sheet = this.board?.sheet;
    box.replaceChildren(
      h("div", { class: "when" }, h("span", { class: "glyph" }, PHASE_GLYPH[s.phase ?? ""] ?? "·"), `Day ${s.day ?? "?"} · ${s.phase ?? ""}`, h("span", { class: "clock" }, clock)),
      h("div", { class: "sky-line" }, h("span", { class: `sky-glyph s-${s.sky ?? "none"}` }, SKY_GLYPH[s.sky ?? ""] ?? ""), ` ${[s.season, s.weather].filter(Boolean).join(" · ")}`),
      where,
      h("div", { class: "vitals" },
        h("span", { class: "lab" }, "♥"), bar("hp", now, max), h("span", { class: "num", id: "hp-num" }, s.hp ?? ""),
        sheet ? h("span", { class: "lab" }, "✦") : null, sheet ? bar("xp", sheet.xp, sheet.next_xp) : null, sheet ? h("span", { class: "num" }, `${sheet.xp}/${sheet.next_xp}`) : null,
        h("span", { class: "lab" }, "◎"), h("span", { class: "coins", id: "coins" }, String(this.coins)), h("span"),
      ),
      ...(s.lives ? [h("div", { class: "lives", title: "lives: a death before the last turns the world back" },
        ...Array.from({ length: s.lives.of }, (_, i) => h("span", { class: i < s.lives!.left ? "life" : "life spent" }, i < s.lives!.left ? "❤" : "♡")))] : []),
      ...(this.board?.guest ? [h("div", { class: "guest-line", title: "a guest's run is not kept: it goes once nobody has played it for this long" },
        `Guest run · kept ${this.board.guest.kept_for_hours} hours unplayed`)] : []),
      ...(s.turns ? [turnsLine(s.turns)] : []),
      ...(s.quiet_until ? [h("div", { class: "quiet-line", title: "Nothing new is set going out of sight from what happens now until then. What you do still counts, and play goes on." },
        `The world beyond rests until ${new Date(s.quiet_until * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`)] : []),
      ...(this.dm ? [this.dmLine()] : []),
      ...(this.onMenu ? [this.menuLine()] : []),
      ...(this.picking ? [this.dmPicker(this.picking)] : []),
    );
  }

  // Back to the launch menu: the account's runs, a new one, signing in.
  private menuLine(): HTMLElement {
    const b = h("button", { type: "button", class: "dm-line", title: "your runs, a new one, signing in" }, "back to the menu");
    b.addEventListener("click", () => this.onMenu?.());
    return b;
  }

  // Who plays the DM; clicked, the models and efforts to switch it to.
  private dmLine(): HTMLElement {
    if (!this.dmPick) return h("div", { class: "dm-line" }, `DM: ${this.dm}`);
    const b = h("button", { type: "button", class: "dm-line", title: "change the DM's model" }, `DM: ${this.dm}`);
    b.addEventListener("click", async () => {
      if (this.picking) this.picking = null;
      else {
        const choice = await this.dmPick!.get();
        this.picking = choice.which === "replay" ? null : choice;
      }
      this.pickNote = "";
      this.status();
    });
    return b;
  }

  private dmPicker(c: DmChoice): HTMLElement {
    if (c.which === "replay") return h("div");
    const choose = async (model: string, effort: string) => {
      const out = await this.dmPick!.set(model, effort);
      if ("error" in out) this.pickNote = out.error;
      else {
        this.dm = out.label;
        this.picking = { ...c, model, effort };
        this.pickNote = "from the next turn";
      }
      this.status();
    };
    const chip = (label: string, on: boolean, pick: () => void) => {
      const b = h("button", { type: "button", class: `pick${on ? " on" : ""}` }, label);
      b.addEventListener("click", pick);
      return b;
    };
    let models: HTMLElement;
    if (c.which === "claude") {
      models = h("div", { class: "picks" }, ...c.models.map((m) => chip(m.name, c.model === m.id || c.model.includes(m.id), () => void choose(m.id, c.effort))));
    } else {
      const name = h("input", { type: "text", class: "pick-in", placeholder: "its default", maxlength: "64", spellcheck: "false" }) as HTMLInputElement;
      name.value = c.model;
      name.addEventListener("change", () => void choose(name.value.trim(), c.effort));
      models = h("div", { class: "picks" }, name);
    }
    const efforts = h("div", { class: "picks" }, ...c.efforts.map((e) => chip(e || "default", c.effort === e, () => void choose(c.model, e))));
    return h("div", { class: "dm-pick" }, h("span", { class: "lab" }, "model"), models, h("span", { class: "lab" }, "effort"), efforts,
      this.pickNote ? h("div", { class: "pick-note" }, this.pickNote) : null);
  }

  // Health moved mid-turn (a blow, a bandage): the bar follows at once, its
  // pale shadow catching up a moment later.
  setHp(hp: string): void {
    const [now, max] = hp.split("/").map(Number);
    if (!max) return;
    this.hp = { now, max };
    const el = document.querySelector<HTMLElement>(".bar.hp");
    if (!el) return;
    const pct = `${Math.max(0, Math.min(100, (now / max) * 100))}%`;
    el.querySelector<HTMLElement>(".fill")!.style.width = pct;
    el.querySelector<HTMLElement>(".lag")!.style.width = pct;
    el.classList.toggle("low", now / max <= 0.25);
    const num = document.getElementById("hp-num");
    if (num) num.textContent = hp;
  }

  addCoins(delta: number): void {
    const el = document.getElementById("coins");
    if (!el) return;
    const from = this.coins;
    this.coins += delta;
    const to = this.coins;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      el.textContent = String(Math.round(from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    restart(el, "tick");
  }

  purse(): HTMLElement | null {
    return document.getElementById("coins");
  }

  // ── the panels ─────────────────────────────────────────────────────

  private render(tab: Tab): Node[] {
    const b = this.board;
    if (tab === "help") return this.help();
    if (tab === "lore") return this.lore();
    if (!b || b.error) return [h("p", { class: "empty" }, b?.error ? "Nothing yet: the story has not begun." : "…")];
    switch (tab) {
      case "scene": {
        const s = b.scene!;
        const out: Node[] = [h("h2", null, s.place ?? ""), h("div", { class: "sub" }, [s.town !== s.place ? s.town : null, s.open].filter(Boolean).join(" · "))];
        if (s.description) out.push(h("p", { class: "desc" }, s.description));
        const state = Object.entries(s.state ?? {}).flatMap(([k, v]) => { const said = words(v); return said ? [`${k.replace(/_/g, " ")}: ${said}`] : []; });
        if (state.length) out.push(h("ul", null, ...state.map((line) => h("li", { class: "muted" }, line))));
        // What the town has nailed up where it gathers.
        if (s.board?.length) out.push(h("h3", null, "the board"), ...s.board.map((n) => h("div", { class: `bill${n.done ? " done" : ""}` },
          h("p", null, n.text), h("div", { class: "held" }, n.done ? "done; the reward still held" : "", n.holds && !n.done ? `${n.holds} coins held` : ""))));
        // In a fight: the round, in the order rolled, who has gone and who is up.
        const turn = b.status?.turn;
        if (turn?.order.length) out.push(h("h3", null, `the fight · round ${turn.round}`), h("div", { class: "initiative" },
          ...turn.order.map((t) => h("span", { class: `init${t.gone ? " gone" : ""}${t.up ? " up" : ""}${t.you ? " you" : ""}` },
            h("b", null, String(t.roll)), ` ${t.name}`))));
        out.push(h("h3", null, "here"));
        out.push(s.people.length
          ? h("ul", null, ...s.people.map((p) => opens(h("li", null, dot(p.stance ?? "neutral", !p.stance),
              h("span", { class: "person", title: p.glance }, p.name),
              p.trade ? h("span", { class: "muted" }, p.trade) : null,
              p.held ? h("span", { class: "held-tag", title: p.held }, "⛓ held") : null), p.looks ? looksView(p.looks) : null)))
          : h("p", { class: "empty" }, "No one else."));
        if (s.things.length) out.push(h("h3", null, "lying about"), h("ul", null, ...s.things.map((t) => opens(h("li", null, thing(t.name, t.rarity), t.has_writing ? h("span", { class: "muted" }, "(written in)") : null), fightsView(t.fights)))));
        if (s.wares.length) out.push(h("h3", null, "for sale"), h("ul", null, ...s.wares.map((w) => opens(h("li", null, thing(w.name, w.rarity, false), h("span", { class: "price" }, w.price)), fightsView(w.fights)))));
        if (s.ways.length) out.push(h("h3", null, "ways"), h("ul", null, ...s.ways.map((w) => h("li", null, h("span", { class: "place" }, w.name), w.kept_by ? h("span", { class: "muted" }, w.kept_by) : null))));
        if (s.beyond.length) out.push(h("h3", null, "beyond"), h("ul", null, ...s.beyond.map((o) => h("li", null, h("span", { class: "place" }, o.name), h("span", { class: "muted" }, o.way)))));
        return out;
      }
      case "sheet": {
        const s = b.sheet!;
        return [
          h("h2", null, s.name), h("div", { class: "sub" }, `${s.class ?? ""} · level ${s.level}`),
          h("h3", null, "abilities"),
          h("div", { class: "stats" }, ...s.abilities.map((a) => h("div", { class: "stat" }, h("div", { class: "k" }, a.name.slice(0, 3).toUpperCase()), h("div", { class: "s" }, String(a.score)), h("div", { class: `m ${modClass(a.mod)}` }, signed(a.mod))))),
          ...(s.powers.length ? [h("h3", null, "powers"), h("ul", { class: "powers" }, ...s.powers.map(power))] : []),
          h("h3", null, "carrying"),
          s.carrying.length ? h("ul", null, ...s.carrying.map((i) => opens(h("li", null, thing(i.name, i.rarity), i.left != null ? h("span", { class: "muted" }, `×${i.left}`) : null, i.has_writing ? h("span", { class: "muted" }, "(written in)") : null), fightsView(i.fights)))) : h("p", { class: "empty" }, "Nothing."),
        ];
      }
      case "people": {
        const list = b.people ?? [];
        if (!list.length) return [h("p", { class: "empty" }, "You have not met anyone yet.")];
        return [h("ul", null, ...list.map((p) => h("li", null, dot(p.stance),
          h("span", null, h("span", { class: "person", title: p.glance }, p.name), h("div", { class: "muted" }, [p.trade, p.at, p.status].filter(Boolean).join(" · "))))))];
      }
      case "deals": {
        const list = b.deals ?? [];
        if (!list.length) return [h("p", { class: "empty" }, "Nothing owed, nothing promised.")];
        return [h("ul", null, ...list.map((d) => h("li", null, h("span", null,
          h("span", { class: "person" }, d.owed_by ?? "?"), " → ", h("span", { class: "person" }, d.owed_to ?? "?"),
          d.coins ? h("span", { class: "price" }, ` ◎ ${d.coins}`) : null,
          h("div", null, d.terms ?? ""), h("div", { class: "muted" }, d.due ? `due ${d.due}` : "", d.overdue ? h("span", { class: "late" }, " overdue") : null)))))];
      }
      case "journal": {
        const list = b.journal ?? [];
        if (!list.length) return [h("p", { class: "empty" }, "Nothing yet.")];
        return [...list].reverse().map((e) => h("div", { class: "journal-entry" }, h("div", { class: "when-at" }, e.when ?? ""), ...still(e.paragraphs)));
      }
    }
    return [];
  }

  // The world as anyone in it knows it: how it began (true in it, and
  // there before the player has a character, to read before choosing a
  // calling), its callings, its realms and the days kept. Asked of the world
  // server once per world; an older one that cannot say shows the story alone.
  private lore(): Node[] {
    const world = this.board?.world ?? "";
    if (this.loreCache?.world !== world) {
      this.loreCache = { world, lore: null };
      this.loreOf().catch(() => null).then((l) => {
        if (this.loreCache?.world !== world) return;
        this.loreCache.lore = l ?? { world };
        if (this.tab === "lore") this.show("lore", false);
      });
    }
    const l = this.loreCache.lore;
    const parts = l?.creation ?? this.board?.creation ?? [];
    const out: Node[] = [h("h2", null, "The world"), h("div", { class: "sub" }, "as everyone in it knows it")];
    out.push(this.fold("How it began", parts.length ? parts.flatMap((p) => [
      h("h3", null, p.part), ...p.text.split(/\n\s*\n/).map((para) => h("p", { class: "creation" }, para.trim()))])
      : [h("p", { class: "empty" }, "This world keeps no account of its beginning.")]));
    if (!l) return [...out, h("p", { class: "empty asking" }, "Asking around…")];
    if (l.peoples?.length) out.push(this.fold("Peoples", l.peoples.map((p) => h("div", { class: "realm" },
      h("h4", null, p.name),
      h("p", { class: "lore-what" }, p.looks),
      p.leans ? h("div", { class: "muted" }, p.leans) : null)), `${l.peoples.length}`));
    if (l.callings?.length) out.push(this.fold("Callings", l.callings.map((c) => this.fold(c.name, [
      c.what ? h("p", { class: "lore-what" }, c.what) : null,
      h("ul", { class: "lore-list" }, ...c.abilities.map((a) => h("li", null,
        h("span", { class: "power-name" }, a.name),
        h("span", { class: "muted" }, [a.from_level && a.from_level > 1 ? `from level ${a.from_level}` : null, a.kind].filter(Boolean).join(" · ")),
        a.what ? h("div", { class: "power-what" }, a.what) : null))),
    ].filter(Boolean) as Node[], [c.runs_on ? `on ${c.runs_on.slice(0, 3).toUpperCase()}` : null, HARDY[c.hardiness ?? 0]].filter(Boolean).join(" · "), "calling")), `${l.callings.length}`));
    if (l.realms?.length) out.push(this.fold("Realms", l.realms.map((r) => h("div", { class: "realm" },
      h("h4", null, r.name),
      r.folk ? h("div", { class: "folk" }, r.folk) : null,
      h("div", { class: "muted" }, [r.ruler ? `ruled by ${r.ruler}` : null, r.seat ? `from ${r.seat}` : null].filter(Boolean).join(" ")),
      r.towns.length ? h("div", { class: "towns" }, r.towns.join(" · ")) : null,
      h("ul", { class: "customs" }, ...r.customs.map((c) => h("li", null, c))))), `${l.realms.length}`));
    if (l.days) {
      const d = l.days;
      out.push(this.fold("Days kept", [
        d.next_here ? h("p", { class: "next-day" }, h("span", { class: "glyph" }, "✦"), ` Next in ${d.next_here.town}: ${d.next_here.line}`) : null,
        h("h3", null, `holy days${d.holy_every ? `, one every ${d.holy_every} days across a kingdom` : ""}`),
        h("ul", { class: "lore-list" }, ...d.holy.map((x) => h("li", null, h("span", { class: "day-name" }, x.name), x.keeps ? h("span", { class: "muted" }, x.keeps) : null))),
        h("h3", null, "fairs, each town's own"),
        h("ul", { class: "lore-list" }, ...d.fairs.map((x) => h("li", null, h("span", { class: "day-name" }, x.name), h("span", { class: "muted" }, x.keeps)))),
      ].filter(Boolean) as Node[]));
    }
    return out;
  }

  // A section that folds away, remembered open or shut while the window lives.
  private fold(title: string, body: Node[], aside = "", kind = "section"): HTMLElement {
    const d = h("details", { class: `fold ${kind}` }, h("summary", null, h("span", { class: "fold-title" }, title), aside ? h("span", { class: "fold-aside" }, aside) : null),
      h("div", { class: "fold-body" }, ...body));
    d.open = this.opened.has(title);
    d.addEventListener("toggle", () => (d.open ? this.opened.add(title) : this.opened.delete(title)));
    return d;
  }

  private help(): Node[] {
    if (!this.settings) return [];
    return helpView(this.settings, (patch) => {
      this.onSettings?.(patch);
      this.show("help", false);
    });
  }

  // The realm, unrolled over the story; Esc, a click outside or × rolls it
  // up. Drawn from the atlas, or shown as the server's ANSI map when there
  // is none to draw.
  openMap(): void {
    const view = $("#mapview");
    const body = view.querySelector<HTMLElement>(".body")!;
    view.hidden = false;
    if (this.mapCache) return void body.replaceChildren(this.mapCache);
    body.replaceChildren(h("p", { class: "empty" }, "Unrolling the map…"));
    const show = (el: HTMLElement) => {
      this.mapCache = el;
      body.replaceChildren(el);
    };
    this.atlas()
      .then(async (a) => {
        if (!a?.terrain) throw new Error("no atlas");
        await document.fonts.ready;
        show(atlasView(a));
      })
      .catch(() => this.map().then((ansi) => show(ansiToNodes(ansi))))
      .catch((e) => body.replaceChildren(h("p", { class: "empty" }, String(e?.message ?? e))));
  }

  closeMap(): boolean {
    const view = $("#mapview");
    if (view.hidden) return false;
    view.hidden = true;
    return true;
  }
}

export const HARDY: Record<number, string> = { 6: "slight", 8: "sturdy", 10: "hardy", 12: "very hardy" };
const RANGE: Record<string, string> = { self: "on yourself", close: "within reach", near: "nearby", far: "at a distance" };
const AREA: Record<string, string> = { blast_small: "a small burst", blast_large: "a wide burst", line_short: "a line", cone: "a cone" };

// Free play's turns left; at none, when more come.
function turnsLine(t: NonNullable<Status["turns"]>): HTMLElement {
  if (t.left > 0) return h("div", { class: `turns-line${t.left <= 5 ? " few" : ""}`, title: t.guest ? "a guest's turns: keeping the run on an account gives more" : "free play's turns: more come each day" },
    `${t.left} turn${t.left === 1 ? "" : "s"} left`);
  return h("div", { class: "turns-line few" }, t.until ? `No turns left until ${clockAt(t.until)}` : "A guest's turns are played: keep the run for more");
}

export function clockAt(at: number): string {
  return new Date(at * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// A power: its name and uses left, a plain line of what it does in play,
// then what it looks like as the world tells it.
function power(p: Power): HTMLElement {
  const does = [
    p.kind,
    p.range ? RANGE[p.range] ?? p.range : null,
    p.area && p.area !== "self" ? AREA[p.area] ?? p.area.replace(/_/g, " ") : null,
    p.now ?? p.dice ?? null,
    p.per_level ? `grows ${p.per_level} every ${p.every ?? 3} levels` : null,
    p.runs_on ? `on ${p.runs_on.slice(0, 3).toUpperCase()}` : null,
  ].filter(Boolean).join(" · ");
  return h("li", { class: "power" },
    h("div", { class: "power-head" }, h("span", { style: "color: var(--power)" }, "✧"), h("span", { class: "power-name" }, p.name), h("span", { class: "uses" }, p.uses)),
    does ? h("div", { class: "muted" }, does) : null,
    p.what ? h("div", { class: "power-what" }, p.what) : null);
}

// A line of a list that opens, on a click, onto what more there is to see
// of it; one with nothing more stays as it is.
function opens(li: HTMLElement, more: HTMLElement | null): HTMLElement {
  if (!more) return li;
  li.classList.add("opens");
  more.classList.add("more");
  li.append(more);
  li.addEventListener("click", () => {
    const open = li.classList.toggle("open");
    if (open) more.animate([{ opacity: 0, transform: "translateY(-3px)" }, { opacity: 1, transform: "none" }], { duration: 180, easing: "ease-out" });
  });
  return li;
}

// How a weapon harms or armour guards, as the world's rules have it.
function fightsView(fights?: string): HTMLElement | null {
  return fights ? h("div", { class: "fights" }, fights) : null;
}

const MEASURE_CLASS: Record<string, string> = { "no match for you": "m-low", "greener than you": "m-green", "your match": "m-even",
  "more seasoned than you": "m-high", "far beyond you": "m-beyond" };

// Someone looked over: how they measure up and how hurt they are, what they
// fight with, a sharp mind's guess at their calling, and each score as near
// as the player's Intelligence can tell it.
function looksView(l: Looks): HTMLElement {
  return h("div", { class: "looks" },
    h("div", { class: "measure" }, h("span", { class: MEASURE_CLASS[l.seems] ?? "m-even" }, l.seems), h("span", { class: "muted" }, ` · ${l.hurt}`),
      l.calling ? h("span", { class: "muted" }, ` · ${l.calling}`) : null),
    l.wields ? h("div", { class: "muted" }, "wields ", h("span", { class: "thing" }, l.wields.name), l.wields.fights ? `: ${l.wields.fights}` : "") : null,
    l.wears?.length ? h("div", { class: "muted" }, `wears ${l.wears.join(", ")}`) : null,
    l.scores?.length ? h("div", { class: "guess" }, ...l.scores.map((sc) => {
      const mid = Math.round((sc.lo + sc.hi) / 2);
      return h("span", { class: "g" }, h("span", { class: "k" }, sc.name.slice(0, 3).toUpperCase()),
        h("span", { class: `v ${modClass(Math.floor((mid - 10) / 2))}` }, sc.lo === sc.hi ? String(sc.lo) : `${sc.lo}–${sc.hi}`));
    })) : null,
    h("div", { class: "eye" }, `a ${l.eye} read`));
}

// A thing by name, coloured by how fine it is, its tier on hover.
function thing(name: string, rarity?: Rarity, gem = true): HTMLElement {
  return h("span", { class: `thing${rarityClass(rarity)}`, title: rarity }, gem ? `◆ ${name}` : name);
}

function bar(kind: "hp" | "xp", now: number, max: number): HTMLElement {
  const pct = `${max ? Math.max(0, Math.min(100, (now / max) * 100)) : 0}%`;
  const el = h("div", { class: `bar ${kind}${kind === "hp" && max && now / max <= 0.25 ? " low" : ""}` });
  const lag = h("div", { class: "lag" });
  const fill = h("div", { class: "fill" });
  lag.style.width = pct;
  fill.style.width = pct;
  el.append(lag, fill);
  return el;
}

function dot(stance: Stance, hollow = false): HTMLElement {
  const d = h("span", { class: "dot" });
  d.style.background = hollow ? "transparent" : STANCE_COLOR[stance] ?? STANCE_COLOR.neutral;
  if (hollow) d.style.border = "1px solid var(--faint)";
  return d;
}
