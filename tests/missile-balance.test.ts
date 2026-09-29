import { describe, expect, it } from 'vitest';
import { Button, type SimEvent } from '../src/sim/types';
import { stepWorld } from '../src/sim/step';
import { cmd, duelSetup, run } from './helpers';

/**
 * Missile rules:
 *  - Without a lock, a missile flies straight and picks up the first enemy
 *    that comes within range in front of it.
 *  - Once it has a target it chases for up to 10 seconds; if it hasn't hit by
 *    then it pops harmlessly and disappears.
 *  - Flares pull it away; when the decoy burns out the missile disappears.
 */

function launch(world: ReturnType<typeof duelSetup>['world'], id: number) {
  run(world, 1 / 60, new Map([[id, cmd({ buttons: Button.Missile })]]));
  return world.missiles.find((m) => m.active)!;
}

describe('missile acquisition and chase', () => {
  it('a dumb-fired missile flies straight until an enemy comes into range ahead', () => {
    const { world, p, e } = duelSetup(1800); // beyond lock range: no lock at launch
    expect(p.lockState).not.toBe(3);
    const m = launch(world, p.id);
    expect(m.targetId).toBe(0);
    let acquiredAt = -1;
    for (let i = 0; i < 60 * 4 && acquiredAt < 0; i++) {
      stepWorld(world, new Map());
      if (m.targetId === e.id) acquiredAt = Math.hypot(m.x - e.x, m.y - e.y);
    }
    expect(acquiredAt).toBeGreaterThan(0);
    expect(acquiredAt).toBeLessThanOrEqual(m.def.acquireRange + 20);
    expect(m.chaseLeft).toBeGreaterThan(m.def.chaseTime - 0.1);
  });

  it('does not pick up enemies behind it', () => {
    const { world, p, e } = duelSetup(-400); // enemy behind the shooter
    const m = launch(world, p.id);
    run(world, 1.5);
    expect(m.targetId === e.id).toBe(false);
  });

  it('keeps chasing through hard turns and hits a target that only turns', () => {
    const { world, p, e } = duelSetup(900);
    run(world, 1.2);
    launch(world, p.id);
    let hit = false;
    const c = cmd({ turn: -1 }); // enemy loops continuously
    const cmds = new Map([[e.id, c]]);
    for (let i = 0; i < 60 * 10 && !hit; i++) {
      stepWorld(world, cmds);
      hit = world.events.some((x) => x.type === 'damaged' && x.id === e.id && x.source === 'missile');
    }
    expect(hit).toBe(true);
  });

  it('gives up after 10 seconds of chasing and disappears without damage', () => {
    const { world, p, e } = duelSetup(900);
    run(world, 1.2);
    const m = launch(world, p.id);
    expect(m.targetId).toBe(e.id);
    e.godMode = true;
    const events: SimEvent[] = [];
    let aliveTicks = 0;
    for (let i = 0; i < 60 * 12; i++) {
      stepWorld(world, new Map());
      // Keep the target permanently out of reach, 1500 units from the missile.
      if (m.active) {
        e.x = e.px = m.x + (m.x < world.map.width / 2 ? 1500 : -1500);
        e.y = e.py = 900;
      }
      events.push(...world.events);
      if (m.active) aliveTicks++;
    }
    expect(m.active).toBe(false);
    expect(aliveTicks / 60).toBeGreaterThan(9.5);
    expect(aliveTicks / 60).toBeLessThan(10.5);
    const pop = events.find((x) => x.type === 'missileExplode');
    expect(pop && pop.type === 'missileExplode' && pop.radius).toBe(0);
  });

  it('flares decoy the chasing missile and it disappears when the flare burns out', () => {
    const { world, p, e } = duelSetup(900);
    run(world, 1.2);
    const m = launch(world, p.id);
    run(world, 0.3);
    const events: SimEvent[] = [];
    run(world, 1 / 60, new Map([[e.id, cmd({ buttons: Button.Flare })]]), (ev) => events.push(...ev));
    expect(events.some((x) => x.type === 'missileDecoyed')).toBe(true);
    const hp = e.health;
    run(world, 4, new Map([[e.id, cmd({ turn: -0.5 })]]));
    expect(m.active).toBe(false);
    expect(e.health).toBe(hp);
  });

  it('a missile that finds nothing fizzles after its search time', () => {
    const { world, p, e } = duelSetup(900);
    e.x = e.px = 200; // far behind, never ahead of the missile
    const m = launch(world, p.id);
    run(world, m.def.lifetime + 0.2);
    expect(m.active).toBe(false);
  });
});
