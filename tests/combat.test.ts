import { describe, expect, it } from 'vitest';
import { Button, LockState, type SimEvent } from '../src/sim/types';
import { cmd, duelSetup, run } from './helpers';
import { stepWorld } from '../src/sim/step';

describe('guns', () => {
  it('fires at the configured rate and hits a target ahead', () => {
    const { world, p, e } = duelSetup(420);
    const cmds = new Map([[p.id, cmd({ buttons: Button.Fire })]]);
    const events: SimEvent[] = [];
    run(world, 1, cmds, (ev) => events.push(...ev));
    const shots = events.filter((x) => x.type === 'gunFire' && x.id === p.id).length;
    const expected = 1 / p.gun.fireInterval;
    expect(shots).toBeGreaterThanOrEqual(Math.floor(expected) - 1);
    expect(shots).toBeLessThanOrEqual(Math.ceil(expected) + 1);
    expect(events.some((x) => x.type === 'bulletHit' && x.targetId === e.id)).toBe(true);
    expect(e.stats.damageTaken).toBeGreaterThan(0);
    expect(p.stats.damageDealt).toBeCloseTo(e.stats.damageTaken, 5);
  });

  it('spawn protection blocks damage until the protected pilot fires', () => {
    const { world, p, e } = duelSetup(400);
    e.spawnProtection = 5;
    run(world, 0.5, new Map([[p.id, cmd({ buttons: Button.Fire })]]));
    expect(e.health).toBe(e.def.health);
  });

  it('destroys the target, credits the kill and records stats', () => {
    const { world, p, e } = duelSetup(420);
    const events: SimEvent[] = [];
    run(world, 4, new Map([[p.id, cmd({ buttons: Button.Fire })]]), (ev) => events.push(...ev));
    expect(e.alive).toBe(false);
    expect(p.stats.kills).toBe(1);
    expect(e.stats.deaths).toBe(1);
    expect(events.some((x) => x.type === 'destroyed' && x.id === e.id)).toBe(true);
    expect(events.some((x) => x.type === 'kill' && x.killerId === p.id)).toBe(true);
  });
});

describe('lock-on and missiles', () => {
  it('progresses NONE -> LOCKING -> LOCKED within lock time', () => {
    const { world, p, e } = duelSetup(900);
    stepWorld(world, new Map());
    expect(p.lockTargetId).toBe(e.id);
    run(world, p.def.lockTime * 0.5);
    expect(p.lockState).toBe(LockState.Locking);
    expect(e.beingLocked).toBe(true);
    run(world, p.def.lockTime * 0.6);
    expect(p.lockState).toBe(LockState.Locked);
    expect(e.lockedOn).toBe(true);
  });

  it('terrain blocks lock-on (line of sight)', () => {
    const { world, p, e } = duelSetup();
    // Put the target behind the tall sea stack at x=4700.
    p.x = p.px = 4300; p.y = p.py = 2100;
    e.x = e.px = 5150; e.y = e.py = 2150;
    run(world, 1.5);
    expect(p.lockState).not.toBe(LockState.Locked);
  });

  it('a locked missile tracks and damages a non-evading target', () => {
    const { world, p, e } = duelSetup(900);
    run(world, 1.2);
    expect(p.lockState).toBe(LockState.Locked);
    const events: SimEvent[] = [];
    run(world, 1 / 60, new Map([[p.id, cmd({ buttons: Button.Missile })]]), (ev) => events.push(...ev));
    const launch = events.find((x) => x.type === 'missileLaunch');
    expect(launch && launch.type === 'missileLaunch' && launch.targetId).toBe(e.id);
    expect(p.missileAmmo).toBe(p.def.missileCapacity - 1);
    // Target turns up to escape; missile should still connect since it's flying straight-ish.
    run(world, 3, new Map(), (ev) => events.push(...ev));
    expect(events.some((x) => x.type === 'missileExplode')).toBe(true);
    expect(e.health).toBeLessThan(e.def.health);
  });

  it('holding the missile button launches only one missile (edge-triggered)', () => {
    const { world, p } = duelSetup(900);
    run(world, 1.2);
    run(world, 2, new Map([[p.id, cmd({ buttons: Button.Missile })]]));
    expect(p.stats.missilesFired).toBe(1);
  });

  it('flares decoy an incoming missile and break the lock', () => {
    const { world, p, e } = duelSetup(900);
    run(world, 1.2);
    run(world, 1 / 60, new Map([[p.id, cmd({ buttons: Button.Missile })]]));
    run(world, 0.35);
    const events: SimEvent[] = [];
    run(world, 1 / 60, new Map([[e.id, cmd({ buttons: Button.Flare })]]), (ev) => events.push(...ev));
    expect(events.some((x) => x.type === 'missileDecoyed')).toBe(true);
    expect(p.lockProgress).toBe(0);
    expect(e.flareCharges).toBe(e.def.flareCharges - 1);
    const healthBefore = e.health;
    // Target climbs away from the decoys.
    run(world, 2.5, new Map([[e.id, cmd({ steerX: 0.3, steerY: -1 })]]));
    expect(e.health).toBe(healthBefore);
  });

  it('missile ammo is limited and re-arms slowly', () => {
    const { world, p } = duelSetup(900);
    for (let i = 0; i < p.def.missileCapacity + 3; i++) {
      run(world, 1 / 60, new Map([[p.id, cmd({ buttons: Button.Missile })]]));
      run(world, p.def.missileCooldown + 0.05);
    }
    expect(p.missileAmmo).toBe(0);
    expect(p.stats.missilesFired).toBe(p.def.missileCapacity);
  });
});
