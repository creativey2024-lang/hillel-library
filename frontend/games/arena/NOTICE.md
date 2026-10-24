# קרב באי (Island Battle) – credits and licenses

An original battle-royale style game written for the library site. The code in
`js/` is new; it reuses only open assets with licenses that allow it.

| Part | Author | License | File |
|---|---|---|---|
| 3D engine | [three.js](https://threejs.org) r170 (`../shared/lib/`) | MIT | `../shared/lib/LICENSE-three.js.txt` |
| Characters, coins and clouds | [Kenney](https://kenney.nl): Starter Kit 3D Platformer (shared from `../jumper/models/`) | CC0 1.0 (public domain) | `../jumper/models/LICENSE-kenney-platformer.md` |
| Buildings | [Kenney](https://kenney.nl): City Builder Kit (shared from `../runner/models/city/`) | CC0 1.0 (public domain) | `../runner/models/LICENSE-kenney-city-builder.md` |
| Fountain | [Kenney](https://kenney.nl): City Builder Kit (`models/city/pavement-fountain.glb`) | CC0 1.0 (public domain) | `models/LICENSE-kenney-city-builder.md` |
| Trucks | [Kenney](https://kenney.nl): Starter Kit Racing (shared from `../runner/models/racing/`) | CC0 1.0 (public domain) | `../runner/models/LICENSE-kenney-racing.md` |
| Sound effects (shots, hits, weapon change, jump, landing, coin, elimination) | [Kenney](https://kenney.nl): [Starter Kit FPS](https://github.com/KenneyNL/Starter-Kit-FPS) | CC0 1.0 (public domain) | `sounds/LICENSE-kenney-fps-kit.md` |

Everything else is generated in code: the island terrain, sea and lake, trees,
rocks, bushes, flowers and grass, the houses you can walk into, fences, the fort,
the lighthouse, the farm, the docks, the radio tower, the camp, the weapons,
chests, loot, the glider, the storm and all the HUD graphics. The textures
(wood planks, bricks, plaster, roof tiles, metal, grass, water ripples) are
painted in code too (`js/textures.js`). The shotgun and sniper "boom"
sounds are synthesized with the Web Audio API.

No names, characters, artwork, sounds or logos from any commercial game are used;
the gameplay ideas (dropping from the sky with a glider, chests, rarity colors,
a shrinking storm, last one standing wins) are common genre conventions.
