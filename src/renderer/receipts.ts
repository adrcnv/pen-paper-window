import type { Receipt } from "../core/protocol.ts";
import { h, settled, sleep } from "./dom.ts";
import { modClass, modOf, signed, stampMod } from "./mods.ts";
import type { Particles } from "./fx/particles.ts";
import type { Screen } from "./fx/screen.ts";

// What the dice, the purse and the body did, shown as it happens: one line
// each, played in order with a beat between, so a burst of results reads as
// a sequence. Checks roll a die; blows land with a slash; coins fly to the
// purse; a level lights the sky.

export interface ReceiptHooks {
  particles: Particles;
  screen: Screen;
  hp(hp: string, change: "hurt" | "heal"): void; // the player's health moved
  coins(delta: number): void;
  purse(): HTMLElement | null; // where coins fly to
  toTab(tab: "deals" | "sheet" | "people", from: Element | null, glyph: string, color: string): void; // something new for a tab flies to it
}

const D20 = "50,4 93,28 93,72 50,96 7,72 7,28";
// Each die drawn in its own outline, so its size reads at a glance: a d4 a
// triangle, a d6 a square, a d8 a diamond, a d10 a kite, a d12 a pentagon,
// a d20 the hexagon. Odd sizes take the nearest.
const SHAPES: [number, string][] = [
  [4, "50,7 95,89 5,89"], [6, "13,13 87,13 87,87 13,87"], [8, "50,3 97,50 50,97 3,50"],
  [10, "50,3 95,42 50,97 5,42"], [12, "50,4 96,37 78,94 22,94 4,37"], [20, D20],
];
const shapeOf = (sides: number) => (SHAPES.find(([n]) => sides <= n) ?? SHAPES[SHAPES.length - 1])[1];
// What an edge of −2 to 4 says of the player's play.
const PLAY: Record<number, string> = { [-2]: "nonsense", [-1]: "weak", 0: "fair", 1: "well placed", 2: "shrewd", 3: "cunning", 4: "inspired" };

export class Receipts {
  private queue: Promise<void> = Promise.resolve();
  private hooks: ReceiptHooks;
  shown = true;

  constructor(hooks: ReceiptHooks) {
    this.hooks = hooks;
  }

  add(box: HTMLElement, r: Receipt): void {
    this.queue = this.queue.then(() => this.play(box, r)).catch(() => {});
  }

  // Resolves once everything queued so far has played.
  done(): Promise<void> {
    return this.queue;
  }

