/**
 * Weapons: seven kinds (three of them sniper rifles), each in rarities from grey to gold (the usual battle
 * royale colour code), drawn with simple three.js shapes.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../shared/lib/utils/BufferGeometryUtils.js';
import { texture } from './textures.js';

export const RARITIES = [
    { id: 'common', name: 'רגיל', color: '#9ca3af', hex: 0x9ca3af, mult: 1.0, weight: 32 },
    { id: 'uncommon', name: 'לא נפוץ', color: '#22c55e', hex: 0x22c55e, mult: 1.06, weight: 30 },
    { id: 'rare', name: 'נדיר', color: '#3b82f6', hex: 0x3b82f6, mult: 1.12, weight: 21 },
    { id: 'epic', name: 'אפי', color: '#a855f7', hex: 0xa855f7, mult: 1.19, weight: 12 },
    { id: 'legendary', name: 'אגדי', color: '#f59e0b', hex: 0xf59e0b, mult: 1.27, weight: 5 },
];

// damage: per bullet (shotgun: per pellet); rate: shots per second; spread: radians
export const WEAPONS = {
    pistol: { name: 'אקדח', ammo: 'light', damage: 24, rate: 6, mag: 16, reload: 1.3, spread: 0.022, adsSpread: 0.008, range: 90, pellets: 1, auto: false, sound: 'blaster', pitch: 1.25, recoil: 0.012 },
    smg: { name: 'תת־מקלע', ammo: 'light', damage: 16, rate: 11, mag: 30, reload: 2.0, spread: 0.045, adsSpread: 0.028, range: 70, pellets: 1, auto: true, sound: 'repeater', pitch: 1.3, recoil: 0.008 },
    ar: { name: 'רובה סער', ammo: 'medium', damage: 30, rate: 5.5, mag: 30, reload: 2.2, spread: 0.03, adsSpread: 0.008, range: 160, pellets: 1, auto: true, sound: 'repeater', pitch: 1.0, recoil: 0.014 },
    shotgun: { name: 'רובה ציד', ammo: 'shells', damage: 11, rate: 1.0, mag: 5, reload: 4.2, spread: 0.11, adsSpread: 0.08, range: 30, pellets: 9, auto: false, sound: 'shotgun', pitch: 1, recoil: 0.05 },
    // sniper rifles: look through the scope with the right mouse button
    sniper: { name: 'רובה צלפים', ammo: 'heavy', damage: 100, rate: 0.4, mag: 1, reload: 2.6, spread: 0.08, adsSpread: 0.0008, range: 400, pellets: 1, auto: false, sound: 'sniper', pitch: 1, recoil: 0.08, scope: true, zoom: 16, head: 2.5 },
    dmr: { name: 'צלפים חצי־אוטומטי', ammo: 'medium', damage: 48, rate: 2.2, mag: 10, reload: 2.4, spread: 0.05, adsSpread: 0.0025, range: 300, pellets: 1, auto: false, sound: 'sniper', pitch: 1.3, recoil: 0.03, scope: true, zoom: 26, head: 2.0 },
    heavy: { name: 'צלפים כבד', ammo: 'heavy', damage: 140, rate: 0.3, mag: 1, reload: 3.4, spread: 0.09, adsSpread: 0.0006, range: 450, pellets: 1, auto: false, sound: 'sniper', pitch: 0.75, recoil: 0.11, scope: true, zoom: 13, head: 2.5 },
};

export const AMMO = {
    light: { name: 'קליעים קלים', color: '#94a3b8', box: 36 },
    medium: { name: 'קליעים בינוניים', color: '#16a34a', box: 30 },
    shells: { name: 'כדוריות', color: '#dc2626', box: 8 },
    heavy: { name: 'קליעים כבדים', color: '#2563eb', box: 4 },
};

export function rollRarity(rng = Math.random, bonus = 0) {
    const total = RARITIES.reduce((s, r) => s + r.weight, 0);
    let x = rng() * total;
    // chests are luckier than the floor
    x = Math.min(total - 0.001, x + bonus * total);
    for (let i = 0; i < RARITIES.length; i++) {
        x -= RARITIES[i].weight;
        if (x < 0) return i;
    }
    return 0;
}

export function rollWeaponKind(rng = Math.random) {
    const table = [['ar', 27], ['shotgun', 22], ['smg', 17], ['pistol', 15], ['sniper', 8], ['dmr', 7], ['heavy', 4]];
    let x = rng() * 100;
    for (const [k, w] of table) {
        x -= w;
        if (x < 0) return k;
    }
    return 'ar';
}

export function makeWeapon(kind, rarity) {
    const def = WEAPONS[kind];
    return { kind, rarity, ammoInMag: def.mag };
}

export function weaponDamage(w) {
    return WEAPONS[w.kind].damage * RARITIES[w.rarity].mult;
}

// --------------------------------------------------------------- models
// Guns are built from simple shapes, then merged per material (3-5 draw calls each).
let MATS = null;
function mats() {
    if (MATS) return MATS;
    const gm = texture('gunmetal', 128);
    MATS = {
        metal: new THREE.MeshStandardMaterial({ color: 0x3a3f47, map: gm, roughness: 0.4, metalness: 0.7 }),
        steel: new THREE.MeshStandardMaterial({ color: 0x8c949e, map: gm, roughness: 0.3, metalness: 0.85 }),
        poly: new THREE.MeshStandardMaterial({ color: 0x1f2329, roughness: 0.75, metalness: 0.1 }),
        wood: new THREE.MeshStandardMaterial({ color: 0x9a5f2e, map: texture('planks', 128), roughness: 0.6 }),
        lens: new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.05, metalness: 0.3, emissive: 0x0e7490, emissiveIntensity: 0.9 }),
        red: new THREE.MeshStandardMaterial({ color: 0xff3b3b, emissive: 0xff0000, emissiveIntensity: 1.2 }),
    };
    return MATS;
}
const accentCache = {};
function accent(rarity) {
    if (!accentCache[rarity]) {
        const r = RARITIES[rarity];
        accentCache[rarity] = new THREE.MeshStandardMaterial({ color: r.hex, roughness: 0.3, metalness: 0.45, emissive: r.hex, emissiveIntensity: 0.45 });
    }
    return accentCache[rarity];
}

/**
 * A gun model pointing along +z, held at the origin (the grip).
 * Each kind/rarity is built once; every copy (on the ground, in a hand, in
 * the inventory icons) shares its shapes and materials, so picking up and
 * switching weapons doesn't keep making new 3D data (that used up memory).
 */
