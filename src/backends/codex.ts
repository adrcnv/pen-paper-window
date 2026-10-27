import { spawn, execFile, execFileSync } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { homedir } from "node:os";
import type { Backend } from "../core/session.ts";

// The DM is the player's own Codex (OpenAI's CLI), run once per turn with
// `codex exec` and resumed by thread id, as backends/claude-code.ts runs
// Claude Code. Its events are turned into the rows Claude Code writes, so
// the window reads both alike. This is the whole of what the client does
// with it, and every setting is here to read:
//
//   --ignore-user-config --ignore-rules
//                        none of the user's own Codex settings or rules come
//                        along; their sign-in stays where it is, Codex's own
//   features.* = false   no shell, no file edits, no browser, no web search,
//                        no images, no plugins or sub-agents
//   sandbox_mode "read-only", approval_policy "never"
//                        should anything get through, it can write nothing,
//                        and nobody is asked
//   model_instructions_file
//                        the rulebook, in place of Codex's own instructions
//   project_doc_max_bytes 0, skills, include_* = false
//                        no AGENTS.md, skills or notes on the working folder
//                        beside the rulebook
//   history.persistence "none"
//                        the player's words stay out of Codex's prompt history
//   mcp_servers.harness-dm
//                        its only tools are the world server's
//   --strict-config      a setting this Codex does not know stops the turn
//                        rather than being skipped, so a renamed switch
//                        cannot quietly hand a tool back. Written against
//                        codex-cli 0.163.0.
//
// The world server's URL goes in as a setting, so it shows in the process
// list, as it shows in this app's config.json. The client never sees, reads
// or stores the user's OpenAI credentials: the installed `codex` signs itself
// in, through OpenAI's own flow.
export interface CodexOptions {
  stateDir: string; // one folder per world: the thread id, the transcript, the rulebook, the empty working folder
  mcpUrl: string;
  systemPrompt: string;
  model: string; // empty: the user's own default
  effort: string; // empty: the model's own default
  codexPath?: string;
}

export const NOT_SIGNED_IN =
  "Codex is not signed in. Open a terminal, run `codex login`, sign in with your own ChatGPT account, then come back.";

export const UNSUPPORTED =
  "This version of Codex does not take the settings that keep the DM to the game's tools. Update the Pen and Paper window, or use the Codex version it names in its notes.";

const OFF = [
  "shell_tool", "unified_exec", "view_image", "image_generation", "browser_use", "browser_use_external", "in_app_browser",
  "computer_use", "multi_agent", "plugins", "remote_plugin", "apps", "memories", "skill_search", "tool_suggest", "sleep_tool",
  "goals", "hooks", "code_mode_host",
];

export class CodexBackend implements Backend {
  private o: CodexOptions;
  private codex: string;
  private signedIn = false;

  constructor(options: CodexOptions) {
    this.o = { ...options, stateDir: resolve(options.stateDir) };
    // A path is made whole here: the turn runs from the DM's own folder.
    this.codex = options.codexPath ? (/[\\/]/.test(options.codexPath) ? resolve(options.codexPath) : options.codexPath) : findCodex();
    mkdirSync(this.cwd, { recursive: true });
    writeFileSync(this.rulebookPath, options.systemPrompt);
  }

  get cwd(): string {
    return join(this.o.stateDir, "cwd");
  }
  private get rulebookPath(): string {
    return join(this.o.stateDir, "rulebook.md");
  }
  private get sessionPath(): string {
    return join(this.o.stateDir, "dm_session");
  }
  private get transcriptPath(): string {
    return join(this.o.stateDir, "transcript.jsonl");
  }

  sessionId(): string | null {
    return existsSync(this.sessionPath) ? readFileSync(this.sessionPath, "utf8").trim() || null : null;
  }

  hasConversation(): boolean {
    return this.sessionId() != null;
  }

  retune(model: string, effort: string): void {
    this.o = { ...this.o, model, effort };
  }