  private async play(box: HTMLElement, r: Receipt): Promise<void> {
    const { particles, screen } = this.hooks;
    const quiet = !this.shown;
    switch (r.kind) {
      case "check": {
        if (quiet) return;
        const die = h("span", { class: "die" });
        die.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${D20}"/></svg>`;
        const face = h("b", null, "?");
        die.append(face);
        const who = r.who ? `${r.who}: ` : "";
        const verdict = h("span", { class: `verdict ${r.success ? "yes" : "no"}` }, r.success ? "success" : "failure");
        const edge = r.edge ?? 0;
        const total = h("b", null, String(r.total - edge));
        const play = h("span", { class: "play-slot" });
        // what the roller adds, in its colour, stamped in once the die lands
        const mod = h("span", { class: modClass(r.mod) }, signed(r.mod));
        mod.style.opacity = "0";
        const sum = h("span", { class: "sum" }, `${who}${cap(r.ability)} ${r.roll} `, mod, " ", play, "= ", total, ` vs ${r.against} · `);
        box.append(h("div", { class: "chip check" }, die, h("span", null, sum, verdict, r.why ? h("div", { class: "why" }, r.why) : null)));
        // The player's own roll takes its time; anyone else's is quicker.
        if (screen.mode === "off") face.textContent = String(r.roll);
        else await spin(die, face, r.roll, r.who == null ? 2000 : 1200);
        land(die, r.roll, screen.mode !== "off");
        mod.style.opacity = "";
        if (this.hooks.screen.mode !== "off") await stampMod(mod, r.mod);
        // Every weighing shows, but an ordinary try only on the player's own
        // check: a fight would fill with them.
        if (r.edge != null && (edge !== 0 || (r.who == null && !r.blow))) await this.edge(play, total, r, verdict);
        verdict.classList.add("shown");
        const at = centre(die);
        if (r.critical) {
          die.classList.add("crit");
          particles.burst(at.x, at.y, { count: 70, speed: 7, shape: "star", colors: ["#ffd77a", "#fff3a6", "#ffffff"] });
          screen.banner("CRITICAL", "a natural twenty", "level");
        } else if (r.fumble) {
          die.classList.add("fumble");
          particles.burst(at.x, at.y, { count: 30, speed: 3.5, colors: ["#ff5c5c", "#7a1d1d"], gravity: 0.25 });
          screen.shake(5);
        } else if (r.success) {
          particles.burst(at.x, at.y, { count: 14, speed: 3, colors: ["#66db6a", "#c8ffc9"], life: 0.7 });
        }
        await sleep(450);
        for (const b of r.blows) await this.blow(box, b);
        return;
      }
      case "dice": {
        if (quiet) return;
        if (!r.sides || r.sides.length !== r.rolls.length || !r.rolls.length) {
          box.append(chip("quiet", "⚂", `${r.expr} → ${r.rolls.join(" + ")} = `, h("b", null, String(r.total)), r.why ? h("span", { class: "why" }, r.why) : null));
          return sleep(250);
        }
        // every die in its shape: they tumble, land one after another, a
        // top face glowing, and the sum counts up
        const sides = r.sides;
        const dice = r.rolls.map((face, i) => {
          const d = h("span", { class: `die pip d${sides[i]} rolling`, title: `d${sides[i]}` });
          d.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${shapeOf(sides[i])}"/></svg>`;
          const b = h("b", null, "?");
          d.append(b);
          return { d, b, face, n: sides[i] };
        });
        const flat = r.total - r.rolls.reduce((a, b) => a + b, 0);
        const total = h("b", { class: "dtotal" }, "…");
        box.append(chip("quiet dice", "⚂", h("span", { class: "pips" }, ...dice.map((x) => x.d)),
          flat ? h("span", { class: "flat" }, `${flat > 0 ? "+" : "−"}${Math.abs(flat)}`) : null, h("span", { class: "eq" }, "="), total,
          h("span", { class: "why" }, [r.why, r.expr].filter(Boolean).join(" · "))));
        const still = screen.mode === "off";
        if (!still) {
          for (let t = 0; t < 7; t++) {
            for (const x of dice) x.b.textContent = String(1 + Math.floor(Math.random() * x.n));
            await sleep(45 + t * 8);
          }
        }
        for (const x of dice) {
          x.b.textContent = String(x.face);
          x.d.classList.remove("rolling");
          x.d.classList.add("land");
          if (x.face === x.n && x.n > 1) x.d.classList.add("max");
          else if (x.face === 1) x.d.classList.add("low");
          if (!still) await sleep(Math.min(80, 640 / dice.length));
        }
        total.textContent = String(r.total);
        if (!still) total.animate([{ transform: "scale(1.5)", filter: "brightness(1.8)" }, { transform: "none", filter: "none" }], { duration: 300, easing: "cubic-bezier(.2,.9,.3,1.3)" });
        if (!still && dice.some((x) => x.d.classList.contains("max"))) {
          const at = centre(dice.find((x) => x.d.classList.contains("max"))!.d);
          particles.burst(at.x, at.y, { count: 10, speed: 2.2, shape: "star", size: 1.2, colors: ["#ffd77a", "#fff3a6"], life: 0.6 });
        }
        return sleep(250);
      }
      case "hurt": {
        const healed = r.amount < 0;
        if (r.you) {
          box.append(chip(healed ? "good" : "bad", "♥", h("span", { class: "v" }, `${healed ? "+" : "−"}${Math.abs(r.amount)}`), ` ${r.hp}`, r.down ? h("b", { class: "v" }, ", down") : null));
          this.hooks.hp(r.hp, healed ? "heal" : "hurt");
          if (!healed) {
            screen.shake(Math.min(14, 4 + Math.abs(r.amount)));
            screen.wash("hurt");
          } else screen.wash("heal");
        } else if (!quiet) {
          box.append(chip("quiet", "⚔", `${r.who} ${healed ? "+" : "−"}${Math.abs(r.amount)} → ${r.hp}`, r.down ? h("b", null, ", down") : null));
          if (!healed) screen.slash();
        }
        if (r.turnsOnYou) {
          box.append(chip("bad", "⚠", h("span", { class: "v" }, `${r.who} turns on you`)));
          screen.shake(4);
        }
        return sleep(300);
      }
      case "coins": {
        const el = chip("gold", "◎", h("span", { class: "v" }, `${r.delta > 0 ? "+" : "−"}${Math.abs(r.delta)} coins`), h("span", { class: "why" }, `${r.delta > 0 ? "from" : "to"} ${r.party}${r.towardDebts ? " (toward what you owe)" : ""}`));
        box.append(el);
        const purse = this.hooks.purse();
        if (purse) {
          const a = centre(el.querySelector(".icon")!);
          const b = centre(purse);
          r.delta > 0 ? particles.flyTo(a, b, Math.min(18, 4 + r.delta)) : particles.flyTo(b, a, Math.min(14, 3 + -r.delta));
        }
        this.hooks.coins(r.delta);
        return sleep(350);
      }
      case "item":
        box.append(r.gained ? chip("thing", "✚", h("span", { class: "v" }, r.name), h("span", { class: "why" }, `from ${r.party}`))
                            : chip("quiet", "✖", `${r.name} → ${r.party}`));
        return sleep(250);
      case "xp": {
        const el = chip("xp", "✦", h("span", { class: "v" }, `+${r.gained} xp`), r.why ? h("span", { class: "why" }, r.why) : null);
        box.append(el);
        const at = centre(el.querySelector(".icon")!);
        particles.burst(at.x, at.y, { count: 16, speed: 2.5, colors: ["#fff3a6"], shape: "star", size: 2, life: 0.9 });
        if (r.level) {
          await sleep(300);
          screen.banner(`LEVEL ${r.level}`, "you grow stronger", "level");
          particles.burst(window.innerWidth / 2, window.innerHeight / 2, { count: 160, speed: 11, shape: "star", colors: ["#fff3a6", "#ffd77a", "#ffffff", "#8ad6ff"], gravity: 0.08, life: 1.8 });
          await sleep(900);
        }
        return sleep(250);
      }
      case "power":
        box.append(chip("power", "✧", h("span", { class: "v" }, r.learned ? `learned ${r.name}` : r.name), r.usesLeft != null ? h("span", { class: "why" }, `${r.usesLeft} left`) : null));
        return sleep(250);
      case "round": {
        // a new round: its number struck in, the order rolled beside it
        if (quiet) return;
        const n = h("b", { class: "v" }, `round ${r.round}`);
        box.append(chip("round", "⚔", n, h("span", { class: "why" }, r.order.replace(/ \(person:\d+\)/g, ""))));
        if (screen.mode !== "off") n.animate([{ transform: "scale(1.4)", letterSpacing: "0.3em", opacity: 0 }, { transform: "none", letterSpacing: "0.04em", opacity: 1 }], { duration: 320, easing: "cubic-bezier(.2,.9,.3,1.2)" });
        return sleep(300);
      }
      case "blows":
        // the foes who were up strike before the turn taken
        for (const b of r.blows) await this.blow(box, b);
        return;
      case "raised": {
        // a score grown: the old number gives way to the new, its modifier stamped
        const mod = modOf(r.now);
        const m = h("span", { class: modClass(mod) }, signed(mod));
        box.append(chip("raised", "▲", h("span", { class: "v" }, `${r.ability.slice(0, 3).toUpperCase()} ${r.was} → ${r.now}`), m));
        await stampMod(m, mod);
        return sleep(200);
      }
      case "travel": {
        // the way walked, drawn out: longer the longer the road
        const dot = h("i");
        dot.style.animationDuration = `${Math.min(5, Math.max(1.8, 1.8 + 0.8 * Math.log2(Math.max(1, r.minutes / 60))))}s`;
        box.append(chip("quiet travel", "➜", h("span", null, `${r.to} · ${duration(r.minutes)}${r.heading ? ` · ${r.heading}` : ""}`), h("span", { class: "road" }, dot)));
        return sleep(450);
      }
      case "waylaid":
        box.append(chip("warn", "⚠", "stopped on the road"));
        screen.shake(5);
        return sleep(300);
      case "born":
        screen.banner(r.name, r.cls ? `a ${r.cls}` : "", "born");
        box.append(chip("gold", "★", h("span", { class: "v" }, `${r.name}${r.cls ? `, ${r.cls}` : ""}`)));
        return sleep(600);
      case "turnedBack": {
        // A death, and the world turned back to before it: a life spent.
        if (quiet) return;
        box.append(chip("gold turned", "↺", h("span", { class: "v" }, "the world turns back"),
          h("span", { class: "why" }, ` · ${r.left} ${r.left === 1 ? "life" : "lives"} left`)));
        screen.banner("THE WORLD TURNS BACK", r.left === 1 ? "one life left · the next death is the last" : `${r.left} lives left`, "turned");
        return sleep(1800);
      }
      case "died": {
        if (quiet) return;
        box.append(chip("bad", "☠", h("span", { class: "v" }, `${r.name || "you"}: the last life spent`)));
        screen.shake(6);
        screen.banner("DEAD", "the last life is spent", "dead");
        return sleep(2000);
      }
      case "deal": {
        // A deal struck: its seal goes to the deals.
        const el = chip("deal", "✒", h("span", { class: "v" }, r.terms));
        box.append(el);
        this.hooks.toTab("deals", el.querySelector(".icon"), "❂", "var(--gold)");
        return sleep(450);
      }
      case "abilities": {
        // The six dice of a life: each tumbles and lands (only the one
        // rerolled, on a reroll).
        const row = h("div", { class: "births" });
        const faces: [HTMLElement, number, HTMLElement][] = [];
        for (const a of r.scores) {
          const again = r.rerolled === a.name;
          const face = h("b", null, r.rerolled && !again ? String(a.score) : "?");
          const m = h("span", { class: modClass(modOf(a.score)) }, r.rerolled && !again ? signed(modOf(a.score)) : "");
          row.append(h("div", { class: `birth${again ? " again" : ""}` }, h("span", { class: "k" }, a.name.slice(0, 3).toUpperCase()), face, m,
            again && r.was != null ? h("span", { class: "was" }, `was ${r.was}`) : null));
          if (!r.rerolled || again) faces.push([face, a.score, m]);
        }
        box.append(h("div", { class: "chip quiet" }, h("span", { class: "icon" }, "⚂"), row));
        for (let t = 0; t < 10; t++) {
          for (const [face] of faces) face.textContent = String(2 + Math.floor(Math.random() * 19));
          await sleep(60 + t * 8);
        }
        for (const [face, score, m] of faces) {
          face.textContent = String(score);
          face.parentElement!.classList.add("landed");
          m.textContent = signed(modOf(score));
          void stampMod(m, modOf(score));
          const at = centre(face);
          if (score >= 16) particles.burst(at.x, at.y, { count: 18, speed: 3, shape: "star", size: 2, colors: ["#ffd77a", "#fff3a6"] });
          await sleep(120);
        }
        return sleep(300);
      }
    }
  }

