import type { Bridge, Choice, LaunchMenu } from "../core/bridge.ts";
import type { OwnWish, OwnWorlds, RunEntry, WorldCard } from "../core/protocol.ts";
import { h, settled } from "./dom.ts";
import type { Screen } from "./fx/screen.ts";

// The launch menu, over the sky: Play, as a guest; or, signed in, the
// account's runs and a new one, in one of today's worlds (a story world or
// a classic one, chosen by its card) or one of their own. A supporter asks
// for a world of their own here too: a few sentences of its beginning, its
// callings and peoples, its size, any of it left blank; it is made on the
// server in the background, and the menu looks again every half minute
// while it is. Nothing of it shows to anyone else. Anyone else who asks is
// told it is for supporters (signed in first), with the site's page of
// what supporters get; the server is asked afresh each time, so a
// membership begun meanwhile counts at once. Signing in sits small in
// the corner: it opens the site in the browser, and the menu fills in once
// the player has said yes there. Resolves with what the player chose to play.

const SIZES: { id: OwnWish["size"]; name: string; towns: number }[] = [
  { id: "small", name: "Small", towns: 8 }, { id: "medium", name: "Medium", towns: 15 }, { id: "large", name: "Large", towns: 30 },
];
const MOST = { callings: 4, peoples: 3 };
const LOOK_AGAIN = 30_000;

export interface MenuHooks {
  bridge: Bridge;
  screen: Screen;
}

