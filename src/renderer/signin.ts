import type { Bridge } from "../core/bridge.ts";
import { h, settled } from "./dom.ts";
import type { Screen } from "./fx/screen.ts";

// The DM's own program isn't signed in on this computer, so nothing goes to
// it. For Claude Code the window starts its own sign-in, which opens the
// browser, and waits; for Codex, or if no browser opens, the command to run
// in a terminal, and a button to say it's done. Resolves once signed in.

export interface SignInHooks {
  bridge: Bridge;
  screen: Screen;
}

// While the box is up, another ask waits on the same sign-in.
let asking: Promise<void> | null = null;

export function askToSignIn(host: HTMLElement, how: string, canSignIn: boolean, hooks: SignInHooks): Promise<void> {
  asking ??= ask(host, how, canSignIn, hooks).finally(() => { asking = null; });
  return asking;
}

function ask(host: HTMLElement, how: string, canSignIn: boolean, hooks: SignInHooks): Promise<void> {
  const { bridge } = hooks;
  return new Promise((done) => {
    const err = h("p", { class: "err" });
    const sign = canSignIn ? h("button", { type: "button", class: "primary go" }, "Sign in") : null;
    const again = h("button", { type: "button", class: canSignIn ? "quiet" : "primary" }, "I've signed in");
    const cancel = h("button", { type: "button", class: "quiet" }, "cancel");
    cancel.hidden = true;
    const box = h("div", { class: "creation keeprun signin" },
      h("div", { class: "head" }, h("div", { class: "title" }, "Sign in to play"), h("div", { class: "rule" })),
      h("p", { class: "lede" }, canSignIn
        ? "The Dungeon Master plays on your own Claude Code, which isn't signed in on this computer yet. Sign in opens your browser: sign in there with your own Claude account, and the game goes on."
        : how),
      canSignIn ? h("p", { class: "how" }, `If no browser opens: ${fallback(how)}`) : null,
      h("div", { class: "row end" }, err, cancel, again, sign));
    // Said at once, before the box fades: the story may already be coming.
    const signedIn = async () => {
      done();
      await close(host, hooks.screen);
    };
    sign?.addEventListener("click", async () => {
      sign.disabled = again.disabled = true;
      sign.textContent = "Sign in in your browser…";
      err.textContent = "";
      cancel.hidden = false;
      const out = await bridge.dmSignIn();
      cancel.hidden = true;
      if ("ok" in out) return signedIn();
      sign.disabled = again.disabled = false;
      sign.textContent = "Sign in";
      err.textContent = "Not signed in yet. Try again, or sign in from a terminal as above.";
    });
    cancel.addEventListener("click", () => void bridge.cancel());
    again.addEventListener("click", async () => {
      again.disabled = true;
      if (sign) sign.disabled = true;
      err.textContent = "";
      const out = await bridge.dmRecheck();
      if ("ok" in out) return signedIn();
      again.disabled = false;
      if (sign) sign.disabled = false;
      err.textContent = "Still not signed in.";
    });
    host.replaceChildren(box);
    host.hidden = false;
    if (hooks.screen.mode !== "off") box.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
    (sign ?? again).focus();
  });
}

// The terminal's way, without the first sentence the box has said already.
function fallback(how: string): string {
  const rest = how.replace(/^[^.]*not signed in\.\s*/, "");
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

async function close(host: HTMLElement, screen: Screen): Promise<void> {
  const box = host.querySelector<HTMLElement>(".signin");
  if (box && screen.mode !== "off") {
    await settled(box.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-10px)" }], { duration: 260, easing: "ease-in", fill: "forwards" }));
  }
  host.hidden = true;
  host.replaceChildren();
}
