import { AiBrain } from '../ai/brain';
import { BOSS_PROFILES, BossBrain } from '../ai/boss';
import { PERSONALITIES } from '../ai/personalities';
import { AIRCRAFT, type AircraftDef } from '../config/aircraft';
import { weaponGunDamageMult, weaponMark, weaponMissileDamageMult } from '../config/weaponPower';
import { COMBAT, SCORE, TEAM_ORANGE } from '../constants';
import { clamp } from '../math';
import { defuseMissile } from '../systems/projectiles';
import { chooseSpawn, spawnAircraft } from '../systems/spawn';
import type { Aircraft } from '../types';
import type { World } from '../world';
import type { GameMode, MatchPhase } from './mode';

export interface WaveConfig {
  countdown: number;
  /** Pause between stages of a level. */
  intermission: number;
  /** Warning time before a boss arrives. */
  bossWarning: number;
  /** "Level complete" presentation time before the next level starts. */
  levelComplete: number;
  /** Delay after the last life is lost before the match ends (lets the explosion play). */
  endDelay: number;
  /** Health restored (fraction of max) when a stage is cleared. */
  waveRepair: number;
}

export const DEFAULT_WAVE_CONFIG: WaveConfig = {
  countdown: 3.5,
  intermission: 3,
  bossWarning: 3.2,
  levelComplete: 4.5,
  endDelay: 2.8,
  waveRepair: 0.3,
};

// ----------------------------------------------------------------- difficulty

/** Level at which enemies reach full strength. */
const FULL_STRENGTH_LEVEL = 10;
/** Hard cap on enemies per wave (performance / screen clarity). */
const MAX_WAVE_ENEMIES = 12;

/** Which enemy archetypes appear, by level (index = level - 1; last entry repeats). */
const LEVEL_ARCHETYPES: string[][] = [
  ['dart'],
  ['dart', 'dart', 'scythe'],
  ['dart', 'scythe', 'brute'],
  ['dart', 'scythe', 'brute', 'lancer'],
  ['scythe', 'dart', 'lancer', 'brute'],
  ['scythe', 'brute', 'lancer', 'dart', 'scythe'],
];

/** Default pilot for each archetype once past the trainee levels. */
const ARCHETYPE_PERSONALITY: Record<string, string> = {
  dart: 'aggressive',
  scythe: 'interceptor',
  brute: 'heavy',
  lancer: 'missileBoat',
};

export interface LevelDifficulty {
  /** Opponents in the level's first wave (level N => N). */
  enemies: number;
  /** Archetype mix for this level. */
  archetypes: string[];
  /** 0..1 AI competence (aim, reaction time). */
  skill: number;
  /** Strength multipliers applied to each archetype's base stats. */
  healthMult: number;
  turnMult: number;
  speedMult: number;
  /** Early levels: no enemy missiles or flares. */
  missiles: boolean;
  flares: boolean;
}

/**
 * Difficulty curve. Early opponents are fragile, slower, turn wider, can't
 * fire missiles and aim badly; everything ramps up until FULL_STRENGTH_LEVEL.
 */
export function levelDifficulty(level: number): LevelDifficulty {
  const t = clamp((level - 1) / (FULL_STRENGTH_LEVEL - 1), 0, 1);
  return {
    enemies: clamp(level, 1, MAX_WAVE_ENEMIES),
    archetypes: LEVEL_ARCHETYPES[Math.min(level - 1, LEVEL_ARCHETYPES.length - 1)],
    skill: clamp(0.1 + (level - 1) * 0.09, 0.1, 1),
    healthMult: 0.4 + 0.6 * t,
    turnMult: 0.7 + 0.3 * t,
    speedMult: 0.85 + 0.15 * t,
    missiles: level >= 3,
    flares: level >= 3,
  };
}

/** Stat overrides for one enemy of `archetype` at the given difficulty. */
export function enemyOverrides(archetype: string, d: LevelDifficulty): Partial<AircraftDef> {
  const base = AIRCRAFT[archetype];
  return {
    health: Math.round(base.health * d.healthMult),
    turnRate: base.turnRate * d.turnMult,
    cruiseSpeed: base.cruiseSpeed * d.speedMult,
    maxSpeed: base.maxSpeed * d.speedMult,
    boostSpeed: base.boostSpeed * d.speedMult,
    missileCapacity: d.missiles ? base.missileCapacity : 0,
    flareCharges: d.flares ? base.flareCharges : 0,
  };
}

/** Pilot personality for an enemy: trainees early, archetype specialists later. */
export function enemyPersonality(archetype: string, level: number): string {
  if (level <= 2) return 'trainee';
  if (level <= 4 && archetype !== 'lancer') return 'rookie';
  return ARCHETYPE_PERSONALITY[archetype] ?? 'aggressive';
}

// --------------------------------------------------------------------- stages

export type Stage =
  | { kind: 'wave'; count: number; label: string }
  | { kind: 'boss'; boss: 'warden' | 'stormbreaker'; escorts: number; label: string };

/**
 * A level is a short sequence: two fighter waves, then a boss. The first wave
 * of level N has N opponents; every third level ends with Stormbreaker,
 * otherwise the Warden mini-boss.
 */
