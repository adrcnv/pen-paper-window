import type { Atlas, AtlasTown } from "../core/protocol.ts";
import { h } from "./dom.ts";

// The realm drawn from the world server's atlas: shaded land and sea, the
// coast traced from the heights, rivers, forests and peaks, kingdoms tinted
// by whose town is nearest, and the towns by size. Everything is drawn from
// the data; nothing is decoration the world does not hold.

type RGB = [number, number, number];

const LAND: Record<string, RGB> = {
  c: [148, 136, 104], // coast: sand and shingle
  v: [98, 128, 74], //   river valley
  m: [74, 98, 82], //    marsh
  f: [114, 136, 80], //  floodplain
  g: [110, 130, 76], //  grassland
  o: [124, 112, 82], //  moor
  t: [64, 96, 60], //    lowland forest
  T: [56, 82, 62], //    upland forest
  n: [116, 110, 100], // crags
  "^": [172, 168, 160], // mountain
};
const SHALLOW: RGB = [44, 74, 100];
const DEEP: RGB = [12, 22, 40];
const INK = "rgba(10, 12, 16, 0.85)";
const KINGDOM: RGB[] = [[200, 118, 88], [118, 140, 200], [196, 168, 84], [160, 112, 180], [96, 170, 146], [200, 110, 134], [150, 150, 150]];
const SIZE_R: Record<string, number> = { hamlet: 2.2, village: 2.9, town: 3.7, city: 4.8 };

export interface Placed {
  town: AtlasTown;
  x: number; // css pixels within the canvas
  y: number;
}

