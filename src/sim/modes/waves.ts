import { AiBrain } from '../ai/brain';
import { PERSONALITIES } from '../ai/personalities';
import { AIRCRAFT, type AircraftDef } from '../config/aircraft';
import { COMBAT, SCORE, TEAM_ORANGE } from '../constants';
import { clamp } from '../math';
import { chooseSpawn, spawnAircraft } from '../systems/spawn';
import type { Aircraft } from '../types';
import type { World } from '../world';
import type { GameMode, MatchPhase } from './mode';

export interface WaveConfig {
  countdown: number;
  intermission: number;
  /** Delay after the last life is lost before the match ends (lets the explosion play). */
  endDelay: number;
  /** Health restored (fraction of max) on wave clear. */
  waveRepair: number;
}

export const DEFAULT_WAVE_CONFIG: WaveConfig = {
  countdown: 3.5,
  intermission: 3.5,
  endDelay: 2.8,
  waveRepair: 0.3,
};

/**
 * Personality mix per level (index = level - 1; the last entry repeats).
 * The opening levels are deliberately easy so new pilots get early wins.
 */
const LEVEL_ROSTER: string[][] = [
  ['trainee'],
  ['trainee'],
  ['trainee'],
  ['trainee', 'trainee', 'rookie'],
  ['rookie', 'trainee'],
  ['rookie', 'aggressive', 'trainee'],
  ['aggressive', 'defensive', 'rookie'],
  ['aggressive', 'tactical', 'defensive'],
  ['tactical', 'aggressive', 'defensive', 'ace'],
  ['ace', 'tactical', 'aggressive', 'defensive'],
];
/** Level at which enemies reach full strength. */
const FULL_STRENGTH_LEVEL = 10;
/** Hard cap on enemies per level (performance / screen clarity). */
const MAX_LEVEL_ENEMIES = 12;

export interface LevelDifficulty {
  enemies: number;
  roster: string[];
  /** 0..1 AI competence (aim, reaction time). */
  skill: number;
  /** Per-enemy stat changes on top of the base interceptor. */
  overrides: Partial<AircraftDef>;
}

/**
 * Difficulty curve. Level N sends N opponents. Early opponents are fragile,
 * slower, turn wider, can't fire missiles and aim badly; everything ramps up
 * until FULL_STRENGTH_LEVEL.
 */
export function levelDifficulty(level: number): LevelDifficulty {
  const t = clamp((level - 1) / (FULL_STRENGTH_LEVEL - 1), 0, 1);
  const base = AIRCRAFT.scythe;
  return {
    enemies: clamp(level, 1, MAX_LEVEL_ENEMIES),
    roster: LEVEL_ROSTER[Math.min(level - 1, LEVEL_ROSTER.length - 1)],
    skill: clamp(0.1 + (level - 1) * 0.09, 0.1, 1),
    overrides: {
      health: Math.round(base.health * (0.4 + 0.6 * t)),
      turnRate: base.turnRate * (0.7 + 0.3 * t),
      cruiseSpeed: base.cruiseSpeed * (0.82 + 0.18 * t),
      maxSpeed: base.maxSpeed * (0.85 + 0.15 * t),
      boostSpeed: base.boostSpeed * (0.85 + 0.15 * t),
      missileCapacity: level <= 2 ? 0 : level <= 4 ? 1 : base.missileCapacity,
      flareCharges: level <= 2 ? 0 : level <= 5 ? 1 : base.flareCharges,
    },
  };
}

const ENEMY_SPAWN_MIN_DIST = 2000;
const ENEMY_SPAWN_MAX_DIST = 2900;
/** Seconds a destroyed enemy lingers in the world list (lets clients read its last state). */
const CORPSE_LINGER = 1.5;

/**
 * Offline "Endless Skies" prototype: the player(s) survive escalating waves of
 * AI interceptors with a limited number of lives.
 */
export class WaveMode implements GameMode {
  readonly id = 'waves';
  phase: MatchPhase = 'countdown';
  phaseTimer: number;
  wave = 0;
  survivalTime = 0;
  endReason = '';
  private readonly enemies = new Set<number>();
  private readonly corpseTimers = new Map<number, number>();
  private enemySerial = 0;

  constructor(
    private readonly playerIds: number[],
    readonly config: WaveConfig = DEFAULT_WAVE_CONFIG,
  ) {
    this.phaseTimer = config.countdown;
  }

  get combatEnabled(): boolean {
    return this.phase !== 'countdown' && this.phase !== 'ended';
  }