  lastTurn(): { input: string; narration: string } | null {
    if (!existsSync(this.transcriptPath)) return null;
    const lines = readFileSync(this.transcriptPath, "utf8").trim().split("\n");
    try {
      return JSON.parse(lines[lines.length - 1]);
    } catch {
      return null;
    }
  }

  settings(): [string, string][] {
    const set: [string, string | number | boolean][] = [
      ["approval_policy", "never"], ["sandbox_mode", "read-only"], ["web_search", "disabled"],
      ["model_instructions_file", this.rulebookPath],
      ["project_doc_max_bytes", 0], ["check_for_update_on_startup", false], ["history.persistence", "none"],
      ["skills.include_instructions", false], ["include_environment_context", false], ["include_permissions_instructions", false],
      ["include_apps_instructions", false], ["include_collaboration_mode_instructions", false],
      ["tools.experimental_request_user_input.enabled", false],
      ...OFF.map((f): [string, boolean] => [`features.${f}`, false]),
      // A new world takes minutes to make (new_world): the DM waits for it
      // rather than give up on the call and make another.
      ["mcp_servers.harness-dm.url", this.o.mcpUrl], ["mcp_servers.harness-dm.tool_timeout_sec", 600],
      ["mcp_servers.harness-dm.startup_timeout_sec", 30], ["mcp_servers.harness-dm.default_tools_approval_mode", "approve"],
    ];
    if (this.o.model) set.push(["model", this.o.model]);
    if (this.o.effort) set.push(["model_reasoning_effort", this.o.effort]);
    return set.map(([k, v]) => [k, toml(v)]);
  }

  args(): string[] {
    const session = this.sessionId();
    const args = ["exec", ...(session ? ["resume", session] : []),
      "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--strict-config"];
    for (const [k, v] of this.settings()) args.push("-c", `${k}=${v}`);
    args.push("-");
    return args;
  }

  // The player's words go in on stdin, never as an argument, so nothing they
  // type can be read as a flag.
  async say(input: string, onRow: (row: unknown) => void, signal?: AbortSignal): Promise<{ narration: string }> {
    if (!this.signedIn) {
      const status = await loginStatus(this.codex);
      if (status === "missing") throw new Error(`Could not start Codex (${this.codex}): is it installed?`);
      if (status === "out") throw new Error(NOT_SIGNED_IN);
      this.signedIn = true;
    }
    const started = Date.now();
    return new Promise((resolve, reject) => {
      const child = spawn(this.codex, this.args(), { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
      const events: any[] = [];
      const rows = new CodexRows();
      let err = "";
      const stop = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", stop, { once: true });
      child.stderr.on("data", (d) => (err += d));
      createInterface({ input: child.stdout }).on("line", (line) => {
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          return;
        }
        events.push(event);
        for (const row of rows.of(event)) onRow(row);
      });
      child.on("error", (e) => reject(new Error(`Could not start Codex (${this.codex}): ${e.message}`)));
      child.on("close", (code) => {
        signal?.removeEventListener("abort", stop);
        if (signal?.aborted) return reject(new Error("stopped"));
        if (/unknown configuration field/i.test(err)) return reject(new Error(UNSUPPORTED));
        const result = parseTurn(events);
        if (!result) return reject(new Error(`The DM did not answer (exit ${code}): ${err.trim().slice(-400)}`));
        if (result.error) {
          return reject(new Error(/401|unauthori[sz]ed|not logged in/i.test(result.error) ? NOT_SIGNED_IN : `The DM stopped: ${result.error}`));
        }
        if (result.sessionId) writeFileSync(this.sessionPath, result.sessionId);
        appendFileSync(this.transcriptPath, JSON.stringify({
          at: new Date().toISOString(), input, narration: result.narration, ms: Date.now() - started, usage: result.usage,
        }) + "\n");
        resolve({ narration: result.narration });
      });
      child.stdin.end(input);
    });
  }
}

// Codex's events as the rows Claude Code writes (core/stream.ts reads
// those): a tool call in an assistant row, its result in a user row, the
// DM's words as text.
export class CodexRows {
  private started = new Set<string>();

