/**
 * Little details for the characters (the Kenney robot from the games):
 * a backpack with a rolled mat, a belt with a buckle and a pouch, shoe soles,
 * and something on the head (a cap, a headband or a bandana).
 * Each person always gets the same look (picked from their name), so
 * friends are easy to tell apart. Parts are merged per material, so it costs
 * only a few draw calls. `lite` (for bots) adds just the backpack and belt.
 */
import * as THREE from 'three';
import { mergeGeometries } from './lib/utils/BufferGeometryUtils.js';

const PALETTE = [
    { main: 0x2563eb, dark: 0x1e3a8a, accent: 0xfacc15 },
    { main: 0xdc2626, dark: 0x7f1d1d, accent: 0xf8fafc },
    { main: 0x16a34a, dark: 0x14532d, accent: 0xfde047 },
    { main: 0xf97316, dark: 0x7c2d12, accent: 0x1e293b },
    { main: 0x9333ea, dark: 0x4c1d95, accent: 0x67e8f9 },
    { main: 0x0891b2, dark: 0x164e63, accent: 0xfb7185 },
    { main: 0x475569, dark: 0x1e293b, accent: 0xf59e0b },
    { main: 0xdb2777, dark: 0x831843, accent: 0xa7f3d0 },
];

function hash(str) {
    let h = 2166136261;
    for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    return h >>> 0;
}

const matCache = new Map();
function mat(color, extra = {}) {
    const key = `${color}:${JSON.stringify(extra)}`;
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra }));
    return matCache.get(key);
}

const box = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (ry) g.rotateY(ry);
    if (rz) g.rotateZ(rz);
    return g.translate(x, y, z);
};
const cyl = (r, len, x, y, z, axis = 'y', seg = 12) => {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    return g.translate(x, y, z);
};

// add merged parts (geometries grouped by material) under a node
function attach(node, groups) {
    for (const [m, list] of groups) {
        if (!list.length) continue;
        const mesh = new THREE.Mesh(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false), m);
        mesh.castShadow = true;
        mesh.userData.gear = true;
        node.add(mesh);
    }
}

/**
 * model: the character (a clone of character.glb's scene).
 * seed: a name or number (the same seed = the same look).
 */
export function addGear(model, { seed = 0, lite = false } = {}) {
    const nodes = {};
    model.traverse((c) => {
        if (['torso', 'leg-left', 'leg-right', 'arm-left', 'arm-right'].includes(c.name)) nodes[c.name] = c;
    });
    const torso = nodes.torso;
    if (!torso) return;
    const h = hash(seed);
    const pal = PALETTE[h % PALETTE.length];
    const M = { main: mat(pal.main), dark: mat(pal.dark, { roughness: 0.85 }), accent: mat(pal.accent), metal: mat(0xd4a017, { metalness: 0.8, roughness: 0.3 }), strap: mat(0x3b2412, { roughness: 0.9 }) };
    const parts = new Map(Object.values(M).map((m) => [m, []]));
    const put = (m, g) => parts.get(m).push(g);

    // the backpack (on the back of the body), its flap, a pocket, straps and a rolled mat on top
    put(M.main, box(0.4, 0.36, 0.15, 0, 0.27, -0.375));
    put(M.dark, box(0.42, 0.1, 0.17, 0, 0.43, -0.37));
    put(M.dark, box(0.26, 0.15, 0.05, 0, 0.18, -0.465));
    put(M.metal, box(0.05, 0.04, 0.02, 0, 0.4, -0.46));
    put(M.accent, cyl(0.065, 0.46, 0, 0.5, -0.36, 'x'));
    for (const s of [-1, 1]) {
        put(M.strap, box(0.03, 0.42, 0.05, s * 0.31, 0.3, -0.18));
        put(M.strap, box(0.03, 0.05, 0.22, s * 0.31, 0.5, -0.27));
    }
    // a belt all the way round, with a buckle and a pouch
    put(M.strap, box(0.63, 0.06, 0.02, 0, 0.06, 0.345));
    put(M.strap, box(0.63, 0.06, 0.02, 0, 0.06, -0.31));
    put(M.strap, box(0.02, 0.06, 0.66, 0.31, 0.06, 0.012));
    put(M.strap, box(0.02, 0.06, 0.66, -0.31, 0.06, 0.012));
    put(M.metal, box(0.08, 0.07, 0.02, 0, 0.06, 0.355));
    put(M.dark, box(0.06, 0.12, 0.14, -0.34, 0.05, 0.1));

    if (!lite) {
        // something on the head
        const hat = (h >> 3) % 3;
        if (hat === 0) {
            // a cap with a visor (the antenna sticks out of it)
            put(M.main, box(0.62, 0.08, 0.66, 0, 0.64, 0.015));
            put(M.main, box(0.52, 0.06, 0.56, 0, 0.7, 0.015));
            put(M.dark, box(0.46, 0.03, 0.2, 0, 0.62, 0.43));
            put(M.accent, box(0.12, 0.08, 0.02, 0, 0.66, 0.35));
        } else if (hat === 1) {
            // a headband with its knot tails at the back
            put(M.accent, box(0.63, 0.07, 0.02, 0, 0.5, 0.345));
            put(M.accent, box(0.63, 0.07, 0.02, 0, 0.5, -0.31));
            put(M.accent, box(0.02, 0.07, 0.66, 0.31, 0.5, 0.012));
            put(M.accent, box(0.02, 0.07, 0.66, -0.31, 0.5, 0.012));
            put(M.accent, box(0.05, 0.2, 0.02, 0.06, 0.4, -0.33, 0, 0, 0.4));
            put(M.accent, box(0.05, 0.2, 0.02, -0.06, 0.4, -0.33, 0, 0, -0.4));
        } else {
            // goggles on the forehead
            put(M.strap, box(0.63, 0.05, 0.02, 0, 0.55, 0.345));
            put(M.strap, box(0.02, 0.05, 0.66, 0.31, 0.55, 0.012));
            put(M.strap, box(0.02, 0.05, 0.66, -0.31, 0.55, 0.012));
            put(M.strap, box(0.63, 0.05, 0.02, 0, 0.55, -0.31));
            for (const s of [-1, 1]) {
                put(M.metal, cyl(0.075, 0.05, s * 0.1, 0.55, 0.36, 'z'));
                put(M.accent, cyl(0.055, 0.02, s * 0.1, 0.55, 0.39, 'z'));
            }
        }
    }
    attach(torso, parts);

    if (lite) return;
    // shoe soles with a white toe cap
    for (const name of ['leg-left', 'leg-right']) {
        const leg = nodes[name];
        if (!leg) continue;
        attach(leg, new Map([[M.dark, [box(0.17, 0.05, 0.26, 0, -0.205, 0.04)]], [mat(0xf8fafc), [box(0.165, 0.06, 0.06, 0, -0.18, 0.15)]]]));
    }
}
