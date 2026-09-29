import { describe, expect, it } from 'vitest';
import { AIRCRAFT } from '../src/sim/config/aircraft';
import { applyUpgrades, nextUpgradeCost, UPGRADES } from '../src/sim/config/upgrades';
import { sanitizeSave } from '../src/client/save/save';
import { RewardLedger } from '../src/client/rewards';
import { TEAM_BLUE, TEAM_ORANGE } from '../src/sim/constants';
import { spawnAircraft } from '../src/sim/systems/spawn';
import { stepWorld } from '../src/sim/step';
import { Button } from '../src/sim/types';
import { cmd, makeWorld } from './helpers';

describe('hangar upgrades', () => {
  it('each upgrade changes the real stats', () => {
    const v = AIRCRAFT.viper;
    const up = applyUpgrades(v, { engine: 3, airframe: 2, weapons: 1, missiles: 2, burner: 3 });
    expect(up.maxSpeed!).toBeCloseTo(v.maxSpeed * 1.12, 5);
    expect(up.health).toBe(Math.round(v.health * 1.2));
    expect(up.gunDamageMult).toBeCloseTo(1.06, 5);
    expect(up.missileCapacity).toBe(v.missileCapacity + 2);
    expect(up.afterburnerCapacity!).toBeCloseTo(v.afterburnerCapacity * 1.36, 5);
  });

  it('upgraded cannons actually hit harder in the simulation', () => {
    const dmg = (weapons: number) => {
      const w = makeWorld(1);
      const p = w.addAircraft('viper', TEAM_BLUE, 'P', true, -1, applyUpgrades(AIRCRAFT.viper, { weapons }));
      const e = w.addAircraft('brute', TEAM_ORANGE, 'E', false);
      spawnAircraft(w, p, 4000, 1000, 1);
      spawnAircraft(w, e, 4350, 1000, 1);
      p.spawnProtection = e.spawnProtection = 0;
      e.godMode = false;
      for (let i = 0; i < 30; i++) stepWorld(w, new Map([[p.id, cmd({ buttons: Button.Fire })]]));
      return p.stats.damageDealt / Math.max(1, p.stats.shotsHit);
    };
    expect(dmg(3)).toBeGreaterThan(dmg(0) * 1.1);
  });

  it('costs rise per level and stop at max', () => {
    for (const u of UPGRADES) {
      expect(nextUpgradeCost(u.id, 0)).toBe(u.costs[0]);
      expect(nextUpgradeCost(u.id, 2)!).toBeGreaterThan(nextUpgradeCost(u.id, 1)!);
      expect(nextUpgradeCost(u.id, 3)).toBeNull();
    }
  });

  it('save validation keeps good upgrade/paint data and drops garbage', () => {
    const s = sanitizeSave({
      profile: {
        credits: 500,
        upgrades: { viper: { engine: 2, airframe: 99, weapons: 'x' }, ['x'.repeat(40)]: { engine: 1 } },
        paints: ['arctic', 42],
        paint: 'arctic',
      },
    });
    expect(s.profile.upgrades.viper).toEqual({ engine: 2, airframe: 3 });
    expect(Object.keys(s.profile.upgrades)).toEqual(['viper']);
    expect(s.profile.paints).toEqual(['standard', 'arctic']);
    expect(s.profile.paint).toBe('arctic');
    // Old saves without the new fields still load.
    const old = sanitizeSave({ profile: { xp: 10 } });
    expect(old.profile.upgrades).toEqual({});
    expect(old.profile.paints).toEqual(['standard']);
    expect(old.profile.stats.missilesEvaded).toBe(0);
  });
});

describe('reward ledger', () => {
  it('pays for real events only, itemised', () => {
    const w = makeWorld(1);
    const p = w.addAircraft('viper', TEAM_BLUE, 'P', true);
    const e = w.addAircraft('warden', TEAM_ORANGE, 'W', false);
    const L = new RewardLedger(p.id);
    L.handle(w, [
      { type: 'kill', killerId: p.id, victimId: e.id, score: 100, streak: 1, source: 'missile' },
      { type: 'kill', killerId: 999, victimId: e.id, score: 100, streak: 1, source: 'gun' }, // someone else's kill
      { type: 'missileEvaded', id: p.id, missileId: 1, decoyed: true },
      { type: 'waveClear', wave: 2, bonus: 300 },
      { type: 'levelComplete', level: 2, bonus: 1000, time: 90 },
    ], 2);
    const lines = L.lines(95);
    const byLabel = Object.fromEntries(lines.map((x) => [x.label, x]));
    expect(byLabel['Missile kills'].count).toBe(1);
    expect(byLabel['Gun kills']).toBeUndefined();
    expect(byLabel['Bosses defeated'].count).toBe(1);
    expect(byLabel['Missiles evaded'].count).toBe(1);
    expect(byLabel['Levels completed'].xp).toBe(500);
    expect(byLabel['Time survived'].count).toBe(90);
    const t = L.totals(95);
    expect(t.xp).toBe(lines.reduce((s, x) => s + x.xp, 0));
    expect(t.credits).toBeGreaterThan(0);
  });
});
