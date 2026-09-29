import { TICK_DT } from '../constants';
import { angleDiff, clamp } from '../math';
import { spawnMissile } from '../systems/weapons';
import { Button, emptyCommand, type Aircraft, type InputCommand } from '../types';
import type { World } from '../world';
import { avoidAircraft, avoidHazards, type AiState } from './brain';

/** Per-boss behaviour tuning. Phases are entered as hull drops below each threshold. */
export interface BossProfile {
  /** Hull fractions at which phases 2, 3, 4... begin (descending). */
  phaseAt: number[];
  /** Missiles per salvo, per phase (index 0 = phase 1). */
  salvoSize: number[];
  /** Seconds between salvos, per phase. */
  salvoInterval: number[];
  /** Preferred distance to the target, per phase. */
  standoff: number[];
  /** Phases (1-based) whose start raises a temporary shield. */
  shieldPhases: number[];
  /** Phase (1-based) from which escort drones are launched; 0 = never. */
  dronesFrom: number;
  droneInterval: number;
  maxDrones: number;
  /** Phase (1-based) that goes "critical": faster turning and speed. */
  criticalPhase: number;
}

export const BOSS_PROFILES: Record<string, BossProfile> = {
  stormbreaker: {
    phaseAt: [0.7, 0.4, 0.15],
    salvoSize: [3, 2, 4, 5],
    salvoInterval: [5, 6, 4, 2.8],
    standoff: [1100, 950, 450, 600],
    shieldPhases: [2, 4],
    dronesFrom: 2,
    droneInterval: 11,
    maxDrones: 4,
    criticalPhase: 4,
  },
  warden: {
    phaseAt: [0.5],
    salvoSize: [2, 3],
    salvoInterval: [6, 4.5],
    standoff: [700, 450],
    shieldPhases: [2],
    dronesFrom: 0,
    droneInterval: 0,
    maxDrones: 0,
    criticalPhase: 2,
  },
};

/** Things the boss asks the game mode to do (spawning belongs to the mode). */
export interface BossHooks {
  /** Launch `count` escort drones near the boss; returns how many were spawned. */
  spawnEscorts(boss: Aircraft, count: number): number;
  /** Escorts currently alive. */
  escortsAlive(): number;
}

const SHIELD_TIME = 2.6;
const SALVO_FAN = 0.7;
const GUN_CONE = 0.4;
const DETECT_RANGE = 4000;

/**
 * Boss pilot: keeps a phase-dependent standoff distance, fires fanned missile
 * salvos and flak, raises a shield on some phase changes, launches drones and
 * turns critical near death. Like every AI it flies by producing an
 * InputCommand; salvos use the sim's own missile spawner.
 */
export class BossBrain {
  state: AiState = 'APPROACH';
  phase = 1;
  targetId = 0;
  private salvoTimer = 3;
  private droneTimer = 4;
  private orbit = 0;
  private shieldTimer = 0;
  private readonly cmd: InputCommand = emptyCommand();

  /**
   * @param aggression 0..1 — early levels (low) fire smaller, less frequent salvos
   *   so the first bosses a new pilot meets are beatable.
   */
  constructor(readonly profile: BossProfile, private readonly hooks: BossHooks, readonly aggression = 1) {}

  private salvoSize(i: number): number {
    // The very first boss (aggression 0) fights with guns only.
    if (this.aggression < 0.1) return 0;
    const n = this.profile.salvoSize[Math.min(i, this.profile.salvoSize.length - 1)];
    return Math.max(1, Math.round(n * (0.5 + 0.5 * this.aggression)));
  }

  private salvoInterval(i: number): number {
    return this.profile.salvoInterval[Math.min(i, this.profile.salvoInterval.length - 1)] / (0.45 + 0.55 * this.aggression);
  }

  get shielded(): boolean {
    return this.shieldTimer > 0;
  }