export function levelStages(level: number): Stage[] {
  const n = clamp(level, 1, MAX_WAVE_ENEMIES);
  const bigBoss = level % 3 === 0;
  return [
    { kind: 'wave', count: n, label: 'Radar contact' },
    { kind: 'wave', count: Math.min(n + 1, MAX_WAVE_ENEMIES), label: 'Second wave' },
    {
      kind: 'boss',
      boss: bigBoss ? 'stormbreaker' : 'warden',
      escorts: Math.floor((level - 1) / 2),
      label: bigBoss ? 'Stormbreaker' : 'Warden',
    },
  ];
}

/** Boss strength scales gently with level so the first Warden is beatable by a new pilot. */
export function bossOverrides(boss: string, level: number): Partial<AircraftDef> {
  const base = AIRCRAFT[boss];
  // Level 1 Warden: about half hull; grows ~10% per level after that.
  const k = clamp(0.4 + level * 0.1, 0.5, 1.6);
  return {
    health: Math.round(base.health * k),
    turnRate: base.turnRate * clamp(0.8 + level * 0.04, 0.8, 1.15),
    gunDamageMult: clamp(0.4 + level * 0.1, 0.5, 1.1),
  };
}

/** 0..1 boss aggression (salvo size/frequency) by level. */
export function bossAggression(level: number): number {
  return clamp((level - 1) / 6, 0, 1);
}

const SPAWN_MIN_DIST = 2400;
const SPAWN_MAX_DIST = 3100;
/** Seconds a destroyed enemy lingers in the world list (lets clients read its last state). */
const CORPSE_LINGER = 1.5;

/**
 * "Endless Skies": levels of staged combat (contact -> second wave -> boss ->
 * level complete), escalating forever. Limited lives with respawns.
 */
export class WaveMode implements GameMode {
  readonly id = 'waves';
  phase: MatchPhase = 'countdown';
  phaseTimer: number;
  /** Current level (1-based). Kept as `wave` for compatibility with saves/UI. */
  wave = 0;
  /** Stage index within the level (0-based) and the level's stage list. */
  stage = 0;
  stages: Stage[] = [];
  survivalTime = 0;
  levelTime = 0;
  endReason = '';
  /** Id of the boss currently in the air (0 if none). */
  bossId = 0;
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

  /** Ids of all hostiles in the current stage (for HUD/radar). */
  get enemyIds(): ReadonlySet<number> {
    return this.enemies;
  }

