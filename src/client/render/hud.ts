import { clamp } from '../../sim/math';
import { PHYSICS, TEAM_BLUE } from '../../sim/constants';
import { LockState, type Aircraft } from '../../sim/types';
import type { World } from '../../sim/world';
import type { WaveMode } from '../../sim/modes/waves';
import type { Camera } from './camera';

export const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const COL = {
  panel: 'rgba(8,16,28,0.62)',
  panelEdge: 'rgba(120,220,255,0.28)',
  text: '#eaf6ff',
  dim: 'rgba(200,225,245,0.65)',
  ally: '#5fe3ff',
  enemy: '#ff6a3d',
  warn: '#ffb020',
  danger: '#ff3b3b',
  good: '#6dffb4',
  health: '#5fe3ff',
  healthLow: '#ffb020',
  healthCrit: '#ff3b3b',
  burner: '#9cf1ff',
};
/** Radar range for minimap/off-screen indicators. Enemies beyond it are hidden. */
const RADAR_RANGE = 3000;
const PIPPER_DIST = 430;

type BannerStyle = 'wave' | 'good' | 'warn';
interface Banner { title: string; sub: string; t: number; dur: number; style: BannerStyle }
interface Notice { text: string; sub: string; t: number; color: string }

export interface HudView {
  world: World;
  cam: Camera;
  local: Aircraft | undefined;
  mode: WaveMode | null;
  alpha: number;
  time: number;
  showMinimap: boolean;
  scale: number;
  tutorial: { text: string; keys: string } | null;
  keyLabel: (action: 'missile' | 'flare' | 'ability' | 'boost') => string;
  debugLines: string[] | null;
  /** Gameplay tip shown during the pre-match countdown. */
  tip: string;
  /** FPS to display (0 = hidden). */
  fps: number;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Screen-space HUD. Draws from sim state each frame; transient feedback
 * (hit markers, kill notices, banners) is pushed in by the FX director.
 */
export class Hud {
  private hitMarkerT = 0;
  private hitCrit = false;
  private damageT = 0;
  private damageDir: number | null = null;
  private banners: Banner[] = [];
  private notices: Notice[] = [];
  private streakText = '';
  private streakT = 0;
  private terrainPts: number[] = [];
  private terrainFor: World | null = null;

  reset(): void {
    this.banners = [];
    this.notices = [];
    this.hitMarkerT = 0;
    this.damageT = 0;
    this.streakT = 0;
  }

  hitMarker(crit: boolean): void {
    this.hitMarkerT = crit ? 0.28 : 0.18;
    this.hitCrit = crit;
  }

  damageTaken(dir: number | null): void {
    this.damageT = 0.5;
    if (dir !== null) this.damageDir = dir;
  }

  banner(title: string, sub: string, dur: number, style: BannerStyle): void {
    // Replace any banner of the same title (e.g. repeated warnings).
    this.banners = this.banners.filter((b) => b.title !== title);
    this.banners.push({ title, sub, t: 0, dur, style });
    if (this.banners.length > 3) this.banners.shift();
  }

  kill(name: string, score: number, streak: number, source: string): void {
    this.notices.push({ text: `DESTROYED  ${name}`, sub: `+${score}${source === 'missile' ? '  MISSILE' : ''}`, t: 0, color: COL.text });
    if (this.notices.length > 4) this.notices.shift();
    if (streak >= 2) {
      this.streakText = streak === 2 ? 'DOUBLE' : streak === 3 ? 'TRIPLE' : `STREAK ×${streak}`;
      this.streakT = 1.8;
    }
  }

  assist(name: string, score: number): void {
    this.notices.push({ text: `ASSIST  ${name}`, sub: `+${score}`, t: 0, color: COL.dim });
    if (this.notices.length > 4) this.notices.shift();
  }

  update(dt: number): void {
    this.hitMarkerT = Math.max(0, this.hitMarkerT - dt);
    this.damageT = Math.max(0, this.damageT - dt);
    this.streakT = Math.max(0, this.streakT - dt);
    for (const b of this.banners) b.t += dt;
    this.banners = this.banners.filter((b) => b.t < b.dur);
    for (const n of this.notices) n.t += dt;
    this.notices = this.notices.filter((n) => n.t < 2.6);
  }

