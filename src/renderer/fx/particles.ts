// Sparks, coins and stars on a canvas over everything, drawn only while
// some are alive.
interface P {
  x: number; y: number; vx: number; vy: number; life: number; age: number;
  size: number; color: string; shape: "spark" | "coin" | "star"; gravity: number; spin: number;
  to?: { x: number; y: number };
}

export interface BurstOptions {
  count?: number;
  colors?: string[];
  speed?: number;
  gravity?: number;
  life?: number;
  size?: number;
  shape?: P["shape"];
  spread?: number; // radians around straight up; 2π for every way
}

export class Particles {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private ps: P[] = [];
  private running = false;
  enabled = true;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    const fit = () => {
      const r = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * r;
      canvas.height = window.innerHeight * r;
      this.ctx.setTransform(r, 0, 0, r, 0, 0);
    };
    window.addEventListener("resize", fit);
    fit();
  }

  burst(x: number, y: number, o: BurstOptions = {}): void {
    if (!this.enabled) return;
    const colors = o.colors ?? ["#ffd77a", "#fff3a6", "#ffffff"];
    const spread = o.spread ?? Math.PI * 2;
    for (let i = 0; i < (o.count ?? 40); i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * spread;
      const v = (o.speed ?? 6) * (0.35 + Math.random() * 0.8);
      this.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: (o.life ?? 1.2) * (0.6 + Math.random() * 0.6), age: 0,
                     size: (o.size ?? 3) * (0.6 + Math.random() * 0.8), color: colors[i % colors.length], shape: o.shape ?? "spark",
                     gravity: o.gravity ?? 0.12, spin: (Math.random() - 0.5) * 0.4 });
    }
    this.start();
  }

  // Coins that leap from one place and fly home to another (the purse).
  flyTo(from: { x: number; y: number }, to: { x: number; y: number }, count = 10, color = "#ffd77a"): void {
    if (!this.enabled) return;
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = 3 + Math.random() * 4;
      this.ps.push({ x: from.x, y: from.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.4 + i * 0.05, age: -i * 0.04, size: 4.2,
                     color, shape: "coin", gravity: 0, spin: 0.2, to });
    }
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.tick(dt);
      if (this.ps.length) requestAnimationFrame(step);
      else {
        this.running = false;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    };
    requestAnimationFrame(step);
  }

  private tick(dt: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.globalCompositeOperation = "lighter";
    const f = dt * 60;
    this.ps = this.ps.filter((p) => {
      p.age += dt;
      if (p.age < 0) return true;
      if (p.to) {
        // drift out, then home in, faster as the life runs on
        const k = Math.min(1, p.age / p.life);
        p.vx += ((p.to.x - p.x) * 0.012 * k * k * 6 - p.vx * 0.08) * f;
        p.vy += ((p.to.y - p.y) * 0.012 * k * k * 6 - p.vy * 0.08) * f;
        if (Math.hypot(p.to.x - p.x, p.to.y - p.y) < 10 && p.age > 0.3) return false;
      }
      p.vy += p.gravity * f;
      p.vx *= 0.985;
      p.x += p.vx * f;
      p.y += p.vy * f;
      const alpha = Math.max(0, 1 - p.age / (p.life * (p.to ? 1.6 : 1)));
      if (alpha <= 0) return false;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.shape === "star") {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.age * 6 * p.spin * 10);
        ctx.fillRect(-p.size * 1.6, -p.size * 0.25, p.size * 3.2, p.size * 0.5);
        ctx.fillRect(-p.size * 0.25, -p.size * 1.6, p.size * 0.5, p.size * 3.2);
        ctx.restore();
      } else if (p.shape === "coin") {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, p.size * Math.abs(Math.cos(p.age * 9)) + 0.8, p.size, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      return true;
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
}