  update(world: World, dt: number): void {
    for (const [id, t] of this.corpseTimers) {
      const left = t - dt;
      if (left <= 0) {
        this.corpseTimers.delete(id);
        world.removeAircraft(id);
      } else this.corpseTimers.set(id, left);
    }
    if (this.phase !== 'countdown' && this.phase !== 'ending' && this.phase !== 'ended') {
      this.survivalTime += dt;
      this.levelTime += dt;
    }

    switch (this.phase) {
      case 'countdown':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.startLevel(world, 1);
        break;
      case 'playing':
        if (this.enemies.size === 0) this.stageCleared(world);
        break;
      case 'intermission':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.startStage(world);
        break;
      case 'bossWarning':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.spawnBoss(world);
        break;
      case 'levelComplete':
        this.phaseTimer -= dt;
        if (this.phaseTimer <= 0) this.startLevel(world, this.wave + 1);
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

  killBonus(_world: World, victim: Aircraft, killer: Aircraft): number {
    return victim.id === this.bossId && this.playerIds.includes(killer.id) ? SCORE.bossKill * this.wave : 0;
  }

  onDestroyed(world: World, victim: Aircraft, _killerId: number): void {
    if (this.enemies.delete(victim.id)) {
      this.corpseTimers.set(victim.id, CORPSE_LINGER);
      if (victim.id === this.bossId) this.bossId = 0;
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

  // ------------------------------------------------------------- level flow

  private startLevel(world: World, level: number): void {
    this.wave = level;
    this.stages = levelStages(level);
    this.stage = 0;
    this.levelTime = 0;
    for (const id of this.playerIds) {
      const p = world.getAircraft(id);
      if (p && p.alive && level > 1) {
        // A fresh level: fully repaired and rearmed.
        p.health = p.def.health;
        p.missileAmmo = p.def.missileCapacity;
        p.flareCharges = p.def.flareCharges;
      }
      if (p && level > p.weaponLevel) {
        // Weapons grow with the level reached: harder-hitting, faster cannons and missiles.
        const oldMark = weaponMark(p.weaponLevel);
        p.weaponLevel = level;
        const mark = weaponMark(level);
        world.emit({
          type: 'weaponsUpgraded', id: p.id, level, mark, newMark: mark > oldMark,
          gunPct: Math.round((weaponGunDamageMult(level) - 1) * 100),
          missilePct: Math.round((weaponMissileDamageMult(level) - 1) * 100),
        });
      }
    }
    this.startStage(world);
  }

  private startStage(world: World): void {
    const st = this.stages[this.stage];
    world.emit({ type: 'stageStart', level: this.wave, stage: this.stage + 1, stages: this.stages.length, label: st.label });
    if (st.kind === 'boss') {
      this.phase = 'bossWarning';
      this.phaseTimer = this.config.bossWarning;
      world.emit({ type: 'bossIncoming', name: AIRCRAFT[st.boss].name, seconds: this.config.bossWarning });
      return;
    }
    this.phase = 'playing';
    const diff = levelDifficulty(this.wave);
    const anchor = this.playerAnchor(world);
    const side = world.rng.next() < 0.5 ? -1 : 1;
    for (let i = 0; i < st.count; i++) {
      const archetype = diff.archetypes[(i + this.stage) % diff.archetypes.length];
      this.spawnEnemy(world, archetype, anchor, side, i, diff);
    }
    // Legacy event kept so existing listeners (music, stats) still fire.
    world.emit({ type: 'waveStart', wave: this.wave, enemies: st.count });
    world.emit({ type: 'contact', count: st.count, bearing: side > 0 ? 0 : Math.PI });
  }

  private spawnEnemy(
    world: World, archetype: string, anchor: { x: number; y: number }, side: number, i: number, diff: LevelDifficulty,
  ): Aircraft {
    const pers = PERSONALITIES[enemyPersonality(archetype, this.wave)];
    const e = world.addAircraft(archetype, TEAM_ORANGE, `${AIRCRAFT[archetype].role ?? pers.label} ${++this.enemySerial}`,
      false, 1, enemyOverrides(archetype, diff));
    world.brains.set(e.id, new AiBrain(pers, diff.skill));
    // Groups come in from one side, loosely stacked, so the fight has a direction.
    const s = i % 3 === 2 ? -side : side;
    let x = anchor.x + s * world.rng.range(SPAWN_MIN_DIST, SPAWN_MAX_DIST);
    if (x < 700 || x > world.map.width - 700) x = anchor.x - s * world.rng.range(SPAWN_MIN_DIST, SPAWN_MAX_DIST);
    x = clamp(x, 700, world.map.width - 700);
    const y = clamp(world.rng.range(450, 1400) + i * 60, 400, world.terrain.groundY(x) - 500);
    spawnAircraft(world, e, x, y, x > anchor.x ? -1 : 1);
    e.spawnProtection = 0.8;
    this.enemies.add(e.id);
    return e;
  }

  private spawnBoss(world: World): void {
    const st = this.stages[this.stage];
    if (st.kind !== 'boss') return;
    this.phase = 'playing';
    const anchor = this.playerAnchor(world);
    const x = anchor.x < world.map.width / 2 ? world.map.width - 900 : 900;
    const boss = world.addAircraft(st.boss, TEAM_ORANGE, AIRCRAFT[st.boss].name, false, 1, bossOverrides(st.boss, this.wave));
    const escorts = new Set<number>();
    const diff = levelDifficulty(this.wave);
    const brain = new BossBrain(BOSS_PROFILES[st.boss], {
      spawnEscorts: (b, count) => {
        for (let k = 0; k < count; k++) {
          const e = this.spawnEnemy(world, 'dart', { x: b.x, y: b.y }, 1, k, diff);
          // Drones launch right from the boss, not from the map edge.
          e.x = e.px = clamp(b.x + (k ? 120 : -120), 400, world.map.width - 400);
          e.y = e.py = clamp(b.y + 80, 400, world.terrain.groundY(e.x) - 300);
          escorts.add(e.id);
        }
        return count;
      },
      escortsAlive: () => [...escorts].filter((id) => this.enemies.has(id)).length,
    }, bossAggression(this.wave));
    world.brains.set(boss.id, brain);
    spawnAircraft(world, boss, x, 700, x > anchor.x ? -1 : 1);
    boss.spawnProtection = 1.5;
    this.enemies.add(boss.id);
    this.bossId = boss.id;
    for (let i = 0; i < st.escorts; i++) this.spawnEnemy(world, diff.archetypes[i % diff.archetypes.length], anchor, x > anchor.x ? 1 : -1, i, diff);
  }

  private stageCleared(world: World): void {
    const last = this.stage >= this.stages.length - 1;
    const bonus = SCORE.waveClear * this.wave;
    // The stage is won: hostile missiles still in the air self-destruct.
    for (const m of world.missiles) if (m.active && m.team === TEAM_ORANGE) defuseMissile(world, m);
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
    if (last) {
      const levelBonus = SCORE.levelComplete * this.wave;
      for (const id of this.playerIds) {
        const p = world.getAircraft(id);
        if (p) p.stats.score += levelBonus;
      }
      world.emit({ type: 'levelComplete', level: this.wave, bonus: levelBonus, time: this.levelTime });
      this.phase = 'levelComplete';
      this.phaseTimer = this.config.levelComplete;
    } else {
      this.stage++;
      this.phase = 'intermission';
      this.phaseTimer = this.config.intermission;
    }
  }

  private playerAnchor(world: World): { x: number; y: number } {
    for (const id of this.playerIds) {
      const p = world.getAircraft(id);
      if (p && p.alive) return p;
    }
    return { x: world.map.width / 2, y: 1000 };
  }
}
