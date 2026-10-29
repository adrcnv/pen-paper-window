import type { Atlas, Begun, Board, CharacterChoice, CharacterOptions, Chosen, GameEvent, LevelOptions, LevelPick, Lore, Made, Paragraph, Rolled } from "./protocol.ts";
import { StreamReader } from "./stream.ts";

// Whoever plays the DM. Today that is the player's own Claude Code
// (backends/claude-code.ts); a backend that calls a model directly only has
// to stream rows of the same shape.
export interface Backend {
  // One turn: `onRow` gets each row of the DM's stream as it arrives; the
  // promise gives everything the DM said, in order.
  say(input: string, onRow: (row: unknown) => void, signal?: AbortSignal): Promise<{ narration: string }>;
  // Whether there is a game to carry on: a conversation to resume, or
  // turns on record that a new one is told.
  hasConversation(): boolean;
  // A new conversation from the next turn on, told the last few turns on
  // record before the player's words.
  rotate?(): void;
  // The last turn on record, to show where the player left off.
  lastTurn(): { input: string; narration: string } | null;
  // Another model or effort from the next turn on, the conversation kept.
  retune?(model: string, effort: string): void;
  // Whether its own program is signed in: nothing if so (or if it can't
  // say), else what the player is told to do about it.
  signedOut?(): Promise<string | null>;
  // Its own sign-in, started from the window (Claude Code's, in the
  // browser): whether it is signed in after.
  signIn?(signal?: AbortSignal): Promise<boolean>;
}

// A turn refused because the DM's own program isn't signed in.
export class SignedOut extends Error {}

// The world server: what to show beside the story. world/http.ts reaches it
// over HTTP.
export interface World {
  board(): Promise<Board>;
  paint(text: string): Promise<Paragraph[]>;
  map(): Promise<string>;
  atlas(): Promise<Atlas>;
  lore(): Promise<Lore>;
  character(): Promise<CharacterOptions>;
  rollCharacter(): Promise<Rolled>;
  rerollStat(ability: string): Promise<Rolled>;
  makeCharacter(choice: CharacterChoice): Promise<Made>;
  bringCharacter(run: string): Promise<Made>;
  levelOptions(): Promise<LevelOptions>;
  chooseLevel(picks: LevelPick[]): Promise<Chosen>;
  beginAgain(how: "start" | "on"): Promise<Begun>;
}

export const OPENING = "Begin: look around and set the opening scene.";

// Words starting with / are commands to the DM's own program (Claude Code
// runs them, and /login can't run there), never the story's.
export const SLASH = "Words starting with / are commands for the DM's own program, not the story, so nothing was sent. Say what your character does.";

// What the DM is told of this window, beside the rulebook.
export const WINDOW = "In this window the player makes the choices a new level brings on a screen of their own: say the level is gained " +
  "and leave the choosing to them; what they chose comes with their next words.";

// Plays turns: the player's words go to the DM, what it does along the way
// comes back as activity and receipts, and its narration comes back painted
// with the board as the world stands after it.
export class Session {
  board: Board | null = null;
  private backend: Backend;
  private world: World;
  private emit: (e: GameEvent) => void;
  private busy: AbortController | null = null;
  // The last turn did not finish (stopped, or failed): the world may have
  // changed under it, so the next turn looks before it speaks.
  private unfinished = false;
  // What the player chose in the window since the last turn, for the DM
  // with their next words.
  private told: string[] = [];
  // The story has begun here: past the sign-in, shown or told.
  private opened = false;
  private signing: AbortController | null = null;
  private opening: Promise<void> | null = null;
  // The settlement the DM's conversation is in. Arrived in another, the
  // next turn begins a new conversation (a seam): the records carry the
  // game, and a conversation grown long drifts.
  private settledIn: string | null = null;


  // Another model or effort for the DM from the next turn on.
  retune(model: string, effort: string): void {
    this.backend.retune?.(model, effort);
  }
  constructor(backend: Backend, world: World, emit: (e: GameEvent) => void) {
    this.backend = backend;
    this.world = world;
    this.emit = emit;
  }

  // The first thing to show: where the player left off, or the DM's
  // opening scene; in a world nobody is in yet, the player's character to
  // make first, here, with no word to the DM until it is made.
  // Once at a time: a sign-in finished while the player also says they
  // signed in must not set the scene twice.
  open(): Promise<void> {
    this.opening ??= this.begin_().finally(() => { this.opening = null; });
    return this.opening;
  }

  // The DM's program not signed in: said so first, and nothing goes to it.
  private async begin_(): Promise<void> {
    const out = await this.backend.signedOut?.();
    if (out) return this.emit({ type: "signIn", how: out, canSignIn: !!this.backend.signIn });
    this.opened = true;
    this.board = await this.world.board();
    if (this.board.make_character) return this.emit({ type: "create", board: this.board });
    if (!this.backend.hasConversation()) return this.turn(OPENING, "");
    const last = this.backend.lastTurn();
    const paragraphs = last?.narration ? await this.world.paint(last.narration) : [];
    this.emit({ type: "turn", input: last?.input ?? "", paragraphs, board: this.board, resumed: true });
    if (this.board.run_over) this.emit({ type: "runOver", board: this.board });
    else if (this.board.level_up) this.emit({ type: "level", board: this.board });
  }

