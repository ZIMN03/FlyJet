import { describe, expect, it } from 'vitest';
import { cruiseThrottle } from '../src/sim/systems/flight';
import { Button } from '../src/sim/types';
import { stepWorld } from '../src/sim/step';
import { cmd, duelSetup, run } from './helpers';

/** Measure how many seconds a full 360° turn takes and the loop's diameter. */
function loop(throttleSeconds: number, up: boolean) {
  const { world, p } = duelSetup();
  p.y = p.py = 1100;
  run(world, throttleSeconds, new Map([[p.id, cmd({ buttons: up ? Button.ThrottleUp : Button.ThrottleDown })]]));
  run(world, 2); // settle to the new speed
  let minX = p.x, maxX = p.x, total = 0, prev = p.heading, t = 0;
  const cmds = new Map([[p.id, cmd({ turn: 1 })]]);
  while (total < Math.PI * 2 && t < 10) {
    stepWorld(world, cmds);
    let d = p.heading - prev;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    total += d; prev = p.heading; t += 1 / 60;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
  }
  return { time: t, width: maxX - minX, speed: p.speed, throttle: p.throttle };
}

describe('throttle', () => {
  it('starts at the cruise setting and holds cruise speed', () => {
    const { world, p } = duelSetup();
    expect(p.throttle).toBeCloseTo(cruiseThrottle(p.def), 5);
    run(world, 3);
    expect(Math.abs(p.speed - p.def.cruiseSpeed)).toBeLessThan(20);
  });

  it('up/down move the throttle, and the setting stays after release', () => {
    const { world, p } = duelSetup();
    const t0 = p.throttle;
    run(world, 0.3, new Map([[p.id, cmd({ buttons: Button.ThrottleDown })]]));
    const t1 = p.throttle;
    expect(t1).toBeLessThan(t0);
    run(world, 1);
    expect(p.throttle).toBe(t1);
    run(world, 3, new Map([[p.id, cmd({ buttons: Button.ThrottleUp })]]));
    expect(p.throttle).toBe(1);
  });

  it('slower flight makes a much tighter turn', () => {
    const fast = loop(1, true);
    const slow = loop(0.35, false);
    expect(slow.speed).toBeLessThan(fast.speed);
    expect(slow.width).toBeLessThan(fast.width * 0.7);
    expect(slow.time).toBeLessThan(fast.time);
  });
});

describe('stall', () => {
  it('climbing at idle throttle stalls; the nose then falls and speed recovers', () => {
    const { world, p } = duelSetup();
    p.y = p.py = 1400;
    p.heading = -Math.PI / 2; // straight up
    run(world, 1, new Map([[p.id, cmd({ buttons: Button.ThrottleDown })]]));
    let stalled = false;
    for (let i = 0; i < 60 * 4 && !stalled; i++) {
      stepWorld(world, new Map());
      stalled = p.stalled;
    }
    expect(stalled).toBe(true);
    // Hands off: the nose drops toward the ground and speed builds back up.
    run(world, 1.2);
    expect(Math.sin(p.heading)).toBeGreaterThan(0.5); // pointing down
    run(world, 3, new Map([[p.id, cmd({ buttons: Button.ThrottleUp })]]));
    expect(p.stalled).toBe(false);
    expect(p.alive).toBe(true);
  });

  it('a stalled aircraft can flip its nose around much faster (stall flip)', () => {
    const { world, p } = duelSetup();
    p.y = p.py = 1400;
    // Normal half-turn time at cruise:
    const t = (Math.PI) / p.def.turnRate;
    p.stalled = true;
    p.speed = p.def.minSpeed * 0.5;
    const h0 = p.heading;
    run(world, t * 0.5, new Map([[p.id, cmd({ turn: 1 })]]));
    // Stalled + slow: more than a full half-turn's worth of rotation in half the time.
    expect(Math.abs(p.heading - h0)).toBeGreaterThan(Math.PI * 0.9);
  });

  it('AI and untouched throttles never stall in normal flight', () => {
    const { world, p, e } = duelSetup(1500);
    let stalls = 0;
    for (let i = 0; i < 60 * 10; i++) {
      stepWorld(world, new Map([[p.id, cmd({ turn: i % 240 < 120 ? -1 : 0.4 })]]));
      if (p.stalled || e.stalled) stalls++;
    }
    expect(stalls).toBe(0);
  });
});
