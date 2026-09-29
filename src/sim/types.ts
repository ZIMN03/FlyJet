import type { AircraftDef } from './config/aircraft';
import type { AbilityDef } from './config/abilities';
import type { GunDef, MissileDef } from './config/weapons';

/**
 * Buttons carried by an InputCommand. A bitmask keeps commands tiny on the wire.
 */
export const enum Button {
  Fire = 1 << 0,
  Missile = 1 << 1,
  Flare = 1 << 2,
  Boost = 1 << 3,
  Brake = 1 << 4,
  Ability = 1 << 5,
  /** Held: open the throttle. The throttle setting persists after release. */
  ThrottleUp = 1 << 6,
  /** Held: close the throttle. */
  ThrottleDown = 1 << 7,
}

/**
 * The ONLY thing a controller (local player, AI, or remote client) may hand the
 * simulation. The sim derives everything else. In online play the server
 * receives these, validates/clamps them, and runs the same step().
 */
export interface InputCommand {
  /** Desired flight direction; magnitude <= 1. (0,0) = hold current heading. */
  steerX: number;
  steerY: number;
  /**
   * Relative rotation: -1 = rotate the nose anticlockwise, +1 = clockwise, at
   * the aircraft's turn rate. When non-zero it overrides steerX/steerY. This is
   * what the two-button (left/right) control scheme sends.
   */
  turn: number;
  buttons: number;
  /** Client sequence number for reconciliation (unused offline). */
  seq: number;
}

export function emptyCommand(): InputCommand {
  return { steerX: 0, steerY: 0, turn: 0, buttons: 0, seq: 0 };
}

export const enum LockState {
  None = 0,
  Detected = 1,
  Locking = 2,
  Locked = 3,
}

export interface PilotStats {
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  score: number;
  streak: number;
  bestStreak: number;
  shotsFired: number;
  shotsHit: number;
  missilesFired: number;
  missileHits: number;
}

export function emptyStats(): PilotStats {
  return {
    kills: 0, deaths: 0, assists: 0, damageDealt: 0, damageTaken: 0, score: 0,
    streak: 0, bestStreak: 0, shotsFired: 0, shotsHit: 0, missilesFired: 0, missileHits: 0,
  };
}

export interface DamageRecord {
  damage: number;
  time: number;
}

export interface Aircraft {
  readonly id: number;
  name: string;
  team: number;
  def: AircraftDef;
  gun: GunDef;
  missileDef: MissileDef;
  ability: AbilityDef;
  /** Whether a human (local or remote) flies this aircraft. Affects nothing in the sim except scoring/UI. */
  isHuman: boolean;

  alive: boolean;
  /** Seconds until respawn; <0 when not waiting. */
  respawnTimer: number;
  /** Remaining lives (-1 = infinite). */
  lives: number;

  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Nose direction, radians. 0 = right, +PI/2 = down (y-down world). */
  heading: number;
  /** Engine speed along heading; velocity chases heading*speed via grip. */
  speed: number;
  /** Current angular velocity (rad/s). Eases toward the requested turn; drives visual banking. */
  turnVel: number;
  /** Previous-tick transform for render interpolation. */
  px: number;
  py: number;
  pheading: number;

  health: number;
  boostEnergy: number;
  boosting: boolean;
  boostRegenDelay: number;
  braking: boolean;
  /** Throttle setting 0..1 (persistent). Sets the engine's target speed. */
  throttle: number;
  /** Below stall speed: the nose drops and the airframe can be flipped quickly. */
  stalled: boolean;

  gunCooldown: number;
  barrel: number;
  /** Cannon heat 0..1. Reaching 1 overheats the guns until they cool down. */
  gunHeat: number;
  overheated: boolean;
  /** Seconds of immunity to further mid-air collision damage. */
  collisionImmunity: number;
  missileAmmo: number;
  missileCooldown: number;
  missileRearmTimer: number;
  flareCharges: number;
  flareRechargeTimer: number;
  flareCooldown: number;

