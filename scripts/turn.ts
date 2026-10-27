// One turn without a window, for checking the wiring end to end:
//   node scripts/turn.ts <state dir> [words]     (HARNESS_SERVER, HARNESS_DM, DM_MODEL, CODEX_PATH… as in the app)
// With no words it opens the conversation (or shows where it left off).
import { ClaudeCodeBackend } from "../src/backends/claude-code.ts";
import { CodexBackend } from "../src/backends/codex.ts";
import { Session } from "../src/core/session.ts";
import { HttpWorld } from "../src/world/http.ts";
import type { GameEvent } from "../src/core/protocol.ts";

const [stateDir, ...words] = process.argv.slice(2);
if (!stateDir) throw new Error("usage: node scripts/turn.ts <state dir> [words]");
const world = new HttpWorld(process.env.HARNESS_SERVER ?? "http://127.0.0.1:8742", process.env.HARNESS_SECRET ?? "");
const common = { stateDir, mcpUrl: world.mcpUrl, systemPrompt: await world.rulebook() };
const backend = process.env.HARNESS_DM === "codex"
  ? new CodexBackend({ ...common, model: process.env.CODEX_MODEL ?? "", effort: process.env.CODEX_EFFORT ?? "", codexPath: process.env.CODEX_PATH })
  : new ClaudeCodeBackend({ ...common, model: process.env.DM_MODEL ?? "claude-sonnet-5-5", effort: process.env.HARNESS_DM_EFFORT ?? "high" });
const show = (e: GameEvent) => {
  if (e.type === "turn") {
    console.log(JSON.stringify({ newDay: e.newDay, resumed: e.resumed, status: e.board.status }));
    for (const p of e.paragraphs) console.log(p.map((r) => (r.e ? `[${r.e}:${r.t}]` : r.q ? `{${r.q}:${r.t}}` : r.t)).join(""));
  } else console.log(JSON.stringify(e));
};
const session = new Session(backend, world, show);
if (words.length) {
  session.board = await world.board();
  await session.turn(words.join(" "));
} else await session.open();