export function showMenu(host: HTMLElement, first: Extract<LaunchMenu, { ok: true }>, hooks: MenuHooks): Promise<Choice> {
  const { bridge } = hooks;
  return new Promise((chosen) => {
    let menu = first;
    let waiting = false; // a sign-in open in the browser
    let note = "";
    let worlds: WorldCard[] | null = null; // today's worlds, while a new run's is being chosen
    let forming = false; // a world of one's own being asked for
    let wish = blankWish();
    let looking: ReturnType<typeof setInterval> | null = null; // while a world of theirs is being made
    let aside: "guest" | "supporters" | null = null; // a world of one's own asked for by someone it isn't for

    const choose = async (choice: Choice) => {
      if (looking) clearInterval(looking);
      for (const b of host.querySelectorAll<HTMLButtonElement>("button")) b.disabled = true;
      if (waiting) await bridge.cancelSignIn();
      await close(host, hooks.screen);
      chosen(choice);
    };

    const signIn = async () => {
      waiting = true;
      note = "";
      aside = null;
      draw();
      const out = await bridge.signIn();
      waiting = false;
      if ("error" in out && out.error !== "cancelled") note = out.error;
      const again = await bridge.menu();
      if (again.ok) menu = again;
      else note = again.error;
      draw();
    };

    const signOut = async () => {
      aside = null;
      await bridge.signOut();
      const again = await bridge.menu();
      if (again.ok) menu = again;
      draw();
    };

    const corner = (): HTMLElement => {
      if (waiting) {
        const cancel = h("button", { type: "button", class: "quiet" }, "cancel");
        cancel.addEventListener("click", () => void bridge.cancelSignIn());
        return h("div", { class: "corner" }, h("span", { class: "waiting" }, "Say yes in your browser, then come back here"), cancel);
      }
      if (menu.signedIn) {
        const out = h("button", { type: "button", class: "quiet" }, "sign out");
        out.addEventListener("click", () => void signOut());
        return h("div", { class: "corner" }, h("span", null, "Signed in"), out);
      }
      const into = h("button", { type: "button", class: "quiet" }, "Sign in");
      into.addEventListener("click", () => void signIn());
      return h("div", { class: "corner" }, into);
    };

    const pickWorld = async () => {
      const out = await bridge.worlds();
      if ("error" in out) note = out.error;
      else if (out.length === 1) return choose({ kind: "new", world: out[0].id });
      else worlds = out;
      draw();
    };

    // A world of one's own: the form for a supporter, as the server says
    // now; for anyone else, who it is for.
    const ownWorld = async (button: HTMLButtonElement) => {
      note = "";
      if (!menu.signedIn) {
        aside = "guest";
        return draw();
      }
      button.disabled = true;
      const again = await bridge.menu();
      if (again.ok) menu = again;
      else note = again.error;
      if (menu.signedIn && menu.own) {
        aside = null;
        forming = !menu.own.making && menu.own.left > 0;
      } else if (again.ok) aside = menu.signedIn ? "supporters" : "guest";
      draw();
    };

    const toSupporters = async () => {
      const out = await bridge.supporters();
      if ("error" in out) {
        note = out.error;
        draw();
      }
    };

    // Who a world of one's own is for, said to someone it isn't.
    const asideView = (): HTMLElement | null => {
      if (aside === "guest") return h("p", { class: "note own" }, "Worlds of your own are for supporters, who sign in first: Sign in is in the corner.");
      if (aside !== "supporters") return null;
      const more = h("button", { type: "button", class: "quiet" }, "What supporters get");
      more.addEventListener("click", () => void toSupporters());
      return h("div", { class: "row centre" }, h("p", { class: "note own" }, "Worlds of your own are for supporters. Once you are one, ask here again."), more);
    };

    const askWorld = async (button: HTMLButtonElement) => {
      button.disabled = true;
      const out = await bridge.askWorld(cleaned(wish));
      if ("error" in out) note = out.error;
      else if (menu.signedIn) {
        menu = { ...menu, own: out.own };
        forming = false;
        wish = blankWish();
        note = "";
      }
      draw();
    };

    const body = (): HTMLElement => {
      if (forming && menu.signedIn && menu.own) return form(menu.own);
      if (worlds) {
        const back = h("button", { type: "button", class: "quiet" }, "back");
        back.addEventListener("click", () => { worlds = null; draw(); });
        return h("div", { class: "creation launch" }, h("div", { class: "head" }, h("div", { class: "title" }, "Pen and Paper"), h("div", { class: "rule" })),
          h("section", null, h("h3", null, "A new run in"), h("div", { class: "ways" }, ...worlds.map((c) => {
            const b = worldCard(c);
            b.addEventListener("click", () => void choose({ kind: "new", world: c.id }));
            return b;
          }))),
          h("div", { class: "row end" }, back));
      }
      if (!menu.signedIn) {
        const play = h("button", { type: "button", class: "primary go" }, "Play");
        play.addEventListener("click", () => void choose({ kind: "guest" }));
        const own = h("button", { type: "button", class: "quiet" }, "A world of your own") as HTMLButtonElement;
        own.addEventListener("click", () => void ownWorld(own));
        return h("div", { class: "creation launch" }, h("div", { class: "head" }, h("div", { class: "title" }, "Pen and Paper"), h("div", { class: "rule" })), h("div", { class: "row centre" }, play),
          h("p", { class: "note" }, "As a guest, with nothing to sign up for. A guest's run is kept a day after its last turn; sign in to keep it for good. For players 18 and over."),
          h("div", { class: "row centre" }, own), asideView());
      }
      const runs = menu.runs.map((r) => {
        const b = h("button", { type: "button", class: "way" }, h("span", { class: "fname" }, who(r)), h("span", { class: "fwhat" }, when(r)));
        b.addEventListener("click", () => void choose({ kind: "run", run: r.run }));
        // Forgetting asks once more: the run and its save go for good.
        const gone = h("button", { type: "button", class: "quiet forget", title: "forget this run for good" }, "forget") as HTMLButtonElement;
        let sure = false;
        gone.addEventListener("click", async () => {
          if (!sure) {
            sure = true;
            gone.textContent = "forget it for good?";
            return;
          }
          gone.disabled = true;
          const out = await bridge.forgetRun(r.run);
          const again = await bridge.menu();
          if (again.ok) menu = again;
          note = "error" in out ? out.error : "";
          draw();
        });
        return h("div", { class: "run-row" }, b, gone);
      });
      const fresh = menu.runs.length < menu.most ? h("button", { type: "button", class: runs.length ? "" : "primary go" }, "A new run") : null;
      fresh?.addEventListener("click", () => void pickWorld());
      const own = !menu.own || (!menu.own.making && menu.own.left > 0) ? h("button", { type: "button", class: "quiet" }, "A world of your own") as HTMLButtonElement : null;
      own?.addEventListener("click", () => void ownWorld(own));
      return h("div", { class: "creation launch" }, h("div", { class: "head" }, h("div", { class: "title" }, "Pen and Paper"), h("div", { class: "rule" })),
        runs.length ? h("section", null, h("h3", null, "Your runs"), h("div", { class: "ways" }, ...runs)) : null,
        fresh || own ? h("div", { class: `row ${runs.length ? "end" : "centre"}` }, own, fresh) : null,
        fresh ? null : h("p", { class: "note" }, `An account keeps ${menu.most} runs, and yours has that many.`),
        menu.own ? ownNote(menu.own) : asideView());
    };

    // Asking for a world of one's own: what to write, what becomes of it.
    const form = (own: OwnWorlds): HTMLElement => {
      const premise = h("textarea", { class: "premise", maxlength: "600", rows: "5", spellcheck: "true",
        placeholder: "A few sentences: what was there before anything, what made the world and how, what magic is, where it's going." }) as HTMLTextAreaElement;
      premise.value = wish.premise;
      const left = h("span", { class: "count" }, `${600 - wish.premise.length}`);
      premise.addEventListener("input", () => { wish.premise = premise.value; left.textContent = `${600 - premise.value.length}`; });
      const sizes = SIZES.map((s) => {
        const b = h("button", { type: "button", class: wish.size === s.id ? "on" : "" }, h("span", null, s.name), h("span", { class: "fwhat" }, `${s.towns} towns`));
        b.addEventListener("click", () => { wish.size = s.id; draw(); });
        return b;
      });
      const back = h("button", { type: "button", class: "quiet" }, "back");
      back.addEventListener("click", () => { forming = false; note = ""; draw(); });
      const make = h("button", { type: "button", class: "primary" }, "Make it") as HTMLButtonElement;
      make.addEventListener("click", () => void askWorld(make));
      return h("div", { class: "creation launch own-form" }, h("div", { class: "head" }, h("div", { class: "title" }, "A world of your own"), h("div", { class: "rule" })),
        h("div", { class: "warn" },
          h("p", null, "You're writing the beginning of a fantasy world: its powers, how it was made, where its peoples came from. It isn't a setting from another genre, and it isn't instructions for the game master."),
          h("p", null, "Once it's made, it stays as it was made: nothing in it can be changed afterwards. And the making takes liberties with what you write, to turn it into a world that works.")),
        h("section", null, h("h3", null, "Its beginning"), premise, left),
        named("callings", "Callings", "a calling's name", "who they are, in a line"),
        named("peoples", "Peoples besides humans", "a people's name", "how they look and live, in a line"),
        h("section", null, h("h3", null, "Its size"), h("div", { class: "sizes" }, ...sizes)),
        h("p", { class: "note" }, `Anything left blank is made for you. It takes some minutes, and it will be under A new run once it's done. ${own.left === 1 ? "One more" : `${own.left} more`} this week.`),
        h("div", { class: "row end" }, back, make));
    };

    // The callings or peoples asked for, a name and a line each, a row more until there are enough.
    const named = (which: "callings" | "peoples", title: string, name: string, line: string): HTMLElement => {
      const rows = wish[which].map((r, i) => {
        const n = h("input", { type: "text", class: "wish-in", maxlength: "30", placeholder: name, spellcheck: "false" }) as HTMLInputElement;
        const l = h("input", { type: "text", class: "wish-in", maxlength: "160", placeholder: line }) as HTMLInputElement;
        n.value = r.name;
        l.value = r.line;
        n.addEventListener("input", () => { r.name = n.value; });
        l.addEventListener("input", () => { r.line = l.value; });
        const drop = h("button", { type: "button", class: "quiet", title: "leave this one out" }, "×");
        drop.addEventListener("click", () => { wish[which].splice(i, 1); if (!wish[which].length) wish[which].push({ name: "", line: "" }); draw(); });
        return h("div", { class: "wish-row" }, n, l, drop);
      });
      const more = wish[which].length < MOST[which] ? h("button", { type: "button", class: "quiet" }, which === "callings" ? "another calling" : "another people") : null;
      more?.addEventListener("click", () => {
        wish[which].push({ name: "", line: "" });
        draw();
        [...host.querySelectorAll<HTMLElement>(`.wish-${which} .wish-row`)].pop()?.querySelector<HTMLInputElement>(".wish-in")?.focus();
      });
      return h("section", { class: `wish-${which}` }, h("h3", null, title), ...rows, more ? h("div", { class: "row" }, more) : null);
    };

    // While a world of theirs is being made, the menu looks again now and then.
    const watch = () => {
      const making = menu.signedIn && !!menu.own?.making;
      if (making && !looking) {
        looking = setInterval(async () => {
          if (forming || worlds) return;
          const again = await bridge.menu();
          if (again.ok && !forming && !worlds) { menu = again; draw(); }
        }, LOOK_AGAIN);
      } else if (!making && looking) {
        clearInterval(looking);
        looking = null;
      }
    };

    const draw = () => {
      host.replaceChildren(corner(), body(), note ? h("p", { class: "err" }, note) : "");
      watch();
    };

    draw();
    document.body.classList.add("at-menu");
    host.hidden = false;
    if (hooks.screen.mode !== "off") host.querySelector(".launch")?.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "ease-out" });
  });
}