  think(world: World, self: Aircraft): InputCommand {
    const cmd = this.cmd;
    cmd.steerX = 0;
    cmd.steerY = 0;
    cmd.turn = 0;
    cmd.buttons = 0;
    if (!self.alive) {
      this.state = 'DESTROYED';
      return cmd;
    }
    const dt = TICK_DT;
    const prof = this.profile;
    this.updatePhase(world, self);
    if (this.shieldTimer > 0) {
      this.shieldTimer -= dt;
      if (this.shieldTimer <= 0) self.godMode = false;
    }

    const target = this.pickTarget(world, self);
    this.targetId = target ? target.id : 0;
    const i = this.phase - 1;
    let sx = Math.cos(self.heading);
    let sy = Math.sin(self.heading);

    if (target) {
      const d = Math.hypot(target.x - self.x, target.y - self.y);
      const standoff = prof.standoff[Math.min(i, prof.standoff.length - 1)];
      // Circle the target at the standoff range (slowly orbiting), or bore in when far.
      this.orbit += dt * 0.25;
      const ox = target.x + Math.cos(this.orbit) * standoff;
      const oy = target.y + Math.sin(this.orbit) * standoff * 0.45 - 150;
      // Early bosses aim loosely (wobble) so a new pilot can survive the flak.
      const wobble = Math.sin(world.time * 1.7 + self.id) * 0.3 * (1 - this.aggression);
      const aimAngle = Math.atan2(target.y - self.y, target.x - self.x) + wobble;
      const wantAttack = d < standoff * 1.3;
      const goal = wantAttack ? aimAngle : Math.atan2(oy - self.y, ox - self.x);
      sx = Math.cos(goal);
      sy = Math.sin(goal);
      this.state = wantAttack ? 'ATTACK' : 'APPROACH';
      if (d > standoff * 1.8 && self.boostEnergy > 40) cmd.buttons |= Button.Boost;

      // Flak: whenever the target is roughly ahead and in range.
      const cone = GUN_CONE * (0.55 + 0.45 * this.aggression);
      if (d < 1000 + 150 * this.aggression && Math.abs(angleDiff(self.heading, aimAngle)) < cone) cmd.buttons |= Button.Fire;

      // Missile salvo.
      this.salvoTimer -= dt;
      if (this.salvoTimer <= 0 && d < 2200) {
        const n = this.salvoSize(i);
        if (n === 0) this.salvoTimer = Infinity;
        for (let k = 0; k < n; k++) {
          const off = n > 1 ? (k / (n - 1) - 0.5) * SALVO_FAN : 0;
          spawnMissile(world, self, target.id, off);
        }
        this.salvoTimer = this.salvoInterval(i);
      }

      // Escort drones.
      if (prof.dronesFrom && this.phase >= prof.dronesFrom) {
        this.droneTimer -= dt;
        if (this.droneTimer <= 0) {
          const room = prof.maxDrones - this.hooks.escortsAlive();
          if (room > 0) this.hooks.spawnEscorts(self, Math.min(2, room));
          this.droneTimer = prof.droneInterval;
        }
      }
    } else {
      this.state = 'PATROL';
    }

    [sx, sy] = avoidAircraft(world, self, sx, sy);
    [sx, sy] = avoidHazards(world, self, sx, sy);
    cmd.steerX = sx;
    cmd.steerY = sy;
    return cmd;
  }

  private updatePhase(world: World, self: Aircraft): void {
    const frac = self.health / self.def.health;
    let phase = 1;
    for (const t of this.profile.phaseAt) if (frac < t) phase++;
    if (phase <= this.phase) return;
    this.phase = phase;
    world.emit({ type: 'bossPhase', id: self.id, phase });
    if (this.profile.shieldPhases.includes(phase)) {
      this.shieldTimer = SHIELD_TIME;
      self.godMode = true;
    }
    if (phase === this.profile.criticalPhase) {
      // Critical: the airframe is pushed past its limits. (Bosses always own their def copy.)
      self.def.turnRate *= 1.3;
      self.def.cruiseSpeed *= 1.15;
      self.def.maxSpeed *= 1.15;
      self.throttle = clamp(self.throttle + 0.15, 0, 1);
    }
    // Phase changes also reset the salvo clock so the next attack pattern starts fresh.
    this.salvoTimer = Math.min(this.salvoTimer, 1.5);
  }

  private pickTarget(world: World, self: Aircraft): Aircraft | null {
    let best: Aircraft | null = null;
    let bestD = DETECT_RANGE;
    for (const o of world.aircraft) {
      if (!o.alive || !world.areEnemies(self, o)) continue;
      const d = Math.hypot(o.x - self.x, o.y - self.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }
}
