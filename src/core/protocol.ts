// The shapes every part of the client agrees on. Nothing here knows about
// Electron, Node, the DOM or Claude: a backend turns the DM's stream into
// GameEvents, the world server answers with a Board and painted runs, and a
// front end draws them.

// How someone stands toward the player, as the world records it; "you" is
// the player's own words.
export type Stance = "hostile" | "guarded" | "neutral" | "warm" | "trusting" | "you";
export type Entity = "person" | "place" | "thing" | "you";

// A stretch of narration: plain text, a name (e), emphasis (i), strong
// words (b), and the stance of whoever speaks it inside a quote (q); on a
// person's name, who they are at a glance (w: "elven woman").
export interface Run {
  t: string;
  q?: Stance;
  e?: Entity;
  w?: string;
  i?: true;
  b?: true;
}
export type Paragraph = Run[];

// What kind of place the player stands in, for the backdrop: the server
// reads it from the world; a front end only draws one of that kind.
export interface Setting {
  scene: string; // tavern, temple, forge, workshop, shop, hall, keep, cell, cottage, barn, cave, mine, crypt, ruin, town, harbour, deck, land
  terrain?: string; // mountains, pines, woods, moor, downs, marsh, coast, valley, sea
  open?: boolean; // the sky is open above
  seed?: number; // the place, to vary the drawing by
  size?: string; // the settlement's: hamlet, village, town, city
}

// How fine a thing is; nothing for the common run of things.
export type Rarity = "uncommon" | "rare" | "very rare" | "relic";

export interface Status {
  time?: string;
  phase?: string; // morning, day, evening, night
  day?: number;
  minute_of_day?: number;
  weather?: string;
  season?: string;
  sky?: string; // storm, snow, rain, fog, overcast, fair, clear
  where?: string[];
  hp?: string; // "14/20"
  coins?: number;
  fight?: number; // how many are fighting the player where they stand, while a fight is on
  turn?: { round: number; order: { name: string; roll: number; gone?: boolean; up?: boolean; you?: boolean }[] }; // the fight's round, in initiative order
  lives?: { left: number; of: number }; // a death before the last turns the world back
  setting?: Setting;
  quiet_until?: number; // the world beyond the player's sight rests for the day, until this time (seconds)
  // Free play's turns left, those it began with and today's (none for a
  // supporter's); at none, when more come (a guest's come by keeping the run).
  turns?: { left: number; guest?: boolean; until?: number };
}

export interface ScenePerson {
  name: string;
  gender?: string;
  glance?: string; // who they are at a glance: "elven woman", "human man"; none for a beast
  trade?: string;
  stance?: Stance;
  held?: string; // held by the law: where, and what they wait on
  looks?: Looks;
}

// What the player can tell of someone by looking them over, as near as
// their Intelligence judges it (the server reads it; it holds for a day).
export interface Looks {
  seems: string; // how they measure against the player
  hurt: string; // unhurt, scratched, bloodied, badly hurt, near death
  eye: string; // how sure the read is: sure, keen, fair, rough, poor
  calling?: string; // to a sharp mind
  wields?: { name: string; fights?: string };
  wears?: string[];
  scores?: { name: string; lo: number; hi: number }[]; // the true score lies in lo..hi
}

export interface Scene {
  place?: string;
  town?: string;
  description?: string;
  state?: Record<string, unknown>;
  open?: string;
  people: ScenePerson[];
  things: { name: string; has_writing?: boolean; rarity?: Rarity; fights?: string }[];
  wares: { name: string; price: string; rarity?: Rarity; fights?: string }[];
  ways: { name: string; kept_by?: string }[];
  beyond: { name: string; way: string }[];
  road?: { between: string[]; water?: boolean; spot?: boolean }; // on a road between two towns, or a spot by it
  board?: { text: string; holds: number; done?: boolean }[]; // the town's bills, where the player stands at its board
}

export interface Sheet {
  name: string;
  class?: string;
  level: number;
  hp?: string;
  coins?: number;
  xp: number;
  next_xp: number;
  abilities: { name: string; score: number; mod: number }[];
  powers: Power[];
  carrying: { name: string; has_writing?: boolean; rarity?: Rarity; left?: number; fights?: string }[]; // left: arrows still to loose; fights: its harm or guard
}

// One of the character's abilities, under the name the world gave it, with
// what it does in play.
export interface Power {
  name: string;
  uses: string; // "3/4": left of per rest
  what?: string;
  kind?: string; // damage, heal, buff, debuff, control, utility
  range?: string; // self, close, near, far
  area?: string;
  dice?: string;
  per_level?: string; // the dice it grows by
  every?: number; // levels between growths
  now?: string; // its dice at the character's level, grown
  runs_on?: string; // the ability score it runs on
}

export interface KnownPerson {
  name: string;
  glance?: string;
  trade?: string;
  stance: Stance;
  at?: string;
  status?: string;
}

export interface Deal {
  owed_by?: string;
  owed_to?: string;
  kind?: string;
  terms?: string;
  coins?: number;
  status?: string;
  due?: string;
  overdue?: boolean;
}

