import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamReader } from "../src/core/stream.ts";
import type { GameEvent, Receipt } from "../src/core/protocol.ts";
import { textRow, toolRows } from "./helpers.ts";

const receipts = (r: StreamReader, rows: unknown[]): Receipt[] =>
  rows.flatMap((row) => r.feed(row)).flatMap((e: GameEvent) => (e.type === "receipt" ? [e.receipt] : []));

test("a failed check with foes striking back, from a real fight", () => {
  const r = new StreamReader("Gerd Ulfsson");
  const [check] = receipts(r, toolRows("roll", { ability: "charisma", dc: 11 }, {
    who: "Gerd Ulfsson", ability: "charisma", roll: 7, total: 6, dc: 11, success: false, why: "pressure Kenric",
    foes_strike: ["Kenric Wynter (person:342): 15 against your guard of 15 — hits for 3 (you are at 21/24)"],
  }));
  assert.deepEqual(check, {
    kind: "check", who: null, ability: "charisma", roll: 7, mod: -1, total: 6, against: "DC 11", success: false,
    critical: false, fumble: false, why: "pressure Kenric",
    blows: [{ text: "Kenric Wynter: 15 against your guard of 15 — hits for 3 (you are at 21/24)", hit: true }],
  });
});

test("the edge the player's own play earned stands apart from the score, and says when it made the success", () => {
  const r = new StreamReader("Ken");
  const [made, plain, blow] = receipts(r, [
    ...toolRows("roll", { ability: "charisma", dc: 15, edge: 3 }, { who: "Ken", ability: "charisma", roll: 12, total: 14, for_play: "+3", dc: 15, success: false }),
    ...toolRows("roll", { ability: "charisma", dc: 12, edge: 2 }, { who: "Ken", ability: "charisma", roll: 12, total: 15, for_play: "+2", dc: 12, success: true }),
    ...toolRows("roll", { with: "item:4", against: "person:9", edge: 1 }, {
      who: "Ken", with: "an iron sword", runs_on: "strength", roll: 10, total: 13, for_play: "+1", against: "Hob", their_guard: 13, success: true }),
  ]);
  assert.deepEqual([(made as any).mod, (made as any).edge, (made as any).turned], [-1, 3, undefined]);
  assert.deepEqual([(plain as any).edge, (plain as any).turned], [2, undefined], "it would have passed without the edge");
  assert.deepEqual([(blow as any).mod, (blow as any).edge, (blow as any).turned], [2, 1, true]);
  const [lost, theirs] = receipts(r, [
    ...toolRows("roll", { ability: "charisma", dc: 12, edge: -2 }, { who: "Ken", ability: "charisma", roll: 12, total: 11, for_play: "-2", dc: 12, success: false }),
    ...toolRows("roll", { who: "person:9", ability: "wisdom", against: "player", edge: 2 }, {
      who: "Hob", ability: "wisdom", roll: 9, total: 12, for_play: "+2", against: "Ken", their_total: 11, success: true }),
  ]);
  assert.deepEqual([(lost as any).mod, (lost as any).edge, (lost as any).turned], [1, -2, true], "nonsense cost the roll");
  assert.deepEqual([(theirs as any).who, (theirs as any).edge, (theirs as any).turned], ["Hob", 2, true]);
  const [fair, unweighed] = receipts(r, [
    ...toolRows("roll", { ability: "wisdom", dc: 12, edge: 0 }, { who: "Ken", ability: "wisdom", roll: 12, total: 13, for_play: "+0", dc: 12, success: true }),
    ...toolRows("roll", { ability: "wisdom", dc: 12 }, { who: "Ken", ability: "wisdom", roll: 12, total: 13, dc: 12, success: true }),
  ]);
  assert.deepEqual([(fair as any).edge, (fair as any).turned, (fair as any).mod], [0, undefined, 1], "an ordinary try is still weighed");
  assert.equal((unweighed as any).edge, undefined);
  assert.equal((blow as any).blow, true);
});

test("a meal paid for and eaten heals, and shows as a heal", () => {
  const r = new StreamReader("Yuno");
  const got = receipts(r, toolRows("transfer", { coins: 1, to: "person:332", fed: true }, {
    from: "Yuno", to: "Bess Ingleton", coins: 1, healed: "2 (17/30)", why: "a bowl of oats" }));
  assert.deepEqual(got.map((x) => x.kind), ["coins", "hurt"]);
  assert.deepEqual(got[1], { kind: "hurt", who: "Yuno", you: true, amount: -2, hp: "17/30", down: false, turnsOnYou: false });
});

test("modest growth past what a day gives shows nothing", () => {
  const r = new StreamReader("Ken");
  const got = receipts(r, [
    ...toolRows("award_xp", { amount: 3, modest: true }, { gained: 9, xp: 9, level: 1, modest_left_today: 1, why: "sword drill" }),
    ...toolRows("award_xp", { amount: 3, modest: true }, { gained: 0, xp: 24, modest: "a day's modest growth is spent; more comes tomorrow" }),
  ]);
  assert.deepEqual(got.map((x) => [x.kind, (x as any).gained]), [["xp", 9]]);
});

