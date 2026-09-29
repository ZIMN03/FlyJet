import { describe, expect, it } from 'vitest';
import { WaveSession } from '../src/client/session';
import { emptyCommand, type InputCommand } from '../src/sim/types';
import { stepWorld } from '../src/sim/step';
import { cmd, duelSetup } from './helpers';

/** Unwrapped rotation tracker: accumulates heading change across the ±PI seam. */
function tracker(start: number) {
  let prev = start;
  let total = 0;
  let maxStep = 0;
  return {
    update(h: number) {
      let d = h - prev;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      total += d;
      maxStep = Math.max(maxStep, Math.abs(d));
      prev = h;
    },
    get total() { return total; },
    get maxStep() { return maxStep; },
  };
}

describe('360° turning (the 15-step flight-control requirement)', () => {
  it('LEFT: starts smoothly, passes 90/180/270/360, keeps going, stops on release, flies straight; RIGHT reverses', () => {
    const { world, p } = duelSetup();
    p.y = p.py = 1200;
    const left = new Map([[p.id, cmd({ turn: -1 })]]);
    const t = tracker(p.heading);

    // 1–2. Press LEFT: the very first tick turns a little — immediately, but not a snap.
    stepWorld(world, left);
    t.update(p.heading);
    expect(t.total).toBeLessThan(0);
    expect(Math.abs(t.total)).toBeLessThan(p.def.turnRate / 60);

    // 3–9. Keep holding: pass every quarter and keep rotating beyond 360°.
    const reached: number[] = [];
    let ticks = 0;
    while (Math.abs(t.total) < Math.PI * 2.5 && ticks < 60 * 10) {
      stepWorld(world, left);
      t.update(p.heading);
      ticks++;
      for (const q of [90, 180, 270, 360]) {
        if (!reached.includes(q) && Math.abs(t.total) >= (q * Math.PI) / 180) reached.push(q);
      }
      expect(Number.isFinite(p.heading)).toBe(true);
      expect(p.heading).toBeGreaterThanOrEqual(-Math.PI);
      expect(p.heading).toBeLessThanOrEqual(Math.PI);
    }
    expect(reached).toEqual([90, 180, 270, 360]);
    expect(Math.abs(t.total)).toBeGreaterThan(Math.PI * 2.5); // 9. still rotating past 360°
    // Smooth: never more than one tick's worth of max turn rate (no snapping).
    expect(t.maxStep).toBeLessThan((p.def.turnRate * 2) / 60);

    // 10–12. Release: rotation winds down, then the aircraft flies straight along its nose.
    for (let i = 0; i < 30; i++) { stepWorld(world, new Map()); t.update(p.heading); }
    expect(Math.abs(p.turnVel)).toBeLessThan(1e-9);
    const held = p.heading;
    const x0 = p.x;
    const y0 = p.y;
    for (let i = 0; i < 30; i++) stepWorld(world, new Map());
    expect(p.heading).toBeCloseTo(held, 9);
    const moveAngle = Math.atan2(p.y - y0, p.x - x0);
    let off = moveAngle - held;
    if (off > Math.PI) off -= Math.PI * 2;
    if (off < -Math.PI) off += Math.PI * 2;
    expect(Math.abs(off)).toBeLessThan(0.15);

    // 13–14. Press RIGHT: turns the opposite way, smoothly.
    const before = t.total;
    for (let i = 0; i < 30; i++) { stepWorld(world, new Map([[p.id, cmd({ turn: 1 })]])); t.update(p.heading); }
    expect(t.total).toBeGreaterThan(before + 0.5);
  });

  it('15. can settle on any heading, not just cardinal directions', () => {
    // Hold the turn for 1..90 ticks, release, let it settle: collect the resting headings.
    const finals: number[] = [];
    for (let k = 1; k <= 90; k++) {
      const { world, p } = duelSetup();
      p.y = p.py = 1200;
      for (let i = 0; i < k; i++) stepWorld(world, new Map([[p.id, cmd({ turn: 1 })]]));
      for (let i = 0; i < 20; i++) stepWorld(world, new Map());
      finals.push((p.heading * 180) / Math.PI);
    }
    const unique = new Set(finals.map((d) => Math.round(d * 10)));
    expect(unique.size).toBe(90); // every hold length gives a different resting angle
    // Plenty of them sit far from any multiple of 45° (no 8-way quantisation).
    const offGrid = finals.filter((d) => Math.abs(((d % 45) + 45) % 45 - 22.5) < 15).length;
    expect(offGrid).toBeGreaterThan(40);
    // Holding one tick longer moves the resting angle by only a few degrees (continuous control).
    let maxGap = 0;
    for (let i = 1; i < finals.length; i++) {
      let d = finals[i] - finals[i - 1];
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      maxGap = Math.max(maxGap, Math.abs(d));
    }
    expect(maxGap).toBeLessThan(8);
  });

  it('RIGHT also loops a full 360° and beyond', () => {
    const { world, p } = duelSetup();
    p.y = p.py = 1200;
    const t = tracker(p.heading);
    for (let i = 0; i < 60 * 3; i++) { stepWorld(world, new Map([[p.id, cmd({ turn: 1 })]])); t.update(p.heading); }
    expect(t.total).toBeGreaterThan(Math.PI * 2);
  });

  it('many loops accumulate no drift: heading stays wrapped and exact', () => {
    const { world, p } = duelSetup();
    p.y = p.py = 1200;
    p.godMode = true;
    for (let i = 0; i < 60 * 30; i++) stepWorld(world, new Map([[p.id, cmd({ turn: -1 })]]));
    expect(p.heading).toBeGreaterThanOrEqual(-Math.PI);
    expect(p.heading).toBeLessThanOrEqual(Math.PI);
    expect(Math.abs(p.turnVel)).toBeGreaterThan(p.def.turnRate * 0.8);
  });

  it('turning is identical at 30, 60, 120 and 144 fps (fixed simulation tick)', () => {
    const results: number[] = [];
    for (const fps of [30, 60, 120, 144]) {
      const s = new WaveSession({ aircraft: 'viper', callsign: 'T', lives: 3, seed: 42 });
      const turnLeft = (): InputCommand => ({ ...emptyCommand(), turn: -1 });
      // Run exactly 3 simulated seconds regardless of how the frames are sliced.
      const frames = fps * 3;
      for (let i = 0; i < frames; i++) s.update(1 / fps, turnLeft, () => {});
      results.push(s.world.tick);
      results.push(Number(s.local()!.heading.toFixed(6)));
    }
    // Same tick count (±1 for float slicing) and same heading at every frame rate.
    const ticks = results.filter((_, i) => i % 2 === 0);
    const headings = results.filter((_, i) => i % 2 === 1);
    expect(Math.max(...ticks) - Math.min(...ticks)).toBeLessThanOrEqual(1);
    const spread = Math.max(...headings) - Math.min(...headings);
    expect(spread).toBeLessThan(0.1);
  });
});

