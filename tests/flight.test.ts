import { describe, expect, it } from 'vitest';
import { Button } from '../src/sim/types';
import { cmd, duelSetup, run } from './helpers';
import { stepWorld } from '../src/sim/step';
import { sanitizeCommand } from '../src/sim/systems/flight';

describe('flight model', () => {
  it('holds heading and cruise speed with no input', () => {
    const { world, p } = duelSetup();
    run(world, 2);
    expect(Math.abs(p.heading)).toBeLessThan(0.05);
    expect(p.speed).toBeGreaterThan(p.def.cruiseSpeed * 0.9);
    expect(p.speed).toBeLessThan(p.def.cruiseSpeed * 1.1);
    expect(p.x).toBeGreaterThan(4000 + p.def.cruiseSpeed * 1.8);
  });

  it('never reverses instantly — turn is rate-limited', () => {
    const { world, p } = duelSetup();
    const cmds = new Map([[p.id, cmd({ steerX: -1 })]]);
    stepWorld(world, cmds);
    expect(Math.abs(p.heading)).toBeLessThanOrEqual(p.def.turnRate / 60 + 1e-6);
    // Full reversal takes roughly PI / turnRate seconds.
    run(world, Math.PI / p.def.turnRate + 0.2, cmds);
    expect(Math.abs(Math.abs(p.heading) - Math.PI)).toBeLessThan(0.05);
  });

  it('holding a turn rotates continuously through a full loop', () => {
    const { world, p } = duelSetup();
    p.y = p.py = 1200;
    const cmds = new Map([[p.id, cmd({ turn: -1 })]]);
    let total = 0;
    let prev = p.heading;
    const loopTime = (Math.PI * 2) / p.def.turnRate;
    for (let i = 0; i < Math.ceil(loopTime * 60); i++) {
      stepWorld(world, cmds);
      let d = p.heading - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      total += d;
      prev = p.heading;
    }
    // Anticlockwise on screen = negative rotation in the y-down world; one full turn.
    expect(total).toBeLessThan(-Math.PI * 2 * 0.97);
    expect(p.alive).toBe(true);
  });

  it('clockwise turn rotates the other way and releasing holds the heading', () => {
    const { world, p } = duelSetup();
    run(world, 0.3, new Map([[p.id, cmd({ turn: 1 })]]));
    const h = p.heading;
    expect(h).toBeGreaterThan(0.5);
    run(world, 0.5);
    expect(p.heading).toBeCloseTo(h, 5);
  });

  it('a full reversal loops over the top (climbs, never dives)', () => {
    const { world, p } = duelSetup();
    const startY = p.y;
    let maxY = p.y;
    const cmds = new Map([[p.id, cmd({ steerX: -1 })]]);
    for (let i = 0; i < 90; i++) {
      stepWorld(world, cmds);
      maxY = Math.max(maxY, p.y);
    }
    expect(p.y).toBeLessThan(startY - 50);
    expect(maxY).toBeLessThan(startY + 5);
  });

  it('afterburner raises speed, drains energy, then runs out', () => {
    const { world, p } = duelSetup();
    const cmds = new Map([[p.id, cmd({ buttons: Button.Boost })]]);
    run(world, 1.5, cmds);
    expect(p.boosting).toBe(true);
    expect(p.speed).toBeGreaterThan(p.def.cruiseSpeed * 1.3);
    // Holding boost can't sustain it: after depletion it only re-lights in short bursts.
    run(world, 4, cmds);
    let boostedTicks = 0;
    run(world, 3, cmds, () => { if (p.boosting) boostedTicks++; });
    expect(boostedTicks).toBeLessThan(60 * 3 * 0.5);
    expect(p.boostEnergy).toBeLessThan(p.def.afterburnerMinStart + 1);
    // Regenerates once released.
    run(world, 3);
    expect(p.boostEnergy).toBeGreaterThan(20);
  });

  it('brake slows down and tightens the turn', () => {
    const { world, p } = duelSetup();
    run(world, 1, new Map([[p.id, cmd({ buttons: Button.Brake })]]));
    expect(p.speed).toBeLessThan(p.def.cruiseSpeed * 0.8);
  });

  it('sanitises hostile/garbage commands', () => {
    const c = cmd({ steerX: NaN, steerY: 50, turn: 9, buttons: 0xffff });
    sanitizeCommand(c);
    expect(c.turn).toBe(1);
    expect(c.steerX).toBe(0);
    expect(Math.hypot(c.steerX, c.steerY)).toBeLessThanOrEqual(1 + 1e-9);
    expect(c.buttons).toBe(0xff); // 8 defined buttons; anything else is stripped
  });

  it('crashing into the sea damages and bounces instead of tunnelling', () => {
    const { world, p } = duelSetup();
    const cmds = new Map([[p.id, cmd({ steerY: 1 })]]);
    let crashed = false;
    for (let i = 0; i < 60 * 8 && !crashed; i++) {
      stepWorld(world, cmds);
      crashed = world.events.some((e) => e.type === 'crash');
    }
    expect(crashed).toBe(true);
    expect(p.health).toBeLessThan(p.def.health);
    expect(p.y).toBeLessThan(world.terrain.seaLevel);
    expect(p.vy).toBeLessThan(0);
  });

  it('soft boundary pushes the aircraft back toward the arena', () => {
    const { world, p } = duelSetup();
    p.x = 100;
    p.heading = Math.PI;
    p.vx = -p.speed;
    run(world, 3, new Map([[p.id, cmd({ steerX: -1, steerY: 0 })]]));
    expect(p.x).toBeGreaterThan(-600);
  });
});
