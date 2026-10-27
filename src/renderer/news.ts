import type { Bridge } from "../core/bridge.ts";
import type { News } from "../core/protocol.ts";
import { h, settled } from "./dom.ts";
import type { Screen } from "./fx/screen.ts";

// What's new, at launch, in a small box over the menu: the newest news this
// window hasn't shown (patch notes, as like as not, long enough to scroll),
// and, where the window can't update itself (a Mac), that a newer one is
// out and where to get it. One click puts it away for good. Nothing shows
// when there is nothing new.

export interface NewsHooks {
  bridge: Bridge;
  screen: Screen;
}

export function showNews(host: HTMLElement, news: News, hooks: NewsHooks): void {
  const items = news.news.map((n) => item(n.title, n.text, n.link, "Read more"));
  if (news.window) {
    items.unshift(item("A new window", `Version ${news.window.version} of this window is out. This one can't update itself, so download the new one to have it.`,
      news.window.link, "Download it"));
  }
  if (!items.length || !host.hidden) return;
  const ok = h("button", { type: "button", class: "primary" }, "Got it");
  ok.addEventListener("click", async () => {
    ok.disabled = true;
    await hooks.bridge.newsSeen();
    await close(host, hooks.screen);
  });
  const box = h("div", { class: "creation news", role: "dialog", "aria-label": "What's new" },
    h("div", { class: "head" }, h("div", { class: "title" }, "What's new"), h("div", { class: "rule" })),
    h("div", { class: "items" }, ...items),
    h("div", { class: "row end" }, ok));
  host.replaceChildren(box);
  host.hidden = false;
  if (hooks.screen.mode !== "off") box.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, easing: "ease-out" });
  ok.focus();
}

// One piece of news: its title, its words, and its link, opened in the browser.
function item(title: string, text: string, link: string | undefined, label: string): HTMLElement {
  const more = link && /^https?:\/\//.test(link) ? h("a", { href: link, target: "_blank", rel: "noopener" }, label) : null;
  return h("section", { class: "item" }, h("div", { class: "ntitle" }, title), ...words(text), more);
}

// Words as the news file writes them: lines beginning "- " as a list, the
// rest as paragraphs, a new one at each blank line.
function words(text: string): HTMLElement[] {
  const out: HTMLElement[] = [];
  let para: string[] = [];
  let list: HTMLElement | null = null;
  const endPara = () => { if (para.length) out.push(h("p", null, para.join(" "))); para = []; };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      endPara();
      if (!list) out.push((list = h("ul")));
      list.append(h("li", null, line.slice(2).trim()));
    } else {
      list = null;
      if (line) para.push(line);
      else endPara();
    }
  }
  endPara();
  return out;
}

async function close(host: HTMLElement, screen: Screen): Promise<void> {
  const box = host.querySelector<HTMLElement>(".news");
  if (box && screen.mode !== "off") {
    await settled(box.animate([{ opacity: 1 }, { opacity: 0, transform: "translateY(-10px)" }], { duration: 260, easing: "ease-in", fill: "forwards" }));
  }
  host.hidden = true;
  host.replaceChildren();
}
