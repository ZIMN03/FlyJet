import { describe, expect, it } from 'vitest';
import { Button } from '../src/sim/types';
import { stepWorld } from '../src/sim/step';
import { cmd, duelSetup, run } from './helpers';

/**
 * Guards the core missile counterplay loop: a missile must NOT be an automatic
 * kill. Scenario: worst case for the defender — a locked missile launched from
 * dead astern at ~1250 units.
 */
function tailShot(evade: { sx: number; sy: number; buttons: number; triggerDist: number } | null): boolean {
  const { world, p, e } = duelSetup(1300);
  p.y = p.py = e.y = e.py = 1300;
  run(world, 1.2);
  run(world, 1 / 60, new Map([[p.id, cmd({ buttons: Button.Missile })]]));
  const c = cmd({});
  const cmds = new Map([[e.id, c]]);
  let triggered = false;
  let hit = false;
  for (let i = 0; i < 60 * 5; i++) {
    const m = world.missiles.find((mm) => mm.active);
    if (evade && m && Math.hypot(m.x - e.x, m.y - e.y) < evade.triggerDist) triggered = true;
    if (evade && triggered) {
      c.steerX = evade.sx; c.steerY = evade.sy; c.buttons = evade.buttons;
    }
    stepWorld(world, cmds);
    if (world.events.some((x) => x.type === 'damaged' && x.id === e.id && x.source === 'missile')) hit = true;
  }
  return hit;
}

describe('missile balance', () => {
  it('hits a target that does not react', () => {
    expect(tailShot(null)).toBe(true);
  });

  it('a well-timed boosted break turn evades', () => {
    for (const d of [300, 450, 600, 800]) {
      expect(tailShot({ sx: 0, sy: -1, buttons: Button.Boost, triggerDist: d })).toBe(false);
    }
  });

  it('a break turn that is far too late still gets hit', () => {
    expect(tailShot({ sx: 0, sy: -1, buttons: Button.Boost, triggerDist: 120 })).toBe(true);
    expect(tailShot({ sx: 0, sy: -1, buttons: Button.Boost, triggerDist: 200 })).toBe(true);
  });

  it('breaking far too early lets the missile re-acquire', () => {
    expect(tailShot({ sx: 0, sy: -1, buttons: Button.Boost, triggerDist: 1250 })).toBe(true);
  });

  it('a turn without afterburner is not enough from dead astern (flares are the free counter)', () => {
    expect(tailShot({ sx: 0, sy: -1, buttons: 0, triggerDist: 500 })).toBe(true);
  });

  it('a missile that burns out fizzles without splash damage', () => {
    const { world, p, e } = duelSetup(1300);
    run(world, 1 / 60, new Map([[p.id, cmd({ buttons: Button.Missile })]]));
    const m = world.missiles.find((mm) => mm.active)!;
    m.life = 0.01;
    e.x = e.px = m.x + 40;
    e.y = e.py = m.y;
    const before = e.health;
    run(world, 2 / 60);
    expect(m.active).toBe(false);
    expect(e.health).toBe(before);
  });

  it('out-running the missile with afterburner early escapes (speed counterplay)', () => {
    expect(tailShot({ sx: 1, sy: 0, buttons: Button.Boost, triggerDist: 1100 })).toBe(false);
  });

});
