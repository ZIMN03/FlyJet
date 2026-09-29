/**
 * Aircraft definitions. All flight/combat tuning for an airframe lives here —
 * gameplay systems read from these objects and never hard-code per-aircraft values.
 */

export type AircraftArtId = 'viper' | 'scythe';

export interface AircraftDef {
  id: string;
  name: string;
  className: string;
  description: string;
  art: AircraftArtId;
  /** Collision radius (circle). */
  radius: number;

  // --- Flight ---
  cruiseSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  boostSpeed: number;
  acceleration: number;
  deceleration: number;
  /** Heading turn rate at cruise, rad/s. */
  turnRate: number;
  /** Multiplier on turn rate while braking (tight turns cost speed). */
  brakeTurnBonus: number;
  /** Multiplier on turn rate while boosting (fast = wider turns). */
  boostTurnPenalty: number;
  /** How quickly velocity aligns with heading (higher = less drift). */
  grip: number;

  // --- Survivability ---
  health: number;
  /** Fraction of incoming damage ignored (0..1). */
  armor: number;

  // --- Afterburner ---
  afterburnerCapacity: number;
  afterburnerDrain: number;
  afterburnerRegen: number;
  /** Seconds after boosting before regen starts. */
  afterburnerRegenDelay: number;
  /** Minimum energy needed to (re)start boosting — prevents stutter-boosting at empty. */
  afterburnerMinStart: number;

  // --- Weapons ---
  gun: string;
  missile: string;
  missileCapacity: number;
  /** Seconds between automatic re-arm of one missile (0 = never). */
  missileRearmTime: number;
  missileCooldown: number;
  lockRange: number;
  /** Half-angle of the lock cone, radians. */
  lockCone: number;
  lockTime: number;
  /** Multiplier on how fast others lock onto this aircraft (stealth < 1). */
  lockSignature: number;

  // --- Defense ---
  flareCharges: number;
  flareRechargeTime: number;

  ability: string;
}

export const AIRCRAFT: Record<string, AircraftDef> = {
  viper: {
    id: 'viper',
    name: 'VX-7 Viper',
    className: 'Balanced Fighter',
    description: 'Dependable all-rounder with twin pulse cannons and an overcharge core.',
    art: 'viper',
    radius: 20,
    cruiseSpeed: 430,
    maxSpeed: 560,
    minSpeed: 230,
    boostSpeed: 800,
    acceleration: 420,
    deceleration: 520,
    turnRate: 3.3,
    brakeTurnBonus: 1.35,
    boostTurnPenalty: 0.78,
    grip: 5.5,
    health: 100,
    armor: 0,
    afterburnerCapacity: 100,
    afterburnerDrain: 32,
    afterburnerRegen: 22,
    afterburnerRegenDelay: 0.8,
    afterburnerMinStart: 12,
    gun: 'pulseCannon',
    missile: 'lanceMissile',
    missileCapacity: 6,
    missileRearmTime: 14,
    missileCooldown: 0.6,
    lockRange: 1500,
    lockCone: 0.42,
    lockTime: 0.85,
    lockSignature: 1,
    flareCharges: 3,
    flareRechargeTime: 9,
    ability: 'overcharge',
  },
  scythe: {
    id: 'scythe',
    name: 'KR-3 Scythe',
    className: 'Interceptor',
    description: 'Forward-swept hostile interceptor. Nimble, lightly armoured.',
    art: 'scythe',
    radius: 19,
    cruiseSpeed: 400,
    maxSpeed: 520,
    minSpeed: 220,
    boostSpeed: 720,
    acceleration: 380,
    deceleration: 480,
    turnRate: 3.0,
    brakeTurnBonus: 1.3,
    boostTurnPenalty: 0.8,
    grip: 5,
    health: 70,
    armor: 0,
    afterburnerCapacity: 100,
    afterburnerDrain: 34,
    afterburnerRegen: 18,
    afterburnerRegenDelay: 1,
    afterburnerMinStart: 15,
    gun: 'scatterGun',
    missile: 'hornetRocket',
    missileCapacity: 2,
    missileRearmTime: 20,
    missileCooldown: 1.5,
    lockRange: 1300,
    lockCone: 0.38,
    lockTime: 1.25,
    lockSignature: 1,
    flareCharges: 2,
    flareRechargeTime: 12,
    ability: 'speedBurst',
  },
};

export function getAircraftDef(id: string): AircraftDef {
  const def = AIRCRAFT[id];
  if (!def) throw new Error(`Unknown aircraft def: ${id}`);
  return def;
}
