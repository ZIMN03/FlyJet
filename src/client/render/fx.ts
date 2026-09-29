import type { AudioEngine } from '../audio/audio';
import { TEAM_BLUE } from '../../sim/constants';
import type { Aircraft, SimEvent } from '../../sim/types';
import type { World } from '../../sim/world';
import type { Camera } from './camera';
import type { Hud } from './hud';
import { PK, type ParticleSystem } from './particles';

const C = {
  fireOrange: 0xff8a2a,
  fireYellow: 0xffd766,
  fireRed: 0xe0461e,
  smokeDark: 0x2e2b29,
  smokeGrey: 0x77797c,
  smokeLight: 0xe4e9ee,
  spark: 0xffe39a,
  cyan: 0x72e8ff,
  orange: 0xffa24a,
  water: 0xe6f7ff,
  dust: 0xb9a582,
  white: 0xffffff,
  debrisBlue: 0xc7d2dc,
  debrisOrange: 0x5d626b,
};

/** Camera trauma per event type (0..1). */
const TRAUMA = { hitTaken: 0.16, hitDealt: 0.04, missileNear: 0.45, destroyNear: 0.75, crash: 0.5 };
/** Distance within which explosions shake the camera. */
const SHAKE_RANGE = 1600;

interface Fragment { x: number; y: number; vx: number; vy: number; life: number; color: number }
export interface Pilot { x: number; y: number; vx: number; vy: number; t: number; team: number }

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * Translates simulation events into feedback (particles, shake, sound, HUD)
 * and runs per-frame cosmetic emitters. Nothing here affects gameplay, so it
 * is safe to run only on clients and to vary with the effects setting.
 */
export class FxDirector {
  readonly fragments: Fragment[] = [];
  readonly pilots: Pilot[] = [];
  /** Per-aircraft hit-flash timers (seconds), read by the renderer. */
  readonly flash = new Map<number, number>();
  /** Callback for brief slow-motion on big moments (offline only). */
  onSlowmo: ((duration: number, scale: number) => void) | null = null;
  localId = 0;
  /** When false (menu backdrop), effects play silently. */
  soundEnabled = true;
  /** Paint scheme applied to the local player's aircraft (cosmetic). */
  playerPaint = 'standard';

  constructor(
    private readonly ps: ParticleSystem,
    private readonly cam: Camera,
    private readonly audio: AudioEngine,
    private readonly hud: Hud | null,
  ) {}

  private sfx(...args: Parameters<AudioEngine['play']>): void {
    if (this.soundEnabled) this.audio.play(...args);
  }

  reset(): void {
    this.fragments.length = 0;
    this.pilots.length = 0;
    this.flash.clear();
    this.ps.clear();
  }

  private n(base: number): number {
    return Math.max(1, Math.round(base * this.ps.density));
  }

  private distToCam(x: number, y: number): number {
    return Math.hypot(x - this.cam.x, y - this.cam.y);
  }

  handle(world: World, events: readonly SimEvent[]): void {
    for (const e of events) this.handleOne(world, e);
  }

