import type { SimEvent } from '../sim/types';
import type { World } from '../sim/world';

/**
 * Tallies what the local pilot actually did during a match and turns it into
 * XP and credits with a readable breakdown. Every line comes from a real
 * simulation event, so the numbers on the results screen always mean
 * something. (Online, the server will compute this from the same events.)
 */
export interface RewardLine {
  label: string;
  count: number;
  xp: number;
  credits: number;
}

/** Per-occurrence payouts. Level-scaled items multiply by the level they happened on. */
const PAY = {
  gunKill: { xp: 30, credits: 12 },
  missileKill: { xp: 40, credits: 15 },
  ramKill: { xp: 25, credits: 8 },
  assist: { xp: 12, credits: 4 },
  missileHit: { xp: 8, credits: 2 },
  missileEvaded: { xp: 20, credits: 8 },
  stageCleared: { xp: 40, credits: 15 },
  bossDefeated: { xp: 220, credits: 120 },
  levelCompleted: { xp: 250, credits: 120 },
  /** Per 10 seconds survived. */
  survival: { xp: 2, credits: 1 },
};

export class RewardLedger {
  gunKills = 0;
  missileKills = 0;
  ramKills = 0;
  assists = 0;
  missileHits = 0;
  missilesEvaded = 0;
  flaresUsed = 0;
  bossesDefeated = 0;
  levelsCompleted = 0;
  /** Level-weighted sums for scaled rewards. */
  private stageXp = 0;
  private stageCredits = 0;
  private bossXp = 0;
  private bossCredits = 0;
  private levelXp = 0;
  private levelCredits = 0;
  private stagesCleared = 0;

  constructor(private readonly localId: number) {}

  handle(world: World, events: readonly SimEvent[], level: number): void {
    const me = this.localId;
    const lv = Math.max(1, level);
    for (const e of events) {
      switch (e.type) {
        case 'kill':
          if (e.killerId !== me) break;
          if (e.source === 'missile') this.missileKills++;
          else if (e.source === 'collision') this.ramKills++;
          else this.gunKills++;
          if (world.getAircraft(e.victimId)?.def.boss) {
            this.bossesDefeated++;
            this.bossXp += PAY.bossDefeated.xp * lv;
            this.bossCredits += PAY.bossDefeated.credits * lv;
          }
          break;
        case 'assist':
          if (e.id === me) this.assists++;
          break;
        case 'damaged':
          if (e.attackerId === me && e.source === 'missile') this.missileHits++;
          break;
        case 'missileEvaded':
          if (e.id === me) this.missilesEvaded++;
          break;
        case 'flareDeploy':
          if (e.id === me) this.flaresUsed++;
          break;
        case 'waveClear':
          this.stagesCleared++;
          this.stageXp += PAY.stageCleared.xp * lv;
          this.stageCredits += PAY.stageCleared.credits * lv;
          break;
        case 'levelComplete':
          this.levelsCompleted++;
          this.levelXp += PAY.levelCompleted.xp * e.level;
          this.levelCredits += PAY.levelCompleted.credits * e.level;
          break;
      }
    }
  }

  /** The itemised reward, skipping empty lines. */
  lines(survivalSeconds: number): RewardLine[] {
    const tens = Math.floor(survivalSeconds / 10);
    const l = (label: string, count: number, pay: { xp: number; credits: number }): RewardLine =>
      ({ label, count, xp: count * pay.xp, credits: count * pay.credits });
    return [
      l('Gun kills', this.gunKills, PAY.gunKill),
      l('Missile kills', this.missileKills, PAY.missileKill),
      l('Ramming kills', this.ramKills, PAY.ramKill),
      l('Assists', this.assists, PAY.assist),
      l('Missile hits', this.missileHits, PAY.missileHit),
      l('Missiles evaded', this.missilesEvaded, PAY.missileEvaded),
      { label: 'Waves cleared', count: this.stagesCleared, xp: this.stageXp, credits: this.stageCredits },
      { label: 'Bosses defeated', count: this.bossesDefeated, xp: this.bossXp, credits: this.bossCredits },
      { label: 'Levels completed', count: this.levelsCompleted, xp: this.levelXp, credits: this.levelCredits },
      { label: 'Time survived', count: tens * 10, xp: tens * PAY.survival.xp, credits: tens * PAY.survival.credits },
    ].filter((x) => x.count > 0);
  }

  totals(survivalSeconds: number): { xp: number; credits: number } {
    let xp = 0;
    let credits = 0;
    for (const x of this.lines(survivalSeconds)) {
      xp += x.xp;
      credits += x.credits;
    }
    return { xp, credits };
  }
}
