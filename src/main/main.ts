import { app, BrowserWindow, ipcMain, Menu, session as sessions, shell } from "electron";
import { createHash } from "node:crypto";
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ClaudeCodeBackend, findClaude } from "../backends/claude-code.ts";
import { CodexBackend, findCodex, isFile } from "../backends/codex.ts";
import { ReplayBackend } from "../backends/replay.ts";
import { Session, WINDOW, type Backend } from "../core/session.ts";
import type { Choice, DmChoice, LaunchMenu, Settings, StartInfo } from "../core/bridge.ts";
import type { Board, CharacterChoice, GameEvent, LevelPick, News, OwnWish } from "../core/protocol.ts";
import { Account, connect, HttpWorld, news, ServerError } from "../world/http.ts";
import { DEFAULTS, loadConfig, PLAY, saveDm, saveKeys, saveNewsSeen, saveSettings, type Config } from "./config.ts";
import { selfUpdates, updateQuietly } from "./update.ts";

// The Electron shell: one window, the world server reached over HTTP, and
// the DM run as the player's own Claude Code or Codex (see backends/).
//
// Env for development: HARNESS_STATE (state folder, default the app's own),
// HARNESS_SERVER / HARNESS_SECRET / HARNESS_DM / DM_MODEL / HARNESS_DM_EFFORT /
// CLAUDE_PATH / CODEX_MODEL / CODEX_EFFORT / CODEX_PATH (over config.json),
// HARNESS_REPLAY (a JSON file of scripted turns played instead of a DM),
// HARNESS_HIDDEN (no window shown).
if (process.env.HARNESS_STATE) app.setPath("userData", resolve(process.env.HARNESS_STATE));
// The window was called Harness before it had its name: its settings and
// conversations come over from that folder the first time.
else {
  const was = join(app.getPath("appData"), "Harness");
  const now = app.getPath("userData");
  if (now !== was && existsSync(join(was, "config.json")) && !existsSync(join(now, "config.json"))) cpSync(was, now, { recursive: true });
}
const configPath = () => join(app.getPath("userData"), "config.json");
// A release build plays on the game's own server unless told otherwise.
const readConfig = () => loadConfig(configPath(), process.env, app.isPackaged ? { ...DEFAULTS, server: PLAY } : DEFAULTS);

let win: BrowserWindow | null = null;
let session: Session | null = null;
let connected: { config: Config; world: HttpWorld } | null = null;
// Closing on a guest's run with a character in it asks first whether to
// keep it (renderer/keeprun.ts); closing again while it asks just closes.
let asking = false;
let quitting = false;
let signingIn: { cancelled: boolean } | null = null; // a sign-in waiting on the player's yes in the browser
let told: string[] = []; // the news last handed to the page, kept as shown once the player has seen it

const emit = (e: GameEvent) => {
  win?.webContents.send("harness:event", e);
  if (e.type === "newWorld" && connected) {
    converse(connected.config, connected.world, e.board).catch((err) => emit({ type: "error", message: String(err?.message ?? err) }));
  }
};

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 720, minHeight: 520, title: "Pen and Paper", backgroundColor: "#07090f", icon: join(__dirname, "icon.png"),
    show: !process.env.HARNESS_HIDDEN,
    webPreferences: {
      preload: join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false,
      offscreen: !!process.env.HARNESS_HIDDEN, // a hidden window draws no frames to capture; an offscreen one does
    },
  });
  // The page never leaves itself: links open in the browser, and nothing
  // opens a second window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(join(__dirname, "renderer", "index.html"));
  win.on("close", (e) => {
    const board = session?.current();
    if (quitting || asking || !board?.guest?.keep || !board.sheet) return;
    e.preventDefault();
    asking = true;
    emit({ type: "quitting", hours: board.guest.kept_for_hours });
  });
  win.on("closed", () => {
    session?.cancel();
    if (signingIn) signingIn.cancelled = true;
    win = null;
  });
}

// One state folder per world server, run and world, so another run or a
// new world starts a new conversation with the DM; and one per DM, since
// neither can resume the other's conversation. A run is named by a short
// hash of its key, never the key itself.
function stateDirFor(config: Config, world: HttpWorld, worldName: string): string {
  const run = createHash("sha256").update(world.secret).digest("hex").slice(0, 12);
  const key = `${config.server.replace(/^https?:\/\//, "")}-${run}-${worldName}${dmOf(config) === "codex" ? "-codex" : ""}`.replace(/[^\w.-]+/g, "_");
  return join(app.getPath("userData"), "worlds", key);
}