  get enemiesRemaining(): number {
    return this.enemies.size;
  }

  update(world: World, dt: number): void {
    // Clean up destroyed enemies after a short linger.
    for (const [id, t] of this.corpseTimers) {
      const left = t - dt;
      if (left <= 0) {
        this.corpseTimers.delete(id);
        world.removeAircraft(id);
      } else this.corpseTimers.set(id, left);
    }

    switch (this.phase) {
      case 'countdown':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.startWave(world);
        break;
      case 'playing':
        this.survivalTime += dt;
        if (this.enemies.size === 0) {
          const bonus = SCORE.waveClear * this.wave;
          for (const id of this.playerIds) {
            const p = world.getAircraft(id);
            if (!p) continue;
            p.stats.score += bonus;
            if (p.alive) {
              p.health = Math.min(p.def.health, p.health + p.def.health * this.config.waveRepair);
              p.missileAmmo = p.def.missileCapacity;
            }
          }
          world.emit({ type: 'waveClear', wave: this.wave, bonus });
          this.phase = 'intermission';
          this.phaseTimer = this.config.intermission;
        }
        break;
      case 'intermission':
        this.survivalTime += dt;
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.startWave(world);
        break;
      case 'ending':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) {
          this.phase = 'ended';
          world.emit({ type: 'matchEnd', reason: this.endReason });
        }
        break;
      case 'ended':
        break;
    }

    this.updateRespawns(world, dt);
  }

  private updateRespawns(world: World, dt: number): void {
    if (this.phase === 'ending' || this.phase === 'ended') return;
    for (const id of this.playerIds) {
      const p = world.getAircraft(id);
      if (!p || p.alive || p.respawnTimer < 0) continue;
      p.respawnTimer -= dt;
      if (p.respawnTimer <= 0) {
        const sp = chooseSpawn(world, p);
        spawnAircraft(world, p, sp.x, sp.y, sp.facing);
      }
    }
  }

  onDestroyed(world: World, victim: Aircraft, _killerId: number): void {
    if (this.enemies.delete(victim.id)) {
      this.corpseTimers.set(victim.id, CORPSE_LINGER);
      return;
    }
    if (!this.playerIds.includes(victim.id)) return;
    if (victim.lives > 0) victim.lives--;
    if (victim.lives === 0) {
      victim.respawnTimer = -1;
      const anyAlive = this.playerIds.some((id) => {
        const p = world.getAircraft(id);
        return p && (p.alive || p.lives !== 0);
      });
      if (!anyAlive) {
        this.phase = 'ending';
        this.phaseTimer = this.config.endDelay;
        this.endReason = 'eliminated';
      }
    } else {
      victim.respawnTimer = COMBAT.respawnDelay;
    }
  }

  /** Start the next level (`wave` is the current level number, 1-based). */
  private startWave(world: World): void {
    this.wave++;
    this.phase = 'playing';
    this.phaseTimer = 0;
    const diff = levelDifficulty(this.wave);
    const count = diff.enemies;
    const anchor = this.playerAnchor(world);
    for (let i = 0; i < count; i++) {
      const pers = PERSONALITIES[diff.roster[i % diff.roster.length]];
      const e = world.addAircraft('scythe', TEAM_ORANGE, `${pers.label} ${++this.enemySerial}`, false, 1, diff.overrides);
      world.brains.set(e.id, new AiBrain(pers, diff.skill));
      const side = i % 2 === 0 ? 1 : -1;
      let x = anchor.x + side * world.rng.range(ENEMY_SPAWN_MIN_DIST, ENEMY_SPAWN_MAX_DIST);
      if (x < 700 || x > world.map.width - 700) x = anchor.x - side * world.rng.range(ENEMY_SPAWN_MIN_DIST, ENEMY_SPAWN_MAX_DIST);
      x = clamp(x, 700, world.map.width - 700);
      const ceilingY = world.terrain.groundY(x) - 500;
      const y = clamp(world.rng.range(450, 1400), 400, ceilingY);
      spawnAircraft(world, e, x, y, x > anchor.x ? -1 : 1);
      e.spawnProtection = 0.8;
      this.enemies.add(e.id);
    }
    world.emit({ type: 'waveStart', wave: this.wave, enemies: count });
  }

  private playerAnchor(world: World): { x: number; y: number } {
    for (const id of this.playerIds) {
      const p = world.getAircraft(id);
      if (p && p.alive) return p;
    }
    return { x: world.map.width / 2, y: 1000 };
  }
}