  private handleOne(world: World, e: SimEvent): void {
    const local = this.localId;
    switch (e.type) {
      case 'gunFire': {
        const a = world.getAircraft(e.id);
        const blue = a?.team === TEAM_BLUE;
        this.ps.spawn(PK.Flash, e.x, e.y, 0, 0, 0.05, 10, 16, blue ? C.cyan : C.orange, 0, 0, 0.9);
        if (e.id === local) this.sfx('gun');
        else this.sfx(blue ? 'gun' : 'gunEnemy', e.x, e.y, 0.6);
        break;
      }
      case 'bulletHit': {
        const big = e.crit;
        for (let i = 0; i < this.n(big ? 12 : 6); i++) {
          const a = Math.random() * Math.PI * 2;
          const s = rand(150, big ? 520 : 360);
          this.ps.spawn(PK.Spark, e.x, e.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.12, 0.3), big ? 2.2 : 1.6, 0.5, C.spark, 3, 200);
        }
        this.ps.spawn(PK.Flash, e.x, e.y, 0, 0, 0.07, big ? 16 : 9, big ? 34 : 18, big ? C.fireYellow : C.white, 0, 0, 0.9);
        this.flash.set(e.targetId, 0.07);
        if (e.attackerId === local) {
          this.hud?.hitMarker(e.crit);
          this.sfx(e.crit ? 'hitCrit' : 'hitConfirm');
          this.cam.addTrauma(TRAUMA.hitDealt);
        }
        if (e.targetId === local) {
          this.sfx('hurt');
          this.cam.addTrauma(TRAUMA.hitTaken * (big ? 1.6 : 1));
          const t = world.getAircraft(local);
          const att = world.getAircraft(e.attackerId);
          this.hud?.damageTaken(t && att ? Math.atan2(att.y - t.y, att.x - t.x) : null);
        }
        break;
      }
      case 'bulletImpact':
        if (this.distToCam(e.x, e.y) > 2000) break;
        for (let i = 0; i < this.n(e.water ? 4 : 3); i++) {
          this.ps.spawn(e.water ? PK.Smoke : PK.Smoke, e.x, e.y, rand(-60, 60), rand(-220, -90), rand(0.3, 0.6),
            3, 9, e.water ? C.water : C.dust, 2, 500, 0.8);
        }
        break;
      case 'missileLaunch':
        for (let i = 0; i < this.n(6); i++) {
          this.ps.spawn(PK.Smoke, e.x, e.y, rand(-60, 60), rand(-60, 60), rand(0.5, 0.9), 6, 20, C.smokeLight, 2, -10, 0.7);
        }
        this.sfx('missileLaunch', e.x, e.y, e.id === local ? 1 : 0.8);
        if (e.targetId === local) this.hud?.banner('MISSILE LAUNCH', '', 0.9, 'warn');
        break;
      case 'missileExplode':
        if (e.radius === 0) {
          // Burnout fizzle: small pop, no shake.
          this.ps.spawn(PK.Flash, e.x, e.y, 0, 0, 0.1, 10, 26, C.fireYellow, 0, 0, 0.8);
          for (let i = 0; i < this.n(5); i++) {
            this.ps.spawn(PK.Smoke, e.x, e.y, rand(-40, 40), rand(-40, 40), rand(0.6, 1), 6, 18, C.smokeGrey, 1.5, -10, 0.5);
          }
          break;
        }
        this.explosion(e.x, e.y, 0.8, e.water);
        this.sfx('explosionSmall', e.x, e.y);
        this.shakeFrom(e.x, e.y, TRAUMA.missileNear);
        break;
      case 'missileDecoyed':
        if (e.victimId === local) this.hud?.banner('DECOYED', 'Missile chasing flares', 1, 'good');
        break;
      case 'flareDeploy':
        this.sfx('flare', e.x, e.y);
        for (let i = 0; i < this.n(10); i++) {
          const a = Math.random() * Math.PI * 2;
          this.ps.spawn(PK.Spark, e.x, e.y, Math.cos(a) * 300, Math.sin(a) * 300, 0.3, 2, 0.5, C.spark, 3, 100);
        }
        break;
      case 'lockAcquired':
        if (e.id === local) this.sfx('lockOn');
        break;
      case 'damaged':
        if (e.id === local && e.source === 'missile') {
          this.cam.addTrauma(0.35);
          this.hud?.damageTaken(null);
        }
        break;
      case 'crash':
        this.explosion(e.x, e.y, 0.5, e.water);
        this.sfx(e.water ? 'splash' : 'crash', e.x, e.y);
        if (e.id === local) {
          this.cam.addTrauma(TRAUMA.crash);
          this.hud?.banner(e.water ? 'SEA IMPACT' : 'TERRAIN IMPACT', 'Heavy hull damage', 1.2, 'warn');
        }
        break;
      case 'destroyed': {
        const a = world.getAircraft(e.id);
        this.destruction(e.x, e.y, e.vx, e.vy, a);
        this.sfx('explosionBig', e.x, e.y);
        this.shakeFrom(e.x, e.y, TRAUMA.destroyNear);
        if (e.id === local) {
          this.cam.addTrauma(0.8);
          this.onSlowmo?.(0.9, 0.3);
        }
        break;
      }
      case 'kill': {
        if (e.killerId === local) {
          const v = world.getAircraft(e.victimId);
          this.hud?.kill(v?.name ?? 'Hostile', e.score, e.streak, e.source);
          this.sfx('kill');
          this.onSlowmo?.(0.35, 0.45);
        }
        break;
      }
      case 'assist':
        if (e.id === local) {
          const v = world.getAircraft(e.victimId);
          this.hud?.assist(v?.name ?? 'Hostile', e.score);
        }
        break;
      case 'spawn':
        this.ps.spawn(PK.Ring, e.x, e.y, 0, 0, 0.6, 10, 120, C.cyan, 0, 0, 0.9);
        this.ps.spawn(PK.Glow, e.x, e.y, 0, 0, 0.5, 30, 70, C.cyan, 0, 0, 0.6);
        if (e.id === local) this.sfx('spawn');
        break;
      case 'ability': {
        const a = world.getAircraft(e.id);
        if (a) {
          const pulse = a.ability.kind === 'energyPulse';
          const col = a.team === TEAM_BLUE ? C.cyan : C.orange;
          this.ps.spawn(PK.Ring, a.x, a.y, 0, 0, pulse ? 0.45 : 0.5, 20, pulse ? a.ability.pulseRadius ?? 300 : 160, col, 0, 0, 1);
          if (pulse) {
            this.ps.spawn(PK.Ring, a.x, a.y, 0, 0, 0.6, 10, (a.ability.pulseRadius ?? 300) * 0.7, C.white, 0, 0, 0.8);
            this.ps.spawn(PK.Glow, a.x, a.y, 0, 0, 0.3, 60, 180, col, 0, 0, 0.7);
            this.cam.addTrauma(e.id === local ? 0.3 : 0.1);
          }
          this.sfx('ability', a.x, a.y);
          if (e.id === local) this.hud?.banner(a.ability.name.toUpperCase(), a.ability.description, 1.2, 'good');
        }
        break;
      }
      case 'waveStart':
        this.hud?.banner(`LEVEL ${e.wave}`, `${e.enemies} opponent${e.enemies > 1 ? 's' : ''} inbound`, 2.2, 'wave');
        this.sfx('waveStart');
        break;
      case 'waveClear':
        this.hud?.banner('LEVEL CLEARED', `+${e.bonus}  ·  Hull repaired  ·  Missiles restocked`, 2.4, 'good');
        this.sfx('waveClear');
        break;
      case 'matchEnd':
        break;
    }
  }

  private shakeFrom(x: number, y: number, amount: number): void {
    const d = this.distToCam(x, y);
    if (d < SHAKE_RANGE) this.cam.addTrauma(amount * (1 - d / SHAKE_RANGE));
  }

  explosion(x: number, y: number, scale: number, water: boolean): void {
    const ps = this.ps;
    ps.spawn(PK.Flash, x, y, 0, 0, 0.14, 40 * scale, 110 * scale, C.fireYellow, 0, 0, 1);
    for (let i = 0; i < this.n(12 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(40, 240) * scale;
      ps.spawn(PK.Fire, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.65), 14 * scale, rand(30, 48) * scale,
        Math.random() < 0.5 ? C.fireOrange : C.fireYellow, 3.5, -40, 0.9);
    }
    for (let i = 0; i < this.n(9 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(20, 110) * scale;
      ps.spawn(PK.Smoke, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(1.1, 2.1), 18 * scale, rand(55, 85) * scale,
        C.smokeDark, 1.6, -18, 0.65);
    }
    for (let i = 0; i < this.n(16 * scale); i++) {
      const a = Math.random() * Math.PI * 2;
      const s = rand(250, 650) * scale;
      ps.spawn(PK.Spark, x, y, Math.cos(a) * s, Math.sin(a) * s, rand(0.3, 0.6), 2, 0.6, C.spark, 2, 320);
    }
    ps.spawn(PK.Ring, x, y, 0, 0, 0.4, 12, 150 * scale, C.white, 0, 0, 0.8);
    if (water) {
      for (let i = 0; i < this.n(18 * scale); i++) {
        ps.spawn(PK.Smoke, x + rand(-30, 30), y, rand(-120, 120), rand(-620, -250) * scale, rand(0.6, 1.1), 6, 16, C.water, 0.6, 900, 0.9);
      }
    }
  }

  private destruction(x: number, y: number, vx: number, vy: number, a: Aircraft | undefined): void {
    this.explosion(x, y, 1.5, false);
    const blue = a?.team === TEAM_BLUE;
    const debris = blue ? C.debrisBlue : C.debrisOrange;
    for (let i = 0; i < this.n(14); i++) {
      const ang = Math.random() * Math.PI * 2;
      const s = rand(120, 460);
      this.ps.spawn(PK.Debris, x, y, vx * 0.4 + Math.cos(ang) * s, vy * 0.4 + Math.sin(ang) * s, rand(1.2, 2.4),
        rand(3, 7), rand(2, 5), i % 4 === 0 ? (blue ? C.cyan : C.orange) : debris, 0.4, 520, 1, rand(-14, 14));
    }
    // Burning fragments trail fire and smoke as they fall.
    for (let i = 0; i < 4; i++) {
      const ang = rand(-Math.PI, 0);
      const s = rand(200, 420);
      this.fragments.push({ x, y, vx: vx * 0.5 + Math.cos(ang) * s, vy: vy * 0.5 + Math.sin(ang) * s, life: rand(1, 1.8), color: debris });
    }
    this.pilots.push({ x, y, vx: vx * 0.2, vy: -420, t: 0, team: a?.team ?? 0 });
  }

  /** Per-frame cosmetic emitters. `alpha` is the render interpolation factor. */
  update(world: World, dt: number, alpha: number): void {
    const ps = this.ps;
    for (const [id, t] of this.flash) {
      if (t - dt <= 0) this.flash.delete(id);
      else this.flash.set(id, t - dt);
    }

    for (const a of world.aircraft) {
      if (!a.alive) continue;
      const x = a.px + (a.x - a.px) * alpha;
      const y = a.py + (a.y - a.py) * alpha;
      const cos = Math.cos(a.heading);
      const sin = Math.sin(a.heading);
      const tailX = x - cos * 36;
      const tailY = y - sin * 36;
      const hp = a.health / a.def.health;

      if (a.boosting && Math.random() < dt * 45 * ps.density) {
        ps.spawn(PK.Smoke, tailX, tailY, -cos * 60 + rand(-20, 20), -sin * 60 + rand(-20, 20), rand(0.35, 0.6), 4, 14, C.smokeLight, 2, -10, 0.45);
      }
      // Contrails at high speed.
      if (a.speed > a.def.maxSpeed * 0.95 && Math.random() < dt * 50 * ps.density) {
        ps.spawn(PK.Smoke, x - cos * 10, y - sin * 10, 0, 0, 0.7, 2.5, 5, C.smokeLight, 0, 0, 0.35);
      }
      if (hp < 0.5 && Math.random() < dt * (hp < 0.25 ? 34 : 14) * ps.density) {
        ps.spawn(PK.Smoke, x - cos * 8, y - sin * 8, rand(-15, 15), rand(-40, -10), rand(0.8, 1.5), 5, hp < 0.25 ? 26 : 18,
          hp < 0.25 ? C.smokeDark : C.smokeGrey, 1, -20, 0.6);
      }
      if (hp < 0.25 && Math.random() < dt * 14 * ps.density) {
        ps.spawn(PK.Fire, x - cos * 12, y - sin * 12, rand(-30, 30), rand(-30, 10), rand(0.15, 0.3), 5, 12, C.fireOrange, 2, 0, 0.9);
        if (Math.random() < 0.3) ps.spawn(PK.Spark, x, y, rand(-200, 200), rand(-250, 50), 0.3, 1.5, 0.5, C.spark, 2, 400);
      }
    }

    for (const m of world.missiles) {
      if (!m.active) continue;
      const x = m.px + (m.x - m.px) * alpha;
      const y = m.py + (m.y - m.py) * alpha;
      const cos = Math.cos(m.heading);
      const sin = Math.sin(m.heading);
      // Emit proportionally to distance so trails stay continuous at any frame rate.
      // One puff per ~9 units travelled keeps the trail continuous at any frame rate.
      const count = Math.min(12, Math.max(1, Math.round((m.speed * dt) / 9 * (0.5 + ps.density * 0.5))));
      for (let i = 0; i < count; i++) {
        const back = 10 + (i / count) * m.speed * dt;
        ps.spawn(PK.Smoke, x - cos * back, y - sin * back, rand(-10, 10), rand(-10, 10),
          rand(0.9, 1.3), 6, rand(15, 21), C.smokeLight, 1.2, -6, 0.5);
      }
      ps.spawn(PK.Glow, x - cos * 9, y - sin * 9, 0, 0, 0.05, 7, 11, C.fireYellow, 0, 0, 0.9);
    }

    for (const f of world.flares) {
      if (!f.active) continue;
      if (Math.random() < dt * 30 * ps.density) {
        ps.spawn(PK.Smoke, f.x, f.y, rand(-10, 10), rand(-30, 0), 0.8, 3, 11, C.smokeLight, 1, -10, 0.5);
      }
    }

    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const fr = this.fragments[i];
      fr.life -= dt;
      fr.vy += 600 * dt;
      fr.x += fr.vx * dt;
      fr.y += fr.vy * dt;
      if (fr.life <= 0 || fr.y > world.terrain.groundY(fr.x)) {
        if (fr.life > 0) this.explosion(fr.x, fr.y, 0.25, fr.y >= world.terrain.seaLevel - 5);
        this.fragments.splice(i, 1);
        continue;
      }
      if (Math.random() < dt * 40 * ps.density) {
        ps.spawn(PK.Fire, fr.x, fr.y, 0, 0, 0.25, 6, 14, C.fireOrange, 0, 0, 0.9);
        ps.spawn(PK.Smoke, fr.x, fr.y, 0, -10, 0.9, 5, 18, C.smokeDark, 0, -15, 0.5);
      }
    }

    for (let i = this.pilots.length - 1; i >= 0; i--) {
      const p = this.pilots[i];
      p.t += dt;
      // Ejection seat arc, then the chute opens and drift slows.
      const chute = p.t > 0.55;
      p.vy += (chute ? 60 : 900) * dt;
      if (chute) {
        p.vy = Math.min(p.vy, 70);
        p.vx *= Math.exp(-1.5 * dt);
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.t > 5 || p.y > world.terrain.groundY(p.x)) this.pilots.splice(i, 1);
    }
  }
}
