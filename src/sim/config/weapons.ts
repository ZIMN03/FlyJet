/** Weapon definitions. Aircraft reference these by id. */

export interface GunDef {
  id: string;
  name: string;
  damage: number;
  /** Seconds between shots. */
  fireInterval: number;
  bulletSpeed: number;
  bulletLife: number;
  /** Random spread in radians (half-angle). */
  spread: number;
  /** Muzzle offset along the nose, world units. */
  muzzleOffset: number;
  /** Alternating vertical offset between two barrels (0 for single barrel). */
  barrelSpacing: number;
}

export interface MissileDef {
  id: string;
  name: string;
  damage: number;
  blastRadius: number;
  /** Launch speed added on top of the carrier speed. */
  launchBoost: number;
  acceleration: number;
  maxSpeed: number;
  /** Max turn rate, rad/s. Deliberately lower than aircraft so missiles are dodgeable. */
  turnRate: number;
  /** Seconds a missile flies straight looking for a target before it fizzles out. */
  lifetime: number;
  /** Once it has a target, it chases for this long; no hit by then = it disappears harmlessly. */
  chaseTime: number;
  /** An enemy this close, inside the acquire cone, becomes the missile's target. */
  acquireRange: number;
  /** Half-angle in front of the missile in which it can pick up a target, radians. */
  acquireCone: number;
  /** Delay before guidance and fuse activate. */
  armTime: number;
  proximityFuse: number;
  /** Guidance lead factor (0 = pure pursuit, 1 = full lead). */
  lead: number;
  /** Tracking missiles farther than this from their target ignore flares. */
  flareSusceptibleRange: number;
}

export const GUNS: Record<string, GunDef> = {
  pulseCannon: {
    id: 'pulseCannon',
    name: 'Twin Pulse Cannon',
    damage: 7,
    fireInterval: 0.075,
    bulletSpeed: 1650,
    bulletLife: 0.62,
    spread: 0.025,
    muzzleOffset: 34,
    barrelSpacing: 4,
  },
  plasmaLance: {
    id: 'plasmaLance',
    name: 'Plasma Lance',
    damage: 13,
    fireInterval: 0.13,
    bulletSpeed: 1900,
    bulletLife: 0.6,
    spread: 0.012,
    muzzleOffset: 34,
    barrelSpacing: 0,
  },
  heavyCannon: {
    id: 'heavyCannon',
    name: 'Twin Heavy Cannon',
    damage: 10,
    fireInterval: 0.1,
    bulletSpeed: 1500,
    bulletLife: 0.62,
    spread: 0.03,
    muzzleOffset: 38,
    barrelSpacing: 6,
  },
  scatterGun: {
    id: 'scatterGun',
    name: 'Rotary Scatter Gun',
    damage: 5,
    fireInterval: 0.09,
    bulletSpeed: 1450,
    bulletLife: 0.6,
    spread: 0.045,
    muzzleOffset: 30,
    barrelSpacing: 0,
  },
};

export const MISSILES: Record<string, MissileDef> = {
  lanceMissile: {
    id: 'lanceMissile',
    name: 'Lance IR Missile',
    damage: 60,
    blastRadius: 62,
    launchBoost: 90,
    acceleration: 1000,
    maxSpeed: 800,
    turnRate: 1.8,
    lifetime: 4,
    chaseTime: 10,
    acquireRange: 650,
    acquireCone: 1.1,
    armTime: 0.18,
    proximityFuse: 12,
    lead: 0.1,
    flareSusceptibleRange: 1800,
  },
  hornetRocket: {
    id: 'hornetRocket',
    name: 'Hornet Seeker',
    damage: 45,
    blastRadius: 55,
    launchBoost: 80,
    acceleration: 900,
    maxSpeed: 760,
    turnRate: 1.7,
    lifetime: 4,
    chaseTime: 10,
    acquireRange: 600,
    acquireCone: 1.0,
    armTime: 0.2,
    proximityFuse: 12,
    lead: 0,
    flareSusceptibleRange: 1800,
  },
};
