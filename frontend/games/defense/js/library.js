/**
 * The Great Library at night: a domed hall of marble in the middle (with the
 * Golden Book on its pedestal), four wide avenues with red carpets out to the
 * four monster portals, and around them rows and rows of tall bookshelves,
 * reading corners, stacks of books to climb, floating candles and moonlit
 * windows. Everything is built in code from simple shapes and painted
 * textures (js/paint.js).
 *
 * Also here: collisions (the same interface the island game's movement code
 * uses: supportHeight / pushOut / raycast / lineOfSight), and a walking grid
 * for the monsters (a "flow field": from every spot, which way is closer to
 * the book or to a player).
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../shared/lib/utils/BufferGeometryUtils.js';
import {
    makeRand, shelfTexture, floorTexture, marbleTexture, stoneTexture, carpetTexture, windowTexture,
    bannerTexture, runeTexture, glowTexture, shaftTexture, skyTexture, pageTexture,
} from './paint.js';

export const HALF = 66;            // the hall goes from -66 to 66 on x and z
const WALL_H = 14;
const ROTUNDA_R = 17;
const AVENUE_W = 5.5;               // half width of the avenues
const CELL = 1;                     // walking grid: 1 m squares
const N = (HALF * 2) / CELL;
const GRID = 4;                     // collision lookup squares

export const BOOK_POS = new THREE.Vector3(0, 0, 0);
export const BOOK_RADIUS = 2.2;     // monsters attack the book from about here

// where monsters come in: one portal at the end of each avenue
export const PORTALS = [
    { x: 0, z: 60, name: 'צפון' },
    { x: 60, z: 0, name: 'מזרח' },
    { x: 0, z: -60, name: 'דרום' },
    { x: -60, z: 0, name: 'מערב' },
];

// shops inside the dome (E to use them, paid with this match's points)
export const STATIONS = [
    { id: 'crate', x: 9.5, z: 9.5, name: 'תיבת נשק', price: 450, color: 0x60a5fa, desc: 'נשק אקראי' },
    { id: 'gold', x: -9.5, z: 9.5, name: 'תיבת זהב', price: 1400, color: 0xfacc15, desc: 'נשק אפי / אגדי / מיוחד' },
    { id: 'ammo', x: 9.5, z: -9.5, name: 'תחמושת', price: 180, color: 0x4ade80, desc: 'מילוי תחמושת ורימונים' },
    { id: 'heal', x: -9.5, z: -9.5, name: 'מעיין ריפוי', price: 220, color: 0xf472b6, desc: 'חיים ומגן מלאים' },
    { id: 'book', x: 0, z: -4.2, name: 'חיזוק הספר', price: 900, color: 0xfbbf24, desc: '+250 לחיי הספר' },
];

export const PLAYER_SPAWNS = [[0, 12], [3, 12], [-3, 12], [0, 14.5]];

export function createLibrary(scene, { quality = 1 } = {}) {
    const rand = makeRand(20241101);
    const colliders = [];
    const buckets = new Map();
    const animated = [];       // { update(t, dt) }
    const ground = new THREE.Group();
    scene.add(ground);

    // ------------------------------------------------------------------ collisions
    function bucketKey(i, j) {
        return i * 1000 + j;
    }
    function addCollider(c) {
        colliders.push(c);
        const minX = c.type === 'box' ? c.minX : c.x - c.r;
        const maxX = c.type === 'box' ? c.maxX : c.x + c.r;
        const minZ = c.type === 'box' ? c.minZ : c.z - c.r;
        const maxZ = c.type === 'box' ? c.maxZ : c.z + c.r;
        for (let i = Math.floor((minX + HALF) / GRID); i <= Math.floor((maxX + HALF) / GRID); i++) {
            for (let j = Math.floor((minZ + HALF) / GRID); j <= Math.floor((maxZ + HALF) / GRID); j++) {
                const k = bucketKey(i, j);
                if (!buckets.has(k)) buckets.set(k, []);
                buckets.get(k).push(c);
            }
        }
        return c;
    }
    const box = (minX, maxX, minZ, maxZ, minY, maxY, walk = false) => addCollider({ type: 'box', minX, maxX, minZ, maxZ, minY, maxY, walk });
    const cyl = (x, z, r, y0, y1, walk = false) => addCollider({ type: 'cyl', x, z, r, y0, y1, walk });

    const near = (() => {
        const out = [];
        const seen = new Set();
        return (x, z, r) => {
            out.length = 0;
            seen.clear();
            for (let i = Math.floor((x - r + HALF) / GRID); i <= Math.floor((x + r + HALF) / GRID); i++) {
                for (let j = Math.floor((z - r + HALF) / GRID); j <= Math.floor((z + r + HALF) / GRID); j++) {
                    const list = buckets.get(bucketKey(i, j));
                    if (!list) continue;
                    for (const c of list) {
                        if (!seen.has(c)) {
                            seen.add(c);
                            out.push(c);
                        }
                    }
                }
            }
            return out;
        };
    })();

    function terrainHeight() {
        return 0;
    }

    function supportHeight(x, z, feetY, radius = 0.4, stepUp = 0.55) {
        let h = 0;
        for (const c of near(x, z, radius + 0.5)) {
            if (!c.walk) continue;
            if (c.type === 'box') {
                if (x + radius * 0.6 > c.minX && x - radius * 0.6 < c.maxX && z + radius * 0.6 > c.minZ && z - radius * 0.6 < c.maxZ) {
                    if (c.maxY <= feetY + stepUp && c.maxY > h) h = c.maxY;
                }
            } else if (Math.hypot(x - c.x, z - c.z) < c.r && c.y1 <= feetY + stepUp && c.y1 > h) h = c.y1;
        }
        return h;
    }

    function pushOut(pos, radius, height, stepUp = 0.55) {
        let bumped = false;
        for (const c of near(pos.x, pos.z, radius + 0.5)) {
            const top = c.type === 'box' ? c.maxY : c.y1;
            const bottom = c.type === 'box' ? c.minY : c.y0;
            if (pos.y >= top - stepUp || pos.y + height <= bottom) continue;
            if (c.type === 'box') {
                const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
                const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
                let dx = pos.x - cx;
                let dz = pos.z - cz;
                const d2 = dx * dx + dz * dz;
                if (d2 >= radius * radius) continue;
                if (d2 < 1e-8) {
                    const pushes = [pos.x - c.minX + radius, c.maxX - pos.x + radius, pos.z - c.minZ + radius, c.maxZ - pos.z + radius];
                    const m = Math.min(...pushes);
                    if (m === pushes[0]) pos.x = c.minX - radius;
                    else if (m === pushes[1]) pos.x = c.maxX + radius;
                    else if (m === pushes[2]) pos.z = c.minZ - radius;
                    else pos.z = c.maxZ + radius;
                } else {
                    const d = Math.sqrt(d2);
                    dx /= d;
                    dz /= d;
                    pos.x = cx + dx * radius;
                    pos.z = cz + dz * radius;
                }
                bumped = true;
            } else {
                let dx = pos.x - c.x;
                let dz = pos.z - c.z;
                const d = Math.hypot(dx, dz);
                const min = c.r + radius;
                if (d >= min) continue;
                if (d < 1e-6) {
                    dx = 1;
                    dz = 0;
                } else {
                    dx /= d;
                    dz /= d;
                }
                pos.x = c.x + dx * min;
                pos.z = c.z + dz * min;
                bumped = true;
            }
        }
        // the outer walls
        const lim = HALF - 1 - radius;
        if (pos.x > lim) pos.x = lim;
        if (pos.x < -lim) pos.x = -lim;
        if (pos.z > lim) pos.z = lim;
        if (pos.z < -lim) pos.z = -lim;
        return bumped;
    }

    function rayBox(o, d, c) {
        let tmin = 0;
        let tmax = Infinity;
        for (const [oo, dd, lo, hi] of [[o.x, d.x, c.minX, c.maxX], [o.y, d.y, c.minY, c.maxY], [o.z, d.z, c.minZ, c.maxZ]]) {
            if (Math.abs(dd) < 1e-9) {
                if (oo < lo || oo > hi) return Infinity;
            } else {
                let t1 = (lo - oo) / dd;
                let t2 = (hi - oo) / dd;
                if (t1 > t2) [t1, t2] = [t2, t1];
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return Infinity;
            }
        }
        return tmin;
    }
    function rayCyl(o, d, c) {
        const ox = o.x - c.x;
        const oz = o.z - c.z;
        const a = d.x * d.x + d.z * d.z;
        if (a < 1e-9) return Infinity;
        const b = 2 * (ox * d.x + oz * d.z);
        const cc = ox * ox + oz * oz - c.r * c.r;
        const disc = b * b - 4 * a * cc;
        if (disc < 0) return Infinity;
        const s = Math.sqrt(disc);
        let t = (-b - s) / (2 * a);
        if (t < 0) t = (-b + s) / (2 * a);
        if (t < 0) return Infinity;
        const y = o.y + d.y * t;
        if (y < c.y0 || y > c.y1) {
            // maybe the top cap
            if (Math.abs(d.y) > 1e-6) {
                const tt = (c.y1 - o.y) / d.y;
                if (tt > 0 && Math.hypot(o.x + d.x * tt - c.x, o.z + d.z * tt - c.z) <= c.r) return tt;
            }
            return Infinity;
        }
        return Math.max(0, t);
    }
    const rayCells = [];
    const raySeen = new Set();
    function raycast(o, d, maxDist) {
        let best = maxDist;
        // the floor and the outer walls first: then only the stretch before them is searched
        if (d.y < -1e-6) {
            const t = -o.y / d.y;
            if (t >= 0 && t < best) best = t;
        }
        if (Math.abs(d.x) > 1e-6) {
            const t = ((d.x > 0 ? HALF : -HALF) - o.x) / d.x;
            if (t >= 0 && t < best) best = t;
        }
        if (Math.abs(d.z) > 1e-6) {
            const t = ((d.z > 0 ? HALF : -HALF) - o.z) / d.z;
            if (t >= 0 && t < best) best = t;
        }
        rayCells.length = 0;
        raySeen.clear();
        const step = GRID;
        const len = best;
        for (let s = 0; s <= len + step; s += step) {
            const t = Math.min(s, len);
            for (const c of near(o.x + d.x * t, o.z + d.z * t, step * 0.75)) {
                if (!raySeen.has(c)) {
                    raySeen.add(c);
                    rayCells.push(c);
                }
            }
        }
        for (const c of rayCells) {
            const hit = c.type === 'box' ? rayBox(o, d, c) : rayCyl(o, d, c);
            if (hit < best) best = hit;
        }
        return best;
    }
    const losDir = new THREE.Vector3();
    function lineOfSight(a, b) {
        losDir.subVectors(b, a);
        const dist = losDir.length();
        if (dist < 0.01) return true;
        losDir.divideScalar(dist);
        return raycast(a, losDir, dist) >= dist - 0.4;
    }

    // ------------------------------------------------------------------ materials
    const M = {
        floor: new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.45, metalness: 0.05 }),
        marble: new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.25, metalness: 0.05 }),
        stone: new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9 }),
        wood: new THREE.MeshStandardMaterial({ color: 0x5b3a1f, roughness: 0.6 }),
        darkWood: new THREE.MeshStandardMaterial({ color: 0x3a2312, roughness: 0.7 }),
        gold: new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.25, metalness: 0.9, emissive: 0x3a2400, emissiveIntensity: 0.6 }),
        carpet: new THREE.MeshStandardMaterial({ map: carpetTexture(), roughness: 0.95 }),
        pillar: new THREE.MeshStandardMaterial({ color: 0xe8e1d3, map: marbleTexture(), roughness: 0.3 }),
        green: new THREE.MeshStandardMaterial({ color: 0x14532d, roughness: 0.5, emissive: 0x052e16, emissiveIntensity: 0.4 }),
        shelf: [0, 1, 2].map((v) => new THREE.MeshStandardMaterial({ map: shelfTexture(v), roughness: 0.75 })),
        lamp: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    };

    // geometry gathered per material, merged into one mesh each at the end
    const parts = new Map();
    function put(geo, mat) {
        if (!parts.has(mat)) parts.set(mat, []);
        parts.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
    }
    // a box (world placed) with UVs in metres
    function boxGeo(w, h, d, x, y, z, uvScale = 2, rotY = 0) {
        const g = new THREE.BoxGeometry(w, h, d);
        if (rotY) g.rotateY(rotY);
        g.translate(x, y, z);
        return worldUV(g, uvScale);
    }

    // ------------------------------------------------------------------ floor and sky
    {
        const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2);
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 22, uv.getY(i) * 22);
        const floor = new THREE.Mesh(g, M.floor);
        floor.receiveShadow = true;
        ground.add(floor);
        // the marble floor of the dome, with a gold ring
        const mg = new THREE.CircleGeometry(ROTUNDA_R + 1.5, 64).rotateX(-Math.PI / 2);
        const muv = mg.attributes.uv;
        for (let i = 0; i < muv.count; i++) muv.setXY(i, muv.getX(i) * 14, muv.getY(i) * 14);
        mg.translate(0, 0.012, 0);
        const marble = new THREE.Mesh(mg, M.marble);
        marble.receiveShadow = true;
        ground.add(marble);
        const ring = new THREE.Mesh(new THREE.RingGeometry(ROTUNDA_R + 1.1, ROTUNDA_R + 1.5, 64).rotateX(-Math.PI / 2).translate(0, 0.02, 0), M.gold);
        ground.add(ring);
        // carpets down the avenues
        PORTALS.forEach((p) => {
            const len = HALF - ROTUNDA_R - 4;
            const cg = new THREE.PlaneGeometry(4.6, len).rotateX(-Math.PI / 2);
            const cuv = cg.attributes.uv;
            for (let i = 0; i < cuv.count; i++) cuv.setXY(i, cuv.getX(i), cuv.getY(i) * (len / 9));
            const ang = Math.atan2(p.x, p.z);
            cg.rotateY(ang);
            const mid = ROTUNDA_R + 1.5 + len / 2;
            cg.translate(Math.sin(ang) * mid, 0.02, Math.cos(ang) * mid);
            const carpet = new THREE.Mesh(cg, M.carpet);
            carpet.receiveShadow = true;
            ground.add(carpet);
        });

        // the sky dome with stars and a moon
        const sky = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }));
        sky.renderOrder = -2;
        scene.add(sky);
        const starGeo = new THREE.BufferGeometry();
        const sp = [];
        for (let i = 0; i < 900; i++) {
            const a = rand() * Math.PI * 2;
            const e = 0.12 + rand() * 1.3;
            sp.push(Math.cos(a) * Math.cos(e) * 400, Math.sin(e) * 400, Math.sin(a) * Math.cos(e) * 400);
        }
        starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
        const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 }));
        scene.add(stars);
        const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xdbeafe, fog: false, depthWrite: false }));
        moon.position.set(-160, 230, -260);
        moon.scale.setScalar(90);
        scene.add(moon);
        const moonCore = new THREE.Mesh(new THREE.CircleGeometry(14, 32), new THREE.MeshBasicMaterial({ color: 0xf1f5ff, fog: false }));
        moonCore.position.copy(moon.position);
        moonCore.lookAt(0, 0, 0);
        scene.add(moonCore);
    }

    // ------------------------------------------------------------------ outer walls with windows
    {
        const T = 2;
        put(boxGeo(HALF * 2 + T * 2, WALL_H, T, 0, WALL_H / 2, HALF + T / 2, 4), M.stone);
        put(boxGeo(HALF * 2 + T * 2, WALL_H, T, 0, WALL_H / 2, -HALF - T / 2, 4), M.stone);
        put(boxGeo(T, WALL_H, HALF * 2, HALF + T / 2, WALL_H / 2, 0, 4), M.stone);
        put(boxGeo(T, WALL_H, HALF * 2, -HALF - T / 2, WALL_H / 2, 0, 4), M.stone);
        // a stone trim along the top
        put(boxGeo(HALF * 2 + 6, 0.8, 3, 0, WALL_H + 0.4, HALF + 1), M.stone);
        put(boxGeo(HALF * 2 + 6, 0.8, 3, 0, WALL_H + 0.4, -HALF - 1), M.stone);
        put(boxGeo(3, 0.8, HALF * 2 + 6, HALF + 1, WALL_H + 0.4, 0), M.stone);
        put(boxGeo(3, 0.8, HALF * 2 + 6, -HALF - 1, WALL_H + 0.4, 0), M.stone);
        // windows: glowing arched panes with moonlight falling in
        const winMat = new THREE.MeshBasicMaterial({ map: windowTexture(), transparent: true, fog: false });
        const shaftMat = new THREE.MeshBasicMaterial({ map: shaftTexture(), color: 0x9ec5ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const winGeo = new THREE.PlaneGeometry(3, 7.5);
        const shaftGeo = new THREE.PlaneGeometry(3.2, 14);
        const sides = [
            { axis: 'z', at: HALF - 0.02, face: Math.PI },
            { axis: 'z', at: -HALF + 0.02, face: 0 },
            { axis: 'x', at: HALF - 0.02, face: -Math.PI / 2 },
            { axis: 'x', at: -HALF + 0.02, face: Math.PI / 2 },
        ];
        const winParts = [];
        const shaftParts = [];
        sides.forEach((s) => {
            for (let k = -HALF + 9; k <= HALF - 9; k += 9) {
                if (Math.abs(k) < 11) continue; // the portal is here
                const x = s.axis === 'z' ? k : s.at;
                const z = s.axis === 'z' ? s.at : k;
                winParts.push(winGeo.clone().rotateY(s.face).translate(x, 7.2, z));
                if (quality > 0.5 && (k / 9) % 2 === 0) {
                    const inward = new THREE.Vector3(s.axis === 'x' ? -Math.sign(s.at) : 0, 0, s.axis === 'z' ? -Math.sign(s.at) : 0);
                    shaftParts.push(shaftGeo.clone().rotateX(-0.62).rotateY(s.face).translate(x + inward.x * 4.5, 4.2, z + inward.z * 4.5));
                }
            }
        });
        ground.add(new THREE.Mesh(mergeGeometries(winParts, false), winMat));
        if (shaftParts.length) {
            const shafts = new THREE.Mesh(mergeGeometries(shaftParts, false), shaftMat);
            shafts.renderOrder = 5;
            ground.add(shafts);
        }
        // banners between the windows
        const banners = ['#7c1d2a', '#1e3a8a', '#14532d', '#581c87'];
        const bannerGeo = new THREE.PlaneGeometry(2, 5);
        sides.forEach((s, si) => {
            const list = [];
            for (let k = -HALF + 13.5; k <= HALF - 13.5; k += 18) {
                if (Math.abs(k) < 11) continue;
                list.push(bannerGeo.clone().rotateY(s.face).translate(s.axis === 'z' ? k : s.at * 0.997, 9.5, s.axis === 'z' ? s.at * 0.997 : k));
            }
            ground.add(new THREE.Mesh(mergeGeometries(list, false), new THREE.MeshStandardMaterial({ map: bannerTexture(banners[si]), transparent: true, side: THREE.DoubleSide, roughness: 0.9 })));
        });
    }

    // ------------------------------------------------------------------ the dome: pillars, ribs, steps
    {
        const pillars = 14;
        for (let i = 0; i < pillars; i++) {
            const a = (i / pillars) * Math.PI * 2 + Math.PI / pillars;
            const x = Math.sin(a) * ROTUNDA_R;
            const z = Math.cos(a) * ROTUNDA_R;
            // keep the avenues open
            const shaft = new THREE.CylinderGeometry(0.75, 0.85, 11, 16).translate(x, 6.1, z);
            put(worldUV(shaft, 3), M.pillar);
            put(boxGeo(2.1, 0.6, 2.1, x, 0.3, z), M.pillar);
            put(boxGeo(2.0, 0.5, 2.0, x, 11.85, z), M.gold);
            cyl(x, z, 0.85, 0, 12.2);
        }
        // a ring beam on top of the pillars and gold ribs up to a crown
        const ring = new THREE.TorusGeometry(ROTUNDA_R, 0.45, 8, 72).rotateX(Math.PI / 2).translate(0, 12.3, 0);
        put(ring, M.gold);
        const ribs = 14;
        for (let i = 0; i < ribs; i++) {
            const a = (i / ribs) * Math.PI * 2 + Math.PI / ribs;
            const pts = [];
            for (let k = 0; k <= 16; k++) {
                const t = (k / 16) * (Math.PI / 2) * 0.92;
                const r = Math.cos(t) * ROTUNDA_R;
                pts.push(new THREE.Vector3(Math.sin(a) * r, 12.3 + Math.sin(t) * 13, Math.cos(a) * r));
            }
            put(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.22, 6), M.gold);
        }
        put(new THREE.TorusGeometry(2.3, 0.35, 8, 32).rotateX(Math.PI / 2).translate(0, 25.2, 0), M.gold);
        // a faint glass dome
        const glass = new THREE.Mesh(
            new THREE.SphereGeometry(ROTUNDA_R, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 13 / ROTUNDA_R, 1).translate(0, 12.3, 0),
            new THREE.MeshStandardMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.4, side: THREE.DoubleSide, depthWrite: false }),
        );
        ground.add(glass);

        // two marble steps around the pedestal
        const step1 = new THREE.CylinderGeometry(7, 7.2, 0.35, 48).translate(0, 0.175, 0);
        const step2 = new THREE.CylinderGeometry(4.6, 4.8, 0.35, 48).translate(0, 0.525, 0);
        [step1, step2].forEach((g) => {
            const uv = g.attributes.uv;
            for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 4, uv.getY(i));
            put(g, M.marble);
        });
        put(new THREE.TorusGeometry(7.05, 0.06, 6, 64).rotateX(Math.PI / 2).translate(0, 0.36, 0), M.gold);
        put(new THREE.TorusGeometry(4.65, 0.06, 6, 64).rotateX(Math.PI / 2).translate(0, 0.71, 0), M.gold);
        cyl(0, 0, 7.1, 0, 0.35, true);
        cyl(0, 0, 4.7, 0, 0.7, true);
        // the pedestal
        put(new THREE.CylinderGeometry(1.05, 1.35, 1.3, 24).translate(0, 1.35, 0), M.pillar);
        put(new THREE.CylinderGeometry(1.4, 1.4, 0.18, 24).translate(0, 2.05, 0), M.gold);
        cyl(0, 0, 1.45, 0, 2.15);
    }

    // ------------------------------------------------------------------ shelves
    const shelfSpots = [];
    {
        const H = 4.4;
        const D = 1.1;
        const L = 8;
        // rows of shelves in the four corners of the hall, leaving the avenues free
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                let row = 0;
                for (let z = 23; z <= 60; z += 5.5, row++) {
                    let col = 0;
                    for (let x = 12.5; x <= 58; x += L + 3.5, col++) {
                        const cx = sx * (x + L / 2);
                        const cz = sz * z;
                        // keep the dome clear, and leave a few gaps to cut across
                        if (Math.hypot(cx, cz) < ROTUNDA_R + 7) continue;
                        if ((row === 3 && col === 1) || (row === 5 && col === 2)) continue;
                        // the corners nearest the dome are reading rooms
                        if (row <= 1 && col === 0) continue;
                        shelfSpots.push({ cx, cz, along: 'x', L, D, H, v: Math.floor(rand() * 3) });
                    }
                }
                // shelves along the avenue sides (facing the carpet), with gaps
                for (let a = ROTUNDA_R + 8; a <= 58; a += 10.5) {
                    shelfSpots.push({ cx: sx * (AVENUE_W + 1.6), cz: sz * a, along: 'z', L: 6.5, D, H: 3.4, v: Math.floor(rand() * 3) });
                    shelfSpots.push({ cx: sz * a, cz: sx * (AVENUE_W + 1.6), along: 'x', L: 6.5, D, H: 3.4, v: Math.floor(rand() * 3) });
                }
            }
        }
        // dedupe the avenue side shelves (each was made twice)
        const seen = new Set();
        const spots = shelfSpots.filter((s) => {
            const k = `${s.cx.toFixed(1)},${s.cz.toFixed(1)}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        });
        shelfSpots.length = 0;
        shelfSpots.push(...spots);
        for (const s of shelfSpots) {
            const w = s.along === 'x' ? s.L : s.D;
            const d = s.along === 'x' ? s.D : s.L;
            // the frame (wood) and two painted fronts
            put(boxGeo(w + 0.12, 0.25, d + 0.12, s.cx, s.H + 0.12, s.cz), M.darkWood);
            put(boxGeo(w, 0.2, d, s.cx, 0.1, s.cz), M.darkWood);
            const front = new THREE.PlaneGeometry(s.L, s.H - 0.2);
            const uv = front.attributes.uv;
            const reps = Math.max(1, Math.round(s.L / 3.6));
            for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * reps);
            for (const side of [-1, 1]) {
                const f = front.clone();
                if (s.along === 'x') {
                    if (side < 0) f.rotateY(Math.PI);
                    f.translate(s.cx, s.H / 2 + 0.05, s.cz + side * (s.D / 2 + 0.005));
                } else {
                    f.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
                    f.translate(s.cx + side * (s.D / 2 + 0.005), s.H / 2 + 0.05, s.cz);
                }
                put(f, M.shelf[s.v]);
            }
            // the ends
            for (const side of [-1, 1]) {
                if (s.along === 'x') put(boxGeo(0.12, s.H, s.D + 0.06, s.cx + side * (s.L / 2), s.H / 2, s.cz), M.wood);
                else put(boxGeo(s.D + 0.06, s.H, 0.12, s.cx, s.H / 2, s.cz + side * (s.L / 2)), M.wood);
            }
            box(s.cx - w / 2, s.cx + w / 2, s.cz - d / 2, s.cz + d / 2, 0, s.H + 0.25, true);
        }
    }

    // ------------------------------------------------------------------ reading rooms, book stacks, ladders
    const lampPoints = [];
    {
        const tableTop = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.4 });
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                for (const [tx, tz] of [[17, 25], [17, 31.5], [24.5, 28]]) {
                    const x = sx * tx;
                    const z = sz * tz;
                    if (Math.hypot(x, z) < ROTUNDA_R + 6) continue;
                    put(boxGeo(4.2, 0.12, 1.8, x, 0.86, z), tableTop);
                    for (const lx of [-1.8, 1.8]) for (const lz of [-0.7, 0.7]) put(boxGeo(0.14, 0.8, 0.14, x + lx, 0.4, z + lz), M.darkWood);
                    box(x - 2.1, x + 2.1, z - 0.9, z + 0.9, 0, 0.92, true);
                    // green banker's lamps
                    for (const lx of [-1, 1]) {
                        put(boxGeo(0.08, 0.32, 0.08, x + lx, 1.08, z), M.gold);
                        put(new THREE.CylinderGeometry(0.12, 0.26, 0.18, 12, 1, true).translate(x + lx, 1.28, z), M.green);
                        lampPoints.push(new THREE.Vector3(x + lx, 1.18, z));
                    }
                    // open books on the table
                    put(boxGeo(0.5, 0.05, 0.36, x + 0.3, 0.95, z - 0.2, 1, 0.3), M.marble);
                    // chairs
                    for (const cz of [-1.4, 1.4]) {
                        for (const cx of [-1.1, 1.1]) {
                            put(boxGeo(0.6, 0.08, 0.6, x + cx, 0.5, z + cz), M.wood);
                            put(boxGeo(0.6, 0.7, 0.08, x + cx, 0.88, z + cz + Math.sign(cz) * 0.28), M.wood);
                        }
                    }
                }
            }
        }
        // stacks of books to climb on (step by step up onto the shelves)
        const stackColors = [0x7f1d1d, 0x1e3a8a, 0x14532d, 0x713f12, 0x4c1d95];
        const stackMats = stackColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
        const stairs = [
            [14.6, 21.4, 1], [33, 21.4, 1], [44.7, 49.9, -1], [26.5, 38.9, -1],
        ];
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                stairs.forEach(([x0, z0, dirX], si) => {
                    // three steps of piled books, the last one just below the shelf top
                    for (let k = 0; k < 3; k++) {
                        const h = 1.05 + k * 1.1;
                        const x = sx * (x0 + dirX * k * 1.3);
                        const z = sz * z0;
                        let y = 0;
                        while (y < h - 0.01) {
                            const th = 0.14 + rand() * 0.1;
                            const t = Math.min(th, h - y);
                            put(boxGeo(1.2 + rand() * 0.15, t, 0.95 + rand() * 0.1, x + (rand() - 0.5) * 0.08, y + t / 2, z, 1, (rand() - 0.5) * 0.25), stackMats[(si + k + Math.floor(y * 7)) % stackMats.length]);
                            y += t;
                        }
                        box(x - 0.6, x + 0.6, z - 0.5, z + 0.5, 0, h, true);
                    }
                });
            }
        }
        // rolling ladders leaning on some shelves (just for looks)
        for (let i = 0; i < 10; i++) {
            const s = shelfSpots[Math.floor(rand() * shelfSpots.length)];
            if (s.along !== 'x') continue;
            const side = rand() < 0.5 ? -1 : 1;
            const x = s.cx + (rand() - 0.5) * (s.L - 2);
            const z = s.cz + side * (s.D / 2 + 0.5);
            for (const dx of [-0.25, 0.25]) put(new THREE.CylinderGeometry(0.04, 0.04, 4.4, 6).rotateX(side * 0.12).translate(x + dx, 2.2, z), M.gold);
            for (let k = 0; k < 9; k++) put(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5).rotateZ(Math.PI / 2).translate(x, 0.4 + k * 0.45, z - side * k * 0.055), M.gold);
        }
    }

    // ------------------------------------------------------------------ portals
    const portalFx = [];
    {
        const vortexMat = (color) => new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPower: { value: 1 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
            fragmentShader: `
                uniform float uTime; uniform vec3 uColor; uniform float uPower; varying vec2 vUv;
                void main(){
                    vec2 p = vUv * 2.0 - 1.0;
                    float r = length(p);
                    if (r > 1.0) discard;
                    float a = atan(p.y, p.x);
                    float swirl = sin(a * 5.0 + r * 14.0 - uTime * 4.0) * 0.5 + 0.5;
                    float swirl2 = sin(a * 3.0 - r * 9.0 + uTime * 2.3) * 0.5 + 0.5;
                    float rim = smoothstep(0.65, 1.0, r) * (1.0 - smoothstep(0.92, 1.0, r));
                    float core = 1.0 - smoothstep(0.0, 0.55, r);
                    float v = (swirl * 0.55 + swirl2 * 0.35) * (1.0 - r * 0.6) + rim * 1.6 + core * 0.8;
                    vec3 col = mix(uColor, vec3(1.0), core * 0.35 + rim * 0.25);
                    gl_FragColor = vec4(col * v * uPower, v * 0.85 * uPower);
                }`,
        });
        const archStone = new THREE.MeshStandardMaterial({ color: 0x3f3a52, map: stoneTexture(), roughness: 0.85 });
        PORTALS.forEach((p, i) => {
            const ang = Math.atan2(p.x, p.z);
            const g = new THREE.Group();
            g.position.set(p.x, 0, p.z);
            g.rotation.y = ang + Math.PI;
            // stone arch: two towers and a top
            const left = new THREE.Mesh(new THREE.BoxGeometry(1.6, 8.5, 1.8), archStone);
            left.position.set(-4.4, 4.25, 0);
            const right = left.clone();
            right.position.x = 4.4;
            const top = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.85, 8, 24, Math.PI), archStone);
            top.position.y = 8.5;
            [left, right, top].forEach((m) => {
                m.castShadow = true;
                g.add(m);
            });
            const vortex = new THREE.Mesh(new THREE.CircleGeometry(4.1, 48), vortexMat(i % 2 ? 0xa855f7 : 0xd946ef));
            vortex.position.y = 6;
            vortex.scale.set(1, 1.45, 1);
            g.add(vortex);
            const runes = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: runeTexture('216,120,255'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
            runes.position.set(0, 0.04, 3);
            g.add(runes);
            const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xc026d3, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
            glow.position.set(0, 6, -0.5);
            glow.scale.set(16, 18, 1);
            g.add(glow);
            ground.add(g);
            // the towers block
            const tx = Math.cos(ang) * 4.4;
            const tz = -Math.sin(ang) * 4.4;
            for (const s of [-1, 1]) {
                const cx = p.x + s * tx;
                const cz = p.z + s * tz;
                box(cx - 0.9, cx + 0.9, cz - 0.9, cz + 0.9, 0, 9);
            }
            portalFx.push({ vortex, runes, glow, power: 0.35, target: 0.35 });
        });
    }

    // ------------------------------------------------------------------ the Golden Book
    const book = {};
    {
        const g = new THREE.Group();
        g.position.set(0, 2.15, 0);
        const cover = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.5, metalness: 0.2, emissive: 0x2a0a00, emissiveIntensity: 0.6 });
        const pageMat = new THREE.MeshStandardMaterial({ map: pageTexture(), roughness: 0.8, emissive: 0xffd27a, emissiveIntensity: 0.35, emissiveMap: pageTexture() });
        const tilt = 0.32;
        for (const s of [-1, 1]) {
            const half = new THREE.Group();
            half.rotation.z = s * tilt;
            const c = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 1.7), cover);
            c.position.set(s * 0.67, 0, 0);
            const pages = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.16, 1.6), pageMat);
            pages.position.set(s * 0.64, 0.12, 0);
            const corner = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.25), M.gold);
            corner.position.set(s * 1.2, 0.02, 0.75);
            const corner2 = corner.clone();
            corner2.position.z = -0.75;
            [c, pages, corner, corner2].forEach((m) => {
                m.castShadow = true;
                half.add(m);
            });
            g.add(half);
        }
        g.position.y = 2.75;
        ground.add(g);
        // floating rune rings around it and a magic circle on the floor
        const ringMat = new THREE.MeshBasicMaterial({ map: runeTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
        const ring1 = new THREE.Mesh(new THREE.PlaneGeometry(5.5, 5.5), ringMat);
        ring1.rotation.x = -Math.PI / 2;
        ring1.position.y = 3.6;
        ground.add(ring1);
        const floorRunes = new THREE.Mesh(new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2), ringMat);
        floorRunes.position.y = 0.73;
        ground.add(floorRunes);
        const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffc94d, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.85 }));
        glow.position.set(0, 3.1, 0);
        glow.scale.setScalar(7);
        ground.add(glow);
        // the shield: a soft bubble that flashes when monsters hit it
        const shieldMat = new THREE.ShaderMaterial({
            uniforms: { uTime: { value: 0 }, uHit: { value: 0 }, uLife: { value: 1 } },
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
                void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }`,
            fragmentShader: `uniform float uTime; uniform float uHit; uniform float uLife; varying vec3 vN; varying vec3 vV; varying vec3 vP;
                void main(){
                    float f = pow(1.0 - abs(dot(vN, vV)), 2.5);
                    float hex = abs(sin(vP.x * 6.0 + uTime) * sin(vP.y * 6.0) * sin(vP.z * 6.0 - uTime * 0.7));
                    vec3 good = vec3(1.0, 0.8, 0.3);
                    vec3 bad = vec3(1.0, 0.25, 0.2);
                    vec3 col = mix(bad, good, uLife);
                    float a = f * (0.45 + uHit * 1.2) + hex * 0.05 * (0.4 + uHit);
                    gl_FragColor = vec4(col * a, a);
                }`,
        });
        const shield = new THREE.Mesh(new THREE.SphereGeometry(3.4, 40, 24), shieldMat);
        shield.position.y = 2.1;
        ground.add(shield);
        Object.assign(book, { group: g, ring1, floorRunes, glow, shield, shieldMat, hit: 0 });
    }

    // ------------------------------------------------------------------ the shops
    const stationObjs = [];
    {
        STATIONS.forEach((st) => {
            const g = new THREE.Group();
            g.position.set(st.x, st.id === 'book' ? 0.7 : 0, st.z);
            if (st.id === 'book') {
                // a small lectern in front of the book
                const lec = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 1.05, 10), M.gold);
                lec.position.y = 0.52;
                const topBoard = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 0.55), M.darkWood);
                topBoard.position.y = 1.08;
                topBoard.rotation.x = -0.4;
                g.add(lec, topBoard);
            } else if (st.id === 'crate' || st.id === 'gold') {
                const mat = st.id === 'gold' ? M.gold : new THREE.MeshStandardMaterial({ color: 0x2b4a7a, roughness: 0.5, metalness: 0.3 });
                const base = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.85, 1.1), mat);
                base.position.y = 0.43;
                const lid = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.25, 1.16), st.id === 'gold' ? M.darkWood : M.gold);
                lid.position.y = 0.97;
                const band = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.9, 1.14), st.id === 'gold' ? M.darkWood : M.gold);
                band.position.y = 0.45;
                g.add(base, lid, band);
                g.userData.lid = lid;
            } else if (st.id === 'ammo') {
                const mat = new THREE.MeshStandardMaterial({ color: 0x3f6212, roughness: 0.6 });
                for (let k = 0; k < 3; k++) {
                    const b = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 0.7), mat);
                    b.position.set((k - 1) * 0.5, 0.25 + (k === 1 ? 0.5 : 0), 0);
                    b.rotation.y = k * 0.3;
                    g.add(b);
                }
            } else {
                const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 0.8, 20), M.pillar);
                basin.position.y = 0.4;
                const water = new THREE.Mesh(new THREE.CircleGeometry(0.82, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xf9a8d4 }));
                water.position.y = 0.81;
                g.add(basin, water);
            }
            g.traverse((m) => {
                if (m.isMesh) m.castShadow = true;
            });
            const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: st.color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
            halo.position.y = 1.2;
            halo.scale.setScalar(3.2);
            g.add(halo);
            const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.45, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: st.color, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
            ring.position.y = 0.03;
            g.add(ring);
            ground.add(g);
            if (st.id !== 'book') box(st.x - 0.9, st.x + 0.9, st.z - 0.6, st.z + 0.6, 0, 1.1);
            stationObjs.push({ st, g, halo, ring });
        });
    }

    // ------------------------------------------------------------------ candles, dust, lamps
    let candles = null;
    {
        const count = quality > 0.5 ? 220 : 90;
        const geo = new THREE.CylinderGeometry(0.05, 0.05, 0.32, 6);
        const mat = new THREE.MeshStandardMaterial({ color: 0xfff7e0, emissive: 0xffe6a8, emissiveIntensity: 0.5 });
        candles = new THREE.InstancedMesh(geo, mat, count);
        const flames = [];
        const m4 = new THREE.Matrix4();
        const base = [];
        for (let i = 0; i < count; i++) {
            const x = (rand() * 2 - 1) * (HALF - 5);
            const z = (rand() * 2 - 1) * (HALF - 5);
            const y = 5.5 + rand() * 6;
            base.push({ x, y, z, ph: rand() * 6.28 });
            m4.makeTranslation(x, y, z);
            candles.setMatrixAt(i, m4);
            flames.push(x, y + 0.22, z);
        }
        ground.add(candles);
        const flameGeo = new THREE.BufferGeometry();
        flameGeo.setAttribute('position', new THREE.Float32BufferAttribute(flames, 3));
        const flamePts = new THREE.Points(flameGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffb347, size: 0.9, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        ground.add(flamePts);
        // lamps on the tables
        const lampGeo = new THREE.BufferGeometry().setFromPoints(lampPoints);
        ground.add(new THREE.Points(lampGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xffd27a, size: 1.6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
        // magic dust drifting in the air
        const dustN = quality > 0.5 ? 700 : 250;
        const dp = new Float32Array(dustN * 3);
        for (let i = 0; i < dustN; i++) {
            dp[i * 3] = (rand() * 2 - 1) * HALF;
            dp[i * 3 + 1] = rand() * 12;
            dp[i * 3 + 2] = (rand() * 2 - 1) * HALF;
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dp, 3));
        const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ map: glowTexture(), color: 0xfde68a, size: 0.16, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
        ground.add(dust);
        animated.push({
            update(t) {
                // candles bob gently
                for (let i = 0; i < count; i++) {
                    const b = base[i];
                    const y = b.y + Math.sin(t * 0.9 + b.ph) * 0.15;
                    m4.makeTranslation(b.x, y, b.z);
                    candles.setMatrixAt(i, m4);
                    flames[i * 3 + 1] = y + 0.22;
                }
                candles.instanceMatrix.needsUpdate = true;
                flameGeo.attributes.position.array.set(flames);
                flameGeo.attributes.position.needsUpdate = true;
                const a = dustGeo.attributes.position.array;
                for (let i = 0; i < dustN; i++) {
                    a[i * 3 + 1] += 0.004 + Math.sin(t + i) * 0.002;
                    if (a[i * 3 + 1] > 12) a[i * 3 + 1] = 0;
                }
                dustGeo.attributes.position.needsUpdate = true;
            },
        });
    }

    // ------------------------------------------------------------------ merge the static parts
    for (const [mat, list] of parts) {
        const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
        mesh.castShadow = mat !== M.carpet && mat !== M.floor;
        mesh.receiveShadow = true;
        ground.add(mesh);
    }
    parts.clear();

    // ------------------------------------------------------------------ the walking grid
    // blocked: anything a monster can't walk through (low steps are fine)
    const blocked = new Uint8Array(N * N);
    const MON_R = 0.55;
    for (const c of colliders) {
        const top = c.type === 'box' ? c.maxY : c.y1;
        if (top <= 0.75) continue;
        const minX = (c.type === 'box' ? c.minX : c.x - c.r) - MON_R;
        const maxX = (c.type === 'box' ? c.maxX : c.x + c.r) + MON_R;
        const minZ = (c.type === 'box' ? c.minZ : c.z - c.r) - MON_R;
        const maxZ = (c.type === 'box' ? c.maxZ : c.z + c.r) + MON_R;
        for (let i = Math.max(0, Math.floor((minX + HALF) / CELL)); i <= Math.min(N - 1, Math.floor((maxX + HALF) / CELL)); i++) {
            for (let j = Math.max(0, Math.floor((minZ + HALF) / CELL)); j <= Math.min(N - 1, Math.floor((maxZ + HALF) / CELL)); j++) {
                const cx = -HALF + (i + 0.5) * CELL;
                const cz = -HALF + (j + 0.5) * CELL;
                if (c.type === 'cyl' && Math.hypot(cx - c.x, cz - c.z) > c.r + MON_R + 0.4) continue;
                blocked[j * N + i] = 1;
            }
        }
    }
    for (let i = 0; i < N; i++) {
        blocked[i] = 1;
        blocked[(N - 1) * N + i] = 1;
        blocked[i * N] = 1;
        blocked[i * N + N - 1] = 1;
    }
    const cellOf = (x, z) => {
        const i = Math.max(0, Math.min(N - 1, Math.floor((x + HALF) / CELL)));
        const j = Math.max(0, Math.min(N - 1, Math.floor((z + HALF) / CELL)));
        return j * N + i;
    };
    // distances from a set of goal points (Dijkstra on the grid, 8 directions),
    // with a small binary heap in typed arrays (fast enough to redo often)
    const heapK = new Float32Array(N * N * 8);
    const heapV = new Int32Array(N * N * 8);
    let heapN = 0;
    function hpush(key, val) {
        let i = heapN++;
        heapK[i] = key;
        heapV[i] = val;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (heapK[p] <= heapK[i]) break;
            const tk = heapK[p];
            const tv = heapV[p];
            heapK[p] = heapK[i];
            heapV[p] = heapV[i];
            heapK[i] = tk;
            heapV[i] = tv;
            i = p;
        }
    }
    let popKey = 0;
    function hpop() {
        const val = heapV[0];
        popKey = heapK[0];
        heapN -= 1;
        if (heapN > 0) {
            heapK[0] = heapK[heapN];
            heapV[0] = heapV[heapN];
            let i = 0;
            for (;;) {
                const l = i * 2 + 1;
                const r = l + 1;
                let m = i;
                if (l < heapN && heapK[l] < heapK[m]) m = l;
                if (r < heapN && heapK[r] < heapK[m]) m = r;
                if (m === i) break;
                const tk = heapK[m];
                const tv = heapV[m];
                heapK[m] = heapK[i];
                heapV[m] = heapV[i];
                heapK[i] = tk;
                heapV[i] = tv;
                i = m;
            }
        }
        return val;
    }
    const DI = [1, -1, 0, 0, 1, 1, -1, -1];
    const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
    const DW = [1, 1, 1, 1, 1.414, 1.414, 1.414, 1.414];
    function flowField(goals, out = new Float32Array(N * N), goalRadius = 0) {
        out.fill(Infinity);
        heapN = 0;
        for (const g of goals) {
            const r = Math.ceil(goalRadius / CELL);
            const gi = Math.floor((g.x + HALF) / CELL);
            const gj = Math.floor((g.z + HALF) / CELL);
            for (let di = -r; di <= r; di++) {
                for (let dj = -r; dj <= r; dj++) {
                    const i = gi + di;
                    const j = gj + dj;
                    if (i < 0 || j < 0 || i >= N || j >= N) continue;
                    if (Math.hypot(di, dj) * CELL > goalRadius + 0.01) continue;
                    const k = j * N + i;
                    out[k] = 0;
                    hpush(0, k);
                }
            }
        }
        while (heapN > 0) {
            const k = hpop();
            const d = popKey;
            if (d > out[k]) continue;
            const i = k % N;
            const j = (k - i) / N;
            for (let q = 0; q < 8; q++) {
                const ni = i + DI[q];
                const nj = j + DJ[q];
                if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                const nk = nj * N + ni;
                if (blocked[nk]) continue;
                // no cutting corners past walls
                if (q >= 4 && (blocked[j * N + ni] || blocked[nj * N + i])) continue;
                const nd = d + DW[q];
                if (nd < out[nk]) {
                    out[nk] = nd;
                    hpush(nd, nk);
                }
            }
        }
        return out;
    }
    // which way to walk from (x, z) in a field: toward the lowest neighbour
    function flowDir(field, x, z, out) {
        const k = cellOf(x, z);
        const i = k % N;
        const j = (k - i) / N;
        let best = field[k];
        let bx = 0;
        let bz = 0;
        for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
                if (!di && !dj) continue;
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
                const v = field[nj * N + ni];
                if (di && dj && (blocked[j * N + ni] || blocked[nj * N + i])) continue;
                if (v < best) {
                    best = v;
                    bx = di;
                    bz = dj;
                }
            }
        }
        if (!bx && !bz) return out.set(0, 0, 0);
        // aim for the middle of that square (smooth paths)
        const tx = -HALF + (i + bx + 0.5) * CELL;
        const tz = -HALF + (j + bz + 0.5) * CELL;
        out.set(tx - x, 0, tz - z);
        const l = out.length();
        return l > 1e-6 ? out.divideScalar(l) : out.set(bx, 0, bz).normalize();
    }
    const fieldValue = (field, x, z) => field[cellOf(x, z)];
    const bookField = flowField([BOOK_POS], undefined, BOOK_RADIUS + 1.5);

    // ------------------------------------------------------------------ minimap (drawn once)
    const minimap = document.createElement('canvas');
    {
        const S = 264;
        minimap.width = S;
        minimap.height = S;
        const ctx = minimap.getContext('2d');
        const k = S / (HALF * 2);
        ctx.fillStyle = '#2a1a10';
        ctx.fillRect(0, 0, S, S);
        ctx.fillStyle = '#e2d6c0';
        ctx.beginPath();
        ctx.arc(S / 2, S / 2, (ROTUNDA_R + 1.5) * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8b1a2b';
        ctx.fillRect(S / 2 - 2.3 * k, 0, 4.6 * k, S);
        ctx.fillRect(0, S / 2 - 2.3 * k, S, 4.6 * k);
        ctx.fillStyle = '#c9a36b';
        for (const c of colliders) {
            if (c.type !== 'box' || c.maxY < 2) continue;
            ctx.fillRect((c.minX + HALF) * k, (HALF - c.maxZ) * k, (c.maxX - c.minX) * k, (c.maxZ - c.minZ) * k);
        }
        ctx.fillStyle = '#c026d3';
        PORTALS.forEach((p) => {
            ctx.beginPath();
            ctx.arc((p.x + HALF) * k, (HALF - p.z) * k, 4, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.strokeStyle = '#4b3a2a';
        ctx.lineWidth = 3;
        ctx.strokeRect(0, 0, S, S);
    }

    // ------------------------------------------------------------------ per frame
    function update(t, dt, { bookLife = 1, portalPower = null } = {}) {
        for (const a of animated) a.update(t, dt);
        book.group.position.y = 2.75 + Math.sin(t * 1.4) * 0.08;
        book.group.rotation.y = t * 0.25;
        book.ring1.rotation.z = t * 0.6;
        book.ring1.position.y = 3.6 + Math.sin(t * 1.1) * 0.15;
        book.floorRunes.rotation.y = -t * 0.12;
        book.glow.material.opacity = 0.7 + Math.sin(t * 2.2) * 0.12;
        book.hit = Math.max(0, book.hit - dt * 2.5);
        book.shieldMat.uniforms.uTime.value = t;
        book.shieldMat.uniforms.uHit.value = book.hit;
        book.shieldMat.uniforms.uLife.value = bookLife;
        book.shield.visible = bookLife > 0;
        portalFx.forEach((p, i) => {
            if (portalPower) p.target = portalPower[i];
            p.power += (p.target - p.power) * Math.min(1, dt * 2);
            p.vortex.material.uniforms.uTime.value = t + i;
            p.vortex.material.uniforms.uPower.value = p.power;
            p.vortex.rotation.z = t * 0.3;
            p.runes.rotation.z = t * 0.4;
            p.runes.material.opacity = 0.3 + p.power * 0.7;
            p.glow.material.opacity = 0.2 + p.power * 0.6;
        });
        stationObjs.forEach((s, i) => {
            s.halo.material.opacity = 0.4 + Math.sin(t * 2 + i) * 0.15;
            s.ring.rotation.y = t * 0.5;
        });
    }

    return {
        ground,
        colliders,
        terrainHeight,
        supportHeight,
        pushOut,
        raycast,
        lineOfSight,
        flowField,
        flowDir,
        fieldValue,
        bookField,
        isBlocked: (x, z) => blocked[cellOf(x, z)] === 1,
        minimap,
        update,
        book,
        stations: stationObjs,
        portals: portalFx,
        N,
    };
}

// texture coordinates from world position (textures keep their size on big and small boxes)
function worldUV(geo, scale = 2) {
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
        const nx = Math.abs(nrm.getX(i));
        const ny = Math.abs(nrm.getY(i));
        const nz = Math.abs(nrm.getZ(i));
        let u;
        let v;
        if (ny >= nx && ny >= nz) {
            u = pos.getX(i);
            v = pos.getZ(i);
        } else if (nx >= nz) {
            u = pos.getZ(i);
            v = pos.getY(i);
        } else {
            u = pos.getX(i);
            v = pos.getY(i);
        }
        uv[i * 2] = u / scale;
        uv[i * 2 + 1] = v / scale;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
}
