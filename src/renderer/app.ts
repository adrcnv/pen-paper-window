import type { Bridge, Choice, Fx, Settings } from "../core/bridge.ts";
import type { Board, GameEvent } from "../core/protocol.ts";
import { $, h, sleep } from "./dom.ts";
import { Sky, skyFor } from "./fx/sky.ts";
import { Particles } from "./fx/particles.ts";
import { Screen } from "./fx/screen.ts";
import { ink, settle, Typewriter } from "./story.ts";
import { Receipts } from "./receipts.ts";
import { clockAt, Panels } from "./panels.ts";
import { Flair } from "./flair.ts";
import { makeCharacter } from "./creation.ts";
import { chooseLevel } from "./levelup.ts";
import { showRunOver } from "./runover.ts";
import { askToKeep } from "./keeprun.ts";
import { showMenu } from "./menu.ts";
import { showNews } from "./news.ts";

// The page: the story on the left, the world beside it, the sky behind.
// It speaks to the shell only through `window.harness` (core/bridge.ts).

declare global {
  interface Window { harness: Bridge }
}

const bridge = window.harness;
const story = $("#story");
const input = $<HTMLTextAreaElement>("#input");
const activity = $("#activity");

const sky = new Sky($<HTMLCanvasElement>("#sky"));
const particles = new Particles($<HTMLCanvasElement>("#particles"));
const screen = new Screen();
const typewriter = new Typewriter();
const panels = new Panels(() => bridge.map(), () => bridge.atlas(), () => bridge.lore(), { get: () => bridge.dm(), set: (m, e) => bridge.setDm(m, e) });
panels.onSettings = (patch) => change(patch);
panels.onMenu = () => void bridge.toMenu();
const flair = new Flair(particles);
const receipts = new Receipts({
  particles, screen,
  toTab: (tab, from, glyph, color) => flair.toTab(tab, from, glyph, color),
  hp: (hp) => panels.setHp(hp),
  coins: (d) => panels.addCoins(d),
  purse: () => panels.purse(),
});

let settings: Settings = { speed: "normal", fx: "full", receipts: true };
let pending: HTMLElement | null = null; // the turn being played: what was said, then receipts as they come
let busy = false;
let telling = false;
let told: Promise<void> = Promise.resolve(); // the last turn, until it is inked
let inFight = false;

// The sky over where the player stands: out in the weather at a town's
// streets or in the wilds, under a roof anywhere inside one; red while a
// fight is on.
function skyOf(board: Board): ReturnType<typeof skyFor> {
  const s = board.status;
  const m = s?.minute_of_day ?? 720;
  document.body.classList.toggle("daytime", m >= 7 * 60 && m < 19 * 60);
  return skyFor(m, s?.sky, (s?.where?.length ?? 1) <= 1, !!s?.fight, s?.setting);
}

// Come somewhere new: its name, and the town it is in.
// The name of a new place shows before its story is told. On the road it is
// named by where it runs between, and quietly. Returns how long to wait.
function arrived(before: Board | null, after: Board): number {
  const a = after.scene, b = before?.scene;
  if (!a?.place || (b && a.place === b.place && a.town === b.town)) return 0;
  if (a.road) {
    const title = a.road.spot ? a.place : a.road.water ? "the water" : "the road";
    return screen.place(title, `${a.road.spot ? "by the way between " : "between "}${a.road.between.join(" and ")}`, true) ? 350 : 0;
  }
  return screen.place(a.place, [a.town !== a.place ? a.town : null, a.open].filter(Boolean).join(" · ")) ? 650 : 0;
}

function paintSky(board: Board, instant = false): void {
  document.body.classList.toggle("backdrop", !!board.status?.setting);
  sky.setBackdrop(board.status?.setting ?? null, instant);
  sky.set(skyOf(board), instant);
}

// ── settings ───────────────────────────────────────────────────────────

function apply(s: Settings): void {
  settings = s;
  panels.settings = s;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fx: Fx = reduced && s.fx === "full" ? "calm" : s.fx;
  document.body.classList.remove("fx-full", "fx-calm", "fx-off");
  document.body.classList.add(`fx-${fx}`);
  sky.setMode(fx);
  screen.mode = fx;
  flair.mode = fx;
  particles.enabled = fx !== "off";
  typewriter.speed = fx === "off" ? "off" : s.speed;
  receipts.shown = s.receipts;
}

function change(patch: Partial<Settings>): void {
  apply({ ...settings, ...patch });
  bridge.saveSettings(settings);
}

// ── the story ──────────────────────────────────────────────────────────

