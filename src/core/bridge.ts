import type { Atlas, Begun, Board, CharacterChoice, CharacterOptions, Chosen, GameEvent, LevelOptions, LevelPick, Lore, Made, News, OwnWish, OwnWorlds, Rolled, RunEntry, WorldCard } from "./protocol.ts";

export type Speed = "off" | "fast" | "normal" | "slow";
export type Fx = "full" | "calm" | "off";
export interface Settings {
  speed: Speed;
  fx: Fx;
  receipts: boolean;
}

// The launch menu: whether this window is signed in to an account, and if
// so the account's runs, and for a supporter how their own worlds stand.
// Nothing here asks for a guest: that waits for Play.
export type LaunchMenu =
  | { ok: true; settings: Settings; signedIn: false }
  | { ok: true; settings: Settings; signedIn: true; runs: RunEntry[]; most: number; own?: OwnWorlds; supporters?: string }
  | { ok: false; settings: Settings; server: string; error: string };

// Who plays the DM and on what, as the player may change it from the
// window: Claude Code's models by name, any Codex model by its own; the
// efforts each takes. Nothing to change in a scripted replay.
export type DmChoice =
  | { which: "claude" | "codex"; model: string; effort: string; models: { id: string; name: string }[]; efforts: string[] }
  | { which: "replay" };

// What the player chose to play: as a guest, a run on their account, or a
// new run on it in one of today's worlds.
export type Choice = { kind: "guest" } | { kind: "run"; run: string } | { kind: "new"; world?: string };

export type StartInfo =
  | { ok: true; settings: Settings; server: string; board: Board; dm: string; ended?: boolean } // ended: the last guest run was gone
  | { ok: false; settings: Settings; server: string; error: string };

// All a front end may ask of the shell around it. The Electron preload
// provides it as `window.harness`; a browser build or a standalone app only
// has to provide the same calls.
export interface Bridge {
  menu(): Promise<LaunchMenu>;
  // What's new at launch, not shown before; `newsSeen` keeps it from being shown again.
  news(): Promise<News>;
  newsSeen(): Promise<void>;
  worlds(): Promise<WorldCard[] | { error: string }>; // today's worlds and the player's own, for a new run
  askWorld(wish: OwnWish): Promise<{ ok: true; own: OwnWorlds } | { error: string }>; // a supporter's world of their own
  supporters(): Promise<{ ok: true } | { error: string }>; // the site's page of what supporters get, in the browser
  forgetRun(run: string): Promise<{ ok: true } | { error: string }>; // one of the account's runs, for good

  start(choice: Choice): Promise<StartInfo>; // connect and open the story; what follows arrives through onEvent
  // Signing in: the site opens in the browser, and this resolves once the
  // player has said yes there (or the sign-in ran out, or was cancelled).
  signIn(): Promise<{ ok: true } | { error: string }>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  say(input: string): Promise<void>;
  cancel(): Promise<void>;
  map(): Promise<string>;
  atlas(): Promise<Atlas | null>;
  lore(): Promise<Lore | null>;
  // Making the character, before the DM says a word; `begin` tells the DM.
  character(): Promise<CharacterOptions | null>;
  rollCharacter(): Promise<Rolled | null>;
  rerollStat(ability: string): Promise<Rolled | null>;
  makeCharacter(choice: CharacterChoice): Promise<Made | null>;
  bringCharacter(run: string): Promise<Made | null>; // a supporter's, from another of their runs
  begin(tell: string): Promise<void>;
  // A new level's choices, made in the window; the DM hears of them with
  // the next words. The board as it stands after them.
  levelOptions(): Promise<LevelOptions | null>;
  chooseLevel(picks: LevelPick[]): Promise<(Chosen & { board?: Board }) | null>;
  // The run over: begin again from the world's first morning, or as
  // someone new in it as it stands. A new conversation follows.
  beginAgain(how: "start" | "on"): Promise<Begun | null>;
  // Closing on a guest's run: keep it on an account (the site's page for it
  // opens in the browser), close the window, or go back to the game.
  toMenu(): Promise<void>; // the run left for the launch menu (a DM's turn under way is stopped)
  quit(): Promise<void>;
  stay(): Promise<void>;
  saveSettings(settings: Settings): Promise<void>;
  dm(): Promise<DmChoice>;
  setDm(model: string, effort: string): Promise<{ ok: true; label: string } | { error: string }>; // from the next turn
  onEvent(listener: (e: GameEvent) => void): void;
}