// Draws the atlas onto `canvas` (sized in device pixels); returns where each
// town landed, in css pixels, for hovering and the you-are-here mark.
export function drawAtlas(canvas: HTMLCanvasElement, a: Atlas, dpr: number): Placed[] {
  const ctx = canvas.getContext("2d")!;
  const px = canvas.width;
  const n = a.cells;
  const cell = px / n;
  const unit = px / a.size; // device pixels per map unit
  const sea = a.sea_level / 1000;
  const h = (c: number, r: number) => a.height[Math.max(0, Math.min(n - 1, r)) * n + Math.max(0, Math.min(n - 1, c))] / 1000;
  const land = (i: number) => a.terrain[i] !== "~";

  // Which kingdom each cell falls to: that of the nearest town.
  const towns = a.towns.filter((t) => t.kingdom != null);
  const realm = new Int16Array(n * n).fill(-1);
  if (towns.length) {
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      const x = ((c + 0.5) * a.size) / n, y = ((r + 0.5) * a.size) / n;
      let best = Infinity, k = -1;
      for (const t of towns) {
        const d = (t.x - x) ** 2 + (t.y - y) ** 2;
        if (d < best) { best = d; k = t.kingdom!; }
      }
      realm[r * n + c] = k;
    }
  }

  // 1. The ground, one pixel a cell, shaded from the north-west, then
  // spread smooth over the canvas.
  const base = document.createElement("canvas");
  base.width = base.height = n;
  const bctx = base.getContext("2d")!;
  const img = bctx.createImageData(n, n);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const i = r * n + c;
    const e = a.height[i] / 1000;
    let col: RGB;
    if (!land(i)) {
      const depth = Math.min(1, Math.max(0, (sea - e) / sea));
      col = mix(SHALLOW, DEEP, Math.sqrt(depth));
    } else {
      const shade = clamp(0.5 + (-(h(c + 1, r) - h(c - 1, r)) - (h(c, r + 1) - h(c, r - 1))) * 7, 0, 1);
      const relief = clamp((e - sea) / (1 - sea), 0, 1);
      col = scale(lighten(LAND[a.terrain[i]] ?? LAND.g, relief * 0.22), 0.7 + 0.6 * shade);
      const k = realm[i];
      if (k >= 0) col = mix(col, KINGDOM[k % KINGDOM.length], 0.12);
    }
    img.data.set([col[0], col[1], col[2], 255], i * 4);
  }
  bctx.putImageData(img, 0, 0);
  ctx.fillStyle = `rgb(${DEEP.join(",")})`;
  ctx.fillRect(0, 0, px, px);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = `blur(${(cell * 0.45).toFixed(1)}px)`; // one land runs into the next; the coast is inked after
  ctx.drawImage(base, 0, 0, px, px);
  ctx.filter = "none";
  grain(ctx, px, dpr);

  const at = (x: number, y: number): [number, number] => [(x + 0.5) * cell, (y + 0.5) * cell];
  const stroke = (style: string, width: number, dash: number[] = []) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width * dpr;
    ctx.setLineDash(dash.map((d) => d * dpr));
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // 2. Ripples off the shore, then the coast itself in ink.
  for (const [drop, alpha] of [[0.03, 0.08], [0.015, 0.16]] as const) {
    ctx.beginPath();
    contour(n, (c, r) => h(c, r), sea - drop, (x1, y1, x2, y2) => { ctx.moveTo(...at(x1, y1)); ctx.lineTo(...at(x2, y2)); });
    stroke(`rgba(170, 205, 225, ${alpha})`, 1);
  }
  ctx.beginPath();
  contour(n, (c, r) => h(c, r), sea, (x1, y1, x2, y2) => { ctx.moveTo(...at(x1, y1)); ctx.lineTo(...at(x2, y2)); });
  stroke(INK, 1.6);

  // 3. Borders between kingdoms, on land only.
  const kingdoms = [...new Set(towns.map((t) => t.kingdom!))];
  ctx.beginPath();
  for (const k of kingdoms) {
    contour(n, (c, r) => (realm[clampI(r, n) * n + clampI(c, n)] === k ? 1 : 0), 0.5, (x1, y1, x2, y2) => {
      const mx = Math.round((x1 + x2) / 2), my = Math.round((y1 + y2) / 2);
      if (h(mx, my) < sea + 0.01) return;
      ctx.moveTo(...at(x1, y1));
      ctx.lineTo(...at(x2, y2));
    });
  }
  stroke("rgba(230, 210, 170, 0.32)", 1, [3, 3]);

  // 4. Lakes, then rivers curving through their points, thin at the spring
  // and broad at the mouth.
  for (const [x, y] of a.lakes) {
    ctx.beginPath();
    ctx.ellipse(x * unit, y * unit, 1.2 * unit, 0.85 * unit, 0.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(78, 128, 164, 0.95)";
    ctx.fill();
    stroke("rgba(150, 196, 222, 0.6)", 0.8);
  }
  for (const river of a.rivers) {
    const p = river.map(([x, y]) => [x * unit, y * unit]);
    const mid = (i: number) => [(p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2];
    for (let i = 0; i < p.length - 1; i++) {
      const from = i === 0 ? p[0] : mid(i - 1), to = mid(i);
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      ctx.quadraticCurveTo(p[i][0], p[i][1], to[0], to[1]);
      if (i === p.length - 2) ctx.lineTo(p[i + 1][0], p[i + 1][1]);
      stroke("rgba(124, 182, 218, 0.92)", 0.7 + (2.3 * (i + 1)) / p.length);
    }
  }

  // 5. Marks of the land: trees, peaks, reeds, kept clear of the towns.
  const near = (x: number, y: number) => a.towns.some((t) => (t.x - x) ** 2 + (t.y - y) ** 2 < 9);
  for (let r = 1; r < n - 1; r += 2) for (let c = 1; c < n - 1; c += 2) {
    const j = hash(c, r);
    const cc = Math.min(n - 1, c + (j % 2)), rr = Math.min(n - 1, r + ((j >> 1) % 2));
    const t = a.terrain[rr * n + cc];
    const mx = ((cc + 0.5) * a.size) / n, my = ((rr + 0.5) * a.size) / n;
    if (near(mx, my)) continue;
    const [x, y] = at(cc + ((j >> 2) % 7) / 10 - 0.3, rr + ((j >> 5) % 7) / 10 - 0.3);
    if ((t === "t" || t === "T") && j % 5 < 3) tree(ctx, x, y, cell, t === "T", dpr);
    else if ((t === "^" || (t === "n" && j % 3 === 0)) && (c + r) % 4 === 0) peak(ctx, x, y, cell * (t === "^" ? 2.4 : 1.6), dpr);
    else if (t === "m" && j % 4 === 0) reed(ctx, x, y, cell, dpr);
  }

  // 6. Kingdom names over their land, faint and wide.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const k of kingdoms) {
    let sx = 0, sy = 0, count = 0;
    for (let i = 0; i < n * n; i++) if (realm[i] === k && land(i)) { sx += i % n; sy += Math.floor(i / n); count++; }
    if (!count || !a.kingdoms[k]) continue;
    const [x, y] = at(sx / count, sy / count);
    ctx.font = `${Math.round(px / 46)}px "Alegreya SC", Alegreya, Georgia, serif`;
    ctx.letterSpacing = `${Math.round(px / 160)}px`;
    ctx.fillStyle = "rgba(240, 225, 190, 0.26)";
    ctx.fillText(a.kingdoms[k].toUpperCase(), x, y);
  }
  ctx.letterSpacing = "0px";

  // 7. The towns, by size, named where the name fits.
  const placed: Placed[] = [];
  const boxes: [number, number, number, number][] = [];
  const order = [...a.towns].sort((p, q) => (SIZE_R[q.size ?? ""] ?? 2) - (SIZE_R[p.size ?? ""] ?? 2));
  for (const t of order) {
    const x = t.x * unit, y = t.y * unit;
    const r = (SIZE_R[t.size ?? ""] ?? 2.2) * dpr;
    boxes.push([x - r, y - r, x + r, y + r]);
  }
  for (const t of order) {
    const x = t.x * unit, y = t.y * unit;
    const r = (SIZE_R[t.size ?? ""] ?? 2.2) * dpr;
    // A place that is no town: a small lozenge, named only on hover.
    if (t.site) {
      const d = 2.6 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d * 0.8, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d * 0.8, y);
      ctx.closePath();
      ctx.fillStyle = t.you ? "#f2c66d" : "#c9b48a";
      ctx.fill();
      stroke(INK, 1);
      placed.push({ town: t, x: x / dpr, y: y / dpr });
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = t.you ? "#f2c66d" : "#ece0bd";
    ctx.fill();
    stroke(INK, 1.2);
    if (t.size === "city" || t.size === "town") {
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    }
    const big = t.size === "city" ? 1.18 : t.size === "town" ? 1.04 : 0.92;
    ctx.font = `${t.size === "city" ? "600 " : ""}${Math.round((px / 64) * big)}px Alegreya, Georgia, serif`;
    const w = ctx.measureText(t.name).width, th = (px / 64) * big;
    const spots: [number, number, CanvasTextAlign][] = [
      [x + r + 4 * dpr, y, "left"], [x - r - 4 * dpr, y, "right"], [x, y - r - th * 0.75, "center"], [x, y + r + th * 0.75, "center"],
    ];
    const box = ([sx, sy, align]: [number, number, CanvasTextAlign]): [number, number, number, number] => {
      const left = align === "left" ? sx : align === "right" ? sx - w : sx - w / 2;
      return [left, sy - th / 2, left + w, sy + th / 2];
    };
    const spot = spots.find((s) => {
      const b = box(s);
      return b[0] > 2 && b[2] < px - 2 && b[1] > 2 && b[3] < px - 2 && !boxes.some((o) => overlap(o, b));
    }) ?? spots[0];
    boxes.push(box(spot));
    ctx.textAlign = spot[2];
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.2 * dpr;
    ctx.strokeStyle = "rgba(8, 10, 14, 0.8)";
    ctx.strokeText(t.name, spot[0], spot[1]);
    ctx.fillStyle = t.you ? "#f2c66d" : "#efe6cf";
    ctx.fillText(t.name, spot[0], spot[1]);
    placed.push({ town: t, x: x / dpr, y: y / dpr });
  }

  compass(ctx, px - px * 0.07, px * 0.075, px * 0.035, dpr);
  return placed;
}