  draw(ctx: CanvasRenderingContext2D, v: HudView): void {
    const W = v.cam.screenW;
    const H = v.cam.screenH;
    const u = clamp(Math.min(W, H * 1.7) / 1400, 0.65, 1.5) * v.scale;
    ctx.save();
    ctx.textBaseline = 'middle';
    const me = v.local;

    this.drawVignette(ctx, W, H, me, v.time);
    if (me && me.alive && me.boosting) this.drawSpeedLines(ctx, W, H, me, v.time);
    this.drawWorldMarkers(ctx, v, u);
    if (me && me.alive) {
      this.drawPipper(ctx, v, me, u);
      this.drawLock(ctx, v, me, u);
      this.drawThreats(ctx, v, me, u, W, H);
    }
    this.drawOffscreen(ctx, v, u, W, H);
    if (me) this.drawPlayerPanel(ctx, v, me, u, H);
    this.drawTopLeft(ctx, v, me, u);
    if (v.showMinimap) this.drawMinimap(ctx, v, u, W);
    this.drawHitMarker(ctx, W, H, u);
    this.drawBanners(ctx, W, H, u);
    this.drawNotices(ctx, W, H, u);
    this.drawPhase(ctx, v, me, u, W, H);
    if (v.tutorial) this.drawTutorial(ctx, v.tutorial, W, u);
    if (v.debugLines) this.drawDebug(ctx, v.debugLines, u);
    else if (v.fps > 0) {
      ctx.textAlign = 'right';
      ctx.font = this.font(12 * u, 600);
      ctx.fillStyle = COL.dim;
      ctx.fillText(`${v.fps} FPS`, W - 20 * u, H - 16 * u);
    }
    ctx.restore();
  }