  // What the play behind the roll earned or cost hits the sum like a blow
  // landing: the pill stamps in, flashes, throws a ring and sparks, and the
  // total counts to it on a quickening beat and locks with a pop. The more
  // it earned, the harder it hits; a cost drops in heavy and ticks down;
  // anyone else's is the same, cooler and smaller. When it decided the roll,
  // the verdict is stamped too. Quiet in calm, still when the window is.
  private async edge(slot: HTMLElement, total: HTMLElement, r: Extract<Receipt, { kind: "check" }>, verdict: HTMLElement): Promise<void> {
    const edge = r.edge!;
    const mine = r.who == null;
    const up = edge > 0;
    const look = `${edge === 0 ? "even" : up ? `e${edge}` : `down n${-edge}`}${mine ? "" : " theirs"}${r.turned ? " turned" : ""}`;
    const pill = h("span", { class: `play ${look}`, title: mine ? "for the play itself" : `for ${r.who}'s play` },
      edge === 0 ? "±0" : `${up ? "+" : "−"}${Math.abs(edge)}`, mine ? h("i", null, PLAY[edge]) : null);
    const tone = !mine ? "#62d9d9" : edge === 0 ? "#8e887a" : !up ? "#ff6b5c" : edge >= 4 ? "#fff3a6" : "#ffd77a";
    total.style.setProperty("--glow", tone);
    slot.append(pill, " ");
    const { particles, screen } = this.hooks;
    const still = screen.mode === "off", calm = screen.mode === "calm";
    if (still) {
      total.textContent = String(r.total);
      return;
    }
    const force = mine ? Math.abs(edge) : Math.abs(edge) * 0.5;
    // the stamp: big and blurred to just under its size, and home
    await settled(pill.animate(up || edge === 0
      ? [{ transform: `scale(${1.5 + force * 0.25})`, opacity: 0, filter: "blur(3px)" },
         { transform: "scale(0.88)", opacity: 1, filter: "blur(0)", offset: 0.55 }, { transform: "scale(1)", opacity: 1 }]
      : [{ transform: "translateY(-0.9em) rotate(-5deg) scale(1.25)", opacity: 0 },
         { transform: "translateY(0.12em) rotate(1.5deg) scale(0.94)", opacity: 1, offset: 0.6 }, { transform: "none", opacity: 1 }],
      { duration: edge === 0 ? 220 : 260, easing: "cubic-bezier(.2,.9,.3,1.15)" }));
    if (edge === 0) return;
    // the impact: a flash across it, a ring off it, sparks
    flash(pill);
    const at = centre(pill);
    ring(at, pill, tone, 1.9 + force * 0.25);
    if (!calm) particles.burst(at.x, at.y, { count: Math.round(4 + force * force * 2.2), speed: 1.4 + force * 0.6,
      colors: up ? [tone, "#ffffff", "#ffd77a"] : [tone, "#7a2a1d"], shape: up && mine ? "star" : "spark",
      size: 1 + force * 0.12, life: 0.5 + force * 0.06, gravity: up ? 0.05 : 0.2 });
    // the count: a quickening beat, each tick jumping, the last locking in
    const step = up ? 1 : -1;
    const ticks = Math.abs(edge);
    const rest = getComputedStyle(total).color;
    for (let i = 0, n = r.total - edge + step; up ? n <= r.total : n >= r.total; n += step, i++) {
      total.textContent = String(n);
      const last = i === ticks - 1;
      total.animate(up
        ? [{ transform: `translateY(-0.45em) scale(${last ? 1.7 : 1.3})`, textShadow: `0 0 14px ${tone}`, color: tone },
           { transform: "none", textShadow: "0 0 0 transparent", color: rest }]
        : [{ transform: "translateY(0.3em) scale(0.8)", color: tone }, { transform: "none", color: rest }],
        { duration: last ? 360 : 200, easing: "cubic-bezier(.2,.9,.3,1.3)" });
      await sleep(Math.max(55, 150 - i * 32));
    }
    const lock = centre(total);
    if (mine && Math.abs(edge) >= 2) ring(lock, total, tone, 2.6 + force * 0.3);
    if (mine && up && !calm && (edge >= 3 || r.turned)) {
      particles.burst(lock.x, lock.y, { count: 8 + edge * 4, speed: 2 + edge * 0.5, colors: [tone, "#ffffff"], shape: "star", size: 1.1, life: 0.55 });
    }
    if (mine && !calm && (edge >= 4 || r.turned)) screen.shake(up ? 3 : 4);
    if (r.turned) {
      pill.classList.add("hit");
      ring(at, pill, mine ? (up ? "#fff3a6" : "#ff5c5c") : "#62d9d9", 3);
      // the verdict it decided, stamped
      verdict.classList.add("shown");
      verdict.animate([{ transform: "scale(1.9)", opacity: 0, filter: "blur(2px)" }, { transform: "scale(0.92)", opacity: 1, filter: "blur(0)", offset: 0.6 },
                       { transform: "scale(1)", opacity: 1 }], { duration: 300, easing: "cubic-bezier(.2,.9,.3,1.2)" });
      if (!up && mine && !calm) particles.burst(lock.x, lock.y, { count: 12, speed: 1.3, colors: ["#ff8a6a", "#7a2a1d", "#3a1410"], gravity: 0.25, size: 1.1, life: 0.8 });
    }
    await sleep(r.turned ? 300 : 140);
  }

