/**
 * The island: terrain, water, sky, towns, forests, rocks and everything you
 * can bump into or shoot through. Also answers "how high is the ground here",
 * "what does this bullet hit" and "can this bot see that player".
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../shared/lib/utils/BufferGeometryUtils.js';

export const MAP_HALF = 180;           // the world goes from -180 to 180 on x and z
export const ISLAND_RADIUS = 160;
const SEG = 160;                       // terrain grid cells per side
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
    { id: 'city', name: 'עיר הספרים', x: 5, z: 5, r: 34, kind: 'city' },
    { id: 'village', name: 'הכפר השקט', x: -92, z: -62, r: 24, kind: 'village' },
    { id: 'fort', name: 'המבצר', x: 88, z: -82, r: 20, kind: 'fort' },
    { id: 'forest', name: 'יער האורנים', x: -70, z: 78, r: 36, kind: 'forest' },
    { id: 'docks', name: 'המחסנים', x: 98, z: 66, r: 24, kind: 'warehouses' },
    { id: 'lighthouse', name: 'המגדלור', x: -136, z: 14, r: 13, kind: 'lighthouse' },
    { id: 'farm', name: 'החווה', x: 14, z: -108, r: 24, kind: 'farm' },
];

// ------------------------------------------------------------- terrain shape
function rawHeight(x, z) {
    const r = Math.hypot(x, z);
    const land = 1 - smoothstep(ISLAND_RADIUS * 0.74, ISLAND_RADIUS * 0.99, r);
    let h = 1.6 + fbm(x * 0.012, z * 0.012, 7) * 15 + fbm(x * 0.05, z * 0.05, 3) * 2.2;
    // a big hill under the fort
    const fort = POIS[2];
    const dFort = Math.hypot(x - fort.x, z - fort.z);
    h += Math.exp(-(dFort * dFort) / (2 * 30 * 30)) * 13;
    return h * land - (1 - land) * 7;
}

const poiHeights = POIS.map((p) => Math.max(2.2, rawHeight(p.x, p.z)));

function shapedHeight(x, z) {
    let h = rawHeight(x, z);
    POIS.forEach((p, i) => {
        if (p.kind === 'forest') return; // forests keep their bumps
        const d = Math.hypot(x - p.x, z - p.z);
        const w = 1 - smoothstep(p.r * 0.8, p.r * 1.45, d);
        h = h + (poiHeights[i] - h) * w;
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
        return ix * 4096 + iz;
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
export function createWorld(scene, models) {
    const rng = makeRng(20261022);
    const grid = new ColliderGrid();
    const heights = new Float32Array((SEG + 1) * (SEG + 1));
    for (let j = 0; j <= SEG; j++) {
        for (let i = 0; i <= SEG; i++) {
            heights[j * (SEG + 1) + i] = shapedHeight(-MAP_HALF + i * CELL, -MAP_HALF + j * CELL);
        }
    }

    // exact height of the terrain mesh at (x, z) (same triangles as the mesh)
    function terrainHeight(x, z) {
        const gx = (x + MAP_HALF) / CELL;
        const gz = (z + MAP_HALF) / CELL;
        if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return -7;
        const i = Math.floor(gx);
        const j = Math.floor(gz);
        const fx = gx - i;
        const fz = gz - j;
        const w = SEG + 1;
        const h00 = heights[j * w + i];
        const h10 = heights[j * w + i + 1];
        const h01 = heights[(j + 1) * w + i];
        const h11 = heights[(j + 1) * w + i + 1];
        if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
        return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }

    function slopeAt(x, z) {
        const e = 1.5;
        const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
        const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
        return Math.hypot(dx, dz) / (2 * e);
    }

    const poiAt = (x, z, pad = 0) => POIS.find((p) => Math.hypot(x - p.x, z - p.z) < p.r + pad);

    // ---- paths between places (coloured dirt on the terrain)
    const PATHS = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 6], [1, 5], [1, 3], [2, 6], [2, 4], [3, 5]];
    function distToPath(x, z) {
        let best = Infinity;
        for (const [a, b] of PATHS) {
            const A = POIS[a];
            const B = POIS[b];
            const vx = B.x - A.x;
            const vz = B.z - A.z;
            const t = Math.max(0, Math.min(1, ((x - A.x) * vx + (z - A.z) * vz) / (vx * vx + vz * vz)));
            // a gentle wiggle so roads don't look ruler-straight
            const wig = Math.sin(t * Math.PI * 3 + a) * 6 * Math.sin(t * Math.PI);
            const px = A.x + vx * t + (-vz / Math.hypot(vx, vz)) * wig;
            const pz = A.z + vz * t + (vx / Math.hypot(vx, vz)) * wig;
            best = Math.min(best, Math.hypot(x - px, z - pz));
        }
        return best;
    }

    // ---- ground colours
    const C = {
        grass1: new THREE.Color(0x6fbf4a),
        grass2: new THREE.Color(0x58a83c),
        grass3: new THREE.Color(0x8ccf5a),
        sand: new THREE.Color(0xe9d59b),
        rock: new THREE.Color(0x9b9a92),
        dirt: new THREE.Color(0xb58c5b),
        town: new THREE.Color(0xcfc8b8),
        farm: new THREE.Color(0xc9b25a),
        under: new THREE.Color(0xc2b07a),
    };
    function groundColor(x, z, h, out) {
        const n = fbm(x * 0.06, z * 0.06, 11);
        if (h < 0.4) return out.copy(C.under);
        if (h < 1.9) return out.copy(C.sand).lerp(C.grass1, smoothstep(1.2, 1.9, h));
        out.copy(C.grass2).lerp(C.grass1, n);
        if (n > 0.62) out.lerp(C.grass3, (n - 0.62) * 2);
        const slope = slopeAt(x, z);
        if (slope > 0.55 || h > 19) out.lerp(C.rock, Math.min(1, Math.max(smoothstep(0.55, 0.9, slope), smoothstep(19, 23, h))));
        const poi = poiAt(x, z, 4);
        if (poi && (poi.kind === 'city' || poi.kind === 'warehouses' || poi.kind === 'village')) {
            const d = Math.hypot(x - poi.x, z - poi.z);
            out.lerp(C.town, 1 - smoothstep(poi.r * 0.75, poi.r + 4, d));
        } else if (poi && poi.kind === 'farm') {
            const d = Math.hypot(x - poi.x, z - poi.z);
            const rows = (Math.sin(x * 0.9) > 0.2 ? 1 : 0.75);
            out.lerp(C.farm.clone().multiplyScalar(rows), (1 - smoothstep(poi.r * 0.5, poi.r + 2, d)) * 0.85);
        }
        const dp = distToPath(x, z);
        if (dp < 3.2 && h > 1.6) out.lerp(C.dirt, 1 - smoothstep(1.6, 3.2, dp));
        return out;
    }

    // ---- terrain mesh
    {
        const w = SEG + 1;
        const pos = new Float32Array(w * w * 3);
        const col = new Float32Array(w * w * 3);
        const c = new THREE.Color();
        for (let j = 0; j < w; j++) {
            for (let i = 0; i < w; i++) {
                const x = -MAP_HALF + i * CELL;
                const z = -MAP_HALF + j * CELL;
                const h = heights[j * w + i];
                const k = (j * w + i) * 3;
                pos[k] = x;
                pos[k + 1] = h;
                pos[k + 2] = z;
                groundColor(x, z, h, c);
                col[k] = c.r;
                col[k + 1] = c.g;
                col[k + 2] = c.b;
            }
        }
        const idx = [];
        for (let j = 0; j < SEG; j++) {
            for (let i = 0; i < SEG; i++) {
                const a = j * w + i;      // (i, j)
                const b = a + 1;          // (i+1, j)
                const d = a + w;          // (i, j+1)
                const e = d + 1;          // (i+1, j+1)
                idx.push(a, d, b, b, d, e);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        geo.setIndex(idx);
        const ng = geo.toNonIndexed();
        ng.computeVertexNormals();
        const terrain = new THREE.Mesh(ng, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
        terrain.receiveShadow = true;
        scene.add(terrain);
    }

    // ---- water
    const waterGeo = new THREE.PlaneGeometry(1400, 1400, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(waterGeo, new THREE.MeshStandardMaterial({
        color: 0x2f8fd8, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.88, emissive: 0x0b3a66, emissiveIntensity: 0.25,
    }));
    water.position.y = 0;
    scene.add(water);
    // a lighter ring where waves meet the beach
    const foam = new THREE.Mesh(new THREE.RingGeometry(ISLAND_RADIUS * 0.93, ISLAND_RADIUS * 1.0, 96), new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.35, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2;
    foam.position.y = 0.05;
    scene.add(foam);

    // ---- helpers to place things and register colliders
    function addBox(cx, y0, cz, sx, sy, sz, opts = {}) {
        const c = {
            type: 'box',
            minX: cx - sx / 2, maxX: cx + sx / 2,
            minY: y0, maxY: y0 + sy,
            minZ: cz - sz / 2, maxZ: cz + sz / 2,
            walk: opts.walk !== false,
            foliage: Boolean(opts.foliage),
        };
        c.bminX = c.minX; c.bmaxX = c.maxX; c.bminZ = c.minZ; c.bmaxZ = c.maxZ;
        grid.add(c);
        return c;
    }

    function addCylinder(x, z, r, y0, y1, opts = {}) {
        const c = { type: 'cyl', x, z, r, y0, y1, walk: Boolean(opts.walk), foliage: Boolean(opts.foliage) };
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

    const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
    const M = {
        wood: mat(0xa0703c),
        woodDark: mat(0x7a5230),
        stone: mat(0xa8a39a, { flatShading: true }),
        stoneDark: mat(0x857f76, { flatShading: true }),
        white: mat(0xf2f0ea),
        red: mat(0xc0392b),
        roof: mat(0x8e3b2f),
        metal: mat(0x7c8a99, { metalness: 0.3, roughness: 0.5 }),
        hay: mat(0xe3c565),
        crate: mat(0xc28a4a),
        fence: mat(0xd9b98c),
    };

    function mesh(geo, material, x, y, z, ry = 0, cast = true) {
        const m = new THREE.Mesh(geo, material);
        m.position.set(x, y, z);
        m.rotation.y = ry;
        m.castShadow = cast;
        m.receiveShadow = true;
        scene.add(m);
        return m;
    }

    // a block you can stand on and hide behind
    function block(cx, y0, cz, sx, sy, sz, material, opts) {
        mesh(new THREE.BoxGeometry(sx, sy, sz), material, cx, y0 + sy / 2, cz);
        return addBox(cx, y0, cz, sx, sy, sz, opts);
    }

    function crate(x, z, size = 1.3) {
        const y = terrainHeight(x, z);
        const g = new THREE.BoxGeometry(size, size, size);
        const m = mesh(g, M.crate, x, y + size / 2, z, rng() * 0.3);
        // dark planks on the sides
        const edge = new THREE.Mesh(new THREE.BoxGeometry(size * 1.02, size * 0.16, size * 1.02), M.woodDark);
        m.add(edge);
        addBox(x, y, z, size, size, size);
    }

    const chestSpots = [];
    const floorSpots = [];
    const ammoSpots = [];
    const coinSpots = [];

    // ---- buildings (Kenney city kit), solid boxes you take cover behind
    const BUILDINGS = ['buildingA', 'buildingB', 'buildingC', 'buildingD', 'garage'];
    const BUILDING_HEIGHT = { buildingA: 0.95, buildingB: 1.63, buildingC: 1.75, buildingD: 1.0, garage: 0.55 };
    function building(x, z, key, scale = 9, rot = 0) {
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
        addBox(x, y, z, scale, BUILDING_HEIGHT[key] * scale, scale, { walk: true });
        return obj;
    }

    function scatterAround(poi, count, minR, maxR, list, avoid = 3) {
        for (let n = 0, tries = 0; n < count && tries < count * 20; tries++) {
            const a = rng() * Math.PI * 2;
            const r = minR + rng() * (maxR - minR);
            const x = poi.x + Math.cos(a) * r;
            const z = poi.z + Math.sin(a) * r;
            if (blocked(x, z, avoid)) continue;
            list.push({ x, y: terrainHeight(x, z), z, poi: poi.id });
            n++;
        }
    }

    const tmpNear = [];
    function blocked(x, z, pad) {
        for (const c of grid.near(x, z, pad + 1, tmpNear)) {
            if (c.type === 'box' && x > c.minX - pad && x < c.maxX + pad && z > c.minZ - pad && z < c.maxZ + pad) return true;
            if (c.type === 'cyl' && Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
        }
        return terrainHeight(x, z) < 1.2;
    }

    // ---- the places
    for (const poi of POIS) {
        if (poi.kind === 'city') {
            // a grid of blocks with streets between them
            const spots = [];
            for (let gx = -2; gx <= 2; gx++) {
                for (let gz = -2; gz <= 2; gz++) {
                    if (Math.abs(gx) + Math.abs(gz) > 3 || (gx === 0 && gz === 0)) continue;
                    spots.push([poi.x + gx * 14, poi.z + gz * 14]);
                }
            }
            spots.forEach(([x, z], i) => building(x, z, BUILDINGS[i % 4], 9, (Math.floor(rng() * 4) * Math.PI) / 2));
            // the square in the middle: a fountain-ish monument and crates
            block(poi.x, terrainHeight(poi.x, poi.z), poi.z, 3, 1.2, 3, M.stone);
            mesh(new THREE.CylinderGeometry(0.4, 0.6, 4, 8), M.stoneDark, poi.x, terrainHeight(poi.x, poi.z) + 3.2, poi.z);
            for (let i = 0; i < 10; i++) crate(poi.x + (rng() - 0.5) * 50, poi.z + (rng() - 0.5) * 50);
            scatterAround(poi, 9, 4, poi.r, chestSpots);
            scatterAround(poi, 14, 4, poi.r + 6, floorSpots);
            scatterAround(poi, 8, 4, poi.r, ammoSpots);
        } else if (poi.kind === 'village') {
            const houses = [[-11, -8], [10, -10], [-12, 11], [12, 9], [0, 17]];
            houses.forEach(([dx, dz], i) => building(poi.x + dx, poi.z + dz, i % 2 ? 'buildingD' : 'buildingA', 8, (i * Math.PI) / 2));
            // a well in the middle
            const y = terrainHeight(poi.x, poi.z);
            mesh(new THREE.CylinderGeometry(1.3, 1.3, 1.1, 12), M.stone, poi.x, y + 0.55, poi.z);
            addCylinder(poi.x, poi.z, 1.3, y, y + 1.1, { walk: true });
            for (let i = 0; i < 6; i++) crate(poi.x + (rng() - 0.5) * 34, poi.z + (rng() - 0.5) * 34);
            scatterAround(poi, 6, 3, poi.r, chestSpots);
            scatterAround(poi, 9, 3, poi.r + 4, floorSpots);
            scatterAround(poi, 5, 3, poi.r, ammoSpots);
        } else if (poi.kind === 'fort') {
            // stone walls around a yard, a gate on each side, a raised platform with ramps
            const y = terrainHeight(poi.x, poi.z);
            const half = 15;
            const wallH = 4;
            for (const side of [-1, 1]) {
                // north / south walls with a gap in the middle
                block(poi.x - 8.5, y, poi.z + side * half, 13, wallH, 1.4, M.stone);
                block(poi.x + 8.5, y, poi.z + side * half, 13, wallH, 1.4, M.stone);
                block(poi.x + side * half, y, poi.z - 8.5, 1.4, wallH, 13, M.stone);
                block(poi.x + side * half, y, poi.z + 8.5, 1.4, wallH, 13, M.stone);
            }
            // corner towers
            for (const sx of [-1, 1]) {
                for (const sz of [-1, 1]) {
                    const tx = poi.x + sx * half;
                    const tz = poi.z + sz * half;
                    mesh(new THREE.CylinderGeometry(2.2, 2.4, 7, 10), M.stoneDark, tx, y + 3.5, tz);
                    mesh(new THREE.ConeGeometry(2.8, 2.6, 10), M.roof, tx, y + 8.3, tz);
                    addCylinder(tx, tz, 2.3, y, y + 7);
                }
            }
            // central platform (3 high) with two ramps up
            block(poi.x, y, poi.z, 8, 3, 8, M.wood);
            const rampGeo = new THREE.BoxGeometry(3, 0.3, 7.6);
            const r1 = mesh(rampGeo, M.woodDark, poi.x, y + 1.5, poi.z + 7.6);
            r1.rotation.x = Math.atan2(3, 7.2);
            addRamp(poi.x - 1.5, poi.x + 1.5, poi.z + 4, poi.z + 11.2, y, y + 3, 'z', -1);
            const r2 = mesh(rampGeo, M.woodDark, poi.x, y + 1.5, poi.z - 7.6);
            r2.rotation.x = -Math.atan2(3, 7.2);
            addRamp(poi.x - 1.5, poi.x + 1.5, poi.z - 11.2, poi.z - 4, y, y + 3, 'z', 1);
            chestSpots.push({ x: poi.x, y: y + 3, z: poi.z, poi: poi.id });
            for (let i = 0; i < 5; i++) crate(poi.x + (rng() - 0.5) * 24, poi.z + (rng() - 0.5) * 24);
            scatterAround(poi, 4, 6, half - 2, chestSpots);
            scatterAround(poi, 7, 6, poi.r + 6, floorSpots);
            scatterAround(poi, 4, 6, poi.r, ammoSpots);
        } else if (poi.kind === 'warehouses') {
            const sheds = [[-10, -9], [10, -9], [-10, 9], [10, 9]];
            sheds.forEach(([dx, dz]) => {
                const x = poi.x + dx;
                const z = poi.z + dz;
                const y = terrainHeight(x, z);
                // a big metal shed: walls + roof, solid
                block(x, y, z, 12, 5, 8, M.metal);
                mesh(new THREE.BoxGeometry(12.6, 0.5, 8.6), M.roof, x, y + 5.25, z);
            });
            // stacks of containers
            for (let i = 0; i < 6; i++) {
                const x = poi.x + (rng() - 0.5) * 36;
                const z = poi.z + (rng() - 0.5) * 36;
                if (blocked(x, z, 2)) continue;
                const y = terrainHeight(x, z);
                const color = [0xd35400, 0x2471a3, 0x27ae60, 0xc0392b][i % 4];
                block(x, y, z, 6, 2.6, 2.6, mat(color, { flatShading: true }));
            }
            for (let i = 0; i < 8; i++) crate(poi.x + (rng() - 0.5) * 40, poi.z + (rng() - 0.5) * 40);
            scatterAround(poi, 6, 2, poi.r, chestSpots);
            scatterAround(poi, 9, 2, poi.r + 4, floorSpots);
            scatterAround(poi, 6, 2, poi.r, ammoSpots);
        } else if (poi.kind === 'lighthouse') {
            const y = terrainHeight(poi.x, poi.z);
            for (let i = 0; i < 5; i++) {
                mesh(new THREE.CylinderGeometry(2.2 - i * 0.2, 2.4 - i * 0.2, 3, 16), i % 2 ? M.red : M.white, poi.x, y + 1.5 + i * 3, poi.z);
            }
            mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.6, 12), new THREE.MeshStandardMaterial({ color: 0xfff3b0, emissive: 0xffd34d, emissiveIntensity: 1.2 }), poi.x, y + 16, poi.z);
            mesh(new THREE.ConeGeometry(1.8, 1.8, 12), M.red, poi.x, y + 17.7, poi.z);
            addCylinder(poi.x, poi.z, 2.4, y, y + 18);
            building(poi.x + 8, poi.z - 6, 'garage', 7, Math.PI / 2);
            scatterAround(poi, 3, 4, poi.r, chestSpots);
            scatterAround(poi, 4, 4, poi.r + 4, floorSpots);
            scatterAround(poi, 2, 4, poi.r, ammoSpots);
        } else if (poi.kind === 'farm') {
            // a red barn, a silo, fences and hay bales
            const bx = poi.x - 6;
            const bz = poi.z - 4;
            const by = terrainHeight(bx, bz);
            block(bx, by, bz, 10, 5, 7, M.red);
            const roof = new THREE.CylinderGeometry(4.2, 4.2, 10.4, 3, 1);
            const r = mesh(roof, M.roof, bx, by + 5.6, bz);
            r.rotation.z = Math.PI / 2;
            const sx = poi.x + 7;
            const sz = poi.z - 6;
            const sy = terrainHeight(sx, sz);
            mesh(new THREE.CylinderGeometry(2.2, 2.2, 9, 14), M.white, sx, sy + 4.5, sz);
            mesh(new THREE.SphereGeometry(2.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.metal, sx, sy + 9, sz);
            addCylinder(sx, sz, 2.2, sy, sy + 9);
            for (let i = 0; i < 9; i++) {
                const x = poi.x + (rng() - 0.5) * 36;
                const z = poi.z + (rng() - 0.5) * 36;
                if (blocked(x, z, 1.5)) continue;
                const y = terrainHeight(x, z);
                const bale = mesh(new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12), M.hay, x, y + 0.9, z);
                bale.rotation.z = Math.PI / 2;
                bale.rotation.y = rng() * Math.PI;
                addCylinder(x, z, 1, y, y + 1.8, { walk: true });
            }
            // a fence around the field
            for (let i = 0; i < 28; i++) {
                const a = (i / 28) * Math.PI * 2;
                const x = poi.x + Math.cos(a) * (poi.r + 2);
                const z = poi.z + Math.sin(a) * (poi.r + 2);
                if (i % 7 === 0) continue; // gaps to walk through
                const y = terrainHeight(x, z);
                const f = mesh(new THREE.BoxGeometry(5, 0.25, 0.15), M.fence, x, y + 0.9, z, -a + Math.PI / 2);
                f.castShadow = false;
                mesh(new THREE.BoxGeometry(0.2, 1.2, 0.2), M.woodDark, x, y + 0.6, z);
            }
            scatterAround(poi, 5, 3, poi.r, chestSpots);
            scatterAround(poi, 8, 3, poi.r + 4, floorSpots);
            scatterAround(poi, 4, 3, poi.r, ammoSpots);
        }
    }

    // ---- trees (instanced: two kinds), rocks and bushes
    const pineGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.25, 0.35, 2.4, 6).translate(0, 1.2, 0),
        new THREE.ConeGeometry(1.9, 3.2, 7).translate(0, 3.6, 0),
        new THREE.ConeGeometry(1.5, 2.6, 7).translate(0, 5.1, 0),
        new THREE.ConeGeometry(1.0, 2.0, 7).translate(0, 6.4, 0),
    ].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const roundGeo = mergeGeometries([
        new THREE.CylinderGeometry(0.25, 0.35, 2.6, 6).translate(0, 1.3, 0),
        new THREE.IcosahedronGeometry(2.0, 0).translate(0, 3.9, 0),
        new THREE.IcosahedronGeometry(1.4, 0).translate(0.9, 4.9, 0.3),
    ].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    // colour trunks brown and leaves green with vertex colours
    function paintTree(geo, trunkHeight) {
        const pos = geo.attributes.position;
        const colors = new Float32Array(pos.count * 3);
        const trunk = new THREE.Color(0x7a5230);
        const leaf = new THREE.Color(0xffffff);
        for (let i = 0; i < pos.count; i++) {
            const c = pos.getY(i) < trunkHeight ? trunk : leaf;
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();
    }
    paintTree(pineGeo, 2.0);
    paintTree(roundGeo, 2.2);

    const treeSpots = [];
    for (let tries = 0; tries < 6000 && treeSpots.length < 650; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS;
        const h = terrainHeight(x, z);
        if (h < 2.2) continue;
        const poi = poiAt(x, z, 3);
        const forest = POIS[3];
        const inForest = Math.hypot(x - forest.x, z - forest.z) < forest.r + 10;
        if (poi && poi.kind !== 'forest') continue;
        if (!inForest && fbm(x * 0.02, z * 0.02, 5) < 0.52) continue; // groves, not an even carpet
        if (distToPath(x, z) < 3.5) continue;
        if (blocked(x, z, 2)) continue;
        treeSpots.push({ x, z, h, kind: inForest || rng() < 0.6 ? 0 : 1, s: 0.8 + rng() * 0.6 });
        addCylinder(x, z, 0.45, h, h + 2.3);
        addCylinder(x, z, 1.5, h + 2.3, h + 7.5, { foliage: true });
    }
    const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
    [pineGeo, roundGeo].forEach((geo, kind) => {
        const spots = treeSpots.filter((t) => t.kind === kind);
        const im = new THREE.InstancedMesh(geo, treeMat, spots.length);
        const m4 = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        const leafColors = [0x3f8f3a, 0x2f7d34, 0x4ea145, 0x5b9e3c];
        spots.forEach((t, i) => {
            q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
            m4.compose(new THREE.Vector3(t.x, t.h - 0.1, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
            im.setMatrixAt(i, m4);
            im.setColorAt(i, new THREE.Color(leafColors[i % leafColors.length]));
        });
        im.castShadow = true;
        im.receiveShadow = true;
        scene.add(im);
    });

    // rocks
    {
        const rockGeo = new THREE.IcosahedronGeometry(1, 0);
        const spots = [];
        for (let tries = 0; tries < 3000 && spots.length < 170; tries++) {
            const x = (rng() * 2 - 1) * ISLAND_RADIUS;
            const z = (rng() * 2 - 1) * ISLAND_RADIUS;
            const h = terrainHeight(x, z);
            if (h < 1.6 || poiAt(x, z, 2) || blocked(x, z, 2)) continue;
            const s = 0.7 + rng() * 2.2;
            spots.push({ x, z, h, s });
            addCylinder(x, z, s * 0.85, h - 0.5, h + s * 1.1, { walk: true });
        }
        const im = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.95, flatShading: true }), spots.length);
        const m4 = new THREE.Matrix4();
        const e = new THREE.Euler();
        spots.forEach((r, i) => {
            e.set(rng(), rng() * 6, rng());
            m4.compose(new THREE.Vector3(r.x, r.h + r.s * 0.3, r.z), new THREE.Quaternion().setFromEuler(e), new THREE.Vector3(r.s, r.s * 0.8, r.s));
            im.setMatrixAt(i, m4);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        scene.add(im);
    }

    // bushes: you can hide in them (bots can't see through), bullets pass
    {
        const geo = new THREE.IcosahedronGeometry(1, 1);
        const spots = [];
        for (let tries = 0; tries < 3000 && spots.length < 260; tries++) {
            const x = (rng() * 2 - 1) * ISLAND_RADIUS;
            const z = (rng() * 2 - 1) * ISLAND_RADIUS;
            const h = terrainHeight(x, z);
            if (h < 1.8 || blocked(x, z, 1.5) || distToPath(x, z) < 2.5) continue;
            const s = 0.9 + rng() * 0.6;
            spots.push({ x, z, h, s });
            addCylinder(x, z, s * 0.9, h - 0.2, h + s * 1.3, { foliage: true });
        }
        const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x4f9e3e, roughness: 0.9, flatShading: true }), spots.length);
        const m4 = new THREE.Matrix4();
        spots.forEach((b, i) => {
            m4.compose(new THREE.Vector3(b.x, b.h + b.s * 0.5, b.z), new THREE.Quaternion(), new THREE.Vector3(b.s * 1.2, b.s, b.s * 1.2));
            im.setMatrixAt(i, m4);
            im.setColorAt(i, new THREE.Color().setHSL(0.27 + rng() * 0.06, 0.5, 0.36 + rng() * 0.08));
        });
        im.castShadow = true;
        scene.add(im);
    }

    // loot and coins out in the open too, along the paths and in the wild
    for (let tries = 0; tries < 4000 && floorSpots.length < 120; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        if (poiAt(x, z, 6) || blocked(x, z, 1.5)) continue;
        floorSpots.push({ x, y: terrainHeight(x, z), z, poi: null });
    }
    for (let tries = 0; tries < 4000 && chestSpots.length < 52; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.85;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.85;
        if (blocked(x, z, 2)) continue;
        chestSpots.push({ x, y: terrainHeight(x, z), z, poi: null });
    }
    // coins: little rows along the paths and around the places
    for (let tries = 0; tries < 6000 && coinSpots.length < 260; tries++) {
        const x = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        const z = (rng() * 2 - 1) * ISLAND_RADIUS * 0.9;
        const nearPath = distToPath(x, z) < 2;
        if (!nearPath && !poiAt(x, z, 4) && rng() < 0.85) continue;
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
        // the sea edge
        const r = Math.hypot(pos.x, pos.z);
        if (r > MAP_HALF - 4) {
            pos.x *= (MAP_HALF - 4) / r;
            pos.z *= (MAP_HALF - 4) / r;
        }
        return bumped;
    }

    // Ray against the world. Returns the distance to the first hit (or maxDist).
    // opts.foliage: also stop at leaves/bushes (used for "can I see you", not for bullets)
    const rayCells = [];
    function raycast(o, d, maxDist, opts = {}) {
        let best = maxDist;
        // colliders along the ray: sample cells every few units
        const seen = new Set();
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
            if (c.foliage && !opts.foliage) continue;
            let hit = Infinity;
            if (c.type === 'box') hit = rayBox(o, d, c);
            else hit = rayCyl(o, d, c);
            if (hit < best) best = hit;
        }
        // terrain: march, then refine
        const stepT = 1.2;
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
        for (const [oa, da, mn, mx] of [[o.x, d.x, c.minX, c.maxX], [o.y, d.y, c.minY, c.maxY], [o.z, d.z, c.minZ, c.maxZ]]) {
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
        let t2 = (-b + sq) / (2 * a);
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

    // ---- the minimap picture (drawn once)
    const minimap = document.createElement('canvas');
    {
        const size = 256;
        minimap.width = size;
        minimap.height = size;
        const ctx = minimap.getContext('2d');
        const img = ctx.createImageData(size, size);
        const c = new THREE.Color();
        for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
                const x = -MAP_HALF + ((px + 0.5) / size) * MAP_HALF * 2;
                const z = -MAP_HALF + ((py + 0.5) / size) * MAP_HALF * 2;
                const h = terrainHeight(x, z);
                if (h < 0) c.setHex(0x2f8fd8).lerp(new THREE.Color(0x1d5f9a), Math.min(1, -h / 7));
                else {
                    groundColor(x, z, h, c);
                    c.multiplyScalar(0.85 + Math.min(0.3, h / 60));
                }
                const k = (py * size + px) * 4;
                img.data[k] = c.r * 255;
                img.data[k + 1] = c.g * 255;
                img.data[k + 2] = c.b * 255;
                img.data[k + 3] = 255;
            }
        }
        ctx.putImageData(img, 0, 0);
        // buildings and big things as dark squares
        ctx.fillStyle = 'rgba(60, 50, 40, 0.75)';
        for (const col of grid.all) {
            if (col.type !== 'box' || col.maxX - col.minX < 4) continue;
            const x0 = ((col.minX + MAP_HALF) / (MAP_HALF * 2)) * size;
            const z0 = ((col.minZ + MAP_HALF) / (MAP_HALF * 2)) * size;
            ctx.fillRect(x0, z0, ((col.maxX - col.minX) / (MAP_HALF * 2)) * size, ((col.maxZ - col.minZ) / (MAP_HALF * 2)) * size);
        }
        ctx.fillStyle = 'rgba(30, 90, 30, 0.35)';
        treeSpots.forEach((t) => {
            ctx.fillRect(((t.x + MAP_HALF) / (MAP_HALF * 2)) * size - 1, ((t.z + MAP_HALF) / (MAP_HALF * 2)) * size - 1, 2, 2);
        });
    }

    return {
        terrainHeight,
        supportHeight,
        pushOut,
        raycast,
        lineOfSight,
        poiAt,
        chestSpots,
        floorSpots,
        ammoSpots,
        coinSpots,
        minimap,
        water,
        update(t) {
            water.position.y = Math.sin(t * 0.6) * 0.08;
            foam.material.opacity = 0.28 + Math.sin(t * 1.3) * 0.08;
        },
    };
}
