import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CodexBackend, CodexRows, NOT_SIGNED_IN, UNSUPPORTED, findCodex, parseTurn } from "../src/backends/codex.ts";
import { SignedOut } from "../src/core/session.ts";
import { StreamReader } from "../src/core/stream.ts";
import type { GameEvent, Receipt } from "../src/core/protocol.ts";

// The stand-in is a shell script, which Windows can't run as a program; the
// window itself runs the real claude.exe or codex.exe there.
const SHELL_ONLY = process.platform === "win32" && "the stand-in is a shell script";

// A stand-in `codex`: `login status` answers as the test says; `exec`
// prints its arguments, its stdin and the events a test gives it, so a turn
// can run without a model.
function fakeCodex(events: unknown[], dir: string, opts: { signedIn?: boolean; stderr?: string } = {}): string {
  const path = join(dir, "codex");
  const out = events.map((e) => JSON.stringify(e)).join("\n");
  writeFileSync(path, `#!/bin/sh
if [ "$1" = login ]; then ${opts.signedIn === false ? "echo 'Not logged in'; exit 1" : "echo 'Logged in using ChatGPT'; exit 0"}; fi
printf '%s\\n' "$@" > "${dir}/args.txt"
cat > "${dir}/stdin.txt"
${opts.stderr ? `echo '${opts.stderr}' >&2; exit 1` : ""}
cat <<'EVENTS'
${out}
EVENTS
`);
  chmodSync(path, 0o755);
  return path;
}

const options = (dir: string, codexPath: string, extra = {}) => ({
  stateDir: join(dir, "state"), mcpUrl: "http://127.0.0.1:8742/mcp", systemPrompt: "RULEBOOK", model: "", effort: "", codexPath, ...extra,
});

let n = 0;
function toolEvents(tool: string, args: object, result: object): unknown[] {
  const item = { id: `item_${++n}`, type: "mcp_tool_call", server: "harness-dm", tool, arguments: args };
  return [
    { type: "item.started", item: { ...item, result: null, error: null, status: "in_progress" } },
    { type: "item.completed", item: { ...item, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }, error: null, status: "completed" } },
  ];
}
const said = (text: string) => ({ type: "item.completed", item: { id: `item_${++n}`, type: "agent_message", text } });
const turn = (...middle: unknown[]) => [
  { type: "thread.started", thread_id: "thread-1" },
  { type: "item.completed", item: { id: "item_0", type: "error", message: "Model metadata for `x` not found." } },
  { type: "turn.started" },
  { type: "error", message: "Reconnecting... 1/5" },
  ...middle,
  { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
];

test("the DM runs locked down: no shell or other built-in tools, only the world's, none of the user's settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-"));
  const b = new CodexBackend(options(dir, "/bin/true"));
  const args = b.args();
  const set = new Map(args.flatMap((a, i) => (args[i - 1] === "-c" ? [a.split(/=(.*)/s).slice(0, 2) as [string, string]] : [])));
  assert.deepEqual(args.slice(0, 6), ["exec", "--json", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--strict-config"]);
  assert.equal(args.at(-1), "-", "the player's words come on stdin");
  for (const f of ["shell_tool", "unified_exec", "browser_use", "computer_use", "image_generation", "multi_agent", "plugins", "apps", "hooks"]) {
    assert.equal(set.get(`features.${f}`), "false", f);
  }
  assert.equal(set.get("sandbox_mode"), '"read-only"');
  assert.equal(set.get("approval_policy"), '"never"');
  assert.equal(set.get("web_search"), '"disabled"');
  assert.equal(set.get("project_doc_max_bytes"), "0");
  assert.equal(set.get("history.persistence"), '"none"');
  assert.equal(set.get("mcp_servers.harness-dm.url"), '"http://127.0.0.1:8742/mcp"');
  assert.equal(set.get("mcp_servers.harness-dm.tool_timeout_sec"), "600");
  assert.equal(readFileSync(JSON.parse(set.get("model_instructions_file")!), "utf8"), "RULEBOOK");
  assert.ok(!set.has("model") && !set.has("model_reasoning_effort"), "the player's own defaults unless the window was told otherwise");
  const told = new CodexBackend(options(mkdtempSync(join(tmpdir(), "hx-")), "/bin/true", { model: "gpt-5.5", effort: "high" }));
  assert.ok(told.args().includes('model="gpt-5.5"') && told.args().includes('model_reasoning_effort="high"'));
});

