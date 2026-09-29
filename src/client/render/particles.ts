/**
 * Pooled particle system stored as struct-of-arrays (typed arrays): zero
 * allocations per frame, dense iteration, O(1) removal by swap.
 */

export const enum PK {
  Smoke = 0,
  Fire = 1,
  Spark = 2,
  Debris = 3,
  Ring = 4,
  Glow = 5,
  Flash = 6,
}

/**
 * Blend mode per kind. Fire uses normal blending: additive fire washes out to
 * white against the bright daytime sky. Small sparks/glows/flashes stay additive.
 */
const ADDITIVE = [false, false, true, false, false, true, true];

export class ParticleSystem {
  readonly max: number;
  count = 0;
  /** Density multiplier from settings; emitters scale their counts by this. */
  density = 1;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly drag: Float32Array;
  private readonly grav: Float32Array;
  private readonly rot: Float32Array;
  private readonly vrot: Float32Array;
  private readonly alpha: Float32Array;
  private readonly kind: Uint8Array;
  private readonly color: Uint32Array;
  private readonly sprites = new Map<number, HTMLCanvasElement>();
  private readonly styles = new Map<number, string>();

  constructor(max = 5000) {
    this.max = max;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.vrot = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.kind = new Uint8Array(max);
    this.color = new Uint32Array(max);
  }

  clear(): void {
    this.count = 0;
  }

  /**
   * Spawn one particle. When the pool is full the oldest-slot particle is
   * overwritten so critical effects (explosions) still appear.
   */
  spawn(
    kind: PK, x: number, y: number, vx: number, vy: number, life: number,
    size0: number, size1: number, color: number, drag = 0, grav = 0, alpha = 1, vrot = 0,
  ): void {
    let i = this.count;
    if (i >= this.max) i = (Math.random() * this.max) | 0;
    else this.count++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.s0[i] = size0;
    this.s1[i] = size1;
    this.color[i] = color;
    this.drag[i] = drag;
    this.grav[i] = grav;
    this.alpha[i] = alpha;
    this.rot[i] = Math.random() * 6.283;
    this.vrot[i] = vrot;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        continue;
      }
      const k = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      this.vx[i] *= k;
      this.vy[i] = this.vy[i] * k + this.grav[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      this.rot[i] += this.vrot[i] * dt;
      i++;
    }
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.s0[i] = this.s0[last];
    this.s1[i] = this.s1[last];
    this.drag[i] = this.drag[last];
    this.grav[i] = this.grav[last];
    this.rot[i] = this.rot[last];
    this.vrot[i] = this.vrot[last];
    this.alpha[i] = this.alpha[last];
    this.kind[i] = this.kind[last];
    this.color[i] = this.color[last];
  }

  /** Soft radial sprite per colour, generated once and cached. */
  private sprite(color: number): HTMLCanvasElement {
    let c = this.sprites.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const r = (color >> 16) & 255;
    const gg = (color >> 8) & 255;
    const b = color & 255;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
    grad.addColorStop(0.45, `rgba(${r},${gg},${b},0.55)`);
    grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.sprites.set(color, c);
    return c;
  }

  private style(color: number): string {
    let s = this.styles.get(color);
    if (!s) {
      s = `#${color.toString(16).padStart(6, '0')}`;
      this.styles.set(color, s);
    }
    return s;
  }

  /**
   * Draw one blend pass (inside the camera transform). Normal-blended smoke and
   * debris are drawn beneath aircraft; additive glow/sparks on top of them.
   */
  render(ctx: CanvasRenderingContext2D, left: number, top: number, right: number, bottom: number, onlyPass = -1): void {
    for (let pass = 0; pass < 2; pass++) {
      if (onlyPass >= 0 && pass !== onlyPass) continue;
      const additive = pass === 1;
      ctx.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      for (let i = 0; i < this.count; i++) {
        const kind = this.kind[i];
        if (ADDITIVE[kind] !== additive) continue;
        const x = this.x[i];
        const y = this.y[i];
        const t = 1 - this.life[i] / this.maxLife[i];
        const size = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
        if (x + size < left || x - size > right || y + size < top || y - size > bottom) continue;
        let a = this.alpha[i];
        switch (kind) {
          case PK.Smoke:
            a *= (1 - t) * Math.min(1, t * 6 + 0.3);
            ctx.globalAlpha = a;
            ctx.drawImage(this.sprite(this.color[i]), x - size, y - size, size * 2, size * 2);
            break;
          case PK.Fire:
          case PK.Glow:
          case PK.Flash:
            ctx.globalAlpha = a * (1 - t);
            ctx.drawImage(this.sprite(this.color[i]), x - size, y - size, size * 2, size * 2);
            break;
          case PK.Spark: {
            ctx.globalAlpha = a * (1 - t);
            ctx.strokeStyle = this.style(this.color[i]);
            ctx.lineWidth = size;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x - this.vx[i] * 0.03, y - this.vy[i] * 0.03);
            ctx.stroke();
            break;
          }
          case PK.Debris: {
            // Rotated rectangle built from its corners — no transform stack churn.
            ctx.globalAlpha = a * Math.min(1, (1 - t) * 3);
            ctx.fillStyle = this.style(this.color[i]);
            const c = Math.cos(this.rot[i]);
            const s = Math.sin(this.rot[i]);
            const hw = size;
            const hh = size * 0.45;
            ctx.beginPath();
            ctx.moveTo(x + c * hw - s * hh, y + s * hw + c * hh);
            ctx.lineTo(x - c * hw - s * hh, y - s * hw + c * hh);
            ctx.lineTo(x - c * hw + s * hh, y - s * hw - c * hh);
            ctx.lineTo(x + c * hw + s * hh, y + s * hw - c * hh);
            ctx.closePath();
            ctx.fill();
            break;
          }
          case PK.Ring:
            ctx.globalAlpha = a * (1 - t) * (1 - t);
            ctx.strokeStyle = this.style(this.color[i]);
            ctx.lineWidth = 2 + 6 * (1 - t);
            ctx.beginPath();
            ctx.arc(x, y, size, 0, Math.PI * 2);
            ctx.stroke();
            break;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}
