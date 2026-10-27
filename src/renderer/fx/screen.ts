import { $, h } from "../dom.ts";

// Whole-window effects: a shake, a wash of red or green, a blade's slash, a
// banner across the middle. `calm` keeps the colour and drops the motion.
export class Screen {
  mode: "full" | "calm" | "off" = "full";

  shake(px = 6, seconds = 0.45): void {
    if (this.mode !== "full") return;
    const app = $("#app");
    app.style.setProperty("--shake", `${px}px`);
    app.style.setProperty("--shake-time", `${seconds}s`);
    restart(app, "shake");
  }

  wash(kind: "hurt" | "heal"): void {
    if (this.mode === "off") return;
    restart($("#wash"), kind);
  }

  slash(): void {
    if (this.mode !== "full") return;
    const el = h("div", { class: "slash" });
    el.style.setProperty("--angle", `${-20 - Math.random() * 25}deg`);
    el.style.top = `${38 + Math.random() * 24}%`;
    document.body.append(el);
    setTimeout(() => el.remove(), 600);
  }

  // A fight begins: two sabres sweep in and cross with a ring of steel,
  // and the window stays dark red at its edges until the fight is over.
  fightBegins(onClash: () => void): void {
    document.body.classList.add("in-fight");
    if (this.mode === "off") return;
    if (this.mode === "calm") return onClash();
    const el = h("div", { class: "sabres" }, sabre("left"), sabre("right"));
    document.body.append(el);
    setTimeout(() => {
      onClash();
      this.shake(9, 0.5);
    }, 420);
    setTimeout(() => el.remove(), 2300);
  }

  // The last foe is down or gone: the red drains away and the blades part.
  fightEnds(): void {
    document.body.classList.remove("in-fight");
    if (this.mode !== "full") return;
    const el = h("div", { class: "sabres parting" }, sabre("left"), sabre("right"));
    document.body.append(el);
    setTimeout(() => el.remove(), 1900);
  }

  // Somewhere new: its name across the window, a rule drawn out under it.
  // The name of a place come to, over the scene; a quiet one for a stop on
  // the road. Says whether it showed.
  place(title: string, subtitle = "", quiet = false): boolean {
    if (this.mode === "off" || !title) return false;
    document.querySelector(".place-card")?.remove();
    const el = h("div", { class: `place-card${quiet ? " quiet" : ""}` },
      h("div", { class: `title${title.length > 24 ? " long" : ""}` }, title), h("div", { class: "rule" }), subtitle ? h("div", { class: "subtitle" }, subtitle) : null);
    document.body.append(el);
    setTimeout(() => el.remove(), quiet ? 2800 : 4200);
    return true;
  }

  banner(title: string, subtitle = "", kind = ""): void {
    if (this.mode === "off") return;
    const box = $("#banner");
    box.replaceChildren(h("div", { class: `card ${kind}` }, h("div", { class: "title" }, title), subtitle ? h("div", { class: "subtitle" }, subtitle) : null));
    setTimeout(() => box.firstElementChild?.remove(), 3500);
  }
}

// A curved sabre, point up, drawn in steel with a brass guard.
function sabre(side: "left" | "right"): HTMLElement {
  const wrap = h("div", { class: `sabre ${side}` });
  wrap.innerHTML = `<svg viewBox="0 0 60 300" aria-hidden="true">
    <defs><linearGradient id="steel-${side}" x1="0" x2="1"><stop offset="0" stop-color="#f4f6fb"/><stop offset="0.55" stop-color="#b9c0cc"/><stop offset="1" stop-color="#6c7380"/></linearGradient></defs>
    <path d="M30 222 C 22 160, 22 90, 40 12 C 44 70, 42 150, 36 222 Z" fill="url(#steel-${side})" stroke="#2a2e36" stroke-width="1.2"/>
    <path d="M32 214 C 28 160, 29 100, 38 34" stroke="rgba(255,255,255,0.7)" stroke-width="1" fill="none"/>
    <path d="M12 224 C 22 216, 44 216, 52 226 C 44 232, 22 232, 12 224 Z" fill="#c9a24b" stroke="#5a4418" stroke-width="1.2"/>
    <rect x="28" y="230" width="9" height="46" rx="3" fill="#4a2e1c" stroke="#24160d" stroke-width="1"/>
    <circle cx="32.5" cy="282" r="7" fill="#c9a24b" stroke="#5a4418" stroke-width="1.2"/>
  </svg>`;
  return wrap;
}

// Plays a one-shot CSS animation again even if it is still running.
export function restart(el: Element, cls: string): void {
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
}