  of(event: any): unknown[] {
    const item = event?.item;
    if (!item || (event.type !== "item.started" && event.type !== "item.completed")) return [];
    if (item.type === "agent_message" && event.type === "item.completed") {
      return [{ type: "assistant", message: { content: [{ type: "text", text: String(item.text ?? "") }] } }];
    }
    if (item.type !== "mcp_tool_call") return [];
    const out: unknown[] = [];
    if (!this.started.has(item.id)) {
      this.started.add(item.id);
      out.push({ type: "assistant", message: { content: [{ type: "tool_use", id: item.id, name: String(item.tool ?? ""), input: argsOf(item.arguments) }] } });
    }
    if (event.type === "item.completed") {
      out.push({ type: "user", message: { content: [{
        type: "tool_result", tool_use_id: item.id, content: item.result?.content ?? [], is_error: !!item.error || item.status === "failed",
      }] } });
    }
    return out;
  }
}

function argsOf(a: unknown): unknown {
  if (typeof a !== "string") return a ?? {};
  try {
    return JSON.parse(a);
  } catch {
    return {};
  }
}

// The turn as a whole: everything the DM said, in order, and the thread to
// resume, kept only once the turn has completed. An `error` item is Codex
// warning, and an `error` event is it retrying; only `turn.failed` fails.
export function parseTurn(events: any[]): { narration: string; sessionId?: string; error?: string; usage?: unknown } | null {
  const failed = events.find((e) => e?.type === "turn.failed");
  const done = events.find((e) => e?.type === "turn.completed");
  if (!failed && !done) return null;
  const narration = events
    .filter((e) => e?.type === "item.completed" && e.item?.type === "agent_message")
    .map((e) => String(e.item.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
  if (failed) return { narration, error: String(failed.error?.message ?? "the turn failed") };
  return { narration, sessionId: events.find((e) => e?.type === "thread.started")?.thread_id, usage: done.usage };
}

// A setting's value as TOML: strings quoted, numbers and booleans bare.
export function toml(v: string | number | boolean): string {
  return typeof v === "string" ? JSON.stringify(v) : String(v);
}

// Asked once, before the first turn: signed out, Codex would retry its
// requests for half a minute before it said so.
function loginStatus(codex: string): Promise<"in" | "out" | "missing"> {
  return new Promise((resolve) => {
    execFile(codex, ["login", "status"], { timeout: 15000 }, (e) =>
      resolve(!e ? "in" : e.code === "ENOENT" ? "missing" : "out"));
  });
}

// Where the installed `codex` is: PATH, then the login shell, then where
// npm, bun, Homebrew and OpenAI's installer put it. On Windows only the
// program itself: npm's codex.cmd would need a shell to run, and a shell
// reads its arguments.
export function findCodex(env: NodeJS.ProcessEnv = process.env): string {
  const names = process.platform === "win32" ? ["codex.exe"] : ["codex"];
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) for (const n of names) if (isFile(join(dir, n))) return join(dir, n);
  if (process.platform !== "win32" && env.SHELL) {
    try {
      const found = execFileSync(env.SHELL, ["-lic", "command -v codex"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })
        .trim().split("\n").pop();
      if (found && isFile(found)) return found;
    } catch { /* no login shell answer */ }
  }
  const home = homedir();
  const known = [join(home, ".local", "bin"), join(home, ".codex", "bin"), join(home, ".bun", "bin"), join(home, ".npm-global", "bin"),
    "/usr/local/bin", "/opt/homebrew/bin"];
  for (const dir of known) for (const n of names) if (isFile(join(dir, n))) return join(dir, n);
  return names[0];
}

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