  private async blow(box: HTMLElement, b: { text: string; hit: boolean }): Promise<void> {
    box.append(h("div", { class: `chip blow ${b.hit ? "hit" : "miss"}` }, h("span", { class: "icon" }, "⚔"), h("span", null, b.text)));
    if (b.hit) {
      this.hooks.screen.slash();
      this.hooks.screen.shake(9);
      this.hooks.screen.wash("hurt");
      const m = b.text.match(/you are at (\d+\/\d+)/);
      if (m) this.hooks.hp(m[1], "hurt");
    }
    await sleep(500);
  }
}

// A white flash across `el`, gone in a blink.
// How good a d20's face is, in the modifiers' colours: red for the low,
// grey for the middling, blue and gold for the high.
export function faceTone(n: number): string {
  if (n <= 1) return "var(--bad)";
  if (n <= 4) return "var(--mod-n3)";
  if (n <= 7) return "var(--mod-n1)";
  if (n <= 12) return "var(--mod-0)";
  if (n <= 15) return "var(--mod-p2)";
  if (n <= 18) return "var(--mod-p3)";
  return n >= 20 ? "var(--gold)" : "var(--mod-p4)";
}

// A d20 thrown: it tumbles fast, slows face by face as it nears the one it
// keeps, swelling a little, and teeters on the last few before it shows.
async function spin(die: HTMLElement, face: HTMLElement, keep: number, ms: number): Promise<void> {
  const turn = die.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }], { duration: 260, iterations: Infinity });
  let t = 0;
  let step = 40;
  let last = 0;
  while (t < ms) {
    let n = last;
    while (n === last) n = 1 + Math.floor(Math.random() * 20);
    last = n;
    face.textContent = String(n);
    const k = t / ms;
    turn.updatePlaybackRate(Math.max(0.12, 1 - k * 0.95));
    die.style.scale = String(1 + k * 0.18);
    await sleep(step);
    t += step;
    step = Math.round(step * 1.16);
  }
  turn.cancel();
  die.style.scale = "";
  face.textContent = String(keep);
}

