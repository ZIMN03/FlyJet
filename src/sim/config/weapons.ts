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
  lifetime: number;
  /** Delay before guidance and fuse activate. */
  armTime: number;
  /** If the target leaves this half-angle cone, the seeker loses it for good. */
  seekerCone: number;
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
    // Tuned with tests/missile-balance.test.ts: a timed break turn or an early
    // afterburner run beats it; doing nothing does not.
    maxSpeed: 800,
    turnRate: 1.8,
    lifetime: 3.4,
    armTime: 0.18,
    seekerCone: 0.8,
    proximityFuse: 12,
    lead: 0.1,
    flareSusceptibleRange: 1100,
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
    lifetime: 3.2,
    armTime: 0.2,
    seekerCone: 0.8,
    proximityFuse: 12,
    lead: 0,
    flareSusceptibleRange: 1100,
  },
};