  // `shown`: the words as the story shows them (none for the opening).
  async turn(input: string, shown = input): Promise<void> {
    if (this.busy) return;
    if (shown && /^\s*\//.test(input)) return this.emit({ type: "notice", text: SLASH });
    if (this.unfinished) {
      this.unfinished = false;
      const now = await this.world.board().catch(() => null);
      if (now && this.board && now.world !== this.board.world) {
        this.board = now;
        this.emit({ type: "newWorld", board: now });
        return;
      }
    }
    // No turns left, as the world last said: asked again (a guest's run may
    // have been kept since), and if still none, the DM is not spoken to.
    if (this.board?.status?.turns?.left === 0) {
      this.board = await this.world.board().catch(() => this.board);
      if (this.board?.status?.turns?.left === 0) {
        // Who has come into the world, made with none left: told with the next words.
        if (!shown && input !== OPENING) this.told.push(input.replace(`\n\n${OPENING}`, ""));
        return this.emit({ type: "spent", board: this.board });
      }
    }
    // Out of a fight, in a settlement other than the conversation's: a seam.
    const town = settlement(this.board);
    if (town && town !== this.settledIn && !this.board?.status?.fight) {
      if (this.settledIn) this.backend.rotate?.();
      this.settledIn = town;
    }
    const before = this.board;
    const reader = new StreamReader(before?.you);
    this.busy = new AbortController();
    const told = [...this.told];
    try {
      const said = told.length ? `${told.join("\n")}\n\n${input}` : input;
      const { narration } = await this.backend.say(said, (row) => reader.feed(row).forEach(this.emit), this.busy.signal);
      this.told = this.told.filter((t) => !told.includes(t));
      const board = await this.world.board();
      const paragraphs = narration ? await this.world.paint(narration) : [];
      this.board = board;
      const day = board.status?.day;
      const newDay = day != null && before?.status?.day != null && day > before.status.day
        ? `Day ${day}${board.status?.phase ? ` · ${board.status.phase}` : ""}` : undefined;
      this.emit({ type: "turn", input: shown, paragraphs, board, newDay });
      if (before && board.world !== before.world) this.emit({ type: "newWorld", board });
      else if (board.run_over) this.emit({ type: "runOver", board });
      else if (board.level_up) this.emit({ type: "level", board });
    } catch (e) {
      this.unfinished = true;
      if (e instanceof SignedOut) this.emit({ type: "signIn", how: e.message, canSignIn: !!this.backend.signIn });
      else this.emit({ type: "error", message: this.busy?.signal.aborted ? "(stopped)" : errorText(e) });
    } finally {
      this.busy = null;
    }
  }

  cancel(): void {
    this.busy?.abort();
    this.signing?.abort();
  }

  // The DM's own sign-in, from the window; once signed in, a story not yet
  // begun begins.
  async signIn(): Promise<boolean> {
    if (!this.backend.signIn || this.signing) return false;
    this.signing = new AbortController();
    try {
      if (!(await this.backend.signIn(this.signing.signal))) return false;
    } finally {
      this.signing = null;
    }
    if (!this.opened) void this.open();
    return true;
  }

  // Signed in meanwhile, as the player says (from a terminal, say): asked again.
  async recheck(): Promise<boolean> {
    if (await this.backend.signedOut?.()) return false;
    if (!this.opened) void this.open();
    return true;
  }

  // The character made in the window: the DM is told who they are, unseen
  // in the story, and sets the opening scene. The world as it stands now
  // first: it says whether there are turns left to play.
  async begin(tell: string): Promise<void> {
    this.board = await this.world.board().catch(() => this.board);
    return this.turn(`${tell}\n\n${OPENING}`, "");
  }

  character(): Promise<CharacterOptions> {
    return this.world.character();
  }

  rollCharacter(): Promise<Rolled> {
    return this.world.rollCharacter();
  }

  rerollStat(ability: string): Promise<Rolled> {
    return this.world.rerollStat(ability);
  }

  makeCharacter(choice: CharacterChoice): Promise<Made> {
    return this.world.makeCharacter(choice);
  }

  // A supporter's character from another of their runs, brought here
  // instead; that run is over.
  bringCharacter(run: string): Promise<Made> {
    return this.world.bringCharacter(run);
  }

  levelOptions(): Promise<LevelOptions> {
    return this.world.levelOptions();
  }

  // Beginning again, chosen in the window once the run is over: a new run
  // is a new conversation with the DM, which the new world's board starts.
  async beginAgain(how: "start" | "on"): Promise<Begun> {
    const out = await this.world.beginAgain(how);
    if (out.board) this.emit({ type: "newWorld", board: out.board });
    return out;
  }

  // The new level's choices made in the window: the DM hears of them with
  // the player's next words, and the board shows them now.
  async chooseLevel(picks: LevelPick[]): Promise<Chosen> {
    const out = await this.world.chooseLevel(picks);
    if (out.tell) {
      this.told.push(out.tell);
      this.board = await this.world.board();
    }
    return out;
  }

  current(): Board | null {
    return this.board;
  }

  map(): Promise<string> {
    return this.world.map();
  }

  atlas(): Promise<Atlas> {
    return this.world.atlas();
  }

  lore(): Promise<Lore> {
    return this.world.lore();
  }
}

// The settlement the player is in, if any: a road, a border post, a cave or
// a boat is none.
function settlement(board: Board | null): string | null {
  return board?.status?.setting?.size ? board.scene?.town ?? null : null;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
