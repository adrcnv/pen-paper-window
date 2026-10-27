# Pen and Paper: the window

A desktop window to play Pen and Paper in. Your own Claude Code or Codex plays the Dungeon Master; this app shows the story: names in colour, every quote in the colour of how its speaker stands toward you, dice that roll, wounds that shake the screen, the sky drawn from the world's real hour and weather, and in front of it the place you stand in (a tavern, a temple, a cave, the open moor), with the weather going on behind its windows. A lore tab tells the world as everyone in it knows it. In a world nobody is in yet, you make your character here (the dice, a calling, its first abilities, a name) before the DM says a word; the world server keeps every rule and tells the DM who has come. A new level's choice is made here the same way, and the DM hears of it with your next words. Click someone in the room to look them over (how they measure up to you, how hurt they are, what they fight with, their scores as near as your Intelligence can judge), or a weapon to see how it fights at your level.

## What it does, and nothing more

- **It runs your installed `claude`, unmodified, once per turn** (`claude -p`, resumed by session id). Every flag is in [src/backends/claude-code.ts](src/backends/claude-code.ts). The important ones:
  - `--tools ""`: Claude gets no built-in tools, so it cannot read or write your files, run commands or browse the web.
  - `--allowedTools mcp__harness-dm__*`, `--strict-mcp-config`: its only tools are the world server's, and none of your other MCP servers load.
  - `--setting-sources project`, run from an empty folder of its own: none of your settings, hooks or instructions come along.
- **Or it runs your installed `codex`, unmodified, once per turn** (`codex exec`, resumed by thread id). Every setting is in [src/backends/codex.ts](src/backends/codex.ts). The important ones:
  - `features.shell_tool=false` and the other built-in tools switched off, `sandbox_mode="read-only"`, `approval_policy="never"`: Codex cannot run commands, edit files, browse or search the web.
  - `mcp_servers.harness-dm`: its only tools are the world server's.
  - `--ignore-user-config --ignore-rules`, with no AGENTS.md, skills or prompt history, run from an empty folder of its own: none of your settings or instructions come along.
  - `--strict-config`: if a Codex version doesn't know one of these settings, the turn stops instead of running without it.
- **It never touches your Claude or OpenAI credentials.** `claude` and `codex` sign themselves in through their makers' own flows. If the one playing isn't signed in, the app tells you to sign in from a terminal (`claude`, or `codex login`).
- **It talks to one server, the game's world server.** The DM reaches it at `/mcp` and this window reaches it at `/client`. Your words reach the DM on stdin. The narration goes to the world server to be painted; nothing else leaves your machine. At launch the window also asks the server for news (`/news`, with no key, only the window's version): the newest news, if it hasn't shown it before, in a box over the menu.
- **It updates itself from this repository's GitHub releases, and from nowhere else.** A release build for Windows or a Linux AppImage asks GitHub once at launch whether a newer release is out (the repository is named in `resources/app-update.yml`), downloads it in the background, checks it against the SHA-512 the release lists, and puts it in place when you close the window ([src/main/update.ts](src/main/update.ts), electron-updater). Only published releases count, never drafts. A Mac can't update an unsigned app, so it hears of a new release in the news instead.
- **The page has no Node access.** The page script runs sandboxed and can only make the calls in [src/core/bridge.ts](src/core/bridge.ts).

The build doesn't minify anything (`build.mjs`), so the JavaScript inside the packaged app (`resources/app.asar`, readable with `npx @electron/asar extract`) is the source, bundled. If you'd rather not trust a release, build it yourself.

## Running it

You need Node 22.18 or later, pnpm, an installed and signed-in [Claude Code](https://code.claude.com) or [Codex](https://developers.openai.com/codex), and a world server. A release build plays on the game's own, `https://play.penandpaper.tech`. Run from the source, the window looks for one on this machine (`http://127.0.0.1:8742`), where the game's developers run theirs; the world server's code isn't part of this repository. To play the game itself from the source, set `HARNESS_SERVER=https://play.penandpaper.tech`.


```sh
pnpm install
pnpm start                      # build and open the window
pnpm test                       # unit tests (node:test, no model)
pnpm dist                       # package for this OS into release/
```

Releases are made by `.github/workflows/release.yml` on a tag (`v0.2.0`, which must match `version` in package.json): each OS builds and attaches its package to a draft release, and nothing reaches the windows already out until the draft is published. A build of your own with `pnpm dist` updates from the releases of the GitHub repository it was cloned from (git's `origin`), if that has any.

If `pnpm start` prints Node's version and exits, your shell has `ELECTRON_RUN_AS_NODE` set (editor terminals sometimes do). Unset it and try again.

Settings are kept in `config.json` in the app's data folder (`~/.config/Pen and Paper` on Linux):

| key | default | |
|---|---|---|
| `server` | `https://play.penandpaper.tech` | the world server (run from the source: `http://127.0.0.1:8742`) |
| `secret` | | when the server runs with `HARNESS_DM_SECRET`; or the window's key, from a server of saves per key: with none, Play asks for a guest's and keeps it here. Closing on a guest's run, the window asks whether to keep it, and opens the site to keep it on an account; the key stays the same |
| `device` | | the window's own key once signed in (the launch menu's "Sign in" opens the site, and the window collects it once you say yes there): it opens every run on the account |
| `run` | | the account's run last played |
| `dm` | `auto` | who plays the DM: `claude`, `codex`, or `auto` (Claude Code if it's installed, else Codex) |
| `model` | `claude-sonnet-5-5` | Claude Code's model |
| `effort` | `high` | |
| `claudePath` | | blank: found on PATH, then via your login shell |
| `codexModel` | | Codex's model; blank: your own Codex default |
| `codexEffort` | | blank: that model's default |
| `codexPath` | | blank: found on PATH, then via your login shell |
| `speed`, `fx`, `receipts` | `normal`, `full`, `true` | also set in the window, under its help tab |

The environment overrides the file: `HARNESS_SERVER`, `HARNESS_SECRET`, `HARNESS_DM`, `DM_MODEL`, `HARNESS_DM_EFFORT`, `CLAUDE_PATH`, `CODEX_MODEL`, `CODEX_EFFORT`, `CODEX_PATH`. For development there are also:
- `HARNESS_STATE`: a different data folder.
- `HARNESS_REPLAY=scripts/demo-turns.json`: play scripted turns instead of a DM, to show off the effects.
- `HARNESS_HIDDEN=1`: draw offscreen. `scripts/shoot.cjs` uses this to take screenshots.

## How it is put together

The parts are kept apart so the shell, the DM and the front end can each be swapped:

```
src/core/       pure TypeScript, no Node, DOM or Electron
  protocol.ts   the shapes everyone shares: painted runs, the board, receipts, events
  stream.ts     the DM's stream → activity and receipts (dice, coins, wounds…)
  session.ts    plays turns: Backend + World in, GameEvents out
  bridge.ts     the calls a front end may make of its shell
src/backends/   who plays the DM: claude-code.ts (your Claude Code), codex.ts (your Codex), replay.ts (scripted)
src/world/      the world server over HTTP
src/main/       the Electron shell: one window, IPC, config
src/renderer/   the page: story, receipts, side panels, WebGL sky and backdrops, particles
```

To use a different DM (a direct API call, a hosted model), implement `Backend` in `core/session.ts` so it streams rows of the same shape. To move off Electron, provide the `Bridge` from any other shell; the page doesn't change.

## License

MIT ([LICENSE](LICENSE)). The Alegreya fonts shipped with the window are under the SIL Open Font License, whose text travels with them (`OFL-*.txt` beside the fonts).
