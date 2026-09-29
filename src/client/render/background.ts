import type { MapDef, StructureDef } from '../../sim/config/maps';
import { Rng } from '../../sim/rng';
import type { Terrain } from '../../sim/terrain';
import type { Camera } from './camera';

/**
 * Depth layers, back to front (parallax factor: 0 = fixed to screen, 1 = world):
 *   sky gradient + sun + stars (0) -> far mountains (0.07) -> near mountains (0.12)
 *   -> haze band -> distant sea -> far clouds (0.15) -> ships (0.3) -> birds (0.45)
 *   -> mid clouds (0.35) -> near clouds (0.6) -> [world: world clouds + shadows,
 *   terrain, sea, aircraft, particles] -> foreground wisps (1.3) + motes (1.5)
 */
const P_MOUNTAINS = 0.12;
const P_FAR_CLOUDS = 0.15;
const P_SHIPS = 0.3;
const P_MID_CLOUDS = 0.35;
const P_BIRDS = 0.45;
const P_NEAR_CLOUDS = 0.6;
const P_FOREGROUND = 1.3;
const P_MOTES = 1.5;
/** Seconds to blend between time-of-day palettes when a new level starts. */
const PALETTE_BLEND_RATE = 0.35;

type RGB = [number, number, number];
/** Time-of-day look. Every level gets its own, so each encounter feels like a new sortie. */
export interface SkyPalette {
  name: string;
  top: RGB; mid: RGB; low: RGB; horizon: RGB;
  sun: RGB;
  /** 0 = on the horizon, 1 = high in the sky. */
  sunHeight: number;
  sunSize: number;
  haze: RGB;
  hazeAlpha: number;
  seaFar: RGB; seaMid: RGB; seaDeep: RGB;
  /** 0..1 how much clouds take on sunset colours. */
  warm: number;
  stars: number;
}

export const SKY_PALETTES: SkyPalette[] = [
  {
    name: 'Morning', top: [36, 86, 150], mid: [96, 154, 206], low: [182, 214, 236], horizon: [236, 238, 232],
    sun: [255, 244, 214], sunHeight: 0.45, sunSize: 1, haze: [214, 226, 238], hazeAlpha: 0.45,
    seaFar: [160, 200, 218], seaMid: [70, 144, 184], seaDeep: [22, 88, 132], warm: 0.1, stars: 0,
  },
  {
    name: 'Midday', top: [26, 76, 142], mid: [74, 146, 206], low: [166, 210, 238], horizon: [226, 240, 246],
    sun: [255, 252, 232], sunHeight: 0.85, sunSize: 0.9, haze: [206, 226, 242], hazeAlpha: 0.35,
    seaFar: [150, 202, 222], seaMid: [58, 140, 184], seaDeep: [18, 84, 132], warm: 0, stars: 0,
  },
  {
    name: 'Golden hour', top: [40, 76, 136], mid: [120, 150, 190], low: [236, 196, 150], horizon: [255, 222, 170],
    sun: [255, 214, 150], sunHeight: 0.28, sunSize: 1.25, haze: [250, 210, 170], hazeAlpha: 0.5,
    seaFar: [220, 190, 150], seaMid: [84, 128, 160], seaDeep: [24, 70, 112], warm: 0.55, stars: 0,
  },
  {
    name: 'Sunset', top: [44, 48, 104], mid: [150, 92, 128], low: [246, 146, 100], horizon: [255, 188, 120],
    sun: [255, 170, 100], sunHeight: 0.1, sunSize: 1.5, haze: [240, 150, 120], hazeAlpha: 0.55,
    seaFar: [230, 150, 110], seaMid: [96, 90, 130], seaDeep: [28, 44, 86], warm: 1, stars: 0.15,
  },
  {
    name: 'Dusk', top: [14, 22, 52], mid: [44, 58, 104], low: [110, 110, 150], horizon: [196, 150, 150],
    sun: [255, 160, 130], sunHeight: 0.02, sunSize: 1.2, haze: [120, 110, 150], hazeAlpha: 0.5,
    seaFar: [120, 110, 140], seaMid: [40, 60, 100], seaDeep: [10, 26, 56], warm: 0.6, stars: 0.8,
  },
];

function lerpRGB(out: RGB, to: RGB, k: number): void {
  out[0] += (to[0] - out[0]) * k;
  out[1] += (to[1] - out[1]) * k;
  out[2] += (to[2] - out[2]) * k;
}
function rgb(c: RGB, a = 1): string {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
}
function clonePalette(p: SkyPalette): SkyPalette {
  return JSON.parse(JSON.stringify(p)) as SkyPalette;
}
/** How strongly the horizon follows the camera vertically. */
const HORIZON_VERTICAL = 0.25;
const MOUNTAIN_STRIP_W = 2400;
const MOUNTAIN_STRIP_H = 380;
const WIND = 14;

