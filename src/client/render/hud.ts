import { clamp } from '../../sim/math';
import { PHYSICS, TEAM_BLUE } from '../../sim/constants';
import { cruiseThrottle } from '../../sim/systems/flight';
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

type BannerStyle = 'wave' | 'good' | 'warn' | 'boss';
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
  keyLabel: (action: 'missile' | 'flare' | 'ability' | 'boost' | 'throttleUp') => string;
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
  // Smoothed/ghost values so bars glide instead of jumping.
  private hpShown = -1;
  private hpGhost = -1;
  private bossShown = -1;
  private bossGhost = -1;
  private bossFor = 0;
  private targetShown = 0;
  private contactT = 0;
  private contactBearing = 0;
  private lastDt = 1 / 60;

  reset(): void {
    this.hpShown = this.hpGhost = this.bossShown = this.bossGhost = -1;
    this.contactT = 0;
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

  /** Pulse a radar-contact indicator on the side the bandits are coming from. */
  contact(bearing: number): void {
    this.contactT = 2.4;
    this.contactBearing = bearing;
  }

  /** Small centre notice (e.g. "MISSILE EVADED +20 XP"). */
  notice(text: string, sub: string): void {
    this.notices.push({ text, sub, t: 0, color: COL.good });
    if (this.notices.length > 4) this.notices.shift();
  }

  assist(name: string, score: number): void {
    this.notices.push({ text: `ASSIST  ${name}`, sub: `+${score}`, t: 0, color: COL.dim });
    if (this.notices.length > 4) this.notices.shift();
  }

  update(dt: number): void {
    this.lastDt = dt;
    this.contactT = Math.max(0, this.contactT - dt);
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
    if (me && me.alive) this.drawVelocityVector(ctx, v, me, u);
    if (me) this.drawPlayerPanel(ctx, v, me, u, H);
    this.drawTopLeft(ctx, v, me, u);
    if (v.showMinimap) this.drawMinimap(ctx, v, u, W);
    if (me && me.alive) this.drawTargetPanel(ctx, v, me, u, W);
    this.drawBossBar(ctx, v, u, W);
    if (this.contactT > 0) this.drawContact(ctx, u, W, H, v.time);
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
      // Large airframes (bosses) push the marker clear of their art.
      const top = sy - 42 * u * Math.max(0.8, v.cam.zoom) * Math.max(1, (a.def.artScale ?? 1) * 0.85);
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
      // One arrow around the player per missile chasing us; closer = bigger and brighter.
      for (const m of v.world.missiles) {
        if (!m.active || m.targetId !== me.id || m.flareTarget >= 0) continue;
        const a = Math.atan2(m.y - me.y, m.x - me.x);
        const md = Math.hypot(m.x - me.x, m.y - me.y);
        const k = clamp(1.4 - md / 1500, 0.6, 1.4);
        const r = 62 * u;
        ctx.fillStyle = md < 500 ? COL.danger : 'rgba(255,90,70,0.8)';
        ctx.save();
        ctx.translate(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(12 * u * k, 0); ctx.lineTo(-6 * u * k, -9 * u * k); ctx.lineTo(-6 * u * k, 9 * u * k);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
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
    } else if (me.stalled) {
      this.warningLabel(ctx, W / 2, H * 0.34, 'STALL', `Flip the nose now, or dive / throttle up [${v.keyLabel('throttleUp')}] to recover`,
        blink ? COL.danger : COL.warn, u);
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
    // Collect edge markers, nearest first; ones that would overlap merge into a
    // single arrow showing the closest range and how many bandits it stands for.
    const marks: { ex: number; ey: number; tx: number; ty: number; ang: number; d: number; n: number }[] = [];
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
      marks.push({ ex: cx + tx * k, ey: cy + ty * k, tx, ty, ang, d, n: 1 });
    }
    marks.sort((p, q) => p.d - q.d);
    const kept: typeof marks = [];
    const minSep = 30 * u;
    for (const m of marks) {
      const near = kept.find((k) => Math.hypot(k.ex - m.ex, k.ey - m.ey) < minSep);
      if (near) near.n++;
      else kept.push(m);
    }
    ctx.textAlign = 'center';
    ctx.font = this.font(11 * u);
    for (const m of kept) {
      ctx.save();
      ctx.translate(m.ex, m.ey);
      ctx.rotate(m.ang);
      ctx.fillStyle = COL.enemy;
      ctx.beginPath();
      ctx.moveTo(14 * u, 0); ctx.lineTo(-4 * u, -9 * u); ctx.lineTo(0, 0); ctx.lineTo(-4 * u, 9 * u);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = COL.text;
      const label = `${Math.round(m.d / 10) * 10}${m.n > 1 ? ` ×${m.n}` : ''}`;
      ctx.fillText(label, m.ex - m.tx * (m.n > 1 ? 32 : 24) * u, m.ey - m.ty * 24 * u);
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
    const pw = 410 * u;
    const ph = 128 * u;
    const x = 20 * u;
    const y = H - ph - 20 * u;
    roundRect(ctx, x, y, pw, ph, 10 * u);
    ctx.fillStyle = COL.panel;
    ctx.fill();
    ctx.strokeStyle = COL.panelEdge;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Hull with a smooth fill and a trailing "ghost" of recent damage.
    const hp = me.health / me.def.health;
    const dt = this.lastDt;
    if (this.hpShown < 0) this.hpShown = this.hpGhost = hp;
    this.hpShown += (hp - this.hpShown) * Math.min(1, dt * 14);
    this.hpGhost = hp > this.hpGhost ? hp : this.hpGhost - Math.min(this.hpGhost - hp, dt * 0.35);
    const hcol = hp < 0.25 ? COL.healthCrit : hp < 0.5 ? COL.healthLow : COL.health;
    const px = x + 14 * u;
    let py = y + 16 * u;
    const barW = 210 * u;
    ctx.textAlign = 'left';
    ctx.font = this.font(11 * u, 700);
    ctx.fillStyle = COL.dim;
    ctx.fillText('HULL', px, py);
    ctx.textAlign = 'right';
    ctx.fillStyle = hcol;
    const state = hp <= 0 ? 'DOWN' : hp < 0.1 ? 'CRITICAL' : hp < 0.25 ? 'HEAVY DAMAGE' : hp < 0.5 ? 'DAMAGED' : '';
    const critBlink = hp < 0.1 && Math.sin(v.time * 10) < 0;
    ctx.fillText(`${critBlink ? '' : state}  ${Math.ceil(me.health)}`, px + barW, py);
    py += 10 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(px, py, barW, 12 * u);
    ctx.fillStyle = 'rgba(255,80,60,0.75)';
    ctx.fillRect(px, py, barW * clamp(this.hpGhost, 0, 1), 12 * u);
    ctx.fillStyle = hcol;
    ctx.fillRect(px, py, barW * clamp(this.hpShown, 0, 1), 12 * u);
    ctx.fillStyle = 'rgba(8,16,28,0.8)';
    for (let i = 1; i < 10; i++) ctx.fillRect(px + (barW * i) / 10 - 1, py, 2, 12 * u);

    // Burner fuel and cannon heat side by side.
    py += 26 * u;
    const half = barW / 2 - 6 * u;
    ctx.textAlign = 'left';
    ctx.fillStyle = COL.dim;
    ctx.fillText(`BURNER [${v.keyLabel('boost')}]`, px, py);
    ctx.fillStyle = me.overheated ? COL.danger : COL.dim;
    // Weapon name doubles as the heat bar label (e.g. "PULSE CANNON").
    ctx.fillText(me.overheated ? 'OVERHEATED' : me.gun.name.replace(/^Twin /, '').toUpperCase(), px + half + 12 * u, py);
    py += 9 * u;
    const bfrac = me.boostEnergy / me.def.afterburnerCapacity;
    this.bar(ctx, px, py, half, 7 * u, bfrac, me.boostEnergy < me.def.afterburnerMinStart ? COL.warn : me.boosting ? '#ffffff' : COL.burner, 0);
    const heatCol = me.overheated ? (Math.sin(v.time * 16) > 0 ? COL.danger : COL.warn) : me.gunHeat > 0.7 ? COL.warn : 'rgba(255,200,140,0.85)';
    this.bar(ctx, px + half + 12 * u, py, half, 7 * u, me.gunHeat, heatCol, 0);

    // Missiles + flares.
    py += 24 * u;
    ctx.fillStyle = COL.dim;
    ctx.fillText(`MSL [${v.keyLabel('missile')}]`, px, py);
    const cap = me.def.missileCapacity;
    const pipW = Math.min(13 * u, (half - 48 * u) / Math.max(1, cap));
    for (let i = 0; i < cap; i++) {
      const mx = px + 56 * u + i * pipW;
      ctx.fillStyle = i < me.missileAmmo ? COL.text : 'rgba(255,255,255,0.15)';
      ctx.fillRect(mx, py - 7 * u, Math.max(2, pipW - 7 * u), 14 * u);
      if (i === me.missileAmmo && me.missileRearmTimer > 0) {
        const f = me.missileRearmTimer / me.def.missileRearmTime;
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.fillRect(mx, py + 7 * u - 14 * u * f, Math.max(2, pipW - 7 * u), 14 * u * f);
      }
    }
    const fx = px + half + 12 * u;
    ctx.fillStyle = COL.dim;
    ctx.fillText(`FLR [${v.keyLabel('flare')}]`, fx, py);
    for (let i = 0; i < me.def.flareCharges; i++) {
      ctx.fillStyle = i < me.flareCharges ? COL.warn : 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(fx + 56 * u + i * 13 * u, py, 4 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    py += 22 * u;
    ctx.fillStyle = COL.dim;
    ctx.fillText(`SPD ${Math.round(Math.hypot(me.vx, me.vy))}`, px, py);
    ctx.fillText(`ALT ${Math.max(0, Math.round(v.world.map.seaLevel - me.y))}`, fx, py);

    // Throttle gauge (vertical), with a tick at the cruise setting.
    const tx = x + 238 * u;
    const ty = y + 14 * u;
    const th = ph - 44 * u;
    const tw = 10 * u;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = me.stalled ? COL.danger : me.throttle < cruiseThrottle(me.def) * 0.6 ? COL.warn : COL.ally;
    ctx.fillRect(tx, ty + th * (1 - me.throttle), tw, th * me.throttle);
    const cy = ty + th * (1 - cruiseThrottle(me.def));
    ctx.fillStyle = COL.text;
    ctx.fillRect(tx - 3 * u, cy - 1, tw + 6 * u, 2);
    ctx.textAlign = 'center';
    ctx.font = this.font(10 * u, 700);
    ctx.fillStyle = me.stalled ? COL.danger : COL.dim;
    ctx.fillText(me.stalled ? 'STALL' : 'THR', tx + tw / 2, ty + th + 12 * u);
    ctx.fillText(`${Math.round(me.throttle * 100)}`, tx + tw / 2, ty + th + 24 * u);

    // Heading dial: always readable through full loops.
    this.drawHeadingDial(ctx, me, x + 292 * u, y + 52 * u, 26 * u, u);

    // Ability ring.
    const ax = x + pw - 44 * u;
    const ay = y + 52 * u;
    const r = 26 * u;
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
    ctx.font = this.font(ready || active ? 12 * u : 16 * u, 800);
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

  /**
   * Attitude/heading dial: a small aircraft symbol points exactly where the
   * nose points on screen, with the angle in degrees (0 = level right,
   * 90 = straight up, 180 = level left, 270 = straight down).
   */
  private drawHeadingDial(ctx: CanvasRenderingContext2D, me: Aircraft, cx: number, cy: number, r: number, u: number): void {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const inner = i % 2 === 0 ? r - 6 * u : r - 3 * u;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
    // Horizon reference.
    ctx.strokeStyle = 'rgba(95,227,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(me.heading);
    ctx.fillStyle = COL.ally;
    ctx.beginPath();
    ctx.moveTo(r - 4 * u, 0);
    ctx.lineTo(-r * 0.45, -r * 0.32);
    ctx.lineTo(-r * 0.2, 0);
    ctx.lineTo(-r * 0.45, r * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    const deg = Math.round(((-me.heading * 180) / Math.PI + 360) % 360) % 360;
    ctx.textAlign = 'center';
    ctx.font = this.font(10 * u, 700);
    ctx.fillStyle = COL.dim;
    ctx.fillText(`HDG ${String(deg).padStart(3, '0')}°`, cx, cy + r + 14 * u);
  }

  /** Where the aircraft is actually moving (differs from the nose while drifting or stalled). */
  private drawVelocityVector(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft, u: number): void {
    const sp = Math.hypot(me.vx, me.vy);
    if (sp < 1) return;
    const [x, y] = this.interp(me, v.alpha);
    const d = 300;
    const sx = v.cam.worldToScreenX(x + (me.vx / sp) * d);
    const sy = v.cam.worldToScreenY(y + (me.vy / sp) * d);
    ctx.strokeStyle = 'rgba(160,240,255,0.45)';
    ctx.lineWidth = 1.5 * u;
    ctx.beginPath();
    ctx.arc(sx, sy, 5 * u, 0, Math.PI * 2);
    ctx.moveTo(sx - 12 * u, sy); ctx.lineTo(sx - 5 * u, sy);
    ctx.moveTo(sx + 5 * u, sy); ctx.lineTo(sx + 12 * u, sy);
    ctx.moveTo(sx, sy - 5 * u); ctx.lineTo(sx, sy - 10 * u);
    ctx.stroke();
  }

  /** Locked (or nearest visible) enemy: identity, range, hull and lock status. */
  private drawTargetPanel(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft, u: number, W: number): void {
    let t = me.lockTargetId ? v.world.getAircraft(me.lockTargetId) : undefined;
    if (!t || !t.alive) {
      let best = RADAR_RANGE;
      for (const a of v.world.aircraft) {
        if (!a.alive || a.team === me.team || a.def.boss) continue;
        const d = Math.hypot(a.x - me.x, a.y - me.y);
        if (d < best) { best = d; t = a; }
      }
    }
    if (!t || !t.alive) return;
    if (t.id !== this.targetShown) this.targetShown = t.id;
    const w = 250 * u;
    const h = 62 * u;
    const x = W - w - 20 * u;
    const y = (v.showMinimap ? 128 : 20) * u;
    roundRect(ctx, x, y, w, h, 8 * u);
    ctx.fillStyle = COL.panel;
    ctx.fill();
    ctx.strokeStyle = me.lockState === LockState.Locked && me.lockTargetId === t.id ? 'rgba(255,59,59,0.7)' : COL.panelEdge;
    ctx.stroke();
    const d = Math.hypot(t.x - me.x, t.y - me.y);
    ctx.textAlign = 'left';
    ctx.font = this.font(13 * u, 800);
    ctx.fillStyle = COL.enemy;
    ctx.fillText(t.def.name, x + 12 * u, y + 16 * u);
    ctx.font = this.font(10 * u, 700);
    ctx.fillStyle = COL.dim;
    ctx.fillText((t.def.role ?? t.def.className).toUpperCase(), x + 12 * u, y + 32 * u);
    ctx.textAlign = 'right';
    ctx.font = this.font(12 * u, 700);
    ctx.fillStyle = COL.text;
    ctx.fillText(`${Math.round(d / 10) * 10} m`, x + w - 12 * u, y + 16 * u);
    const locked = me.lockTargetId === t.id;
    const lockTxt = !locked ? 'NO LOCK' : me.lockState === LockState.Locked ? 'LOCKED' : `LOCKING ${Math.round(me.lockProgress * 100)}%`;
    ctx.font = this.font(10 * u, 800);
    ctx.fillStyle = locked && me.lockState === LockState.Locked ? COL.danger : locked ? COL.warn : COL.dim;
    ctx.fillText(lockTxt, x + w - 12 * u, y + 32 * u);
    this.bar(ctx, x + 12 * u, y + 44 * u, w - 24 * u, 6 * u, t.health / t.def.health, COL.enemy, 0);
  }

  /** Boss health bar across the top, with phase and shield state. */
  private drawBossBar(ctx: CanvasRenderingContext2D, v: HudView, u: number, W: number): void {
    const m = v.mode;
    const b = m && m.bossId ? v.world.getAircraft(m.bossId) : undefined;
    if (!b || !b.alive) {
      this.bossShown = this.bossGhost = -1;
      return;
    }
    const f = b.health / b.def.health;
    const dt = this.lastDt;
    if (this.bossShown < 0 || this.bossFor !== b.id) {
      this.bossShown = this.bossGhost = f;
      this.bossFor = b.id;
    }
    this.bossShown += (f - this.bossShown) * Math.min(1, dt * 10);
    this.bossGhost = f > this.bossGhost ? f : this.bossGhost - Math.min(this.bossGhost - f, dt * 0.25);
    const w = Math.min(560 * u, W * 0.5);
    const x = W / 2 - w / 2;
    // Sits below the tutorial hint strip so neither hides the other.
    const y = 96 * u;
    ctx.textAlign = 'center';
    ctx.font = this.font(13 * u, 800);
    const brain = v.world.brains.get(b.id) as { phase?: number } | undefined;
    const phase = brain?.phase ?? 1;
    this.text(ctx, `${b.def.name}  ·  ${b.godMode ? 'SHIELDED' : `PHASE ${phase}`}`, W / 2, y - 12 * u, b.godMode ? COL.warn : COL.enemy, u);
    ctx.fillStyle = 'rgba(8,16,28,0.7)';
    ctx.fillRect(x - 2, y - 2, w + 4, 12 * u + 4);
    ctx.fillStyle = 'rgba(255,200,120,0.7)';
    ctx.fillRect(x, y, w * clamp(this.bossGhost, 0, 1), 12 * u);
    ctx.fillStyle = b.godMode ? 'rgba(255,176,32,0.9)' : COL.enemy;
    ctx.fillRect(x, y, w * clamp(this.bossShown, 0, 1), 12 * u);
  }

  /** Radar contact: a sweeping chevron pulse on the side the bandits are coming from. */
  private drawContact(ctx: CanvasRenderingContext2D, u: number, W: number, H: number, time: number): void {
    const right = Math.cos(this.contactBearing) > 0;
    const x = right ? W - 70 * u : 70 * u;
    const a = Math.min(1, this.contactT) * (0.5 + Math.sin(time * 10) * 0.3);
    ctx.globalAlpha = a;
    ctx.fillStyle = COL.warn;
    for (let i = 0; i < 3; i++) {
      const ox = (right ? 1 : -1) * i * 18 * u;
      ctx.beginPath();
      ctx.moveTo(x + ox + (right ? 12 : -12) * u, H / 2);
      ctx.lineTo(x + ox, H / 2 - 14 * u);
      ctx.lineTo(x + ox, H / 2 + 14 * u);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawTopLeft(ctx: CanvasRenderingContext2D, v: HudView, me: Aircraft | undefined, u: number): void {
    const x = 22 * u;
    let y = 30 * u;
    ctx.textAlign = 'left';
    ctx.font = this.font(30 * u, 800);
    this.text(ctx, `${me?.stats.score ?? 0}`, x, y, COL.text, u);
    ctx.font = this.font(11 * u, 700);
    this.text(ctx, 'SCORE', x, y + 22 * u, COL.dim, u);
    y += 46 * u;
    const m = v.mode;
    if (m && m.wave > 0) {
      ctx.font = this.font(14 * u, 700);
      this.text(ctx, `LEVEL ${m.wave}`, x, y, COL.text, u);
      // Stage progress pips: waves, then the boss (diamond).
      const stages = m.stages.length;
      for (let i = 0; i < stages; i++) {
        const px = x + 76 * u + i * 16 * u;
        const done = i < m.stage || (i === m.stage && (m.phase === 'intermission' || m.phase === 'levelComplete'));
        const current = i === m.stage && !done;
        ctx.fillStyle = done ? COL.good : current ? COL.text : 'rgba(255,255,255,0.2)';
        ctx.beginPath();
        if (m.stages[i].kind === 'boss') {
          ctx.moveTo(px, y - 6 * u); ctx.lineTo(px + 6 * u, y); ctx.lineTo(px, y + 6 * u); ctx.lineTo(px - 6 * u, y);
        } else {
          ctx.arc(px, y, 4 * u, 0, Math.PI * 2);
        }
        ctx.closePath();
        ctx.fill();
      }
      y += 20 * u;
      ctx.font = this.font(12 * u, 700);
      const st = m.stages[m.stage];
      const what = m.phase === 'bossWarning' ? 'BOSS INBOUND' : m.phase === 'levelComplete' ? 'LEVEL COMPLETE'
        : st ? `${st.label.toUpperCase()}  ·  ${m.enemiesRemaining} HOSTILE${m.enemiesRemaining === 1 ? '' : 'S'}` : '';
      this.text(ctx, what, x, y, COL.dim, u);
      y += 22 * u;
    }
    if (me && me.lives > 0) {
      ctx.font = this.font(11 * u, 700);
      this.text(ctx, 'LIVES', x, y, COL.dim, u);
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
    // Keep banners clear of the boss bar while one is shown.
    let y = this.bossShown >= 0 ? Math.max(H * 0.13, 150 * u) : H * 0.13;
    for (const b of this.banners) {
      const inT = Math.min(1, b.t * 6);
      const outT = Math.min(1, (b.dur - b.t) * 4);
      const a = Math.min(inT, outT);
      const col = b.style === 'warn' ? COL.warn : b.style === 'good' ? COL.good : b.style === 'boss' ? COL.danger : COL.text;
      if (b.style === 'boss') {
        // Boss warning: pulsing hazard band behind the title.
        ctx.globalAlpha = a * (0.35 + Math.sin(b.t * 12) * 0.15);
        ctx.fillStyle = 'rgba(160,20,20,0.6)';
        ctx.fillRect(0, y - 26 * u, W, 52 * u);
      }
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      const size = b.style === 'wave' || b.style === 'boss' ? 38 : 22;
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
      this.text(ctx, `${m.stages[m.stage]?.label ?? 'Next wave'} in ${Math.ceil(m.phaseTimer)}`, W / 2, H * 0.33, COL.text, u);
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
