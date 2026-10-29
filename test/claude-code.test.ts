import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ClaudeCodeBackend, NOT_INSTALLED, dmEnv, findClaude, notSignedIn, parseTurn } from "../src/backends/claude-code.ts";
import { SignedOut } from "../src/core/session.ts";
import { resultRow, textRow, toolRows } from "./helpers.ts";

// The stand-in is a shell script, which Windows can't run as a program; the
// window itself runs the real claude.exe or codex.exe there.
const SHELL_ONLY = process.platform === "win32" && "the stand-in is a shell script";

// A stand-in `claude` that prints its arguments, its stdin and the rows a
// test gives it, so a turn can run without a model.
function fakeClaude(rows: unknown[], dir: string): string {
  const path = join(dir, "claude");
  const out = rows.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(path, `#!/bin/sh
printf '%s\\n' "$@" > "${dir}/args.txt"
cat > "${dir}/stdin.txt"
cat <<'ROWS'
${out}
ROWS
`);
  chmodSync(path, 0o755);
  return path;
}

const options = (dir: string, claudePath: string) => ({
  stateDir: join(dir, "state"), mcpUrl: "http://127.0.0.1:8742/mcp", systemPrompt: "RULEBOOK", model: "claude-sonnet-5-5", effort: "high", claudePath,
});

test("the DM runs locked down: no built-in tools, only the world's, none of the user's settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const b = new ClaudeCodeBackend(options(dir, "/bin/true"));
  const args = b.args();
  const after = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(after("--tools"), "");
  assert.equal(after("--allowedTools"), "mcp__harness-dm__*");
  assert.ok(args.includes("--strict-mcp-config"));
  assert.equal(after("--setting-sources"), "project");
  assert.equal(after("--system-prompt"), "RULEBOOK");
  assert.ok(!args.includes("--resume"));
  const cfg = JSON.parse(readFileSync(after("--mcp-config"), "utf8"));
  assert.deepEqual(cfg, { mcpServers: { "harness-dm": { type: "http", url: "http://127.0.0.1:8742/mcp" } } });
});

test("a turn streams rows, keeps the session to resume, and the player's words go in on stdin", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const rows = [...toolRows("look", {}, { here: {} }), textRow("You stand in the rain."), textRow("A dog barks."), resultRow()];
  const b = new ClaudeCodeBackend(options(dir, fakeClaude(rows, dir)));
  const seen: unknown[] = [];
  const { narration } = await b.say("--help me", (r) => seen.push(r));
  assert.equal(narration, "You stand in the rain.\n\nA dog barks.");
  assert.equal(seen.length, rows.length);
  assert.equal(readFileSync(join(dir, "stdin.txt"), "utf8"), "--help me");
  assert.ok(!readFileSync(join(dir, "args.txt"), "utf8").includes("--help me"));
  assert.equal(b.sessionId(), "sess-1");
  assert.ok(b.args().includes("--resume"));
  assert.deepEqual(b.lastTurn() && { input: b.lastTurn()!.input, narration: b.lastTurn()!.narration }, { input: "--help me", narration });
});

test("a signed-out Claude Code is told plainly, with the command that signs in the program the window runs", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const claude = fakeClaude([resultRow({ is_error: true, result: "Not logged in · Please run /login" })], dir);
  await assert.rejects(new ClaudeCodeBackend(options(dir, claude)).say("hi", () => {}), { message: notSignedIn(claude) });
});

test("the sign-in command runs where the window found Claude Code, off the PATH or not", () => {
  assert.match(notSignedIn("C:\\Users\\Ann Lee\\.local\\bin\\claude.exe", "win32"),
    /In PowerShell, run & "C:\\Users\\Ann Lee\\.local\\bin\\claude\.exe" auth login, sign in/);
  assert.match(notSignedIn("/home/ann/.local/bin/claude", "linux"), /In a terminal, run \/home\/ann\/\.local\/bin\/claude auth login, sign in/);
  assert.doesNotMatch(notSignedIn("claude", "darwin"), /\/login/, "never /login, which the window can't run");
});

test("a Claude Code that isn't there is told plainly, the Claude app being no stand-in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const b = new ClaudeCodeBackend(options(dir, join(dir, "no-such-claude")));
  await assert.rejects(b.say("hi", () => {}), { message: NOT_INSTALLED });
});

test("the closing row alone stands in when the DM wrote no text blocks", () => {
  assert.deepEqual(parseTurn([resultRow({ result: "Fine." })])?.narration, "Fine.");
  assert.equal(parseTurn([textRow("x")]), null);
});

