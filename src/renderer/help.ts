import type { Fx, Settings, Speed } from "../core/bridge.ts";
import type { Stance } from "../core/protocol.ts";
import { h } from "./dom.ts";

// The help tab: how to play, the window's settings, and what the colours
// in the story mean. Its words are here, apart from the panels, to be
// written and rewritten.

const SPEEDS: [Speed, string][] = [["slow", "slow"], ["normal", "normal"], ["fast", "fast"], ["off", "at once"]];
const MOTION: [Fx, string][] = [["full", "full"], ["calm", "calm"], ["off", "still"]];

export function helpView(settings: Settings, change: (patch: Partial<Settings>) => void): Node[] {
  // A setting's choices, the one in force marked; a click changes it at once.
  const choices = <T extends string | boolean>(now: T, options: [T, string][], set: (v: T) => void) =>
    h("div", { class: "choices" }, ...options.map(([v, label]) => {
      const b = h("button", { type: "button", class: v === now ? "on" : "" }, label);
      b.addEventListener("click", () => set(v));
      return b;
    }));
  const legend = h("div", { class: "legend" },
    h("span", { class: "e-person" }, "people"), h("span", { class: "e-place" }, "places"), h("span", { class: "e-thing" }, "things"),
    ...(["hostile", "guarded", "neutral", "warm", "trusting"] as Stance[]).map((s) => h("span", { class: `q-${s}` }, `“${s}”`)));
  return [
    h("h3", null, "playing"),
    h("p", null, "Type what your character does, and put what they say in \"quotes\". The DM tells what happens; the panels on the right show the world as it stands. Hover a name to see who someone is, and click a person, a thing or a ware in the scene to look closer."),
    h("p", null, "Enter sends, and Shift+Enter starts a new line. Esc stops the DM, and a click on the story shows the rest of it at once."),
    h("h3", null, "settings"),
    h("dl", { class: "help" },
      h("dt", null, "the story"), h("dd", null, choices(settings.speed, SPEEDS, (speed) => change({ speed }))),
      h("dt", null, "movement"), h("dd", null, choices(settings.fx, MOTION, (fx) => change({ fx }))),
      h("dt", null, "dice and wounds"), h("dd", null, choices(settings.receipts, [[true, "shown"], [false, "hidden"]], (receipts) => change({ receipts })))),
    h("h3", null, "colours"), legend,
  ];
}
