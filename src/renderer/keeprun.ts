import type { Bridge } from "../core/bridge.ts";
import { h, settled } from "./dom.ts";
import type { Screen } from "./fx/screen.ts";

// Closing the window on a guest's run: it is deleted a while after its last
// turn, so the window asks once whether to keep it. Keeping signs the window
// in, as Sign in on the launch menu does: the site opens in the browser, the
// player signs in there and says yes, and the guest's run the window holds
// is kept on the account. The window waits for that yes, then closes; next
// time it opens signed in, the run among the account's. The key stays the
// same, so the run plays on as before and only stops running out.

export interface KeepHooks {
  bridge: Bridge;
  screen: Screen;
}

export function askToKeep(host: HTMLElement, hours: number, hooks: KeepHooks): void {
  if (!host.hidden) return;
  const { bridge } = hooks;
  const err = h("p", { class: "err" });
  const keep = h("button", { type: "button", class: "primary go" }, "Keep it");
  const leave = h("button", { type: "button" }, "Quit without keeping");
  const back = h("button", { type: "button", class: "quiet" }, "back to the game");
  const buttons = [keep, leave, back];
  const box = h("div", { class: "creation keeprun" },
    h("div", { class: "head" }, h("div", { class: "title" }, "Keep this run?"), h("div", { class: "rule" })),
    h("p", { class: "lede" }, `A guest's run is deleted ${hours} hours after its last turn. Keep it on an account and it stays: `
      + "the site opens in your browser, you sign in there and say yes, and this window is signed in with the run kept."),
    h("div", { class: "row end" }, err, back, leave, keep));
  keep.addEventListener("click", async () => {
    for (const b of buttons) b.disabled = true;
    err.textContent = "";
    keep.textContent = "Say yes in your browser…";
    leave.disabled = false;
    leave.textContent = "Quit without waiting";
    const out = await bridge.signIn();
    if ("error" in out) {
      for (const b of buttons) b.disabled = false;
      keep.textContent = "Keep it";
      leave.textContent = "Quit without keeping";
      if (out.error !== "cancelled") err.textContent = out.error;
      return;
    }
    await bridge.quit();
  });
  leave.addEventListener("click", async () => {
    await bridge.cancelSignIn();
    await bridge.quit();
  });
  back.addEventListener("click", async () => {
    await bridge.stay();
    await close(host, hooks.screen);
  });
  host.replaceChildren(box);
  host.hidden = false;
  if (hooks.screen.mode !== "off") box.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
  keep.focus();
}

async function close(host: HTMLElement, screen: Screen): Promise<void> {
  const box = host.querySelector<HTMLElement>(".creation");
  if (box && screen.mode !== "off") {
    await settled(box.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-10px)" }], { duration: 260, easing: "ease-in", fill: "forwards" }));
  }
  host.hidden = true;
  host.replaceChildren();
}
