/**
 * Healing items. They live in the same five inventory slots as guns: pick
 * one up, select its slot, and hold the fire button to use it (about 3
 * seconds). Stacks of the same item share a slot.
 */
import * as THREE from 'three';

export const HEALS = {
    bandage: { name: 'תחבושת', max: 15, time: 3, color: 0xf8fafc, icon: 'bandage' },
    medkit: { name: 'ערכת עזרה ראשונה', max: 3, time: 3.5, color: 0xef4444, icon: 'medkit' },
    smallShield: { name: 'שיקוי מגן קטן', max: 6, time: 2, color: 0x60a5fa, icon: 'potion small' },
    bigShield: { name: 'שיקוי מגן גדול', max: 3, time: 3, color: 0x2563eb, icon: 'potion big' },
};

/** A slot holds either a gun { kind, rarity, ammoInMag } or a stack of heals { heal, count }. */
export function isHeal(item) {
    return Boolean(item && item.heal);
}

export function makeHealStack(heal, count) {
    return { heal, count };
}

/** How many of this heal the actor carries (over all slots). */
export function healCount(actor, heal) {
    let n = 0;
    for (const s of actor.slots) if (s && s.heal === heal) n += s.count;
    return n;
}

export function healSlot(actor, heal) {
    return actor.slots.findIndex((s) => s && s.heal === heal);
}

/** Can this heal do anything right now? (no bandages at 75+ health, etc.) */
export function healUseful(actor, heal) {
    if (heal === 'bandage') return actor.hp < 75;
    if (heal === 'medkit') return actor.hp < 100;
    if (heal === 'smallShield') return actor.shield < 50;
    return actor.shield < 100;
}

export function applyHeal(actor, heal) {
    if (heal === 'bandage') actor.hp = Math.min(75, actor.hp + 15);
    else if (heal === 'medkit') actor.hp = 100;
    else if (heal === 'smallShield') actor.shield = Math.min(50, actor.shield + 25);
    else actor.shield = Math.min(100, actor.shield + 50);
}

/**
 * Put heals into the inventory: first on top of a stack of the same kind,
 * then into empty slots. Returns how many were taken.
 */
export function addHeals(actor, heal, count, allowNewSlot = true) {
    const max = HEALS[heal].max;
    let left = count;
    for (const s of actor.slots) {
        if (left <= 0) break;
        if (s && s.heal === heal && s.count < max) {
            const take = Math.min(left, max - s.count);
            s.count += take;
            left -= take;
        }
    }
    if (allowNewSlot) {
        for (let i = 0; i < actor.slots.length && left > 0; i++) {
            if (actor.slots[i]) continue;
            const take = Math.min(left, max);
            actor.slots[i] = makeHealStack(heal, take);
            left -= take;
        }
    }
    return count - left;
}

/** The 3D look of a healing item (lying on the ground or held in the hand). Built once per kind, copies share it. */
const healCache = new Map();
export function healMesh(item) {
    if (!healCache.has(item)) healCache.set(item, buildHealMesh(item));
    return healCache.get(item).clone(true);
}

function buildHealMesh(item) {
    const g = new THREE.Group();
    const color = HEALS[item].color;
    if (item === 'bandage') {
        const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.22, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xfafafa }));
        g.add(roll);
        const tape = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.12), new THREE.MeshStandardMaterial({ color: 0xfafafa }));
        tape.position.set(0.12, -0.14, 0.1);
        g.add(tape);
    } else if (item === 'medkit') {
        g.add(new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.36, 0.3), new THREE.MeshStandardMaterial({ color: 0xffffff })));
        const cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.31), new THREE.MeshStandardMaterial({ color }));
        const cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.31), new THREE.MeshStandardMaterial({ color }));
        g.add(cross1, cross2);
    } else {
        // a potion bottle
        const big = item === 'bigShield';
        const glass = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85, emissive: color, emissiveIntensity: 0.5, roughness: 0.1 });
        const body = new THREE.Mesh(big ? new THREE.CylinderGeometry(0.2, 0.22, 0.42, 14) : new THREE.SphereGeometry(0.18, 14, 10), glass);
        g.add(body);
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.16, 10), glass);
        neck.position.y = big ? 0.28 : 0.22;
        g.add(neck);
        const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.07, 10), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
        cork.position.y = big ? 0.39 : 0.33;
        g.add(cork);
    }
    g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    return g;
}
