// Screenshots of the window playing the scripted demo turns, for checking
// the look without a model:
//   SHOT_DIR=<dir> HARNESS_REPLAY=scripts/demo-turns.json HARNESS_SERVER=… electron scripts/shoot.cjs
// It loads the app as usual, then follows the plan below: wait, type, snap.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const dir = process.env.SHOT_DIR || "shots";
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const log = (...a) => fs.appendFileSync(path.join(dir, "log.txt"), `${((Date.now() - t0) / 1000).toFixed(1)}s ${a.join(" ")}\n`);
log("start");
// SHOT_PLAN: a JSON file of steps instead of the demo's — [wait ms, "snap", name],
// [wait ms, "type", words], [wait ms, "click", a CSS selector], or
// [timeout ms, "until", a JS condition on the page]. No browser is opened
// meanwhile: a page the window would open is written to opened.txt instead.
const plan = process.env.SHOT_PLAN ? JSON.parse(fs.readFileSync(process.env.SHOT_PLAN, "utf8")) : [
  [1800, "snap", "01-rolling"], [3200, "snap", "02-blow"], [3500, "snap", "03-crit"], [5000, "snap", "04-inking"], [9000, "snap", "05-told"],
  [500, "type", "/people"], [800, "snap", "06-people"],
  [300, "type", "Take the coins from Casimir. \"My thanks.\""], [2600, "snap", "07-coins"], [1400, "snap", "08-level"], [9000, "snap", "09-told"],
  [300, "type", "/sheet"], [600, "snap", "10-sheet"],
  [300, "type", "Head for Hollowbourne down the cart track."], [2400, "snap", "11-road"], [7000, "snap", "12-ambush"],
  [300, "type", "/map"], [2500, "snap", "13-map"],
];

app.on("browser-window-created", (_e, win) => {
  log("window");
  win.webContents.on("did-fail-load", (_e, code, desc) => log("fail", code, desc));
  win.webContents.on("console-message", (e) => log("page:", e.message));
  win.webContents.once("did-finish-load", async () => {
    for (const [wait, what, arg] of plan) {
      log(what, arg);
      if (what !== "until") await new Promise((r) => setTimeout(r, wait));
      if (what === "until") {
        const end = Date.now() + wait;
        for (;;) {
          const ok = await win.webContents.executeJavaScript(`!!(${arg})`);
          if (process.env.SHOT_DEBUG) log("poll", ok);
          if (ok || Date.now() >= end) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        log("until done", Date.now() < end ? "met" : "TIMED OUT");
        continue;
      }
      if (what === "click") {
        await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(arg)})?.click()`);
        continue;
      }
      if (what === "snap") {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${arg}.png`), img.toPNG());
      } else {
        await win.webContents.executeJavaScript(`(() => { const i = document.querySelector('#input'); i.value = ${JSON.stringify(arg)};
          i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
      }
    }
    app.quit();
  });
});

require("electron").shell.openExternal = async (url) => {
  log("open", url);
  fs.writeFileSync(path.join(dir, "opened.txt"), url);
};
process.on("unhandledRejection", (e) => log("rejection", e && e.stack || e));
process.on("uncaughtException", (e) => log("exception", e && e.stack || e));
require("../dist/main.cjs");
log("main loaded");
