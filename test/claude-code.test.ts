import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ClaudeCodeBackend, NOT_SIGNED_IN, dmEnv, findClaude, parseTurn } from "../src/backends/claude-code.ts";
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

test("a signed-out Claude Code is told plainly", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hc-"));
  const b = new ClaudeCodeBackend(options(dir, fakeClaude([resultRow({ is_error: true, result: "Not logged in · Please run /login" })], dir)));
  await assert.rejects(b.say("hi", () => {}), { message: NOT_SIGNED_IN });
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
