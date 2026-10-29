import { contextBridge, ipcRenderer } from "electron";
import type { Bridge } from "../core/bridge.ts";
import type { GameEvent } from "../core/protocol.ts";

// The page gets these calls and nothing else of Node or Electron.
const bridge: Bridge = {
  menu: () => ipcRenderer.invoke("harness:menu"),
  news: () => ipcRenderer.invoke("harness:news"),
  newsSeen: () => ipcRenderer.invoke("harness:news-seen"),
  worlds: () => ipcRenderer.invoke("harness:worlds"),
  askWorld: (wish) => ipcRenderer.invoke("harness:ask-world", wish),
  start: (choice) => ipcRenderer.invoke("harness:start", choice),
  signIn: () => ipcRenderer.invoke("harness:sign-in"),
  cancelSignIn: () => ipcRenderer.invoke("harness:sign-in-cancel"),
  signOut: () => ipcRenderer.invoke("harness:sign-out"),
  say: (input) => ipcRenderer.invoke("harness:say", input),
  dmSignIn: () => ipcRenderer.invoke("harness:dm-sign-in"),
  dmRecheck: () => ipcRenderer.invoke("harness:dm-recheck"),
  cancel: () => ipcRenderer.invoke("harness:cancel"),
  map: () => ipcRenderer.invoke("harness:map"),
  atlas: () => ipcRenderer.invoke("harness:atlas"),
  lore: () => ipcRenderer.invoke("harness:lore"),
  character: () => ipcRenderer.invoke("harness:character"),
  rollCharacter: () => ipcRenderer.invoke("harness:character-roll"),
  rerollStat: (ability) => ipcRenderer.invoke("harness:character-reroll", ability),
  makeCharacter: (choice) => ipcRenderer.invoke("harness:character-make", choice),
  bringCharacter: (run) => ipcRenderer.invoke("harness:character-bring", run),
  begin: (tell) => ipcRenderer.invoke("harness:begin", tell),
  levelOptions: () => ipcRenderer.invoke("harness:level"),
  chooseLevel: (picks) => ipcRenderer.invoke("harness:level-choose", picks),
  beginAgain: (how) => ipcRenderer.invoke("harness:begin-again", how),
  toMenu: () => ipcRenderer.invoke("harness:to-menu"),
  supporters: () => ipcRenderer.invoke("harness:supporters"),
  forgetRun: (run) => ipcRenderer.invoke("harness:forget-run", run),
  quit: () => ipcRenderer.invoke("harness:quit"),
  stay: () => ipcRenderer.invoke("harness:stay"),
  saveSettings: (settings) => ipcRenderer.invoke("harness:settings", settings),
  dm: () => ipcRenderer.invoke("harness:dm"),
  setDm: (model, effort) => ipcRenderer.invoke("harness:dm-set", model, effort),
  onEvent: (listener) => {
    ipcRenderer.on("harness:event", (_e, event: GameEvent) => listener(event));
  },
};

contextBridge.exposeInMainWorld("harness", bridge);
