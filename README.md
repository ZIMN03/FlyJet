# AEROVANT — Arcade Sky Combat

An original 2D side-view fighter-jet combat game for the browser. It's built so the
same simulation can run on an authoritative multiplayer server later.

Everything is procedural and original: aircraft art, environments, UI, sound effects
and music are all generated in code. There are no third-party assets.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command            | What it does                                                    |
| ------------------ | --------------------------------------------------------------- |
| `npm run dev`      | Vite dev server (debug tools enabled)                           |
| `npm run build`    | Type-check + production build into `dist/`                      |
| `npm test`         | Simulation unit tests, missile balance and AI soak tests         |
| `npm run smoke`    | Headless-Chromium end-to-end playthrough with screenshots       |
| `node scripts/visual-qa.mjs` | Screenshots of every sky palette, both bosses and a boss kill |
| `npm run build:site` | Single-file build for GitHub Pages (`site/index.html`)         |
| `npm run typecheck`| TypeScript only                                                  |

## Controls

| Action           | Keyboard            | Gamepad      |
| ---------------- | ------------------- | ------------ |
| Turn             | `←` `→` (or `A` `D`)| Left stick ←→|
| Throttle         | `↑` `↓` (or `W` `S`)| Left stick ↑↓|
| Fire cannons     | `Space` / `J`       | RT / A       |
| Launch missile   | `E` / `K`           | X            |
| Deploy flares    | `F` / `L`           | B / LB       |
| Afterburner      | `Shift` / `I`       | RB           |
| Air brake        | `C` / `U`           | LT           |
| Special ability  | `Q` / `O`           | Y            |
| Pause / back     | `Esc` / `P`         | Start        |

Flying needs only two buttons: `←` rotates the nose anticlockwise and `→` clockwise.
Hold one and the jet keeps turning, flying a full loop. Let go and it flies straight.
`↑`/`↓` set the throttle, which stays where you leave it. Slower flight turns tighter.
Below stall speed the nose drops, but you can whip it around fast (a stall flip); dive or
throttle up to recover.
Keys can be remapped in **Settings → Controls**.

**Missiles:** without a lock, a missile flies straight and grabs the first enemy that
comes within range in front of it. Once it has a target it chases for up to 10 seconds;
if it hasn't hit by then it pops harmlessly and disappears. Flares (`F` or the on-screen
**FLARES** button) pull a chasing missile onto the decoys. These rules are covered by
`tests/missile-balance.test.ts`.

**Cannons** heat up while firing. Let the gauge run to OVERHEATED and they lock until it
cools to 35%. **Collisions** between aircraft are swept (no tunnelling at any frame
rate). They damage both jets, bounce them apart and give a short immunity so a single
scrape never hits twice.

**Levels:** each level of Endless Skies is a short sortie. First comes a wave of N
opponents (N = the level number), then a second wave of N+1, then a boss. The first
levels are gentle: fragile trainee pilots with no missiles, and the level-1 boss (the
Warden) fights with guns only. Toughness, aim, speed, tactics and the enemy mix (light
fighters, heavy fighters, interceptors, missile carriers) ramp up until level 10 (see
`levelDifficulty()` in `src/sim/modes/waves.ts`). Every third level ends with the
**Stormbreaker**. It has four phases, shields on phase changes, missile salvos, escort
drones and a critical final phase. Clearing a stage patches your hull and restocks
missiles; hostile missiles still in the air self-destruct. A new level fully repairs you.
The sky moves through five times of day as you progress.

**Weapon power:** your weapons grow with the level you reach in a run. Each new level
adds +12% cannon damage, +10% missile damage and +2.5% fire rate, up to level 15. Faster
fire never makes the cannons overheat sooner. At levels 4, 7 and 10 the weapons step up
a mark (Mk II, III, IV) with bolder tracers (teal, gold, violet). The HUD shows the mark
next to the gun name, and a notice lists the new bonuses. Tuning is in
`src/sim/config/weaponPower.ts`.