// One of today's worlds or the player's own, as a card to begin a run in:
// its kind, its size, towns and realms, the opening of its creation story,
// its callings.
function worldCard(c: WorldCard): HTMLButtonElement {
  const made = c.kind === "own" ? `made ${day(c.made_at)}` : null;
  const facts = [c.size?.replace("_", " "), c.towns != null ? `${c.towns} towns` : null, c.realms?.length ? c.realms.join(", ") : null, made].filter(Boolean).join(" · ");
  const name = { story: "Today's world", classic: "Today's classic", own: "Your world" }[c.kind];
  return h("button", { type: "button", class: "way world" },
    h("span", { class: "fname" }, name),
    facts ? h("span", { class: "fwhat" }, facts) : null,
    h("span", { class: "fstory" }, c.kind === "classic" ? "The hand-made callings, and no creation story." : (c.opening ?? "A world with its own creation story and callings.")),
    c.callings?.length ? h("span", { class: "fwhat" }, `Callings: ${c.callings.join(", ")}`) : null);
}

// How a supporter's own worlds stand, in a line under the runs.
function ownNote(own: OwnWorlds): HTMLElement | null {
  const say = (text: string) => h("p", { class: "note own" }, text);
  if (own.making?.state === "waiting") return say("Your world is waiting its turn to be made. It will be under A new run once it's done.");
  if (own.making) return say("Your world is being made: it takes some minutes, and it will be under A new run once it's done.");
  if (own.last?.state === "made") return say(`Your world was made ${ago(own.last.at)}: it's under A new run.`);
  if (own.last?.state === "failed") return say("Your last world couldn't be made. It doesn't count toward this week's three; ask again whenever you like.");
  if (own.left === 0 && own.next_at) return say(`Three worlds a week: the next can be asked for on ${day(own.next_at)}.`);
  return null;
}

