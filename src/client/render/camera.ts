import { clamp, damp } from '../../sim/math';

/** Visible world height at the default zoom. */
const VIEW_HEIGHT = 1000;
/** Never show more than this much world width (ultra-wide screens zoom in instead). */
const MAX_VIEW_WIDTH = 2200;
const FOLLOW_RATE = 5;
/** Seconds of velocity used as look-ahead. */
const LOOKAHEAD_TIME = 0.42;
const LOOKAHEAD_MAX = 420;
const LOOKAHEAD_RATE = 2.2;
const TRAUMA_DECAY = 1.5;
const MAX_SHAKE = 26;
const MAX_SHAKE_ROT = 0.02;

/**
 * Smooth follow camera with velocity look-ahead (you see where you're going),
 * world-bounds clamping and trauma-based screen shake.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewW = 0;
  viewH = 0;
  screenW = 1;
  screenH = 1;
  shakeX = 0;
  shakeY = 0;
  shakeRot = 0;
  private trauma = 0;
  private lookX = 0;
  private lookY = 0;
  private t = 0;
  /** 0..1 user setting. */
  shakeScale = 1;

  resize(w: number, h: number): void {
    this.screenW = w;
    this.screenH = h;
    this.zoom = Math.max(h / VIEW_HEIGHT, w / MAX_VIEW_WIDTH);
    this.viewW = w / this.zoom;
    this.viewH = h / this.zoom;
  }

  snap(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.lookX = 0;
    this.lookY = 0;
  }

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, tx: number, ty: number, vx: number, vy: number, mapW: number, seaLevel: number): void {
    this.t += dt;
    const lk = damp(LOOKAHEAD_RATE, dt);
    const wantLX = clamp(vx * LOOKAHEAD_TIME, -LOOKAHEAD_MAX, LOOKAHEAD_MAX);
    const wantLY = clamp(vy * LOOKAHEAD_TIME * 0.6, -LOOKAHEAD_MAX * 0.6, LOOKAHEAD_MAX * 0.6);
    this.lookX += (wantLX - this.lookX) * lk;
    this.lookY += (wantLY - this.lookY) * lk;
    const k = damp(FOLLOW_RATE, dt);
    this.x += (tx + this.lookX - this.x) * k;
    this.y += (ty + this.lookY - this.y) * k;
    this.clampTo(mapW, seaLevel);

    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    const s = this.trauma * this.trauma * this.shakeScale;
    // Layered sines: smooth, non-repeating-looking shake without random allocations.
    this.shakeX = MAX_SHAKE * s * (Math.sin(this.t * 47.3) * 0.6 + Math.sin(this.t * 83.1) * 0.4);
    this.shakeY = MAX_SHAKE * s * (Math.sin(this.t * 53.7 + 1.3) * 0.6 + Math.sin(this.t * 91.9) * 0.4);
    this.shakeRot = MAX_SHAKE_ROT * s * Math.sin(this.t * 37.1);
  }

  clampTo(mapW: number, seaLevel: number): void {
    const halfW = this.viewW / 2;
    const halfH = this.viewH / 2;
    this.x = clamp(this.x, halfW - 500, mapW - halfW + 500);
    this.y = clamp(this.y, halfH - 350, seaLevel + 160 - halfH);
  }

  /** Apply world transform to a 2D context (after DPR scaling). */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.screenW / 2 + this.shakeX, this.screenH / 2 + this.shakeY);
    if (this.shakeRot) ctx.rotate(this.shakeRot);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-this.x, -this.y);
  }

  worldToScreenX(x: number): number {
    return (x - this.x) * this.zoom + this.screenW / 2;
  }
  worldToScreenY(y: number): number {
    return (y - this.y) * this.zoom + this.screenH / 2;
  }

  get left(): number { return this.x - this.viewW / 2; }
  get right(): number { return this.x + this.viewW / 2; }
  get top(): number { return this.y - this.viewH / 2; }
  get bottom(): number { return this.y + this.viewH / 2; }
}
