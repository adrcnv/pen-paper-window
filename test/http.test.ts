import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Account, connect, HttpWorld, news } from "../src/world/http.ts";

// A world server as fetch sees it: each URL's answer, and what was asked.
const real = globalThis.fetch;
function serve(routes: Record<string, [number, unknown]>, heard: { auth?: string; body?: string }[] = []): string[] {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    asked.push(`${init?.method ?? "GET"} ${path}`);
    heard.push({ auth: (init?.headers as Record<string, string> | undefined)?.authorization, body: init?.body as string | undefined });
    const [status, body] = routes[path] ?? [404, { error: "not here" }];
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return asked;
}
afterEach(() => { globalThis.fetch = real; });

const KEY = "k".repeat(43);
const NEW = "n".repeat(43);

test("a window with a key plays it", async () => {
  serve({ [`/client/${KEY}/board`]: [200, { world: "w" }] });
  const kept: string[] = [];
  const out = await connect("http://127.0.0.1:8742", KEY, (k) => kept.push(k));
  assert.deepEqual([out.board, out.ended, kept], [{ world: "w" }, false, []]);
});

test("a window with no key is given a guest's, keeps it and plays it; one whose run has ended is told so", async () => {
  const asked = serve({ "/guest": [200, { key: NEW, world: "w", kept_for_hours: 24 }], [`/client/${NEW}/board`]: [200, { world: "new" }] });
  const kept: string[] = [];
  const first = await connect("http://127.0.0.1:8742/", "", (k) => kept.push(k));
  assert.deepEqual([first.board, first.ended, kept], [{ world: "new" }, false, [NEW]]);
  assert.deepEqual(asked, ["GET /client/board", "POST /guest", `GET /client/${NEW}/board`]);
  const again = await connect("http://127.0.0.1:8742", KEY, () => {});
  assert.equal(again.ended, true);
});

test("a server with no guests, or none left today, says why; one that fails otherwise is not asked for a guest", async () => {
  serve({});
  await assert.rejects(connect("http://127.0.0.1:8742", KEY, () => {}), /said 404/);
  serve({ "/guest": [429, { error: "guest play is full for today; come back tomorrow" }] });
  await assert.rejects(connect("http://127.0.0.1:8742", "", () => {}), /full for today/);
  const asked = serve({ "/client/board": [500, { error: "crashed" }] });
  await assert.rejects(connect("http://127.0.0.1:8742", "", () => {}), /said 500/);
  assert.deepEqual(asked, ["GET /client/board"]);
});

const DEVICE = "d".repeat(43);
const RUN = "0123456789abcdef01234567";

test("a signed-in window lists its account's runs, starts one, and plays one under its own key", async () => {
  const run = { run: RUN, world: "w", created_at: 1, used_at: null, character: null };
  const asked = serve({ [`/client/${DEVICE}/runs`]: [200, { runs: [run], most: 5 }], [`/client/${DEVICE}/${RUN}/board`]: [200, { world: "w" }] });
  assert.deepEqual(await Account.runs("http://127.0.0.1:8742/", DEVICE), { runs: [run], most: 5 });
  assert.deepEqual(await Account.newRun("http://127.0.0.1:8742", DEVICE), { runs: [run], most: 5 });
  const world = new HttpWorld("http://127.0.0.1:8742", `${DEVICE}/${RUN}`);
  assert.deepEqual(await world.board(), { world: "w" });
  assert.equal(world.mcpUrl, `http://127.0.0.1:8742/mcp/${DEVICE}/${RUN}`);
  assert.deepEqual(asked, [`GET /client/${DEVICE}/runs`, `POST /client/${DEVICE}/runs`, `GET /client/${DEVICE}/${RUN}/board`]);
});

test("signing in pairs with the guest's key it holds, waits for the yes, and collects the window's key once", async () => {
  const heard: { auth?: string; body?: string }[] = [];
  const pairing = { code: "ABCD2345", device_code: "s".repeat(43), url: "https://site.example/link?code=ABCD2345", interval: 3, expires_in: 900 };
  serve({ "/device": [200, pairing], "/device/claim": [202, { waiting: true }] }, heard);
  assert.deepEqual(await Account.pair("http://127.0.0.1:8742", KEY), pairing);
  assert.equal(heard[0].auth, `Bearer ${KEY}`);
  assert.equal(await Account.claim("http://127.0.0.1:8742", pairing.device_code), null);
  assert.deepEqual(JSON.parse(heard[1].body!), { device_code: pairing.device_code });
  serve({ "/device/claim": [200, { key: DEVICE }] });
  assert.equal(await Account.claim("http://127.0.0.1:8742", pairing.device_code), DEVICE);
  serve({ "/device/claim": [404, { error: "this sign-in has run out; start again" }] });
  await assert.rejects(Account.claim("http://127.0.0.1:8742", pairing.device_code), /run out/);
  const none: { auth?: string }[] = [];
  serve({ "/device": [200, pairing] }, none);
  await Account.pair("http://127.0.0.1:8742", "");
  assert.equal(none[0].auth, undefined, "a window with no guest's key sends none");
});

test("a signed-in window lists today's worlds and starts a run in the one chosen", async () => {
  const heard: { auth?: string; body?: string }[] = [];
  const card = { id: "classic-1", kind: "classic", made_at: 1, callings: ["Fighter"] };
  serve({ [`/client/${DEVICE}/worlds`]: [200, { worlds: [card] }], [`/client/${DEVICE}/runs`]: [200, { run: RUN }] }, heard);
  assert.deepEqual(await Account.worlds("http://127.0.0.1:8742", DEVICE), [card]);
  await Account.newRun("http://127.0.0.1:8742", DEVICE, "classic-1");
  assert.deepEqual(JSON.parse(heard[1].body!), { world: "classic-1" });
  await Account.newRun("http://127.0.0.1:8742", DEVICE);
  assert.deepEqual(JSON.parse(heard[2].body!), {}, "no world named: the story world");
});

test("a supporter's window asks for a world of their own, and hears how their own stand, or why not", async () => {
  const heard: { auth?: string; body?: string }[] = [];
  const own = { making: { state: "waiting", asked_at: 1 }, left: 2 };
  serve({ [`/client/${DEVICE}/worlds`]: [200, { own }] }, heard);
  const wish = { premise: "A sea that sings.", callings: [], peoples: [{ name: "Merrow", line: "" }], size: "small" as const };
  assert.deepEqual(await Account.askWorld("http://127.0.0.1:8742", DEVICE, wish), own);
  assert.deepEqual(JSON.parse(heard[0].body!), wish);
  serve({ [`/client/${DEVICE}/worlds`]: [409, { error: "a world of yours is being made already; ask for the next once it's done" }] });
  await assert.rejects(Account.askWorld("http://127.0.0.1:8742", DEVICE, wish), /being made already/);
});

test("the news is asked for with the window's version and no key, before anything is played", async () => {
  const heard: { auth?: string }[] = [];
  const told = { news: [{ id: "n1", title: "New", text: "Words." }], window: { version: "0.2.0" } };
  let url = "";
  globalThis.fetch = (async (u: string | URL, init?: RequestInit) => {
    url = String(u);
    heard.push({ auth: (init?.headers as Record<string, string> | undefined)?.authorization });
    return new Response(JSON.stringify(told), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.deepEqual(await news("http://127.0.0.1:8742/", "0.1.0"), told);
  assert.equal(url, "http://127.0.0.1:8742/news?window=0.1.0");
  assert.deepEqual(heard, [{ auth: undefined }]);
});
