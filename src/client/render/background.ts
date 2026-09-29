import type { MapDef, StructureDef } from '../../sim/config/maps';
import { Rng } from '../../sim/rng';
import type { Terrain } from '../../sim/terrain';
import type { Camera } from './camera';

/** Parallax factors per layer (0 = fixed to screen, 1 = moves with the world). */
const P_MOUNTAINS = 0.12;
const P_FAR_CLOUDS = 0.22;
const P_SHIPS = 0.3;
const P_NEAR_CLOUDS = 0.5;
const P_FOREGROUND = 1.3;
/** How strongly the horizon follows the camera vertically. */
const HORIZON_VERTICAL = 0.25;
const MOUNTAIN_STRIP_W = 2400;
const MOUNTAIN_STRIP_H = 380;
const WIND = 14;

interface Cloud { x: number; y: number; scale: number; sprite: HTMLCanvasElement; alpha: number }
interface Ship { x: number; speed: number; kind: number; scale: number }
interface Flyer { x: number; y: number; speed: number; count: number }

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/**
 * "Azure Coast" environment renderer. Everything is procedurally generated from
 * a fixed seed so every client sees the same (purely cosmetic) scenery.
 */
export class AzureBackground {
  private readonly mountains: HTMLCanvasElement;
  private readonly mountainsNear: HTMLCanvasElement;
  private readonly farClouds: Cloud[] = [];
  private readonly nearClouds: Cloud[] = [];
  private readonly wisps: Cloud[] = [];
  private readonly ships: Ship[] = [];
  private readonly flyers: Flyer[] = [];
  private readonly rockPattern: CanvasPattern | null;
  private skyGrad: CanvasGradient | null = null;
  private skyGradH = 0;

  constructor(private readonly map: MapDef, private readonly terrain: Terrain) {
    const rng = new Rng(0xa2e0);
    this.mountains = this.makeMountains(rng, '#8fb3cf', '#b9d3e6', 0.55, 240);
    this.mountainsNear = this.makeMountains(rng, '#6f94b3', '#98b9d3', 0.8, 170);
    const cloudSprites = Array.from({ length: 8 }, (_, i) => this.makeCloud(rng, i));
    for (let i = 0; i < 22; i++) {
      this.farClouds.push({
        x: i * 520 + rng.range(-150, 150), y: rng.range(250, 1500), scale: rng.range(0.5, 0.9),
        sprite: rng.pick(cloudSprites), alpha: rng.range(0.45, 0.7),
      });
    }
    for (let i = 0; i < 16; i++) {
      this.nearClouds.push({
        x: i * 900 + rng.range(-250, 250), y: rng.range(200, 1900), scale: rng.range(0.9, 1.6),
        sprite: rng.pick(cloudSprites), alpha: rng.range(0.55, 0.85),
      });
    }
    for (let i = 0; i < 10; i++) {
      this.wisps.push({
        x: i * 1600 + rng.range(0, 800), y: rng.range(300, 2000), scale: rng.range(1.5, 2.4),
        sprite: rng.pick(cloudSprites), alpha: rng.range(0.1, 0.18),
      });
    }
    for (let i = 0; i < 6; i++) {
      this.ships.push({ x: rng.range(0, 5000), speed: rng.range(-9, 9), kind: i % 3, scale: rng.range(0.7, 1.2) });
    }
    for (let i = 0; i < 2; i++) {
      this.flyers.push({ x: rng.range(0, 6000), y: rng.range(200, 600), speed: rng.range(40, 70) * (i ? -1 : 1), count: 2 + i });
    }
    this.rockPattern = this.makeRockPattern(rng);
  }

