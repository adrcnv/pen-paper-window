import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Settings } from "../core/bridge.ts";

// What the app remembers between runs, in config.json under its state
// folder. The environment wins over the file, for development.
export interface Config extends Settings {
  server: string; // the world server: the DM reaches /mcp on it, this window /client
  secret: string; // a run's own key (a guest's, or the one-world server's secret)
  device: string; // this window's own key, once signed in to an account: it opens the account's runs
  run: string; // the account's run last played
  dm: string; // who plays the DM: "claude", "codex", or "auto" (Claude Code if installed, else Codex)
  model: string;
  effort: string;
  claudePath: string; // empty: find the installed `claude`
  codexModel: string; // empty: the player's own Codex default
  codexEffort: string; // empty: that model's own default
  codexPath: string; // empty: find the installed `codex`
  newsSeen: string[]; // the world server's news this window has shown, the newest last
}

// The game's world server, for a release build; the window run from the
// source looks for one on this machine (DEFAULTS).
export const PLAY = "https://play.penandpaper.tech";

export const DEFAULTS: Config = {
  server: "http://127.0.0.1:8742", secret: "", device: "", run: "", dm: "auto", model: "claude-sonnet-5-5", effort: "high", claudePath: "",
  codexModel: "", codexEffort: "", codexPath: "", newsSeen: [],
  speed: "normal", fx: "full", receipts: true,
};

const ENV: [keyof Config, string][] = [
  ["server", "HARNESS_SERVER"], ["secret", "HARNESS_SECRET"], ["dm", "HARNESS_DM"], ["model", "DM_MODEL"], ["effort", "HARNESS_DM_EFFORT"],
  ["claudePath", "CLAUDE_PATH"], ["codexModel", "CODEX_MODEL"], ["codexEffort", "CODEX_EFFORT"], ["codexPath", "CODEX_PATH"],
];

export function loadConfig(path: string, env: NodeJS.ProcessEnv = process.env, defaults: Config = DEFAULTS): Config {
  let saved: Partial<Config> = {};
  try {
    if (existsSync(path)) saved = JSON.parse(readFileSync(path, "utf8"));
  } catch { /* a broken file falls back to the defaults */ }
  const config: Config = { ...defaults, ...saved };
  for (const [key, name] of ENV) if (env[name]) (config as any)[key] = env[name];
  return config;
}

// Keys the server gave this window, and the run last played, kept for next
// time. The file holds keys, so only its owner may read it.
export function saveKeys(path: string, keys: Partial<Pick<Config, "secret" | "device" | "run">>): void {
  write(path, keys);
}

// Only what the player changes from the window is written back.
export function saveSettings(path: string, settings: Settings): void {
  write(path, { speed: settings.speed, fx: settings.fx, receipts: settings.receipts });
}

// The DM's model and effort, as the player changed them from the window.
export function saveDm(path: string, dm: Partial<Pick<Config, "model" | "effort" | "codexModel" | "codexEffort">>): void {
  write(path, dm);
}

// The news shown, so each is shown once: the last fifty, more than the
// server ever lists at once.
const SEEN = 50;
export function saveNewsSeen(path: string, ids: string[]): void {
  const was = loadConfig(path, {}).newsSeen;
  const kept = (Array.isArray(was) ? was : []).filter((id) => !ids.includes(id));
  write(path, { newsSeen: [...kept, ...ids].slice(-SEEN) });
}

function write(path: string, patch: Record<string, unknown>): void {
  let saved: Record<string, unknown> = {};
  try {
    if (existsSync(path)) saved = JSON.parse(readFileSync(path, "utf8"));
  } catch { /* start over */ }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...saved, ...patch }, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
}
