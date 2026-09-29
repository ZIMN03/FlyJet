/**
 * End-to-end smoke test: boots the game in headless Chromium, drives it with
 * real keyboard input through the full loop (title -> menu -> match -> fight ->
 * die -> results -> play again) and fails on any page/console error.
 * Screenshots land in test-output/.
 *
 *   npm run smoke            (starts its own Vite dev server)
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });

const server = await createServer({ server: { port: 5199, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const url = 'http://127.0.0.1:5199/';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const wait = (ms) => page.waitForTimeout(ms);
const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
const state = () => page.evaluate(() => {
  const g = window.aerovant;
  const s = g.session;
  const me = s?.local();
  return {
    appState: g.state,
    screen: g.ui.current,
    phase: s?.mode?.phase,
    wave: s?.mode?.wave,
    alive: me?.alive, lives: me?.lives, health: me?.health,
    x: me?.x, y: me?.y, heading: me?.heading,
    shots: me?.stats.shotsFired, hits: me?.stats.shotsHit, kills: me?.stats.kills,
    missiles: me?.stats.missilesFired, score: me?.stats.score,
    enemies: s?.world.aircraft.filter((a) => a.alive && a.team !== me?.team).length,
    particles: g.renderer.particles.count,
  };
});
const check = (cond, msg) => { if (!cond) { throw new Error(`CHECK FAILED: ${msg}`); } console.log(`  ok  ${msg}`); };

try {
  await page.goto(url);
  await wait(1200);
  await shot('01-title');
  check((await state()).screen === 'title', 'title screen shown');

  await page.keyboard.press('Enter');
  await wait(600);
  await shot('02-main-menu');
  check((await state()).screen === 'main', 'main menu after key press');

  await page.click('text=HANGAR');
  await wait(600);
  await shot('03-hangar');
  // Any plane can be inspected; locked ones show stats plus the level needed.
  await page.click('[data-action="hangar-select"][data-id="titan"]');
  await wait(500);
  const note = await page.textContent('.lock-note');
  check(/level 5/i.test(note ?? ''), 'locked Titan shows "reach level 5" in the hangar');
  check(await page.isVisible('.stat >> text=WEAPONS'), 'locked aircraft still shows its stats');
  await page.click('[data-action="hangar-tab"][data-tab="upgrades"]');
  await wait(300);
  check(await page.isVisible('text=Missile rack'), 'upgrades tab lists upgrades');
  await page.click('[data-action="hangar-select"][data-id="viper"]');
  await wait(300);
  check(await page.isDisabled('[data-action="buy-upgrade"][data-id="engine"]'), 'cannot buy an upgrade without credits');
  await page.click('[data-action="hangar-tab"][data-tab="paint"]');
  await wait(300);
  check(await page.isVisible('text=Solar Ace'), 'paint tab lists schemes');
  await shot('03c-hangar-paint');
  await page.click('[data-action="hangar-tab"][data-tab="stats"]');
  await wait(200);
  await shot('03b-hangar-locked');
  await page.keyboard.press('Escape');
  await wait(300);
  await page.click('text=SETTINGS');
  await wait(300);
  await page.click('[data-tab="controls"]');
  await wait(300);
  await shot('04-settings-controls');
  await page.keyboard.press('Escape');
  await wait(300);

  await page.click('text=PLAY');
  await wait(400);
  await shot('05-mode-select');
  await page.click('text=TRAINING FLIGHT');
  await wait(1500);
  await shot('06-countdown');
  let s = await state();
  check(s.appState === 'match' && s.phase === 'countdown', 'match started with countdown');

  await wait(2800);
  s = await state();
  check(s.phase === 'playing' && s.wave === 1, 'wave 1 playing after countdown');
  const startX = s.x;
  const startY = s.y;

  // Fly: hold the right arrow while boosting — the aircraft keeps rotating.
  const h0 = s.heading;
  await page.keyboard.down('ArrowRight');
  await page.keyboard.down('ShiftLeft');
  await wait(1200);
  await page.keyboard.up('ShiftLeft');
  await page.keyboard.up('ArrowRight');
  s = await state();
  const moved = Math.hypot(s.x - startX, s.y - startY);
  check(moved > 250, `aircraft flew under keyboard control (moved ${Math.round(moved)} units)`);
  check(Math.abs(s.heading - h0) > 0.3, 'right arrow rotated the aircraft');
  const thr = () => page.evaluate(() => window.aerovant.session.local().throttle);
  const thr0 = await thr();
  await page.keyboard.down('ArrowDown'); await wait(400); await page.keyboard.up('ArrowDown');
  const thr1 = await thr();
  await wait(300);
  check(thr1 < thr0 - 0.1 && (await thr()) === thr1, `down arrow lowers throttle and it stays (${thr0.toFixed(2)} -> ${thr1.toFixed(2)})`);
  await shot('07b-low-throttle');
  await page.keyboard.down('ArrowUp'); await wait(500); await page.keyboard.up('ArrowUp');
  check((await thr()) > thr1 + 0.2, 'up arrow raises throttle');
  await shot('07-flying');

  // Hunt the enemy: steer toward it each 100ms while firing and launching missiles.
  let fought = false;
  let lockedShot = false;
  for (let i = 0; i < 120 && !fought; i++) {
    const tgt = await page.evaluate(() => {
      const s = window.aerovant.session;
      const me = s.local();
      const e = s.world.aircraft.find((a) => a.alive && a.team !== me.team);
      if (!me || !me.alive || !e) return null;
      let d = Math.atan2(e.y - me.y, e.x - me.x) - me.heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return { d, lock: me.lockState };
    });
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('ArrowRight');
    if (tgt) {
      // Only left/right: rotate toward the enemy.
      if (tgt.d > 0.08) await page.keyboard.down('ArrowRight');
      if (tgt.d < -0.08) await page.keyboard.down('ArrowLeft');
      await page.keyboard.down('Space');
      if (tgt.lock === 3) {
        if (!lockedShot) { await shot('08b-locked'); lockedShot = true; }
        await page.keyboard.press('KeyE');
      }
    }
    await wait(100);
    if (i === 40) await shot('08-combat');
    s = await state();
    if (s.kills >= 1) fought = true;
  }
  await page.keyboard.up('Space');
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('ArrowRight');
  s = await state();
  console.log('  after combat:', JSON.stringify(s));
  check(s.shots >= 3, `guns fired (${s.shots} shots, ${s.hits} hits)`);
  check(s.kills >= 1, 'destroyed the level-1 opponent');
  check(s.hits > 0 || s.missiles > 0, `weapons connected (${s.hits} cannon hits, ${s.missiles} missiles)`);
  await shot('09-after-combat');

  // Flares + ability via keyboard.
  await page.keyboard.press('KeyF');
  await page.keyboard.press('KeyQ');
  await wait(300);
  const def = await page.evaluate(() => {
    const me = window.aerovant.session.local();
    return { flares: me.flareCharges, max: me.def.flareCharges, abilityCd: me.abilityCooldown };
  });
  check(def.flares < def.max || !((await state()).alive), 'flares deployed');
  check(def.abilityCd > 0 || !((await state()).alive), 'ability activated');
  // On-screen FLARES button (mouse/touch).
  await wait(700); // flare re-deploy cooldown
  const before = await page.evaluate(() => window.aerovant.session.local().flareCharges);
  check(await page.isVisible('.flare-btn'), 'on-screen FLARES button visible in match');
  await page.click('.flare-btn');
  await wait(150);
  const after = await page.evaluate(() => window.aerovant.session.local().flareCharges);
  check(before === 0 || after === before - 1, `FLARES button deploys flares (${before} -> ${after})`);
  await shot('10-flares-ability');

  // Pause menu.
  await page.keyboard.press('Escape');
  await wait(400);
  check((await state()).screen === 'pause', 'pause menu opens with Esc');
  check(!(await page.isVisible('.flare-btn')), 'FLARES button hidden while paused');
  await shot('11-pause');
  await page.keyboard.press('Escape');
  await wait(300);
  check((await state()).screen === null, 'Esc resumes');

  // Die until out of lives (debug self-destruct) -> respawn -> game over -> results.
  // (The AI may already have shot us down during the fight, so count dynamically.)
  for (let life = 0; life < 5; life++) {
    s = await state();
    if (!s.alive) { await wait(3900); s = await state(); }
    if (!s.alive) break;
    const livesBefore = s.lives;
    await page.keyboard.press('F10');
    await wait(350);
    if (life === 0) await shot('12-destroyed');
    s = await state();
    check(!s.alive && s.lives === livesBefore - 1, `player destroyed (lives ${livesBefore} -> ${s.lives})`);
    if (s.lives === 0) break;
    await wait(3700);
    s = await state();
    check(s.alive, `player respawned (lives left ${s.lives})`);
  }
  await wait(3500);
  s = await state();
  check(s.appState === 'results' && s.screen === 'results', 'results screen after final death');
  await wait(600);
  await shot('13-results');

  await page.click('text=PLAY AGAIN');
  await wait(800);
  s = await state();
  check(s.appState === 'match' && s.phase === 'countdown' && s.alive, 'play again starts a fresh match');

  // Performance sample: 3 seconds of rendering.
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0; const t0 = performance.now();
    const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); };
    requestAnimationFrame(f);
  }));
  console.log(`  headless fps ~${Math.round(fps)} (software rendering)`);

  await page.keyboard.press('Escape');
  await wait(300);
  await page.click('text=QUIT TO MENU');
  await wait(500);
  check((await state()).screen === 'main', 'quit returns to main menu');
  await shot('14-back-to-menu');

  // Corrupted save must not crash.
  // Inject corruption before any game script runs (a normal reload would re-save good data on unload).
  const page2 = await page.context().newPage();
  page2.on('pageerror', (e) => errors.push(`pageerror(corrupt): ${e.message}`));
  await page2.addInitScript(() => {
    if (!sessionStorage.getItem('corrupted')) {
      localStorage.setItem('aerovant.save.v1', '{not json');
      sessionStorage.setItem('corrupted', '1');
    }
  });
  await page.close();
  await page2.goto(url);
  await page2.waitForTimeout(1000);
  check(await page2.evaluate(() => window.aerovant.ui.current === 'title'), 'boots with corrupted save');
  const backup = await page2.evaluate(() => localStorage.getItem('aerovant.save.v1.corrupt'));
  check(backup === '{not json', 'corrupted save backed up');

  if (errors.length) throw new Error(`Page errors:\n${errors.join('\n')}`);
  console.log('\nSMOKE TEST PASSED');
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error(errors.join('\n'));
  await shot('zz-failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
}
