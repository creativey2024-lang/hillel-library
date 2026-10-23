# קפיצה בשמיים (Sky Hop) – credits and licenses

This game is built from open-source parts. Each part's license is included in this folder.

| Part | Author | License | File |
|---|---|---|---|
| Gameplay logic (running speed and acceleration, variable-height jump, fast drop, obstacle sizes and gaps) | [T-Rex Runner](https://github.com/wayou/t-rex-runner) – the Chrome dinosaur game by The Chromium Authors | BSD 3-Clause / Chromium BSD-style | `LICENSE-t-rex-runner.txt` |
| 3D engine | [three.js](https://threejs.org) r170 (`../shared/lib/`) | MIT | `../shared/lib/LICENSE-three.js.txt` |
| 3D models, sky texture and sound effects (character, platforms, bricks, coins, ? block, clouds, grass, flags) | [Kenney](https://kenney.nl): [Starter Kit 3D Platformer](https://github.com/KenneyNL/Starter-Kit-3D-Platformer) | Assets: CC0 1.0 (public domain); kit code: MIT | `models/LICENSE-kenney-platformer.md` |

## Changes from the original T-Rex Runner

`game.js` re-implements the T-Rex Runner game rules (its speed, acceleration,
jump, gap and obstacle-grouping constants are kept, converted from pixels per
frame to world units per second). The changes:

- Rebuilt in 3D with three.js instead of a 2D canvas with sprites.
- All graphics and sounds replaced with Kenney's CC0 platformer kit: an
  animated character running over floating platforms in a sky of clouds.
- Obstacles are brick stacks of different widths and heights (instead of cacti)
  and pits between platforms; the flying pterodactyl was left out.
- Added coins to collect, bonus "?" blocks that give coins when hit from
  below, dust and brick-break effects, and a camera that zooms out as the game
  speeds up.
- Added springboards that launch you high into a trail of coins, power-ups (double jump, shield, coin
  magnet, double coins, jetpack) and character skins bought in the library site's shop.
- Added floating ledges and wide chasms crossed on stepping stones (red ones fall after you step on
  them), coin patterns, combos, and worlds that change from day to sunset to night.
- Coins are reported to the library site, which saves them to the player's account on the server.
- Time-based physics in small fixed steps, so the game plays the same at any
  frame rate.
- Touch controls, a Hebrew interface, a saved high score, pause, and restarting
  without reloading the page.
