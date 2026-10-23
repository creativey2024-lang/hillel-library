/**
 * Loot: chests, weapons lying on the ground (with a coloured glow by rarity),
 * ammo, bandages and shield potions, and coins. Also the rules for picking
 * things up, so the player and the bots share them.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../shared/lib/utils/BufferGeometryUtils.js';
import { WEAPONS, AMMO, RARITIES, weaponMesh, makeWeapon, rollRarity, rollWeaponKind } from './weapons.js';

export const HEALS = {
    bandage: { name: 'תחבושת', max: 15, time: 2.5, color: 0xf8fafc },
    medkit: { name: 'ערכת עזרה ראשונה', max: 3, time: 4.5, color: 0xef4444 },
    smallShield: { name: 'שיקוי מגן קטן', max: 6, time: 1.5, color: 0x60a5fa },
    bigShield: { name: 'שיקוי מגן גדול', max: 3, time: 3.5, color: 0x2563eb },
};

const rand = (a, b) => a + Math.random() * (b - a);

// glowing ring under items, beam for rare and better
const ringGeo = new THREE.RingGeometry(0.45, 0.62, 28).rotateX(-Math.PI / 2);
const beamGeo = new THREE.CylinderGeometry(0.18, 0.18, 7, 10, 1, true).translate(0, 3.5, 0);
const ringMats = {};
const beamMats = {};
function ringMat(color) {
    if (!ringMats[color]) ringMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    return ringMats[color];
}
function beamMat(color) {
    if (!beamMats[color]) beamMats[color] = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    return beamMats[color];
}

function healMesh(item) {
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

function ammoMesh(type) {
    const g = new THREE.Group();
    const color = new THREE.Color(AMMO[type].color);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.26, 0.3), new THREE.MeshStandardMaterial({ color: 0x4b5563, roughness: 0.6 }));
    g.add(box);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.08, 0.31), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.3 }));
    g.add(band);
    g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    return g;
}

// A chest is just three draw calls (base, lid, glow), so dozens of them stay cheap.
let chestParts = null;
function chestGeometries() {
    if (chestParts) return chestParts;
    const base = [new THREE.BoxGeometry(1.2, 0.62, 0.8).translate(0, 0.31, 0)];
    const baseGold = [-0.45, 0.45].map((x) => new THREE.BoxGeometry(0.1, 0.64, 0.82).translate(x, 0.31, 0));
    const lidWood = [new THREE.CylinderGeometry(0.4, 0.4, 1.2, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, 0.4)];
    const lidGold = [
        new THREE.BoxGeometry(0.18, 0.2, 0.06).translate(0, 0, 0.82),
        ...[-0.45, 0.45].map((x) => new THREE.CylinderGeometry(0.41, 0.41, 0.1, 14, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(x, 0, 0.4)),
    ];
    const prep = (list) => list.map((g) => (g.index ? g.toNonIndexed() : g));
    chestParts = {
        base: mergeGeometries([mergeGeometries(prep(base)), mergeGeometries(prep(baseGold))], true),
        lid: mergeGeometries([mergeGeometries(prep(lidWood)), mergeGeometries(prep(lidGold))], true),
        glow: new THREE.CircleGeometry(1.1, 24).rotateX(-Math.PI / 2),
        wood: new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.7 }),
        gold: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3, metalness: 0.6, emissive: 0xb45309, emissiveIntensity: 0.6 }),
    };
    return chestParts;
}

function chestMesh() {
    const P = chestGeometries();
    const g = new THREE.Group();
    const base = new THREE.Mesh(P.base, [P.wood, P.gold]);
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);
    // the lid turns around its back edge
    const lid = new THREE.Group();
    lid.position.set(0, 0.62, -0.4);
    const lidMesh = new THREE.Mesh(P.lid, [P.wood, P.gold]);
    lidMesh.castShadow = true;
    lid.add(lidMesh);
    g.add(lid);
    // a soft golden glow underneath (its own material: it fades when opened)
    const glow = new THREE.Mesh(P.glow, new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.position.y = 0.03;
    g.add(glow);
    g.userData = { lid, glow };
    return g;
}

let sparkTex = null;
function sparkTexture() {
    if (sparkTex) return sparkTex;
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.4, 'rgba(255,220,80,0.7)');
    g.addColorStop(1, 'rgba(255,200,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    sparkTex = new THREE.CanvasTexture(c);
    return sparkTex;
}

export function createLoot({ scene, world, coinModel, audio }) {
    const items = [];   // things lying on the ground
    const chests = [];
    const sparkles = [];

    function place(obj, pos) {
        obj.position.copy(pos);
        scene.add(obj);
    }

    function addItem(item, pos, pop) {
        item.pos = pos.clone();
        item.baseY = pos.y;
        item.spin = Math.random() * Math.PI * 2;
        item.vel = pop ? new THREE.Vector3(rand(-2.5, 2.5), rand(4, 6), rand(-2.5, 2.5)) : null;
        const holder = new THREE.Group();
        holder.add(item.mesh);
        if (item.ring) holder.add(item.ring);
        if (item.beam) holder.add(item.beam);
        item.holder = holder;
        place(holder, pos);
        items.push(item);
        return item;
    }

    function dropWeapon(pos, weapon, pop = false) {
        const r = RARITIES[weapon.rarity];
        const mesh = weaponMesh(weapon.kind, weapon.rarity);
        mesh.position.y = 0.45;
        mesh.rotation.y = Math.PI / 2;
        const ring = new THREE.Mesh(ringGeo, ringMat(r.hex));
        ring.position.y = 0.05;
        const beam = weapon.rarity >= 2 ? new THREE.Mesh(beamGeo, beamMat(r.hex)) : null;
        return addItem({ type: 'weapon', weapon, mesh, ring, beam }, pos, pop);
    }

    function dropAmmo(pos, ammoType, amount, pop = false) {
        const mesh = ammoMesh(ammoType);
        mesh.position.y = 0.2;
        const ring = new THREE.Mesh(ringGeo, ringMat(new THREE.Color(AMMO[ammoType].color).getHex()));
        ring.position.y = 0.05;
        ring.scale.setScalar(0.7);
        return addItem({ type: 'ammo', ammoType, amount, mesh, ring }, pos, pop);
    }

    function dropHeal(pos, heal, count, pop = false) {
        const mesh = healMesh(heal);
        mesh.position.y = 0.35;
        const ring = new THREE.Mesh(ringGeo, ringMat(heal.includes('Shield') ? 0x3b82f6 : 0x22c55e));
        ring.position.y = 0.05;
        ring.scale.setScalar(0.7);
        return addItem({ type: 'heal', heal, count, mesh, ring }, pos, pop);
    }

    function dropCoin(pos, pop = false) {
        const mesh = coinModel.clone(true);
        mesh.scale.setScalar(1.5);
        mesh.position.y = 0.35;
        return addItem({ type: 'coin', mesh }, pos, pop);
    }

    function randomHeal() {
        const r = Math.random();
        if (r < 0.32) return ['bandage', 5];
        if (r < 0.5) return ['medkit', 1];
        if (r < 0.82) return ['smallShield', 2];
        return ['bigShield', 1];
    }

    function spawnInitial() {
        world.chestSpots.forEach((s) => {
            const mesh = chestMesh();
            mesh.position.set(s.x, world.supportHeight(s.x, s.z, s.y + 5), s.z);
            mesh.rotation.y = Math.random() * Math.PI * 2;
            scene.add(mesh);
            const chest = { mesh, pos: mesh.position.clone(), opened: false, openT: 0 };
            chests.push(chest);
            // floating sparkles so you can spot chests from afar
            for (let i = 0; i < 1; i++) {
                const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
                sp.scale.setScalar(0.35);
                scene.add(sp);
                sparkles.push({ sp, chest, phase: Math.random() * 6, r: rand(0.5, 0.9) });
            }
        });
        world.floorSpots.forEach((s) => {
            const pos = new THREE.Vector3(s.x, world.supportHeight(s.x, s.z, s.y + 5), s.z);
            if (Math.random() < 0.65) {
                const kind = rollWeaponKind();
                const w = makeWeapon(kind, rollRarity());
                dropWeapon(pos, w);
                dropAmmo(pos.clone().add(new THREE.Vector3(0.9, 0, 0.4)), WEAPONS[kind].ammo, AMMO[WEAPONS[kind].ammo].box);
            } else if (Math.random() < 0.6) {
                const [h, n] = randomHeal();
                dropHeal(pos, h, n);
            } else {
                const t = ['light', 'medium', 'shells', 'heavy'][Math.floor(Math.random() * 4)];
                dropAmmo(pos, t, AMMO[t].box);
            }
        });
        world.ammoSpots.forEach((s) => {
            const t = ['light', 'medium', 'shells', 'medium', 'light'][Math.floor(Math.random() * 5)];
            dropAmmo(new THREE.Vector3(s.x, world.supportHeight(s.x, s.z, s.y + 5), s.z), t, AMMO[t].box);
        });
        world.coinSpots.forEach((s) => dropCoin(new THREE.Vector3(s.x, world.supportHeight(s.x, s.z, s.y + 5), s.z)));
    }

    function openChest(chest) {
        if (chest.opened) return;
        chest.opened = true;
        chest.openT = 0;
        audio.chime();
        const base = chest.pos.clone().add(new THREE.Vector3(0, 0.6, 0));
        const kind = rollWeaponKind();
        dropWeapon(base.clone(), makeWeapon(kind, rollRarity(Math.random, 0.25)), true);
        dropAmmo(base.clone(), WEAPONS[kind].ammo, AMMO[WEAPONS[kind].ammo].box, true);
        if (Math.random() < 0.7) {
            const [h, n] = randomHeal();
            dropHeal(base.clone(), h, n, true);
        }
        const coins = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < coins; i++) dropCoin(base.clone(), true);
    }

    function removeItem(item) {
        scene.remove(item.holder);
        const i = items.indexOf(item);
        if (i >= 0) items.splice(i, 1);
    }

    // ---- inventory rules (shared by the player and the bots)
    function canTakeHeal(actor, heal) {
        return actor.heals[heal] < HEALS[heal].max;
    }

    /** Things picked up just by walking over them: coins, ammo, healing items. Returns what was taken. */
    function autoPickup(actor, onTaken) {
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (it.vel) continue; // still flying out of a chest
            const dx = it.pos.x - actor.pos.x;
            const dz = it.pos.z - actor.pos.z;
            const dy = it.pos.y - actor.pos.y;
            const r = it.type === 'coin' ? 1.6 : 1.3;
            if (dx * dx + dz * dz > r * r || Math.abs(dy) > 2) continue;
            if (it.type === 'coin') {
                actor.coins += 1;
                removeItem(it);
                onTaken && onTaken(it);
            } else if (it.type === 'ammo') {
                actor.ammo[it.ammoType] += it.amount;
                removeItem(it);
                onTaken && onTaken(it);
            } else if (it.type === 'heal' && canTakeHeal(actor, it.heal)) {
                const take = Math.min(it.count, HEALS[it.heal].max - actor.heals[it.heal]);
                actor.heals[it.heal] += take;
                it.count -= take;
                if (it.count <= 0) removeItem(it);
                onTaken && onTaken(it);
            }
        }
    }

    /** Pick up a weapon: into an empty slot, or swap with the one in hand. */
    function takeWeapon(actor, item, slotForSwap = actor.current) {
        let slot = actor.slots.findIndex((s) => s === null);
        let dropped = null;
        if (slot < 0) {
            slot = slotForSwap;
            dropped = actor.slots[slot];
        }
        actor.slots[slot] = item.weapon;
        removeItem(item);
        if (dropped) dropWeapon(actor.pos.clone(), dropped);
        return slot;
    }

    /** What's in reach to press E on: the closest chest or weapon. */
    function nearestInteractable(pos, radius = 2.2) {
        let best = null;
        let bestD = radius;
        for (const c of chests) {
            if (c.opened) continue;
            const d = c.pos.distanceTo(pos);
            if (d < bestD) {
                bestD = d;
                best = { kind: 'chest', obj: c };
            }
        }
        for (const it of items) {
            if (it.type !== 'weapon' || it.vel) continue;
            const d = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z) + Math.abs(it.pos.y - pos.y) * 0.5;
            if (d < bestD) {
                bestD = d;
                best = { kind: 'weapon', obj: it };
            }
        }
        return best;
    }

    /** When someone is eliminated, everything they carried drops on the spot. */
    function dropAll(actor) {
        const p = actor.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
        actor.slots.forEach((w) => { if (w) dropWeapon(p.clone(), w, true); });
        Object.entries(actor.ammo).forEach(([t, n]) => { if (n > 0) dropAmmo(p.clone(), t, n, true); });
        Object.entries(actor.heals).forEach(([h, n]) => { if (n > 0) dropHeal(p.clone(), h, n, true); });
    }

    // small things far away aren't drawn (you couldn't see them anyway)
    function update(dt, t, viewer) {
        for (const c of chests) c.mesh.visible = !viewer || c.pos.distanceToSquared(viewer) < 150 * 150;
        for (const it of items) {
            const far = viewer && it.pos.distanceToSquared(viewer) > (it.type === 'coin' ? 70 * 70 : 100 * 100);
            it.holder.visible = !far;
            if (far && !it.vel) continue;
            if (it.vel) {
                // popping out of a chest / a fallen player
                it.vel.y -= 18 * dt;
                it.pos.addScaledVector(it.vel, dt);
                const ground = world.supportHeight(it.pos.x, it.pos.z, it.pos.y + 0.5);
                if (it.pos.y <= ground) {
                    it.pos.y = ground;
                    it.vel = null;
                }
                world.pushOut(it.pos, 0.3, 0.5);
            }
            it.holder.position.copy(it.pos);
            if (it.type === 'coin') it.mesh.rotation.y = t * 3 + it.spin;
            else if (it.type === 'weapon') {
                it.mesh.position.y = 0.45 + Math.sin(t * 2 + it.spin) * 0.08;
                it.mesh.rotation.y = Math.PI / 2 + Math.sin(t * 0.8 + it.spin) * 0.3;
            } else it.mesh.rotation.y = t * 1.2 + it.spin;
        }
        for (const c of chests) {
            if (c.opened && c.openT < 1) {
                c.openT = Math.min(1, c.openT + dt * 3);
                c.mesh.userData.lid.rotation.x = -c.openT * 1.9;
                c.mesh.userData.glow.material.opacity = 0.35 * (1 - c.openT);
            } else if (!c.opened) {
                c.mesh.userData.glow.material.opacity = 0.25 + Math.sin(t * 3) * 0.1;
            }
        }
        for (const s of sparkles) {
            s.sp.visible = !s.chest.opened && s.chest.mesh.visible;
            if (!s.sp.visible) continue;
            const a = t * 1.5 + s.phase;
            s.sp.position.set(s.chest.pos.x + Math.cos(a) * s.r, s.chest.pos.y + 0.9 + Math.sin(t * 2 + s.phase) * 0.35, s.chest.pos.z + Math.sin(a) * s.r);
            s.sp.material.opacity = 0.5 + Math.sin(t * 5 + s.phase) * 0.5;
        }
    }

    return { items, chests, spawnInitial, openChest, autoPickup, takeWeapon, nearestInteractable, dropAll, dropWeapon, removeItem, update, HEALS };
}
