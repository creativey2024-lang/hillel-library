/**
 * Weapons: seven kinds (three of them sniper rifles), each in rarities from grey to gold (the usual battle
 * royale colour code), drawn with simple three.js shapes.
 */
import * as THREE from 'three';

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
const metal = new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.45, metalness: 0.5 });
const grip = new THREE.MeshStandardMaterial({ color: 0x1e222b, roughness: 0.8 });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 });
const glass = new THREE.MeshStandardMaterial({ color: 0x7dd3fc, roughness: 0.1, metalness: 0.2, emissive: 0x0c4a6e, emissiveIntensity: 0.6 });
const accentCache = {};
function accent(rarity) {
    if (!accentCache[rarity]) {
        const r = RARITIES[rarity];
        accentCache[rarity] = new THREE.MeshStandardMaterial({ color: r.hex, roughness: 0.35, metalness: 0.3, emissive: r.hex, emissiveIntensity: 0.35 });
    }
    return accentCache[rarity];
}

function part(geo, material, x, y, z, rx = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.x = rx;
    m.castShadow = true;
    return m;
}

/** A gun model pointing along +z, held at the origin (the grip). */
export function weaponMesh(kind, rarity) {
    const g = new THREE.Group();
    const a = accent(rarity);
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const barrel = (r, len) => new THREE.CylinderGeometry(r, r, len, 10).rotateX(Math.PI / 2);
    if (kind === 'pistol') {
        g.add(part(B(0.1, 0.13, 0.36), metal, 0, 0.1, 0.12));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.02, 0, -0.25));
        g.add(part(barrel(0.03, 0.12), metal, 0, 0.12, 0.34));
        g.add(part(B(0.105, 0.04, 0.3), a, 0, 0.17, 0.12));
    } else if (kind === 'smg') {
        g.add(part(B(0.12, 0.17, 0.55), metal, 0, 0.1, 0.18));
        g.add(part(B(0.08, 0.26, 0.09), a, 0, -0.08, 0.2));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.03, 0, -0.3));
        g.add(part(barrel(0.035, 0.22), metal, 0, 0.12, 0.55));
        g.add(part(B(0.06, 0.06, 0.25), grip, 0, 0.08, -0.17));
    } else if (kind === 'ar') {
        g.add(part(B(0.12, 0.17, 0.85), metal, 0, 0.1, 0.25));
        g.add(part(B(0.13, 0.08, 0.5), a, 0, 0.22, 0.25));
        g.add(part(B(0.08, 0.26, 0.12), metal, 0, -0.1, 0.35, 0.2));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.04, 0, -0.3));
        g.add(part(barrel(0.035, 0.4), metal, 0, 0.12, 0.85));
        g.add(part(B(0.1, 0.18, 0.32), grip, 0, 0.06, -0.3));
        g.add(part(B(0.05, 0.08, 0.12), glass, 0, 0.3, 0.2));
    } else if (kind === 'shotgun') {
        g.add(part(B(0.14, 0.16, 0.7), metal, 0, 0.1, 0.25));
        g.add(part(barrel(0.05, 0.55), metal, 0, 0.13, 0.75));
        g.add(part(B(0.15, 0.1, 0.32), a, 0, 0.02, 0.6));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.04, 0, -0.3));
        g.add(part(B(0.11, 0.2, 0.4), woodMat, 0, 0.04, -0.28));
    } else if (kind === 'dmr') {
        // semi-automatic sniper: shorter, with a magazine and a small scope
        g.add(part(B(0.12, 0.16, 0.8), metal, 0, 0.1, 0.22));
        g.add(part(barrel(0.032, 0.5), metal, 0, 0.12, 0.85));
        g.add(part(B(0.13, 0.07, 0.42), a, 0, 0.2, 0.25));
        g.add(part(barrel(0.05, 0.34), glass, 0, 0.3, 0.2));
        g.add(part(B(0.08, 0.24, 0.1), metal, 0, -0.08, 0.32, 0.15));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.04, 0, -0.3));
        g.add(part(B(0.1, 0.18, 0.36), grip, 0, 0.05, -0.32));
    } else if (kind === 'heavy') {
        // heavy sniper: long, thick barrel, big scope, legs at the front
        g.add(part(B(0.15, 0.2, 1.0), metal, 0, 0.1, 0.3));
        g.add(part(barrel(0.05, 0.9), metal, 0, 0.13, 1.2));
        g.add(part(B(0.12, 0.1, 0.14), metal, 0, 0.13, 1.66));
        g.add(part(barrel(0.075, 0.5), a, 0, 0.33, 0.28));
        g.add(part(barrel(0.08, 0.04), glass, 0, 0.33, 0.55));
        g.add(part(B(0.025, 0.3, 0.025), metal, -0.08, -0.08, 0.95, 0.35));
        g.add(part(B(0.025, 0.3, 0.025), metal, 0.08, -0.08, 0.95, 0.35));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.04, 0, -0.3));
        g.add(part(B(0.12, 0.22, 0.5), a, 0, 0.04, -0.38));
    } else {
        // sniper
        g.add(part(B(0.12, 0.16, 0.9), metal, 0, 0.1, 0.25));
        g.add(part(barrel(0.03, 0.75), metal, 0, 0.12, 1.05));
        g.add(part(barrel(0.06, 0.45), a, 0, 0.29, 0.25));
        g.add(part(B(0.04, 0.08, 0.04), metal, 0, 0.22, 0.12));
        g.add(part(B(0.04, 0.08, 0.04), metal, 0, 0.22, 0.38));
        g.add(part(B(0.09, 0.2, 0.1), grip, 0, -0.04, 0, -0.3));
        g.add(part(B(0.1, 0.2, 0.45), woodMat, 0, 0.04, -0.35));
    }
    return g;
}

/** Where bullets come out, in the gun's own space. */
export function muzzleOffset(kind) {
    return { pistol: 0.42, smg: 0.68, ar: 1.05, shotgun: 1.03, sniper: 1.42, dmr: 1.1, heavy: 1.72 }[kind];
}
