import type { Aircraft } from '../sim/types';
import type { InputManager } from './input/input';

interface Step {
  id: string;
  text: string;
  keys: (i: InputManager) => string;
  /** Only show when this holds (contextual prompts). */
  when?: (a: Aircraft) => boolean;
  done: (t: TutorialTracker, a: Aircraft) => boolean;
  /** Required for the tutorial to count as finished. */
  required: boolean;
}

const STEPS: Step[] = [
  {
    id: 'steer', text: 'Steer — your nose follows the direction you hold', required: true,
    keys: (i) => `${i.label('up')}${i.label('left')}${i.label('down')}${i.label('right')}  or  ↑←↓→`,
    done: (t) => t.steerTime > 1.6,
  },
  {
    id: 'flare', text: 'MISSILE INCOMING — drop flares, or boost + break hard when it gets close', required: false,
    keys: (i) => i.labels('flare'),
    when: (a) => a.incomingMissileDist < 1400,
    done: (_t, a) => a.flareCharges < a.def.flareCharges,
  },
  {
    id: 'fire', text: 'Hold to fire your cannons', required: true,
    keys: (i) => i.labels('fire'),
    done: (_t, a) => a.stats.shotsFired >= 30,
  },
  {
    id: 'missile', text: 'Keep a hostile in front until LOCK, then launch a missile', required: true,
    keys: (i) => i.labels('missile'),
    done: (_t, a) => a.stats.missilesFired >= 1,
  },
  {
    id: 'boost', text: 'Hold for afterburner — fast, but burns energy', required: true,
    keys: (i) => i.labels('boost'),
    done: (t) => t.boostTime > 0.8,
  },
  {
    id: 'brake', text: 'Brake to tighten your turn radius', required: false,
    keys: (i) => i.labels('brake'),
    done: (t) => t.brakeTime > 0.5,
  },
  {
    id: 'ability', text: 'Trigger your special ability', required: true,
    keys: (i) => i.labels('ability'),
    done: (_t, a) => a.abilityCooldown > 0,
  },
];

/**
 * Lightweight first-time-player guidance: one short prompt at a time, each
 * dismissed by actually doing the thing. Teaches Fly → Shoot → Missile →
 * Boost → Ability, and pops the flare hint the first time a missile is inbound.
 */
export class TutorialTracker {
  steerTime = 0;
  boostTime = 0;
  brakeTime = 0;
  private readonly completed = new Set<string>();
  private elapsed = 0;
  finished = false;

  constructor(readonly enabled: boolean) {}

  update(dt: number, a: Aircraft | undefined, input: InputManager): void {
    if (!this.enabled || this.finished || !a || !a.alive) return;
    this.elapsed += dt;
    const c = input.isDown('up') || input.isDown('down') || input.isDown('left') || input.isDown('right');
    if (c) this.steerTime += dt;
    if (a.boosting) this.boostTime += dt;
    if (a.braking) this.brakeTime += dt;
    for (const s of STEPS) if (!this.completed.has(s.id) && s.done(this, a)) this.completed.add(s.id);
    if (STEPS.every((s) => !s.required || this.completed.has(s.id))) this.finished = true;
  }

  current(a: Aircraft | undefined, input: InputManager): { text: string; keys: string } | null {
    if (!this.enabled || this.finished || !a || !a.alive || this.elapsed < 0.3) return null;
    for (const s of STEPS) {
      if (this.completed.has(s.id)) continue;
      if (s.when && !s.when(a)) continue;
      return { text: s.text, keys: s.keys(input) };
    }
    return null;
  }
}