**Rewards and the hangar:** kills (gun, missile or ramming), assists, missile hits,
missiles evaded, waves cleared, bosses defeated, levels completed and time survived all
earn score, XP and credits. The results screen itemises them. Credits buy per-aircraft
upgrades (engine, airframe, cannons, missile rack, afterburner; three tiers each) and
paint schemes. Everything is saved locally. Reaching a level unlocks aircraft: Swift (3),
Titan (5), Phantom (7), Nova (10). Every plane can be inspected in the Hangar, locked or
not. The Hangar shows SPEED, TURN, ARMOR, WEAPONS, BOOST and MISSILES including owned
upgrades.

## Architecture

```
src/
  sim/            Pure TypeScript simulation. No DOM, no rendering, no timers.
    config/       Data-driven aircraft, weapons, abilities, upgrades, maps, flight tuning
    systems/      flight, collision, boundary, weapons (+lock-on, heat), projectiles, damage, spawn
    ai/           Personality presets, dogfighting FSM brain, multi-phase boss brain
    modes/        GameMode interface, WaveMode (Endless Skies levels), AttractMode
    step.ts       stepWorld(): one fixed 60 Hz tick
    world.ts      World state + pooled bullets/missiles/flares
  client/
    session.ts    MatchSession interface (offline impl now, online impl later)
    game.ts       App state machine, main loop, error recovery
    rewards.ts    Itemised XP/credit ledger built from sim events
    input/        Action/binding abstraction, keyboard + gamepad → InputCommand
    render/       Camera, parallax background, aircraft art, particles, FX, HUD
    audio/        Web Audio synth SFX + layered procedural music
    ui/           DOM menus (title, main, play, hangar, profile, settings, results)
    save/         Validated, corruption-tolerant localStorage persistence
tests/            Vitest suites (flight, 360° turning at 30–144 fps, collisions, combat,
                  missile balance, levels/bosses, upgrades, match soak)
scripts/          Browser smoke test, visual QA, single-file site build
```

### Why it is built this way (multiplayer readiness)

- **Input-only controllers.** Humans and AI both produce an `InputCommand`
  (steer vector + button bitmask + sequence number). The sim derives everything else,
  including damage, cooldowns, ammo, hits and score. A server only needs to receive
  commands, `sanitizeCommand()` them and run `stepWorld()`.
- **Fixed tick, seeded RNG.** Gameplay never depends on frame rate or `Math.random`.
  The client renders between ticks using stored previous transforms.
- **Events, not callbacks.** The sim emits `SimEvent`s (hits, kills, launches, …).
  The client turns them into particles, sound and HUD feedback, so cosmetic effects
  never touch gameplay state.
- **`MatchSession` seam.** The rest of the client only talks to a `MatchSession`.
  The planned online session will send commands, apply server snapshots, predict and
  reconcile the local aircraft, and interpolate remote ones. Menus, HUD, FX and audio
  won't need to change.
- **Server-owned progression later.** Offline XP and credits are computed locally in
  `rewards.ts`. Online, the server will be the only source of rewards.

## Debug tools

These are on in dev builds, or in any build with `?debug` in the URL. They only work
offline and mutate the local world.

`F3` overlay (FPS, sim counts, AI states) · `F4` god mode · `F6` spawn enemy ·
`F7` destroy enemies · `F8` refill · `F9` restart · `F10` self-destruct

## Roadmap

1. ~~Architecture, flight, camera, guns, AI, missiles, damage, FX, HUD, waves, first map, offline loop~~
1b. ~~Level sequences, enemy archetypes, Warden and Stormbreaker bosses, upgrades, paints, reward ledger, sky palettes~~
2. Authoritative Node server (`ws`) running `src/sim`, snapshot protocol, interpolation, prediction and reconciliation, and a local multi-client test harness with latency and packet-loss simulation
3. Online Sky Duel (2–8 players), reconnect handling, matchmaking queue
5. Maps: Tempest Zone, Iron Sky, Crimson Pass, Sunset Stratosphere
6. Team Battle, zone control, campaign
