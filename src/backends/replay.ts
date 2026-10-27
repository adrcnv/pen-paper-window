import type { Backend } from "../core/session.ts";

// A scripted DM: each turn plays back the next recorded one — its stream
// rows at a steady pace, then its narration — whatever the player typed.
// For showing the effects off and taking screenshots without a model.
export interface ReplayTurn {
  rows: unknown[];
  narration: string;
}

export class ReplayBackend implements Backend {
  private turns: ReplayTurn[];
  private played = 0;
  private gap: number;

  constructor(turns: ReplayTurn[], gapMs = 700) {
    this.turns = turns;
    this.gap = gapMs;
  }

  hasConversation(): boolean {
    return false;
  }

  lastTurn(): null {
    return null;
  }

  async say(_input: string, onRow: (row: unknown) => void, signal?: AbortSignal): Promise<{ narration: string }> {
    const turn = this.turns[this.played++ % this.turns.length];
    for (const row of turn.rows) {
      await new Promise((r) => setTimeout(r, this.gap));
      if (signal?.aborted) throw new Error("stopped");
      onRow(row);
    }
    return { narration: turn.narration };
  }
}
