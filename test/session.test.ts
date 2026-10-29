import { test } from "node:test";
import assert from "node:assert/strict";
import { OPENING, SLASH, Session, SignedOut, type Backend, type World } from "../src/core/session.ts";
import type { Board, GameEvent } from "../src/core/protocol.ts";
import { toolRows } from "./helpers.ts";

function world(boards: Board[]): World & { painted: string[] } {
  const painted: string[] = [];
  return {
    painted,
    board: async () => boards.length > 1 ? boards.shift()! : boards[0],
    paint: async (t) => { painted.push(t); return [[{ t }]]; },
    map: async () => "",
    atlas: async () => { throw new Error("no atlas"); },
    lore: async () => { throw new Error("no lore"); },
    character: async () => ({ callings: [], picks: 2, spread: { points: 72, min: 6, max: 15 } }),
    rollCharacter: async () => ({ abilities: {} }),
    rerollStat: async () => ({ abilities: {} }),
    makeCharacter: async () => ({ tell: "Yuno is made." }),
    bringCharacter: async () => ({ tell: "Yuno is brought." }),
    levelOptions: async () => ({ level: 2, picks: 1, abilities: [], scores: [] }),
    chooseLevel: async () => ({ tell: "At level 2 the player chose in the window: raised strength to 16." }),
    beginAgain: async () => ({ begun: "in the world as it stands" }),
  };
}

function backend(conversation: boolean, inputs: string[]): Backend {
  return {
    hasConversation: () => conversation,
    lastTurn: () => ({ input: "wait", narration: "Night falls." }),
    say: async (input, onRow) => {
      inputs.push(input);
      toolRows("transfer", {}, { from: "Ada", to: "Bo", coins: 2 }).forEach(onRow);
      return { narration: "The day turns." };
    },
  };
}

const day = (d: number): Board => ({ world: "w", you: "Ada", status: { day: d, phase: "morning" } });

test("a world nobody is in yet asks for a character in the window, says nothing to the DM, then tells it unseen", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  const s = new Session(backend(false, inputs), world([{ world: "w", make_character: true, error: "No character yet." }, day(1)]), (e) => events.push(e));
  await s.open();
  assert.deepEqual(inputs, [], "the DM is not asked to open before there is anyone");
  assert.equal(events.at(-1)?.type, "create");
  await s.begin("Yuno is made.");
  assert.deepEqual(inputs, [`Yuno is made.\n\n${OPENING}`]);
  assert.equal((events.at(-1) as any).input, "", "what the DM is told is not shown as the player's words");
});

test("a new conversation opens with the DM setting the scene", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  await new Session(backend(false, inputs), world([day(1)]), (e) => events.push(e)).open();
  assert.deepEqual(inputs, [OPENING]);
  assert.equal(events.at(-1)?.type, "turn");
  assert.equal((events.at(-1) as any).input, "", "the opening instruction is not the player's words");
});

test("an old one shows where the player left off, without asking the DM", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  const w = world([day(1)]);
  await new Session(backend(true, inputs), w, (e) => events.push(e)).open();
  assert.deepEqual(inputs, []);
  assert.deepEqual(w.painted, ["Night falls."]);
  assert.equal((events[0] as any).resumed, true);
});

test("a turn brings receipts, then the painted narration and a new day's banner", async () => {
  const events: GameEvent[] = [];
  const s = new Session(backend(true, []), world([day(1), day(2)]), (e) => events.push(e));
  await s.open();
  events.length = 0;
  await s.turn("sleep");
  assert.deepEqual(events.map((e) => e.type), ["activity", "receipt", "turn"]);
  const turn = events[2] as Extract<GameEvent, { type: "turn" }>;
  assert.equal(turn.newDay, "Day 2 · morning");
  assert.deepEqual(turn.paragraphs, [[{ t: "The day turns." }]]);
});

test("a turn that ends in a new world says so after the turn, for the shell to start afresh", async () => {
  const events: GameEvent[] = [];
  const fresh: Board = { world: "w2", error: "No character yet.", creation: [{ part: "Before anything", text: "Two realms." }] };
  const s = new Session(backend(true, []), world([day(1), fresh]), (e) => events.push(e));
  await s.open();
  events.length = 0;
  await s.turn("start over");
  assert.deepEqual(events.map((e) => e.type), ["activity", "receipt", "turn", "newWorld"]);
  assert.equal((events[3] as Extract<GameEvent, { type: "newWorld" }>).board.world, "w2");
});