export interface JournalEntry {
  when?: string;
  paragraphs: Paragraph[];
}

// The realm as data to draw a map from (GET /client/atlas). Heights and
// sea level are thousandths; positions are in map units, 0..size.
export interface AtlasTown {
  name: string;
  x: number;
  y: number;
  size?: string; // hamlet, village, town, city
  kingdom?: number; // index into Atlas.kingdoms
  basis?: string; // what the town lives by
  terrain?: string;
  you?: boolean;
  site?: boolean; // no town: a place the player has been, marked but not named
}

export interface Atlas {
  size: number;
  cells: number; // a side of the grid
  terrain: string; // one letter a cell, row by row: ~ sea, c coast, v valley, m marsh, f floodplain, g grass, o moor, t/T forest, n crags, ^ mountain
  height: number[];
  sea_level: number;
  rivers: [number, number][][];
  lakes: [number, number][];
  towns: AtlasTown[];
  kingdoms: string[];
}

// How the world began, part by part.
export interface CreationPart {
  part: string;
  text: string;
}

// What anyone in the world knows of it (GET /client/lore): how it began, its
// callings and what each can do, its realms and their customs, and the days
// kept. Nobody's mind is in it.
export interface Lore {
  world: string;
  creation?: CreationPart[];
  peoples?: { name: string; looks: string; leans?: string }[];
  callings?: { name: string; what?: string; runs_on?: string; hardiness?: number; common?: boolean;
               abilities: { name: string; what?: string; from_level?: number; kind?: string }[] }[];
  realms?: { name: string; folk?: string; ruler?: string; seat?: string; customs: string[]; towns: string[] }[];
  days?: { holy: { name: string; keeps?: string }[]; holy_every?: number; fairs: { name: string; keeps: string }[];
           next_here?: { name: string; kind: string; line: string; town: string } };
}

// Everything shown beside the story, read once after each turn. Before the
// player has a character only `world`, `creation` and `error` are set.
export interface Board {
  world: string;
  error?: string;
  make_character?: boolean; // a world with nobody in it yet: the player makes their character here
  creation?: CreationPart[];
  you?: string;
  status?: Status;
  scene?: Scene;
  sheet?: Sheet;
  people?: KnownPerson[];
  deals?: Deal[];
  journal?: JournalEntry[];
  level_up?: number; // a new level's choices waiting: how many
  run_over?: RunOver; // the character's last life is spent
  guest?: { kept_for_hours: number; keep?: boolean }; // a guest's run, kept that long without play; keep: there is a site to keep it on
}

// The run's end: who died, how, and the ways this world allows to begin again.
export interface RunOver {
  name: string;
  died?: string;
  gone?: true; // went into another world, not dead
  ways: ("start" | "on")[];
}

export interface Begun {
  begun?: string;
  board?: Board;
  error?: string;
}

export interface Blow {
  text: string;
  hit: boolean;
}

// Before there is a character, what the player chooses from (GET
// /client/character): the world's peoples, its callings, how many first
// abilities to pick, the points to spread, the dice if rolled, a few names
// of the land. The server keeps every rule; the window only offers its
// choices.
export interface CallingOption {
  id: string;
  name: string;
  what: string;
  leans_on?: string; // the score its work leans on
  hardiness?: number; // its hit die
  carries?: string[]; // what it sets out with, by the world's names
  first: { id: string; name: string; what: string; kind?: string; range?: string; uses?: number; dice?: string; per_level?: string; every?: number }[];
}
// How the six may be spread from points: a pool, the least, the most, and
// each score's own most where a people leans.
export interface Spread {
  points: number;
  min: number;
  max: number;
  caps?: Record<string, number>;
}
// One of the world's peoples: how they look, what they add to rolled
// scores (never past `roll_most`), what they allow spread, names of theirs.
export interface PeopleOption {
  id: string;
  name: string;
  plural: string;
  looks: string;
  leans: string[];
  away: string[];
  pluses: Record<string, number>;
  roll_most?: number;
  spread: Spread;
  names?: Record<string, string[]>;
}
export interface Rolled {
  abilities: Record<string, number>;
  may_reroll_one?: boolean;
  error?: string;
}
// A supporter's character in another of their runs, who may be brought
// into this world instead of one made here.
export interface Bringable {
  run: string;
  name: string;
  calling?: string;
  level: number;
  glance?: string; // "merrow woman"
  began: number; // when their run began (seconds)
}

export interface CharacterOptions {
  callings: CallingOption[];
  bring?: Bringable[]; // a supporter's, from their other runs
  peoples?: PeopleOption[]; // a server from before peoples sends none
  picks: number;
  spread: Spread; // a human's
  dice?: string; // what each score is rolled on
  rolled?: Rolled;
  names?: Record<string, string[]>;
  error?: string;
}
export interface CharacterChoice {
  name: string;
  gender: "male" | "female";
  people?: string;
  calling: string;
  abilities: string[];
  stats?: Record<string, number>; // spread from points, in place of the roll
}
// What a new level offers (GET /client/level): its abilities and the
// scores that can still rise, up to `top`.
export interface LevelAbility {
  id: string;
  name: string;
  what?: string;
  kind?: string;
  range?: string;
  uses?: number;
  dice?: string;
  per_level?: string; // the dice it grows by
  every?: number; // levels between growths
  from?: number; // the level it is learned from
  runs_on?: string;
}
export interface LevelOptions {
  level: number;
  class?: string;
  picks: number;
  abilities: LevelAbility[];
  raises?: number; // points on scores this level offers (one every third level, in place of an ability)
  scores: { name: string; score: number; top: number }[];
  error?: string;
}
export type LevelPick = { ability: string } | { score: string };
export interface Chosen {
  sheet?: Sheet;
  tell?: string; // what the DM is told of the player's choice
  error?: string;
}

