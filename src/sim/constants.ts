/**
 * Global simulation constants. Gameplay tuning for aircraft/weapons lives in
 * ./config — this file only holds engine-level values shared by every mode.
 */

/** Authoritative simulation rate. Client and (future) server both step at this rate. */
export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

/** Pool capacities. Hard caps keep memory and per-tick cost bounded. */
export const MAX_BULLETS = 768;
export const MAX_MISSILES = 64;
export const MAX_FLARES = 48;

/** Teams. Team 0 is reserved for "no team" (environment damage). */
export const TEAM_NONE = 0;
export const TEAM_BLUE = 1;
export const TEAM_ORANGE = 2;

/**
 * Collision categories (bitmask). Each collider declares what it is and what it
 * checks against, so e.g. bullets never test against other bullets.
 */
export const enum CollisionLayer {
  Player = 1 << 0,
  PlayerProjectile = 1 << 1,
  Enemy = 1 << 2,
  EnemyProjectile = 1 << 3,
  Environment = 1 << 4,
  Destructible = 1 << 5,
  Pickup = 1 << 6,
  Objective = 1 << 7,
}

/** World-level physics feel. */
export const PHYSICS = {
  /** Speed gained per second when diving straight down (lost when climbing). */
  gravitySpeedEffect: 160,
  /** Upward push applied when above the ceiling, per unit of depth. */
  boundaryPushStrength: 3.2,
  /** Distance over which the soft boundary ramps up. */
  boundaryMargin: 350,
  /** Seconds outside the hard edge before boundary damage starts. */
  boundaryGraceTime: 3,
  boundaryDamagePerSecond: 12,
} as const;

export const CRASH = {
  /** Fraction of max health lost when hitting terrain/sea. */
  damageFraction: 0.34,
  /** Seconds of crash immunity after a crash so one impact isn't counted twice. */
  immunityTime: 0.6,
  bounceSpeed: 260,
} as const;

export const COMBAT = {
  /** Kills are credited to the last attacker if they hit within this window (s). */
  killCreditWindow: 6,
  /** Assist requires this share of victim max health dealt within the window. */
  assistDamageShare: 0.2,
  assistWindow: 10,
  critChance: 0.08,
  critMultiplier: 1.6,
  spawnProtection: 2.2,
  respawnDelay: 3.2,
} as const;

export const SCORE = {
  kill: 100,
  assist: 40,
  missileKillBonus: 15,
  waveClear: 150,
} as const;