test("coins in and out, a wound dealt, a level gained, a long road", () => {
  const r = new StreamReader("Gerd Ulfsson");
  const got = receipts(r, [
    ...toolRows("transfer", { from: "person:89", to: "player", coins: 8 }, { from: "Casimir Krasnov", to: "Gerd Ulfsson", coins: 8 }),
    ...toolRows("transfer", { to: "person:84", coins: 2 }, { from: "Gerd Ulfsson", to: "Hanka Petrenko", coins: 2, toward_debts: true }),
    ...toolRows("hurt", { who: "person:341", amount: 6 }, { who: "Eastmund Fennwick", hp: "4/10", turns_on_you: true }),
    ...toolRows("award_xp", { amount: 30 }, { gained: 150, level: 2, new_level: true, why: "broke the rustlers" }),
    ...toolRows("move", { to: "place:9" }, { to: "Dubrslav", took_minutes: 240, heading: "north", stopped_on_the_road: true }),
    ...toolRows("move", { to: "place:97" }, { to: "the Common Room", took_minutes: 10 }),
  ]);
  assert.deepEqual(got.map((x) => x.kind), ["coins", "coins", "hurt", "xp", "travel", "waylaid"]);
  assert.deepEqual(got[0], { kind: "coins", delta: 8, party: "Casimir Krasnov", towardDebts: false });
  assert.deepEqual(got[1], { kind: "coins", delta: -2, party: "Hanka Petrenko", towardDebts: true });
  assert.deepEqual(got[2], { kind: "hurt", who: "Eastmund Fennwick", you: false, amount: 6, hp: "4/10", down: false, turnsOnYou: true });
  assert.equal((got[3] as any).level, 2);
});

test("refusals and errors show nothing; tool calls and text show what the DM is doing", () => {
  const r = new StreamReader("Gerd Ulfsson");
  const events = [
    ...toolRows("transfer", { coins: 25 }, { error: "Casimir Krasnov has 8 coins, not 25" }),
    textRow("The hall is quiet."),
  ].flatMap((row) => r.feed(row));
  assert.deepEqual(events, [{ type: "activity", text: "counting coins" }, { type: "activity", text: "telling it" }]);
});

test("an ability landed on its own score shows the power, then the roll made for it", () => {
  const r = new StreamReader("Ken");
  const got = receipts(r, toolRows("use_ability", { ability: "edgewright.hardened_edge", dc: 12 }, {
    ability: "Hardened Edge", uses_left: 2, runs_on: "strength",
    roll: { who: "Ken", ability: "strength", roll: 9, total: 11, dc: 12, success: false, why: "Hardened Edge" },
  }));
  assert.deepEqual(got.map((x) => x.kind), ["power", "check"]);
  assert.equal((got[1] as any).ability, "strength");
  assert.equal((got[1] as any).against, "DC 12");
});

test("a thing used up goes from the player's hands with nowhere it went", () => {
  const r = new StreamReader("Ken");
  const got = receipts(r, toolRows("transfer", { item: "item:65", used_up: true }, { used_up: "jar of pickled cabbage", by: "Ken", why: "eaten" }));
  assert.deepEqual(got, [{ kind: "item", name: "jar of pickled cabbage", gained: false, party: "used up" }]);
});

test("a character made during the turn becomes the one coins are counted for", () => {
  const r = new StreamReader(undefined);
  const got = receipts(r, [
    ...toolRows("create_character", {}, { name: "Ada Marr", class: "rogue" }),
    ...toolRows("transfer", {}, { from: "Ada Marr", to: "Bertha", coins: 3 }),
  ]);
  assert.deepEqual(got[1], { kind: "coins", delta: -3, party: "Bertha", towardDebts: false });
});

test("the dice of birth: six scores, then a reroll naming the one that changed", () => {
  const r = new StreamReader(undefined);
  const abilities = { strength: 10, dexterity: 6, constitution: 16, intelligence: 13, wisdom: 9, charisma: 10 };
  const got = receipts(r, [
    ...toolRows("roll_abilities", {}, { abilities, may_reroll_one: true }),
    ...toolRows("roll_abilities", {}, { abilities, already_rolled: "the dice have spoken; these stand" }),
    ...toolRows("reroll_stat", { ability: "dexterity" }, { ability: "dexterity", was: 6, now: 14, abilities: { ...abilities, dexterity: 14 } }),
  ]);
  assert.equal(got.length, 2, "asking again shows nothing new");
  assert.deepEqual(got[0], { kind: "abilities", scores: Object.entries(abilities).map(([name, score]) => ({ name, score })) });
  assert.deepEqual({ ...got[1], scores: undefined }, { kind: "abilities", scores: undefined, rerolled: "dexterity", was: 6 });
});

