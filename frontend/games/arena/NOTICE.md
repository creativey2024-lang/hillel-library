# קרב באי (Island Battle) – credits and licenses

An original battle-royale style game written for the library site. The code in
`js/` is new; it reuses only open assets with licenses that allow it.

| Part | Author | License | File |
|---|---|---|---|
| 3D engine | [three.js](https://threejs.org) r170 (`../shared/lib/`) | MIT | `../shared/lib/LICENSE-three.js.txt` |
| Characters, coins and clouds | [Kenney](https://kenney.nl): Starter Kit 3D Platformer (shared from `../jumper/models/`) | CC0 1.0 (public domain) | `../jumper/models/LICENSE-kenney-platformer.md` |
| Buildings | [Kenney](https://kenney.nl): City Builder Kit (shared from `../runner/models/city/`) | CC0 1.0 (public domain) | `../runner/models/LICENSE-kenney-city-builder.md` |
| Sound effects (shots, hits, weapon change, jump, landing, coin, elimination) | [Kenney](https://kenney.nl): [Starter Kit FPS](https://github.com/KenneyNL/Starter-Kit-FPS) | CC0 1.0 (public domain) | `sounds/LICENSE-kenney-fps-kit.md` |

Everything else is generated in code: the island terrain, water, trees, rocks,
bushes, fences, the fort, the lighthouse, the farm, the weapons, chests, loot,
the glider, the storm and all the HUD graphics. The shotgun and sniper "boom"
sounds are synthesized with the Web Audio API.

No names, characters, artwork, sounds or logos from any commercial game are used;
the gameplay ideas (dropping from the sky with a glider, chests, rarity colors,
a shrinking storm, last one standing wins) are common genre conventions.
