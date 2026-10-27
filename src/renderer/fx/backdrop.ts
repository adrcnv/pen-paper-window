// The backdrop in front of the sky: where the player stands, drawn as
// silhouettes on a canvas the sky shader reads as a mask. Where the canvas
// is clear the sky shows through (a window, a gap between planks, the land
// under an open sky); where it is filled it hides the sky. Its channels say
// how to light what hides it:
//   alpha  covered
//   red    how far off, in haze (a far ridge takes the sky's colour)
//   green  firelight, which flickers (a hearth, a forge, a candle)
//   blue   a lamp lit at night (a window in a town)
// Nothing here is the world's: the server names the kind of place, and this
// draws one of that kind, varied by the place's number.

import type { Setting } from "../../core/protocol.ts";
export type { Setting };

type Ctx = CanvasRenderingContext2D;

interface Frame {
  ctx: Ctx;
  W: number;
  H: number;
  u: number; // a hundredth of the height
  stage: number; // the width left of the side panel
  cx: number; // where the eye falls: the clear part of the story column
  rnd: () => number;
}

export const SCENES = ["tavern", "temple", "forge", "workshop", "shop", "hall", "keep", "cell", "cottage", "barn", "cave", "mine", "crypt",
  "ruin", "town", "harbour", "deck", "land"] as const;

// Every backdrop is drawn on one frame of this shape, the window's as it
// was laid out for (a 1600 by 900 window, the side panel 340 wide), and
// scaled to cover the canvas whatever its shape: another shape crops a
// little off the sides or the sky, and nothing drawn comes apart.
const FRAME = { w: 1600, h: 900, side: 340 };