  /**
   * Text with a cheap offset drop shadow for legibility over bright sky.
   * (shadowBlur is avoided: it is very expensive to rasterise per frame.)
   */
  private text(ctx: CanvasRenderingContext2D, str: string, x: number, y: number, color: string, u: number): void {
    const a = ctx.globalAlpha;
    ctx.fillStyle = 'rgba(0,10,24,0.55)';
    ctx.globalAlpha = a * 0.9;
    ctx.fillText(str, x, y + 2 * u);
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  private font(px: number, weight = 600): string {
    return `${weight} ${Math.round(px)}px ${FONT}`;
  }

  private drawVignette(ctx: CanvasRenderingContext2D, W: number, H: number, me: Aircraft | undefined, time: number): void {
    if (this.damageDir !== null && this.damageT > 0) {
      // Directional hit indicator: an arc on the side the damage came from.
      const r = Math.min(W, H) * 0.3;
      ctx.strokeStyle = `rgba(255,60,40,${this.damageT * 1.4})`;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, r, this.damageDir - 0.35, this.damageDir + 0.35);
      ctx.stroke();
      if (this.damageT <= 0.02) this.damageDir = null;
    }
    let a = this.damageT * 0.9;
    if (me && me.alive && me.health / me.def.health < 0.25) a = Math.max(a, 0.25 + Math.sin(time * 6) * 0.12);
    if (a <= 0.01) return;
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(255,0,0,0)');
    g.addColorStop(1, `rgba(200,10,10,${clamp(a, 0, 0.6)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  private drawSpeedLines(ctx: CanvasRenderingContext2D, W: number, H: number, me: Aircraft, time: number): void {
    const dx = -Math.cos(me.heading);
    const dy = -Math.sin(me.heading);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const seed = i * 97.13;
      const px = ((Math.sin(seed) * 0.5 + 0.5) * W + time * 1700 * dx * (0.6 + (i % 3) * 0.2)) % W;
      const py = ((Math.cos(seed * 1.7) * 0.5 + 0.5) * H + time * 1700 * dy * (0.6 + (i % 3) * 0.2)) % H;
      const x = px < 0 ? px + W : px;
      const y = py < 0 ? py + H : py;
      // Keep the center clear so lines never cover the action.
      if (Math.hypot(x - W / 2, y - H / 2) < Math.min(W, H) * 0.3) continue;
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx * 90, y + dy * 90);
    }
    ctx.stroke();
  }

  private interp(a: Aircraft, alpha: number): [number, number] {
    return [a.px + (a.x - a.px) * alpha, a.py + (a.y - a.py) * alpha];
  }

  private drawWorldMarkers(ctx: CanvasRenderingContext2D, v: HudView, u: number): void {
    const me = v.local;
    for (const a of v.world.aircraft) {
      if (!a.alive || a === me) continue;
      const [wx, wy] = this.interp(a, v.alpha);
      const sx = v.cam.worldToScreenX(wx);
      const sy = v.cam.worldToScreenY(wy);
      if (sx < -50 || sx > v.cam.screenW + 50 || sy < -50 || sy > v.cam.screenH + 50) continue;
      const enemy = !me || a.team !== me.team;
      const col = enemy ? COL.enemy : COL.ally;
      const top = sy - 42 * u * Math.max(0.8, v.cam.zoom);
      // Shape encodes allegiance too (diamond = hostile, chevron = friendly) — never colour alone.
      ctx.fillStyle = col;
      ctx.beginPath();
      if (enemy) {
        ctx.moveTo(sx, top - 6 * u); ctx.lineTo(sx + 5 * u, top); ctx.lineTo(sx, top + 6 * u); ctx.lineTo(sx - 5 * u, top);
      } else {
        ctx.moveTo(sx - 6 * u, top - 3 * u); ctx.lineTo(sx, top + 3 * u); ctx.lineTo(sx + 6 * u, top - 3 * u);
      }
      ctx.closePath();
      ctx.fill();
      // Compact health bar.
      const bw = 44 * u;
      const hp = a.health / a.def.health;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(sx - bw / 2, top + 10 * u, bw, 4 * u);
      ctx.fillStyle = hp < 0.25 ? COL.danger : col;
      ctx.fillRect(sx - bw / 2, top + 10 * u, bw * hp, 4 * u);
      ctx.font = this.font(11 * u, 600);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(a.name, sx, top - 14 * u);
    }
  }

  private drawPipper(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft, u: number): void {
    const [x, y] = this.interp(me, v.alpha);
    const h = me.pheading + (me.heading - me.pheading) * v.alpha;
    const sx = v.cam.worldToScreenX(x + Math.cos(h) * PIPPER_DIST);
    const sy = v.cam.worldToScreenY(y + Math.sin(h) * PIPPER_DIST);
    ctx.strokeStyle = 'rgba(160,240,255,0.7)';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(sx, sy, 9 * u, 0, Math.PI * 2);
    ctx.moveTo(sx - 15 * u, sy); ctx.lineTo(sx - 11 * u, sy);
    ctx.moveTo(sx + 11 * u, sy); ctx.lineTo(sx + 15 * u, sy);
    ctx.stroke();
    ctx.fillStyle = 'rgba(160,240,255,0.9)';
    ctx.fillRect(sx - 1, sy - 1, 2, 2);
  }

  private drawLock(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft, u: number): void {
    if (!me.lockTargetId || me.lockState === LockState.None) return;
    const t = v.world.getAircraft(me.lockTargetId);
    if (!t || !t.alive) return;
    const [wx, wy] = this.interp(t, v.alpha);
    const sx = v.cam.worldToScreenX(wx);
    const sy = v.cam.worldToScreenY(wy);
    const locked = me.lockState === LockState.Locked;
    ctx.save();
    ctx.translate(sx, sy);
    if (locked) {
      const pulse = 1 + Math.sin(v.time * 14) * 0.08;
      const r = 30 * u * pulse;
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = COL.danger;
      ctx.lineWidth = 3 * u;
      ctx.strokeRect(-r / 1.4, -r / 1.4, (r / 1.4) * 2, (r / 1.4) * 2);
      ctx.rotate(-Math.PI / 4);
      ctx.font = this.font(13 * u, 800);
      ctx.textAlign = 'center';
      ctx.fillStyle = COL.danger;
      const ammo = me.missileAmmo > 0;
      ctx.fillText(ammo ? `LOCK  [${v.keyLabel('missile')}]` : 'LOCK  · NO MISSILES', 0, r + 16 * u);
    } else {
      const p = me.lockProgress;
      const r = (70 - 42 * p) * u;
      const len = 12 * u;
      ctx.rotate(p * Math.PI / 2);
      ctx.strokeStyle = p > 0 ? COL.warn : 'rgba(255,200,120,0.55)';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        ctx.moveTo(cx * r, cy * r + -cy * len);
        ctx.lineTo(cx * r, cy * r);
        ctx.lineTo(cx * r + -cx * len, cy * r);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawThreats(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft, u: number, W: number, H: number): void {
    const [x, y] = this.interp(me, v.alpha);
    const sx = v.cam.worldToScreenX(x);
    const sy = v.cam.worldToScreenY(y);
    const blink = Math.sin(v.time * 18) > 0;
    if (me.incomingMissileDist < Infinity) {
      // Arrow around the player pointing at the missile.
      const a = me.incomingMissileAngle;
      const r = 62 * u;
      ctx.fillStyle = COL.danger;
      ctx.save();
      ctx.translate(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(12 * u, 0); ctx.lineTo(-6 * u, -9 * u); ctx.lineTo(-6 * u, 9 * u);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      if (blink || me.incomingMissileDist < 400) {
        this.warningLabel(ctx, W / 2, H * 0.24, '▲ MISSILE ▲', `${Math.round(me.incomingMissileDist)} m — press FLARES [${v.keyLabel('flare')}]`, COL.danger, u);
      }
      ctx.strokeStyle = `rgba(255,40,40,${0.25 + (blink ? 0.2 : 0)})`;
      ctx.lineWidth = 10 * u;
      ctx.strokeRect(0, 0, W, H);
    } else if (me.lockedOn) {
      if (blink) this.warningLabel(ctx, W / 2, H * 0.24, '◆ LOCKED ON ◆', 'Enemy has missile lock', COL.warn, u);
    } else if (me.beingLocked) {
      this.warningLabel(ctx, W / 2, H * 0.24, 'LOCK WARNING', '', 'rgba(255,176,32,0.8)', u * 0.85);
    }

    if (me.outOfBounds) {
      const left = Math.max(0, PHYSICS.boundaryGraceTime - me.outOfBoundsTime);
      this.warningLabel(ctx, W / 2, H * 0.34, 'RETURN TO COMBAT AREA', left > 0 ? `Hull damage in ${left.toFixed(1)}s` : 'Taking damage', COL.warn, u);
    } else {
      const clearance = v.world.terrain.clearance(me.x, me.y);
      if (clearance < 260 && me.vy > 160 && blink) this.warningLabel(ctx, W / 2, H * 0.34, 'PULL UP', '', COL.warn, u);
    }
  }

  private warningLabel(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, sub: string, col: string, u: number): void {
    ctx.textAlign = 'center';
    ctx.font = this.font(26 * u, 800);
    this.text(ctx, title, x, y, col, u);
    if (sub) {
      ctx.font = this.font(14 * u, 600);
      this.text(ctx, sub, x, y + 24 * u, COL.text, u);
    }
  }

  private drawOffscreen(ctx: CanvasRenderingContext2D, v: HudView, u: number, W: number, H: number): void {
    const me = v.local;
    if (!me || !me.alive) return;
    const margin = 34 * u;
    for (const a of v.world.aircraft) {
      if (!a.alive || a === me || a.team === me.team) continue;
      const d = Math.hypot(a.x - me.x, a.y - me.y);
      if (d > RADAR_RANGE) continue;
      const sx = v.cam.worldToScreenX(a.x);
      const sy = v.cam.worldToScreenY(a.y);
      if (sx > 0 && sx < W && sy > 0 && sy < H) continue;
      const cx = W / 2;
      const cy = H / 2;
      const ang = Math.atan2(sy - cy, sx - cx);
      // Project onto the screen rectangle inset by margin.
      const tx = Math.cos(ang);
      const ty = Math.sin(ang);
      const k = Math.min(Math.abs((W / 2 - margin) / (tx || 1e-6)), Math.abs((H / 2 - margin) / (ty || 1e-6)));
      const ex = cx + tx * k;
      const ey = cy + ty * k;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(ang);
      ctx.fillStyle = COL.enemy;
      ctx.beginPath();
      ctx.moveTo(14 * u, 0); ctx.lineTo(-4 * u, -9 * u); ctx.lineTo(0, 0); ctx.lineTo(-4 * u, 9 * u);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.font = this.font(11 * u);
      ctx.textAlign = 'center';
      ctx.fillStyle = COL.text;
      ctx.fillText(`${Math.round(d / 10) * 10}`, ex - tx * 24 * u, ey - ty * 24 * u);
    }
  }

  private bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, frac: number, col: string, segments: number): void {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
    if (segments > 1) {
      ctx.fillStyle = 'rgba(8,16,28,0.8)';
      for (let i = 1; i < segments; i++) ctx.fillRect(x + (w * i) / segments - 1, y, 2, h);
    }
  }

  private drawPlayerPanel(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft, u: number, H: number): void {
    const pw = 330 * u;
    const ph = 124 * u;
    const x = 20 * u;
    const y = H - ph - 20 * u;
    roundRect(ctx, x, y, pw, ph, 10 * u);
    ctx.fillStyle = COL.panel;
    ctx.fill();
    ctx.strokeStyle = COL.panelEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    const hp = me.health / me.def.health;
    const hcol = hp < 0.25 ? COL.healthCrit : hp < 0.5 ? COL.healthLow : COL.health;
    const px = x + 14 * u;
    let py = y + 16 * u;
    ctx.textAlign = 'left';
    ctx.font = this.font(11 * u, 700);
    ctx.fillStyle = COL.dim;
    ctx.fillText('HULL', px, py);
    ctx.textAlign = 'right';
    ctx.fillStyle = hcol;
    const state = hp <= 0 ? 'DOWN' : hp < 0.1 ? 'CRITICAL' : hp < 0.25 ? 'HEAVY DAMAGE' : hp < 0.5 ? 'DAMAGED' : '';
    const critBlink = hp < 0.1 && Math.sin(v.time * 10) < 0;
    ctx.fillText(`${critBlink ? '' : state}  ${Math.ceil(me.health)}`, px + 200 * u, py);
    py += 10 * u;
    this.bar(ctx, px, py, 200 * u, 12 * u, hp, hcol, 10);
    py += 26 * u;
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.dim;
    ctx.fillText(`BURNER [${v.keyLabel('boost')}]`, px, py);
    py += 9 * u;
    const bfrac = me.boostEnergy / me.def.afterburnerCapacity;
    this.bar(ctx, px, py, 200 * u, 7 * u, bfrac, me.boostEnergy < me.def.afterburnerMinStart ? COL.warn : COL.burner, 0);

    // Missiles + flares row.
    py += 26 * u;
    ctx.fillStyle = COL.dim;
    ctx.fillText(`MSL [${v.keyLabel('missile')}]`, px, py);
    for (let i = 0; i < me.def.missileCapacity; i++) {
      const mx = px + 58 * u + i * 13 * u;
      ctx.fillStyle = i < me.missileAmmo ? COL.text : 'rgba(255,255,255,0.15)';
      ctx.fillRect(mx, py - 7 * u, 5 * u, 14 * u);
      if (i === me.missileAmmo && me.missileRearmTimer > 0) {
        const f = me.missileRearmTimer / me.def.missileRearmTime;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(mx, py + 7 * u - 14 * u * f, 5 * u, 14 * u * f);
      }
    }
    const fx = px + 150 * u;
    ctx.fillStyle = COL.dim;
    ctx.fillText(`FLR [${v.keyLabel('flare')}]`, fx - 4 * u, py + 20 * u);
    for (let i = 0; i < me.def.flareCharges; i++) {
      ctx.fillStyle = i < me.flareCharges ? COL.warn : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(fx + 58 * u + i * 13 * u, py + 20 * u, 4 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = COL.dim;
    ctx.fillText(`SPD ${Math.round(Math.hypot(me.vx, me.vy))}`, px, py + 20 * u);

    // Ability ring.
    const ax = x + pw - 52 * u;
    const ay = y + 52 * u;
    const r = 30 * u;
    const ready = me.abilityCooldown <= 0;
    const active = me.abilityTimer > 0;
    ctx.lineWidth = 5 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(ax, ay, r, 0, Math.PI * 2);
    ctx.stroke();
    const frac = active ? me.abilityTimer / me.ability.duration : ready ? 1 : 1 - me.abilityCooldown / me.ability.cooldown;
    ctx.strokeStyle = active ? COL.good : ready ? COL.ally : 'rgba(95,227,255,0.5)';
    ctx.beginPath();
    ctx.arc(ax, ay, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = this.font(ready || active ? 13 * u : 16 * u, 800);
    ctx.fillStyle = ready || active ? COL.text : COL.dim;
    ctx.fillText(active ? 'ACTIVE' : ready ? v.keyLabel('ability') : `${Math.ceil(me.abilityCooldown)}`, ax, ay);
    ctx.font = this.font(10 * u, 700);
    ctx.fillStyle = COL.dim;
    ctx.fillText(me.ability.name.toUpperCase(), ax, ay + r + 14 * u);
    if (ready && !active) {
      ctx.globalAlpha = 0.3 + Math.sin(v.time * 4) * 0.2;
      ctx.strokeStyle = COL.ally;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(ax, ay, r + 6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawTopLeft(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft | undefined, u: number): void {
    const x = 22 * u;
    let y = 30 * u;
    ctx.textAlign = 'left';
    ctx.font = this.font(30 * u, 800);
    ctx.fillStyle = COL.text;
    ctx.fillText(`${me?.stats.score ?? 0}`, x, y);
    ctx.font = this.font(11 * u, 700);
    ctx.fillStyle = COL.dim;
    ctx.fillText('SCORE', x, y + 22 * u);
    y += 46 * u;
    const m = v.mode;
    if (m && m.wave > 0) {
      ctx.font = this.font(14 * u, 700);
      ctx.fillStyle = COL.text;
      ctx.fillText(`WAVE ${m.wave}  ·  ${m.enemiesRemaining} HOSTILE${m.enemiesRemaining === 1 ? '' : 'S'}`, x, y);
      y += 22 * u;
    }
    if (me && me.lives > 0) {
      ctx.font = this.font(11 * u, 700);
      ctx.fillStyle = COL.dim;
      ctx.fillText('LIVES', x, y);
      for (let i = 0; i < me.lives; i++) {
        ctx.fillStyle = COL.ally;
        ctx.beginPath();
        const lx = x + 46 * u + i * 16 * u;
        ctx.moveTo(lx + 7 * u, y); ctx.lineTo(lx - 5 * u, y - 5 * u); ctx.lineTo(lx - 2 * u, y); ctx.lineTo(lx - 5 * u, y + 5 * u);
        ctx.closePath();
        ctx.fill();
      }
      y += 20 * u;
    }
    if (me && me.stats.streak >= 2) {
      ctx.font = this.font(12 * u, 700);
      ctx.fillStyle = COL.warn;
      ctx.fillText(`STREAK ${me.stats.streak}`, x, y);
    }
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, v: HudView, u: number, W: number): void {
    const world = v.world;
    const mw = 250 * u;
    const mh = mw * (world.map.height / world.map.width) * 1.25;
    const x = W - mw - 20 * u;
    const y = 20 * u;
    const sx = mw / world.map.width;
    const sy = mh / world.map.height;
    roundRect(ctx, x - 6 * u, y - 6 * u, mw + 12 * u, mh + 12 * u, 8 * u);
    ctx.fillStyle = COL.panel;
    ctx.fill();
    ctx.strokeStyle = COL.panelEdge;
    ctx.stroke();

    if (this.terrainFor !== world) {
      this.terrainFor = world;
      this.terrainPts = [];
      for (let i = 0; i <= 160; i++) {
        const wx = (i / 160) * world.map.width;
        this.terrainPts.push(wx, world.terrain.groundY(wx));
      }
    }
    ctx.fillStyle = 'rgba(140,170,190,0.35)';
    ctx.beginPath();
    ctx.moveTo(x, y + mh);
    for (let i = 0; i < this.terrainPts.length; i += 2) ctx.lineTo(x + this.terrainPts[i] * sx, y + this.terrainPts[i + 1] * sy);
    ctx.lineTo(x + mw, y + mh);
    ctx.closePath();
    ctx.fill();

    // Camera view box.
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + v.cam.left * sx, y + v.cam.top * sy, v.cam.viewW * sx, v.cam.viewH * sy);

    const me = v.local;
    for (const m of world.missiles) {
      if (!m.active) continue;
      ctx.fillStyle = me && m.targetId === me.id ? COL.danger : 'rgba(255,255,255,0.7)';
      ctx.fillRect(x + m.x * sx - 1.5, y + m.y * sy - 1.5, 3, 3);
    }
    for (const a of world.aircraft) {
      if (!a.alive) continue;
      const isMe = a === me;
      const enemy = me ? a.team !== me.team : a.team !== TEAM_BLUE;
      // Radar only reveals enemies inside detection range (no wall-hacks).
      if (enemy && me && me.alive && Math.hypot(a.x - me.x, a.y - me.y) > RADAR_RANGE) continue;
      const px = x + a.x * sx;
      const py = y + a.y * sy;
      ctx.save();
      ctx.translate(px, py);
      if (isMe) {
        ctx.rotate(a.heading);
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(7 * u, 0); ctx.lineTo(-5 * u, -4.5 * u); ctx.lineTo(-5 * u, 4.5 * u);
        ctx.closePath();
        ctx.fill();
      } else if (enemy) {
        ctx.fillStyle = COL.enemy;
        ctx.beginPath();
        ctx.moveTo(0, -4 * u); ctx.lineTo(4 * u, 0); ctx.lineTo(0, 4 * u); ctx.lineTo(-4 * u, 0);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = COL.ally;
        ctx.fillRect(-3 * u, -3 * u, 6 * u, 6 * u);
      }
      ctx.restore();
    }
  }

  private drawHitMarker(ctx: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    if (this.hitMarkerT <= 0) return;
    const cx = W / 2;
    const cy = H / 2;
    const s = (this.hitCrit ? 14 : 10) * u;
    ctx.strokeStyle = this.hitCrit ? COL.warn : '#ffffff';
    ctx.globalAlpha = Math.min(1, this.hitMarkerT * 6);
    ctx.lineWidth = (this.hitCrit ? 3 : 2) * u;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      ctx.moveTo(cx + dx * s * 0.5, cy + dy * s * 0.5);
      ctx.lineTo(cx + dx * s * 1.3, cy + dy * s * 1.3);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  private drawBanners(ctx: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    let y = H * 0.13;
    for (const b of this.banners) {
      const inT = Math.min(1, b.t * 6);
      const outT = Math.min(1, (b.dur - b.t) * 4);
      const a = Math.min(inT, outT);
      const col = b.style === 'warn' ? COL.warn : b.style === 'good' ? COL.good : COL.text;
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      const size = b.style === 'wave' ? 38 : 22;
      ctx.font = this.font(size * u * (0.9 + inT * 0.1), 800);
      this.text(ctx, b.title, W / 2, y, col, u);
      if (b.sub) {
        ctx.font = this.font(14 * u, 600);
        this.text(ctx, b.sub, W / 2, y + (size * 0.5 + 14) * u, COL.text, u);
      }
      y += (size + 36) * u;
    }
    ctx.globalAlpha = 1;
  }

  private drawNotices(ctx: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    let y = H * 0.7;
    ctx.textAlign = 'center';
    for (let i = this.notices.length - 1; i >= 0; i--) {
      const n = this.notices[i];
      const a = Math.min(1, n.t * 8, (2.6 - n.t) * 3);
      const slide = (1 - Math.min(1, n.t * 8)) * 20 * u;
      ctx.globalAlpha = a;
      ctx.font = this.font(16 * u, 700);
      this.text(ctx, n.text, W / 2 - 30 * u + slide, y, n.color, u);
      ctx.textAlign = 'left';
      const tw = ctx.measureText(n.text).width;
      this.text(ctx, n.sub, W / 2 - 30 * u + slide + tw / 2 + 14 * u, y, COL.warn, u);
      ctx.textAlign = 'center';
      y -= 26 * u;
    }
    if (this.streakT > 0) {
      const a = Math.min(1, this.streakT * 3);
      const pop = 1 + Math.max(0, this.streakT - 1.55) * 2;
      ctx.globalAlpha = a;
      ctx.font = this.font(32 * u * pop, 900);
      this.text(ctx, this.streakText, W / 2, H * 0.7 + 44 * u, COL.warn, u);
    }
    ctx.globalAlpha = 1;
  }

  private drawPhase(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft | undefined, u: number, W: number, H: number): void {
    const m = v.mode;
    ctx.textAlign = 'center';
    if (m && m.phase === 'countdown') {
      const t = m.phaseTimer;
      const n = Math.ceil(t - 0.5);
      const label = n > 0 ? `${Math.min(3, n)}` : 'GO';
      const frac = (t - 0.5) % 1;
      const s = 1 + (frac < 0 ? 0 : frac) * 0.4;
      ctx.font = this.font(96 * u * s, 900);
      this.text(ctx, label, W / 2, H * 0.4, n > 0 ? COL.text : COL.good, u * 1.5);
      ctx.font = this.font(16 * u, 600);
      this.text(ctx, `${v.world.map.name.toUpperCase()}  ·  ENDLESS SKIES`, W / 2, H * 0.4 + 70 * u, COL.text, u);
      if (v.tip) {
        ctx.font = this.font(14 * u, 600);
        this.text(ctx, `TIP  ·  ${v.tip}`, W / 2, H * 0.4 + 100 * u, COL.text, u);
      }
    }
    if (m && m.phase === 'intermission') {
      ctx.font = this.font(15 * u, 700);
      this.text(ctx, `Next wave in ${Math.ceil(m.phaseTimer)}`, W / 2, H * 0.33, COL.text, u);
    }
    if (me && !me.alive && (!m || (m.phase !== 'ending' && m.phase !== 'ended'))) {
      ctx.font = this.font(34 * u, 900);
      // Kept above centre so it never covers the explosion the camera is framing.
      this.text(ctx, 'SHOT DOWN', W / 2, H * 0.27, COL.danger, u);
      if (me.respawnTimer > 0) {
        ctx.font = this.font(16 * u, 600);
        this.text(ctx, `Respawning in ${me.respawnTimer.toFixed(1)}  ·  ${me.lives} ${me.lives === 1 ? 'life' : 'lives'} left`, W / 2, H * 0.27 + 36 * u, COL.text, u);
      }
    }
    if (m && m.phase === 'ending') {
      ctx.font = this.font(44 * u, 900);
      this.text(ctx, 'MISSION OVER', W / 2, H * 0.3, COL.danger, u);
    }
  }

  private drawTutorial(ctx: CanvasRenderingContext2D, tut: { text: string; keys: string }, W: number, u: number): void {
    ctx.font = this.font(15 * u, 600);
    const text = tut.text;
    const keys = tut.keys;
    ctx.font = this.font(15 * u, 700);
    const kw = ctx.measureText(keys).width + 20 * u;
    ctx.font = this.font(15 * u, 600);
    const tw = ctx.measureText(text).width;
    const w = tw + kw + 36 * u;
    const h = 38 * u;
    const x = W / 2 - w / 2;
    const y = 20 * u;
    roundRect(ctx, x, y, w, h, 8 * u);
    ctx.fillStyle = 'rgba(8,16,28,0.75)';
    ctx.fill();
    ctx.strokeStyle = COL.ally;
    ctx.stroke();
    roundRect(ctx, x + 10 * u, y + 7 * u, kw, h - 14 * u, 5 * u);
    ctx.fillStyle = COL.ally;
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.font = this.font(15 * u, 800);
    ctx.fillStyle = '#04121c';
    ctx.fillText(keys, x + 20 * u, y + h / 2);
    ctx.font = this.font(15 * u, 600);
    ctx.fillStyle = COL.text;
    ctx.fillText(text, x + kw + 22 * u, y + h / 2);
  }

  private drawDebug(ctx: CanvasRenderingContext2D, lines: string[], u: number): void {
    ctx.textAlign = 'left';
    ctx.font = `12px ui-monospace, Menlo, monospace`;
    const y0 = 170 * u;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(16 * u, y0 - 12, 300, lines.length * 16 + 8);
    ctx.fillStyle = '#b8ffb8';
    lines.forEach((l, i) => ctx.fillText(l, 22 * u, y0 + i * 16));
  }
}
