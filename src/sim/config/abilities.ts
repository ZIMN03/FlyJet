/** Special ability definitions. Behaviour is implemented in systems/weapons.ts by `kind`. */

export type AbilityKind = 'overcharge' | 'speedBurst' | 'armor' | 'stealth' | 'energyPulse';

export interface AbilityDef {
  id: string;
  kind: AbilityKind;
  name: string;
  description: string;
  duration: number;
  cooldown: number;
  /** Kind-specific tuning. */
  fireRateMult?: number;
  damageMult?: number;
  speedMult?: number;
  damageTakenMult?: number;
  /** energyPulse: blast radius and damage; also destroys hostile missiles inside it. */
  pulseRadius?: number;
  pulseDamage?: number;
}

export const ABILITIES: Record<string, AbilityDef> = {
  overcharge: {
    id: 'overcharge',
    kind: 'overcharge',
    name: 'Overcharge',
    description: 'Cannons fire faster and hit harder for a short time.',
    duration: 4,
    cooldown: 18,
    fireRateMult: 1.6,
    damageMult: 1.3,
  },
  speedBurst: {
    id: 'speedBurst',
    kind: 'speedBurst',
    name: 'Slipstream',
    description: 'A short burst of extreme speed.',
    duration: 1.6,
    cooldown: 14,
    speedMult: 1.45,
  },
  armor: {
    id: 'armor',
    kind: 'armor',
    name: 'Bulwark',
    description: 'Reinforced plating: take 60% less damage for a few seconds.',
    duration: 4.5,
    cooldown: 20,
    damageTakenMult: 0.4,
  },
  stealth: {
    id: 'stealth',
    kind: 'stealth',
    name: 'Ghost Veil',
    description: 'Vanish from radar: breaks locks, cannot be locked, chasing missiles lose you.',
    duration: 4,
    cooldown: 20,
  },
  energyPulse: {
    id: 'energyPulse',
    kind: 'energyPulse',
    name: 'Nova Pulse',
    description: 'An energy shockwave that damages nearby enemies and destroys their missiles.',
    duration: 0.4,
    cooldown: 16,
    pulseRadius: 300,
    pulseDamage: 40,
  },
};
