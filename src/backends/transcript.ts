import { existsSync, readFileSync } from "node:fs";

// The turns on record in a world's folder (transcript.jsonl), one to a line:
// the words the DM was given and what it said back.
export interface Told {
  input: string;
  narration: string;
}

// How many of the last turns a conversation begun anew is told.
export const CARRIED = 3;

export function turns(path: string): Told[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").flatMap((line) => {
    try {
      const t = JSON.parse(line);
      return typeof t?.input === "string" && typeof t?.narration === "string" ? [{ input: t.input, narration: t.narration }] : [];
    } catch {
      return [];
    }
  });
}

// What a new conversation in a game already under way is given: the last
// few turns as they were played, then the player's words. The rest is the
// world's records, which the DM reads before it says anything.
export function carried(path: string, input: string): string {
  const last = turns(path).slice(-CARRIED);
  if (!last.length) return input;
  const played = last.map((t) => `The player: ${t.input}\n\nYou: ${t.narration}`).join("\n\n");
  return `The last turns of this game, as they were played:\n\n${played}\n\n---\n\n${input}`;
}