// Who plays the DM: the one asked for, or Claude Code if it is installed,
// else Codex if that is.
function dmOf(config: Config): "claude" | "codex" {
  if (config.dm === "claude" || config.dm === "codex") return config.dm;
  if (config.claudePath || isFile(findClaude())) return "claude";
  return config.codexPath || isFile(findCodex()) ? "codex" : "claude";
}

// The models the player may switch the DM to from the window. Claude Code's
// by alias, always the newest of that name; Codex's by whatever name the
// player gives (empty: their own default). Its rules are tuned on Sonnet.
const CLAUDE_MODELS = [{ id: "sonnet", name: "Sonnet" }, { id: "opus", name: "Opus" }, { id: "fable", name: "Fable" }, { id: "haiku", name: "Haiku" }];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CODEX_EFFORTS = ["", "low", "medium", "high"];
const CODEX_MODEL = /^[A-Za-z0-9._:-]{0,64}$/;

function dmChoice(config: Config): DmChoice {
  if (process.env.HARNESS_REPLAY) return { which: "replay" };
  return dmOf(config) === "claude"
    ? { which: "claude", model: config.model, effort: config.effort, models: CLAUDE_MODELS, efforts: CLAUDE_EFFORTS }
    : { which: "codex", model: config.codexModel, effort: config.codexEffort, models: [], efforts: CODEX_EFFORTS };
}

// The DM on another model or effort, kept for next time, from the next turn on.
function setDm(model: string, effort: string): { ok: true; label: string } | { error: string } {
  const config = readConfig();
  const now = dmChoice(config);
  if (now.which === "replay") return { error: "A scripted replay has no model to change." };
  if (now.which === "claude") {
    if (!CLAUDE_MODELS.some((m) => m.id === model) && model !== config.model) return { error: `Claude Code's models here are ${CLAUDE_MODELS.map((m) => m.name).join(", ")}.` };
    if (!CLAUDE_EFFORTS.includes(effort)) return { error: `Effort is one of ${CLAUDE_EFFORTS.join(", ")}.` };
    saveDm(configPath(), { model, effort });
  } else {
    if (!CODEX_MODEL.test(model)) return { error: "A model's name is letters, digits, dots, dashes and colons." };
    if (!CODEX_EFFORTS.includes(effort)) return { error: `Effort is one of ${CODEX_EFFORTS.filter(Boolean).join(", ")}, or its default.` };
    saveDm(configPath(), { codexModel: model, codexEffort: effort });
  }
  session?.retune(model, effort);
  return { ok: true, label: dmLabel(readConfig()) };
}

function dmLabel(config: Config): string {
  if (process.env.HARNESS_REPLAY) return "scripted replay";
  if (dmOf(config) === "claude") return `${config.model} · ${config.effort} effort`;
  return ["Codex", config.codexModel || "its default model", config.codexEffort && `${config.codexEffort} effort`].filter(Boolean).join(" · ");
}

// A conversation with the DM in the world as it stands, under the rulebook
// the server hands out for it (with that world's canon). A new world gets a
// new conversation: what the DM said of the last one would mislead it.
async function converse(config: Config, world: HttpWorld, board: Board): Promise<void> {
  let backend: Backend;
  if (process.env.HARNESS_REPLAY) {
    backend = new ReplayBackend(JSON.parse(readFileSync(process.env.HARNESS_REPLAY, "utf8")));
  } else {
    const common = { stateDir: stateDirFor(config, world, board.world), mcpUrl: world.mcpUrl, systemPrompt: `${await world.rulebook()}\n\n${WINDOW}` };
    backend = dmOf(config) === "codex"
      ? new CodexBackend({ ...common, model: config.codexModel, effort: config.codexEffort, codexPath: config.codexPath })
      : new ClaudeCodeBackend({ ...common, model: config.model, effort: config.effort, claudePath: config.claudePath });
  }
  session?.cancel();
  session = new Session(backend, world, emit);
  session.open().catch((e) => emit({ type: "error", message: String(e?.message ?? e) }));
}

const settingsOf = (config: Config): Settings => ({ speed: config.speed, fx: config.fx, receipts: config.receipts });

