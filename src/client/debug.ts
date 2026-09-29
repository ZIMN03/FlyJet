import { AiBrain } from '../sim/ai/brain';
import { PERSONALITIES } from '../sim/ai/personalities';
import { TEAM_ORANGE } from '../sim/constants';
import { applyDamage } from '../sim/systems/damage';
import { spawnAircraft } from '../sim/systems/spawn';
import type { MatchSession } from './session';

/**
 * Developer tools. Available in dev builds, or in release builds only with
 * `?debug` in the URL. Offline-only: these directly mutate the local world,
 * which a server would never accept from a client.
 *
 *   F3  overlay (FPS, sim stats, AI states)    F6  spawn enemy
 *   F4  god mode                               F7  destroy all enemies
 *   F8  refill missiles/flares/energy          F9  restart match
 *   F10 self-destruct (tests death/respawn/game over)
 */
export class DebugTools {
  readonly enabled: boolean;
  overlay = false;
  private fpsAcc = 0;
  private frames = 0;
  fps = 0;
  frameMs = 0;

  constructor() {
    this.enabled = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
  }

  tickFps(dt: number, frameMs: number): void {
    this.fpsAcc += dt;
    this.frames++;
    this.frameMs = this.frameMs * 0.9 + frameMs * 0.1;
    if (this.fpsAcc >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsAcc);
      this.fpsAcc = 0;
      this.frames = 0;
    }
  }

  /** Returns true if the key was consumed. */
  handleKey(code: string, session: MatchSession | null, restart: () => void, toast: (s: string) => void): boolean {
    if (!this.enabled) return false;
    if (code === 'F3') {
      this.overlay = !this.overlay;
      return true;
    }
    if (!session || !session.offline) return false;
    const w = session.world;
    const me = session.local();
    switch (code) {
      case 'F4':
        if (me) {
          me.godMode = !me.godMode;
          toast(`God mode ${me.godMode ? 'ON' : 'OFF'}`);
        }
        return true;
      case 'F6': {
        const e = w.addAircraft('scythe', TEAM_ORANGE, 'Debug Bogey', false, 1);
        w.brains.set(e.id, new AiBrain(PERSONALITIES.aggressive, 0.6));
        const x = Math.min(w.map.width - 800, Math.max(800, (me?.x ?? 4000) + 1600));
        spawnAircraft(w, e, x, 900, -1);
        toast('Spawned enemy');
        return true;
      }
      case 'F7':
        for (const a of w.aircraft) if (a.alive && me && a.team !== me.team) applyDamage(w, a, 9999, me.id, 'debug');
        toast('Destroyed all enemies');
        return true;
      case 'F8':
        if (me) {
          me.missileAmmo = me.def.missileCapacity;
          me.flareCharges = me.def.flareCharges;
          me.boostEnergy = me.def.afterburnerCapacity;
          me.abilityCooldown = 0;
          toast('Refilled');
        }
        return true;
      case 'F9':
        restart();
        return true;
      case 'F10':
        if (me && me.alive) {
          me.godMode = false;
          me.spawnProtection = 0;
          applyDamage(w, me, 9999, 0, 'debug');
        }
        return true;
    }
    return false;
  }

  lines(session: MatchSession, particles: number): string[] {
    const w = session.world;
    const me = session.local();
    const bullets = w.bullets.reduce((n, b) => n + (b.active ? 1 : 0), 0);
    const missiles = w.missiles.reduce((n, m) => n + (m.active ? 1 : 0), 0);
    const out = [
      `FPS ${this.fps}  frame ${this.frameMs.toFixed(2)}ms`,
      `tick ${w.tick}  aircraft ${w.aircraft.length}  bullets ${bullets}  missiles ${missiles}`,
      `particles ${particles}  net: offline (local sim)`,
    ];
    if (me) out.push(`pos ${me.x.toFixed(0)},${me.y.toFixed(0)}  spd ${me.speed.toFixed(0)}  god ${me.godMode ? 'on' : 'off'}`);
    for (const [id, b] of w.brains) {
      const a = w.getAircraft(id);
      if (a && a.alive) out.push(`${a.name.padEnd(14)} ${b.state.padEnd(13)} ${b.personality.label}`);
    }
    return out;
  }
}