test("the DM waits minutes for a tool call, unless the player said otherwise", () => {
  assert.equal(dmEnv({}).MCP_TOOL_TIMEOUT, "600000");
  assert.equal(dmEnv({ MCP_TOOL_TIMEOUT: "5000" }).MCP_TOOL_TIMEOUT, "5000");
});

test("the DM retuned from the window takes its new model and effort on the next turn", () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const b = new ClaudeCodeBackend(options(dir, "/bin/true"));
  b.retune("opus", "max");
  const args = b.args();
  assert.equal(args[args.indexOf("--model") + 1], "opus");
  assert.equal(args[args.indexOf("--effort") + 1], "max");
});

test("on Windows, a Claude Code npm installed is found in its package, by PATH or by npm's own folder", () => {
  const appdata = mkdtempSync(join(tmpdir(), "appdata-"));
  const npm = join(appdata, "npm");
  const exe = join(npm, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, "");
  writeFileSync(join(npm, "claude.cmd"), "");
  assert.equal(findClaude({ PATH: npm }, "win32"), exe, "never the .cmd, which would need a shell");
  assert.equal(findClaude({ PATH: "", APPDATA: appdata }, "win32"), exe);
});

// As Claude Code 2.1 answers a turn with nobody signed in: its own notice,
// as an assistant row of its own making, and an error to close.
const signedOutRows = [
  { type: "system", subtype: "init", session_id: "s-out" },
  { type: "assistant", message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "Not logged in · Please run /login" }] }, error: "authentication_failed" },
  resultRow({ is_error: true, result: "Not logged in · Please run /login", session_id: "s-out" }),
];

test("Claude Code's own notices are never the DM's narration", () => {
  assert.deepEqual(parseTurn(signedOutRows), { narration: "", sessionId: "s-out", error: "Not logged in · Please run /login", usage: undefined, signedOut: true });
});

test("a turn with nobody signed in asks for the sign-in, and keeps no conversation to resume", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const claude = fakeClaude(signedOutRows, dir);
  const b = new ClaudeCodeBackend(options(dir, claude));
  await assert.rejects(b.say("hi", () => {}), (e) => e instanceof SignedOut && e.message === notSignedIn(claude));
  assert.equal(b.hasConversation(), false, "the failed turn is not resumed next time");
  assert.equal(existsSync(join(dir, "state", "transcript.jsonl")), false);
});

test("the window asks Claude Code whether it is signed in, and starts its own sign-in", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const claude = join(dir, "claude");
  writeFileSync(claude, `#!/bin/sh
[ "$1" = auth ] || exit 3
case "$2" in
  status) [ -f "${dir}/in" ] && exit 0 || exit 1 ;;
  login) printf '%s\n' "$@" > "${dir}/login-args.txt"; touch "${dir}/in" ;;
esac
`);
  chmodSync(claude, 0o755);
  const b = new ClaudeCodeBackend(options(dir, claude));
  assert.equal(await b.signedOut(), notSignedIn(claude));
  assert.equal(await b.signIn(), true);
  assert.equal(readFileSync(join(dir, "login-args.txt"), "utf8"), "auth\nlogin\n", "Claude Code's own sign-in, nothing passed to it");
  assert.equal(await b.signedOut(), null);
  assert.equal(await new ClaudeCodeBackend(options(dir, join(dir, "gone"))).signedOut(), null, "one not there is left to the turn to say");
});

test("a conversation begun anew is told the last turns on record before the player's words, which alone go on record", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const b = new ClaudeCodeBackend(options(dir, fakeClaude([textRow("The gate of Mirova."), resultRow()], dir)));
  for (const words of ["wake", "eat", "set out", "walk to the gate"]) await b.say(words, () => {});
  b.rotate();
  assert.ok(!b.args().includes("--resume"));
  assert.equal(b.hasConversation(), true, "the window shows where the player left off, and asks the DM nothing");
  await b.say("go in", () => {});
  const told = readFileSync(join(dir, "stdin.txt"), "utf8");
  assert.ok(!told.includes("wake"), "only the last few turns");
  assert.ok(told.includes("The player: eat\n\nYou: The gate of Mirova.") && told.includes("The player: walk to the gate"));
  assert.ok(told.endsWith("\n\n---\n\ngo in"));
  assert.equal(b.lastTurn()?.input, "go in");
  await b.say("look about", () => {});
  assert.equal(readFileSync(join(dir, "stdin.txt"), "utf8"), "look about", "then the new conversation goes on as any other");
  assert.ok(b.args().includes("--resume"));
});