function newTurn(said: string | null, note?: string): HTMLElement {
  const turn = h("article", { class: "turn" },
    note ? h("p", { class: "note" }, note) : null,
    said ? h("p", { class: "said" }, said) : null,
    h("div", { class: "receipts" }));
  story.append(turn);
  follow(true);
  return turn;
}

// Keep the newest words in view, unless the player has scrolled up to read.
let pinned = true;
story.addEventListener("scroll", () => {
  pinned = story.scrollHeight - story.scrollTop - story.clientHeight < 80;
});
function follow(force = false): void {
  if (pinned || force) story.scrollTop = story.scrollHeight;
}
typewriter.onProgress = () => follow();

async function tell(e: Extract<GameEvent, { type: "turn" }>): Promise<void> {
  const turn = pending ?? newTurn(e.resumed ? null : e.input || null, e.resumed ? "where you left off" : undefined);
  pending = null;
  await receipts.done();
  for (const old of story.querySelectorAll<HTMLElement>(".turn.now")) {
    old.classList.remove("now");
    const n = old.querySelector<HTMLElement>(".narration");
    if (n) settle(n, false);
  }
  const before = panels.board;
  panels.update(e.board);
  paintSky(e.board);
  if (!e.resumed) flair.turnEnded(before, e.board);
  const card = arrived(before, e.board);
  const fighting = !!e.board.status?.fight;
  if (fighting && !inFight) screen.fightBegins(() => particles.burst(window.innerWidth / 2, window.innerHeight / 2,
    { count: 70, colors: ["#fff3c4", "#ffb35c", "#ff6a3d", "#ffffff"], speed: 9, gravity: 0.18, spread: Math.PI * 2 }));
  else if (!fighting && inFight) screen.fightEnds();
  inFight = fighting;
  if (e.newDay) screen.banner(e.newDay.split(" · ")[0].toUpperCase(), e.newDay.split(" · ")[1] ?? "");
  if (card) await sleep(card);
  const inked = ink(e.paragraphs);
  turn.classList.add("now");
  turn.append(inked.root);
  telling = true;
  await typewriter.reveal(inked);
  telling = false;
  follow();
  setTimeout(() => settle(inked.root, true), 1800);
}

function fail(message: string): void {
  const turn = pending ?? newTurn(null);
  pending = null;
  turn.append(h("p", { class: "fail" }, message));
  follow();
}

bridge.onEvent((e) => {
  switch (e.type) {
    case "activity":
      activity.querySelector(".text")!.textContent = e.text;
      break;
    case "receipt":
      if (!pending) pending = newTurn(null);
      receipts.add(pending.querySelector<HTMLElement>(".receipts")!, e.receipt);
      break;
    case "turn":
      setBusy(false);
      // One at a time: a turn can arrive while the last is still inking
      // (the DM's opening in a new world).
      told = told.then(() => tell(e));
      break;
    case "create":
      // Nobody is in this world yet: the player makes their character here,
      // and the DM hears of it once it is made.
      setBusy(false);
      panels.update(e.board);
      paintSky(e.board, true);
      makeCharacter($("#creation"), {
        bridge, particles, screen,
        made: (tell, name, calling) => {
          screen.banner(name.toUpperCase(), `a ${calling}`, "born");
          setBusy(true);
          bridge.begin(tell);
        },
      });
      break;
    case "level":
      // A new level's choices wait: made here once the turn has been told.
      told = told.then(() => chooseLevel($("#creation"), {
        bridge, particles, screen,
        chosen: (board) => { if (board) panels.update(board); },
      }));
      break;
    case "runOver":
      // The last life spent: how to begin again, chosen here once the turn has been told.
      if (e.board.run_over) {
        const over = e.board.run_over;
        told = told.then(() => showRunOver($("#creation"), over, { bridge, screen }));
      }
      break;
    case "newWorld":
      // The DM starts afresh there; its opening follows, below the break.
      setBusy(true);
      pending = null; // words sent to the last world stay above the break, unanswered
      story.append(h("div", { class: "world-break" }, "✦ a new world ✦"));
      told.then(() => {
        screen.banner("A NEW WORLD", "the DM begins again");
        follow();
      });
      break;
    case "spent": {
      // No turns left: nothing went to the DM. A guest's run may be kept
      // for more, there and then.
      setBusy(false);
      panels.update(e.board);
      const t = e.board.status?.turns;
      const turn = pending ?? newTurn(null);
      pending = null;
      const note = h("p", { class: "spent" }, t?.until
        ? `No turns are left today: free play goes on at ${clockAt(t.until)}. Nothing was sent to the DM.`
        : "This guest's run has played its turns. Keep it on an account and it plays on with more; nothing was sent to the DM.");
      turn.append(note);
      if (!t?.until && e.board.guest?.keep) {
        const keep = h("button", { type: "button", class: "primary" }, "Keep this run");
        keep.addEventListener("click", async () => {
          keep.disabled = true;
          note.textContent = "Sign in in your browser and say yes there; the run is kept with it.";
          const out = await bridge.signIn();
          keep.disabled = !("error" in out);
          note.textContent = "error" in out ? (out.error === "cancelled" ? "Not kept." : out.error) : "Kept, and this window signed in. Say what you do next.";
        });
        turn.append(h("div", { class: "row spent-row" }, keep));
      }
      follow();
      break;
    }
    case "quitting":
      askToKeep($("#keeprun"), e.hours, { bridge, screen });
      break;
    case "error":
      setBusy(false);
      fail(e.message);
      break;
  }
});