const weaponCache = new Map();
export function weaponMesh(kind, rarity) {
    const key = `${kind}:${rarity}`;
    if (!weaponCache.has(key)) weaponCache.set(key, buildWeaponMesh(kind, rarity));
    return weaponCache.get(key).clone(true);
}

function buildWeaponMesh(kind, rarity) {
    const m = mats();
    const parts = new Map();
    const A = accent(rarity);
    const add = (geo, mat) => {
        if (!parts.has(mat)) parts.set(mat, []);
        parts.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
    };
    // helpers: a box / a cylinder along z / a cylinder along y
    const box = (mat, w, h, d, x, y, z, rx = 0) => add(new THREE.BoxGeometry(w, h, d).rotateX(rx).translate(x, y, z), mat);
    const tubeZ = (mat, r, len, x, y, z, seg = 12, r2 = r) => add(new THREE.CylinderGeometry(r2, r, len, seg).rotateX(Math.PI / 2).translate(x, y, z), mat);
    const ring = (mat, r, tube, x, y, z) => add(new THREE.TorusGeometry(r, tube, 6, 14).translate(x, y, z), mat);
    const grip = (rx = -0.3) => box(m.poly, 0.085, 0.2, 0.1, 0, -0.04, 0, rx);
    const trigger = (z = 0.07) => {
        add(new THREE.TorusGeometry(0.045, 0.01, 5, 10, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(0, 0.02, z), m.metal);
        box(m.steel, 0.015, 0.05, 0.015, 0, 0.0, z - 0.01, 0.4);
    };
    const scope = (len, r, y, z) => {
        tubeZ(m.metal, r, len, 0, y, z);
        tubeZ(m.metal, r * 1.45, len * 0.22, 0, y, z + len * 0.45, 12, r);
        tubeZ(m.metal, r * 1.25, len * 0.18, 0, y, z - len * 0.45, 12, r * 1.25);
        tubeZ(m.lens, r * 1.3, 0.01, 0, y, z + len * 0.56);
        tubeZ(m.lens, r * 1.1, 0.01, 0, y, z - len * 0.55);
        tubeZ(A, r * 1.05, len * 0.12, 0, y, z);
        box(m.metal, 0.05, y - 0.16, 0.05, 0, (y + 0.16) / 2, z - len * 0.25);
        box(m.metal, 0.05, y - 0.16, 0.05, 0, (y + 0.16) / 2, z + len * 0.25);
    };
    if (kind === 'pistol') {
        box(m.metal, 0.1, 0.11, 0.38, 0, 0.11, 0.13);          // slide
        box(A, 0.104, 0.035, 0.3, 0, 0.17, 0.12);               // stripe
        box(m.poly, 0.092, 0.07, 0.3, 0, 0.04, 0.13);           // frame
        tubeZ(m.steel, 0.026, 0.08, 0, 0.12, 0.35);             // barrel tip
        box(m.metal, 0.02, 0.025, 0.02, 0, 0.18, 0.3);          // front sight
        box(m.metal, 0.06, 0.025, 0.02, 0, 0.18, -0.03);        // rear sight
        grip(-0.25);
        box(A, 0.088, 0.03, 0.105, 0, -0.14, -0.03, -0.25);     // magazine base
        trigger(0.08);
    } else if (kind === 'smg') {
        box(m.metal, 0.12, 0.15, 0.5, 0, 0.1, 0.17);
        box(m.poly, 0.1, 0.05, 0.42, 0, 0.2, 0.15);             // top rail
        for (let i = 0; i < 6; i++) box(m.metal, 0.11, 0.02, 0.025, 0, 0.23, 0.0 + i * 0.07);
        tubeZ(m.poly, 0.05, 0.22, 0, 0.11, 0.48, 10);           // barrel shroud
        tubeZ(m.steel, 0.025, 0.12, 0, 0.11, 0.62);
        box(A, 0.07, 0.3, 0.08, 0, -0.1, 0.2, 0.08);            // long magazine
        box(m.poly, 0.06, 0.15, 0.06, 0, -0.03, 0.36);          // front grip
        grip(-0.3);
        box(m.metal, 0.04, 0.04, 0.26, 0, 0.1, -0.2);           // folded stock
        box(m.metal, 0.04, 0.12, 0.04, 0, 0.06, -0.32);
        box(A, 0.125, 0.04, 0.12, 0, 0.12, 0.3);
        trigger(0.07);
    } else if (kind === 'ar') {
        box(m.metal, 0.12, 0.14, 0.46, 0, 0.11, 0.1);           // receiver
        box(m.poly, 0.11, 0.09, 0.3, 0, 0.02, 0.06);            // lower
        tubeZ(m.poly, 0.065, 0.36, 0, 0.11, 0.5, 8);            // handguard
        for (let i = 0; i < 4; i++) box(A, 0.135, 0.03, 0.05, 0, 0.11, 0.38 + i * 0.08);
        tubeZ(m.steel, 0.025, 0.32, 0, 0.11, 0.82);             // barrel
        tubeZ(m.metal, 0.038, 0.08, 0, 0.11, 1.0, 8);           // muzzle brake
        box(m.metal, 0.03, 0.09, 0.03, 0, 0.21, 0.62);          // front sight post
        box(m.poly, 0.08, 0.04, 0.38, 0, 0.2, 0.12);            // top rail
        box(m.metal, 0.07, 0.07, 0.12, 0, 0.255, 0.06);         // red dot sight
        tubeZ(m.lens, 0.028, 0.005, 0, 0.26, 0.12);
        box(A, 0.08, 0.26, 0.11, 0, -0.1, 0.2, 0.25);           // curved magazine
        box(m.poly, 0.09, 0.07, 0.13, 0, -0.22, 0.25, 0.5);
        grip(-0.3);
        box(m.poly, 0.09, 0.15, 0.3, 0, 0.06, -0.3);            // stock
        box(m.poly, 0.1, 0.2, 0.06, 0, 0.04, -0.46);
        box(A, 0.095, 0.035, 0.24, 0, 0.14, -0.3);
        trigger(0.08);
    } else if (kind === 'shotgun') {
        box(m.metal, 0.13, 0.15, 0.42, 0, 0.1, 0.1);
        tubeZ(m.steel, 0.042, 0.62, 0, 0.14, 0.62);             // barrel
        tubeZ(m.metal, 0.036, 0.5, 0, 0.06, 0.55);              // magazine tube
        for (let i = 0; i < 5; i++) tubeZ(A, 0.058, 0.04, 0, 0.065, 0.46 + i * 0.055, 10); // pump grip ribs
        tubeZ(A, 0.052, 0.27, 0, 0.065, 0.57, 10);
        box(m.steel, 0.02, 0.02, 0.02, 0, 0.19, 0.92);          // bead sight
        grip(-0.35);
        box(m.wood, 0.1, 0.17, 0.42, 0, 0.03, -0.3, 0.12);      // wooden stock
        box(m.poly, 0.105, 0.2, 0.04, 0, 0.0, -0.52, 0.12);
        trigger(0.08);
    } else if (kind === 'sniper') {
        box(m.metal, 0.11, 0.14, 0.62, 0, 0.1, 0.18);
        tubeZ(m.steel, 0.028, 0.8, 0, 0.12, 0.98);
        tubeZ(m.metal, 0.04, 0.1, 0, 0.12, 1.36, 8);            // muzzle
        add(new THREE.CylinderGeometry(0.014, 0.014, 0.14, 6).rotateZ(Math.PI / 2).translate(0.09, 0.14, 0.02), m.steel); // bolt
        add(new THREE.SphereGeometry(0.03, 8, 6).translate(0.16, 0.14, 0.02), m.steel);
        scope(0.5, 0.045, 0.3, 0.2);
        box(m.wood, 0.11, 0.12, 0.7, 0, 0.03, 0.42);            // fore-end
        box(A, 0.115, 0.03, 0.5, 0, 0.09, 0.42);
        box(m.poly, 0.07, 0.12, 0.08, 0, -0.06, 0.16);          // magazine
        grip(-0.35);
        box(m.wood, 0.1, 0.18, 0.42, 0, 0.04, -0.33);           // stock
        box(m.wood, 0.1, 0.06, 0.2, 0, 0.15, -0.25);            // cheek rest
        box(m.poly, 0.105, 0.2, 0.04, 0, 0.03, -0.56);
        trigger(0.07);
    } else if (kind === 'dmr') {
        box(m.metal, 0.12, 0.15, 0.6, 0, 0.1, 0.16);
        tubeZ(m.poly, 0.06, 0.4, 0, 0.12, 0.62, 8);
        for (let i = 0; i < 3; i++) box(A, 0.13, 0.03, 0.06, 0, 0.12, 0.5 + i * 0.12);
        tubeZ(m.steel, 0.028, 0.3, 0, 0.12, 0.95);
        tubeZ(m.metal, 0.04, 0.08, 0, 0.12, 1.08, 8);
        scope(0.36, 0.04, 0.29, 0.14);
        box(A, 0.075, 0.24, 0.1, 0, -0.08, 0.3, 0.15);           // magazine
        grip(-0.3);
        box(m.poly, 0.09, 0.16, 0.34, 0, 0.06, -0.32);
        box(m.poly, 0.1, 0.06, 0.18, 0, 0.17, -0.3);
        box(m.poly, 0.1, 0.22, 0.05, 0, 0.04, -0.5);
        trigger(0.08);
    } else {
        // heavy sniper
        box(m.metal, 0.15, 0.19, 0.8, 0, 0.11, 0.25);
        tubeZ(m.steel, 0.045, 0.85, 0, 0.13, 1.1);
        box(m.metal, 0.14, 0.1, 0.18, 0, 0.13, 1.6);             // muzzle brake
        box(m.poly, 0.15, 0.04, 0.03, 0, 0.13, 1.56);
        box(m.poly, 0.15, 0.04, 0.03, 0, 0.13, 1.64);
        scope(0.62, 0.06, 0.36, 0.25);
        box(A, 0.16, 0.05, 0.6, 0, 0.21, 0.32);
        add(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6).rotateX(0.5).rotateZ(0.25).translate(-0.06, -0.08, 0.95), m.metal); // bipod
        add(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 6).rotateX(0.5).rotateZ(-0.25).translate(0.06, -0.08, 0.95), m.metal);
        box(m.poly, 0.09, 0.14, 0.12, 0, -0.05, 0.2);
        grip(-0.35);
        box(A, 0.13, 0.22, 0.5, 0, 0.05, -0.4);                  // stock
        box(m.poly, 0.14, 0.26, 0.05, 0, 0.03, -0.66);
        box(m.poly, 0.12, 0.07, 0.24, 0, 0.19, -0.36);
        trigger(0.08);
    }
    const g = new THREE.Group();
    for (const [mat, list] of parts) {
        const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
        mesh.castShadow = true;
        g.add(mesh);
    }
    return g;
}

/** Where bullets come out, in the gun's own space. */
export function muzzleOffset(kind) {
    return { pistol: 0.42, smg: 0.68, ar: 1.05, shotgun: 1.03, sniper: 1.42, dmr: 1.1, heavy: 1.72 }[kind];
}