export interface Made {
  sheet?: { name: string; class?: string; level?: number; hp?: string };
  tell?: string; // what the DM is told of who has come into the world
  error?: string;
}

// What the dice, the purse and the body did during a turn, read from the
// DM's tool results as they arrive.
export type Receipt =
  | { kind: "check"; who: string | null; ability: string; roll: number; mod: number; total: number; against: string;
      success: boolean; critical: boolean; fumble: boolean; why?: string; blows: Blow[];
      edge?: number; turned?: boolean; blow?: boolean } // edge: what the DM weighed the play behind the roll at (0 too); turned: it decided the roll
  | { kind: "dice"; expr: string; rolls: number[]; total: number; why?: string; sides?: number[] } // sides: each die's, beside its face
  | { kind: "hurt"; who: string; you: boolean; amount: number; hp: string; down: boolean; turnsOnYou: boolean }
  | { kind: "coins"; delta: number; party: string; towardDebts: boolean }
  | { kind: "item"; name: string; gained: boolean; party: string }
  | { kind: "xp"; gained: number; why?: string; level?: number }
  | { kind: "power"; name: string; usesLeft?: number; learned: boolean }
  | { kind: "raised"; ability: string; was: number; now: number }
  | { kind: "blows"; blows: Blow[] } // foes who were up struck before the turn taken
  | { kind: "round"; round: number; order: string } // a new round of a fight, its order rolled
  | { kind: "travel"; to: string; minutes: number; heading?: string }
  | { kind: "waylaid" }
  | { kind: "born"; name: string; cls: string }
  | { kind: "abilities"; scores: { name: string; score: number }[]; rerolled?: string; was?: number }
  | { kind: "deal"; terms: string }
  | { kind: "turnedBack"; text: string; left: number } // a death, and the world turned back to the last checkpoint
  | { kind: "died"; name: string }; // the last life spent

// One of today's worlds, as a signed-in player chooses a new run from: a
// story world (its own creation story and callings) or a classic one (the
// hand-made callings, no story); or one of their own, a supporter's.
export interface WorldCard {
  id: string;
  kind: "story" | "classic" | "own";
  size?: string;
  made_at: number;
  realms?: string[];
  towns?: number;
  callings?: string[];
  opening?: string;
}

// How a supporter's worlds of their own stand, for the launch menu: the one
// being made, if any; the last made or that couldn't be, if lately; how many
// more may be asked for this week, and when the next may once none can.
export interface OwnWorlds {
  making?: { state: "waiting" | "making"; asked_at: number };
  last?: { state: "made" | "failed"; at: number };
  left: number;
  next_at?: number;
}

// What a supporter asks of a world of their own; any of it may be left
// blank, for the making to fill.
export interface OwnWish {
  premise: string;
  callings: { name: string; line: string }[];
  peoples: { name: string; line: string }[];
  size: "small" | "medium" | "large";
}

// A run on the player's account, as the launch menu lists it.
export interface RunEntry {
  run: string;
  world: string;
  created_at: number;
  used_at: number | null;
  character: { name: string; calling: string | null; level: number } | null;
}

// What's new, as the world server tells it at launch (GET /news): the
// operator's items, and a newer window than the one asking, if there is one.
export interface NewsItem {
  id: string;
  title: string;
  text: string;
  link?: string;
}
export interface News {
  news: NewsItem[];
  window?: { version: string; link?: string };
}

export type GameEvent =
  | { type: "activity"; text: string }
  | { type: "receipt"; receipt: Receipt }
  | { type: "turn"; input: string; paragraphs: Paragraph[]; board: Board; newDay?: string; resumed?: boolean }
  // The turn ended in another world (the DM made a new one): the shell
  // starts a new conversation with the DM there.
  | { type: "newWorld"; board: Board }
  // Nobody is in the world yet: the player makes their character in the window.
  | { type: "create"; board: Board }
  // A new level's choices wait: the player makes them in the window.
  | { type: "level"; board: Board }
  // The run is over: the player chooses how to begin again.
  | { type: "runOver"; board: Board }
  // No turns are left to play: nothing was said to the DM.
  | { type: "spent"; board: Board }
  | { type: "signIn"; how: string; canSignIn: boolean } // the DM's own program isn't signed in: how to, and whether the window can start it
  | { type: "notice"; text: string } // the player's words not sent, and why
  // The window is closing on a guest's run: keep it on an account first?
  | { type: "quitting"; hours: number }
  | { type: "error"; message: string };