// The launch menu: signed in or not, and the account's runs. A window whose
// key the account no longer has (signed out everywhere) is signed out here.
// Nothing asks the server for a guest until the player presses Play.
async function menu(): Promise<LaunchMenu> {
  const config = readConfig();
  const settings = settingsOf(config);
  if (!config.device) return { ok: true, settings, signedIn: false };
  try {
    const { runs, most, own, supporters } = await Account.runs(config.server, config.device);
    return { ok: true, settings, signedIn: true, runs, most, own, supporters };
  } catch (e) {
    if (e instanceof ServerError && e.status === 404) {
      saveKeys(configPath(), { device: "", run: "" });
      return { ok: true, settings, signedIn: false };
    }
    return { ok: false, settings, server: config.server, error: e instanceof Error ? e.message : String(e) };
  }
}

// What's new at launch: the newest news the world server has for this
// version, if this window hasn't shown it, and a newer window, told only
// where this one can't update itself. Shown once: kept as seen when the
// player has read it. On any failure, nothing.
async function whatsNew(): Promise<News> {
  const config = readConfig();
  const seen = new Set(Array.isArray(config.newsSeen) ? config.newsSeen : []);
  try {
    const out = await news(config.server, app.getVersion());
    const items = (Array.isArray(out.news) ? out.news : []).filter((n) => typeof n?.id === "string" && !seen.has(n.id));
    const newer = out.window && !selfUpdates() && !seen.has(`window-${out.window.version}`) ? out.window : undefined;
    told = [...items.map((n) => n.id), ...(newer ? [`window-${newer.version}`] : [])];
    return newer ? { news: items, window: newer } : { news: items };
  } catch {
    return { news: [] };
  }
}

async function start(choice: Choice): Promise<StartInfo> {
  const config = readConfig();
  const settings = settingsOf(config);
  try {
    let world: HttpWorld, board: Board, ended = false;
    if (choice?.kind === "run" || choice?.kind === "new") {
      if (!config.device) throw new Error("This window isn't signed in.");
      const run = choice.kind === "new" ? (await Account.newRun(config.server, config.device, choice.world ? String(choice.world) : undefined)).run : String(choice.run);
      saveKeys(configPath(), { run });
      world = new HttpWorld(config.server, `${config.device}/${run}`);
      board = await world.board();
    } else {
      ({ world, board, ended } = await connect(config.server, config.secret, (key) => {
        config.secret = key;
        saveKeys(configPath(), { secret: key });
      }));
    }
    connected = { config, world };
    await converse(config, world, board);
    return { ok: true, settings, server: config.server, board, dm: dmLabel(config), ended };
  } catch (e) {
    return { ok: false, settings, server: config.server, error: e instanceof Error ? e.message : String(e) };
  }
}

