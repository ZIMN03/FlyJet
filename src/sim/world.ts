import { getAircraftDef, type AircraftDef } from './config/aircraft';
import { ABILITIES } from './config/abilities';
import { getMapDef, type MapDef } from './config/maps';
import { GUNS, MISSILES } from './config/weapons';
import { MAX_BULLETS, MAX_FLARES, MAX_MISSILES } from './constants';
import { Rng } from './rng';
import { Terrain } from './terrain';
import {
  LockState, emptyStats,
  type Aircraft, type Bullet, type Flare, type Missile, type SimEvent,
} from './types';
import type { GameMode } from './modes/mode';
import type { AiBrain } from './ai/brain';

export interface WorldOptions {
  mapId: string;
  seed: number;
  friendlyFire?: boolean;
}

/**
 * Complete authoritative game state. Holds no references to rendering, audio,
 * DOM or networking — the same World runs in the browser or on a server.
 */
export class World {
  readonly map: MapDef;
  readonly terrain: Terrain;
  readonly rng: Rng;
  readonly friendlyFire: boolean;

  tick = 0;
  time = 0;
  aircraft: Aircraft[] = [];
  readonly bullets: Bullet[] = [];
  readonly missiles: Missile[] = [];
  readonly flares: Flare[] = [];
  /** Events produced during the most recent step(); cleared at the start of each step. */
  events: SimEvent[] = [];
  mode: GameMode | null = null;
  /** AI pilots, keyed by aircraft id. The sim runs these itself (server-side in online play). */
  readonly brains = new Map<number, AiBrain>();

  private nextId = 1;
  private nextMissileId = 1;

  constructor(opts: WorldOptions) {
    this.map = getMapDef(opts.mapId);
    this.terrain = new Terrain(this.map);
    this.rng = new Rng(opts.seed);
    this.friendlyFire = opts.friendlyFire ?? false;
    for (let i = 0; i < MAX_BULLETS; i++) {
      this.bullets.push({ active: false, x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, life: 0, damage: 0, ownerId: 0, team: 0 });
    }
    for (let i = 0; i < MAX_MISSILES; i++) {
      this.missiles.push({
        active: false, id: 0, def: MISSILES.lanceMissile, x: 0, y: 0, px: 0, py: 0, heading: 0, speed: 0,
        life: 0, age: 0, ownerId: 0, team: 0, targetId: 0, flareTarget: -1, chaseLeft: -1,
      });
    }
    for (let i = 0; i < MAX_FLARES; i++) {
      this.flares.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, team: 0, ownerId: 0 });
    }
  }

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  getAircraft(id: number): Aircraft | undefined {
    // Aircraft counts are small (<= 16), linear scan beats a Map here.
    for (let i = 0; i < this.aircraft.length; i++) if (this.aircraft[i].id === id) return this.aircraft[i];
    return undefined;
  }

  /**
   * Create an aircraft (not yet spawned into the world).
   * @param overrides per-instance stat tweaks (e.g. weaker early-level enemies)
   *   layered on top of the shared aircraft definition.
   */
  addAircraft(
    defId: string, team: number, name: string, isHuman: boolean, lives = -1, overrides?: Partial<AircraftDef>,
  ): Aircraft {
    const base = getAircraftDef(defId);
    const def: AircraftDef = overrides ? { ...base, ...overrides } : base;
    const a: Aircraft = {
      id: this.nextId++,
      name,
      team,
      def,
      gun: GUNS[def.gun],
      missileDef: MISSILES[def.missile],
      ability: ABILITIES[def.ability],
      isHuman,
      alive: false,
      respawnTimer: -1,
      lives,
      x: 0, y: 0, vx: 0, vy: 0, heading: 0, speed: 0, px: 0, py: 0, pheading: 0,
      health: def.health,
      boostEnergy: def.afterburnerCapacity,
      boosting: false,
      boostRegenDelay: 0,
      braking: false,
      throttle: 0,
      stalled: false,
      gunCooldown: 0,
      barrel: 0,
      missileAmmo: def.missileCapacity,
      missileCooldown: 0,
      missileRearmTimer: 0,
      flareCharges: def.flareCharges,
      flareRechargeTimer: 0,
      flareCooldown: 0,
      abilityCooldown: 0,
      abilityTimer: 0,
      lockTargetId: 0,
      lockProgress: 0,
      lockState: LockState.None,
      lockImmunity: 0,
      beingLocked: false,
      lockedOn: false,
      incomingMissileDist: Infinity,
      incomingMissileAngle: 0,
      spawnProtection: 0,
      crashImmunity: 0,
      outOfBoundsTime: 0,
      outOfBounds: false,
      timeSinceDamaged: 999,
      lastAttackerId: 0,
      lastAttackerTime: -999,
      damageLog: new Map(),
      prevButtons: 0,
      stats: emptyStats(),
      godMode: false,
    };
    this.aircraft.push(a);
    return a;
  }

  removeAircraft(id: number): void {
    const i = this.aircraft.findIndex((a) => a.id === id);
    if (i >= 0) this.aircraft.splice(i, 1);
    this.brains.delete(id);
  }

  allocMissileId(): number {
    return this.nextMissileId++;
  }

  allocBullet(): Bullet | null {
    for (let i = 0; i < this.bullets.length; i++) if (!this.bullets[i].active) return this.bullets[i];
    return null;
  }

  allocMissile(): Missile | null {
    for (let i = 0; i < this.missiles.length; i++) if (!this.missiles[i].active) return this.missiles[i];
    return null;
  }

  allocFlare(): number {
    for (let i = 0; i < this.flares.length; i++) if (!this.flares[i].active) return i;
    return -1;
  }

  areEnemies(a: { team: number }, b: { team: number }): boolean {
    return this.friendlyFire || a.team !== b.team;
  }
}