// The map as the overlay shows it: the drawing, a pulse where you are, and
// a card for the town under the pointer. It is drawn once at the closest
// zoom, so it stays sharp: the wheel zooms about the pointer, a drag moves
// it, a double click goes in, and the buttons in the corner zoom or set it
// back.
const ZOOM = 2.5;
export function atlasView(a: Atlas): HTMLElement {
  const css = Math.floor(Math.min(window.innerWidth * 0.9 - 60, window.innerHeight * 0.88 - 56));
  const dpr = window.devicePixelRatio || 1;
  const big = Math.min(4096, Math.round(css * ZOOM * dpr));
  const canvas = h("canvas", { class: "atlas-canvas", "aria-label": "Map of the realm" });
  canvas.width = canvas.height = big;
  const placed = drawAtlas(canvas, a, big / css); // in the fitted map's pixels
  const card = h("div", { class: "atlas-card" });
  card.hidden = true;
  const sheet = h("div", { class: "atlas-sheet" }, canvas);
  const ring = h("div", { class: "atlas-you" });
  const you = placed.find((p) => p.town.you);
  if (you) sheet.append(ring);
  const zoomIn = h("button", { type: "button", "aria-label": "Zoom in" }, "+");
  const zoomOut = h("button", { type: "button", "aria-label": "Zoom out" }, "−");
  const home = h("button", { type: "button", "aria-label": "Fit the map" }, "⤢");
  const view = h("div", { class: "atlas" }, sheet, card, h("div", { class: "atlas-zoom" }, zoomIn, zoomOut, home));
  view.style.width = view.style.height = `${css}px`;

  let z = 1, ox = 0, oy = 0; // shown at css*z pixels, moved by ox, oy
  const k = () => z; // from the fitted map's pixels to the screen's
  const clampPan = () => {
    ox = Math.min(0, Math.max(css - css * z, ox));
    oy = Math.min(0, Math.max(css - css * z, oy));
  };
  const paint = (smooth = false) => {
    sheet.style.transition = smooth ? "transform 0.35s cubic-bezier(.2, .8, .3, 1)" : "none";
    canvas.style.width = canvas.style.height = `${css}px`;
    sheet.style.transform = `translate(${ox}px, ${oy}px) scale(${k()})`;
    if (you) {
      ring.style.left = `${you.x}px`;
      ring.style.top = `${you.y}px`;
      ring.style.transform = `scale(${1 / k()})`;
    }
    view.classList.toggle("zoomed", z > 1.01);
  };
  const zoomAt = (mx: number, my: number, to: number, smooth = false) => {
    const nz = Math.max(1, Math.min(ZOOM, to));
    ox = mx - ((mx - ox) * nz) / z;
    oy = my - ((my - oy) * nz) / z;
    z = nz;
    clampPan();
    paint(smooth);
  };
  paint();

  const local = (e: MouseEvent) => {
    const r = view.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  view.addEventListener("wheel", (e) => {
    e.preventDefault();
    const m = local(e);
    zoomAt(m.x, m.y, z * Math.exp(-e.deltaY * 0.0016));
  }, { passive: false });
  view.addEventListener("dblclick", (e) => {
    const m = local(e);
    zoomAt(m.x, m.y, z * 1.8, true);
  });
  zoomIn.addEventListener("click", () => zoomAt(css / 2, css / 2, z * 1.5, true));
  zoomOut.addEventListener("click", () => zoomAt(css / 2, css / 2, z / 1.5, true));
  home.addEventListener("click", () => zoomAt(css / 2, css / 2, 1, true));
  let drag: { x: number; y: number; ox: number; oy: number } | null = null;
  view.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest(".atlas-zoom")) return;
    drag = { x: e.clientX, y: e.clientY, ox, oy };
    view.setPointerCapture(e.pointerId);
    view.classList.add("dragging");
  });
  view.addEventListener("pointerup", () => {
    drag = null;
    view.classList.remove("dragging");
  });

  view.addEventListener("pointermove", (e) => {
    if (drag) {
      ox = drag.ox + e.clientX - drag.x;
      oy = drag.oy + e.clientY - drag.y;
      clampPan();
      paint();
      card.hidden = true;
      return;
    }
    const m = local(e);
    const hit = placed.map((p) => ({ p, d: (ox + p.x * k() - m.x) ** 2 + (oy + p.y * k() - m.y) ** 2 })).sort((p, q) => p.d - q.d)[0];
    if (!hit || hit.d > 14 ** 2) return void (card.hidden = true);
    const t = hit.p.town;
    card.replaceChildren(...[
      h("div", { class: "name" }, t.name),
      ...(t.site ? [] : [
        h("div", null, [t.size, t.basis].filter(Boolean).join(" · ")),
        h("div", { class: "muted" }, [t.kingdom != null ? a.kingdoms[t.kingdom] : "no kingdom", t.terrain?.replace(/_/g, " ")].filter(Boolean).join(" · ")),
      ]),
      ...(t.you ? [h("div", { class: "here" }, "you are here")] : []),
    ]);
    card.style.left = `${Math.min(ox + hit.p.x * k() + 14, css - 190)}px`;
    card.style.top = `${Math.max(oy + hit.p.y * k() - 10, 0)}px`;
    card.hidden = false;
  });
  view.addEventListener("mouseleave", () => (card.hidden = true));
  return view;
}