test("a turn streams the rows the window reads, keeps the thread to resume, and the player's words go in on stdin", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-"));
  const events = turn(
    ...toolEvents("roll", { ability: "charisma", dc: 12 }, { who: "Ken", ability: "charisma", roll: 12, total: 13, dc: 12, success: true }),
    said("The guard waves you through."), said("Rain starts."),
  );
  const b = new CodexBackend(options(dir, fakeCodex(events, dir)));
  const reader = new StreamReader("Ken");
  const out: GameEvent[] = [];
  const { narration } = await b.say("--help me", (row) => out.push(...reader.feed(row)));
  assert.equal(narration, "The guard waves you through.\n\nRain starts.");
  const receipts = out.flatMap((e) => (e.type === "receipt" ? [e.receipt] : [])) as Receipt[];
  assert.deepEqual(receipts.map((r) => [r.kind, (r as any).success]), [["check", true]]);
  assert.ok(out.some((e) => e.type === "activity"));
  assert.equal(readFileSync(join(dir, "stdin.txt"), "utf8"), "--help me");
  assert.ok(!readFileSync(join(dir, "args.txt"), "utf8").includes("--help me"));
  assert.equal(b.sessionId(), "thread-1");
  assert.deepEqual(b.args().slice(0, 3), ["exec", "resume", "thread-1"]);
  assert.equal(b.lastTurn()?.narration, narration);
});

test("a thread begun anew is told the last turns on record before the player's words, which alone go on record", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-"));
  const b = new CodexBackend(options(dir, fakeCodex(turn(said("The gate of Mirova.")), dir)));
  await b.say("walk to the gate", () => {});
  b.rotate();
  assert.deepEqual(b.args().slice(0, 2), ["exec", "--json"]);
  await b.say("go in", () => {});
  const told = readFileSync(join(dir, "stdin.txt"), "utf8");
  assert.ok(told.includes("The player: walk to the gate\n\nYou: The gate of Mirova.") && told.endsWith("\n\n---\n\ngo in"));
  assert.equal(b.lastTurn()?.input, "go in");
});

test("a signed-out Codex is told plainly, before the first turn and when a turn is refused", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-"));
  await assert.rejects(new CodexBackend(options(dir, fakeCodex([], dir, { signedIn: false }))).say("hi", () => {}), { message: NOT_SIGNED_IN });
  const refused = [{ type: "thread.started", thread_id: "t" }, { type: "turn.failed", error: { message: "unexpected status 401 Unauthorized: Missing bearer" } }];
  const dir2 = mkdtempSync(join(tmpdir(), "hx-"));
  const b = new CodexBackend(options(dir2, fakeCodex(refused, dir2)));
  await assert.rejects(b.say("hi", () => {}), { message: NOT_SIGNED_IN });
  assert.equal(b.sessionId(), null, "a failed turn keeps no thread");
});

test("a Codex that does not know a locking setting stops the turn rather than run without it", { skip: SHELL_ONLY }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-"));
  const b = new CodexBackend(options(dir, fakeCodex([], dir, { stderr: "Error loading config.toml: unknown configuration field `features.shell_tool` in -c/--config override" })));
  await assert.rejects(b.say("hi", () => {}), { message: UNSUPPORTED });
  assert.ok(!existsSync(join(dir, "state", "dm_session")));
});

test("Codex's warnings and retries are not failures; a tool result arriving alone still comes with its call", () => {
  assert.equal(parseTurn(turn(said("Fine.")))?.error, undefined);
  assert.equal(parseTurn([{ type: "turn.started" }]), null);
  const rows = new CodexRows().of(toolEvents("look", {}, { here: {} })[1]);
  assert.deepEqual(rows.map((r: any) => r.message.content[0].type), ["tool_use", "tool_result"]);
  const parsed = new CodexRows().of({ type: "item.started", item: { id: "x", type: "mcp_tool_call", tool: "move", arguments: '{"to":"place:3"}' } });
  assert.deepEqual((parsed[0] as any).message.content[0].input, { to: "place:3" });
});

test("on Windows, a Codex npm installed is found in its package, by PATH or by npm's own folder", () => {
  const appdata = mkdtempSync(join(tmpdir(), "appdata-"));
  const npm = join(appdata, "npm");
  const exe = join(npm, "node_modules", "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
  mkdirSync(dirname(exe), { recursive: true });
  writeFileSync(exe, "");
  writeFileSync(join(npm, "codex.cmd"), "");
  assert.equal(findCodex({ PATH: npm }, "win32", "x64"), exe, "never the .cmd, which would need a shell");
  assert.equal(findCodex({ PATH: "", APPDATA: appdata }, "win32", "x64"), exe, "opened from the Start menu without npm's folder on PATH");
  assert.equal(findCodex({ PATH: npm }, "win32", "arm64"), "codex.exe", "another machine's package is not this one's");
});

test("a Codex that isn't there is said to be missing, not asked to sign in", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hx-"));
  const b = new CodexBackend(options(dir, join(dir, "no-such-codex")));
  assert.equal(await b.signedOut(), null, "left to the turn to say");
  await assert.rejects(b.say("hi", () => {}), (e) => !(e instanceof SignedOut) && /is it installed\?/.test((e as Error).message));
});
