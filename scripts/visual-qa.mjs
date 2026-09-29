/**
 * Visual QA: jumps through levels/bosses via the live game object and grabs
 * screenshots of each time-of-day palette, both bosses and a busy fight.
 *   node scripts/visual-qa.mjs     (screenshots in test-output/vqa-*.png)
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';

const OUT = 'test-output';
mkdirSync(OUT, { recursive: true });
const server = await createServer({ server: { port: 5198, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (ms) => page.waitForTimeout(ms);
try {
  await page.goto('http://127.0.0.1:5198/');
  await wait(1000);
  await page.keyboard.press('Enter');
  await wait(500);
  await page.click('text=PLAY');
  await wait(300);
  await page.click('text=TRAINING FLIGHT');
  await wait(4500);
  const jump = (level, stage) => page.evaluate(async ([level, stage]) => {
    const { applyDamage } = await import('/src/sim/systems/damage.ts');
    const s = window.aerovant.session;
    const w = s.world;
    const me = s.local();
    me.godMode = true;
    Object.assign(me, { x: w.map.width / 2, y: 900, px: w.map.width / 2, py: 900 });
    for (const a of w.aircraft) if (a.team !== me.team && a.alive) { a.godMode = false; a.spawnProtection = 0; applyDamage(w, a, 99999, me.id, 'debug'); }
    s.mode.startLevel(w, level);
    if (stage) { s.mode.stage = stage; s.mode.startStage(w); }
  }, [level, stage]);
  for (const lvl of [2, 3, 4, 5]) {
    await jump(lvl, 0);
    await wait(5000);
    await page.screenshot({ path: `${OUT}/vqa-level${lvl}.png` });
  }
  await jump(1, 2);
  await wait(6000);
  await page.screenshot({ path: `${OUT}/vqa-warden.png` });
  await jump(3, 2);
  await wait(4500);
  const nearBoss = () => page.evaluate(() => {
    const s = window.aerovant.session;
    const me = s.local();
    const b = s.world.aircraft.find((a) => a.def.boss && a.alive);
    if (!b) return false;
    const x = b.x - 700, y = b.y;
    Object.assign(me, { x, y, px: x, py: y, heading: 0, vx: 300, vy: 0 });
    return true;
  });
  await nearBoss();
  await wait(700);
  await page.screenshot({ path: `${OUT}/vqa-stormbreaker.png` });
  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 2000) r(n / 2); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log('fps', fps, 'aircraft', await page.evaluate(() => window.aerovant.session.world.aircraft.filter((a) => a.alive).length));
  // Kill the boss to see the destruction chain (let the camera settle first).
  await page.evaluate(() => {
    const s = window.aerovant.session; const me = s.local();
    const b = s.world.aircraft.find((a) => a.def.boss && a.alive);
    if (b) { s.world.brains.get(b.id).phase = 9; const x = me.x + 380, y = me.y; Object.assign(b, { x, y, px: x, py: y, heading: 0, godMode: false, spawnProtection: 0, health: 1 }); }
  });
  await page.keyboard.down('Space');
  await page.waitForFunction(() => !window.aerovant.session.world.aircraft.some((a) => a.def.boss && a.alive), null, { timeout: 5000 }).catch(() => console.log('boss survived'));
  await page.keyboard.up('Space');
  await wait(350);
  await page.screenshot({ path: `${OUT}/vqa-boss-death-a.png` });
  await wait(900);
  await page.screenshot({ path: `${OUT}/vqa-boss-death-b.png` });
  await page.evaluate(async () => {
    const { applyDamage } = await import('/src/sim/systems/damage.ts');
    const s = window.aerovant.session; const me = s.local();
    for (const a of s.world.aircraft) if (a.alive && a.team !== me.team) { a.godMode = false; a.spawnProtection = 0; applyDamage(s.world, a, 99999, me.id, 'debug'); }
  });
  await wait(2200);
  await page.screenshot({ path: `${OUT}/vqa-level-complete.png` });
  // Stress: level 12 (12 aircraft with missiles) plus a second wave arriving.
  await jump(12, 0);
  await wait(6000);
  const perf = await page.evaluate(() => new Promise((r) => {
    const g = window.aerovant; const times = []; let last = performance.now(); const t0 = last;
    const f = () => { const now = performance.now(); times.push(now - last); last = now; if (now - t0 > 3000) { times.sort((a, b) => a - b); r({ fps: times.length / 3, p95: times[Math.floor(times.length * 0.95)], sim: g.debug?.frameMs, aircraft: g.session.world.aircraft.filter((a) => a.alive).length, particles: g.renderer.particles.count, missiles: g.session.world.missiles.filter((m) => m.active).length }); } else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  console.log('stress', JSON.stringify(perf));
  await page.screenshot({ path: `${OUT}/vqa-stress.png` });
} finally {
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  await browser.close();
  await server.close();
}
