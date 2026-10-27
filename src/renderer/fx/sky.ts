// The sky behind the story, drawn in WebGL from the world's own clock and
// weather: night to dawn to noon to dusk by the minute of the day, and the
// town's weather as clouds, rain, snow, fog or a storm with lightning. It
// eases from one state to the next instead of jumping. In front of it stands
// the backdrop of where the player is (backdrop.ts): the weather goes on
// behind it, seen through its windows and gaps, and the sun throws its light
// through them.
import { drawBackdrop, type Setting } from "./backdrop.ts";

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float; // mediump is half-float on some GPUs (AMD on Vulkan): the hashes behind stars, rain and snow lose every digit
uniform vec2 u_res;
uniform float u_time, u_sun, u_cloud, u_rain, u_snow, u_fog, u_storm, u_flash, u_out, u_fight;
uniform sampler2D u_mask, u_mask_old;
uniform float u_masked, u_fade, u_open, u_lamp, u_sway;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
// Falling streaks: slanted lanes, some with a drop, each a thin line whose
// head leads and whose tail fades above it.
float rainLayer(vec2 uv, float aspect, float lanes, float speed, float len, float width, float seed) {
  vec2 p = vec2(uv.x * aspect * lanes + uv.y * lanes * 0.16, uv.y * 1.6 + u_time * speed);
  float lane = floor(p.x);
  float y = fract(p.y + hash(vec2(lane, seed + 1.3)) * 9.0);
  float streak = (1.0 - smoothstep(0.0, len, y)) * smoothstep(0.0, 0.012, y);
  return step(0.5, hash(vec2(lane, seed))) * smoothstep(width, 0.0, abs(fract(p.x) - 0.5)) * streak;
}

