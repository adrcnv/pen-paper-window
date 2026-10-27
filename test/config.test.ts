import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULTS, loadConfig, PLAY, saveDm, saveKeys, saveNewsSeen, saveSettings } from "../src/main/config.ts";

test("the config file keeps keys and settings side by side, readable only by its owner", () => {
  const path = join(mkdtempSync(join(tmpdir(), "window-config-")), "config.json");
  saveSettings(path, { speed: "fast", fx: "calm", receipts: false });
  saveKeys(path, { secret: "g".repeat(43) });
  saveKeys(path, { device: "d".repeat(43), run: "0123456789abcdef01234567" });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const config = loadConfig(path, {});
  assert.deepEqual([config.speed, config.secret, config.device, config.run], ["fast", "g".repeat(43), "d".repeat(43), "0123456789abcdef01234567"]);
  saveKeys(path, { device: "", run: "" });
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).device, "", "signing out forgets the window's key");
});

test("the DM's model changed from the window is kept beside the keys, which it leaves alone", () => {
  const path = join(mkdtempSync(join(tmpdir(), "window-config-")), "config.json");
  saveKeys(path, { device: "d".repeat(43) });
  saveDm(path, { model: "opus", effort: "max" });
  const config = loadConfig(path, {});
  assert.deepEqual([config.model, config.effort, config.device], ["opus", "max", "d".repeat(43)]);
  assert.equal(loadConfig(path, { DM_MODEL: "haiku" }).model, "haiku", "the environment still wins, for development");
});

test("the news shown is kept, each once and the newest last, up to fifty, beside the keys", () => {
  const path = join(mkdtempSync(join(tmpdir(), "window-config-")), "config.json");
  saveKeys(path, { device: "d".repeat(43) });
  assert.deepEqual(loadConfig(path, {}).newsSeen, []);
  saveNewsSeen(path, ["a", "b"]);
  saveNewsSeen(path, ["a", "c"]);
  assert.deepEqual(loadConfig(path, {}).newsSeen, ["b", "a", "c"]);
  saveNewsSeen(path, Array.from({ length: 60 }, (_, i) => `n${i}`));
  const seen = loadConfig(path, {}).newsSeen;
  assert.deepEqual([seen.length, seen[0], seen.at(-1), loadConfig(path, {}).device], [50, "n10", "n59", "d".repeat(43)]);
});

test("a release build plays on the game's own server, unless the file or the environment names another", () => {
  const path = join(mkdtempSync(join(tmpdir(), "window-config-")), "config.json");
  const release = { ...DEFAULTS, server: PLAY };
  assert.equal(loadConfig(path, {}).server, "http://127.0.0.1:8742", "run from the source, a server on this machine");
  assert.equal(loadConfig(path, {}, release).server, "https://play.penandpaper.tech");
  assert.equal(loadConfig(path, { HARNESS_SERVER: "http://127.0.0.1:8752" }, release).server, "http://127.0.0.1:8752");
});
