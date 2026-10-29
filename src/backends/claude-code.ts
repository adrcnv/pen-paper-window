import { execFile, execFileSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { homedir } from "node:os";
import { SignedOut, type Backend } from "../core/session.ts";
import { carried, turns } from "./transcript.ts";

// The DM is the player's own Claude Code, run once per turn in print mode
// and resumed by session id. This is the whole of what the client does with
// it, and every flag is here to read:
//
//   --tools ""                      no built-in tools: it cannot read or write
//                                   files, run commands or browse
//   --allowedTools mcp__harness-dm__*
//   --mcp-config … --strict-mcp-config
//                                   its only tools are the world server's, and
//                                   no other MCP server the user has set up
//   --setting-sources project       run from an empty folder of its own, so
//                                   none of the user's settings, hooks or
//                                   instructions come along
//   --system-prompt …               the rulebook, as the world server hands it
//
// The client never sees, reads or stores the user's Claude credentials: the
// installed `claude` signs itself in, through Anthropic's own flow.
export interface ClaudeCodeOptions {
  stateDir: string; // one folder per world: the session id, the transcript, the empty working folder
  mcpUrl: string;
  systemPrompt: string;
  model: string;
  effort: string;
  claudePath?: string;
}

// Not signed in: the command that signs in the very program the window runs,
// which needn't be on the terminal's PATH (on Windows it often isn't), as
// PowerShell takes it there. /login only works in a session of Claude Code's
// own, never in the window, which runs it a request at a time.
export function notSignedIn(claude: string, platform: NodeJS.Platform = process.platform): string {
  const cmd = platform === "win32" ? `& "${claude}" auth login` : /\s/.test(claude) ? `"${claude}" auth login` : `${claude} auth login`;
  return `Claude Code is not signed in. In ${platform === "win32" ? "PowerShell" : "a terminal"}, run ${cmd}, sign in with your own account in the browser, then come back.`;
}
// The Claude app's sign-in is its own: the window needs the Claude Code program.
export const NOT_INSTALLED =
  "Claude Code isn't installed, or this window can't find it. Install it (code.claude.com/docs/en/setup), sign it in with `claude auth login` in a new terminal, then come back. The Claude app alone isn't enough.";

export class ClaudeCodeBackend implements Backend {
  private o: ClaudeCodeOptions;
  private claude: string;

  constructor(options: ClaudeCodeOptions) {
    this.o = { ...options, stateDir: resolve(options.stateDir) };
    this.claude = options.claudePath || findClaude();
    mkdirSync(this.cwd, { recursive: true });
    writeFileSync(this.configPath, JSON.stringify({ mcpServers: { "harness-dm": { type: "http", url: options.mcpUrl } } }, null, 2));
  }

  get cwd(): string {
    return join(this.o.stateDir, "cwd");
  }
  private get configPath(): string {
    return join(this.o.stateDir, "dm_mcp.json");
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

  // A conversation to resume, or turns on record that a new one is told.
  hasConversation(): boolean {
    return this.sessionId() != null || existsSync(this.transcriptPath);
  }

  // The next turn begins a new conversation; the transcript stays.
  rotate(): void {
    rmSync(this.sessionPath, { force: true });
  }

  retune(model: string, effort: string): void {
    this.o = { ...this.o, model, effort };
  }

  lastTurn(): { input: string; narration: string } | null {
    return turns(this.transcriptPath).at(-1) ?? null;
  }

  args(): string[] {
    const args = [
      "-p", "--output-format", "stream-json", "--verbose", "--model", this.o.model,
      "--setting-sources", "project", "--effort", this.o.effort,
      "--mcp-config", this.configPath, "--strict-mcp-config",
      "--tools", "", "--allowedTools", "mcp__harness-dm__*",
      "--system-prompt", this.o.systemPrompt,
    ];
    const session = this.sessionId();
    if (session) args.push("--resume", session);
    return args;
  }

  // The player's words go in on stdin, never as an argument, so nothing they
  // type can be read as a flag.
  say(input: string, onRow: (row: unknown) => void, signal?: AbortSignal): Promise<{ narration: string }> {
    const started = Date.now();
    // A new conversation in a game already under way is told how it stood.
    const told = this.sessionId() ? input : carried(this.transcriptPath, input);
    return new Promise((resolve, reject) => {
      const child = spawn(this.claude, this.args(), { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"], env: dmEnv() });
      const rows: any[] = [];
      let err = "";
      const stop = () => child.kill("SIGTERM");
      signal?.addEventListener("abort", stop, { once: true });
      child.stderr.on("data", (d) => (err += d));
      createInterface({ input: child.stdout }).on("line", (line) => {
        let row: unknown;
        try {
          row = JSON.parse(line);
        } catch {
          return;
        }
        rows.push(row);
        onRow(row);
      });
      child.on("error", (e: NodeJS.ErrnoException) =>
        reject(new Error(e.code === "ENOENT" ? NOT_INSTALLED : `Could not start Claude Code (${this.claude}): ${e.message}`)));
      child.on("close", (code) => {
        signal?.removeEventListener("abort", stop);
        if (signal?.aborted) return reject(new Error("stopped"));
        const result = parseTurn(rows);
        if (!result) {
          const said = `${err}\n${rows.map((r) => JSON.stringify(r)).join("\n")}`;
          return reject(/not logged in|\/login|authenticat/i.test(said) ? new SignedOut(notSignedIn(this.claude))
            : new Error(`The DM did not answer (exit ${code}): ${said.trim().slice(-400)}`));
        }
        // A turn that failed keeps no conversation: the next resumes the last
        // that was told, and a first that failed leaves none to resume.
        if (result.signedOut || (result.error && !result.narration && /not logged in|\/login/i.test(result.error))) {
          return reject(new SignedOut(notSignedIn(this.claude)));
        }
        if (result.error && !result.narration) return reject(new Error(`The DM stopped: ${result.error}`));
        if (result.sessionId) writeFileSync(this.sessionPath, result.sessionId);
        appendFileSync(this.transcriptPath, JSON.stringify({
          at: new Date().toISOString(), input, narration: result.narration, ms: Date.now() - started,
          usage: result.usage, error: result.error,
        }) + "\n");
        resolve({ narration: result.narration });
      });
      child.stdin.end(told);
    });
  }

  // Asked before the first turn (`claude auth status`: 0 signed in, 1 not).
  // A Claude Code not there, or not answering, is left to the turn to say.
  signedOut(): Promise<string | null> {
    return new Promise((done) => {
      execFile(this.claude, ["auth", "status"], { cwd: this.cwd, timeout: 15_000 }, (e) =>
        done(e && !e.killed && typeof e.code === "number" ? notSignedIn(this.claude) : null));
    });
  }

  // Claude Code's own sign-in (`claude auth login`): it opens the browser
  // and finishes by itself once the player has signed in there, on the
  // address it listens on. The window starts it and waits, and never sees a
  // code or a credential; its prompt to paste a code is never answered.
  signIn(signal?: AbortSignal): Promise<boolean> {
    return new Promise((done) => {
      const child = spawn(this.claude, ["auth", "login"], { cwd: this.cwd, stdio: ["pipe", "ignore", "ignore"] });
      const stop = () => child.kill();
      const timer = setTimeout(stop, 10 * 60_000);
      signal?.addEventListener("abort", stop, { once: true });
      child.on("error", () => done(false));
      child.on("close", async () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        done(!signal?.aborted && (await this.signedOut()) === null);
      });
    });
  }
}

// The stream's closing `result` row carries the session id; the narration is
// every text block the DM wrote this turn, in order, including any written
// between tool calls, which the closing row alone would drop.
//
// Claude Code's own notices ("Not logged in · Please run /login") come as
// assistant rows of its own making (the model "<synthetic>"), never the DM's.
export function parseTurn(rows: any[]): { narration: string; sessionId?: string; error?: string; usage?: unknown; signedOut?: boolean } | null {
  const final = [...rows].reverse().find((r) => r?.type === "result");
  if (!final) return null;
  const texts = rows
    .filter((r) => r?.type === "assistant" && r.message?.model !== "<synthetic>")
    .flatMap((r) => (Array.isArray(r.message?.content) ? r.message.content : []))
    .filter((c: any) => c?.type === "text")
    .map((c: any) => String(c.text ?? "").trim())
    .filter(Boolean);
  return {
    narration: texts.length ? texts.join("\n\n") : final.is_error ? "" : String(final.result ?? ""),
    sessionId: final.session_id,
    error: final.is_error ? String(final.result ?? final.subtype ?? "error") : undefined,
    usage: final.usage,
    signedOut: rows.some((r) => r?.type === "assistant" && r.error === "authentication_failed") || undefined,
  };
}

// Where the installed `claude` is. An app opened from a desktop menu does
// not get the shell's PATH, so after PATH it asks the login shell, then
// looks where the installers put it.
// A new world takes minutes to make (new_world): the DM waits for it rather
// than give up on the call and make another.
export function dmEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...env, MCP_TOOL_TIMEOUT: env.MCP_TOOL_TIMEOUT ?? "600000" };
}

export function findClaude(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  const names = platform === "win32" ? ["claude.exe"] : ["claude"];
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) for (const n of names) if (isFile(join(dir, n))) return join(dir, n);
  // npm on Windows puts a claude.cmd on PATH, with the program in its package.
  if (platform === "win32") {
    for (const dir of [...dirs, ...(env.APPDATA ? [join(env.APPDATA, "npm")] : [])]) {
      const exe = join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      if (isFile(exe)) return exe;
    }
  }
  if (platform !== "win32" && env.SHELL) {
    try {
      const found = execFileSync(env.SHELL, ["-lic", "command -v claude"], { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] })
        .trim().split("\n").pop();
      if (found && isFile(found)) return found;
    } catch { /* no login shell answer */ }
  }
  const home = homedir();
  const known = [join(home, ".local", "bin"), join(home, ".claude", "local"), "/usr/local/bin", "/opt/homebrew/bin", join(home, ".npm-global", "bin")];
  for (const dir of known) for (const n of names) if (isFile(join(dir, n))) return join(dir, n);
  return names[0];
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