interface Cloud { x: number; y: number; scale: number; sprite: HTMLCanvasElement; warm: HTMLCanvasElement; alpha: number }
interface Flock { x: number; y: number; speed: number; count: number; phase: number }
interface Mote { x: number; y: number; r: number; a: number; drift: number }
type CloudSize = 'tiny' | 'medium' | 'large';
const CLOUD_W: Record<CloudSize, number> = { tiny: 170, medium: 320, large: 520 };
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
  private readonly midClouds: Cloud[] = [];
  private readonly nearClouds: Cloud[] = [];
  private readonly worldClouds: Cloud[] = [];
  private readonly wisps: Cloud[] = [];
  private readonly ships: Ship[] = [];
  private readonly flyers: Flyer[] = [];
  private readonly flocks: Flock[] = [];
  private readonly motes: Mote[] = [];
  private readonly rockPattern: CanvasPattern | null;
  /** Current (blended) and target time-of-day palettes. */
  private readonly pal: SkyPalette = clonePalette(SKY_PALETTES[0]);
  private target: SkyPalette = SKY_PALETTES[0];
  private lastTime = 0;

  constructor(private readonly map: MapDef, private readonly terrain: Terrain) {
    const rng = new Rng(0xa2e0);
    this.mountains = this.makeMountains(rng, '#8fb3cf', '#b9d3e6', 0.55, 240);
    this.mountainsNear = this.makeMountains(rng, '#6f94b3', '#98b9d3', 0.8, 170);
    const sprites = (size: CloudSize, n: number) => Array.from({ length: n }, () => {
      const seed = rng.int(0, 1e6);
      return { cool: this.makeCloud(new Rng(seed), size, false), warm: this.makeCloud(new Rng(seed), size, true) };
    });
    const tiny = sprites('tiny', 5);
    const medium = sprites('medium', 5);
    const large = sprites('large', 4);
    const place = (list: Cloud[], n: number, spacing: number, pool: { cool: HTMLCanvasElement; warm: HTMLCanvasElement }[],
      yMin: number, yMax: number, sMin: number, sMax: number, aMin: number, aMax: number) => {
      for (let i = 0; i < n; i++) {
        const sp = rng.pick(pool);
        list.push({
          x: i * spacing + rng.range(-spacing * 0.3, spacing * 0.3), y: rng.range(yMin, yMax),
          scale: rng.range(sMin, sMax), sprite: sp.cool, warm: sp.warm, alpha: rng.range(aMin, aMax),
        });
      }
    };
    place(this.farClouds, 28, 380, tiny, 150, 1500, 0.6, 1.1, 0.45, 0.7);
    place(this.midClouds, 18, 640, medium, 200, 1800, 0.6, 1, 0.6, 0.85);
    place(this.nearClouds, 10, 1200, large, 250, 2000, 0.8, 1.2, 0.7, 0.9);
    // World-space clouds at gameplay depth: aircraft fly in front of them.
    place(this.worldClouds, 16, this.map.width / 16, [...medium, ...large], 250, 1700, 0.7, 1.3, 0.75, 0.92);
    place(this.wisps, 9, 1700, medium, 300, 2000, 1.4, 2.2, 0.1, 0.16);
    for (let i = 0; i < 6; i++) {
      this.ships.push({ x: rng.range(0, 5000), speed: rng.range(-9, 9), kind: i % 3, scale: rng.range(0.7, 1.2) });
    }
    for (let i = 0; i < 2; i++) {
      this.flyers.push({ x: rng.range(0, 6000), y: rng.range(200, 600), speed: rng.range(40, 70) * (i ? -1 : 1), count: 2 + i });
    }
    for (let i = 0; i < 3; i++) {
      this.flocks.push({ x: rng.range(0, 4000), y: rng.range(600, 1600), speed: rng.range(18, 32) * (i % 2 ? -1 : 1), count: rng.int(4, 7), phase: rng.range(0, 6) });
    }
    for (let i = 0; i < 26; i++) {
      this.motes.push({ x: rng.range(0, 3000), y: rng.range(0, 2000), r: rng.range(0.8, 2), a: rng.range(0.12, 0.3), drift: rng.range(-6, 6) });
    }
    this.rockPattern = this.makeRockPattern(rng);
  }

  /** Choose the time of day for a level (menus use level 0 = morning). Blends smoothly. */
  setLevel(level: number): void {
    this.target = SKY_PALETTES[Math.max(0, level - 1) % SKY_PALETTES.length];
  }

  private blendPalette(time: number): void {
    const dt = Math.min(0.1, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    const k = 1 - Math.exp(-PALETTE_BLEND_RATE * dt);
    const p = this.pal;
    const t = this.target;
    for (const key of ['top', 'mid', 'low', 'horizon', 'sun', 'haze', 'seaFar', 'seaMid', 'seaDeep'] as const) lerpRGB(p[key], t[key], k);
    p.sunHeight += (t.sunHeight - p.sunHeight) * k;
    p.sunSize += (t.sunSize - p.sunSize) * k;
    p.hazeAlpha += (t.hazeAlpha - p.hazeAlpha) * k;
    p.warm += (t.warm - p.warm) * k;
    p.stars += (t.stars - p.stars) * k;
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

  /**
   * Cumulus-style cloud sprite: many overlapping puffs of varied size sitting
   * on a flat, shaded base with a lit top. `warm` bakes sunset lighting.
   */
  private makeCloud(rng: Rng, size: CloudSize, warm: boolean): HTMLCanvasElement {
    const W = CLOUD_W[size];
    const H = Math.round(W * 0.5);
    const [c, g] = makeCanvas(W, H);
    const base = H * 0.8;
    const puffs = size === 'tiny' ? 7 : size === 'medium' ? 12 : 16;
    for (let i = 0; i < puffs; i++) {
      // Bias puffs toward the middle so clouds have a domed silhouette.
      const t = (rng.next() + rng.next()) / 2;
      const x = W * (0.12 + t * 0.76);
      const centre = 1 - Math.abs(t - 0.5) * 1.6;
      const r = W * rng.range(0.06, 0.13) * (0.6 + centre * 0.8);
      const y = base - r * rng.range(0.35, 1.1) - centre * H * 0.12;
      const grad = g.createRadialGradient(x - r * 0.2, y - r * 0.35, r * 0.15, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.75, 'rgba(250,252,255,0.92)');
      grad.addColorStop(1, 'rgba(240,246,252,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // Flatten the base: fade out everything below the cloud floor.
    g.globalCompositeOperation = 'destination-out';
    const floor = g.createLinearGradient(0, base - H * 0.04, 0, base + H * 0.08);
    floor.addColorStop(0, 'rgba(0,0,0,0)');
    floor.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = floor;
    g.fillRect(0, base - H * 0.04, W, H);
    // Lighting: lit top, shaded underside.
    g.globalCompositeOperation = 'source-atop';
    const light = g.createLinearGradient(0, H * 0.1, 0, base);
    if (warm) {
      light.addColorStop(0, 'rgba(255,214,170,0.55)');
      light.addColorStop(0.55, 'rgba(236,150,140,0.25)');
      light.addColorStop(1, 'rgba(110,80,130,0.6)');
    } else {
      light.addColorStop(0, 'rgba(255,255,255,0)');
      light.addColorStop(0.6, 'rgba(200,216,236,0.2)');
      light.addColorStop(1, 'rgba(150,172,204,0.6)');
    }
    g.fillStyle = light;
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
    this.blendPalette(time);
    const p = this.pal;
    const W = cam.screenW;
    const H = cam.screenH;
    const horizon = this.horizonY(cam);

    // 1. Sky gradient (rebuilt per frame so time-of-day blends are smooth; one gradient is cheap).
    const g = ctx.createLinearGradient(0, 0, 0, Math.max(horizon, 1));
    g.addColorStop(0, rgb(p.top));
    g.addColorStop(0.45, rgb(p.mid));
    g.addColorStop(0.85, rgb(p.low));
    g.addColorStop(1, rgb(p.horizon));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Stars at dusk.
    if (p.stars > 0.02) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * p.stars})`;
      for (let i = 0; i < 60; i++) {
        const sx = ((i * 197.3 + 13) % 1) * 0 + ((i * 7919) % 1000) / 1000 * W;
        const sy = (((i * 104729) % 1000) / 1000) * horizon * 0.6;
        const tw = 0.6 + Math.sin(time * 2 + i) * 0.4;
        ctx.globalAlpha = tw;
        ctx.fillRect(sx, sy, 1.5, 1.5);
      }
      ctx.globalAlpha = 1;
    }

    // Sun: its height and colour follow the time of day.
    const sunX = W * 0.72 - cam.x * 0.02 * cam.zoom;
    const sunY = horizon - (horizon - H * 0.12) * p.sunHeight - 40 * cam.zoom;
    const sunR = 380 * cam.zoom * p.sunSize;
    const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
    sun.addColorStop(0, rgb(p.sun, 0.95));
    sun.addColorStop(0.07, rgb(p.sun, 0.7));
    sun.addColorStop(0.3, rgb(p.sun, 0.16));
    sun.addColorStop(1, rgb(p.sun, 0));
    ctx.fillStyle = sun;
    // Fill only the glow's bounding box — a full-screen radial fill is a major raster cost.
    ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);

    // 2-3. Mountains (two depths), tiled.
    this.drawStrip(ctx, this.mountains, cam, P_MOUNTAINS * 0.6, horizon + 6 * cam.zoom, 0.9);
    this.drawStrip(ctx, this.mountainsNear, cam, P_MOUNTAINS, horizon + 10 * cam.zoom, 0.8);
    // Atmospheric haze: tints the mountains with the time of day and softens the horizon.
    const hazeTop = horizon - 330 * cam.zoom;
    const haze = ctx.createLinearGradient(0, hazeTop, 0, horizon + 4);
    haze.addColorStop(0, rgb(p.haze, 0));
    haze.addColorStop(1, rgb(p.haze, p.hazeAlpha));
    ctx.fillStyle = haze;
    ctx.fillRect(0, hazeTop, W, horizon - hazeTop + 4);

    // 5. Distant sea from the horizon down, with slow swell streaks.
    const seaGrad = ctx.createLinearGradient(0, horizon, 0, H);
    seaGrad.addColorStop(0, rgb(p.seaFar));
    seaGrad.addColorStop(0.15, rgb(p.seaMid));
    seaGrad.addColorStop(1, rgb(p.seaDeep));
    ctx.fillStyle = seaGrad;
    ctx.fillRect(0, horizon, W, H - horizon);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(0, horizon, W, Math.max(1, cam.zoom));
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 9; i++) {
      const depth = (i + 1) / 10;
      const y = horizon + (H - horizon) * depth * depth;
      if (y > H) break;
      const len = (60 + i * 30) * cam.zoom;
      const off = (((time * (6 + i * 3) - cam.x * (0.08 + depth * 0.3) * cam.zoom) % (len * 4)) + len * 4) % (len * 4);
      for (let x = -len * 4 + off; x < W; x += len * 4) ctx.fillRect(x, y, len, Math.max(1, depth * 2 * cam.zoom));
    }

    this.drawClouds(ctx, cam, this.farClouds, P_FAR_CLOUDS, time, 1);
    this.drawShips(ctx, cam, horizon, time);
    this.drawFlyers(ctx, cam, time);
    this.drawClouds(ctx, cam, this.midClouds, P_MID_CLOUDS, time, 1);
    this.drawBirds(ctx, cam, time);
    this.drawClouds(ctx, cam, this.nearClouds, P_NEAR_CLOUDS, time, 1);
  }

  /** Flocks of birds on a mid layer: tiny flapping "m" strokes. */
  private drawBirds(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const period = this.map.width * P_BIRDS + cam.viewW + 1000;
    ctx.strokeStyle = 'rgba(40,52,70,0.55)';
    ctx.lineWidth = Math.max(1, 1.3 * cam.zoom);
    ctx.beginPath();
    for (const f of this.flocks) {
      const lx = f.x + time * f.speed;
      const sx = ((((lx - cam.x * P_BIRDS) % period) + period) % period - 500) * cam.zoom;
      const sy = cam.screenH / 2 + (f.y - cam.y) * P_BIRDS * cam.zoom;
      if (sx < -200 || sx > cam.screenW + 200 || sy < -50 || sy > cam.screenH + 50) continue;
      const dir = Math.sign(f.speed);
      for (let i = 0; i < f.count; i++) {
        const row = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
        const bx = sx - dir * Math.abs(row) * 16 * cam.zoom;
        const by = sy + row * 9 * cam.zoom;
        const flap = Math.sin(time * 9 + f.phase + i) * 3 * cam.zoom;
        const w = 6 * cam.zoom;
        ctx.moveTo(bx - w, by - flap);
        ctx.quadraticCurveTo(bx - w / 2, by - 2 * cam.zoom, bx, by);
        ctx.quadraticCurveTo(bx + w / 2, by - 2 * cam.zoom, bx + w, by - flap);
      }
    }
    ctx.stroke();
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
    const warm = this.pal.warm;
    for (const c of clouds) {
      const lx = c.x + time * WIND * p;
      let sx = ((lx - cam.x * p) % period + period) % period - 600;
      sx = sx * cam.zoom;
      const sy = cam.screenH / 2 + (c.y - cam.y) * p * cam.zoom;
      const w = c.sprite.width * c.scale * sizeMul * cam.zoom;
      const h = c.sprite.height * c.scale * sizeMul * cam.zoom;
      if (sx + w < 0 || sx > cam.screenW || sy + h < 0 || sy - h > cam.screenH) continue;
      this.blitCloud(ctx, c, sx, sy - h * 0.7, w, h, c.alpha, warm);
    }
    ctx.globalAlpha = 1;
  }

  /** Cross-fade the cool and warm-lit versions of a cloud by the time of day. */
  private blitCloud(ctx: CanvasRenderingContext2D, c: Cloud, x: number, y: number, w: number, h: number, alpha: number, warm: number): void {
    if (warm < 0.97) {
      ctx.globalAlpha = alpha * (1 - warm);
      ctx.drawImage(c.sprite, x, y, w, h);
    }
    if (warm > 0.03) {
      ctx.globalAlpha = alpha * warm;
      ctx.drawImage(c.warm, x, y, w, h);
    }
  }

  /**
   * World-depth clouds (parallax 1): drawn before aircraft so planes fly in
   * front of them, with soft shadows cast onto the sea.
   */
  drawWorldClouds(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const warm = this.pal.warm;
    const sea = this.terrain.seaLevel;
    const span = this.map.width + 1600;
    for (const c of this.worldClouds) {
      const x = ((((c.x + time * WIND) + 800) % span) + span) % span - 800;
      const w = c.sprite.width * c.scale;
      const h = c.sprite.height * c.scale;
      if (x + w < cam.left - 100 || x > cam.right + 100) continue;
      // Shadow on the sea directly below.
      if (sea > cam.top && sea < cam.bottom + 60) {
        ctx.globalAlpha = 0.12 * c.alpha;
        ctx.fillStyle = '#0a2a44';
        ctx.beginPath();
        ctx.ellipse(x + w / 2, sea + 6, w * 0.4, 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      if (c.y + h < cam.top || c.y - h > cam.bottom) continue;
      this.blitCloud(ctx, c, x, c.y - h * 0.7, w, h, c.alpha, warm);
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

  /**
   * Foreground layer: translucent wisps drifting in front of the action (they
   * fade out near the centre of the screen so they never hide the player)
   * and fine motes whose fast parallax sells speed.
   */
  drawForeground(ctx: CanvasRenderingContext2D, cam: Camera, time: number): void {
    const period = this.map.width * P_FOREGROUND + cam.viewW * 2;
    const cx = cam.screenW / 2;
    const cy = cam.screenH / 2;
    const clearR = Math.min(cam.screenW, cam.screenH) * 0.45;
    for (const c of this.wisps) {
      const lx = c.x + time * WIND * 2;
      const sx = ((((lx - cam.x * P_FOREGROUND) % period) + period) % period - cam.viewW) * cam.zoom;
      const sy = cam.screenH / 2 + (c.y - cam.y) * P_FOREGROUND * cam.zoom;
      const w = c.sprite.width * c.scale * cam.zoom;
      const h = c.sprite.height * c.scale * cam.zoom;
      if (sx + w < 0 || sx > cam.screenW || sy + h < 0 || sy - h > cam.screenH) continue;
      const d = Math.hypot(sx + w / 2 - cx, sy - h * 0.2 - cy);
      const fade = Math.min(1, Math.max(0, (d - clearR * 0.4) / clearR));
      if (fade <= 0.02) continue;
      this.blitCloud(ctx, c, sx, sy - h * 0.5, w, h, c.alpha * fade, this.pal.warm);
    }
    ctx.globalAlpha = 1;
    // Motes.
    ctx.fillStyle = '#ffffff';
    const W = cam.screenW;
    const H = cam.screenH;
    for (const m of this.motes) {
      const x = ((((m.x + time * m.drift - cam.x * P_MOTES) * cam.zoom) % W) + W) % W;
      const y = ((((m.y + Math.sin(time * 0.5 + m.x) * 20 - cam.y * P_MOTES) * cam.zoom) % H) + H) % H;
      ctx.globalAlpha = m.a;
      ctx.fillRect(x, y, m.r * cam.zoom, m.r * cam.zoom);
    }
    ctx.globalAlpha = 1;
  }
}
