# ריצה בעיר (City Run) – credits and licenses

This game is built from open-source parts. Each part's license is included in this folder.

| Part | Author | License | File |
|---|---|---|---|
| Game design and gameplay logic (lanes, jump, obstacle rows, collisions, difficulty) | [Boxy Run](https://github.com/wanfungchui/boxy-run) by Wan Fung Chui | Apache License 2.0 | `LICENSE-boxy-run.txt` |
| 3D engine | [three.js](https://threejs.org) r170 (`../shared/lib/`) | MIT | `../shared/lib/LICENSE-three.js.txt` |
| 3D models, textures and sound effects (character, coins, clouds, bricks, street, buildings, trees, trucks) | [Kenney](https://kenney.nl): Starter Kit 3D Platformer, Starter Kit City Builder, Starter Kit Racing | Assets: CC0 1.0 (public domain); kit code: MIT | `models/LICENSE-kenney-*.md` |

## Changes from the original Boxy Run (as required by Apache 2.0 §4b)

`game.js` is a modified version of Boxy Run's `js/game.js`. The changes:

- Ported from the old bundled three.js r91 to the current three.js module build.
- All of the original's box-and-cylinder graphics replaced with Kenney's 3D models: an animated character, a city street with buildings and trees, trucks, brick barriers, coins and clouds.
- Obstacles are now of two kinds: trucks you must dodge, and barriers you can jump over. Rows never block all three lanes.
- Added coins to collect, sound effects, a saved high score, and pause.
- Added trucks and trains that drive toward you (trains are drawn with simple three.js shapes), placed so
  that a reachable lane is always open; train and truck roofs you can land and run on.
- Jumping now uses gravity (instead of a fixed sine arc) so you can land on roofs.
- Added power-ups: super-jump shoes, coin magnet and double coins; and character skins bought in the
  library site's shop (`../shared/skins.js`, `../shared/powerups.js`).
- Coins are reported to the library site, which saves them to the player's account on the server.
- Movement is frame-rate independent, so the game runs at the same speed on 60 Hz and 144 Hz screens.
- Added touch/swipe controls for phones and tablets.
- Restarting no longer reloads the page.
- Hebrew interface.