describe('collisions and heat', () => {
  it('a head-on mid-air collision damages both aircraft exactly once', async () => {
    const { duelSetup: setup } = await import('./helpers');
    const { world, p, e } = setup(300);
    e.heading = Math.PI;
    e.vx = -e.speed;
    let hits = 0;
    for (let i = 0; i < 60; i++) {
      stepWorld(world, new Map());
      hits += world.events.filter((x) => x.type === 'collision').length;
    }
    expect(hits).toBe(1);
    expect(p.health).toBeLessThan(p.def.health);
    expect(e.health).toBeLessThan(e.def.health);
  });

  it('fast aircraft cannot pass through each other between ticks (swept test)', async () => {
    const { duelSetup: setup } = await import('./helpers');
    const { world, p, e } = setup(60);
    // Teleport-speed crossing: 3000 u/s each way would skip past with a naive overlap test.
    p.y = p.py = e.y = e.py = 1000;
    p.x = p.px = 4000; e.x = e.px = 4040;
    p.px = 4000 - 50; e.px = 4040 + 50;
    const { updateAircraftCollisions } = await import('../src/sim/systems/collision');
    // Positions at end of tick have already crossed: p is right of e.
    p.x = 4100; e.x = 3940;
    updateAircraftCollisions(world, 1 / 60);
    expect(world.events.some((x) => x.type === 'collision')).toBe(true);
  });

  it('sustained cannon fire overheats, then the guns cool and come back', async () => {
    const { duelSetup: setup } = await import('./helpers');
    const { Button } = await import('../src/sim/types');
    const { world, p } = setup(3000);
    let overheatedAt = -1;
    for (let i = 0; i < 60 * 8 && overheatedAt < 0; i++) {
      stepWorld(world, new Map([[p.id, cmd({ buttons: Button.Fire })]]));
      if (p.overheated) overheatedAt = i / 60;
    }
    expect(overheatedAt).toBeGreaterThan(3);
    expect(overheatedAt).toBeLessThan(6.5);
    const shots = p.stats.shotsFired;
    for (let i = 0; i < 30; i++) stepWorld(world, new Map([[p.id, cmd({ buttons: Button.Fire })]]));
    expect(p.stats.shotsFired).toBe(shots); // locked out while overheated
    for (let i = 0; i < 60 * 2; i++) stepWorld(world, new Map());
    expect(p.overheated).toBe(false);
  });
});