  private makeMountains(rng: Rng, color: string, snow: string, roughness: number, peak: number): HTMLCanvasElement {
    const [c, g] = makeCanvas(MOUNTAIN_STRIP_W, MOUNTAIN_STRIP_H);
    const pts: number[] = [];
    const phase = rng.range(0, 100);
    for (let x = 0; x <= MOUNTAIN_STRIP_W; x += 8) {
      // Periodic in the strip width so tiles join seamlessly.
      const t = (x / MOUNTAIN_STRIP_W) * Math.PI * 2;
      const h =
        peak * (0.55 + 0.3 * Math.sin(t * 2 + phase) + 0.2 * Math.sin(t * 5 + phase * 2) * roughness +
        0.08 * Math.sin(t * 13 + phase * 3) * roughness);
      pts.push(x, MOUNTAIN_STRIP_H - Math.max(20, h));
    }
    const grad = g.createLinearGradient(0, MOUNTAIN_STRIP_H - peak * 1.2, 0, MOUNTAIN_STRIP_H);
    grad.addColorStop(0, color);
    grad.addColorStop(1, snow);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, MOUNTAIN_STRIP_H);
    for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.lineTo(MOUNTAIN_STRIP_W, MOUNTAIN_STRIP_H);
    g.closePath();
    g.fill();
    // Snow caps on the tallest peaks.
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 2; i < pts.length - 2; i += 2) {
      const y = pts[i + 1];
      if (y < MOUNTAIN_STRIP_H - peak * 0.85 && y <= pts[i - 1] && y <= pts[i + 3]) {
        g.beginPath();
        g.moveTo(pts[i] - 26, y + 22);
        g.lineTo(pts[i], y);
        g.lineTo(pts[i] + 26, y + 22);
        g.closePath();
        g.fill();
      }
    }
    return c;
  }

  private makeCloud(rng: Rng, seed: number): HTMLCanvasElement {
    // Puffs are kept inside the canvas (radius + margin) so no cloud gets a clipped flat top.
    const W = 440;
    const H = 230;
    const [c, g] = makeCanvas(W, H);
    const puffs = 7 + (seed % 4);
    for (let i = 0; i < puffs; i++) {
      const r = rng.range(34, 60);
      const x = rng.range(r + 10, W - r - 10);
      const arch = Math.sin((x / W) * Math.PI) * 40;
      const y = Math.max(r + 8, H - 70 - rng.range(0, 40) - arch);
      const grad = g.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.7, 'rgba(236,244,252,0.85)');
      grad.addColorStop(1, 'rgba(210,228,244,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Slightly shaded base.
    g.globalCompositeOperation = 'source-atop';
    const shade = g.createLinearGradient(0, H - 110, 0, H - 20);
    shade.addColorStop(0, 'rgba(160,190,220,0)');
    shade.addColorStop(1, 'rgba(140,170,205,0.5)');
    g.fillStyle = shade;
    g.fillRect(0, 0, W, H);
    return c;
  }

  private makeRockPattern(rng: Rng): CanvasPattern | null {
    const [c, g] = makeCanvas(128, 128);
    for (let i = 0; i < 260; i++) {
      const light = rng.next() < 0.5;
      g.fillStyle = light ? 'rgba(255,248,230,0.35)' : 'rgba(40,30,20,0.35)';
      const w = rng.range(2, 9);
      g.fillRect(rng.range(0, 128), rng.range(0, 128), w, rng.range(1, 3));
    }
    return g.createPattern(c, 'repeat');
  }

  horizonY(cam: Camera): number {
    return cam.screenH / 2 + (this.map.seaLevel - 220 - cam.y) * cam.zoom * HORIZON_VERTICAL;
  }

  /** Screen-space sky and distant layers. Call before the world transform. */
  drawSky(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const W = cam.screenW;
    const H = cam.screenH;
    if (!this.skyGrad || this.skyGradH !== H) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1d4f8c');
      g.addColorStop(0.45, '#4f95cf');
      g.addColorStop(0.8, '#a9d4ef');
      g.addColorStop(1, '#e6f1f4');
      this.skyGrad = g;
      this.skyGradH = H;
    }
    ctx.fillStyle = this.skyGrad;
    ctx.fillRect(0, 0, W, H);

    const horizon = this.horizonY(cam);

    // Sun glow, nearly fixed in the sky.
    const sunX = W * 0.72 - cam.x * 0.02 * cam.zoom;
    const sunY = Math.min(horizon - 260 * cam.zoom, H * 0.28);
    const sunR = 380 * cam.zoom;
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sun.addColorStop(0, 'rgba(255,250,225,0.95)');
    sun.addColorStop(0.08, 'rgba(255,240,200,0.7)');
    sun.addColorStop(0.35, 'rgba(255,230,190,0.15)');
    sun.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = sun;
    // Fill only the glow's bounding box — a full-screen radial fill is a major raster cost.
    ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);

    // Mountains (two depths), tiled.
    this.drawStrip(ctx, this.mountains, cam, P_MOUNTAINS * 0.6, horizon + 6 * cam.zoom, 0.9);
    this.drawStrip(ctx, this.mountainsNear, cam, P_MOUNTAINS, horizon + 10 * cam.zoom, 0.8);

    // Distant sea from the horizon down.
    const seaGrad = ctx.createLinearGradient(0, horizon, 0, H);
    seaGrad.addColorStop(0, '#9cc8dc');
    seaGrad.addColorStop(0.15, '#3f8fb4');
    seaGrad.addColorStop(1, '#155a86');
    ctx.fillStyle = seaGrad;
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, horizon, W, Math.max(1, cam.zoom));

    this.drawClouds(ctx, cam, this.farClouds, P_FAR_CLOUDS, time, 0.55);
    this.drawShips(ctx, cam, horizon, time);
    this.drawFlyers(ctx, cam, time);
    this.drawClouds(ctx, cam, this.nearClouds, P_NEAR_CLOUDS, time, 1);
  }

  private drawStrip(ctx: CanvasRenderingContext2D, strip: HTMLCanvasElement, cam: Camera, p: number, baseY: number, scale: number): void {
    const s = cam.zoom * scale;
    const w = MOUNTAIN_STRIP_W * s;
    const h = MOUNTAIN_STRIP_H * s;
    let x = -((cam.x * p * cam.zoom) % w);
    if (x > 0) x -= w;
    for (; x < cam.screenW; x += w) ctx.drawImage(strip, x, baseY - h, w + 1, h);
  }

  private drawClouds(ctx: CanvasRenderingContext2D, cam: Camera, clouds: Cloud[], p: number, time: number, sizeMul: number): void {
    const period = this.map.width * p + cam.viewW + 1200;
    for (const c of clouds) {
      const lx = c.x + time * WIND * p;
      let sx = ((lx - cam.x * p) % period + period) % period - 600;
      sx = sx * cam.zoom;
      const sy = cam.screenH / 2 + (c.y - cam.y) * p * cam.zoom;
      const w = c.sprite.width * c.scale * sizeMul * cam.zoom;
      const h = c.sprite.height * c.scale * sizeMul * cam.zoom;
      if (sx + w < 0 || sx > cam.screenW || sy + h < 0 || sy - h > cam.screenH) continue;
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.sprite, sx, sy - h * 0.6, w, h);
    }
    ctx.globalAlpha = 1;
  }

  private drawShips(ctx: CanvasRenderingContext2D, cam: Camera, horizon: number, time: number): void {
    const period = this.map.width * P_SHIPS + cam.viewW;
    ctx.fillStyle = '#44627a';
    for (const s of this.ships) {
      const lx = s.x + time * s.speed;
      const sx = (((lx - cam.x * P_SHIPS) % period + period) % period) * cam.zoom;
      if (sx < -80 || sx > cam.screenW + 80) continue;
      const k = s.scale * cam.zoom;
      const y = horizon + 4 * cam.zoom;
      ctx.beginPath();
      if (s.kind === 0) {
        // Cargo freighter.
        ctx.moveTo(sx - 40 * k, y); ctx.lineTo(sx + 44 * k, y); ctx.lineTo(sx + 48 * k, y - 6 * k);
        ctx.lineTo(sx - 42 * k, y - 6 * k); ctx.closePath();
        ctx.rect(sx - 34 * k, y - 11 * k, 50 * k, 5 * k);
        ctx.rect(sx + 22 * k, y - 16 * k, 10 * k, 10 * k);
      } else if (s.kind === 1) {
        // Patrol cutter.
        ctx.moveTo(sx - 22 * k, y); ctx.lineTo(sx + 26 * k, y); ctx.lineTo(sx + 30 * k, y - 5 * k);
        ctx.lineTo(sx - 22 * k, y - 5 * k); ctx.closePath();
        ctx.moveTo(sx - 4 * k, y - 5 * k); ctx.lineTo(sx + 2 * k, y - 16 * k); ctx.lineTo(sx + 8 * k, y - 5 * k);
      } else {
        // Sailing yacht.
        ctx.moveTo(sx - 12 * k, y); ctx.lineTo(sx + 12 * k, y); ctx.lineTo(sx + 14 * k, y - 3 * k); ctx.lineTo(sx - 14 * k, y - 3 * k);
        ctx.closePath();
        ctx.moveTo(sx, y - 3 * k); ctx.lineTo(sx, y - 24 * k); ctx.lineTo(sx + 10 * k, y - 5 * k);
      }
      ctx.fill();
    }
  }

  private drawFlyers(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const p = 0.25;
    const period = this.map.width * p + cam.viewW + 800;
    for (const f of this.flyers) {
      const lx = f.x + time * f.speed;
      const sx = ((((lx - cam.x * p) % period) + period) % period - 400) * cam.zoom;
      const sy = cam.screenH / 2 + (f.y - cam.y) * p * cam.zoom;
      if (sx < -200 || sx > cam.screenW + 200) continue;
      const dir = Math.sign(f.speed);
      for (let i = 0; i < f.count; i++) {
        const x = sx - dir * i * 22 * cam.zoom;
        const y = sy + i * 9 * cam.zoom;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1.5 * cam.zoom;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - dir * 90 * cam.zoom, y);
        ctx.stroke();
        ctx.fillStyle = '#56708a';
        ctx.fillRect(x - 5 * cam.zoom, y - 1.2 * cam.zoom, 10 * cam.zoom, 2.4 * cam.zoom);
      }
    }
  }

  /** World-space terrain, structures and sea. Call inside the camera transform. */
  drawWorld(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const t = this.terrain;
    const x0 = Math.max(0, Math.floor((cam.left - 40) / t.step) * t.step);
    const x1 = Math.min(this.map.width, cam.right + 40);
    const bottom = t.seaLevel + 40;

    for (const s of this.map.structures) {
      if (s.x > cam.left - 200 && s.x < cam.right + 200) this.drawStructure(ctx, s, time);
    }

    // Terrain fill.
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let x = x0; x <= x1; x += t.step) ctx.lineTo(x, t.groundY(x));
    ctx.lineTo(x1, bottom);
    ctx.closePath();
    const rock = ctx.createLinearGradient(0, t.seaLevel - 1500, 0, t.seaLevel);
    rock.addColorStop(0, '#b3a58a');
    rock.addColorStop(0.55, '#8c7e66');
    rock.addColorStop(1, '#4c4a45');
    ctx.fillStyle = rock;
    ctx.fill();
    if (this.rockPattern) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = this.rockPattern;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Grass/scrub rim on land tops, sand where land meets sea.
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#6aa857';
    ctx.beginPath();
    let drawing = false;
    for (let x = x0; x <= x1; x += t.step) {
      const g = t.groundY(x);
      const land = g < t.seaLevel - 30;
      if (land && !drawing) { ctx.moveTo(x, g); drawing = true; }
      else if (land) ctx.lineTo(x, g);
      else drawing = false;
    }
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(30,45,25,0.6)';
    ctx.stroke();

    this.drawSea(ctx, x0, x1, time);
  }

  private drawSea(ctx: CanvasRenderingContext2D, x0: number, x1: number, time: number): void {
    const sea = this.terrain.seaLevel;
    const grad = ctx.createLinearGradient(0, sea, 0, sea + 500);
    grad.addColorStop(0, 'rgba(38,140,180,0.92)');
    grad.addColorStop(1, 'rgba(10,50,90,1)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0, sea + 600);
    for (let x = x0; x <= x1 + 24; x += 24) {
      ctx.lineTo(x, sea + Math.sin(x * 0.012 + time * 1.6) * 4 + Math.sin(x * 0.031 - time * 2.3) * 2);
    }
    ctx.lineTo(x1 + 24, sea + 600);
    ctx.closePath();
    ctx.fill();
    // Foam line.
    ctx.strokeStyle = 'rgba(230,250,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = x0; x <= x1 + 24; x += 24) {
      const y = sea + Math.sin(x * 0.012 + time * 1.6) * 4 + Math.sin(x * 0.031 - time * 2.3) * 2;
      if (x === x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    // Sun glints.
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let x = Math.floor(x0 / 90) * 90; x < x1; x += 90) {
      const s = Math.sin(x * 12.9898) * 43758.5453;
      const r = s - Math.floor(s);
      const blink = Math.sin(time * 3 + r * 20);
      if (blink > 0.6) ctx.fillRect(x + r * 60, sea + 14 + r * 60, 10 * blink, 2);
    }
  }

  private drawStructure(ctx: CanvasRenderingContext2D, s: StructureDef, time: number): void {
    const gy = this.terrain.groundY(s.x);
    ctx.save();
    ctx.translate(s.x, gy + 4);
    switch (s.kind) {
      case 'radar': {
        ctx.fillStyle = '#d7dde2';
        ctx.fillRect(-26, -24, 52, 24);
        ctx.fillStyle = '#8c969e';
        ctx.fillRect(-26, -6, 52, 6);
        ctx.fillStyle = '#b8c1c8';
        ctx.fillRect(-4, -54, 8, 32);
        const sx = Math.cos(time * 1.4);
        ctx.fillStyle = '#eef2f5';
        ctx.beginPath();
        ctx.ellipse(0, -60, Math.max(3, Math.abs(sx) * 26), 14, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#7d8890';
        ctx.lineWidth = 2;
        ctx.stroke();
        break;
      }
      case 'lighthouse': {
        ctx.fillStyle = '#f2f2f2';
        ctx.beginPath();
        ctx.moveTo(-14, 0); ctx.lineTo(-8, -110); ctx.lineTo(8, -110); ctx.lineTo(14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#d0463b';
        ctx.fillRect(-12, -40, 24, 14);
        ctx.fillRect(-10, -80, 20, 12);
        ctx.fillStyle = '#39424a';
        ctx.fillRect(-11, -126, 22, 16);
        ctx.fillStyle = '#ffe7a0';
        ctx.fillRect(-7, -123, 14, 10);
        // Rotating beam.
        const beam = Math.sin(time * 1.1);
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,240,180,${0.12 + Math.abs(beam) * 0.12})`;
        ctx.beginPath();
        ctx.moveTo(0, -118);
        ctx.lineTo(beam * 520, -150);
        ctx.lineTo(beam * 520, -86);
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'bunker':
        ctx.fillStyle = '#7d7f73';
        ctx.beginPath();
        ctx.moveTo(-40, 0); ctx.lineTo(-30, -24); ctx.lineTo(30, -24); ctx.lineTo(40, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#2b2d29';
        ctx.fillRect(-18, -16, 36, 5);
        break;
      case 'antenna': {
        ctx.strokeStyle = '#9aa3aa';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-10, 0); ctx.lineTo(0, -140); ctx.lineTo(10, 0);
        for (let y = -20; y > -130; y -= 20) {
          const w = 10 * (1 + y / 140);
          ctx.moveTo(-w, y); ctx.lineTo(w, y - 10);
        }
        ctx.stroke();
        if (Math.sin(time * 4) > 0) {
          ctx.fillStyle = '#ff3b30';
          ctx.beginPath();
          ctx.arc(0, -142, 4, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
    }
    ctx.restore();
  }

  /** Subtle wisps drifting in front of the action. Kept very transparent for readability. */
  drawForeground(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const period = this.map.width * P_FOREGROUND + cam.viewW * 2;
    for (const c of this.wisps) {
      const lx = c.x + time * WIND * 2;
      const sx = ((((lx - cam.x * P_FOREGROUND) % period) + period) % period - cam.viewW) * cam.zoom;
      const sy = cam.screenH / 2 + (c.y - cam.y) * P_FOREGROUND * cam.zoom;
      const w = c.sprite.width * c.scale * cam.zoom;
      const h = c.sprite.height * c.scale * cam.zoom;
      if (sx + w < 0 || sx > cam.screenW || sy + h < 0 || sy - h > cam.screenH) continue;
      ctx.globalAlpha = c.alpha;
      ctx.drawImage(c.sprite, sx, sy - h * 0.5, w, h);
    }
    ctx.globalAlpha = 1;
  }
}