  abilityCooldown: number;
  abilityTimer: number;

  lockTargetId: number;
  lockProgress: number;
  lockState: LockState;
  /** After deploying flares, others can't lock this aircraft for a moment. */
  lockImmunity: number;

  // Threat awareness (computed each tick; drives HUD warnings and AI).
  beingLocked: boolean;
  lockedOn: boolean;
  /** Distance to the nearest missile tracking this aircraft (Infinity if none). */
  incomingMissileDist: number;
  incomingMissileAngle: number;

  spawnProtection: number;
  crashImmunity: number;
  /** Seconds spent beyond the hard map edge. */
  outOfBoundsTime: number;
  outOfBounds: boolean;
  /** Time since this aircraft last took damage (for AI + regen hooks). */
  timeSinceDamaged: number;
  lastAttackerId: number;
  lastAttackerTime: number;
  damageLog: Map<number, DamageRecord>;

  prevButtons: number;
  stats: PilotStats;
  godMode: boolean;
}

export interface Bullet {
  active: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
  ownerId: number;
  team: number;
}

export interface Missile {
  active: boolean;
  id: number;
  def: MissileDef;
  x: number;
  y: number;
  px: number;
  py: number;
  heading: number;
  speed: number;
  life: number;
  age: number;
  ownerId: number;
  team: number;
  /** Aircraft id being tracked, or 0 for none. */
  targetId: number;
  /** Flare index being tracked, or -1. Flares take priority over targetId. */
  flareTarget: number;
  /** Seconds of chase left once a target is acquired; < 0 while still searching. */
  chaseLeft: number;
  /** Aircraft this missile was chasing (kept after decoys) — credited if the missile is evaded. */
  victimId: number;
}

export interface Flare {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  team: number;
  ownerId: number;
}

/** Events the sim emits each tick. Clients turn these into FX/audio/HUD feedback. */
export type SimEvent =
  | { type: 'gunFire'; id: number; x: number; y: number; angle: number }
  | { type: 'bulletHit'; x: number; y: number; targetId: number; attackerId: number; damage: number; crit: boolean }
  | { type: 'bulletImpact'; x: number; y: number; water: boolean }
  | { type: 'missileLaunch'; id: number; missileId: number; targetId: number; x: number; y: number }
  | { type: 'missileExplode'; missileId: number; x: number; y: number; radius: number; water: boolean }
  | { type: 'missileDecoyed'; missileId: number; victimId: number }
  | { type: 'flareDeploy'; id: number; x: number; y: number }
  | { type: 'lockAcquired'; id: number; targetId: number }
  | { type: 'damaged'; id: number; attackerId: number; amount: number; source: DamageSource }
  | { type: 'destroyed'; id: number; killerId: number; x: number; y: number; vx: number; vy: number; source: DamageSource }
  | { type: 'kill'; killerId: number; victimId: number; score: number; streak: number; source: DamageSource }
  | { type: 'assist'; id: number; victimId: number; score: number }
  | { type: 'crash'; id: number; x: number; y: number; water: boolean }
  | { type: 'spawn'; id: number; x: number; y: number }
  | { type: 'ability'; id: number; ability: string }
  | { type: 'waveStart'; wave: number; enemies: number }
  | { type: 'waveClear'; wave: number; bonus: number }
  | { type: 'matchEnd'; reason: string }
  | { type: 'missileEvaded'; id: number; missileId: number; decoyed: boolean }
  | { type: 'collision'; a: number; b: number; x: number; y: number }
  | { type: 'overheat'; id: number }
  | { type: 'bossPhase'; id: number; phase: number }
  | { type: 'bossIncoming'; name: string; seconds: number }
  | { type: 'contact'; count: number; bearing: number }
  | { type: 'stageStart'; level: number; stage: number; stages: number; label: string }
  | { type: 'levelComplete'; level: number; bonus: number; time: number };

export type DamageSource = 'gun' | 'missile' | 'crash' | 'collision' | 'boundary' | 'pulse' | 'debug';