// Draws the backdrop for `s` onto `canvas` (sized already).
export function drawBackdrop(canvas: HTMLCanvasElement, s: Setting): void {
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const k = Math.max(canvas.width / FRAME.w, canvas.height / FRAME.h);
  // held to the right, where the side panel is, so a narrower window loses
  // the dim left under the story; from top and bottom, mostly the sky
  ctx.setTransform(k, 0, 0, k, canvas.width - FRAME.w * k, (canvas.height - FRAME.h * k) * 0.75);
  const stage = FRAME.w - FRAME.side;
  const f: Frame = { ctx, W: FRAME.w, H: FRAME.h, u: FRAME.h / 100, stage, cx: stage * 0.64, rnd: mulberry(s.seed ?? 1) };
  (DRAW[s.scene] ?? DRAW.cottage)(f, s);
  ctx.globalCompositeOperation = "source-over";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ── the channels ─────────────────────────────────────────────────────

function solid(f: Frame, haze = 0): void {
  f.ctx.globalCompositeOperation = "source-over";
  f.ctx.fillStyle = f.ctx.strokeStyle = `rgb(${Math.round(haze * 255)},0,0)`;
}

function cutting(f: Frame): void {
  f.ctx.globalCompositeOperation = "destination-out";
  f.ctx.fillStyle = f.ctx.strokeStyle = "#000";
}

// The lights below paint and put the brush back as it was, so a shape drawn
// after one keeps the shade it was meant to have, not the light's.

// Light on whatever is drawn already, fading out from its centre.
function glow(f: Frame, x: number, y: number, r: number, strength = 1, channel: "g" | "b" = "g"): void {
  const ctx = f.ctx;
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  const c = channel === "g" ? "0,255,0" : "0,0,255";
  g.addColorStop(0, `rgba(${c},${strength})`);
  g.addColorStop(0.35, `rgba(${c},${strength * 0.45})`);
  g.addColorStop(1, `rgba(${c},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function lit(f: Frame, x: number, y: number, w: number, h: number): void {
  f.ctx.save();
  f.ctx.globalCompositeOperation = "source-over";
  f.ctx.fillStyle = "rgb(0,0,255)";
  f.ctx.fillRect(x, y, w, h);
  f.ctx.restore();
}

function fire(f: Frame, x: number, y: number, w: number, h: number): void {
  const ctx = f.ctx;
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "rgb(0,255,0)";
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y);
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const tip = i % 2 ? 0.55 + f.rnd() * 0.3 : 1;
    ctx.lineTo(x - w / 2 + w * t, y - h * tip * Math.sin(Math.PI * Math.min(0.92, Math.max(0.08, t))));
  }
  ctx.lineTo(x + w / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── shapes ───────────────────────────────────────────────────────────

function rect(f: Frame, x: number, y: number, w: number, h: number): void {
  f.ctx.fillRect(x, y, w, h);
}

function poly(f: Frame, pts: [number, number][]): void {
  const ctx = f.ctx;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  ctx.fill();
}

function line(f: Frame, x1: number, y1: number, x2: number, y2: number, w: number): void {
  const ctx = f.ctx;
  ctx.lineWidth = w;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function disc(f: Frame, x: number, y: number, rx: number, ry = rx): void {
  f.ctx.beginPath();
  f.ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  f.ctx.fill();
}

// An arched opening: round, or pointed as in a church.
function arch(f: Frame, x: number, y: number, w: number, h: number, pointed = false): void {
  const ctx = f.ctx;
  const spring = y + (pointed ? w * 0.85 : w / 2);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, spring);
  if (pointed) {
    ctx.quadraticCurveTo(x, y + w * 0.12, x + w / 2, y);
    ctx.quadraticCurveTo(x + w, y + w * 0.12, x + w, spring);
  } else ctx.arc(x + w / 2, spring, w / 2, Math.PI, 0);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
  ctx.fill();
}

// A window cut through the wall, with its bars.
function windowPane(f: Frame, x: number, y: number, w: number, h: number, cols: number, rows: number, bar: number, shape: "rect" | "round" | "pointed" = "rect"): void {
  cutting(f);
  if (shape === "rect") rect(f, x, y, w, h);
  else arch(f, x, y, w, h, shape === "pointed");
  solid(f, 0.02);
  for (let c = 1; c < cols; c++) rect(f, x + (w * c) / cols - bar / 2, y, bar, h);
  for (let r = 1; r < rows; r++) rect(f, x, y + (h * r) / rows - bar / 2, w, bar);
}

function wall(f: Frame, haze: number): void {
  solid(f, haze);
  rect(f, 0, 0, f.W, f.H);
  // a little falling-off of the light into the corners
  for (let i = 0; i < 6; i++) {
    solid(f, haze * (0.7 - i * 0.1));
    rect(f, 0, f.H * (0.9 + i * 0.02), f.W, f.H);
  }
}

function lantern(f: Frame, x: number, top: number, len: number): void {
  const { u } = f;
  solid(f, 0.02);
  line(f, x, top, x, top + len, u * 0.25);
  poly(f, [[x - u * 1.4, top + len], [x + u * 1.4, top + len], [x + u * 1.1, top + len + u * 3.2], [x - u * 1.1, top + len + u * 3.2]]);
  glow(f, x, top + len + u * 1.8, u * 16, 0.85);
  solid(f, 0.0);
  rect(f, x - u * 1.5, top + len - u * 0.4, u * 3, u * 0.6);
}

function candle(f: Frame, x: number, y: number, h: number): void {
  const { u } = f;
  glow(f, x, y - h - u * 0.6, u * 7, 0.7);
  solid(f, 0.02);
  rect(f, x - u * 0.3, y - h, u * 0.6, h);
  fire(f, x, y - h, u * 0.5, u * 1.3);
}

function barrel(f: Frame, x: number, y: number, w: number, h: number): void {
  solid(f, 0.01);
  f.ctx.beginPath();
  f.ctx.moveTo(x, y);
  f.ctx.quadraticCurveTo(x - w * 0.12, y - h / 2, x, y - h);
  f.ctx.lineTo(x + w, y - h);
  f.ctx.quadraticCurveTo(x + w * 1.12, y - h / 2, x + w, y);
  f.ctx.closePath();
  f.ctx.fill();
}

function shelf(f: Frame, x: number, y: number, w: number, kinds: "jars" | "books" | "mugs"): void {
  const { u, rnd } = f;
  solid(f, 0.03);
  rect(f, x, y, w, u * 0.7);
  let at = x + u * 0.6;
  while (at < x + w - u * 1.5) {
    const ww = kinds === "books" ? u * (0.6 + rnd() * 0.7) : u * (1.2 + rnd() * 1.1);
    const hh = kinds === "books" ? u * (2.2 + rnd() * 1.6) : u * (1.4 + rnd() * 2.2);
    if (kinds === "jars") {
      rect(f, at, y - hh, ww, hh);
      rect(f, at + ww * 0.25, y - hh - u * 0.5, ww * 0.5, u * 0.6);
    } else if (kinds === "mugs") {
      rect(f, at, y - hh * 0.6, ww * 0.8, hh * 0.6);
    } else rect(f, at, y - hh, ww, hh);
    at += ww + u * (kinds === "books" ? 0.12 : 0.6 + rnd() * 1.2);
    if (kinds === "books" && rnd() < 0.08) at += u * 2;
  }
}

function beams(f: Frame, y: number, depth: number, posts: number[]): void {
  const { u, H } = f;
  solid(f, 0.0);
  rect(f, 0, 0, f.W, y);
  rect(f, 0, y, f.W, depth);
  for (const x of posts) {
    rect(f, x - u * 1.6, y, u * 3.2, H);
    poly(f, [[x + u * 1.6, y + depth], [x + u * 9, y + depth], [x + u * 1.6, y + depth + u * 7.4]]);
    poly(f, [[x - u * 1.6, y + depth], [x - u * 9, y + depth], [x - u * 1.6, y + depth + u * 7.4]]);
  }
}

// ── the land, under an open sky ──────────────────────────────────────

// A skyline from `base`, rising by up to `amp`: rolling, or ridged like
// rock, drawn down to the bottom.
function ridge(f: Frame, base: number, amp: number, freq: number, haze: number, rocky = false, from = 0, to = f.W): void {
  const n = noise1(f.rnd);
  solid(f, haze);
  const ctx = f.ctx;
  ctx.beginPath();
  ctx.moveTo(from, f.H);
  const step = Math.max(1, f.u * 0.6);
  for (let x = from; x <= to + step; x += step) {
    let v = 0, a = 1, fr = freq / f.W, tot = 0;
    for (let o = 0; o < 4; o++) {
      const k = n(x * fr);
      v += (rocky ? 1 - Math.abs(k * 2 - 1) : k) * a;
      tot += a;
      a *= 0.5;
      fr *= 2.1;
    }
    ctx.lineTo(x, base - amp * (v / tot));
  }
  ctx.lineTo(to, f.H);
  ctx.closePath();
  ctx.fill();
}

function pine(f: Frame, x: number, y: number, h: number): void {
  const w = h * 0.36;
  for (let i = 0; i < 3; i++) {
    const top = y - h + (h * i) / 4.2;
    const bw = w * (0.55 + i * 0.25);
    poly(f, [[x, top], [x + bw, top + h * 0.42], [x - bw, top + h * 0.42]]);
  }
  rect(f, x - h * 0.03, y - h * 0.12, h * 0.06, h * 0.14);
}

function broadleaf(f: Frame, x: number, y: number, r: number): void {
  rect(f, x - r * 0.1, y - r * 1.2, r * 0.2, r * 1.2);
  for (let i = 0; i < 5; i++) disc(f, x + (f.rnd() - 0.5) * r * 1.4, y - r * 1.5 - f.rnd() * r * 0.8, r * (0.55 + f.rnd() * 0.4));
}

function land(f: Frame, terrain: string | undefined, horizon: number, near = true): void {
  const { u, W, rnd } = f;
  switch (terrain) {
    case "mountains":
      ridge(f, horizon - u * 6, u * 34, 3.2, 0.8, true);
      ridge(f, horizon + u * 2, u * 20, 4.5, 0.52, true);
      if (near) ridge(f, horizon + u * 20, u * 12, 6, 0.08, true);
      break;
    case "pines":
      ridge(f, horizon, u * 14, 2.2, 0.7);
      solid(f, 0.4);
      for (let x = -u * 2; x < W; x += u * (1.6 + rnd() * 1.8)) pine(f, x, horizon + u * 4 + rnd() * u * 2, u * (6 + rnd() * 5));
      ridge(f, horizon + u * 9, u * 3, 3, 0.4);
      if (near) {
        solid(f, 0.02);
        for (let x = -u * 4; x < W; x += u * (5 + rnd() * 9)) if (rnd() < 0.55) pine(f, x, f.H * 1.02, u * (24 + rnd() * 20));
        ridge(f, horizon + u * 26, u * 4, 4, 0.03);
      }
      break;
    case "woods":
      ridge(f, horizon, u * 10, 2, 0.68);
      solid(f, 0.38);
      for (let x = -u * 2; x < W; x += u * (2.2 + rnd() * 2)) broadleaf(f, x, horizon + u * 7 + rnd() * u, u * (2.4 + rnd() * 1.6));
      ridge(f, horizon + u * 9, u * 2, 3, 0.38);
      if (near) {
        solid(f, 0.02);
        for (let x = -u * 6; x < W; x += u * (10 + rnd() * 14)) if (rnd() < 0.6) broadleaf(f, x, f.H * 1.04, u * (8 + rnd() * 6));
        ridge(f, horizon + u * 26, u * 3, 4, 0.03);
      }
      break;
    case "marsh": {
      ridge(f, horizon + u * 4, u * 3, 2, 0.6);
      solid(f, 0.12);
      rect(f, 0, horizon + u * 6, W, f.H);
      cutting(f);
      for (let i = 0; i < 12; i++) {
        const y = horizon + u * (8 + rnd() * 26);
        disc(f, rnd() * W, y, u * (3 + rnd() * 9) * (1 + (y - horizon) / (u * 30)), u * (0.2 + rnd() * 0.6) * (1 + (y - horizon) / (u * 20)));
      }
      if (near) {
        solid(f, 0.02);
        for (let x = 0; x < W; x += u * (1 + rnd() * 3)) {
          if (rnd() < 0.5) continue;
          const y = f.H - rnd() * u * 8, hgt = u * (5 + rnd() * 9);
          for (let k = -1; k <= 1; k++) line(f, x, y, x + k * u * 0.9 + (rnd() - 0.5) * u, y - hgt * (0.7 + rnd() * 0.3), u * 0.25);
        }
      }
      break;
    }
    case "coast":
    case "sea": {
      const sea = horizon + u * 4;
      solid(f, 0.42);
      rect(f, 0, sea, W, f.H);
      cutting(f);
      for (let i = 0; i < 22; i++) {
        const y = sea + u * (1 + rnd() * 30);
        rect(f, rnd() * W, y, u * (2 + rnd() * 12) * (1 + (y - sea) / (u * 12)), u * 0.18);
      }
      if (terrain === "coast") {
        solid(f, 0.16);
        const cliff = W * (0.06 + rnd() * 0.12);
        poly(f, [[0, horizon - u * 22], [cliff, horizon - u * 20], [cliff + u * 4, horizon - u * 6], [cliff + u * 9, sea + u * 2], [cliff + u * 9, f.H], [0, f.H]]);
        solid(f, 0.3);
        const stack = f.stage * (0.78 + rnd() * 0.12);
        poly(f, [[stack - u * 2, sea + u * 0.5], [stack - u * 1.4, sea - u * 9], [stack + u * 1.6, sea - u * 10], [stack + u * 2.4, sea + u * 0.5]]);
        if (near) {
          solid(f, 0.03);
          ridge(f, f.H - u * 6, u * 6, 5, 0.03, true);
        }
      }
      break;
    }
    case "valley": {
      ridge(f, horizon - u * 2, u * 12, 2.5, 0.72);
      solid(f, 0.45);
      poly(f, [[0, horizon - u * 10], [W * 0.35, horizon + u * 6], [W * 0.75, horizon + u * 6], [W, horizon - u * 14], [W, f.H], [0, f.H]]);
      cutting(f);
      const ctx = f.ctx;
      ctx.beginPath();
      ctx.moveTo(W * 0.52, horizon + u * 6);
      ctx.bezierCurveTo(W * 0.62, horizon + u * 14, W * 0.3, horizon + u * 22, W * 0.46, f.H);
      ctx.lineTo(W * 0.62, f.H);
      ctx.bezierCurveTo(W * 0.42, horizon + u * 22, W * 0.72, horizon + u * 14, W * 0.555, horizon + u * 6);
      ctx.closePath();
      ctx.fill();
      if (near) {
        solid(f, 0.03);
        ridge(f, f.H - u * 4, u * 4, 4, 0.03);
        broadleaf(f, f.stage * 0.14, f.H, u * 7);
      }
      break;
    }
    case "downs":
      ridge(f, horizon + u * 2, u * 9, 1.4, 0.66);
      ridge(f, horizon + u * 12, u * 8, 1.8, 0.36);
      if (near) {
        solid(f, 0.04);
        ridge(f, horizon + u * 28, u * 6, 2, 0.04);
        broadleaf(f, f.stage * (0.2 + rnd() * 0.15), horizon + u * 24, u * 6);
      }
      break;
    default: // moor, and anywhere else: low rolling land and old stones
      ridge(f, horizon + u * 4, u * 7, 1.6, 0.66);
      ridge(f, horizon + u * 13, u * 6, 2.2, 0.38);
      if (near) {
        solid(f, 0.04);
        ridge(f, horizon + u * 27, u * 5, 3, 0.04);
        const sx = f.stage * (0.24 + rnd() * 0.2);
        for (let i = 0; i < 3; i++) poly(f, [[sx + i * u * 4, horizon + u * 24], [sx + i * u * 4 + u * 0.6, horizon + u * (14 + rnd() * 5)],
                                             [sx + i * u * 4 + u * 2.2, horizon + u * (15 + rnd() * 4)], [sx + i * u * 4 + u * 2.6, horizon + u * 24]]);
      }
  }
}

// ── the scenes ───────────────────────────────────────────────────────

// How a settlement fills its backdrop, by its size: rows of houses, how
// tall, the gaps between (the usual, and a wide one now and then, so often),
// spires, towers among a city's middle rank; for a harbour, how far its
// warehouses run and how many boats are tied up.
const TOWN: Record<string, { rows: number; tall: number; broad: number; gap: [number, number]; wide: number; spires: number; towers: number; quay: number; boats: number }> = {
  hamlet: { rows: 1, tall: 0.62, broad: 1.35, gap: [6, 14], wide: 0.5, spires: 0, towers: 0, quay: 0.12, boats: 1 },
  village: { rows: 2, tall: 0.85, broad: 1.15, gap: [2.5, 9], wide: 0.35, spires: 1, towers: 0, quay: 0.2, boats: 2 },
  town: { rows: 2, tall: 1, broad: 1, gap: [0.4, 3], wide: 0.2, spires: 1, towers: 0, quay: 0.3, boats: 3 },
  city: { rows: 3, tall: 1.4, broad: 0.95, gap: [0.25, 1.2], wide: 0.12, spires: 2, towers: 0.14, quay: 0.38, boats: 4 },
};

const DRAW: Record<string, (f: Frame, s: Setting) => void> = {
  tavern(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.17);
    const ww = u * 24, wh = u * 30, wy = H * 0.2;
    windowPane(f, cx - ww / 2, wy, ww, wh, 2, 3, u * 0.75);
    if (rnd() < 0.6) windowPane(f, cx - ww * 1.75, wy + u * 4, ww * 0.55, wh * 0.7, 2, 2, u * 0.6);
    solid(f, 0.02);
    rect(f, cx - ww / 2 - u * 1.5, wy - u * 1.5, ww + u * 3, u * 1.6);
    rect(f, cx - ww / 2 - u * 1.2, wy + wh, ww + u * 2.4, u * 1.3);
    beams(f, H * 0.04, u * 3, [stage * 0.3, stage * 0.995]);
    // the hearth, to the right of the window
    const hx = stage * 0.86;
    solid(f, 0.07);
    rect(f, hx - u * 12, H * 0.46, u * 24, H * 0.54);
    poly(f, [[hx - u * 12, H * 0.46], [hx - u * 7, H * 0.36], [hx - u * 7, 0], [hx + u * 7, 0], [hx + u * 7, H * 0.36], [hx + u * 12, H * 0.46]]);
    solid(f, 0.0);
    arch(f, hx - u * 7.5, H * 0.68, u * 15, H * 0.32);
    glow(f, hx, H * 0.86, u * 52, 0.85);
    fire(f, hx, H * 0.95, u * 10, u * 9);
    solid(f, 0.0);
    rect(f, hx - u * 5.5, H * 0.94, u * 11, u * 1.4);
    rect(f, hx - u * 13.5, H * 0.64, u * 27, u * 2.2);
    for (let i = 0; i < 3; i++) rect(f, hx - u * (9 - i * 7), H * 0.64 - u * (2.6 + rnd() * 2), u * 1.8, u * 2.6);
    lantern(f, (cx + ww / 2 + hx - u * 12) / 2, H * 0.075, u * 11);
    // the bar along the left, the shelf behind it, the casks
    shelf(f, stage * 0.02, H * 0.56, cx - ww / 2 - stage * 0.04, "mugs");
    shelf(f, stage * 0.02, H * 0.44, cx - ww / 2 - stage * 0.04, "jars");
    solid(f, 0.0);
    rect(f, 0, H * 0.72, cx - ww * 0.3, u * 2.2);
    rect(f, 0, H * 0.74, cx - ww * 0.36, H * 0.26);
    barrel(f, cx - ww * 0.22, H, u * 7, u * 10);
    barrel(f, cx - ww * 0.22 + u * 7.6, H, u * 7, u * 10);
    barrel(f, cx - ww * 0.22 + u * 3.8, H - u * 10, u * 7, u * 9);
    // a table nearer, with its candle
    const tx = cx + ww * 0.62;
    candle(f, tx + u * 3, H * 0.83, u * 2.4);
    solid(f, 0.0);
    rect(f, tx - u * 12, H * 0.83, u * 24, u * 1.6);
    rect(f, tx - u * 10, H * 0.83, u * 1.4, H * 0.17);
    rect(f, tx + u * 8.6, H * 0.83, u * 1.4, H * 0.17);
    rect(f, tx - u * 4, H * 0.83 - u * 1.8, u * 1.6, u * 1.8);
    rect(f, tx - u * 16, H * 0.9, u * 32, u * 1.4);
  },

  temple(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.2);
    const w = u * 9, h = u * 40, gap = u * 6;
    for (const dx of [-1, 0, 1]) {
      const big = dx === 0;
      const ww = big ? w * 1.25 : w, hh = big ? h : h * 0.82;
      const x = cx + dx * (w + gap) * 1.25 - ww / 2, y = H * (big ? 0.16 : 0.24);
      windowPane(f, x, y, ww, hh, 2, 4, u * 0.55, "pointed");
      solid(f, 0.02);
      disc(f, x + ww / 2, y + ww * 0.62, ww * 0.16);
    }
    if (rnd() < 0.7) {
      cutting(f);
      disc(f, cx, H * 0.08, u * 4.4);
      solid(f, 0.02);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        line(f, cx, H * 0.08, cx + Math.cos(a) * u * 4.4, H * 0.08 + Math.sin(a) * u * 4.4, u * 0.45);
      }
      disc(f, cx, H * 0.08, u * 1.2);
    }
    // columns
    solid(f, 0.05);
    for (const x of [cx - (w + gap) * 2.6, cx + (w + gap) * 2.6]) {
      rect(f, x - u * 2.4, 0, u * 4.8, H);
      rect(f, x - u * 3.4, H * 0.12, u * 6.8, u * 1.6);
      rect(f, x - u * 3.6, H * 0.86, u * 7.2, u * 2);
    }
    // the altar with its candles
    solid(f, 0.0);
    rect(f, cx - u * 13, H * 0.8, u * 26, H * 0.2);
    rect(f, cx - u * 15, H * 0.79, u * 30, u * 1.8);
    for (let i = -3; i <= 3; i++) candle(f, cx + i * u * 3.6, H * 0.79, u * (1.8 + Math.abs(i) * 0.5 + rnd() * 0.6));
    solid(f, 0.0);
    rect(f, cx - u * 13, H * 0.8, u * 26, H * 0.2);
    // pews
    solid(f, 0.0);
    for (let r = 0; r < 2; r++) rect(f, 0, H * (0.9 + r * 0.05), stage * 0.42 - r * u * 8, u * 2.4);
  },

  forge(f) {
    const { u, H, stage, rnd } = f;
    wall(f, 0.13);
    // a small window on the left, the forge and its hood on the right
    const wx = stage * 0.36;
    windowPane(f, wx - u * 9, H * 0.26, u * 18, u * 14, 2, 2, u * 0.6);
    beams(f, H * 0.03, u * 2.6, [stage * 0.08]);
    const fx = stage * 0.8;
    solid(f, 0.05);
    poly(f, [[fx - u * 18, H * 0.5], [fx + u * 18, H * 0.5], [fx + u * 8, H * 0.16], [fx + u * 8, 0], [fx - u * 8, 0], [fx - u * 8, H * 0.16]]);
    rect(f, fx - u * 17, H * 0.64, u * 34, H * 0.36);
    solid(f, 0.0);
    rect(f, fx - u * 12, H * 0.66, u * 24, u * 11);
    glow(f, fx, H * 0.72, u * 70, 1);
    fire(f, fx, H * 0.77, u * 20, u * 9);
    fire(f, fx - u * 6, H * 0.77, u * 6, u * 5);
    solid(f, 0.0);
    rect(f, fx - u * 17, H * 0.77, u * 34, u * 1.4);
    // tongs and hammers by the forge
    for (let i = 0; i < 4; i++) {
      const x = fx - u * 24 - i * u * 3.2, y = H * 0.36;
      rect(f, x - u * 0.2, y, u * 0.4, u * (8 + rnd() * 3));
      if (i % 2) rect(f, x - u * 1.4, y + u * 8, u * 2.8, u * 1.6);
      else { line(f, x, y + u * 8, x - u * 1, y + u * 12, u * 0.35); line(f, x, y + u * 8, x + u * 1, y + u * 12, u * 0.35); }
    }
    solid(f, 0.02);
    rect(f, fx - u * 38, H * 0.36, u * 14, u * 0.7);
    // the anvil on its block, nearer, and the quench tub
    const ax = stage * 0.56;
    solid(f, 0.0);
    rect(f, ax - u * 3.4, H * 0.8, u * 6.8, H * 0.2);
    poly(f, [[ax - u * 11, H * 0.765], [ax + u * 7, H * 0.765], [ax + u * 10, H * 0.745], [ax + u * 10, H * 0.735], [ax - u * 7, H * 0.735],
             [ax - u * 7.5, H * 0.75], [ax - u * 11, H * 0.755]]);
    rect(f, ax - u * 4.5, H * 0.765, u * 9, u * 4);
    barrel(f, fx - u * 26, H, u * 9, u * 9);
    rect(f, 0, H * 0.96, f.W, H);
  },

  workshop(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.15);
    // a wide shutter propped open
    const ww = u * 30, wh = u * 19, wx = cx - ww / 2, wy = H * 0.26;
    windowPane(f, wx, wy, ww, wh, 3, 1, u * 0.6);
    solid(f, 0.02);
    poly(f, [[wx - u, wy - u * 0.5], [wx + ww + u, wy - u * 0.5], [wx + ww + u * 3, wy - u * 9], [wx + u, wy - u * 9.6]]);
    line(f, wx + ww * 0.2, wy, wx + ww * 0.3, wy - u * 8.6, u * 0.6);
    beams(f, H * 0.03, u * 2.6, [stage * 0.96]);
    // tools on pegs
    solid(f, 0.03);
    const tx = cx + ww * 0.62;
    rect(f, tx, H * 0.3, u * 18, u * 0.8);
    for (let i = 0; i < 5; i++) {
      const x = tx + u * (1.5 + i * 3.4), y = H * 0.31;
      if (i % 3 === 0) { rect(f, x - u * 0.25, y, u * 0.5, u * 8); rect(f, x - u * 1.6, y + u * 7, u * 3.2, u * 1.8); }
      else if (i % 3 === 1) { rect(f, x - u * 0.2, y, u * 0.4, u * 4); poly(f, [[x - u * 1.4, y + u * 4], [x + u * 1.4, y + u * 4], [x + u * 0.8, y + u * 11], [x - u * 0.8, y + u * 11]]); }
      else { line(f, x, y, x - u * 1.5, y + u * 9, u * 0.4); line(f, x, y, x + u * 1.5, y + u * 9, u * 0.4); }
    }
    // the bench, with its clutter
    solid(f, 0.0);
    rect(f, cx - ww * 0.7, H * 0.7, ww * 1.6, u * 2.2);
    rect(f, cx - ww * 0.65, H * 0.7, u * 1.6, H * 0.3);
    rect(f, cx + ww * 0.82, H * 0.7, u * 1.6, H * 0.3);
    for (let i = 0; i < 4; i++) rect(f, cx - ww * 0.5 + i * u * 8 + rnd() * u * 3, H * 0.7 - u * (1 + rnd() * 3), u * (2 + rnd() * 3), u * (1 + rnd() * 3));
    lantern(f, cx - ww * 0.62, H * 0.05, u * 12);
    // stacked stuff by the wall
    for (let i = 0; i < 3; i++) rect(f, stage * 0.04, H * (0.98 - i * 0.05), u * (22 - i * 4), u * 4);
  },

  shop(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.16);
    const ww = u * 15, wh = u * 18;
    windowPane(f, cx - ww / 2, H * 0.22, ww, wh, 3, 4, u * 0.45);
    solid(f, 0.02);
    rect(f, cx - ww / 2 - u * 1.2, H * 0.22 + wh, ww + u * 2.4, u * 1.4);
    beams(f, H * 0.03, u * 2.4, []);
    for (const [x0, x1] of [[stage * 0.03, cx - ww / 2 - u * 4], [cx + ww / 2 + u * 4, stage * 0.99]] as const) {
      for (let r = 0; r < 4; r++) shelf(f, x0, H * (0.24 + r * 0.13), x1 - x0, r % 2 ? "books" : "jars");
    }
    // the counter, a pair of scales on it
    solid(f, 0.0);
    rect(f, stage * 0.18, H * 0.76, stage * 0.8, u * 2.2);
    rect(f, stage * 0.2, H * 0.78, stage * 0.76, H * 0.22);
    const sx = cx - u * 8;
    rect(f, sx - u * 0.3, H * 0.76 - u * 9, u * 0.6, u * 9);
    rect(f, sx - u * 5, H * 0.76 - u * 9, u * 10, u * 0.5);
    for (const d of [-1, 1]) {
      line(f, sx + d * u * 4.6, H * 0.76 - u * 9, sx + d * u * 4.6, H * 0.76 - u * 4.6, u * 0.2);
      disc(f, sx + d * u * 4.6, H * 0.76 - u * 4.4, u * 2.2, u * 0.6);
    }
    candle(f, cx + u * 10, H * 0.76, u * 2.2);
    if (rnd() < 0.5) lantern(f, cx + ww, H * 0.05, u * 8);
  },

  hall(f) {
    const { u, H, stage, cx } = f;
    wall(f, 0.19);
    const w = u * 10, h = u * 34;
    for (const dx of [-1, 1]) windowPane(f, cx + dx * u * 13 - w / 2, H * 0.14, w, h, 2, 3, u * 0.6, "round");
    // banners between and beside
    for (const x of [cx, cx - u * 26, cx + u * 26]) {
      solid(f, 0.03);
      rect(f, x - u * 4, H * 0.1, u * 8, u * 0.8);
      poly(f, [[x - u * 3.4, H * 0.1], [x + u * 3.4, H * 0.1], [x + u * 3.4, H * 0.5], [x, H * 0.45], [x - u * 3.4, H * 0.5]]);
    }
    // columns
    solid(f, 0.05);
    for (const x of [stage * 0.08, stage * 0.98]) {
      rect(f, x - u * 3, 0, u * 6, H);
      rect(f, x - u * 4.2, H * 0.1, u * 8.4, u * 2);
    }
    // the dais and the high seat, a brazier either side
    solid(f, 0.0);
    rect(f, cx - u * 24, H * 0.86, u * 48, H * 0.14);
    rect(f, cx - u * 20, H * 0.82, u * 40, u * 4.2);
    poly(f, [[cx - u * 5, H * 0.82], [cx - u * 5, H * 0.56], [cx - u * 3.6, H * 0.53], [cx, H * 0.5], [cx + u * 3.6, H * 0.53], [cx + u * 5, H * 0.56], [cx + u * 5, H * 0.82]]);
    for (const d of [-1, 1]) {
      const bx = cx + d * u * 17;
      glow(f, bx, H * 0.66, u * 24, 0.85);
      solid(f, 0.0);
      poly(f, [[bx - u * 3, H * 0.68], [bx + u * 3, H * 0.68], [bx + u * 1.6, H * 0.71], [bx - u * 1.6, H * 0.71]]);
      rect(f, bx - u * 0.5, H * 0.71, u, u * 8);
      fire(f, bx, H * 0.68, u * 4.6, u * 4.2);
    }
  },

  keep(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.14);
    // the coursing of the stone
    solid(f, 0.11);
    for (let r = 0; r < 30; r++) {
      const y = r * u * 4.2;
      for (let x = (r % 2) * u * 5; x < f.W; x += u * 10) rect(f, x, y, u * 0.35, u * 4.2);
      rect(f, 0, y, f.W, u * 0.3);
    }
    for (const dx of [-u * 9, u * 9]) {
      cutting(f);
      rect(f, cx + dx - u * 0.9, H * 0.2, u * 1.8, u * 20);
      rect(f, cx + dx - u * 2.6, H * 0.28, u * 5.2, u * 1.4);
    }
    // a rack of spears, a shield on the wall
    solid(f, 0.02);
    const rx = cx + u * 22;
    rect(f, rx - u * 2, H * 0.84, u * 16, u * 1.2);
    for (let i = 0; i < 5; i++) {
      const x = rx + i * u * 3;
      line(f, x, H * 0.85, x, H * 0.28, u * 0.4);
      poly(f, [[x - u * 0.8, H * 0.28], [x, H * 0.23], [x + u * 0.8, H * 0.28]]);
    }
    disc(f, cx - u * 24, H * 0.42, u * 5);
    solid(f, 0.08);
    disc(f, cx - u * 24, H * 0.42, u * 1.4);
    // a brazier
    const bx = stage * 0.2;
    glow(f, bx, H * 0.72, u * 30, 0.8);
    solid(f, 0.0);
    poly(f, [[bx - u * 4, H * 0.74], [bx + u * 4, H * 0.74], [bx + u * 2, H * 0.78], [bx - u * 2, H * 0.78]]);
    rect(f, bx - u * 0.6, H * 0.78, u * 1.2, H * 0.22);
    fire(f, bx, H * 0.74, u * 6, u * 5 + rnd() * u);
    solid(f, 0.0);
    rect(f, 0, H * 0.94, f.W, H);
  },

  cell(f) {
    const { u, H, cx } = f;
    wall(f, 0.1);
    solid(f, 0.08);
    for (let r = 0; r < 30; r++) {
      const y = r * u * 5;
      for (let x = (r % 2) * u * 6; x < f.W; x += u * 12) rect(f, x, y, u * 0.35, u * 5);
      rect(f, 0, y, f.W, u * 0.3);
    }
    const w = u * 9, h = u * 7, x = cx - w / 2, y = H * 0.16;
    windowPane(f, x, y, w, h, 4, 1, u * 0.55);
    solid(f, 0.02);
    rect(f, x - u, y + h, w + u * 2, u * 1.2);
    // a ring and chain in the wall, straw on the floor
    solid(f, 0.03);
    f.ctx.lineWidth = u * 0.5;
    f.ctx.beginPath();
    f.ctx.arc(cx - u * 20, H * 0.6, u * 1.6, 0, Math.PI * 2);
    f.ctx.stroke();
    for (let i = 0; i < 8; i++) disc(f, cx - u * 20, H * 0.63 + i * u * 1.6, u * 0.55, u * 0.8);
    solid(f, 0.0);
    rect(f, 0, H * 0.92, f.W, H);
    for (let i = 0; i < 60; i++) line(f, f.rnd() * f.stage, H * 0.92, f.rnd() * f.stage, H * (0.89 + f.rnd() * 0.03), u * 0.2);
  },

  cottage(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.15);
    const w = u * 12, h = u * 12;
    windowPane(f, cx - w / 2, H * 0.3, w, h, 2, 2, u * 0.6);
    solid(f, 0.02);
    poly(f, [[cx - w / 2 - u * 0.4, H * 0.3], [cx - w / 2 - u * 5.5, H * 0.29], [cx - w / 2 - u * 5.5, H * 0.3 + h + u * 0.6], [cx - w / 2 - u * 0.4, H * 0.3 + h]]);
    poly(f, [[cx + w / 2 + u * 0.4, H * 0.3], [cx + w / 2 + u * 5.5, H * 0.29], [cx + w / 2 + u * 5.5, H * 0.3 + h + u * 0.6], [cx + w / 2 + u * 0.4, H * 0.3 + h]]);
    rect(f, cx - w / 2 - u, H * 0.3 + h, w + u * 2, u * 1.4);
    beams(f, H * 0.08, u * 3, [stage * 0.97]);
    // herbs hung from the beam
    solid(f, 0.02);
    for (let i = 0; i < 4; i++) {
      const x = cx - w * 1.6 + i * u * 3.2 + rnd() * u;
      line(f, x, H * 0.08 + u * 3, x, H * 0.08 + u * 6, u * 0.2);
      poly(f, [[x - u * 1.1, H * 0.08 + u * 6], [x + u * 1.1, H * 0.08 + u * 6], [x + u * 0.3, H * 0.08 + u * 11], [x - u * 0.3, H * 0.08 + u * 11]]);
    }
    // a hearth and its pot
    const hx = stage * 0.14;
    solid(f, 0.05);
    rect(f, hx - u * 10, H * 0.58, u * 20, H * 0.42);
    solid(f, 0.0);
    arch(f, hx - u * 6, H * 0.74, u * 12, H * 0.26);
    glow(f, hx, H * 0.88, u * 34, 0.7);
    fire(f, hx, H * 0.95, u * 7, u * 6);
    solid(f, 0.0);
    disc(f, hx, H * 0.86, u * 3, u * 2.4);
    line(f, hx, H * 0.74, hx, H * 0.84, u * 0.3);
    // a table and stool
    solid(f, 0.0);
    rect(f, cx - u * 6, H * 0.78, u * 26, u * 1.6);
    rect(f, cx - u * 4.6, H * 0.78, u * 1.4, H * 0.22);
    rect(f, cx + u * 17.6, H * 0.78, u * 1.4, H * 0.22);
    disc(f, cx + u * 6, H * 0.78 - u * 1.1, u * 2.6, u * 1.2);
    rect(f, cx - u * 14, H * 0.86, u * 7, u * 1.2);
    rect(f, cx - u * 13.4, H * 0.86, u * 1, H);
    rect(f, cx - u * 8.4, H * 0.86, u * 1, H);
  },

  barn(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.12);
    // light between the planks
    cutting(f);
    for (let x = u * 2; x < f.W; x += u * (3 + rnd() * 1.4)) {
      if (rnd() < 0.6) continue;
      const top = H * (0.1 + rnd() * 0.5), len = H * (0.04 + rnd() * 0.16);
      rect(f, x, top, Math.max(1, u * (0.06 + rnd() * 0.08)), len);
    }
    // the great door ajar
    cutting(f);
    rect(f, cx - u * 4, H * 0.24, u * 8, H * 0.66);
    solid(f, 0.03);
    poly(f, [[cx + u * 4, H * 0.24], [cx + u * 14, H * 0.2], [cx + u * 14, H * 0.94], [cx + u * 4, H * 0.9]]);
    line(f, cx + u * 4, H * 0.3, cx + u * 14, H * 0.86, u * 0.8);
    // rafters and a loft of hay
    solid(f, 0.0);
    rect(f, 0, 0, f.W, H * 0.05);
    poly(f, [[0, H * 0.05], [stage * 0.4, H * 0.05], [0, H * 0.32]]);
    rect(f, 0, H * 0.38, stage * 0.36, u * 2);
    const ctx = f.ctx;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.38);
    for (let x = 0; x <= stage * 0.34; x += u * 1.2) ctx.lineTo(x, H * 0.38 - u * (4 + rnd() * 3) * Math.sin((x / (stage * 0.34)) * Math.PI));
    ctx.lineTo(stage * 0.34, H * 0.38);
    ctx.closePath();
    ctx.fill();
    for (const x of [stage * 0.3, stage * 0.33]) line(f, x, H * 0.4, x + u * 4, H, u * 0.6);
    for (let i = 0; i < 6; i++) line(f, stage * 0.3 + i * u * 0.66, H * (0.46 + i * 0.09), stage * 0.33 + i * u * 0.66, H * (0.46 + i * 0.09), u * 0.5);
    for (let i = 0; i < 4; i++) disc(f, stage * (0.5 + i * 0.07), H * 0.97, u * 4, u * 5);
    rect(f, 0, H * 0.96, f.W, H);
    lantern(f, cx - u * 18, H * 0.05, u * 9);
  },

  cave(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.08);
    const n = noise1(rnd);
    // the passage going on, faintly lit, and darker where it goes deeper
    const blob = (x: number, y: number, rx: number, ry: number, haze: number, k: number) => {
      solid(f, haze);
      const ctx = f.ctx;
      ctx.beginPath();
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        const r = 0.7 + 0.32 * n(k + Math.cos(a) * 1.6 + 2) + 0.16 * n(k * 3 + Math.cos(a) * 5 + 9) * n(k + Math.sin(a) * 6 + 4) + 0.05 * n(i * 0.9 + k);
        ctx.lineTo(x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r);
      }
      ctx.closePath();
      ctx.fill();
    };
    blob(cx - u * 2, H * 0.55, u * 34, u * 27, 0.16, 0);
    blob(cx + u * 6, H * 0.5, u * 19, u * 15, 0.14, 7);
    blob(cx + u * 11, H * 0.47, u * 8, u * 6.5, 0.07, 13);
    blob(cx + u * 13, H * 0.46, u * 3, u * 2.6, 0.02, 21);
    // teeth of stone from above and below, nearer ones darker
    for (let layer = 0; layer < 2; layer++) {
      solid(f, layer ? 0.0 : 0.05);
      for (let x = -u * 2; x < f.W; x += u * (2 + rnd() * (layer ? 7 : 4))) {
        const top = layer ? 0 : H * 0.22, len = u * (4 + rnd() * (layer ? 24 : 10)), w = u * (1 + rnd() * (layer ? 3.4 : 2));
        if (!layer && Math.abs(x - cx) > u * 28) continue;
        poly(f, [[x - w, top], [x + w, top], [x + w * 0.1, top + len]]);
        const floor = layer ? H : H * 0.8;
        if (rnd() < 0.5) poly(f, [[x - w * 1.2, floor], [x + w * 1.2, floor], [x + w * 0.2, floor - len * 0.7]]);
      }
    }
    ridge(f, H * 0.93, u * 10, 7, 0.0, true);
    // the player's light, held low
    glow(f, stage * 0.78, H * 0.86, u * 62, 0.6);
  },

  mine(f) {
    const { u, H, cx } = f;
    wall(f, 0.06);
    const vy = H * 0.5;
    // frames of timber running into the dark
    for (let i = 6; i >= 0; i--) {
      const k = Math.pow(0.7, i);
      const w = u * 70 * k, h = u * 70 * k * 1.05;
      const x0 = cx - w / 2, y0 = vy - h / 2;
      solid(f, 0.3 * (1 - k) + 0.02);
      rect(f, x0, y0, w, h);
      solid(f, Math.max(0, 0.32 * (1 - Math.pow(0.7, i + 1)) - 0.02));
      rect(f, x0 + w * 0.12, y0 + h * 0.12, w * 0.76, h * 0.88);
      solid(f, 0.24 * (1 - k));
      rect(f, x0, y0, w * 0.12, h);
      rect(f, x0 + w * 0.88, y0, w * 0.12, h);
      rect(f, x0 - w * 0.04, y0, w * 1.08, h * 0.12);
    }
    // the rails
    solid(f, 0.02);
    for (const d of [-1, 1]) line(f, cx + d * u * 1.2, vy + u * 4, cx + d * u * 22, H, u * 0.6);
    for (let i = 0; i < 9; i++) {
      const t = Math.pow(i / 9, 1.6);
      const y = vy + u * 4 + (H - vy - u * 4) * t;
      line(f, cx - u * (1.6 + 22 * t), y, cx + u * (1.6 + 22 * t), y, u * (0.3 + t));
    }
    lantern(f, cx - u * 18, vy - u * 36, u * 4);
    glow(f, cx, vy, u * 10, 0.25);
  },

  crypt(f) {
    const { u, H, stage, cx, rnd } = f;
    wall(f, 0.06);
    // vaults running into the dark
    for (let i = 5; i >= 0; i--) {
      const k = Math.pow(0.72, i);
      const w = u * 60 * k, h = u * 76 * k;
      solid(f, 0.03 + 0.26 * (1 - k));
      arch(f, cx - w / 2 - u * 4 * k, H * 0.56 - h / 2 - u * 2 * k, w + u * 8 * k, h + u * 6 * k);
      solid(f, Math.min(0.34, 0.06 + 0.3 * (1 - Math.pow(0.72, i + 1))));
      arch(f, cx - w / 2, H * 0.56 - h / 2, w, h);
    }
    // niches in the near walls, candles burning low in some
    for (const side of [0, 1]) {
      for (let r = 0; r < 3; r++) {
        const x = side ? stage * 0.93 : stage * 0.05, y = H * (0.2 + r * 0.24);
        solid(f, 0.0);
        rect(f, x - u * 7, y - u * 3, u * 14, u * 20);
        solid(f, 0.04);
        arch(f, x - u * 5, y, u * 10, u * 12);
        if (rnd() < 0.4) candle(f, x, y + u * 12, u * 1.8);
      }
    }
    // a tomb before you
    solid(f, 0.0);
    rect(f, cx - u * 15, H * 0.82, u * 30, H * 0.18);
    rect(f, cx - u * 17, H * 0.8, u * 34, u * 2.4);
    candle(f, cx - u * 12, H * 0.8, u * 2);
    candle(f, cx + u * 12, H * 0.8, u * 2.4);
  },

  ruin(f, s) {
    const { u, H, stage, cx, rnd } = f;
    land(f, s.terrain, H * 0.66, false);
    // broken walls left and right, the stump of an arch between
    solid(f, 0.05);
    const jag = (x0: number, x1: number, top: number) => {
      const pts: [number, number][] = [[x0, H]];
      for (let x = x0; x <= x1; x += u * 2) pts.push([x, top + (rnd() - 0.3) * u * 8 + (x - x0) * (rnd() - 0.5) * 0.1]);
      pts.push([x1, H]);
      poly(f, pts);
    };
    jag(0, stage * 0.3, H * 0.18);
    jag(stage * 0.82, f.W, H * 0.3);
    const ax = cx - u * 4, spring = H * 0.42;
    solid(f, 0.06);
    rect(f, ax - u * 16, spring, u * 6, H - spring);
    rect(f, ax + u * 10, spring, u * 6, H - spring);
    f.ctx.lineWidth = u * 5;
    f.ctx.beginPath();
    f.ctx.arc(ax, spring, u * 13, Math.PI, Math.PI * 1.32);
    f.ctx.stroke();
    f.ctx.beginPath();
    f.ctx.arc(ax, spring, u * 13, Math.PI * 1.82, Math.PI * 2);
    f.ctx.stroke();
    rect(f, ax - u * 18, spring - u * 1.5, u * 10, u * 2.4);
    rect(f, ax + u * 8, spring - u * 1.5, u * 10, u * 2.4);
    cutting(f);
    windowPane(f, stage * 0.09, H * 0.34, u * 8, u * 18, 1, 1, 0, "round");
    solid(f, 0.03);
    for (let i = 0; i < 18; i++) disc(f, rnd() * f.W, H * (0.94 + rnd() * 0.06), u * (1.5 + rnd() * 4), u * (1 + rnd() * 2.5));
    rect(f, 0, H * 0.97, f.W, H);
    // ivy on the stones
    solid(f, 0.01);
    for (let i = 0; i < 40; i++) disc(f, stage * 0.3 * rnd(), H * (0.2 + rnd() * 0.5), u * (0.5 + rnd() * 1.2));
  },

  town(f, s) {
    const { u, H, W, rnd } = f;
    land(f, s.terrain === "sea" ? "coast" : s.terrain, H * 0.56, false);
    const horizon = H * 0.66, near = horizon + u * 14;
    // As big as the place: a hamlet's few low roofs among trees, a
    // village's two loose rows, a town's crowded ones, a city's three
    // ranks of tall houses with towers and spires.
    const k = TOWN[s.size ?? "town"] ?? TOWN.town;
    const rows: (readonly [number, number, number])[] = k.rows === 1 ? [[near, 1.05, 0.06]]
      : k.rows === 3 ? [[horizon - u * 6, 0.6, 0.62], [horizon, 0.9, 0.42], [near, 1.3, 0.06]] : [[horizon, 0.7, 0.5], [near, 1.25, 0.06]];
    rows.forEach(([base, scale, haze], r) => {
      const far = haze > 0.2;
      let x = k.rows === 1 ? f.cx - u * (40 + rnd() * 10) : -u * 3;
      const end = k.rows === 1 ? f.cx + u * (36 + rnd() * 10) : W;
      const spires = Array.from({ length: far ? k.spires : 0 }, (_, i) => f.cx + (i - (k.spires - 1) / 2) * u * 46 + (rnd() - 0.5) * u * 20);
      while (x < end) {
        const w = u * (6 + rnd() * 8) * scale * k.broad, h = u * (6 + rnd() * 7) * scale * k.tall;
        const top = base - h;
        solid(f, haze);
        // now and then, among a city's middle rank, a tower with battlements
        if (k.towers && r === 1 && rnd() < k.towers) {
          const tw = w * 0.7, tt = top - u * (10 + rnd() * 8);
          rect(f, x, tt, tw, H - tt);
          for (let b = 0; b < 4; b++) if (b % 2 === 0) rect(f, x + (tw / 4) * b, tt - u * 1.6, tw / 4, u * 1.6);
          x += tw + u * 0.4;
          continue;
        }
        rect(f, x, top, w, H - top);
        poly(f, [[x - u * 0.6, top], [x + w / 2, top - w * (0.35 + rnd() * 0.25)], [x + w + u * 0.6, top]]);
        if (rnd() < 0.55) rect(f, x + w * (0.15 + rnd() * 0.6), top - w * 0.42, u * 1.2 * scale, w * 0.3);
        if (haze < 0.2) for (let n = 0; n < 3; n++) if (rnd() < 0.42) lit(f, x + w * (0.15 + n * 0.28), top + h * (0.25 + rnd() * 0.3), u * 1.4 * scale, u * 1.9 * scale);
        // each spire once, on the house it rises from
        for (const [i, spire] of spires.entries()) {
          if (spire < x || spire >= x + w) continue;
          spires[i] = -Infinity;
          solid(f, haze);
          rect(f, x + w / 2 - u * 2.5, top - u * 18, u * 5, u * 18);
          poly(f, [[x + w / 2 - u * 3.2, top - u * 18], [x + w / 2, top - u * 34], [x + w / 2 + u * 3.2, top - u * 18]]);
        }
        const gap = u * (rnd() < k.wide ? k.gap[1] : k.gap[0]) * (0.6 + rnd() * 0.8);
        // in the gaps of a small place, its trees
        if (gap > u * 5 && !far) {
          solid(f, haze + 0.02);
          broadleaf(f, x + w + gap / 2, base + u * 1, u * (2.4 + rnd() * 1.6) * scale);
        }
        x += w + gap;
      }
    });
    solid(f, 0.02);
    rect(f, 0, H * 0.95, W, H);
  },

  harbour(f, s) {
    const { u, H, W, stage, rnd } = f;
    const k = TOWN[s.size ?? "town"] ?? TOWN.town;
    const sea = H * 0.62;
    solid(f, 0.5);
    rect(f, 0, sea, W, H);
    cutting(f);
    for (let i = 0; i < 26; i++) {
      const y = sea + u * (1 + rnd() * 26);
      rect(f, rnd() * W, y, u * (2 + rnd() * 10) * (1 + (y - sea) / (u * 10)), u * 0.2);
    }
    // a far headland, warehouses on the left
    ridge(f, sea + u * 0.4, u * 4, 2, 0.62, false, W * 0.55, W);
    solid(f, 0.08);
    let x = -u * 2;
    while (x < stage * k.quay) {
      const w = u * (8 + rnd() * 6), h = u * (10 + rnd() * 6) * k.tall;
      rect(f, x, sea - h + u * 6, w, H);
      poly(f, [[x - u * 0.5, sea - h + u * 6], [x + w / 2, sea - h + u * 6 - w * 0.4], [x + w + u * 0.5, sea - h + u * 6]]);
      if (rnd() < 0.6) lit(f, x + w * 0.35, sea - h + u * 9, u * 1.6, u * 2);
      x += w + u * 0.5;
    }
    // masts of the boats tied up, more of them in a bigger port
    for (let i = 0; i < k.boats; i++) {
      const mx = stage * ((k.boats > 3 ? 0.44 : 0.48) + i * (k.boats > 3 ? 0.135 : 0.16) + rnd() * 0.03), top = H * (0.14 + rnd() * 0.12);
      solid(f, 0.03);
      line(f, mx, sea + u * 8, mx, top, u * 0.55);
      line(f, mx - u * 7, top + u * 8, mx + u * 7, top + u * 8, u * 0.4);
      // the shrouds come down to the gunwale, each end of the deck
      line(f, mx, top, mx - u * 8.4, sea + u * 6.1, u * 0.16);
      line(f, mx, top, mx + u * 9.4, sea + u * 6.1, u * 0.16);
      poly(f, [[mx - u * 9, sea + u * 6], [mx + u * 10, sea + u * 6], [mx + u * 7, sea + u * 10], [mx - u * 7, sea + u * 10]]);
    }
    // the quay
    solid(f, 0.0);
    rect(f, 0, H * 0.82, W, H);
    for (let i = 0; i < 4; i++) {
      const bx = stage * (0.15 + i * 0.22);
      rect(f, bx - u * 1.2, H * 0.78, u * 2.4, u * 4);
      disc(f, bx, H * 0.78, u * 1.6, u * 0.8);
    }
    lantern(f, stage * 0.88, H * 0.5, u * 1);
    solid(f, 0.0);
    rect(f, stage * 0.88 - u * 0.4, H * 0.5, u * 0.8, H * 0.32);
  },

  deck(f) {
    const { u, H, W, stage, cx } = f;
    const sea = H * 0.6;
    solid(f, 0.46);
    rect(f, 0, sea, W, H);
    cutting(f);
    for (let i = 0; i < 30; i++) {
      const y = sea + u * (1 + f.rnd() * 26);
      rect(f, f.rnd() * W, y, u * (2 + f.rnd() * 12) * (1 + (y - sea) / (u * 10)), u * 0.2);
    }
    // the mast, its yard and a sail, the shrouds
    const mx = stage * 0.78;
    solid(f, 0.03);
    rect(f, mx - u * 1.1, 0, u * 2.2, H);
    rect(f, mx - u * 26, H * 0.12, u * 52, u * 1.4);
    const ctx = f.ctx;
    ctx.beginPath();
    ctx.moveTo(mx - u * 25, H * 0.13);
    ctx.quadraticCurveTo(mx - u * 18, H * 0.34, mx - u * 22, H * 0.5);
    ctx.lineTo(mx + u * 22, H * 0.5);
    ctx.quadraticCurveTo(mx + u * 26, H * 0.32, mx + u * 25, H * 0.13);
    ctx.closePath();
    solid(f, 0.07);
    ctx.fill();
    solid(f, 0.02);
    for (const d of [-1, 1]) for (let k = 0; k < 4; k++) line(f, mx, H * 0.06, mx + d * u * (16 + k * 3), H * 0.86, u * 0.18);
    // the rail
    solid(f, 0.0);
    rect(f, 0, H * 0.84, W, H);
    rect(f, 0, H * 0.78, W, u * 1.6);
    for (let x = u * 2; x < W; x += u * 8) rect(f, x, H * 0.78, u * 1.4, H * 0.08);
    lantern(f, cx - u * 20, H * 0.62, u * 1);
    solid(f, 0.0);
    rect(f, cx - u * 20.4, H * 0.62, u * 0.8, H * 0.16);
  },

  land(f, s) {
    land(f, s.terrain, f.H * 0.62);
  },
};

// ── a little randomness, the same for the same place ─────────────────

function mulberry(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth noise along a line, 0..1.
function noise1(rnd: () => number): (x: number) => number {
  const table = Array.from({ length: 256 }, () => rnd());
  return (x: number) => {
    const i = Math.floor(x), t = x - i;
    const a = table[((i % 256) + 256) % 256], b = table[(((i + 1) % 256) + 256) % 256];
    const s = t * t * (3 - 2 * t);
    return a + (b - a) * s;
  };
}
