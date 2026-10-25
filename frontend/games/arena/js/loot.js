/**
 * Loot: chests, weapons lying on the ground (with a coloured glow by rarity),
 * ammo, bandages and shield potions, and coins. Also the rules for picking
 * things up, so the player and the bots share them.
 */
import * as THREE from 'three';
import { mergeGeometries } from '../../shared/lib/utils/BufferGeometryUtils.js';
import { WEAPONS, AMMO, RARITIES, weaponMesh, makeWeapon, rollRarity, rollWeaponKind } from './weapons.js';
import { HEALS, healMesh, addHeals, isHeal } from './heals.js';
import { texture } from './textures.js';

export { HEALS };

const rand = (a, b) => a + Math.random() * (b - a);
export const COIN_VALUE = 3; // each coin you pick up

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

// built once per ammo type; every box on the ground shares it
const ammoCache = new Map();
function ammoMesh(type) {
    if (!ammoCache.has(type)) ammoCache.set(type, buildAmmoMesh(type));
    return ammoCache.get(type).clone(true);
}

function buildAmmoMesh(type) {
    const g = new THREE.Group();
    const color = new THREE.Color(AMMO[type].color);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.26, 0.32), new THREE.MeshStandardMaterial({ color: 0x5b6b4e, roughness: 0.6, metalness: 0.2 }));
    g.add(box);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.05, 0.34), new THREE.MeshStandardMaterial({ color: 0x47553d, roughness: 0.5, metalness: 0.3 }));
    lid.position.y = 0.15;
    g.add(lid);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.465, 0.07, 0.325), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
    g.add(band);
    // a few bullets on top
    const shell = new THREE.MeshStandardMaterial({ color: 0xd4a73a, metalness: 0.8, roughness: 0.3 });
    for (let i = 0; i < 3; i++) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8), shell);
        b.rotation.z = Math.PI / 2;
        b.position.set(0, 0.2, -0.08 + i * 0.08);
        g.add(b);
    }
    g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
    return g;
}

// A chest: wooden planks with golden trims and corners, an iron lock, a
// glowing base and soft light beams. Built once, shared by all chests.
let chestParts = null;
function chestGeometries() {
    if (chestParts) return chestParts;
    const prep = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const W = 1.25;
    const H = 0.62;
    const D = 0.82;
    const B = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
    // the box
    const wood = [B(W, H, D, 0, H / 2, 0)];
    const gold = [
        B(W + 0.04, 0.08, D + 0.04, 0, 0.04, 0),          // bottom band
        B(W + 0.04, 0.06, D + 0.04, 0, H - 0.03, 0),      // top band
        B(0.1, H + 0.02, D + 0.05, -W / 2 + 0.12, H / 2, 0),
        B(0.1, H + 0.02, D + 0.05, W / 2 - 0.12, H / 2, 0),
    ];
    const iron = [];
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) iron.push(B(0.14, H + 0.04, 0.14, sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02)));
    }
    iron.push(B(0.22, 0.24, 0.05, 0, H - 0.1, D / 2 + 0.03));   // lock plate
    gold.push(B(0.06, 0.09, 0.06, 0, H - 0.1, D / 2 + 0.06));   // keyhole knob
    // the lid (turns around its back edge; built around the hinge)
    const lidWood = [new THREE.CylinderGeometry(0.41, 0.41, W, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0, D / 2)];
    const lidGold = [
        ...[-W / 2 + 0.12, W / 2 - 0.12, 0].map((x) => new THREE.CylinderGeometry(0.425, 0.425, x === 0 ? 0.12 : 0.1, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).translate(x, 0, D / 2)),
    ];
    const lidIron = [B(0.2, 0.18, 0.06, 0, 0.05, D + 0.01)];
    const planks = texture('planks', 256);
    chestParts = {
        base: [prep(wood), prep(gold), prep(iron)],
        lid: [prep(lidWood), prep(lidGold), prep(lidIron)],
        glow: new THREE.CircleGeometry(1.15, 28).rotateX(-Math.PI / 2),
        beam: (() => {
            const a = new THREE.PlaneGeometry(1.1, 3.2).translate(0, 1.6, 0);
            const b = a.clone().rotateY(Math.PI / 2);
            return mergeGeometries([a, b]);
        })(),
        wood: new THREE.MeshStandardMaterial({ color: 0xb07a45, map: planks, roughness: 0.75 }),
        gold: new THREE.MeshStandardMaterial({ color: 0xf6c443, roughness: 0.28, metalness: 0.85, emissive: 0x8a5a00, emissiveIntensity: 0.45 }),
        iron: new THREE.MeshStandardMaterial({ color: 0x41464f, roughness: 0.45, metalness: 0.7 }),
        beamTex: (() => {
            const c = document.createElement('canvas');
            c.width = 32;
            c.height = 128;
            const ctx = c.getContext('2d');
            const g = ctx.createLinearGradient(0, 128, 0, 0);
            g.addColorStop(0, 'rgba(255,230,140,0.9)');
            g.addColorStop(1, 'rgba(255,230,140,0)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 32, 128);
            const h = ctx.createLinearGradient(0, 0, 32, 0);
            h.addColorStop(0, 'rgba(0,0,0,1)');
            h.addColorStop(0.5, 'rgba(0,0,0,0)');
            h.addColorStop(1, 'rgba(0,0,0,1)');
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = h;
            ctx.fillRect(0, 0, 32, 128);
            return new THREE.CanvasTexture(c);
        })(),
    };
    return chestParts;
}