app.whenReady().then(() => {
  if (!process.env.HARNESS_DEV) Menu.setApplicationMenu(null);
  // Chromium fetches its spelling dictionaries from Google, on any system
  // but a Mac, which checks spelling with its own. The window talks to the
  // world server and GitHub and nothing else, so there it doesn't check
  // spelling. Turning it off isn't enough: with no languages there is
  // nothing to fetch.
  if (process.platform !== "darwin") {
    sessions.defaultSession.setSpellCheckerLanguages([]);
    sessions.defaultSession.setSpellCheckerEnabled(false);
  }
  ipcMain.handle("harness:menu", () => menu());
  ipcMain.handle("harness:news", () => whatsNew());
  ipcMain.handle("harness:news-seen", () => {
    if (told.length) saveNewsSeen(configPath(), told);
    told = [];
  });
  ipcMain.handle("harness:worlds", async () => {
    const config = readConfig();
    try {
      if (!config.device) throw new Error("This window isn't signed in.");
      return await Account.worlds(config.server, config.device);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("harness:ask-world", async (_e, wish: OwnWish) => {
    const config = readConfig();
    try {
      if (!config.device) throw new Error("This window isn't signed in.");
      return { ok: true, own: await Account.askWorld(config.server, config.device, wish) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  // What supporters get, on the site, as the world server names its page.
  ipcMain.handle("harness:supporters", async () => {
    const config = readConfig();
    try {
      if (!config.device) throw new Error("This window isn't signed in.");
      const { supporters } = await Account.runs(config.server, config.device);
      if (!supporters || !/^https?:\/\//.test(supporters)) throw new Error("The world server gave no page to open.");
      await shell.openExternal(supporters);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("harness:forget-run", async (_e, run: unknown) => {
    const config = readConfig();
    try {
      if (!config.device) throw new Error("This window isn't signed in.");
      if (!/^[0-9a-f]{24}$/.test(String(run))) throw new Error("That isn't a run.");
      await Account.forgetRun(config.server, config.device, String(run));
      if (config.run === run) saveKeys(configPath(), { run: "" });
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle("harness:start", (_e, choice: Choice) => start(choice));
  // Signing in: the site's page opens in the browser, and the window asks the
  // world server every few seconds whether the player has said yes there,
  // until it has its key, the sign-in runs out, or the player cancels.
  ipcMain.handle("harness:sign-in", async () => {
    if (signingIn) signingIn.cancelled = true;
    const mine = (signingIn = { cancelled: false });
    try {
      const config = readConfig();
      const pairing = await Account.pair(config.server, config.secret);
      if (!/^https?:\/\//.test(pairing.url)) throw new Error("The world server gave no page to open.");
      await shell.openExternal(pairing.url);
      const until = Date.now() + pairing.expires_in * 1000;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, Math.max(1, pairing.interval) * 1000));
        if (mine.cancelled) return { error: "cancelled" };
        const key = await Account.claim(config.server, pairing.device_code).catch((e) => {
          if (e instanceof ServerError && e.status === 404) throw e; // run out on the server's side
          return null; // a blip: ask again
        });
        if (key) {
          saveKeys(configPath(), { device: key });
          if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
          }
          return { ok: true };
        }
      }
      return { error: "The sign-in ran out. Try again." };
    } catch (e) {
      return { error: e instanceof ServerError && e.status === 404 ? "The sign-in ran out. Try again." : e instanceof Error ? e.message : String(e) };
    } finally {
      if (signingIn === mine) signingIn = null;
    }
  });
  ipcMain.handle("harness:sign-in-cancel", () => { if (signingIn) signingIn.cancelled = true; });
  ipcMain.handle("harness:sign-out", async () => {
    const config = readConfig();
    if (config.device) await Account.forget(config.server, config.device).catch(() => {});
    saveKeys(configPath(), { device: "", run: "" });
  });
  ipcMain.handle("harness:say", (_e, input: string) => { session?.turn(String(input)); });
  ipcMain.handle("harness:cancel", () => session?.cancel());
  ipcMain.handle("harness:map", () => session?.map() ?? "");
  ipcMain.handle("harness:atlas", () => session?.atlas() ?? null);
  ipcMain.handle("harness:lore", () => session?.lore().catch(() => null) ?? null);
  // Making the character: each a call to the world server, which keeps the rules.
  const asked = <T>(p: Promise<T> | undefined) => p?.catch((e) => ({ error: String(e?.message ?? e) })) ?? null;
  ipcMain.handle("harness:character", () => asked(session?.character()));
  ipcMain.handle("harness:character-roll", () => asked(session?.rollCharacter()));
  ipcMain.handle("harness:character-reroll", (_e, ability: string) => asked(session?.rerollStat(String(ability))));
  ipcMain.handle("harness:character-make", (_e, choice: CharacterChoice) => asked(session?.makeCharacter(choice)));
  ipcMain.handle("harness:character-bring", (_e, run: unknown) => asked(session?.bringCharacter(String(run ?? ""))));
  ipcMain.handle("harness:begin", (_e, tell: string) => { session?.begin(String(tell)); });
  ipcMain.handle("harness:level", () => asked(session?.levelOptions()));
  ipcMain.handle("harness:level-choose", (_e, picks: LevelPick[]) =>
    asked(session?.chooseLevel(Array.isArray(picks) ? picks : []).then((out) => ({ ...out, board: session?.current() ?? undefined }))));
  ipcMain.handle("harness:begin-again", (_e, how: string) => asked(session?.beginAgain(how === "start" ? "start" : "on")));
  // Back to the launch menu: the DM's turn under way stopped, the run let
  // go, and the page loaded afresh, which opens on the menu.
  ipcMain.handle("harness:to-menu", () => {
    session?.cancel();
    session = null;
    connected = null;
    win?.webContents.reload();
  });
  ipcMain.handle("harness:quit", () => {
    quitting = true;
    win?.close();
  });
  ipcMain.handle("harness:stay", () => { asking = false; });
  ipcMain.handle("harness:settings", (_e, s: Settings) => saveSettings(configPath(), s));
  ipcMain.handle("harness:dm", () => dmChoice(readConfig()));
  ipcMain.handle("harness:dm-set", (_e, model: unknown, effort: unknown) => setDm(String(model ?? ""), String(effort ?? "")));
  createWindow();
  updateQuietly();
  app.on("activate", () => { if (!win) createWindow(); });
});

app.on("window-all-closed", () => app.quit());
