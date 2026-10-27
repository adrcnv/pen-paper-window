import type { Bridge } from "../core/bridge.ts";
import type { RunOver } from "../core/protocol.ts";
import { h, settled } from "./dom.ts";
import type { Screen } from "./fx/screen.ts";

// The run's end, once the character's last life is spent, or they went
// into another world: who and how, and the ways to begin again this world
// allows. The server begins
// again with the DM's own tool; a new run is a new conversation, which the
// shell starts when the new board comes back.

export interface RunOverHooks {
  bridge: Bridge;
  screen: Screen;
}

const WAYS: Record<"start" | "on", [string, string]> = {
  start: ["From the world's first morning", "the world as it was made, with nothing of this run in it"],
  on: ["Someone new, in the world as it stands", "the dead lie where they fell, and nobody takes you for them"],
};

export function showRunOver(host: HTMLElement, over: RunOver, hooks: RunOverHooks): Promise<void> {
  if (!host.hidden) return Promise.resolve();
  const err = h("p", { class: "err" });
  const box = h("div", { class: "creation runover" },
    h("div", { class: "head" }, h("div", { class: "title" }, over.gone ? `${over.name} has gone` : `${over.name} is dead`), h("div", { class: "rule" }),
      over.died ? h("div", { class: "note" }, over.died) : null),
    h("p", { class: "lede" }, over.gone ? "They went into another world, and are there now. Begin again here:" : "The last life is spent. Begin again:"),
    h("div", { class: "ways" }, ...over.ways.map((how) => {
      const [label, what] = WAYS[how];
      const b = h("button", { type: "button", class: "way" }, h("span", { class: "fname" }, label), h("span", { class: "fwhat" }, what));
      b.addEventListener("click", async () => {
        for (const x of box.querySelectorAll<HTMLButtonElement>("button")) x.disabled = true;
        err.textContent = "";
        const out = await hooks.bridge.beginAgain(how);
        if (!out || out.error) {
          for (const x of box.querySelectorAll<HTMLButtonElement>("button")) x.disabled = false;
          err.textContent = out?.error ?? "The world server is not answering.";
          return;
        }
        await close(host, hooks.screen);
      });
      return b;
    })),
    h("div", { class: "row end" }, err, (() => {
      const later = h("button", { type: "button", class: "quiet" }, "not yet");
      later.addEventListener("click", () => void close(host, hooks.screen));
      return later;
    })()));
  host.replaceChildren(box);
  host.hidden = false;
  if (hooks.screen.mode !== "off") {
    box.animate([{ opacity: 0, filter: "grayscale(1) brightness(0.4)" }, { opacity: 1, filter: "none" }], { duration: 900, easing: "ease-out" });
  }
  return Promise.resolve();
}

async function close(host: HTMLElement, screen: Screen): Promise<void> {
  const box = host.querySelector<HTMLElement>(".creation");
  if (box && screen.mode !== "off") {
    await settled(box.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-14px)" }], { duration: 360, easing: "ease-in", fill: "forwards" }));
  }
  host.hidden = true;
  host.replaceChildren();
}