// Marching squares: each crossing of `level` between four neighbouring
// samples, as a segment in cell coordinates.
function contour(n: number, v: (c: number, r: number) => number, level: number, emit: (x1: number, y1: number, x2: number, y2: number) => void): void {
  for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) {
    const tl = v(c, r), tr = v(c + 1, r), br = v(c + 1, r + 1), bl = v(c, r + 1);
    const idx = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const t = (p: number, q: number) => (p === q ? 0.5 : (level - p) / (q - p));
    const top: [number, number] = [c + t(tl, tr), r], right: [number, number] = [c + 1, r + t(tr, br)];
    const bottom: [number, number] = [c + t(bl, br), r + 1], left: [number, number] = [c, r + t(tl, bl)];
    const seg = (p: [number, number], q: [number, number]) => emit(p[0], p[1], q[0], q[1]);
    switch (idx) {
      case 1: case 14: seg(left, bottom); break;
      case 2: case 13: seg(bottom, right); break;
      case 3: case 12: seg(left, right); break;
      case 4: case 11: seg(top, right); break;
      case 6: case 9: seg(top, bottom); break;
      case 7: case 8: seg(left, top); break;
      case 5: seg(top, right); seg(left, bottom); break;
      case 10: seg(left, top); seg(bottom, right); break;
    }
  }
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, upland: boolean, dpr: number): void {
  const s = cell * 0.62;
  ctx.beginPath();
  if (upland) {
    ctx.moveTo(x, y - s * 1.5);
    ctx.lineTo(x + s * 0.8, y + s * 0.5);
    ctx.lineTo(x - s * 0.8, y + s * 0.5);
    ctx.closePath();
  } else {
    ctx.arc(x, y - s * 0.3, s * 0.8, 0, Math.PI * 2);
  }
  ctx.fillStyle = upland ? "rgba(30, 52, 38, 0.75)" : "rgba(36, 62, 36, 0.7)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.4);
  ctx.lineTo(x, y + s * 1.0);
  ctx.strokeStyle = "rgba(20, 24, 18, 0.6)";
  ctx.lineWidth = 0.8 * dpr;
  ctx.stroke();
}