// The face kept: the die slams down and flashes in the colour of how good
// it is, a ring going out from it.
function land(die: HTMLElement, n: number, moving: boolean): void {
  const tone = faceTone(n);
  die.style.setProperty("--tone", tone);
  die.classList.add("toned");
  if (!moving) return;
  const glow = getComputedStyle(die).color;
  die.animate([
    { transform: "scale(1.75)", filter: `brightness(2.4) drop-shadow(0 0 16px ${glow})` },
    { transform: "scale(0.94)", filter: `brightness(1.3) drop-shadow(0 0 8px ${glow})`, offset: 0.55 },
    { transform: "scale(1)", filter: "none" },
  ], { duration: 460, easing: "cubic-bezier(.2,.9,.3,1.25)" });
  ring(centre(die), die, glow, n >= 16 || n <= 4 ? 3 : 2.2);
}

function flash(el: HTMLElement): void {
  const f = h("span", { class: "play-flash" });
  el.append(f);
  f.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 180, easing: "ease-out" }).finished.then(() => f.remove(), () => f.remove());
}

// A ring of `color` thrown off `el` from `at`, spreading to `reach` times its size.
function ring(at: { x: number; y: number }, el: HTMLElement, color: string, reach: number): void {
  const r = el.getBoundingClientRect();
  const o = h("div", { class: "play-ring" });
  Object.assign(o.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${r.width}px`, height: `${r.height}px`, borderColor: color, boxShadow: `0 0 12px ${color}` });
  document.body.append(o);
  o.animate([{ transform: "translate(-50%, -50%) scale(0.9)", opacity: 1, borderWidth: "3px" },
             { transform: `translate(-50%, -50%) scale(${reach * 0.45})`, opacity: 0.8, offset: 0.25 },
             { transform: `translate(-50%, -50%) scale(${reach})`, opacity: 0, borderWidth: "1px" }],
    { duration: 480, easing: "cubic-bezier(.1,.7,.3,1)" }).finished.then(() => o.remove(), () => o.remove());
}

function chip(kind: string, icon: string, ...rest: (Node | string | null)[]): HTMLElement {
  return h("div", { class: `chip ${kind}` }, h("span", { class: "icon" }, icon), ...rest);
}

function centre(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function duration(minutes: number): string {
  if (minutes < 90) return `${minutes} minutes`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} hours`;
  return `${(minutes / 1440).toFixed(1).replace(/\.0$/, "")} days`;
}