function partsMesh(list, P) {
    const g = new THREE.Group();
    [P.wood, P.gold, P.iron].forEach((mat, i) => {
        const m = new THREE.Mesh(list[i], mat);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
    });
    return g;
}

function chestMesh() {
    const P = chestGeometries();
    const g = new THREE.Group();
    g.add(partsMesh(P.base, P));
    // the lid turns around its back edge
    const lid = new THREE.Group();
    lid.position.set(0, 0.62, -0.41);
    lid.add(partsMesh(P.lid, P));
    g.add(lid);
    // a soft golden glow underneath and light beams (their own materials: they fade when opened)
    const glow = new THREE.Mesh(P.glow, new THREE.MeshBasicMaterial({ color: 0xfde047, transparent: true, opacity: 0.35, depthWrite: false }));
    glow.position.y = 0.03;
    g.add(glow);
    const beam = new THREE.Mesh(P.beam, new THREE.MeshBasicMaterial({ map: P.beamTex, color: 0xffe08a, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    beam.position.y = 0.3;
    g.add(beam);
    g.userData = { lid, glow, beam };
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

    // Every item has an id, so players in a team match agree on which item is which.
    // Items made at the start get the same ids on every computer (same seed, same order).
    const byId = new Map();
    let idPrefix = 'i';
    let idCount = 0;
    // network hooks (team matches): told when items appear or are taken
    const hooks = { created: null, taken: null, opened: null };
    let quiet = false; // true while copying an item that came over the network

    function addItem(item, pos, pop) {
        if (!item.id) item.id = `${idPrefix}${idCount++}`;
        byId.set(item.id, item);
        item.pos = pos.clone();
        item.baseY = pos.y;
        item.spin = Math.random() * Math.PI * 2;
        // pop: true = burst out in a random direction, or a given velocity (thrown)
        item.vel = pop && pop.isVector3 ? pop.clone() : pop ? new THREE.Vector3(rand(-2.5, 2.5), rand(4, 6), rand(-2.5, 2.5)) : null;
        const holder = new THREE.Group();
        holder.add(item.mesh);
        if (item.ring) holder.add(item.ring);
        if (item.beam) holder.add(item.beam);
        item.holder = holder;
        // small things on the floor don't need their own shadows (cheaper to draw)
        holder.traverse((c) => { if (c.isMesh) c.castShadow = false; });
        place(holder, pos);
        items.push(item);
        if (hooks.created && !quiet) hooks.created(item);
        return item;
    }

    /** The plain data of an item (to send it over the network). */
    function itemSpec(it) {
        const s = { id: it.id, type: it.type, p: [+it.pos.x.toFixed(2), +it.pos.y.toFixed(2), +it.pos.z.toFixed(2)] };
        if (it.vel) s.v = [+it.vel.x.toFixed(2), +it.vel.y.toFixed(2), +it.vel.z.toFixed(2)];
        if (it.type === 'weapon') s.w = { kind: it.weapon.kind, rarity: it.weapon.rarity, ammoInMag: it.weapon.ammoInMag };
        if (it.type === 'ammo') {
            s.a = it.ammoType;
            s.n = it.amount;
        }
        if (it.type === 'heal') {
            s.h = it.heal;
            s.n = it.count;
        }
        if (it.door) s.d = it.door;
        return s;
    }

    /** Make an item that another player created (same id, no hooks). */
    function fromSpec(s) {
        if (byId.has(s.id)) return byId.get(s.id);
        const pos = new THREE.Vector3(s.p[0], s.p[1], s.p[2]);
        const pop = s.v ? new THREE.Vector3(s.v[0], s.v[1], s.v[2]) : false;
        quiet = true;
        let it = null;
        try {
            if (s.type === 'weapon') it = dropWeapon(pos, { ...s.w }, pop, s.id);
            else if (s.type === 'ammo') it = dropAmmo(pos, s.a, s.n, pop, s.id);
            else if (s.type === 'heal') it = dropHeal(pos, s.h, s.n, pop, s.id);
            else if (s.type === 'coin') it = dropCoin(pos, pop, s.id);
        } finally {
            quiet = false;
        }
        if (it && s.d) it.door = s.d;
        return it;
    }

    /** Another player took (some of) an item. */
    function takenRemote(id, left) {
        const it = byId.get(id);
        if (!it) return;
        if (left > 0 && it.type === 'heal') {
            it.count = left;
            return;
        }
        quiet = true;
        try {
            removeItem(it);
        } finally {
            quiet = false;
        }
    }

    function setIdPrefix(prefix) {
        idPrefix = prefix;
        idCount = 0;
    }

    function dropWeapon(pos, weapon, pop = false, id = null) {
        const r = RARITIES[weapon.rarity];
        const mesh = weaponMesh(weapon.kind, weapon.rarity);
        mesh.position.y = 0.45;
        mesh.rotation.y = Math.PI / 2;
        const ring = new THREE.Mesh(ringGeo, ringMat(r.hex));
        ring.position.y = 0.05;
        const beam = weapon.rarity >= 2 ? new THREE.Mesh(beamGeo, beamMat(r.hex)) : null;
        return addItem({ id, type: 'weapon', weapon, mesh, ring, beam }, pos, pop);
    }

    function dropAmmo(pos, ammoType, amount, pop = false, id = null) {
        const mesh = ammoMesh(ammoType);
        mesh.position.y = 0.2;
        const ring = new THREE.Mesh(ringGeo, ringMat(new THREE.Color(AMMO[ammoType].color).getHex()));
        ring.position.y = 0.05;
        ring.scale.setScalar(0.7);
        return addItem({ id, type: 'ammo', ammoType, amount, mesh, ring }, pos, pop);
    }

    function dropHeal(pos, heal, count, pop = false, id = null) {
        const mesh = healMesh(heal);
        mesh.position.y = 0.35;
        const ring = new THREE.Mesh(ringGeo, ringMat(heal.includes('Shield') ? 0x3b82f6 : 0x22c55e));
        ring.position.y = 0.05;
        ring.scale.setScalar(0.7);
        return addItem({ id, type: 'heal', heal, count, mesh, ring }, pos, pop);
    }

    function dropCoin(pos, pop = false, id = null) {
        const mesh = coinModel.clone(true);
        mesh.scale.setScalar(1.5);
        mesh.position.y = 0.35;
        return addItem({ id, type: 'coin', mesh }, pos, pop);
    }

    function randomHeal(rnd = Math.random) {
        const r = rnd();
        if (r < 0.32) return ['bandage', 5];
        if (r < 0.5) return ['medkit', 1];
        if (r < 0.82) return ['smallShield', 2];
        return ['bigShield', 1];
    }

    // rnd: a seeded random function, so every player in a team gets the same loot
    function spawnInitial(rnd = Math.random) {
        world.chestSpots.forEach((s, index) => {
            const mesh = chestMesh();
            mesh.position.set(s.x, world.supportHeight(s.x, s.z, s.y + 0.6), s.z);
            mesh.rotation.y = rnd() * Math.PI * 2;
            scene.add(mesh);
            const chest = { index, mesh, pos: mesh.position.clone(), opened: false, openT: 0, door: s.door || null };
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
            const pos = new THREE.Vector3(s.x, world.supportHeight(s.x, s.z, s.y + 0.6), s.z);
            if (rnd() < 0.65) {
                const kind = rollWeaponKind(rnd);
                const w = makeWeapon(kind, rollRarity(rnd));
                dropWeapon(pos, w).door = s.door || null;
                dropAmmo(pos.clone().add(new THREE.Vector3(0.9, 0, 0.4)), WEAPONS[kind].ammo, AMMO[WEAPONS[kind].ammo].box);
            } else if (rnd() < 0.6) {
                const [h, n] = randomHeal(rnd);
                dropHeal(pos, h, n);
            } else {
                const t = ['light', 'medium', 'shells', 'heavy'][Math.floor(rnd() * 4)];
                dropAmmo(pos, t, AMMO[t].box);
            }
        });
        world.ammoSpots.forEach((s) => {
            const t = ['light', 'medium', 'shells', 'medium', 'light'][Math.floor(rnd() * 5)];
            dropAmmo(new THREE.Vector3(s.x, world.supportHeight(s.x, s.z, s.y + 0.6), s.z), t, AMMO[t].box);
        });
        world.coinSpots.forEach((s) => dropCoin(new THREE.Vector3(s.x, world.supportHeight(s.x, s.z, s.y + 0.6), s.z)));
    }

    // spawn=false: just play the opening (the loot comes over the network)
    function openChest(chest, spawn = true) {
        if (chest.opened) return;
        chest.opened = true;
        chest.openT = 0;
        audio.chime();
        if (hooks.opened && spawn) hooks.opened(chest);
        if (!spawn) return;
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
        byId.delete(item.id);
        if (hooks.taken && !quiet && i >= 0) hooks.taken(item.id, 0);
    }

    // part of a stack was taken (the rest stays on the floor)
    function partlyTaken(item) {
        if (hooks.taken && !quiet && item.count > 0) hooks.taken(item.id, item.count);
    }

    // ---- inventory rules (shared by the player and the bots)
    /** Things picked up just by walking over them: coins, ammo, healing items. Returns what was taken. */
    function autoPickup(actor, onTaken) {
        for (let i = items.length - 1; i >= 0; i--) {
            const it = items[i];
            if (it.vel) continue; // still flying out of a chest
            const dx = it.pos.x - actor.pos.x;
            const dz = it.pos.z - actor.pos.z;
            const dy = it.pos.y - actor.pos.y;
            // something you just dropped stays on the floor until you walk away from it
            if (it.noAuto === actor) {
                if (dx * dx + dz * dz > 25) it.noAuto = null;
                else continue;
            }
            const r = it.type === 'coin' ? 1.6 : 1.3;
            if (dx * dx + dz * dz > r * r || Math.abs(dy) > 2) continue;
            if (it.type === 'coin') {
                actor.coins += COIN_VALUE;
                removeItem(it);
                onTaken && onTaken(it);
            } else if (it.type === 'ammo') {
                actor.ammo[it.ammoType] += it.amount;
                removeItem(it);
                onTaken && onTaken(it);
            } else if (it.type === 'heal') {
                // onto a stack you already have, or into a free slot
                const take = addHeals(actor, it.heal, it.count);
                if (take <= 0) continue;
                it.count -= take;
                if (it.count <= 0) removeItem(it);
                else partlyTaken(it);
                onTaken && onTaken(it, take);
            }
        }
    }

    /** Drop what's in a slot (a gun or a stack of heals) at a spot. */
    function dropSlotItem(pos, slotItem, pop = false) {
        if (!slotItem) return null;
        if (isHeal(slotItem)) return dropHeal(pos, slotItem.heal, slotItem.count, pop);
        return dropWeapon(pos, slotItem, pop);
    }

    /**
     * Pick up a weapon or heals from the ground with E: into an empty slot,
     * or swap with what's in hand (which drops where you stand).
     */
    function takeWeapon(actor, item, slotForSwap = actor.current) {
        if (item.type === 'heal') {
            const take = addHeals(actor, item.heal, item.count);
            if (take > 0) {
                item.count -= take;
                if (item.count <= 0) removeItem(item);
                else partlyTaken(item);
                return actor.slots.findIndex((s) => s && s.heal === item.heal);
            }
        }
        let slot = actor.slots.findIndex((s) => s === null);
        let dropped = null;
        if (slot < 0) {
            slot = slotForSwap;
            dropped = actor.slots[slot];
        }
        actor.slots[slot] = item.type === 'heal' ? { heal: item.heal, count: Math.min(item.count, HEALS[item.heal].max) } : item.weapon;
        removeItem(item);
        if (dropped) {
            const d = dropSlotItem(actor.pos.clone(), dropped);
            // don't vacuum the swapped-out heals straight back up
            if (d) d.noAuto = actor;
        }
        return slot;
    }

    /** What's in reach to press E on: the closest chest, weapon or heal. */
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
            if ((it.type !== 'weapon' && it.type !== 'heal') || it.vel) continue;
            const d = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z) + Math.abs(it.pos.y - pos.y) * 0.5;
            if (d < bestD) {
                bestD = d;
                best = { kind: it.type, obj: it };
            }
        }
        return best;
    }

    /** When someone is eliminated, everything they carried drops on the spot. */
    function dropAll(actor) {
        const p = actor.pos.clone().add(new THREE.Vector3(0, 0.5, 0));
        actor.slots.forEach((s) => dropSlotItem(p.clone(), s, true));
        Object.entries(actor.ammo).forEach(([t, n]) => { if (n > 0) dropAmmo(p.clone(), t, n, true); });
    }

    // small things far away aren't drawn (you couldn't see them anyway)
    function update(dt, t, viewer) {
        for (const c of chests) c.mesh.visible = !viewer || c.pos.distanceToSquared(viewer) < 150 * 150;
        for (const it of items) {
            const far = viewer && it.pos.distanceToSquared(viewer) > (it.type === 'coin' ? 65 * 65 : 95 * 95);
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
        if (chestParts) chestParts.gold.emissiveIntensity = 0.38 + Math.sin(t * 2.6) * 0.16;
        for (const c of chests) {
            if (!c.mesh.visible) continue;
            const u = c.mesh.userData;
            if (c.opened && c.openT < 1) {
                // the lid swings open and the light bursts up, then fades
                c.openT = Math.min(1, c.openT + dt * 2.2);
                u.lid.rotation.x = -Math.min(1, c.openT * 1.6) * 1.9;
                u.glow.material.opacity = 0.5 * (1 - c.openT);
                u.beam.material.opacity = 0.9 * (1 - c.openT);
                u.beam.scale.set(1 + c.openT * 0.8, 1 + c.openT * 1.5, 1 + c.openT * 0.8);
                if (c.openT >= 1) {
                    u.beam.visible = false;
                    u.glow.visible = false;
                }
            } else if (!c.opened) {
                u.glow.material.opacity = 0.25 + Math.sin(t * 3 + c.pos.x) * 0.1;
                u.beam.material.opacity = 0.32 + Math.sin(t * 2 + c.pos.z) * 0.12;
                u.beam.rotation.y = t * 0.5 + c.pos.x;
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

    return {
        items, chests, spawnInitial, openChest, autoPickup, takeWeapon, nearestInteractable, dropAll, dropWeapon, dropSlotItem, removeItem, update, HEALS,
        hooks, itemSpec, fromSpec, takenRemote, setIdPrefix, byId,
    };
}