function peak(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dpr: number): void {
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x, y - s * 0.7);
  ctx.lineTo(x + s, y + s * 0.5);
  ctx.closePath();
  ctx.fillStyle = "rgba(200, 196, 186, 0.55)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.7);
  ctx.lineTo(x + s, y + s * 0.5);
  ctx.lineTo(x + s * 0.15, y + s * 0.5);
  ctx.closePath();
  ctx.fillStyle = "rgba(40, 40, 44, 0.45)";
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - s, y + s * 0.5);
  ctx.lineTo(x, y - s * 0.7);
  ctx.lineTo(x + s, y + s * 0.5);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.9 * dpr;
  ctx.stroke();
}

function reed(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, dpr: number): void {
  ctx.beginPath();
  for (const dx of [-0.5, 0, 0.5]) {
    ctx.moveTo(x + dx * cell, y);
    ctx.lineTo(x + dx * cell * 1.3, y - cell * 0.9);
  }
  ctx.strokeStyle = "rgba(150, 175, 150, 0.45)";
  ctx.lineWidth = 0.7 * dpr;
  ctx.stroke();
}

function compass(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, dpr: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(240, 220, 170, 0.55)";
  ctx.fillStyle = "rgba(240, 220, 170, 0.55)";
  ctx.lineWidth = 1 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, s, 0, Math.PI * 2);
  ctx.stroke();
  for (const [ax, ay, len] of [[0, -1, 1.5], [0, 1, 0.9], [1, 0, 0.9], [-1, 0, 0.9]] as const) {
    ctx.beginPath();
    ctx.moveTo(x + ay * s * 0.22, y - ax * s * 0.22);
    ctx.lineTo(x + ax * s * len, y + ay * s * len);
    ctx.lineTo(x - ay * s * 0.22, y + ax * s * 0.22);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = `${Math.round(s * 0.8)}px "Alegreya SC", Alegreya, Georgia, serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("N", x, y - s * 1.55);
  ctx.restore();
}

// A faint grain over everything, so the colour reads as pigment, not pixels.
function grain(ctx: CanvasRenderingContext2D, px: number, dpr: number): void {
  const tile = document.createElement("canvas");
  tile.width = tile.height = 96;
  const t = tile.getContext("2d")!;
  const img = t.createImageData(96, 96);
  for (let i = 0; i < 96 * 96; i++) {
    const v = hash(i % 96, Math.floor(i / 96)) % 255;
    img.data.set([v, v, v, 14], i * 4);
  }
  t.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.scale(dpr, dpr);
  ctx.fillStyle = ctx.createPattern(tile, "repeat")!;
  ctx.fillRect(0, 0, px / dpr, px / dpr);
  ctx.restore();
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampI = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
const mix = (p: RGB, q: RGB, k: number): RGB => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, p[2] + (q[2] - p[2]) * k];
const scale = (p: RGB, k: number): RGB => [clamp(p[0] * k, 0, 255), clamp(p[1] * k, 0, 255), clamp(p[2] * k, 0, 255)];
const lighten = (p: RGB, k: number): RGB => mix(p, [235, 230, 215], k);
const overlap = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