test("a score raised, a foe brought down counting itself, and a foe's working on its blow", () => {
  const r = new StreamReader("Jaron");
  const got = receipts(r, [
    ...toolRows("choose_ability", { score: "strength" }, { raised: "strength", was: 15, now: 16, highest: 21 }),
    ...toolRows("hurt", { who: "person:9", amount: 8 }, { who: "Stenric", hp: "0/14", dead: true,
      xp: { gained: 450, xp: 900, level: 3, new_level: true, why: "brought down Stenric" } }),
    ...toolRows("roll", { who: "person:9", against: "player", edge: 0 }, { who: "Vidar", used: "Hex Bolt", runs_on: "intelligence", roll: 14, total: 17,
      for_play: "+0", against: "Jaron", their_guard: 15, success: true, damage: 7, damage_dice: "2d6", damage_rolls: [3, 4], damage_sides: [6, 6] }),
  ]);
  assert.deepEqual(got[0], { kind: "raised", ability: "strength", was: 15, now: 16 });
  assert.deepEqual(got.slice(1, 3).map((x) => x.kind), ["hurt", "xp"]);
  assert.deepEqual(got[2], { kind: "xp", gained: 450, why: "brought down Stenric", level: 3 });
  const blow = got[3] as Extract<Receipt, { kind: "check" }>;
  assert.equal(blow.ability, "intelligence · Hex Bolt");
  assert.equal(blow.blow, true);
  assert.deepEqual(got[4], { kind: "dice", expr: "2d6", rolls: [3, 4], total: 7, why: "Hex Bolt · harm", sides: [6, 6] });
});

test("a working's harm comes die by die with each die's size, once it lands", () => {
  const r = new StreamReader("Jaron");
  const landed = { ability: "Hollin Blow", kind: "damage", uses_left: 2, damage: 13, damage_dice: "1d8+1d4+1d6", damage_rolls: [5, 3, 5], damage_sides: [8, 4, 6],
                   roll: { who: "Jaron", ability: "strength", roll: 16, total: 20, against: "a wolf", their_total: 9, success: true } };
  const got = receipts(r, toolRows("use_ability", { ability: "Hollin Blow", against: "person:3" }, landed));
  assert.deepEqual(got.map((x) => x.kind), ["power", "check", "dice"]);
  assert.deepEqual(got[2], { kind: "dice", expr: "1d8+1d4+1d6", rolls: [5, 3, 5], total: 13, why: "Hollin Blow", sides: [8, 4, 6] });
  const missed = receipts(new StreamReader("Jaron"), toolRows("use_ability", { ability: "Hollin Blow", against: "person:3" }, { ...landed, roll: { ...landed.roll, success: false } }));
  assert.deepEqual(missed.map((x) => x.kind), ["power", "check"]);
});

test("in a fight, a new round's order, and the foes who were up striking before the turn taken", () => {
  const r = new StreamReader("Jaron");
  const got = receipts(r, toolRows("roll", { ability: "strength", against: "person:3", edge: 0 }, {
    who: "Jaron", ability: "strength", roll: 12, total: 14, for_play: "+0", against: "old wolf", their_total: 9, success: true,
    struck_first: ["grey wolf (person:2) with bare hands and bulk: 21 against your guard of 12 — hits for 6 (you are at 24/30)"],
    turn: { round: 2, new: true, order: "grey wolf (person:2) 19, Jaron 14, old wolf (person:3) 3", up: "old wolf (person:3)" } }));
  assert.deepEqual(got.map((x) => x.kind), ["round", "blows", "check"]);
  assert.deepEqual(got[1], { kind: "blows", blows: [{ text: "grey wolf with bare hands and bulk: 21 against your guard of 12 — hits for 6 (you are at 24/30)", hit: true }] });
});

test("a foe's blow dealt by its roll wounds the player, and a death after it turns the world back or ends the run", () => {
  const r = new StreamReader("Godda");
  const got = receipts(r, toolRows("roll", { who: "person:1685", against: "player", edge: 2 }, {
    who: "Eadwin Westbrook", with: "bare hands and bulk", roll: 18, total: 20, against: "Godda", their_guard: 15, success: true,
    damage: 19, dealt: "the blow is dealt: Godda is at 0/19, dead", your_hp: "0/19",
    turned_back: "Godda died, and the world turned back to day 2, 08:20 (morning), at Wold Keep: what came after did not happen.", lives_left: 1,
  }));
  assert.deepEqual(got.map((x) => x.kind), ["check", "dice", "hurt", "turnedBack"]);
  assert.deepEqual(got[2], { kind: "hurt", who: "Godda", you: true, amount: 19, hp: "0/19", down: false, turnsOnYou: false });
  assert.equal((got[3] as any).left, 1);
  const [, last] = receipts(r, toolRows("hurt", { amount: 99 }, { who: "Godda", hp: "0/19", dead: true, died: "Godda is dead, their last life spent." }));
  assert.deepEqual(last, { kind: "died", name: "Godda" });
});
