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
| `npm run typecheck`| TypeScript only                                                  |

## Controls

| Action           | Keyboard            | Gamepad      |
| ---------------- | ------------------- | ------------ |
| Turn             | `←` `→` (or `A` `D`)| Left stick ←→|
| Fire cannons     | `Space` / `J`       | RT / A       |
| Launch missile   | `E` / `K`           | X            |
| Deploy flares    | `F` / `L`           | B / LB       |
| Afterburner      | `Shift` / `I`       | RB           |
| Air brake        | `C` / `U`           | LT           |
| Special ability  | `Q` / `O`           | Y            |
| Pause / back     | `Esc` / `P`         | Start        |

Flying needs only two buttons: `←` rotates the nose anticlockwise and `→` clockwise.
Hold one and the jet keeps turning, flying a full loop. Let go and it flies straight.
Keys can be remapped in **Settings → Controls**.

**Missiles:** without a lock, a missile flies straight and grabs the first enemy that
comes within range in front of it. Once it has a target it chases for up to 10 seconds;
if it hasn't hit by then it pops harmlessly and disappears. Flares (`F` or the on-screen
**FLARES** button) pull a chasing missile onto the decoys. These rules are covered by
`tests/missile-balance.test.ts`.

## Architecture

```
src/
  sim/            Pure TypeScript simulation. No DOM, no rendering, no timers.
    config/       Data-driven aircraft, weapons, abilities, maps
    systems/      flight, boundary, weapons (+lock-on), projectiles, damage, spawn
    ai/           Personality presets + finite-state AI brain
    modes/        GameMode interface, WaveMode (Endless Skies), AttractMode
    step.ts       stepWorld(): one fixed 60 Hz tick
    world.ts      World state + pooled bullets/missiles/flares
  client/
    session.ts    MatchSession interface (offline impl now, online impl later)
    game.ts       App state machine, main loop, rewards, error recovery
    input/        Action/binding abstraction, keyboard + gamepad → InputCommand
    render/       Camera, parallax background, aircraft art, particles, FX, HUD
    audio/        Web Audio synth SFX + layered procedural music
    ui/           DOM menus (title, main, play, hangar, profile, settings, results)
    save/         Validated, corruption-tolerant localStorage persistence
tests/            Vitest suites (flight, combat, missile balance, match soak)
scripts/          Browser smoke test
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
  `game.ts`. Online, the server will be the only source of rewards.

## Debug tools

These are on in dev builds, or in any build with `?debug` in the URL. They only work
offline and mutate the local world.

`F3` overlay (FPS, sim counts, AI states) · `F4` god mode · `F6` spawn enemy ·
`F7` destroy enemies · `F8` refill · `F9` restart · `F10` self-destruct

## Roadmap

1. ~~Architecture, flight, camera, guns, AI, missiles, damage, FX, HUD, waves, first map, offline loop~~ (this milestone)
2. Authoritative Node server (`ws`) running `src/sim`, snapshot protocol, interpolation, prediction and reconciliation, and a local multi-client test harness with latency and packet-loss simulation
3. Online Sky Duel (2–8 players), reconnect handling, matchmaking queue
4. Additional aircraft (Swift, Titan, Phantom, Nova) and their abilities
5. Maps: Tempest Zone, Iron Sky, Crimson Pass, Sunset Stratosphere
6. Team Battle, zone control, campaign and the Stormbreaker boss