// Where on the backdrop a point of the screen falls: on a deck the whole of
// it rolls a little with the sea.
vec2 maskUv(vec2 uv) {
  if (u_sway > 0.001) {
    float a = sin(u_time * 0.55) * 0.012 * u_sway;
    vec2 d = uv - vec2(0.5, -0.4);
    uv = vec2(0.5, -0.4) + vec2(d.x * cos(a) - d.y * sin(a), d.x * sin(a) + d.y * cos(a)) + vec2(0.0, sin(u_time * 0.8) * 0.004 * u_sway);
  }
  return vec2(uv.x, 1.0 - uv.y);
}
vec4 maskAt(vec2 uv) {
  vec2 p = maskUv(uv);
  vec4 now = texture2D(u_mask, p);
  if (u_fade > 0.999) return now;
  return mix(texture2D(u_mask_old, p), now, u_fade);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  float day = smoothstep(-0.18, 0.4, u_sun);
  float dusk = 1.0 - smoothstep(0.0, 0.32, abs(u_sun + 0.03));
  float golden = smoothstep(0.0, 0.12, u_sun) * (1.0 - smoothstep(0.25, 0.55, u_sun)); // the sun up but low

  // deep night, and by day a blue overhead over a warm haze at the horizon
  vec3 top = mix(vec3(0.006, 0.009, 0.030), vec3(0.30, 0.52, 0.82), day);
  vec3 bot = mix(vec3(0.022, 0.028, 0.065), vec3(0.97, 0.87, 0.70), day);
  top = mix(top, vec3(0.20, 0.12, 0.32), dusk * 0.7);
  bot = mix(bot, vec3(0.98, 0.50, 0.24), dusk * 0.85);
  bot = mix(bot, vec3(0.98, 0.72, 0.44), golden * 0.45);
  vec3 col = mix(bot, top, pow(uv.y, 0.75));

  // the sun by day, the moon by night, low in the frame
  vec2 sun = vec2(0.72, 0.18 + 0.55 * max(u_sun, -0.2));
  vec2 moon = vec2(0.28, 0.18 + 0.55 * max(-u_sun, -0.2));
  float clear = 1.0 - u_cloud * 0.85;
  vec2 d = (uv - sun) * vec2(aspect, 1.0);
  float r = length(d);
  vec3 sunCol = mix(vec3(1.0, 0.90, 0.70), vec3(1.0, 0.62, 0.32), max(dusk, golden));
  float sunUp = day * clear;
  col += sunCol * (smoothstep(0.042, 0.030, r) * 1.4 + pow(max(0.0, 1.0 - r * 1.5), 4.0) * 0.7 + pow(max(0.0, 1.0 - r * 0.55), 2.0) * 0.16) * sunUp;
  // a muted flare: ghosts strung from the sun through the middle, and a faint streak
  vec2 axis = vec2(0.5, 0.5) - sun;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 g = sun + axis * (0.6 + fi * 0.45);
    float size = 0.018 + 0.03 * fract(fi * 0.37 + 0.2);
    float gr = length((uv - g) * vec2(aspect, 1.0));
    vec3 tint = mix(vec3(1.0, 0.74, 0.46), vec3(0.56, 0.84, 0.88), fract(fi * 0.61));
    col += tint * (smoothstep(size, size * 0.55, gr) * 0.05 + smoothstep(size * 0.95, size * 0.9, gr) * smoothstep(size * 0.8, size * 0.9, gr) * 0.03) * sunUp;
  }
  col += sunCol * exp(-abs(d.y) * 85.0) * max(0.0, 1.0 - abs(d.x) * 1.5) * 0.07 * sunUp;
  col += vec3(0.80, 0.86, 1.0) * smoothstep(0.035, 0.028, length((uv - moon) * vec2(aspect, 1.0))) * (1.0 - day) * clear * 0.85;
  col += vec3(0.45, 0.5, 0.7) * pow(max(0.0, 1.0 - length((uv - moon) * vec2(aspect, 1.0)) * 3.0), 4.0) * (1.0 - day) * clear * 0.4;

  // stars
  vec2 sp = uv * vec2(aspect, 1.0) * 170.0;
  float s = hash(floor(sp));
  float twinkle = 0.55 + 0.45 * sin(u_time * (1.5 + s * 3.0) + s * 60.0);
  col += step(0.9965, s) * twinkle * (1.0 - day) * (1.0 - u_cloud) * smoothstep(0.25, 0.85, uv.y) * 0.95;

  // clouds
  vec2 cp = vec2(uv.x * aspect, uv.y * 1.6) * 1.9 + vec2(u_time * 0.010, 0.0);
  float c = fbm(cp + 0.6 * fbm(cp * 0.6 + vec2(0.0, u_time * 0.004)));
  float cover = smoothstep(0.62 - u_cloud * 0.45, 0.92 - u_cloud * 0.25, c + u_cloud * 0.18);
  vec3 lit = mix(vec3(0.04, 0.05, 0.08), vec3(0.86, 0.84, 0.80), day);
  lit = mix(lit, vec3(0.92, 0.55, 0.42), dusk * 0.55);
  lit = mix(lit, vec3(0.96, 0.78, 0.58), golden * 0.35);
  lit *= 1.0 - u_storm * 0.62;
  col = mix(col, lit, cover * (0.55 + 0.35 * u_cloud));

  // weather is full outdoors, and seen through a window indoors; with a
  // backdrop it is full everywhere, and the backdrop decides what is seen
  float out_ = u_masked > 0.5 ? 1.0 : mix(0.3, 1.0, u_out);

  // fog, thickest near the ground
  float f = fbm(vec2(uv.x * 2.6 + u_time * 0.018, uv.y * 5.0 - u_time * 0.004));
  col = mix(col, mix(vec3(0.09, 0.10, 0.12), vec3(0.70, 0.71, 0.70), day), clamp(u_fog * out_ * (1.05 - uv.y * 0.8) * (0.55 + 0.5 * f), 0.0, 0.92));

  // rain: fine streaks far off, and outdoors a nearer, heavier fall
  float rain = u_rain * out_;
  vec3 wet = mix(vec3(0.55, 0.62, 0.75), vec3(0.92, 0.95, 1.0), day);
  col += wet * rainLayer(uv, aspect, 70.0, 1.9, 0.07, 0.07, 2.3) * rain * 0.35;
  col += wet * rainLayer(uv, aspect, 28.0, 1.4, 0.13, 0.05, 5.9) * rain * u_out * 0.55;

  // snow: three layers drifting
  float flakes = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 q = vec2(uv.x * aspect, uv.y) * (7.0 + fi * 6.0) + vec2(sin(u_time * 0.4 + fi * 1.7) * 0.6, u_time * (0.5 + fi * 0.28));
    vec2 id = floor(q);
    vec2 o = vec2(hash(id), hash(id + 3.1)) - 0.5;
    flakes += smoothstep(0.07 - fi * 0.014, 0.0, length(fract(q) - 0.5 - o * 0.7)) * step(0.45, hash(id + 7.0));
  }
  col += flakes * u_snow * out_ * 0.75;

  col += u_flash * out_ * vec3(0.72, 0.76, 0.95) * (0.35 + 0.65 * uv.y);

  // indoors: the sky dims behind the window and lamplight warms the room
  float inside = 1.0 - u_out;
  col *= 1.0 - inside * 0.35;
  col += vec3(0.62, 0.34, 0.13) * inside * pow(1.0 - uv.y, 1.6) * mix(0.7, 0.25, day);

  // the backdrop: silhouettes lit by the room or hazed by distance, fires
  // that flicker, lamps lit at night, and light thrown through the gaps
  if (u_masked > 0.5) {
    vec4 m = maskAt(uv);
    float occ = m.a;
    vec3 aerial = mix(bot, top, 0.25) * mix(0.40, 0.66, day) + vec3(0.05, 0.06, 0.10) * (1.0 - day);
    aerial = mix(aerial, mix(vec3(0.09, 0.10, 0.12), vec3(0.62, 0.63, 0.64), day), u_fog * 0.6);
    vec3 room = mix(vec3(0.07, 0.065, 0.085), mix(bot, top, 0.5) * 0.58, day) * (1.0 - u_cloud * 0.3) * (1.0 - u_storm * 0.35)
              + vec3(0.36, 0.18, 0.07) * u_lamp * (1.0 - day * 0.55);
    vec3 dark = mix(vec3(0.010, 0.011, 0.018) + top * 0.03, vec3(0.003, 0.003, 0.006) + top * 0.02, u_open);
    // under the open sky by night the horizon keeps a little light, so the
    // land and the roofs stand against it
    col += vec3(0.09, 0.10, 0.16) * (1.0 - day) * u_open * pow(1.0 - uv.y, 1.1) * (0.5 + 0.5 * clear);
    vec3 sil = mix(dark, mix(room, aerial, u_open), clamp(m.r * mix(2.6, 1.1, u_open), 0.0, 1.0));
    float flick = 0.80 + 0.14 * noise(vec2(u_time * 2.7, uv.x * 3.0)) + 0.06 * sin(u_time * 11.0 + uv.y * 4.0);
    sil += vec3(1.0, 0.52, 0.20) * m.g * flick * 0.95 * (1.0 - day * 0.8 * u_open);
    sil += vec3(1.0, 0.76, 0.42) * m.b * (1.0 - day) * 0.9;
    sil += vec3(0.55, 0.60, 0.78) * u_flash * 0.16;
    bool bySun = u_sun > -0.05;
    // under a roof the light comes from high up and falls through the
    // windows; under the open sky, from the sun itself
    vec2 lp = mix(vec2((bySun ? sun.x : moon.x) + 0.12, 1.35), bySun ? sun : moon, u_open);
    float lightUp = bySun ? sunUp * (1.0 - u_storm * 0.7) * (1.0 - u_rain * 0.45) * (1.0 + golden * 0.6) : (1.0 - day) * clear * 0.22;
    float shafts = 0.0;
    if (lightUp > 0.01 || u_flash > 0.02) {
      vec2 step_ = (uv - lp) * (0.85 / 26.0);
      vec2 c = uv;
      float decay = 1.0;
      for (int i = 0; i < 26; i++) {
        c -= step_;
        shafts += (1.0 - maskAt(c).a) * decay;
        decay *= 0.94;
      }
      shafts /= 13.3;
    }
    vec3 rayCol = bySun ? sunCol : vec3(0.62, 0.70, 0.92);
    float rays = pow(shafts, mix(1.0, 1.8, u_open)) * (lightUp * mix(0.62, 0.22, u_open) + u_flash * 0.55) * mix(0.35 + 0.65 * occ, occ, u_open);
    col = mix(col, sil, occ) + rayCol * rays;
  }

  // a fight drains the colour to blood and dark
  float grey = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, vec3(grey * 1.25, grey * 0.42, grey * 0.36), u_fight * 0.6);

  gl_FragColor = vec4(col * mix(0.74, 1.0, day), 1.0);
}`;

export interface SkyState {
  sun: number; // -1 midnight .. 1 noon
  open: number; // 1 under the open sky, 0 under a roof (with a backdrop)
  lamp: number; // lamps lit indoors
  sway: number; // the backdrop rolls, as on a deck
  cloud: number;
  rain: number;
  snow: number;
  fog: number;
  storm: number;
  out: number; // 1 outdoors, 0 under a roof
  fight: number; // 1 while a fight is on
}

const WEATHER: Record<string, Omit<SkyState, "sun" | "out" | "fight" | "open" | "lamp" | "sway">> = {
  clear: { cloud: 0.05, rain: 0, snow: 0, fog: 0, storm: 0 },
  fair: { cloud: 0.32, rain: 0, snow: 0, fog: 0, storm: 0 },
  overcast: { cloud: 0.85, rain: 0, snow: 0, fog: 0.1, storm: 0 },
  fog: { cloud: 0.55, rain: 0, snow: 0, fog: 0.85, storm: 0 },
  rain: { cloud: 0.9, rain: 0.8, snow: 0, fog: 0.15, storm: 0 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0.1, storm: 1 },
  snow: { cloud: 0.8, rain: 0, snow: 0.85, fog: 0.15, storm: 0 },
};

// With a setting the backdrop shows what is under a roof, so the weather
// runs full; without one (an older world server) indoors dims it instead.
export function skyFor(minuteOfDay: number | undefined, sky: string | undefined, outdoors = true, fight = false, setting?: Setting | null): SkyState {
  const m = minuteOfDay ?? 720;
  const open = setting ? !!setting.open : outdoors;
  return { sun: -Math.cos((m / 1440) * Math.PI * 2), ...(WEATHER[sky ?? "fair"] ?? WEATHER.fair), out: setting || outdoors ? 1 : 0, fight: fight ? 1 : 0,
           open: open ? 1 : 0, lamp: setting && !open ? 1 : 0, sway: setting?.scene === "deck" ? 1 : 0 };
}

export class Sky {
  private gl: WebGLRenderingContext | null;
  private canvas: HTMLCanvasElement;
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private now: SkyState = skyFor(undefined, undefined);
  private target: SkyState = this.now;
  private flash = 0;
  private nextBolt = 0;
  private started = performance.now();
  private frozenAt: number | null = null;
  private mode: "full" | "calm" | "off" = "full";
  private masks: [WebGLTexture | null, WebGLTexture | null] = [null, null]; // [now, before]
  private maskCanvas = document.createElement("canvas");
  private setting: Setting | null = null;
  private fade = 1;
  private last = performance.now();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", { antialias: false, premultipliedAlpha: false });
    if (!this.gl) return; // no WebGL: the page background stands in
    const gl = this.gl;
    const prog = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.warn("sky shader:", gl.getShaderInfoLog(sh));
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const u of ["u_res", "u_time", "u_sun", "u_cloud", "u_rain", "u_snow", "u_fog", "u_storm", "u_flash", "u_out", "u_fight",
                     "u_mask", "u_mask_old", "u_masked", "u_fade", "u_open", "u_lamp", "u_sway"]) this.uni[u] = gl.getUniformLocation(prog, u);
    this.masks = [this.texture(), this.texture()];
    gl.uniform1i(this.uni.u_mask, 0);
    gl.uniform1i(this.uni.u_mask_old, 1);
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.loop();
  }

  set(state: SkyState, instant = false): void {
    this.target = state;
    if (instant) this.now = { ...state };
  }

  // What stands in front of the sky, or nothing. A new place fades in over
  // the last; the same place again is left as it is.
  setBackdrop(setting: Setting | null, instant = false): void {
    const same = (a: Setting | null, b: Setting | null) => a?.scene === b?.scene && a?.seed === b?.seed && a?.terrain === b?.terrain;
    if (same(setting, this.setting)) return;
    this.setting = setting;
    if (!this.gl) return;
    this.masks.reverse();
    this.paintMask();
    this.fade = instant || this.mode !== "full" ? 1 : 0;
  }

  private texture(): WebGLTexture | null {
    const gl = this.gl!;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return t;
  }

  // The backdrop drawn at the sky's own size into the current mask.
  private paintMask(): void {
    const gl = this.gl!;
    const c = this.maskCanvas;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    if (this.setting) drawBackdrop(c, this.setting);
    else c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.masks[0]);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  }

  setMode(mode: "full" | "calm" | "off"): void {
    this.mode = mode;
    this.frozenAt = mode === "full" ? null : this.time();
    if (mode !== "full") this.flash = 0;
  }

  private time(): number {
    return this.frozenAt ?? (performance.now() - this.started) / 1000;
  }

  // Drawn at half the window's pixels: the sky is soft, and the GPU has
  // better things to do.
  private resize(): void {
    const scale = Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    this.canvas.width = Math.max(1, Math.floor(window.innerWidth * scale));
    this.canvas.height = Math.max(1, Math.floor(window.innerHeight * scale));
    this.gl?.viewport(0, 0, this.canvas.width, this.canvas.height);
    if (this.gl && this.setting) {
      this.paintMask();
      this.fade = 1;
    }
  }

  // Every frame while the sky moves; once a second while it holds still.
  private loop = (): void => {
    if (this.mode === "full") requestAnimationFrame(this.loop);
    else setTimeout(this.loop, 1000);
    const gl = this.gl!;
    const ease = this.mode === "full" ? 0.012 : 1;
    const nowMs = performance.now();
    this.fade = Math.min(1, this.fade + (nowMs - this.last) / 1400);
    this.last = nowMs;
    for (const k of Object.keys(this.now) as (keyof SkyState)[]) this.now[k] += (this.target[k] - this.now[k]) * ease;
    const t = this.time();
    if (this.mode === "full" && this.now.storm > 0.5 && t > this.nextBolt) {
      this.flash = 1;
      this.nextBolt = t + 4 + Math.random() * 9;
    }
    this.flash *= 0.86;
    if (this.flash > 0.2 && Math.random() < 0.06) this.flash = 0.9; // the second flicker of a bolt
    gl.uniform2f(this.uni.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uni.u_time, t);
    gl.uniform1f(this.uni.u_sun, this.now.sun);
    gl.uniform1f(this.uni.u_cloud, this.now.cloud);
    gl.uniform1f(this.uni.u_rain, this.now.rain);
    gl.uniform1f(this.uni.u_snow, this.now.snow);
    gl.uniform1f(this.uni.u_fog, this.now.fog);
    gl.uniform1f(this.uni.u_storm, this.now.storm);
    gl.uniform1f(this.uni.u_flash, this.flash);
    gl.uniform1f(this.uni.u_out, this.now.out);
    gl.uniform1f(this.uni.u_fight, this.now.fight);
    gl.uniform1f(this.uni.u_masked, this.setting ? 1 : 0);
    gl.uniform1f(this.uni.u_fade, this.fade);
    gl.uniform1f(this.uni.u_open, this.now.open);
    gl.uniform1f(this.uni.u_lamp, this.now.lamp);
    gl.uniform1f(this.uni.u_sway, this.mode === "full" ? this.now.sway : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.masks[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.masks[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