function setBusy(on: boolean): void {
  busy = on;
  document.body.classList.toggle("busy", on);
  activity.hidden = !on;
  if (on) activity.querySelector(".text")!.textContent = "the DM is thinking";
}

// ── the prompt ─────────────────────────────────────────────────────────

const history: string[] = (() => {
  try {
    return JSON.parse(localStorage.getItem("history") ?? "[]");
  } catch {
    return [];
  }
})();
let back = history.length;

function send(text: string): void {
  if (busy) return;
  history.push(text);
  back = history.length;
  try {
    localStorage.setItem("history", JSON.stringify(history.slice(-200)));
  } catch { /* history is a convenience */ }
  pending = newTurn(text);
  setBusy(true);
  bridge.say(text);
}


function grow(): void {
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight + 2}px`;
}

input.addEventListener("input", grow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) {
      if (telling) typewriter.skip();
      return;
    }
    if (busy) return;
    input.value = "";
    grow();
    send(text);
  } else if (e.key === "ArrowUp" && input.selectionStart === 0 && back > 0) {
    e.preventDefault();
    input.value = history[--back];
    grow();
  } else if (e.key === "ArrowDown" && input.selectionEnd === input.value.length && back < history.length) {
    e.preventDefault();
    back++;
    input.value = history[back] ?? "";
    grow();
  }
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (panels.closeMap()) return;
    if (busy) bridge.cancel();
    else if (telling) typewriter.skip();
  }
});
story.addEventListener("click", () => telling && typewriter.skip());
$("#prompt").addEventListener("submit", (e) => e.preventDefault());

// ── starting ───────────────────────────────────────────────────────────

// The world server can't be reached: say where it was looked for, and try
// again. Only one on this machine is the player's own to start.
function offline(server: string, error: string): void {
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(server);
  const box = $("#offline");
  const retry = h("button", { type: "button" }, "Try again");
  retry.addEventListener("click", () => {
    box.hidden = true;
    boot();
  });
  box.replaceChildren(h("div", { class: "box" },
    h("h1", null, "The world is not answering"),
    h("p", null, "This window plays in a world kept by the world server, expected at ", h("code", null, server), "."),
    local
      ? h("p", null, "To play locally, start it from the game's folder with ", h("code", null, "bin/dm_mcp --http 8742"), ", then try again.")
      : h("p", null, "It may be down for a moment, or this computer may be offline. Try again shortly."),
    h("p", { class: "err" }, error),
    retry));
  box.hidden = false;
}

// The launch menu first: what to play is the player's to choose.
async function boot(): Promise<void> {
  const menu = await bridge.menu();
  apply(menu.settings);
  if (!menu.ok) return offline(menu.server, menu.error);
  const chosen = showMenu($("#menu"), menu, { bridge, screen });
  // What's new, over the menu if it is still up when the server answers.
  bridge.news().then((news) => { if (document.body.classList.contains("at-menu")) showNews($("#news"), news, { bridge, screen }); }).catch(() => {});
  start(await chosen);
}

async function start(choice: Choice): Promise<void> {
  const info = await bridge.start(choice);
  apply(info.settings);
  if (!info.ok) return offline(info.server, info.error);
  panels.dm = info.dm;
  panels.update(info.board);
  if (info.ended) screen.banner("A NEW RUN", "your last guest run was gone: a guest's run is kept a day unplayed");
  paintSky(info.board, true);
  arrived(null, info.board);
  inFight = !!info.board.status?.fight;
  document.body.classList.toggle("in-fight", inFight);
  if (!info.board.make_character) setBusy(true); // a character to make first: the screen for it comes, not the DM
  input.focus();
}

boot();