test("a turn in the same world does not", async () => {
  const events: GameEvent[] = [];
  const s = new Session(backend(true, []), world([day(1), day(2)]), (e) => events.push(e));
  await s.open();
  await s.turn("sleep");
  assert.ok(!events.some((e) => e.type === "newWorld"));
});

const at = (town: string | null, extra: Partial<NonNullable<Board["status"]>> = {}): Board => ({
  world: "w", you: "Ada", status: { day: 1, setting: town ? { scene: "town", size: "town" } : { scene: "land" }, ...extra },
  scene: { town: town ?? "the road between Belsk and Mirova", people: [], things: [], wares: [], ways: [], beyond: [] },
});

function rotating(inputs: string[]): Backend {
  return { ...backend(true, inputs), rotate: () => { inputs.push("(rotated)"); } };
}

test("arrived in another settlement, the next turn begins a new conversation; the road, a fight or the same town does not", async () => {
  const inputs: string[] = [];
  const boards = [at("Belsk"), at("Belsk"), at(null), at("Mirova", { fight: 2 }), at("Mirova"), at("Mirova")];
  const s = new Session(rotating(inputs), world(boards), () => {});
  await s.open();
  for (const said of ["the market", "set out", "walk on", "fight", "find an inn"]) await s.turn(said);
  assert.deepEqual(inputs, ["the market", "set out", "walk on", "fight", "(rotated)", "find an inn"]);
});

test("a window opened on the road takes the first settlement it comes to as its conversation's, and so does one opened in town", async () => {
  const inputs: string[] = [];
  const s = new Session(rotating(inputs), world([at(null), at("Mirova"), at("Mirova")]), () => {});
  await s.open();
  for (const said of ["walk on", "find an inn"]) await s.turn(said);
  const again = new Session(rotating(inputs), world([at("Mirova"), at("Mirova")]), () => {});
  await again.open();
  await again.turn("sleep");
  assert.deepEqual(inputs, ["walk on", "find an inn", "sleep"]);
});

test("after a stopped turn, the next looks at the world first, and a new one is not spoken to from the old", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  let fail = true;
  const b: Backend = { ...backend(true, inputs), say: async (input, onRow) => {
    inputs.push(input);
    if (fail) { fail = false; throw new Error("stopped"); }
    return { narration: "ok" };
  } };
  const fresh: Board = { world: "w2", error: "No character yet." };
  const s = new Session(b, world([day(1), fresh]), (e) => events.push(e));
  await s.open();
  await s.turn("make a new world");
  events.length = 0;
  await s.turn("hello?");
  assert.deepEqual(inputs, ["make a new world"], "nothing is said to the old conversation");
  assert.deepEqual(events.map((e) => e.type), ["newWorld"]);
});

test("a turn that brings a new level asks for its choice in the window, and the DM hears of it with the next words, unseen", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  const s = new Session(backend(true, inputs), world([day(1), { ...day(1), level_up: 1 }, day(1)]), (e) => events.push(e));
  await s.open();
  await s.turn("I fight the wolf");
  assert.equal(events.at(-1)?.type, "level");
  assert.equal(events.at(-2)?.type, "turn");
  const out = await s.chooseLevel([{ score: "strength" }]);
  assert.match(out.tell ?? "", /raised strength/);
  await s.turn("I walk on");
  assert.equal(inputs.at(-1), "At level 2 the player chose in the window: raised strength to 16.\n\nI walk on");
  assert.equal((events.findLast((e) => e.type === "turn") as any).input, "I walk on", "the player sees only their own words");
  await s.turn("and on");
  assert.equal(inputs.at(-1), "and on", "told once");
});

test("a choice made while the DM is still answering waits for the turn after", async () => {
  const inputs: string[] = [];
  let s!: Session;
  const slow: Backend = {
    hasConversation: () => true,
    lastTurn: () => null,
    say: async (input) => {
      inputs.push(input);
      if (inputs.length === 1) await s.chooseLevel([{ score: "strength" }]);
      return { narration: "" };
    },
  };
  s = new Session(slow, world([day(1)]), () => {});
  await s.turn("I fight");
  assert.equal(inputs[0], "I fight");
  await s.turn("I rest");
  assert.match(inputs[1], /^At level 2 the player chose in the window: raised strength to 16\.\n\nI rest$/);
});

