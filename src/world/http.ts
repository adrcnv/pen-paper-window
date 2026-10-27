import type { Atlas, Begun, Board, CharacterChoice, CharacterOptions, Chosen, LevelOptions, LevelPick, Lore, Made, News, OwnWish, OwnWorlds, Paragraph, Rolled, RunEntry, WorldCard } from "../core/protocol.ts";
import type { World } from "../core/session.ts";

// The world server over HTTP (bin/dm_mcp --http in the Harness repo): the DM
// reaches it at /mcp, this client at /client. With a secret both sit under
// it, and the URL is the key. A server of saves per key gives each window a
// key of its own (connect, below). A window signed in to an account plays a
// run on it as `<its key>/<the run>` (Account, below).
export class ServerError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface Guest {
  key: string;
  world: string;
  kept_for_hours: number;
}

// The world as this window plays it. A server of saves per key answers a
// window with no key, or with one whose guest run has ended, "not here":
// then the window asks it for a guest's key, keeps it (`keep`), and plays
// that. `ended` says a key it held was no longer there.
export async function connect(server: string, key: string, keep: (key: string) => void): Promise<{ world: HttpWorld; board: Board; ended: boolean }> {
  const world = new HttpWorld(server, key);
  try {
    return { world, board: await world.board(), ended: false };
  } catch (e) {
    if (!(e instanceof ServerError && e.status === 404)) throw e;
    const guest = await HttpWorld.guest(server).catch((g) => {
      if (g instanceof ServerError && g.status !== 404) throw g; // full for today, and the like: said as the server says it
      return null;
    });
    if (!guest) throw e;
    keep(guest.key);
    const fresh = new HttpWorld(server, guest.key);
    return { world: fresh, board: await fresh.board(), ended: key.trim() !== "" };
  }
}

export class HttpWorld implements World {
  readonly base: string;
  readonly secret: string;

  constructor(server: string, secret = "") {
    this.base = server.replace(/\/+$/, "");
    this.secret = secret.trim();
  }

  get mcpUrl(): string {
    return `${this.base}/mcp${this.secret ? `/${this.secret}` : ""}`;
  }

  private url(path: string): string {
    return `${this.base}/client${this.secret ? `/${this.secret}` : ""}${path}`;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(this.url(path), { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(`The world server at ${this.base} is not answering (${e instanceof Error ? e.message : e}).`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ServerError(res.status, `The world server said ${res.status}: ${(body as any).error ?? res.statusText}`);
    return body as T;
  }

  // A guest's key for the world of the day, from a server of saves per key.
  static async guest(server: string): Promise<Guest> {
    const base = server.replace(/\/+$/, "");
    let res: Response;
    try {
      res = await fetch(`${base}/guest`, { method: "POST", signal: AbortSignal.timeout(30_000) });
    } catch (e) {
      throw new Error(`The world server at ${base} is not answering (${e instanceof Error ? e.message : e}).`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ServerError(res.status, (body as any).error ?? `The world server said ${res.status}`);
    return body as Guest;
  }

  board(): Promise<Board> {
    return this.json<Board>("/board");
  }

  async paint(text: string): Promise<Paragraph[]> {
    const body = await this.json<{ paragraphs: Paragraph[] }>("/paint", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }),
    });
    return body.paragraphs;
  }

  async map(): Promise<string> {
    return (await this.json<{ ansi: string }>("/map")).ansi;
  }

  atlas(): Promise<Atlas> {
    return this.json<Atlas>("/atlas");
  }

  lore(): Promise<Lore> {
    return this.json<Lore>("/lore");
  }

  character(): Promise<CharacterOptions> {
    return this.json<CharacterOptions>("/character");
  }

  rollCharacter(): Promise<Rolled> {
    return this.post<Rolled>("/character/roll", {});
  }

  rerollStat(ability: string): Promise<Rolled> {
    return this.post<Rolled>("/character/reroll", { ability });
  }

  makeCharacter(choice: CharacterChoice): Promise<Made> {
    return this.post<Made>("/character", choice);
  }

  bringCharacter(run: string): Promise<Made> {
    return this.post<Made>("/character/bring", { run });
  }

  levelOptions(): Promise<LevelOptions> {
    return this.json<LevelOptions>("/level");
  }

  chooseLevel(picks: LevelPick[]): Promise<Chosen> {
    return this.post<Chosen>("/level", { picks });
  }

  beginAgain(how: "start" | "on"): Promise<Begun> {
    return this.post<Begun>("/begin", { how });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  }

  async rulebook(): Promise<string> {
    return (await this.json<{ system: string }>("/rulebook")).system;
  }
}

// A window signed in to an account, on a server of saves per key: the
// account's runs, a new one, and signing in and out. Signing in pairs:
// the server gives a code for the site's page (opened in the browser) and
// a secret only this window keeps, which it trades for its own key once
// the player has said yes there.
export interface Pairing {
  code: string;
  device_code: string;
  url: string;
  interval: number;
  expires_in: number;
}

export const Account = {
  async runs(server: string, device: string): Promise<{ runs: RunEntry[]; most: number; own?: OwnWorlds; supporters?: string }> {
    return ask(server, `/client/${device}/runs`);
  },

  // A run of the account's forgotten, its save gone with it.
  async forgetRun(server: string, device: string, run: string): Promise<void> {
    await ask(server, `/client/${device}/runs/${run}/forget`, {});
  },

  // A new run in one of today's worlds (the story world, unless `world` names another).
  async newRun(server: string, device: string, world?: string): Promise<RunEntry> {
    return ask(server, `/client/${device}/runs`, world ? { world } : {});
  },

  async worlds(server: string, device: string): Promise<WorldCard[]> {
    return (await ask<{ worlds: WorldCard[] }>(server, `/client/${device}/worlds`)).worlds;
  },

  // A supporter's world of their own asked for; how their own stand now.
  async askWorld(server: string, device: string, wish: OwnWish): Promise<OwnWorlds> {
    return (await ask<{ own: OwnWorlds }>(server, `/client/${device}/worlds`, wish)).own;
  },

  // `guest` is the guest's key this window holds, if any: saying yes keeps its run too.
  async pair(server: string, guest: string): Promise<Pairing> {
    return ask(server, "/device", {}, guest ? { authorization: `Bearer ${guest}` } : {});
  },

  // This window's key once the player has said yes, or null while they haven't.
  async claim(server: string, deviceCode: string): Promise<string | null> {
    const out = await ask<{ key?: string; waiting?: boolean }>(server, "/device/claim", { device_code: deviceCode });
    return out.key ?? null;
  },

  async forget(server: string, device: string): Promise<void> {
    await ask(server, `/client/${device}/forget`, {});
  },
};

// What's new for a window of this version, asked with no key: anyone may
// ask, before Play as after.
export function news(server: string, version: string): Promise<News> {
  return ask(server, `/news?window=${encodeURIComponent(version)}`);
}

async function ask<T>(server: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const base = server.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST", signal: AbortSignal.timeout(30_000),
      headers: body === undefined ? headers : { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`The world server at ${base} is not answering (${e instanceof Error ? e.message : e}).`);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new ServerError(res.status, (out as any).error ?? `The world server said ${res.status}`);
  return out as T;
}
