/**
 * Aircraft definitions. All flight/combat tuning for an airframe lives here —
 * gameplay systems read from these objects and never hard-code per-aircraft values.
 */

export type AircraftArtId =
  | 'viper' | 'scythe' | 'swift' | 'titan' | 'phantom' | 'nova'
  | 'dart' | 'brute' | 'lancer' | 'stormbreaker';

export interface AircraftDef {
  id: string;
  name: string;
  className: string;
  description: string;
  art: AircraftArtId;
  /** Endless Skies level the player must reach to fly this aircraft (0 = enemy-only). */
  unlockLevel: number;
  /** Role label shown on the HUD target panel (e.g. "Light fighter"). */
  role?: string;
  /** Visual size multiplier for large aircraft (bosses). Collision radius is set separately. */
  artScale?: number;
  /** Boss/mini-boss: gets a boss health bar, entrance and destruction sequence. */
  boss?: boolean;
  /** Cannon damage multiplier (hangar upgrades). */
  gunDamageMult?: number;
  /** Cannon heat-per-shot multiplier (hangar upgrades). */
  gunHeatMult?: number;
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

/** Shared baseline for enemy airframes. */
const ENEMY_BASE = {
  unlockLevel: 0,
  brakeTurnBonus: 1.3,
  boostTurnPenalty: 0.8,
  grip: 5,
  armor: 0,
  afterburnerCapacity: 100,
  afterburnerDrain: 34,
  afterburnerRegen: 18,
  afterburnerRegenDelay: 1,
  afterburnerMinStart: 15,
  missile: 'hornetRocket',
  missileRearmTime: 20,
  missileCooldown: 1.5,
  lockRange: 1300,
  lockCone: 0.38,
  lockTime: 1.25,
  lockSignature: 1,
  flareCharges: 2,
  flareRechargeTime: 12,
  ability: 'speedBurst',
};

/** Shared baseline for player airframes; each aircraft overrides what makes it distinct. */
const PLAYER_BASE = {
  brakeTurnBonus: 1.35,
  boostTurnPenalty: 0.78,
  grip: 5.5,
  armor: 0,
  afterburnerCapacity: 100,
  afterburnerDrain: 32,
  afterburnerRegen: 22,
  afterburnerRegenDelay: 0.8,
  afterburnerMinStart: 12,
  gun: 'pulseCannon',
  missile: 'lanceMissile',
  missileRearmTime: 14,
  missileCooldown: 0.6,
  lockRange: 1500,
  lockCone: 0.42,
  lockTime: 0.85,
  lockSignature: 1,
  flareCharges: 3,
  flareRechargeTime: 9,
};

export const AIRCRAFT: Record<string, AircraftDef> = {
  viper: {
    ...PLAYER_BASE,
    id: 'viper',
    name: 'VX-7 Viper',
    className: 'Balanced Fighter',
    description: 'Dependable all-rounder with twin pulse cannons and an overcharge core.',
    art: 'viper',
    unlockLevel: 1,
    radius: 24,
    cruiseSpeed: 430,
    maxSpeed: 560,
    minSpeed: 230,
    boostSpeed: 800,
    acceleration: 420,
    deceleration: 520,
    turnRate: 3.3,
    health: 100,
    missileCapacity: 6,
    ability: 'overcharge',
  },
  swift: {
    ...PLAYER_BASE,
    id: 'swift',
    name: 'SR-2 Swift',
    className: 'Speed Fighter',
    description: 'Tiny, blisteringly fast and very agile, but it cannot take many hits.',
    art: 'swift',
    unlockLevel: 3,
    radius: 21,
    cruiseSpeed: 480,
    maxSpeed: 620,
    minSpeed: 250,
    boostSpeed: 900,
    acceleration: 520,
    deceleration: 560,
    turnRate: 3.8,
    grip: 6,
    health: 75,
    afterburnerCapacity: 110,
    afterburnerDrain: 30,
    afterburnerRegen: 26,
    missileCapacity: 4,
    lockRange: 1400,
    lockTime: 0.8,
    ability: 'speedBurst',
  },
  titan: {
    ...PLAYER_BASE,
    id: 'titan',
    name: 'HG-9 Titan',
    className: 'Heavy Fighter',
    description: 'Armoured gunship with heavy cannons and a deep missile rack. Slow to turn.',
    art: 'titan',
    unlockLevel: 5,
    radius: 27,
    cruiseSpeed: 380,
    maxSpeed: 500,
    minSpeed: 210,
    boostSpeed: 700,
    acceleration: 340,
    deceleration: 460,
    turnRate: 2.7,
    grip: 5,
    health: 160,
    armor: 0.1,
    afterburnerDrain: 34,
    afterburnerRegen: 20,
    gun: 'heavyCannon',
    missileCapacity: 8,
    missileRearmTime: 12,
    lockRange: 1600,
    lockTime: 0.9,
    lockSignature: 1.1,
    ability: 'armor',
  },
  phantom: {
    ...PLAYER_BASE,
    id: 'phantom',
    name: 'NX-4 Phantom',
    className: 'Stealth Fighter',
    description: 'Hard to lock onto and very manoeuvrable. Can vanish from radar entirely.',
    art: 'phantom',
    unlockLevel: 7,
    radius: 23,
    cruiseSpeed: 440,
    maxSpeed: 570,
    minSpeed: 230,
    boostSpeed: 820,
    acceleration: 440,
    deceleration: 520,
    turnRate: 3.6,
    health: 85,
    missileCapacity: 6,
    lockTime: 0.8,
    lockSignature: 0.55,
    ability: 'stealth',
  },
  nova: {
    ...PLAYER_BASE,
    id: 'nova',
    name: 'XE-1 Nova',
    className: 'Experimental',
    description: 'Prototype energy fighter: a hard-hitting plasma lance and a shockwave pulse.',
    art: 'nova',
    unlockLevel: 10,
    radius: 23,
    cruiseSpeed: 450,
    maxSpeed: 580,
    minSpeed: 230,
    boostSpeed: 830,
    acceleration: 460,
    deceleration: 520,
    turnRate: 3.4,
    health: 95,
    gun: 'plasmaLance',
    missileCapacity: 5,
    ability: 'energyPulse',
  },
  // ------------------------------------------------------------ enemies ----
  scythe: {
    ...ENEMY_BASE,
    id: 'scythe',
    name: 'KR-3 Scythe',
    className: 'Interceptor',
    role: 'Interceptor',
    description: 'Forward-swept interceptor: extremely fast and aggressive, lightly armoured.',
    art: 'scythe',
    radius: 23,
    cruiseSpeed: 450,
    maxSpeed: 580,
    minSpeed: 220,
    boostSpeed: 860,
    acceleration: 450,
    deceleration: 480,
    turnRate: 3.1,
    health: 60,
    gun: 'scatterGun',
    missileCapacity: 2,
  },
  dart: {
    ...ENEMY_BASE,
    id: 'dart',
    name: 'LF-1 Dart',
    className: 'Light Fighter',
    role: 'Light fighter',
    description: 'Small delta light fighter. Nimble but fragile.',
    art: 'dart',
    radius: 20,
    cruiseSpeed: 430,
    maxSpeed: 550,
    minSpeed: 210,
    boostSpeed: 760,
    acceleration: 430,
    deceleration: 500,
    turnRate: 3.6,
    grip: 5.5,
    health: 45,
    gun: 'lightGun',
    missileCapacity: 1,
    missileRearmTime: 25,
    flareCharges: 1,
  },
  brute: {
    ...ENEMY_BASE,
    id: 'brute',
    name: 'HB-6 Brute',
    className: 'Heavy Fighter',
    role: 'Heavy fighter',
    description: 'Twin-boom heavy fighter: slow and armoured with a hard-hitting cannon.',
    art: 'brute',
    radius: 28,
    cruiseSpeed: 350,
    maxSpeed: 470,
    minSpeed: 190,
    boostSpeed: 640,
    acceleration: 320,
    deceleration: 440,
    turnRate: 2.3,
    health: 150,
    armor: 0.15,
    gun: 'enemyHeavyGun',
    missileCapacity: 2,
  },
  lancer: {
    ...ENEMY_BASE,
    id: 'lancer',
    name: 'ML-4 Lancer',
    className: 'Missile Carrier',
    role: 'Missile carrier',
    description: 'Long-range missile platform. Keeps its distance and fills the sky with seekers.',
    art: 'lancer',
    radius: 24,
    cruiseSpeed: 400,
    maxSpeed: 520,
    minSpeed: 210,
    boostSpeed: 740,
    acceleration: 400,
    deceleration: 480,
    turnRate: 2.7,
    health: 70,
    gun: 'lightGun',
    missileCapacity: 6,
    missileRearmTime: 7,
    missileCooldown: 2.2,
    lockRange: 1800,
    lockCone: 0.5,
    lockTime: 1.0,
  },
  warden: {
    ...ENEMY_BASE,
    id: 'warden',
    name: 'WARDEN',
    className: 'Heavy Ace',
    role: 'Mini-boss',
    description: 'Up-armoured heavy fighter flown by an ace. Guards the end of every sector.',
    art: 'brute',
    artScale: 1.45,
    boss: true,
    radius: 38,
    cruiseSpeed: 380,
    maxSpeed: 500,
    minSpeed: 190,
    boostSpeed: 700,
    acceleration: 360,
    deceleration: 460,
    turnRate: 2.4,
    health: 420,
    armor: 0.2,
    gun: 'wardenGun',
    missileCapacity: 4,
    missileRearmTime: 8,
    missileCooldown: 1.6,
    flareCharges: 3,
    flareRechargeTime: 8,
  },
  stormbreaker: {
    ...ENEMY_BASE,
    id: 'stormbreaker',
    name: 'STORMBREAKER',
    className: 'Strategic Gunship',
    role: 'Boss',
    description: 'A flying fortress: missile batteries, flak cannons and escort drones.',
    art: 'stormbreaker',
    artScale: 2.6,
    boss: true,
    radius: 72,
    cruiseSpeed: 300,
    maxSpeed: 420,
    minSpeed: 140,
    boostSpeed: 560,
    acceleration: 220,
    deceleration: 300,
    turnRate: 1.4,
    grip: 4,
    health: 1600,
    armor: 0.25,
    gun: 'bossCannon',
    missileCapacity: 0,
    lockRange: 2200,
    lockCone: 1.2,
    flareCharges: 0,
  },
};

/** Aircraft the player can fly, in hangar order. */
export const PLAYER_AIRCRAFT = ['viper', 'swift', 'titan', 'phantom', 'nova'] as const;

/** `bestLevel` is the highest Endless Skies level the player has reached. */
export function isUnlocked(id: string, bestLevel: number): boolean {
  const def = AIRCRAFT[id];
  return !!def && def.unlockLevel > 0 && Math.max(1, bestLevel) >= def.unlockLevel;
}

export function getAircraftDef(id: string): AircraftDef {
  const def = AIRCRAFT[id];
  if (!def) throw new Error(`Unknown aircraft def: ${id}`);
  return def;
}