function blankWish(): OwnWish {
  return { premise: "", callings: [{ name: "", line: "" }], peoples: [{ name: "", line: "" }], size: "small" };
}

// What is sent of a wish: the rows with something in them.
function cleaned(w: OwnWish): OwnWish {
  const rows = (list: OwnWish["callings"]) => list.map((r) => ({ name: r.name.trim(), line: r.line.trim() })).filter((r) => r.name || r.line);
  return { premise: w.premise.trim(), callings: rows(w.callings), peoples: rows(w.peoples), size: w.size };
}

function day(at: number): string {
  return new Date(at * 1000).toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

// Who is playing a run: the character, or nobody yet.
function who(r: RunEntry): string {
  const c = r.character;
  if (!c) return "No one yet";
  return [c.name, c.calling, `level ${c.level}`].filter(Boolean).join(" · ");
}

function when(r: RunEntry): string {
  const begun = day(r.created_at);
  return r.used_at ? `begun ${begun} · last played ${ago(r.used_at)}` : `begun ${begun}`;
}

function ago(at: number): string {
  const s = Math.max(0, Date.now() / 1000 - at);
  if (s < 90) return "just now";
  if (s < 90 * 60) return `${Math.round(s / 60)} minutes ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} hours ago`;
  return `${Math.round(s / 86400)} days ago`;
}

async function close(host: HTMLElement, screen: Screen): Promise<void> {
  const box = host.querySelector<HTMLElement>(".launch");
  if (box && screen.mode !== "off") {
    await settled(host.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300, easing: "ease-in", fill: "forwards" }));
  }
  host.hidden = true;
  host.replaceChildren();
  host.getAnimations().forEach((a) => a.cancel());
  document.body.classList.remove("at-menu");
}
