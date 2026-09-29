import { TEAM_BLUE } from '../../sim/constants';
import { angleDiff, approach } from '../../sim/math';
import type { Aircraft } from '../../sim/types';
import type { World } from '../../sim/world';
import { PALETTES, drawAirframe, drawExhaust } from './aircraftArt';
import { AzureBackground } from './background';
import { paintPalette } from './paints';
import { Camera } from './camera';
import type { FxDirector } from './fx';
import { Hud, type HudView } from './hud';
import { ParticleSystem } from './particles';

const MAX_DPR = 2;
/** Visual roll rate when the aircraft reverses direction (1/s). */
const ROLL_RATE = 6;
const TRACER_LEN = 0.02;
/**
 * Airframe art is authored at ~76 units long; drawn larger so silhouettes read
 * clearly at gameplay zoom. Collision radii in the aircraft defs are sized to match.
 */
export const ART_SCALE = 1.3;

interface AircraftVisual { roll: number }

/** Draws the game world (not menus). Owns camera, particles and HUD instances. */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly cam = new Camera();
  readonly particles = new ParticleSystem(5000);
  readonly hud = new Hud();
  private bg: AzureBackground | null = null;
  private bgWorld: World | null = null;
  private dpr = 1;
  private readonly visuals = new Map<number, AircraftVisual>();
  private readonly glow: HTMLCanvasElement;

  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is not supported in this browser.');
    this.ctx = ctx;
    this.glow = document.createElement('canvas');
    this.glow.width = this.glow.height = 64;
    const g = this.glow.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,236,170,0.9)');
    grad.addColorStop(0.5, 'rgba(255,170,60,0.35)');
    grad.addColorStop(1, 'rgba(255,120,20,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.cam.resize(w, h);
  }

  attach(world: World): void {
    if (this.bgWorld !== world) {
      this.bg = new AzureBackground(world.map, world.terrain);
      this.bgWorld = world;
      this.visuals.clear();
    }
  }

  render(world: World, alpha: number, time: number, dt: number, fx: FxDirector, hudView: HudView | null): void {
    this.attach(world);
    const ctx = this.ctx;
    const cam = this.cam;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.bg!.drawSky(ctx, cam, time);

    ctx.save();
    cam.apply(ctx);
    this.bg!.drawWorld(ctx, cam, time);
    const l = cam.left - 100;
    const t = cam.top - 100;
    const r = cam.right + 100;
    const b = cam.bottom + 100;
    this.particles.render(ctx, l, t, r, b, 0);
    this.drawFlares(ctx, world, alpha);
    this.drawMissiles(ctx, world, alpha);
    for (const a of world.aircraft) if (a.alive) this.drawAircraft(ctx, a, alpha, time, dt, fx);
    this.drawPilots(ctx, fx);
    this.drawBullets(ctx, world, alpha);
    this.particles.render(ctx, l, t, r, b, 1);
    ctx.restore();

    this.bg!.drawForeground(ctx, cam, time);
    if (hudView) this.hud.draw(ctx, hudView);
  }

  private drawAircraft(ctx: CanvasRenderingContext2D, a: Aircraft, alpha: number, time: number, dt: number, fx: FxDirector): void {
    const x = a.px + (a.x - a.px) * alpha;
    const y = a.py + (a.y - a.py) * alpha;
    const cam = this.cam;
    if (x < cam.left - 120 || x > cam.right + 120 || y < cam.top - 120 || y > cam.bottom + 120) return;
    const h = a.pheading + angleDiff(a.pheading, a.heading) * alpha;
    let vis = this.visuals.get(a.id);
    if (!vis) {
      vis = { roll: Math.cos(h) >= 0 ? 1 : -1 };
      this.visuals.set(a.id, vis);
    }
    // Keep the canopy up: roll the airframe through inverted when the nose crosses vertical.
    vis.roll = approach(vis.roll, Math.cos(h) >= 0 ? 1 : -1, dt * ROLL_RATE);
    const pal = a.team !== TEAM_BLUE ? PALETTES.orange
      : a.isHuman && a.id === fx.localId ? paintPalette(fx.playerPaint) : PALETTES.blue;
    const hp = a.health / a.def.health;

    ctx.save();
    // Stealth: the Phantom fades out (still faintly visible so the pilot can see themselves).
    const stealthed = a.abilityTimer > 0 && a.ability.kind === 'stealth';
    if (stealthed) ctx.globalAlpha = fx.localId === a.id ? 0.35 : 0.12 + Math.abs(Math.sin(time * 9)) * 0.08;
    ctx.translate(x, y);
    ctx.rotate(h);
    ctx.scale(ART_SCALE, ART_SCALE);
    drawExhaust(ctx, a.def.art, pal, Math.min(1.3, a.speed / a.def.cruiseSpeed), a.boosting, time + a.id, hp < 0.25);
    drawAirframe(ctx, a.def.art, pal, {
      roll: vis.roll,
      flash: Math.min(1, (fx.flash.get(a.id) ?? 0) * 12),
      missiles: a.missileAmmo > 0,
      damage: 1 - hp,
    });
    ctx.restore();

    if (a.abilityTimer > 0 && a.ability.kind === 'armor') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(150,220,255,${0.4 + Math.sin(time * 6) * 0.1})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, 50, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (a.abilityTimer > 0 && a.ability.kind === 'overcharge') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(120,240,255,${0.35 + Math.sin(time * 20) * 0.15})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 44, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (a.spawnProtection > 0) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(time * 12) * 0.12;
      ctx.strokeStyle = '#bff6ff';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.lineDashOffset = time * 40;
      ctx.beginPath();
      ctx.arc(x, y, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (hp < 0.1 && Math.sin(time * 14) > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5;
      ctx.drawImage(this.glow, x - 22, y - 22, 44, 44);
      ctx.restore();
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D, world: World, alpha: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const team of [TEAM_BLUE, 0]) {
      ctx.strokeStyle = team === TEAM_BLUE ? '#8ff0ff' : '#ffb35a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const bl of world.bullets) {
        if (!bl.active || (team === TEAM_BLUE) !== (bl.team === TEAM_BLUE)) continue;
        const x = bl.px + (bl.x - bl.px) * alpha;
        const y = bl.py + (bl.y - bl.py) * alpha;
        ctx.moveTo(x, y);
        ctx.lineTo(x - bl.vx * TRACER_LEN, y - bl.vy * TRACER_LEN);
      }
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawMissiles(ctx: CanvasRenderingContext2D, world: World, alpha: number): void {
    for (const m of world.missiles) {
      if (!m.active) continue;
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(m.heading);
      ctx.scale(1.3, 1.3);
      ctx.fillStyle = '#f2f4f6';
      ctx.fillRect(-9, -2, 16, 4);
      ctx.fillStyle = m.team === TEAM_BLUE ? '#27d4ff' : '#ff7b1c';
      ctx.beginPath();
      ctx.moveTo(10, 0); ctx.lineTo(7, -2); ctx.lineTo(7, 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-9, -4, 4, 8);
      ctx.restore();
    }
  }

  private drawFlares(ctx: CanvasRenderingContext2D, world: World, alpha: number): void {
    void alpha;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of world.flares) {
      if (!f.active) continue;
      const s = 26 + Math.sin(f.life * 40) * 6;
      ctx.globalAlpha = Math.min(1, f.life * 2);
      ctx.drawImage(this.glow, f.x - s, f.y - s, s * 2, s * 2);
    }
    ctx.restore();
  }

  private drawPilots(ctx: CanvasRenderingContext2D, fx: FxDirector): void {
    for (const p of fx.pilots) {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.t > 0.55) {
        const open = Math.min(1, (p.t - 0.55) * 4);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0); ctx.lineTo(-10 * open, -22);
        ctx.moveTo(0, 0); ctx.lineTo(10 * open, -22);
        ctx.stroke();
        ctx.fillStyle = p.team === TEAM_BLUE ? '#e8f6ff' : '#ffd9b8';
        ctx.beginPath();
        ctx.ellipse(0, -24, 16 * open, 8, 0, Math.PI, 0);
        ctx.fill();
        ctx.fillStyle = p.team === TEAM_BLUE ? '#27d4ff' : '#ff7b1c';
        ctx.fillRect(-2, -30, 4, 6);
      }
      ctx.fillStyle = '#3b3f45';
      ctx.fillRect(-2.5, -3, 5, 7);
      ctx.restore();
    }
  }
}
