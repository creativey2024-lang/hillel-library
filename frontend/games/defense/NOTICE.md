# הגנה על הספרייה (Library Defense) – credits and licenses

An original co-op wave defense game written for the library site. The code in
`js/` is new; it shares code with the island game (`../arena/js`: characters,
guns, movement, effects, sounds, parties) and reuses only open assets with
licenses that allow it.

| Part | Author | License | File |
|---|---|---|---|
| 3D engine | [three.js](https://threejs.org) r170 (`../shared/lib/`) | MIT | `../shared/lib/LICENSE-three.js.txt` |
| Characters | [Kenney](https://kenney.nl): Starter Kit 3D Platformer (shared from `../jumper/models/`) | CC0 1.0 (public domain) | `../jumper/models/LICENSE-kenney-platformer.md` |
| Sound effects | [Kenney](https://kenney.nl): [Starter Kit FPS](https://github.com/KenneyNL/Starter-Kit-FPS) (shared from `../arena/sounds/`) | CC0 1.0 (public domain) | `../arena/sounds/LICENSE-kenney-fps-kit.md` |

Everything else is made in code: the library hall, the bookshelves and the
book spines painted on them, the marble dome, the carpets, the windows and
moonlight, the floating candles, the portals, the Golden Book and its shield,
all the monsters and their animations, the special weapons, the effects, and
the HUD. The textures are painted on canvases in `js/paint.js`.

No names, characters, artwork, sounds or logos from any commercial game are
used; the gameplay ideas (waves of monsters, defending an objective, buying
weapons between waves, reviving teammates) are common genre conventions.
