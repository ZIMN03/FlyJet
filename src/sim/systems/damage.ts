import { COMBAT, SCORE } from '../constants';
import type { Aircraft, DamageSource } from '../types';
import type { World } from '../world';

/**
 * The single entry point for all damage. Handles armor, abilities, spawn
 * protection, damage attribution, kills, assists and streaks. Nothing else in
 * the simulation writes to `health` directly (except spawning).
 */
export function applyDamage(
  world: World,
  victim: Aircraft,
  amount: number,
  attackerId: number,
  source: DamageSource,
): number {
  if (!victim.alive || !(amount > 0)) return 0;
  if (victim.godMode) return 0;
  if (victim.spawnProtection > 0 && source !== 'boundary' && source !== 'debug') return 0;

  let dmg = amount * (1 - victim.def.armor);
  if (victim.abilityTimer > 0 && victim.ability.damageTakenMult !== undefined) dmg *= victim.ability.damageTakenMult;
  dmg = Math.min(dmg, victim.health);
  victim.health -= dmg;
  victim.timeSinceDamaged = 0;
  victim.stats.damageTaken += dmg;

  if (attackerId && attackerId !== victim.id) {
    const attacker = world.getAircraft(attackerId);
    if (attacker) attacker.stats.damageDealt += dmg;
    victim.lastAttackerId = attackerId;
    victim.lastAttackerTime = world.time;
    let rec = victim.damageLog.get(attackerId);
    if (!rec) {
      rec = { damage: 0, time: 0 };
      victim.damageLog.set(attackerId, rec);
    }
    // Decay old contributions so assists reflect *recent* meaningful damage.
    if (world.time - rec.time > COMBAT.assistWindow) rec.damage = 0;
    rec.damage += dmg;
    rec.time = world.time;
  }

  if (source !== 'boundary' || victim.health <= 0) {
    world.emit({ type: 'damaged', id: victim.id, attackerId, amount: dmg, source });
  }

  if (victim.health <= 0) destroyAircraft(world, victim, attackerId, source);
  return dmg;
}

export function destroyAircraft(world: World, victim: Aircraft, attackerId: number, source: DamageSource): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.health = 0;
  victim.boosting = false;
  victim.stats.deaths++;
  victim.stats.streak = 0;
  victim.lockTargetId = 0;
  victim.lockProgress = 0;

  // Environmental deaths are credited to whoever last hit the victim recently.
  let killerId = attackerId;
  if (!killerId && world.time - victim.lastAttackerTime <= COMBAT.killCreditWindow) {
    killerId = victim.lastAttackerId;
  }
  const killer = killerId ? world.getAircraft(killerId) : undefined;

  world.emit({ type: 'destroyed', id: victim.id, killerId, x: victim.x, y: victim.y, vx: victim.vx, vy: victim.vy, source });

  if (killer && killer.id !== victim.id && world.areEnemies(killer, victim)) {
    killer.stats.kills++;
    killer.stats.streak++;
    killer.stats.bestStreak = Math.max(killer.stats.bestStreak, killer.stats.streak);
    const score = SCORE.kill + (source === 'missile' ? SCORE.missileKillBonus : 0);
    killer.stats.score += score;
    world.emit({ type: 'kill', killerId: killer.id, victimId: victim.id, score, streak: killer.stats.streak, source });
  }

  for (const [id, rec] of victim.damageLog) {
    if (id === killerId) continue;
    if (world.time - rec.time > COMBAT.assistWindow) continue;
    if (rec.damage < victim.def.health * COMBAT.assistDamageShare) continue;
    const helper = world.getAircraft(id);
    if (!helper || !world.areEnemies(helper, victim)) continue;
    helper.stats.assists++;
    helper.stats.score += SCORE.assist;
    world.emit({ type: 'assist', id, victimId: victim.id, score: SCORE.assist });
  }
  victim.damageLog.clear();

  world.mode?.onDestroyed(world, victim, killerId);
}
