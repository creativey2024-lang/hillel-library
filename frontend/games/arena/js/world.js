/**
 * The island: terrain, sea and lake, towns with houses you can walk into,
 * forests, a mountain, rocks, flowers, grass - and everything you can bump
 * into or shoot through. Also answers "how high is the ground here",
 * "what does this bullet hit" and "can this bot see that player".
 *
 * Almost everything is built in code. Boxes of the same material are merged
 * into one mesh, so the big island still draws in a few dozen calls.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../shared/lib/utils/BufferGeometryUtils.js';
import { texture, waterNormals, worldUV } from './textures.js';

export const MAP_HALF = 400;           // the world goes from -400 to 400 on x and z
export const ISLAND_RADIUS = 360;
const SEG = 256;                       // terrain grid cells per side
const CELL = (MAP_HALF * 2) / SEG;

// ------------------------------------------------------------- random
export function makeRng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hash2(ix, iz, seed) {
    let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z, seed) {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const fx = x - ix;
    const fz = z - iz;
    const sx = fx * fx * (3 - 2 * fx);
    const sz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, seed);
    const b = hash2(ix + 1, iz, seed);
    const c = hash2(ix, iz + 1, seed);
    const d = hash2(ix + 1, iz + 1, seed);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

function fbm(x, z, seed) {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < 4; i++) {
        v += valueNoise(x * f, z * f, seed + i * 17) * amp;
        amp *= 0.5;
        f *= 2.03;
    }
    return v;
}

const smoothstep = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------- places
export const POIS = [
    { id: 'city', name: 'עיר הספרים', x: 10, z: 10, r: 58, kind: 'city' },
    { id: 'village', name: 'הכפר השקט', x: -200, z: -140, r: 36, kind: 'village' },
    { id: 'fort', name: 'המבצר', x: 200, z: -170, r: 28, kind: 'fort' },
    { id: 'forest', name: 'יער האורנים', x: -140, z: 170, r: 62, kind: 'forest' },
    { id: 'docks', name: 'המחסנים', x: 225, z: 140, r: 36, kind: 'warehouses' },
    { id: 'lighthouse', name: 'המגדלור', x: -300, z: -60, r: 18, kind: 'lighthouse' },
    { id: 'farm', name: 'החווה', x: 30, z: -235, r: 36, kind: 'farm' },
    { id: 'suburb', name: 'שכונת הגנים', x: 165, z: -10, r: 42, kind: 'suburb' },
    { id: 'mountain', name: 'הר הנשר', x: -225, z: 60, r: 30, kind: 'mountain' },
    { id: 'lake', name: 'אגם הברבורים', x: 55, z: 215, r: 44, kind: 'lake' },
    { id: 'camp', name: 'מחנה הצופים', x: -75, z: -235, r: 26, kind: 'camp' },
];
const P = Object.fromEntries(POIS.map((p) => [p.id, p]));

// roads between places
const ROADS = [
    ['city', 'suburb'], ['city', 'lake'], ['city', 'forest'], ['city', 'village'], ['city', 'farm'],
    ['suburb', 'fort'], ['suburb', 'docks'], ['lake', 'docks'], ['forest', 'mountain'], ['mountain', 'lighthouse'],
    ['lighthouse', 'village'], ['village', 'camp'], ['camp', 'farm'], ['farm', 'fort'], ['forest', 'lake'],
].map(([a, b]) => [P[a], P[b]]);

// ------------------------------------------------------------- terrain shape
function coastRadius(x, z) {
    const a = Math.atan2(z, x);
    return ISLAND_RADIUS * (0.965 + 0.05 * Math.sin(a * 3 + 0.7) + 0.03 * Math.sin(a * 7 + 2.1) + 0.015 * Math.sin(a * 13 + 0.3));
}

function gauss(x, z, p, sigma) {
    const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
    return Math.exp(-d2 / (2 * sigma * sigma));
}

function rawHeight(x, z) {
    const r = Math.hypot(x, z);
    const R = coastRadius(x, z);
    const land = 1 - smoothstep(R * 0.8, R * 0.99, r);
    let h = 2.2 + fbm(x * 0.0055, z * 0.0055, 7) * 22 + fbm(x * 0.025, z * 0.025, 3) * 3.2;
    h += gauss(x, z, P.fort, 42) * 14;      // the hill under the fort
    h += gauss(x, z, P.mountain, 62) * 40;  // the mountain
    return h * land - (1 - land) * 9;
}

const poiHeights = POIS.map((p) => Math.max(2.4, rawHeight(p.x, p.z)));

function shapedHeight(x, z) {
    let h = rawHeight(x, z);
    POIS.forEach((p, i) => {
        if (p.kind === 'forest') return; // forests keep their bumps
        const d = Math.hypot(x - p.x, z - p.z);
        if (p.kind === 'mountain') {
            // a small flat top for the radio tower
            h += (poiHeights[i] - h) * (1 - smoothstep(9, 18, d));
            return;
        }
        const w = 1 - smoothstep(p.r * 0.8, p.r * 1.45, d);
        h += (poiHeights[i] - h) * w;
        if (p.kind === 'lake') {
            // a bowl under the water
            const inner = 1 - smoothstep(p.r * 0.5, p.r * 0.95, d);
            h += (-3.4 - h) * inner;
        }
    });
    return h;
}

// ------------------------------------------------------------- colliders
// boxes: { minX, minY, minZ, maxX, maxY, maxZ, walk, foliage }
// cylinders: { x, z, r, y0, y1, walk, foliage }
// ramps: { minX, maxX, minZ, maxZ, y0, y1, axis, dir }  (walkable slopes)
class ColliderGrid {
    constructor() {
        this.size = 16;
        this.cells = new Map();
        this.all = [];
    }

    key(ix, iz) {
        return (ix + 2048) * 4096 + (iz + 2048);
    }

    add(c) {
        this.all.push(c);
        const x0 = Math.floor(c.bminX / this.size);
        const x1 = Math.floor(c.bmaxX / this.size);
        const z0 = Math.floor(c.bminZ / this.size);
        const z1 = Math.floor(c.bmaxZ / this.size);
        for (let ix = x0; ix <= x1; ix++) {
            for (let iz = z0; iz <= z1; iz++) {
                const k = this.key(ix, iz);
                if (!this.cells.has(k)) this.cells.set(k, []);
                this.cells.get(k).push(c);
            }
        }
    }

    near(x, z, radius, out) {
        out.length = 0;
        const x0 = Math.floor((x - radius) / this.size);
        const x1 = Math.floor((x + radius) / this.size);
        const z0 = Math.floor((z - radius) / this.size);
        const z1 = Math.floor((z + radius) / this.size);
        const stamp = ++this.stamp || (this.stamp = 1);
        for (let ix = x0; ix <= x1; ix++) {
            for (let iz = z0; iz <= z1; iz++) {
                const list = this.cells.get(this.key(ix, iz));
                if (!list) continue;
                for (const c of list) {
                    if (c.stamp === stamp) continue;
                    c.stamp = stamp;
                    out.push(c);
                }
            }
        }
        return out;
    }
}

// ------------------------------------------------------------- the world
export function createWorld(scene, models, opts = {}) {
    const rng = makeRng(20261023);
    const grid = new ColliderGrid();
    const W1 = SEG + 1;
    const heights = new Float32Array(W1 * W1);
    for (let j = 0; j <= SEG; j++) {
        for (let i = 0; i <= SEG; i++) {
            heights[j * W1 + i] = shapedHeight(-MAP_HALF + i * CELL, -MAP_HALF + j * CELL);
        }
    }

    // exact height of the terrain mesh at (x, z) (same triangles as the mesh)
    function terrainHeight(x, z) {
        const gx = (x + MAP_HALF) / CELL;
        const gz = (z + MAP_HALF) / CELL;
        if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return -9;
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        const fx = gx - i;
        const fz = gz - j;
        const h00 = heights[j * W1 + i];
        const h10 = heights[j * W1 + i + 1];
        const h01 = heights[(j + 1) * W1 + i];
        const h11 = heights[(j + 1) * W1 + i + 1];
        if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
        return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }

    function slopeAt(x, z) {
        const e = 2;
        const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
        const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
        return Math.hypot(dx, dz) / (2 * e);
    }

    const poiAt = (x, z, pad = 0) => POIS.find((p) => Math.hypot(x - p.x, z - p.z) < p.r + pad);

    // ---- roads (coloured on the terrain)
    function distToRoad(x, z) {
        let best = Infinity;
        for (let k = 0; k < ROADS.length; k++) {
            const [A, B] = ROADS[k];
            const vx = B.x - A.x;
            const vz = B.z - A.z;
            const len = Math.hypot(vx, vz);
            const t = Math.max(0, Math.min(1, ((x - A.x) * vx + (z - A.z) * vz) / (len * len)));
            // a gentle wiggle so roads don't look ruler-straight
            const wig = Math.sin(t * Math.PI * 3 + k) * 9 * Math.sin(t * Math.PI);
            const px = A.x + vx * t + (-vz / len) * wig;
            const pz = A.z + vz * t + (vx / len) * wig;
            const d = Math.hypot(x - px, z - pz);
            if (d < best) best = d;
        }
        return best;
    }

    // ---- ground colours
    const C = {
        grass1: new THREE.Color(0x6cbf47),
        grass2: new THREE.Color(0x4f9f36),
        grass3: new THREE.Color(0x9bd35a),
        meadow: new THREE.Color(0xb5c95a),
        sand: new THREE.Color(0xecd9a0),
        wetSand: new THREE.Color(0xc9b27c),
        under: new THREE.Color(0x9fb79a),
        deep: new THREE.Color(0x5d8f8c),
        rock: new THREE.Color(0x96928a),
        rockDark: new THREE.Color(0x77736c),
        snow: new THREE.Color(0xf4f7fa),
        dirt: new THREE.Color(0xb08657),
        dirtDark: new THREE.Color(0x8f6a43),
        town: new THREE.Color(0xc9c4b8),
        asphalt: new THREE.Color(0x8b8f94),
        farm: new THREE.Color(0xc9a85a),
        farmGreen: new THREE.Color(0x8fae4a),
    };
    const tmpC = new THREE.Color();
    // returns 1 for grassy ground (where grass tufts may grow)
    function groundColor(x, z, h, out) {
        if (h < -0.3) {
            out.copy(C.under).lerp(C.deep, smoothstep(-0.3, -6, h));
            return 0;
        }
        if (h < 1.6) {
            out.copy(C.wetSand).lerp(C.sand, smoothstep(0.1, 0.9, h));
            out.lerp(C.grass1, smoothstep(1.2, 1.6, h) * 0.5);
            return 0;
        }
        let grassy = 1;
        const n = fbm(x * 0.03, z * 0.03, 11);
        const n2 = fbm(x * 0.008, z * 0.008, 23);
        out.copy(C.grass2).lerp(C.grass1, n);
        if (n > 0.6) out.lerp(C.grass3, (n - 0.6) * 1.8);
        if (n2 > 0.55) out.lerp(C.meadow, Math.min(0.6, (n2 - 0.55) * 3));
        out.lerp(C.sand, 1 - smoothstep(1.6, 2.4, h));
        // rocky slopes and the mountain top, snow on the very top
        const slope = slopeAt(x, z);
        const rocky = Math.max(smoothstep(0.55, 0.85, slope), smoothstep(27, 33, h));
        if (rocky > 0) {
            tmpC.copy(C.rock).lerp(C.rockDark, fbm(x * 0.1, z * 0.1, 5));
            out.lerp(tmpC, rocky);
            if (rocky > 0.5) grassy = 0;
        }
        if (h > 46) {
            // snow only on the very top of the mountain
            out.lerp(C.snow, smoothstep(46, 51, h + (fbm(x * 0.08, z * 0.08, 13) - 0.5) * 4));
            grassy = 0;
        }
        const poi = poiAt(x, z, 6);
        if (poi) {
            const d = Math.hypot(x - poi.x, z - poi.z);
            if (poi.kind === 'city') {
                const k = 1 - smoothstep(poi.r * 0.85, poi.r + 6, d);
                // streets darker than the squares
                // blocks sit on a 17 m grid; the streets run between them
                const u = (((x - poi.x) % 17) + 17) % 17;
                const v = (((z - poi.z) % 17) + 17) % 17;
                const street = Math.abs(u - 8.5) < 3.6 || Math.abs(v - 8.5) < 3.6;
                out.lerp(street ? C.asphalt : C.town, k);
                if (k > 0.5) grassy = 0;
            } else if (poi.kind === 'warehouses' || poi.kind === 'fort') {
                const k = 1 - smoothstep(poi.r * 0.75, poi.r + 4, d);
                out.lerp(poi.kind === 'fort' ? C.dirt : C.town, k * 0.9);
                if (k > 0.5) grassy = 0;
            } else if (poi.kind === 'farm') {
                const rows = Math.sin((x - poi.x) * 0.8) > 0.1;
                const k = (1 - smoothstep(poi.r * 0.5, poi.r + 2, d)) * 0.9;
                out.lerp(rows ? C.farm : C.farmGreen, k);
                if (k > 0.4) grassy = 0;
            } else if (poi.kind === 'camp') {
                const k = 1 - smoothstep(poi.r * 0.35, poi.r * 0.8, d);
                out.lerp(C.dirt, k * 0.8);
                if (k > 0.5) grassy = 0;
            }
        }
        const dr = distToRoad(x, z);
        if (dr < 4.2) {
            const k = 1 - smoothstep(2.4, 4.2, dr);
            out.lerp(dr < 1.2 ? C.dirt : C.dirtDark, k);
            if (k > 0.3) grassy = 0;
        }
        return grassy;
    }

    // ---- terrain mesh (smooth, vertex-coloured, with a fine detail texture)
    const grassMask = new Uint8Array(W1 * W1);
    const colors = new Float32Array(W1 * W1 * 3);
    {
        const pos = new Float32Array(W1 * W1 * 3);
        const uv = new Float32Array(W1 * W1 * 2);
        const c = new THREE.Color();
        for (let j = 0; j < W1; j++) {
            for (let i = 0; i < W1; i++) {
                const x = -MAP_HALF + i * CELL;
                const z = -MAP_HALF + j * CELL;
                const h = heights[j * W1 + i];
                const k = j * W1 + i;
                pos[k * 3] = x;
                pos[k * 3 + 1] = h;
                pos[k * 3 + 2] = z;
                grassMask[k] = groundColor(x, z, h, c);
                // a touch of random shade per vertex so big areas aren't flat
                c.multiplyScalar(0.94 + hash2(i, j, 99) * 0.1);
                colors[k * 3] = c.r;
                colors[k * 3 + 1] = c.g;
                colors[k * 3 + 2] = c.b;
                uv[k * 2] = x / 5;
                uv[k * 2 + 1] = z / 5;
            }
        }
        const idx = new Uint32Array(SEG * SEG * 6);
        let n = 0;
        for (let j = 0; j < SEG; j++) {
            for (let i = 0; i < SEG; i++) {
                const a = j * W1 + i;
                const b = a + 1;
                const d = a + W1;
                const e = d + 1;
                idx[n++] = a; idx[n++] = d; idx[n++] = b;
                idx[n++] = b; idx[n++] = d; idx[n++] = e;
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeVertexNormals();
        const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, map: texture('grass'), roughness: 0.96 }));
        terrain.receiveShadow = true;
        scene.add(terrain);
    }

    // ---- sea (and the lake: the same water, the lake bed is below sea level)
    const waterTex = waterNormals();
    waterTex.repeat.set(90, 90);
    const water = new THREE.Mesh(
        new THREE.PlaneGeometry(3200, 3200, 1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshStandardMaterial({
            color: 0x1f86cf, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.82,
            normalMap: waterTex, normalScale: new THREE.Vector2(0.55, 0.55), emissive: 0x06365e, emissiveIntensity: 0.35,
        })
    );
    scene.add(water);

    // ---- materials (textured; the colour tints the texture)
    const T = { planks: texture('planks'), bricks: texture('bricks'), plaster: texture('plaster'), tiles: texture('tiles'), metal: texture('metal') };
    const tm = (color, map, uvScale, extra = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, map, roughness: 0.85, ...extra });
        m.userData.uvScale = uvScale;
        return m;
    };
    const plain = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
    const M = {
        wood: tm(0xb5814c, T.planks, 2.4),
        woodDark: tm(0x80573a, T.planks, 2.4),
        woodLight: tm(0xe0bf90, T.planks, 2.4),
        barn: tm(0xb8402f, T.planks, 2.4),
        stone: tm(0xc3bdb1, T.bricks, 2.6),
        stoneDark: tm(0x948d82, T.bricks, 2.6),
        cream: tm(0xf1e4c6, T.plaster, 4),
        blue: tm(0xbcd6ec, T.plaster, 4),
        pink: tm(0xf2c6c0, T.plaster, 4),
        mint: tm(0xc8e8cf, T.plaster, 4),
        white: tm(0xf7f5f0, T.plaster, 4),
        yellow: tm(0xf6dd8c, T.plaster, 4),
        roofRed: tm(0xc0553c, T.tiles, 2.2),
        roofBrown: tm(0x8a5236, T.tiles, 2.2),
        roofBlue: tm(0x4f6f93, T.tiles, 2.2),
        roofGreen: tm(0x4f8a5b, T.tiles, 2.2),
        roofGrey: tm(0x6b6f76, T.tiles, 2.2),
        metal: tm(0xb3bcc5, T.metal, 3, { metalness: 0.35, roughness: 0.5 }),
        cRed: tm(0xc8442e, T.metal, 3, { metalness: 0.25, roughness: 0.55 }),
        cBlue: tm(0x2f73b5, T.metal, 3, { metalness: 0.25, roughness: 0.55 }),
        cGreen: tm(0x2f9b5a, T.metal, 3, { metalness: 0.25, roughness: 0.55 }),
        cOrange: tm(0xe0802a, T.metal, 3, { metalness: 0.25, roughness: 0.55 }),
        concrete: tm(0xbfbab0, T.plaster, 3),
        glass: plain(0x9fd3f0, { roughness: 0.08, metalness: 0.4, emissive: 0x16344d, emissiveIntensity: 0.5 }),
        frame: plain(0xf4f1ea),
        darkMetal: plain(0x3f464f, { metalness: 0.5, roughness: 0.45 }),
        hay: plain(0xe6c86a),
        red: plain(0xd23c2f),
        whitePaint: plain(0xf8f8f8),
        yellowPaint: plain(0xf2c230, { metalness: 0.2, roughness: 0.5 }),
        fabricOrange: plain(0xf08a2c, { side: THREE.DoubleSide }),
        fabricGreen: plain(0x4f9a4a, { side: THREE.DoubleSide }),
        fabricBlue: plain(0x3d79c8, { side: THREE.DoubleSide }),
        fabricRed: plain(0xd94b4b, { side: THREE.DoubleSide }),
        awningA: plain(0xe25b4a),
        awningB: plain(0x3f8fd8),
        awningC: plain(0x46a65a),
        lamp: plain(0xfff3c4, { emissive: 0xffd36a, emissiveIntensity: 1.1 }),
        fire: plain(0xffb347, { emissive: 0xff6a00, emissiveIntensity: 1.6, transparent: true, opacity: 0.9 }),
    };
    const PLASTERS = [M.cream, M.blue, M.pink, M.mint, M.white, M.yellow];
    const ROOFS = [M.roofRed, M.roofBrown, M.roofBlue, M.roofGreen, M.roofGrey];

    // ---- batching: everything of one material becomes one mesh at the end
    const batches = new Map();
    function addGeo(geo, material) {
        let list = batches.get(material);
        if (!list) {
            list = [];
            batches.set(material, list);
        }
        list.push(geo.index ? geo.toNonIndexed() : geo);
    }
    function boxGeo(cx, cy, cz, sx, sy, sz, ry = 0) {
        const g = new THREE.BoxGeometry(sx, sy, sz);
        if (ry) g.rotateY(ry);
        return g.translate(cx, cy, cz);
    }

    // ---- colliders
    function addBox(cx, y0, cz, sx, sy, sz, o = {}) {
        const c = {
            type: 'box',
            minX: cx - sx / 2, maxX: cx + sx / 2,
            minY: y0, maxY: y0 + sy,
            minZ: cz - sz / 2, maxZ: cz + sz / 2,
            walk: o.walk !== false,
            foliage: Boolean(o.foliage),
        };
        c.bminX = c.minX; c.bmaxX = c.maxX; c.bminZ = c.minZ; c.bmaxZ = c.maxZ;
        grid.add(c);
        return c;
    }

    function addCylinder(x, z, r, y0, y1, o = {}) {
        const c = { type: 'cyl', x, z, r, y0, y1, walk: Boolean(o.walk), foliage: Boolean(o.foliage) };
        c.bminX = x - r; c.bmaxX = x + r; c.bminZ = z - r; c.bmaxZ = z + r;
        grid.add(c);
        return c;
    }

    function addRamp(minX, maxX, minZ, maxZ, y0, y1, axis, dir) {
        const c = { type: 'ramp', minX, maxX, minZ, maxZ, y0, y1, axis, dir };
        c.bminX = minX; c.bmaxX = maxX; c.bminZ = minZ; c.bmaxZ = maxZ;
        grid.add(c);
        return c;
    }

    function rampTop(c, x, z) {
        let t = c.axis === 'x' ? (x - c.minX) / (c.maxX - c.minX) : (z - c.minZ) / (c.maxZ - c.minZ);
        if (c.dir < 0) t = 1 - t;
        return c.y0 + (c.y1 - c.y0) * Math.max(0, Math.min(1, t));
    }

    // a solid block you can stand on and hide behind
    function solid(cx, y0, cz, sx, sy, sz, material, o) {
        addGeo(boxGeo(cx, y0 + sy / 2, cz, sx, sy, sz), material);
        return addBox(cx, y0, cz, sx, sy, sz, o);
    }

    const chestSpots = [];
    const floorSpots = [];
    const ammoSpots = [];
    const coinSpots = [];
    const animated = []; // little things that move (fire, lights, flags)
    const houses = [];  // insides of the houses you can walk into

    const tmpNear = [];
    function blocked(x, z, pad) {
        for (const c of grid.near(x, z, pad + 1, tmpNear)) {
            if (c.type === 'box' && x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
            if (c.type === 'cyl' && Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
            if (c.type === 'ramp' && x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
        }
        return terrainHeight(x, z) < 1.4;
    }

    function scatterAround(poi, count, minR, maxR, list, avoid = 2.5) {
        for (let n = 0, tries = 0; n < count && tries < count * 30; tries++) {
            const a = rng() * Math.PI * 2;
            const r = minR + rng() * (maxR - minR);
            const x = poi.x + Math.cos(a) * r;
            const z = poi.z + Math.sin(a) * r;
            if (blocked(x, z, avoid)) continue;
            list.push({ x, y: terrainHeight(x, z), z, poi: poi.id });
            n++;
        }
    }

    // ---- pieces
    function crate(x, z, size = 1.3) {
        const y = terrainHeight(x, z);
        const ry = rng() * 0.4;
        addGeo(boxGeo(x, y + size / 2, z, size, size, size, ry), M.wood);
        // darker frame planks
        addGeo(boxGeo(x, y + size * 0.08, z, size * 1.04, size * 0.16, size * 1.04, ry), M.woodDark);
        addGeo(boxGeo(x, y + size * 0.92, z, size * 1.04, size * 0.16, size * 1.04, ry), M.woodDark);
        addBox(x, y, z, size, size, size);
    }

    function prismGeo(w, h, d) {
        // a triangular prism (a pitched roof / a tent): ridge along z
        const shape = new THREE.Shape();
        shape.moveTo(-w / 2, 0);
        shape.lineTo(w / 2, 0);
        shape.lineTo(0, h);
        shape.closePath();
        const g = new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false });
        g.translate(0, 0, -d / 2);
        return g;
    }

    function lampPost(x, z) {
        const y = terrainHeight(x, z);
        addGeo(new THREE.CylinderGeometry(0.09, 0.13, 4.6, 8).translate(x, y + 2.3, z), M.darkMetal);
        addGeo(new THREE.BoxGeometry(0.9, 0.08, 0.12).translate(x + 0.35, y + 4.55, z), M.darkMetal);
        addGeo(new THREE.CylinderGeometry(0.22, 0.3, 0.35, 10).translate(x + 0.7, y + 4.35, z), M.lamp);
        addCylinder(x, z, 0.2, y, y + 4.6);
    }

    function bench(x, z, ry) {
        const y = terrainHeight(x, z);
        addGeo(boxGeo(x, y + 0.45, z, 1.8, 0.1, 0.5, ry), M.wood);
        addGeo(boxGeo(x, y + 0.2, z, 1.6, 0.4, 0.3, ry), M.darkMetal);
    }

    function fenceLine(x0, z0, x1, z1, gapEvery = 0) {
        const len = Math.hypot(x1 - x0, z1 - z0);
        const n = Math.max(1, Math.round(len / 2.2));
        const ry = -Math.atan2(z1 - z0, x1 - x0);
        for (let i = 0; i <= n; i++) {
            const t = i / n;
            const x = x0 + (x1 - x0) * t;
            const z = z0 + (z1 - z0) * t;
            const y = terrainHeight(x, z);
            addGeo(boxGeo(x, y + 0.55, z, 0.16, 1.1, 0.16), M.woodDark);
            if (i < n && !(gapEvery && i % gapEvery === gapEvery - 1)) {
                const mx = x + (x1 - x0) / n / 2;
                const mz = z + (z1 - z0) / n / 2;
                const my = terrainHeight(mx, mz);
                addGeo(boxGeo(mx, my + 0.75, mz, len / n, 0.12, 0.06, ry), M.woodLight);
                addGeo(boxGeo(mx, my + 0.4, mz, len / n, 0.12, 0.06, ry), M.woodLight);
            }
        }
    }

    /**
     * A house you can walk into: four walls (a doorway at the front, windows
     * on the other sides), a wooden floor, a flat roof you can stand on and a
     * pitched roof on top. rot = quarter turns; the door faces local +z.
     */
    function house(cx, cz, w, d, o = {}) {
        const rot = ((o.rot || 0) % 4 + 4) % 4;
        const wallH = o.wallH || 3.4;
        const t = 0.3;
        const wallMat = o.wall || PLASTERS[Math.floor(rng() * PLASTERS.length)];
        const roofMat = o.roofMat || ROOFS[Math.floor(rng() * ROOFS.length)];
        const cos = [1, 0, -1, 0][rot];
        const sin = [0, 1, 0, -1][rot];
        const toWorld = (lx, lz) => [cx + lx * cos + lz * sin, cz - lx * sin + lz * cos];
        // stand on the highest ground under the house
        let y = -Infinity;
        for (const [lx, lz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) {
            const [x, z] = toWorld(lx, lz);
            y = Math.max(y, terrainHeight(x, z));
        }
        y += 0.15;
        const part = (lx, y0, lz, sx, sy, sz, mat, collide = true) => {
            const [x, z] = toWorld(lx, lz);
            const swap = rot % 2 === 1;
            const SX = swap ? sz : sx;
            const SZ = swap ? sx : sz;
            addGeo(boxGeo(x, y0 + sy / 2, z, SX, sy, SZ), mat);
            if (collide) addBox(x, y0, z, SX, sy, SZ);
        };
        // foundation + floor
        part(0, y - 1.6, 0, w + 0.3, 1.6, d + 0.3, M.stoneDark);
        part(0, y - 0.01, 0, w - 2 * t, 0.04, d - 2 * t, o.floor || M.woodLight, false);
        // walls
        const door = o.door || 1.9;
        const doorH = Math.min(wallH - 0.5, o.doorH || 2.6);
        part(0, y, -d / 2 + t / 2, w, wallH, t, wallMat);
        part(-w / 2 + t / 2, y, 0, t, wallH, d - 2 * t, wallMat);
        part(w / 2 - t / 2, y, 0, t, wallH, d - 2 * t, wallMat);
        const seg = (w - door) / 2;
        part(-w / 2 + seg / 2, y, d / 2 - t / 2, seg, wallH, t, wallMat);
        part(w / 2 - seg / 2, y, d / 2 - t / 2, seg, wallH, t, wallMat);
        part(0, y + doorH, d / 2 - t / 2, door, wallH - doorH, t, wallMat);
        // a white frame around the doorway
        part(-door / 2 - 0.08, y, d / 2 + 0.02, 0.16, doorH + 0.1, 0.1, M.frame, false);
        part(door / 2 + 0.08, y, d / 2 + 0.02, 0.16, doorH + 0.1, 0.1, M.frame, false);
        part(0, y + doorH, d / 2 + 0.02, door + 0.32, 0.16, 0.1, M.frame, false);
        // windows (glass + frame) on the back and the sides
        const winY = y + 1.2;
        const addWin = (lx, lz, alongX) => {
            const sx = alongX ? 1.2 : 0.08;
            const sz = alongX ? 0.08 : 1.2;
            part(lx, winY - 0.08, lz, sx + (alongX ? 0.2 : 0.02), 1.26, sz + (alongX ? 0.02 : 0.2), M.frame, false);
            part(lx + (alongX ? 0 : Math.sign(lx) * 0.03), winY, lz + (alongX ? Math.sign(lz) * 0.03 : 0), sx, 1.1, sz, M.glass, false);
        };
        for (let k = -1; k <= 1; k += 2) {
            if (w > 5) addWin(k * w * 0.25, -d / 2 - 0.02, true);
            if (d > 5) {
                addWin(-w / 2 - 0.02, k * d * 0.22, false);
                addWin(w / 2 + 0.02, k * d * 0.22, false);
            }
        }
        if (w > 7) {
            addWin(-w * 0.33, d / 2 + 0.02, true);
            addWin(w * 0.33, d / 2 + 0.02, true);
        }
        // roof
        part(0, y + wallH, 0, w + 0.5, 0.3, d + 0.5, M.woodDark);
        if (o.roof === 'flat') {
            // a low wall around the roof
            part(0, y + wallH + 0.3, -d / 2 - 0.1, w + 0.5, 0.5, 0.3, wallMat);
            part(0, y + wallH + 0.3, d / 2 + 0.1, w + 0.5, 0.5, 0.3, wallMat);
            part(-w / 2 - 0.1, y + wallH + 0.3, 0, 0.3, 0.5, d - 0.1, wallMat);
            part(w / 2 + 0.1, y + wallH + 0.3, 0, 0.3, 0.5, d - 0.1, wallMat);
        } else {
            const rw = (o.ridgeAlongX ? d : w) + 0.9;
            const rl = (o.ridgeAlongX ? w : d) + 0.9;
            const rh = Math.min(w, d) * 0.38;
            const g = prismGeo(rw, rh, rl);
            if (o.ridgeAlongX) g.rotateY(Math.PI / 2);
            g.rotateY((rot * Math.PI) / 2);
            g.translate(cx, y + wallH + 0.3, cz);
            addGeo(g, roofMat);
            const swap = rot % 2 === 1;
            addBox(cx, y + wallH + 0.3, cz, swap ? d : w, rh * 0.5, swap ? w : d);
        }
        // an awning over the door (shops)
        if (o.awning) {
            part(0, y + doorH + 0.25, d / 2 + 0.75, door + 2.2, 0.12, 1.5, o.awning, false);
        }
        // a table inside
        if (w >= 6 && d >= 6 && !o.empty) {
            part(w * 0.22, y, -d * 0.18, 1.6, 0.8, 1.0, M.wood);
        }
        const doorOut = toWorld(0, d / 2 + 1.6);
        const doorIn = toWorld(0, d / 2 - 1.1);
        // remember the inside, so bots can find their way out through the door
        const swapped = rot % 2 === 1;
        const hx = (swapped ? d : w) / 2 - 0.2;
        const hz = (swapped ? w : d) / 2 - 0.2;
        houses.push({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz, y, doorIn: { x: doorIn[0], z: doorIn[1] }, doorOut: { x: doorOut[0], z: doorOut[1] } });
        const inside = (lx, lz) => {
            const [x, z] = toWorld(lx, lz);
            return { x, y, z, door: { x: doorOut[0], z: doorOut[1] } };
        };
        return { y, inside, door: doorOut, top: y + wallH + 0.3 };
    }

    // loot inside a house
    function lootHouse(h, poiId, w, d, chestChance = 0.85) {
        if (rng() < chestChance) chestSpots.push({ ...h.inside(-w * 0.2, -d * 0.2), poi: poiId });
        floorSpots.push({ ...h.inside(w * 0.15, d * 0.15), poi: poiId });
        if (rng() < 0.5) ammoSpots.push({ ...h.inside(-w * 0.25, d * 0.2), poi: poiId });
    }

    // ---- Kenney city-kit buildings (solid; you hide behind them and climb the low ones)
    const BUILDINGS = ['buildingA', 'buildingB', 'buildingC', 'buildingD'];
    const BUILDING_HEIGHT = { buildingA: 0.95, buildingB: 1.63, buildingC: 1.75, buildingD: 1.0, garage: 0.55 };
    function building(x, z, key, scale = 10, rot = 0) {
        const y = terrainHeight(x, z) - 0.2;
        const obj = models[key].clone(true);
        obj.scale.setScalar(scale);
        obj.position.set(x, y, z);
        obj.rotation.y = rot;
        obj.traverse((c) => {
            if (c.isMesh) {
                c.castShadow = true;
                c.receiveShadow = true;
            }
        });
        scene.add(obj);
        addBox(x, y, z, scale, BUILDING_HEIGHT[key] * scale, scale);
        return obj;
    }

    function truck(x, z, ry) {
        const keys = ['truckRed', 'truckGreen', 'truckYellow', 'truckPurple'].filter((k) => models[k]);
        if (!keys.length) return;
        const y = terrainHeight(x, z);
        const obj = models[keys[Math.floor(rng() * keys.length)]].clone(true);
        obj.scale.setScalar(2.4);
        obj.position.set(x, y, z);
        obj.rotation.y = ry;
        obj.traverse((c) => { if (c.isMesh) c.castShadow = true; });
        scene.add(obj);
        // the truck is long along its own z
        const along = Math.abs(Math.cos(ry)) > 0.7;
        addBox(x, y, z, along ? 2.6 : 5.6, 2.8, along ? 5.6 : 2.6);
    }

    function container(x, z, alongX, mat, y0) {
        const y = y0 ?? terrainHeight(x, z);
        const sx = alongX ? 7 : 2.8;
        const sz = alongX ? 2.8 : 7;
        solid(x, y, z, sx, 2.9, sz, mat);
        // dark ends (doors)
        addGeo(boxGeo(x + (alongX ? sx / 2 : 0), y + 1.45, z + (alongX ? 0 : sz / 2), alongX ? 0.06 : 2.7, 2.7, alongX ? 2.7 : 0.06), M.darkMetal);
        return y + 2.9;
    }

    function hayBale(x, z) {
        const y = terrainHeight(x, z);
        const g = new THREE.CylinderGeometry(0.9, 0.9, 1.6, 14).rotateZ(Math.PI / 2).rotateY(rng() * Math.PI).translate(x, y + 0.9, z);
        addGeo(g, M.hay);
        addCylinder(x, z, 1, y, y + 1.8, { walk: true });
    }

    function tent(x, z, ry, mat) {
        const y = terrainHeight(x, z);
        const g = prismGeo(3.2, 2.2, 3.6).rotateY(ry).translate(x, y, z);
        addGeo(g, mat);
        addCylinder(x, z, 1.5, y, y + 2.0);
    }

    function campfire(x, z) {
        const y = terrainHeight(x, z);
        for (let i = 0; i < 4; i++) {
            const g = new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6).rotateZ(Math.PI / 2).rotateY((i * Math.PI) / 4).translate(x, y + 0.15, z);
            addGeo(g, M.woodDark);
        }
        for (let i = 0; i < 9; i++) {
            const a = (i / 9) * Math.PI * 2;
            addGeo(new THREE.DodecahedronGeometry(0.22, 0).translate(x + Math.cos(a) * 0.95, y + 0.1, z + Math.sin(a) * 0.95), M.stoneDark);
        }
        const flame = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.3, 8), M.fire);
        flame.position.set(x, y + 0.75, z);
        scene.add(flame);
        animated.push((t) => {
            flame.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 17 + 1) * 0.15, 1 + Math.cos(t * 11) * 0.08);
            flame.rotation.y = t * 2;
        });
    }

    function flagPole(x, z, color) {
        const y = terrainHeight(x, z);
        addGeo(new THREE.CylinderGeometry(0.07, 0.09, 7, 8).translate(x, y + 3.5, z), M.whitePaint);
        addCylinder(x, z, 0.15, y, y + 7);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2, 8, 1), plain(color, { side: THREE.DoubleSide }));
        flag.geometry.translate(1, 0, 0);
        flag.position.set(x, y + 6.3, z);
        flag.castShadow = true;
        scene.add(flag);
        const base = flag.geometry.attributes.position.array.slice();
        animated.push((t) => {
            const p = flag.geometry.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const fx = base[i * 3];
                p.setZ(i, Math.sin(fx * 2.2 - t * 5) * 0.18 * fx);
            }
            p.needsUpdate = true;
        });
    }

    function boat(x, z, ry) {
        const y = 0.15;
        const g = new THREE.CylinderGeometry(0.9, 0.9, 3.4, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI).rotateY(ry).translate(x, y + 0.85, z);
        addGeo(g, M.wood);
        addGeo(boxGeo(x, y + 0.75, z, 0.25, 0.08, 1.6, ry), M.woodDark);
    }

    // ---- the places
    for (const poi of POIS) {
        const y0 = terrainHeight(poi.x, poi.z);
        if (poi.kind === 'city') {
            // blocks on a grid with streets between them; the middle is a square with a fountain
            const step = 17;
            for (let gx = -3; gx <= 3; gx++) {
                for (let gz = -3; gz <= 3; gz++) {
                    if (Math.abs(gx) + Math.abs(gz) > 4 || (gx === 0 && gz === 0)) continue;
                    const x = poi.x + gx * step;
                    const z = poi.z + gz * step;
                    if (rng() < 0.42) {
                        // a shop you can walk into
                        const rot = Math.floor(rng() * 4);
                        const h = house(x, z, 9, 9, { rot, roof: 'flat', wallH: 4.2, awning: [M.awningA, M.awningB, M.awningC][Math.floor(rng() * 3)], door: 2.4, doorH: 3 });
                        lootHouse(h, poi.id, 9, 9, 0.9);
                    } else {
                        building(x, z, BUILDINGS[Math.floor(rng() * 4)], 10, (Math.floor(rng() * 4) * Math.PI) / 2);
                    }
                }
            }
            if (models.fountain) {
                const f = models.fountain.clone(true);
                f.scale.setScalar(11);
                f.position.set(poi.x, y0 - 0.1, poi.z);
                f.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
                scene.add(f);
                addCylinder(poi.x, poi.z, 2.6, y0, y0 + 1.6, { walk: true });
            }
            for (let k = 0; k < 4; k++) {
                const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
                bench(poi.x + Math.cos(a) * 5.5, poi.z + Math.sin(a) * 5.5, a);
                lampPost(poi.x + Math.cos(a) * 7.5, poi.z + Math.sin(a) * 7.5);
            }
            // street lights and parked trucks along the streets
            for (let i = -3; i <= 3; i++) {
                for (const s of [-1, 1]) {
                    lampPost(poi.x + i * step + 3, poi.z + s * step * 0.5 + 2.5);
                }
            }
            for (let i = 0; i < 6; i++) truck(poi.x + (rng() - 0.5) * 90, poi.z + (Math.floor(rng() * 6) - 3) * step + 8.5, Math.PI / 2);
            for (let i = 0; i < 14; i++) {
                const x = poi.x + (rng() - 0.5) * 100;
                const z = poi.z + (rng() - 0.5) * 100;
                if (!blocked(x, z, 1.5)) crate(x, z);
            }
            chestSpots.push({ x: poi.x + 4, y: y0, z: poi.z + 4, poi: poi.id });
            scatterAround(poi, 8, 6, poi.r, chestSpots);
            scatterAround(poi, 18, 6, poi.r + 6, floorSpots);
            scatterAround(poi, 12, 6, poi.r, ammoSpots);
        } else if (poi.kind === 'village' || poi.kind === 'suburb') {
            // houses with gardens and fences
            const spots = poi.kind === 'suburb'
                ? [[-26, -16], [-9, -16], [8, -16], [25, -16], [-26, 16], [-9, 16], [8, 16], [25, 16]]
                : [[-16, -12], [14, -14], [-18, 12], [16, 12], [0, 24], [0, -24]];
            spots.forEach(([dx, dz]) => {
                const x = poi.x + dx;
                const z = poi.z + dz;
                const w = 7 + Math.floor(rng() * 3);
                const d = 7 + Math.floor(rng() * 2);
                // doors face the street (the middle line)
                const rot = poi.kind === 'suburb' ? (dz < 0 ? 0 : 2) : Math.floor(rng() * 4);
                const h = house(x, z, w, d, { rot });
                lootHouse(h, poi.id, w, d, 0.8);
                if (poi.kind === 'suburb') {
                    const fz = z + (dz < 0 ? 1 : -1) * (d / 2 + 3.5);
                    fenceLine(x - w / 2 - 1.5, fz, x - 1.4, fz);
                    fenceLine(x + 1.4, fz, x + w / 2 + 1.5, fz);
                }
            });
            if (poi.kind === 'suburb') {
                for (let i = 0; i < 4; i++) truck(poi.x - 30 + i * 20 + rng() * 4, poi.z + (rng() < 0.5 ? -4 : 4), Math.PI / 2);
                for (let i = -3; i <= 3; i++) lampPost(poi.x + i * 12, poi.z + 6.5);
                flagPole(poi.x + 36, poi.z, 0x2563eb);
            } else {
                // a well and a market in the middle
                const wx = poi.x + 2;
                const wz = poi.z + 10;
                const wy = terrainHeight(wx, wz);
                addGeo(new THREE.CylinderGeometry(1.3, 1.4, 1.1, 14).translate(wx, wy + 0.55, wz), M.stone);
                addGeo(new THREE.BoxGeometry(0.15, 2, 0.15).translate(wx - 1.1, wy + 1.5, wz), M.woodDark);
                addGeo(new THREE.BoxGeometry(0.15, 2, 0.15).translate(wx + 1.1, wy + 1.5, wz), M.woodDark);
                addGeo(prismGeo(3, 0.9, 2).translate(wx, wy + 2.5, wz), M.roofRed);
                addCylinder(wx, wz, 1.4, wy, wy + 1.1, { walk: true });
                for (let i = 0; i < 3; i++) {
                    const sx = poi.x - 10 + i * 6;
                    const sz = poi.z - 5;
                    const sy = terrainHeight(sx, sz);
                    solid(sx, sy, sz, 3, 0.9, 1.4, M.wood);
                    addGeo(boxGeo(sx, sy + 2.3, sz, 3.4, 0.1, 2, 0), [M.awningA, M.awningB, M.awningC][i]);
                    addGeo(boxGeo(sx - 1.5, sy + 1.15, sz + 0.8, 0.1, 2.3, 0.1), M.woodDark);
                    addGeo(boxGeo(sx + 1.5, sy + 1.15, sz + 0.8, 0.1, 2.3, 0.1), M.woodDark);
                }
                for (let i = 0; i < 8; i++) {
                    const x = poi.x + (rng() - 0.5) * 60;
                    const z = poi.z + (rng() - 0.5) * 60;
                    if (!blocked(x, z, 1.5)) crate(x, z);
                }
            }
            scatterAround(poi, 4, 4, poi.r, chestSpots);
            scatterAround(poi, 10, 4, poi.r + 6, floorSpots);
            scatterAround(poi, 6, 4, poi.r, ammoSpots);
        } else if (poi.kind === 'fort') {
            // stone walls around a yard, gates, towers, barracks and a raised platform with ramps
            const y = y0;
            const half = 18;
            const wallH = 4.5;
            for (const side of [-1, 1]) {
                solid(poi.x - 10.5, y, poi.z + side * half, 15, wallH, 1.6, M.stone);
                solid(poi.x + 10.5, y, poi.z + side * half, 15, wallH, 1.6, M.stone);
                solid(poi.x + side * half, y, poi.z - 10.5, 1.6, wallH, 15, M.stone);
                solid(poi.x + side * half, y, poi.z + 10.5, 1.6, wallH, 15, M.stone);
                // battlements
                for (let k = -8; k <= 8; k++) {
                    if (Math.abs(k) < 2) continue;
                    if (k % 2) continue;
                    addGeo(boxGeo(poi.x + k * 2.1, y + wallH + 0.4, poi.z + side * half, 1, 0.8, 1.7), M.stone);
                    addGeo(boxGeo(poi.x + side * half, y + wallH + 0.4, poi.z + k * 2.1, 1.7, 0.8, 1), M.stone);
                }
            }
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const tx = poi.x + sx * half;
                    const tz = poi.z + sz * half;
                    addGeo(new THREE.CylinderGeometry(2.6, 2.9, 8, 14).translate(tx, y + 4, tz), M.stoneDark);
                    addGeo(new THREE.ConeGeometry(3.3, 3, 14).translate(tx, y + 9.5, tz), M.roofRed);
                    addCylinder(tx, tz, 2.8, y, y + 8);
                }
            }
            solid(poi.x, y, poi.z, 9, 3, 9, M.wood);
            const rampGeo = new THREE.BoxGeometry(3, 0.3, 7.6);
            const r1 = rampGeo.clone().rotateX(Math.atan2(3, 7.2)).translate(poi.x, y + 1.5, poi.z + 8.1);
            addGeo(r1, M.woodDark);
            addRamp(poi.x - 1.5, poi.x + 1.5, poi.z + 4.5, poi.z + 11.7, y, y + 3, 'z', -1);
            const r2 = rampGeo.clone().rotateX(-Math.atan2(3, 7.2)).translate(poi.x, y + 1.5, poi.z - 8.1);
            addGeo(r2, M.woodDark);
            addRamp(poi.x - 1.5, poi.x + 1.5, poi.z - 11.7, poi.z - 4.5, y, y + 3, 'z', 1);
            chestSpots.push({ x: poi.x, y: y + 3, z: poi.z, poi: poi.id });
            const b1 = house(poi.x - 11, poi.z + 9, 9, 6, { rot: 1, wall: M.stone, roofMat: M.roofBrown });
            lootHouse(b1, poi.id, 9, 6);
            const b2 = house(poi.x + 11, poi.z - 9, 9, 6, { rot: 3, wall: M.stone, roofMat: M.roofBrown });
            lootHouse(b2, poi.id, 9, 6);
            flagPole(poi.x + 3, poi.z - 3, 0xdc2626);
            for (let i = 0; i < 6; i++) crate(poi.x + (rng() - 0.5) * 28, poi.z + (rng() - 0.5) * 28);
            scatterAround(poi, 3, 6, half - 3, chestSpots);
            scatterAround(poi, 8, 6, poi.r + 8, floorSpots);
            scatterAround(poi, 5, 6, poi.r, ammoSpots);
        } else if (poi.kind === 'warehouses') {
            // big sheds you can enter, containers stacked two high, a crane and a pier
            [[-13, -11, 0], [13, -11, 0], [-13, 12, 2], [13, 12, 2]].forEach(([dx, dz, rot]) => {
                const h = house(poi.x + dx, poi.z + dz, 14, 10, { rot, roof: 'flat', wall: M.metal, wallH: 5.5, door: 4.5, doorH: 4.2, floor: M.concrete, empty: true });
                lootHouse(h, poi.id, 14, 10, 0.95);
            });
            const mats = [M.cRed, M.cBlue, M.cGreen, M.cOrange];
            for (let i = 0; i < 9; i++) {
                const x = poi.x + (rng() - 0.5) * 60;
                const z = poi.z + (rng() - 0.5) * 60;
                if (blocked(x, z, 4)) continue;
                const along = rng() < 0.5;
                const top = container(x, z, along, mats[i % 4]);
                if (rng() < 0.45) container(x, z, along, mats[(i + 1) % 4], top);
            }
            // a crane
            {
                const x = poi.x + 2;
                const z = poi.z;
                const y = terrainHeight(x, z);
                for (const [lx, lz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
                    addGeo(boxGeo(x + lx, y + 9, z + lz, 0.4, 18, 0.4), M.yellowPaint);
                }
                for (let k = 1; k < 6; k++) addGeo(boxGeo(x, y + k * 3, z, 3.4, 0.25, 3.4), M.yellowPaint);
                addGeo(boxGeo(x + 7, y + 18.2, z, 18, 0.8, 1.2), M.yellowPaint);
                addGeo(boxGeo(x + 14, y + 13, z, 0.06, 10, 0.06), M.darkMetal);
                addGeo(boxGeo(x - 2.5, y + 18.2, z, 3, 2, 2), M.darkMetal);
                addBox(x, y, z, 3.4, 18, 3.4);
            }
            // a pier out to sea (toward the coast)
            {
                const dirX = poi.x / Math.hypot(poi.x, poi.z);
                const dirZ = poi.z / Math.hypot(poi.x, poi.z);
                for (let k = 0; k < 8; k++) {
                    const x = poi.x + dirX * (poi.r + 6 + k * 4);
                    const z = poi.z + dirZ * (poi.r + 6 + k * 4);
                    const g = terrainHeight(x, z);
                    const top = Math.max(1.2, g + 0.3);
                    if (g > 3) continue;
                    solid(x, Math.min(g, 0) - 1, z, 4.2, top - Math.min(g, 0) + 1, 4.2, M.wood);
                }
                boat(poi.x + dirX * (poi.r + 22) + dirZ * 6, poi.z + dirZ * (poi.r + 22) - dirX * 6, Math.atan2(dirX, dirZ));
            }
            for (let i = 0; i < 3; i++) truck(poi.x + (rng() - 0.5) * 40, poi.z + (rng() - 0.5) * 40, rng() < 0.5 ? 0 : Math.PI / 2);
            for (let i = 0; i < 10; i++) {
                const x = poi.x + (rng() - 0.5) * 60;
                const z = poi.z + (rng() - 0.5) * 60;
                if (!blocked(x, z, 1.5)) crate(x, z);
            }
            scatterAround(poi, 5, 3, poi.r, chestSpots);
            scatterAround(poi, 10, 3, poi.r + 6, floorSpots);
            scatterAround(poi, 7, 3, poi.r, ammoSpots);
        } else if (poi.kind === 'lighthouse') {
            const y = y0;
            for (let i = 0; i < 6; i++) {
                addGeo(new THREE.CylinderGeometry(2.4 - i * 0.2, 2.6 - i * 0.2, 3.2, 20).translate(poi.x, y + 1.6 + i * 3.2, poi.z), i % 2 ? M.red : M.whitePaint);
            }
            addGeo(new THREE.CylinderGeometry(2.0, 2.0, 0.3, 20).translate(poi.x, y + 19.4, poi.z), M.darkMetal);
            const lightMesh = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.8, 14), M.lamp.clone());
            lightMesh.position.set(poi.x, y + 20.5, poi.z);
            scene.add(lightMesh);
            addGeo(new THREE.ConeGeometry(1.9, 1.9, 14).translate(poi.x, y + 22.3, poi.z), M.red);
            addCylinder(poi.x, poi.z, 2.6, y, y + 22);
            animated.push((t) => { lightMesh.material.emissiveIntensity = 0.8 + Math.max(0, Math.sin(t * 2)) * 1.6; });
            const h = house(poi.x + 9, poi.z + 2, 7, 6, { rot: 1, wall: M.white, roofMat: M.roofBlue });
            lootHouse(h, poi.id, 7, 6, 1);
            boat(poi.x - 14, poi.z + 6, 0.6);
            scatterAround(poi, 2, 5, poi.r, chestSpots);
            scatterAround(poi, 4, 5, poi.r + 6, floorSpots);
            scatterAround(poi, 2, 5, poi.r, ammoSpots);
        } else if (poi.kind === 'farm') {
            // a red barn you can enter, a farmhouse, a silo, hay bales and a fence around the fields
            const barn = house(poi.x - 8, poi.z - 4, 12, 10, { rot: 0, wall: M.barn, roofMat: M.roofGrey, wallH: 5, door: 4, doorH: 4, ridgeAlongX: false, empty: true });
            lootHouse(barn, poi.id, 12, 10, 1);
            const fh = house(poi.x + 14, poi.z + 12, 8, 7, { rot: 3, wall: M.cream, roofMat: M.roofRed });
            lootHouse(fh, poi.id, 8, 7);
            const sx = poi.x + 9;
            const sz = poi.z - 8;
            const sy = terrainHeight(sx, sz);
            addGeo(new THREE.CylinderGeometry(2.5, 2.5, 11, 18).translate(sx, sy + 5.5, sz), M.metal);
            addGeo(new THREE.SphereGeometry(2.5, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(sx, sy + 11, sz), M.darkMetal);
            addCylinder(sx, sz, 2.5, sy, sy + 11);
            for (let i = 0; i < 12; i++) {
                const x = poi.x + (rng() - 0.5) * 56;
                const z = poi.z + (rng() - 0.5) * 56;
                if (!blocked(x, z, 1.5)) hayBale(x, z);
            }
            const R = poi.r + 4;
            for (let i = 0; i < 12; i++) {
                const a0 = (i / 12) * Math.PI * 2;
                const a1 = ((i + 1) / 12) * Math.PI * 2;
                if (i % 4 === 0) continue; // gaps to walk through
                fenceLine(poi.x + Math.cos(a0) * R, poi.z + Math.sin(a0) * R, poi.x + Math.cos(a1) * R, poi.z + Math.sin(a1) * R);
            }
            truck(poi.x - 20, poi.z + 14, 0.4);
            scatterAround(poi, 3, 4, poi.r, chestSpots);
            scatterAround(poi, 9, 4, poi.r + 6, floorSpots);
            scatterAround(poi, 5, 4, poi.r, ammoSpots);
        } else if (poi.kind === 'mountain') {
            // a radio tower on the top, a shack and lots of rocks
            const y = terrainHeight(poi.x, poi.z);
            const H = 26;
            for (const [lx, lz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
                const g = new THREE.CylinderGeometry(0.14, 0.2, H, 6);
                const tilt = 0.06;
                g.rotateZ(-Math.sign(lx) * tilt).rotateX(Math.sign(lz) * tilt);
                g.translate(poi.x + lx * 0.6, y + H / 2, poi.z + lz * 0.6);
                addGeo(g, M.red);
            }
            for (let k = 1; k < 9; k++) {
                const s = 2.6 - k * 0.12;
                addGeo(boxGeo(poi.x, y + k * 3, poi.z, s, 0.15, s), k % 2 ? M.whitePaint : M.red);
            }
            addCylinder(poi.x, poi.z, 2, y, y + H);
            const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), M.lamp.clone());
            beacon.material.color.setHex(0xff4d4d);
            beacon.material.emissive.setHex(0xff2020);
            beacon.position.set(poi.x, y + H + 0.5, poi.z);
            scene.add(beacon);
            animated.push((t) => { beacon.material.emissiveIntensity = Math.sin(t * 4) > 0 ? 2.2 : 0.2; });
            const shack = house(poi.x + 9, poi.z + 3, 6, 6, { rot: 1, wall: M.woodDark, roofMat: M.roofGrey });
            lootHouse(shack, poi.id, 6, 6, 1);
            chestSpots.push({ x: poi.x - 4, y, z: poi.z + 5, poi: poi.id });
            scatterAround(poi, 3, 10, poi.r + 20, chestSpots);
            scatterAround(poi, 6, 6, poi.r + 20, floorSpots);
            scatterAround(poi, 3, 6, poi.r + 10, ammoSpots);
        } else if (poi.kind === 'lake') {
            // cabins around the water, a pier and rowing boats
            for (let k = 0; k < 4; k++) {
                const a = (k / 4) * Math.PI * 2 + 0.4;
                const x = poi.x + Math.cos(a) * (poi.r + 6);
                const z = poi.z + Math.sin(a) * (poi.r + 6);
                // the door looks at the lake (door directions for rot 0..3: +z, +x, -z, -x)
                const dx = poi.x - x;
                const dz = poi.z - z;
                const dirs = [[0, 1], [1, 0], [0, -1], [-1, 0]];
                let rot = 0;
                dirs.forEach(([ex, ez], r) => { if (ex * dx + ez * dz > dirs[rot][0] * dx + dirs[rot][1] * dz) rot = r; });
                const h = house(x, z, 7, 6, { rot, wall: M.wood, roofMat: M.roofGreen });
                lootHouse(h, poi.id, 7, 6, 0.9);
            }
            for (let k = 0; k < 6; k++) {
                const x = poi.x - poi.r * 0.95 + k * 3.6;
                const z = poi.z;
                const g = terrainHeight(x, z);
                solid(x, Math.min(g, 0) - 1.5, z, 3.6, 1.2 - Math.min(g, 0) + 1.5, 3, M.wood);
            }
            chestSpots.push({ x: poi.x - poi.r * 0.95 + 5 * 3.6, y: 1.2, z: poi.z, poi: poi.id });
            for (let k = 0; k < 3; k++) boat(poi.x + (rng() - 0.5) * poi.r, poi.z + (rng() - 0.5) * poi.r * 0.8, rng() * 3);
            scatterAround(poi, 3, poi.r, poi.r + 14, chestSpots);
            scatterAround(poi, 8, poi.r, poi.r + 16, floorSpots);
            scatterAround(poi, 4, poi.r, poi.r + 14, ammoSpots);
        } else if (poi.kind === 'camp') {
            // tents around a campfire, picnic tables, a flag
            const fabrics = [M.fabricOrange, M.fabricGreen, M.fabricBlue, M.fabricRed];
            for (let k = 0; k < 8; k++) {
                const a = (k / 8) * Math.PI * 2;
                tent(poi.x + Math.cos(a) * 13, poi.z + Math.sin(a) * 13, -a, fabrics[k % 4]);
            }
            campfire(poi.x, poi.z);
            for (let k = 0; k < 4; k++) {
                const a = (k / 4) * Math.PI * 2 + 0.3;
                const lx = poi.x + Math.cos(a) * 3.2;
                const lz = poi.z + Math.sin(a) * 3.2;
                const ly = terrainHeight(lx, lz);
                addGeo(new THREE.CylinderGeometry(0.3, 0.3, 2.2, 8).rotateZ(Math.PI / 2).rotateY(-a + Math.PI / 2).translate(lx, ly + 0.3, lz), M.woodDark);
            }
            for (let k = 0; k < 3; k++) {
                const x = poi.x - 8 + k * 8;
                const z = poi.z - 20;
                const y = terrainHeight(x, z);
                solid(x, y, z, 2.6, 0.85, 1.2, M.wood);
                addGeo(boxGeo(x, y + 0.45, z + 1.1, 2.6, 0.1, 0.4), M.woodDark);
                addGeo(boxGeo(x, y + 0.45, z - 1.1, 2.6, 0.1, 0.4), M.woodDark);
            }
            flagPole(poi.x + 6, poi.z + 4, 0x16a34a);
            const cabin = house(poi.x, poi.z + 22, 8, 6, { rot: 2, wall: M.woodDark, roofMat: M.roofGreen });
            lootHouse(cabin, poi.id, 8, 6, 1);
            scatterAround(poi, 4, 5, poi.r, chestSpots);
            scatterAround(poi, 7, 5, poi.r + 6, floorSpots);
            scatterAround(poi, 4, 5, poi.r, ammoSpots);
        } else if (poi.kind === 'forest') {
            // a hunters' cabin hidden among the trees
            const h = house(poi.x + 6, poi.z - 4, 7, 6, { rot: 1, wall: M.woodDark, roofMat: M.roofBrown });
            lootHouse(h, poi.id, 7, 6, 1);
            campfire(poi.x - 4, poi.z + 4);
            scatterAround(poi, 5, 4, poi.r, chestSpots);
            scatterAround(poi, 8, 4, poi.r, floorSpots);
            scatterAround(poi, 4, 4, poi.r, ammoSpots);
        }
    }

    // ---- lone houses and sheds out in the wild (each with something inside)
    for (let n = 0, tries = 0; n < 18 && tries < 900; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.75;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.75;
        if (poiAt(x, z, 25) || distToRoad(x, z) < 8 || blocked(x, z, 8) || slopeAt(x, z) > 0.35) continue;
        const small = rng() < 0.4;
        const w = small ? 5 : 7;
        const d = small ? 5 : 6;
        const h = house(x, z, w, d, { rot: Math.floor(rng() * 4), wall: small ? M.woodDark : undefined, empty: small });
        lootHouse(h, null, w, d, 0.9);
        n++;
    }

    // ---- turn the batches into meshes
    for (const [material, list] of batches) {
        const geo = mergeGeometries(list, false);
        if (material.map) worldUV(geo, material.userData.uvScale || 2);
        const m = new THREE.Mesh(geo, material);
        m.castShadow = true;
        m.receiveShadow = true;
        scene.add(m);
    }
    batches.clear();

    // ---- trees (instanced: pine, oak, birch), rocks, bushes, flowers
    function vColors(geo, fn) {
        const pos = geo.attributes.position;
        const col = new Float32Array(pos.count * 3);
        const c = new THREE.Color();
        for (let i = 0; i < pos.count; i++) {
            fn(pos.getX(i), pos.getY(i), pos.getZ(i), c);
            col[i * 3] = c.r;
            col[i * 3 + 1] = c.g;
            col[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return geo;
    }
    const nonIdx = (g) => (g.index ? g.toNonIndexed() : g);
    const trunkC = new THREE.Color(0x6e4a2c);
    const pineGeo = mergeGeometries([
        vColors(nonIdx(new THREE.CylinderGeometry(0.22, 0.38, 2.6, 7).translate(0, 1.3, 0)), (x, y, z, c) => c.copy(trunkC)),
        ...[[2.3, 3.2, 3.3], [1.85, 2.8, 4.9], [1.35, 2.4, 6.3], [0.85, 1.9, 7.5]].map(([r, h, y]) =>
            vColors(nonIdx(new THREE.ConeGeometry(r, h, 9).translate(0, y, 0)), (x, yy, z, c) => {
                // darker underneath each layer, lighter at the tips
                const k = (yy - (y - h / 2)) / h;
                c.setRGB(0.62 + k * 0.5, 0.75 + k * 0.4, 0.62 + k * 0.4);
            })),
    ]);
    // low-poly leaf blobs (detail 0 keeps the big island light to draw)
    const blob = (r, x, y, z, detail = 0) => vColors(nonIdx(new THREE.IcosahedronGeometry(r, detail).translate(x, y, z)), (px, py, pz, c) => {
        const k = Math.max(0, Math.min(1, (py - (y - r)) / (2 * r)));
        c.setRGB(0.7 + k * 0.45, 0.8 + k * 0.35, 0.7 + k * 0.3);
    });
    const oakGeo = mergeGeometries([
        vColors(nonIdx(new THREE.CylinderGeometry(0.28, 0.42, 3.0, 7).translate(0, 1.5, 0)), (x, y, z, c) => c.copy(trunkC)),
        vColors(nonIdx(new THREE.CylinderGeometry(0.12, 0.18, 1.6, 5).rotateZ(0.8).translate(0.6, 3.2, 0)), (x, y, z, c) => c.copy(trunkC)),
        blob(2.1, 0, 4.4, 0, 1), blob(1.5, 1.4, 4.9, 0.5), blob(1.4, -1.2, 4.7, -0.6), blob(1.3, 0.2, 5.8, -0.2),
    ]);
    const birchGeo = mergeGeometries([
        vColors(nonIdx(new THREE.CylinderGeometry(0.16, 0.24, 4.2, 7, 6).translate(0, 2.1, 0)), (x, y, z, c) => {
            // white bark with dark marks
            const mark = Math.sin(y * 7.3 + x * 20) > 0.75;
            c.setHex(mark ? 0x3a3a3a : 0xf0efe8);
        }),
        blob(1.3, 0, 4.9, 0), blob(1.0, 0.7, 5.8, 0.2), blob(0.9, -0.6, 5.5, -0.4),
    ]);

    const treeSpots = [];
    const forest = P.forest;
    for (let tries = 0; tries < 30000 && treeSpots.length < 2600; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS;
        const h = terrainHeight(x, z);
        if (h < 2.2 || h > 38) continue;
        const poi = poiAt(x, z, 4);
        const inForest = Math.hypot(x - forest.x, z - forest.z) < forest.r + 14;
        if (poi && poi.kind !== 'forest' && poi.kind !== 'mountain') continue;
        if (!inForest && fbm(x * 0.012, z * 0.012, 5) < 0.5) continue; // groves, not an even carpet
        if (distToRoad(x, z) < 5) continue;
        if (blocked(x, z, 2.2)) continue;
        const kindRoll = rng();
        const kind = inForest || h > 22 ? (kindRoll < 0.8 ? 0 : 2) : kindRoll < 0.35 ? 0 : kindRoll < 0.8 ? 1 : 2;
        const s = 0.85 + rng() * 0.6;
        treeSpots.push({ x, z, h, kind, s });
        addCylinder(x, z, 0.45 * s, h, h + 2.6 * s);
        addCylinder(x, z, (kind === 1 ? 2.2 : 1.7) * s, h + 2.6 * s, h + 7.8 * s, { foliage: true });
    }
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    const TREE_GREENS = [
        [0x2f7a3a, 0x2a6e35, 0x3b8a3f, 0x24683a],        // pines
        [0x4f9a3a, 0x5aa43f, 0x6aae44, 0x468f36, 0x7cb342], // oaks
        [0x8fc04c, 0x9bc95a, 0x7fb446],                  // birches
    ];
    [pineGeo, oakGeo, birchGeo].forEach((geo, kind) => {
        const spots = treeSpots.filter((t) => t.kind === kind);
        const im = new THREE.InstancedMesh(geo, treeMat, spots.length);
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const greens = TREE_GREENS[kind];
        spots.forEach((t, i) => {
            q.setFromAxisAngle(up, rng() * Math.PI * 2);
            m4.compose(new THREE.Vector3(t.x, t.h - 0.15, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + rng() * 0.25), t.s));
            im.setMatrixAt(i, m4);
            im.setColorAt(i, new THREE.Color(greens[Math.floor(rng() * greens.length)]));
        });
        im.castShadow = true;
        im.receiveShadow = true;
        scene.add(im);
    });

    // rocks: lumpy stones with moss on top
    {
        const variants = [0, 1, 2].map((v) => {
            const g = nonIdx(new THREE.IcosahedronGeometry(1, 1));
            const p = g.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = p.getX(i);
                const y = p.getY(i);
                const z = p.getZ(i);
                const k = 0.78 + valueNoise(x * 2.1 + v * 5, z * 2.1 + y * 1.7, 31 + v) * 0.45;
                p.setXYZ(i, x * k, y * k * (v === 2 ? 0.6 : 0.85), z * k);
            }
            g.computeVertexNormals();
            return vColors(g, (x, y, z, c) => {
                const moss = smoothstep(0.35, 0.8, y + valueNoise(x * 3, z * 3, 7) * 0.3);
                c.setHex(0xa29e96).lerp(new THREE.Color(0x6f9a4a), moss * 0.85);
            });
        });
        const spots = [[], [], []];
        for (let tries = 0; tries < 12000 && spots.flat().length < 620; tries++) {
            const x = (rng() * 2 - 1) * ISLAND_RADIUS;
            const z = (rng() * 2 - 1) * ISLAND_RADIUS;
            const h = terrainHeight(x, z);
            const nearMountain = Math.hypot(x - P.mountain.x, z - P.mountain.z) < 90;
            if (h < 1.0 || (poiAt(x, z, 3) && !nearMountain) || blocked(x, z, 2)) continue;
            if (!nearMountain && rng() < 0.35) continue;
            const s = 0.7 + rng() * (nearMountain ? 3.2 : 2.2);
            spots[Math.floor(rng() * 3)].push({ x, z, h, s });
            addCylinder(x, z, s * 0.85, h - 0.5, h + s * 0.95, { walk: true });
        }
        const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
        variants.forEach((geo, v) => {
            const im = new THREE.InstancedMesh(geo, rockMat, spots[v].length);
            const m4 = new THREE.Matrix4();
            const e = new THREE.Euler();
            spots[v].forEach((r, i) => {
                e.set((rng() - 0.5) * 0.4, rng() * 6, (rng() - 0.5) * 0.4);
                m4.compose(new THREE.Vector3(r.x, r.h + r.s * 0.2, r.z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(r.s, r.s, r.s));
                im.setMatrixAt(i, m4);
            });
            im.castShadow = true;
            im.receiveShadow = true;
            scene.add(im);
        });
    }

    // bushes: you can hide in them (bots can't see through), bullets pass
    {
        const geo = mergeGeometries([blob(1, 0, 0, 0), blob(0.75, 0.75, -0.1, 0.25), blob(0.7, -0.65, -0.15, -0.3)]);
        const spots = [];
        for (let tries = 0; tries < 9000 && spots.length < 1100; tries++) {
            const x = (rng() * 2 - 1) * ISLAND_RADIUS;
            const z = (rng() * 2 - 1) * ISLAND_RADIUS;
            const h = terrainHeight(x, z);
            if (h < 1.8 || h > 36 || blocked(x, z, 1.6) || distToRoad(x, z) < 4) continue;
            const poi = poiAt(x, z, 2);
            if (poi && (poi.kind === 'city' || poi.kind === 'warehouses') && rng() < 0.8) continue;
            const s = 0.85 + rng() * 0.6;
            spots.push({ x, z, h, s });
            addCylinder(x, z, s * 1.15, h - 0.2, h + s * 1.4, { foliage: true });
        }
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), spots.length);
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        spots.forEach((b, i) => {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * 6);
            m4.compose(new THREE.Vector3(b.x, b.h + b.s * 0.55, b.z), q, new THREE.Vector3(b.s * 1.15, b.s, b.s * 1.15));
            im.setMatrixAt(i, m4);
            im.setColorAt(i, new THREE.Color().setHSL(0.26 + rng() * 0.07, 0.5, 0.33 + rng() * 0.08));
        });
        im.castShadow = true;
        im.receiveShadow = true;
        scene.add(im);
    }

    // flowers: stems + coloured heads, in meadows
    {
        const stems = [];
        for (let tries = 0; tries < 20000 && stems.length < 2400; tries++) {
            const x = (rng() * 2 - 1) * ISLAND_RADIUS;
            const z = (rng() * 2 - 1) * ISLAND_RADIUS;
            if (!isGrass(x, z) || fbm(x * 0.02, z * 0.02, 41) < 0.5) continue;
            // little clumps
            for (let k = 0; k < 5 && stems.length < 2400; k++) {
                const fx = x + (rng() - 0.5) * 3;
                const fz = z + (rng() - 0.5) * 3;
                if (!isGrass(fx, fz)) continue;
                stems.push({ x: fx, z: fz, h: terrainHeight(fx, fz), s: 0.7 + rng() * 0.6 });
            }
        }
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.5, 4).translate(0, 0.25, 0);
        const headGeo = new THREE.IcosahedronGeometry(0.11, 0).translate(0, 0.52, 0);
        const stemIm = new THREE.InstancedMesh(stemGeo, new THREE.MeshLambertMaterial({ color: 0x3f8f3a }), stems.length);
        const headIm = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x222222 }), stems.length);
        const FLOWER = [0xffffff, 0xffe04a, 0xff7eb6, 0xb18cff, 0xff5a4a, 0x7ec8ff];
        const m4 = new THREE.Matrix4();
        stems.forEach((f, i) => {
            m4.makeScale(f.s, f.s, f.s).setPosition(f.x, f.h, f.z);
            stemIm.setMatrixAt(i, m4);
            headIm.setMatrixAt(i, m4);
            headIm.setColorAt(i, new THREE.Color(FLOWER[Math.floor(rng() * FLOWER.length)]));
        });
        scene.add(stemIm, headIm);
    }

    // ---- grass tufts: only near you (they follow you around)
    function isGrass(x, z) {
        const i = Math.round((x + MAP_HALF) / CELL);
        const j = Math.round((z + MAP_HALF) / CELL);
        if (i < 0 || j < 0 || i > SEG || j > SEG) return false;
        return grassMask[j * W1 + i] === 1;
    }
    const GRASS_R = 40;
    const GRASS_STEP = 1.25;
    const grassMax = Math.ceil(Math.PI * (GRASS_R / GRASS_STEP) ** 2);
    let grass = null;
    if (opts.grass !== false) {
        const blades = [];
        for (let b = 0; b < 6; b++) {
            const a = (b / 6) * Math.PI * 2 + b;
            const h = 0.3 + (b % 3) * 0.08;
            const lean = 0.12;
            const ox = Math.cos(a) * 0.12;
            const oz = Math.sin(a) * 0.12;
            const g = new THREE.BufferGeometry();
            const bx = Math.cos(a + Math.PI / 2) * 0.05;
            const bz = Math.sin(a + Math.PI / 2) * 0.05;
            g.setAttribute('position', new THREE.Float32BufferAttribute([
                ox - bx, 0, oz - bz, ox + bx, 0, oz + bz, ox + Math.cos(a) * lean, h, oz + Math.sin(a) * lean,
            ], 3));
            g.setAttribute('color', new THREE.Float32BufferAttribute([0.72, 0.82, 0.6, 0.72, 0.82, 0.6, 1.05, 1.05, 0.85], 3));
            g.computeVertexNormals();
            // light the blades as if they pointed up (looks right from every side)
            g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
            blades.push(g);
        }
        const geo = mergeGeometries(blades);
        grass = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), grassMax);
        grass.count = 0;
        grass.frustumCulled = false;
        scene.add(grass);
    }
    const grassLast = { x: Infinity, z: Infinity };
    const gm4 = new THREE.Matrix4();
    const gq = new THREE.Quaternion();
    const gs = new THREE.Vector3();
    const gp = new THREE.Vector3();
    const gc = new THREE.Color();
    const gup = new THREE.Vector3(0, 1, 0);
    function updateGrass(x, z) {
        if (!grass) return;
        if (Math.hypot(x - grassLast.x, z - grassLast.z) < 5) return;
        grassLast.x = x;
        grassLast.z = z;
        const cx = Math.round(x / GRASS_STEP);
        const cz = Math.round(z / GRASS_STEP);
        const n = Math.ceil(GRASS_R / GRASS_STEP);
        let k = 0;
        for (let i = -n; i <= n; i++) {
            for (let j = -n; j <= n; j++) {
                if (i * i + j * j > n * n || k >= grassMax) continue;
                const gx = cx + i;
                const gz = cz + j;
                const r1 = hash2(gx, gz, 5);
                if (r1 < 0.25) continue;
                const px = gx * GRASS_STEP + (hash2(gx, gz, 6) - 0.5) * GRASS_STEP;
                const pz = gz * GRASS_STEP + (hash2(gx, gz, 7) - 0.5) * GRASS_STEP;
                if (!isGrass(px, pz)) continue;
                const s = 0.8 + hash2(gx, gz, 8) * 0.6;
                gq.setFromAxisAngle(gup, r1 * 20);
                gs.set(s, s * (0.75 + hash2(gx, gz, 9) * 0.45), s);
                gp.set(px, terrainHeight(px, pz) - 0.03, pz);
                gm4.compose(gp, gq, gs);
                grass.setMatrixAt(k, gm4);
                // take the ground colour so the grass blends in
                const vi = (Math.round((pz + MAP_HALF) / CELL) * W1 + Math.round((px + MAP_HALF) / CELL)) * 3;
                gc.setRGB(colors[vi] * 1.25, colors[vi + 1] * 1.2, colors[vi + 2] * 1.1);
                grass.setColorAt(k, gc);
                k++;
            }
        }
        grass.count = k;
        grass.instanceMatrix.needsUpdate = true;
        if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
    }

    // ---- loot out in the open too
    for (let tries = 0; tries < 9000 && floorSpots.length < 330; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        if (poiAt(x, z, 8) || blocked(x, z, 1.5)) continue;
        floorSpots.push({ x, y: terrainHeight(x, z), z, poi: null });
    }
    for (let tries = 0; tries < 9000 && chestSpots.length < 150; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.85;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.85;
        if (blocked(x, z, 2)) continue;
        chestSpots.push({ x, y: terrainHeight(x, z), z, poi: null });
    }
    for (let tries = 0; tries < 6000 && ammoSpots.length < 140; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.85;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.85;
        if (blocked(x, z, 1.5)) continue;
        ammoSpots.push({ x, y: terrainHeight(x, z), z, poi: null });
    }
    // coins: little rows along the roads and around the places
    for (let tries = 0; tries < 20000 && coinSpots.length < 760; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        const nearRoad = distToRoad(x, z) < 2.5;
        if (!nearRoad && !poiAt(x, z, 4) && rng() < 0.85) continue;
        if (blocked(x, z, 1)) continue;
        const a = rng() * Math.PI * 2;
        for (let k = 0; k < 4; k++) {
            const cx = x + Math.cos(a) * k * 1.6;
            const cz = z + Math.sin(a) * k * 1.6;
            if (blocked(cx, cz, 0.8)) break;
            coinSpots.push({ x: cx, y: terrainHeight(cx, cz), z: cz });
        }
    }

    // ---- collision queries
    const tmp = [];

    // Height you stand on at (x, z) if your feet are at feetY: terrain, or the top of
    // something you can step onto (up to stepUp higher than your feet).
    function supportHeight(x, z, feetY, radius = 0.4, stepUp = 0.55) {
        let h = terrainHeight(x, z);
        for (const c of grid.near(x, z, radius + 1, tmp)) {
            if (c.foliage) continue;
            if (c.type === 'box') {
                if (!c.walk) continue;
                if (x + radius * 0.6 > c.minX && x - radius * 0.6 < c.maxX && z + radius * 0.6 > c.minZ && z - radius * 0.6 < c.maxZ) {
                    if (c.maxY <= feetY + stepUp && c.maxY > h) h = c.maxY;
                }
            } else if (c.type === 'cyl') {
                if (!c.walk) continue;
                if (Math.hypot(x - c.x, z - c.z) < c.r * 0.85 && c.y1 <= feetY + stepUp && c.y1 > h) h = c.y1;
            } else if (c.type === 'ramp') {
                if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ) {
                    const t = rampTop(c, x, z);
                    if (t <= feetY + stepUp + 0.4 && t > h) h = t;
                }
            }
        }
        return h;
    }

    // Push a standing capsule (feet at pos.y, height h) out of walls. Returns true if it bumped.
    function pushOut(pos, radius, height, stepUp = 0.55) {
        let bumped = false;
        for (const c of grid.near(pos.x, pos.z, radius + 1, tmp)) {
            if (c.foliage || c.type === 'ramp') continue;
            const top = c.type === 'box' ? c.maxY : c.y1;
            const bottom = c.type === 'box' ? c.minY : c.y0;
            if (pos.y >= top - stepUp || pos.y + height <= bottom) continue; // over it, or under it
            if (c.type === 'box') {
                const cx = Math.max(c.minX, Math.min(pos.x, c.maxX));
                const cz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
                let dx = pos.x - cx;
                let dz = pos.z - cz;
                const d2 = dx * dx + dz * dz;
                if (d2 >= radius * radius) continue;
                if (d2 < 1e-8) {
                    // inside: push out along the shortest side
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
                const dx = pos.x - c.x;
                const dz = pos.z - c.z;
                const d = Math.hypot(dx, dz);
                const min = c.r + radius;
                if (d >= min) continue;
                if (d < 1e-6) {
                    pos.x = c.x + min;
                } else {
                    pos.x = c.x + (dx / d) * min;
                    pos.z = c.z + (dz / d) * min;
                }
                bumped = true;
            }
        }
        // the edge of the world
        const r = Math.hypot(pos.x, pos.z);
        if (r > MAP_HALF - 6) {
            pos.x *= (MAP_HALF - 6) / r;
            pos.z *= (MAP_HALF - 6) / r;
        }
        return bumped;
    }

    // Ray against the world. Returns the distance to the first hit (or maxDist).
    // opts.foliage: also stop at leaves/bushes (used for "can I see you", not for bullets)
    const rayCells = [];
    const seen = new Set();
    function raycast(o, d, maxDist, o2 = {}) {
        let best = maxDist;
        // colliders along the ray: sample cells every few units
        seen.clear();
        rayCells.length = 0;
        const step = 8;
        for (let s = 0; s <= maxDist + step; s += step) {
            const t = Math.min(s, maxDist);
            grid.near(o.x + d.x * t, o.z + d.z * t, step, tmp);
            for (const c of tmp) {
                if (!seen.has(c)) {
                    seen.add(c);
                    rayCells.push(c);
                }
            }
        }
        for (const c of rayCells) {
            if (c.type === 'ramp') continue;
            if (c.foliage && !o2.foliage) continue;
            let hit = Infinity;
            if (c.type === 'box') hit = rayBox(o, d, c);
            else hit = rayCyl(o, d, c);
            if (hit < best) best = hit;
        }
        if (o2.noTerrain) return best;
        // terrain: march, then refine
        const stepT = 1.5;
        let prevT = 0;
        for (let t = stepT; t < best + stepT; t += stepT) {
            const tt = Math.min(t, best);
            const y = o.y + d.y * tt;
            if (y < terrainHeight(o.x + d.x * tt, o.z + d.z * tt)) {
                let lo = prevT;
                let hi = tt;
                for (let k = 0; k < 8; k++) {
                    const mid = (lo + hi) / 2;
                    if (o.y + d.y * mid < terrainHeight(o.x + d.x * mid, o.z + d.z * mid)) hi = mid;
                    else lo = mid;
                }
                best = Math.min(best, hi);
                break;
            }
            prevT = tt;
            if (tt >= best) break;
        }
        // the water stops bullets too
        if (d.y < 0 && o.y > 0) best = Math.min(best, o.y / -d.y);
        return best;
    }

    function rayBox(o, d, c) {
        let tmin = 0;
        let tmax = Infinity;
        const axes = [[o.x, d.x, c.minX, c.maxX], [o.y, d.y, c.minY, c.maxY], [o.z, d.z, c.minZ, c.maxZ]];
        for (let i = 0; i < 3; i++) {
            const [oa, da, mn, mx] = axes[i];
            if (Math.abs(da) < 1e-9) {
                if (oa < mn || oa > mx) return Infinity;
            } else {
                let t1 = (mn - oa) / da;
                let t2 = (mx - oa) / da;
                if (t1 > t2) [t1, t2] = [t2, t1];
                tmin = Math.max(tmin, t1);
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return Infinity;
            }
        }
        return tmin;
    }

    function rayCyl(o, d, c) {
        // infinite vertical cylinder, then clip to height
        const ox = o.x - c.x;
        const oz = o.z - c.z;
        const a = d.x * d.x + d.z * d.z;
        const b = 2 * (ox * d.x + oz * d.z);
        const cc = ox * ox + oz * oz - c.r * c.r;
        if (a < 1e-9) {
            if (cc > 0) return Infinity;
            // straight up/down inside the cylinder
            const t = d.y > 0 ? (c.y0 - o.y) / d.y : (c.y1 - o.y) / d.y;
            return t >= 0 ? t : (o.y >= c.y0 && o.y <= c.y1 ? 0 : Infinity);
        }
        const disc = b * b - 4 * a * cc;
        if (disc < 0) return Infinity;
        const sq = Math.sqrt(disc);
        let t1 = (-b - sq) / (2 * a);
        const t2 = (-b + sq) / (2 * a);
        if (t2 < 0) return Infinity;
        t1 = Math.max(0, t1);
        // clip to the y range
        const y1 = o.y + d.y * t1;
        if (y1 >= c.y0 && y1 <= c.y1) return t1;
        // enters through the top or bottom cap?
        if (Math.abs(d.y) < 1e-9) return Infinity;
        const capY = y1 > c.y1 ? c.y1 : c.y0;
        const tc = (capY - o.y) / d.y;
        if (tc >= t1 && tc <= t2) return tc;
        return Infinity;
    }

    // Can an eye at a see a point at b? (foliage blocks sight)
    const dirTmp = new THREE.Vector3();
    function lineOfSight(a, b, foliage = true) {
        dirTmp.subVectors(b, a);
        const dist = dirTmp.length();
        if (dist < 0.01) return true;
        dirTmp.divideScalar(dist);
        return raycast(a, dirTmp, dist, { foliage }) >= dist - 0.6;
    }

    // ---- the minimap picture (drawn once, from the terrain colours)
    const minimap = document.createElement('canvas');
    {
        const size = 512;
        minimap.width = size;
        minimap.height = size;
        const ctx = minimap.getContext('2d');
        const small = document.createElement('canvas');
        small.width = W1;
        small.height = W1;
        const sctx = small.getContext('2d');
        const img = sctx.createImageData(W1, W1);
        for (let k = 0; k < W1 * W1; k++) {
            const h = heights[k];
            let r;
            let g;
            let b;
            if (h < -0.2) {
                const deep = Math.min(1, -h / 8);
                r = 0x2f * (1 - deep) + 0x1d * deep;
                g = 0x8f * (1 - deep) + 0x5f * deep;
                b = 0xd8 * (1 - deep) + 0x9a * deep;
            } else {
                const shade = 0.85 + Math.min(0.3, h / 80);
                r = colors[k * 3] * 255 * shade;
                g = colors[k * 3 + 1] * 255 * shade;
                b = colors[k * 3 + 2] * 255 * shade;
            }
            img.data[k * 4] = r;
            img.data[k * 4 + 1] = g;
            img.data[k * 4 + 2] = b;
            img.data[k * 4 + 3] = 255;
        }
        sctx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(small, 0, 0, size, size);
        const sc = size / (MAP_HALF * 2);
        ctx.fillStyle = 'rgba(30, 90, 30, 0.35)';
        treeSpots.forEach((t) => ctx.fillRect((t.x + MAP_HALF) * sc - 1, (t.z + MAP_HALF) * sc - 1, 2, 2));
        // buildings as dark shapes
        ctx.fillStyle = 'rgba(55, 45, 38, 0.8)';
        for (const col of grid.all) {
            if (col.type !== 'box' || col.maxY - col.minY < 0.5) continue;
            if (col.maxX - col.minX < 1.5 && col.maxZ - col.minZ < 1.5) continue;
            ctx.fillRect((col.minX + MAP_HALF) * sc, (col.minZ + MAP_HALF) * sc, Math.max(1, (col.maxX - col.minX) * sc), Math.max(1, (col.maxZ - col.minZ) * sc));
        }
    }

    return {
        terrainHeight,
        supportHeight,
        pushOut,
        raycast,
        lineOfSight,
        poiAt,
        isGrass,
        // the house whose inside this point is in (or null)
        houseAt(x, z, y) {
            for (const h of houses) {
                if (x > h.minX && x < h.maxX && z > h.minZ && z < h.maxZ && (y === undefined || Math.abs(y - h.y) < 2)) return h;
            }
            return null;
        },
        chestSpots,
        floorSpots,
        ammoSpots,
        coinSpots,
        minimap,
        water,
        updateGrass,
        setGrass(on) {
            if (grass) grass.visible = on;
        },
        update(t) {
            water.position.y = Math.sin(t * 0.6) * 0.06;
            waterTex.offset.set(t * 0.004, t * 0.0025);
            for (const f of animated) f(t);
        },
    };
}