test("with no turns left the DM is not spoken to, unless the world says more have come since", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  const spent: Board = { world: "w", you: "Ada", status: { day: 1, turns: { left: 0, guest: true } } };
  const kept: Board = { world: "w", you: "Ada", status: { day: 1, turns: { left: 50 } } };
  const boards = [spent, spent, kept, kept]; // opening, the first look again, the second (kept by then), after the turn
  const s = new Session(backend(true, inputs), world(boards), (e) => events.push(e));
  await s.open();
  await s.turn("I walk on.");
  assert.deepEqual(inputs, [], "nothing said to the DM");
  assert.equal(events.at(-1)?.type, "spent");
  await s.turn("I walk on.");
  assert.deepEqual(inputs, ["I walk on."], "the run kept meanwhile: the turn goes ahead");
  assert.equal(events.at(-1)?.type, "turn");
});

test("a character made with no turns left is told to the DM with the player's next words, once there are turns", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  const spent: Board = { world: "w", you: "Ada", status: { day: 1, turns: { left: 0 } } };
  const more: Board = { world: "w", you: "Ada", status: { day: 2, turns: { left: 30 } } };
  const boards = [{ world: "w", make_character: true, error: "No character yet." }, spent, spent, more, more];
  const s = new Session(backend(true, inputs), world(boards), (e) => events.push(e));
  await s.open();
  await s.begin("Ada is made.");
  assert.deepEqual(inputs, [], "nothing said to the DM with none left");
  assert.equal(events.at(-1)?.type, "spent");
  await s.turn("I look about.");
  assert.deepEqual(inputs, ["Ada is made.\n\nI look about."]);
});

test("a DM whose program isn't signed in is not spoken to: the window asks for its sign-in, then the story begins", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  let signedIn = false;
  const b: Backend = { ...backend(false, inputs), signedOut: async () => (signedIn ? null : "Claude Code is not signed in."), signIn: async () => (signedIn = true) };
  const s = new Session(b, world([day(1)]), (e) => events.push(e));
  await s.open();
  assert.deepEqual(inputs, [], "nothing goes to a DM that can't answer");
  assert.deepEqual(events.at(-1), { type: "signIn", how: "Claude Code is not signed in.", canSignIn: true });
  assert.equal(await s.signIn(), true);
  for (let i = 0; i < 20 && !inputs.length; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(inputs, [OPENING], "signed in, the DM sets the scene");
});

test("words starting with / are not sent: they would be the DM program's own commands", async () => {
  const inputs: string[] = [];
  const events: GameEvent[] = [];
  const s = new Session(backend(true, inputs), world([day(1)]), (e) => events.push(e));
  await s.open();
  await s.turn("/login");
  await s.turn("  /clear");
  assert.deepEqual(inputs, []);
  assert.deepEqual(events.slice(-2), [{ type: "notice", text: SLASH }, { type: "notice", text: SLASH }]);
  await s.turn("I say \"/ is a slash\".");
  assert.equal(inputs.length, 1, "a slash later on is only words");
});

test("a DM signed out in the middle of play asks for its sign-in rather than failing the turn", async () => {
  const events: GameEvent[] = [];
  const b: Backend = { ...backend(true, []), say: async () => { throw new SignedOut("Codex is not signed in."); } };
  const s = new Session(b, world([day(1)]), (e) => events.push(e));
  await s.open();
  await s.turn("I wait.");
  assert.deepEqual(events.at(-1), { type: "signIn", how: "Codex is not signed in.", canSignIn: false });
});

test("signed in twice over, before the first check has answered, the scene is set once", async () => {
  const inputs: string[] = [];
  const b: Backend = { ...backend(false, inputs), signedOut: () => new Promise((r) => setTimeout(() => r(null), 20)) };
  const s = new Session(b, world([day(1)]), () => {});
  await Promise.all([s.recheck(), s.recheck(), s.open()]);
  for (let i = 0; i < 20 && !inputs.length; i++) await new Promise((r) => setTimeout(r, 10));
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(inputs, [OPENING]);
});
