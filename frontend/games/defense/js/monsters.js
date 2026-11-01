/**
 * The monsters that come out of the portals, all built from simple shapes
 * and animated in code: ink slimes that hop (and split in two), biting
 * books that flap their covers, dust goblins, skeleton archers, stone
 * golems, bats, shadow wizards that teleport and call bats, and the huge
 * Ink Titan (a boss every 5 waves). Golden "elite" monsters are tougher.
 *
 * The party leader's computer runs them (createMonsterSim); everyone draws
 * them (createMonsterView) from the leader's updates.
 */
import * as THREE from 'three';
import { glowTexture } from './paint.js';
import { BOOK_POS, BOOK_RADIUS, PORTALS } from './library.js';

// ---------------------------------------------------------------- the kinds
// hp: health on wave 1; speed m/s; dmg: per hit on a player; bookDmg: per hit on the book
export const KINDS = {
    slime: { name: 'סליים דיו', hp: 55, speed: 3.1, radius: 0.6, height: 1.0, dmg: 9, bookDmg: 8, range: 1.2, rate: 1.0, points: 10, coins: 1, aggro: 12 },
    book: { name: 'ספר נושך', hp: 32, speed: 6.4, radius: 0.45, height: 0.7, fly: 1.6, dmg: 7, bookDmg: 5, range: 1.0, rate: 1.4, points: 12, coins: 1, aggro: 20 },
    goblin: { name: 'גובלין אבק', hp: 75, speed: 5.3, radius: 0.5, height: 1.35, dmg: 12, bookDmg: 10, range: 1.3, rate: 1.2, points: 15, coins: 1, aggro: 15 },
    archer: { name: 'שלד קשת', hp: 85, speed: 3.0, radius: 0.5, height: 1.95, dmg: 0, bookDmg: 0, range: 1.3, rate: 0.6, points: 20, coins: 2, aggro: 26, shoot: { range: 24, rate: 0.5, speed: 24, dmg: 12, bookDmg: 10, color: 0x22d3ee } },
    golem: { name: 'גולם אבן', hp: 520, speed: 2.1, radius: 1.25, height: 3.1, dmg: 28, bookDmg: 30, range: 2.4, rate: 0.55, points: 60, coins: 4, aggro: 7, slam: 3.8, heavy: true },
    bat: { name: 'עטלף', hp: 18, speed: 8.6, radius: 0.35, height: 0.4, fly: 2.3, dmg: 5, bookDmg: 3, range: 0.9, rate: 1.6, points: 6, coins: 0, aggro: 22 },
    wizard: { name: 'מכשף צל', hp: 170, speed: 3.4, radius: 0.55, height: 2.1, dmg: 0, bookDmg: 0, range: 1.3, rate: 0.5, points: 45, coins: 3, aggro: 22, shoot: { range: 20, rate: 0.42, speed: 13, dmg: 18, bookDmg: 16, color: 0xc084fc, homing: true }, summon: { kind: 'bat', count: 3, every: 9 }, teleport: true },
    titan: { name: 'טיטאן הדיו', hp: 3400, speed: 1.9, radius: 2.4, height: 6.4, dmg: 40, bookDmg: 60, range: 4.0, rate: 0.42, points: 600, coins: 40, aggro: 9, slam: 6, heavy: true, boss: true, summon: { kind: 'slime', count: 4, every: 11 }, shoot: { range: 34, rate: 0.22, speed: 16, dmg: 26, bookDmg: 40, color: 0xe879f9, lob: true } },
};
export const KIND_LIST = Object.keys(KINDS);

// ---------------------------------------------------------------- models
const SHADOWS = { on: true };
const mat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...opts });
const glowMat = (color) => new THREE.MeshBasicMaterial({ color });

function eyeSprite(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size);
    return s;
}

function mesh(geo, material, parent, x = 0, y = 0, z = 0) {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = SHADOWS.on;
    parent.add(m);
    return m;
}

// each builder: returns { body (the part that turns), mats (to flash/freeze), anim(t, dt, m) }
const BUILD = {
    slime(elite) {
        const body = new THREE.Group();
        const ink = mat(elite ? 0x8a6a00 : 0x1e1b4b, { roughness: 0.15, metalness: 0.2, emissive: elite ? 0x5a4000 : 0x1e1b4b, emissiveIntensity: 0.4 });
        const blob = mesh(new THREE.SphereGeometry(0.62, 20, 14), ink, body, 0, 0.55, 0);
        const shine = mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xa5b4fc, transparent: true, opacity: 0.45 }), blob, -0.22, 0.32, 0.38);
        shine.castShadow = false;
        const eyeW = glowMat(0xe0f2fe);
        const pupil = glowMat(0x0f172a);
        for (const s of [-1, 1]) {
            const e = mesh(new THREE.SphereGeometry(0.13, 10, 8), eyeW, blob, s * 0.2, 0.12, 0.52);
            mesh(new THREE.SphereGeometry(0.065, 8, 6), pupil, e, 0, 0, 0.09);
        }
        const glow = eyeSprite(0x67e8f9, 0.9);
        glow.position.set(0, 0.7, 0.5);
        body.add(glow);
        // drips
        for (let i = 0; i < 4; i++) mesh(new THREE.SphereGeometry(0.12, 8, 6), ink, body, Math.cos(i * 1.6) * 0.45, 0.1, Math.sin(i * 1.6) * 0.45);
        return {
            body,
            mats: [ink],
            anim(t, dt, m) {
                const hop = Math.abs(Math.sin(t * 6 + m.phase));
                const moving = m.speedNow > 0.4 ? 1 : 0.3;
                blob.position.y = 0.55 + hop * 0.35 * moving;
                const sq = 1 + (1 - hop) * 0.18 * moving;
                blob.scale.set(sq, 1 / sq, sq);
                if (m.attackT > 0) blob.scale.set(1.25, 0.8, 1.25);
            },
        };
    },

    book(elite) {
        const body = new THREE.Group();
        const coverColor = elite ? 0xd4a017 : [0x7f1d1d, 0x1e3a8a, 0x14532d, 0x581c87][Math.floor(Math.random() * 4)];
        const cover = mat(coverColor, { roughness: 0.5, emissive: coverColor, emissiveIntensity: 0.15 });
        const page = mat(0xfdf6e3, { roughness: 0.9 });
        const gold = mat(0xd4a017, { metalness: 0.8, roughness: 0.3 });
        const spine = mesh(new THREE.BoxGeometry(0.12, 0.12, 0.8), cover, body, 0, 0, 0);
        const halves = [];
        for (const s of [-1, 1]) {
            const hinge = new THREE.Group();
            body.add(hinge);
            const c = mesh(new THREE.BoxGeometry(0.62, 0.05, 0.8), cover, hinge, s * 0.31, 0, 0);
            mesh(new THREE.BoxGeometry(0.58, 0.07, 0.74), page, hinge, s * 0.3, s * 0.0 + 0.05 * -1 * 0, 0);
            mesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), gold, c, s * 0.24, 0.03, 0.33);
            // teeth along the edge
            for (let k = 0; k < 5; k++) {
                const tooth = mesh(new THREE.ConeGeometry(0.035, 0.12, 5), page, hinge, s * 0.6, -0.06, -0.3 + k * 0.15);
                tooth.rotation.z = s * Math.PI;
            }
            halves.push({ hinge, s });
        }
        const tongue = mesh(new THREE.BoxGeometry(0.16, 0.03, 0.4), mat(0xdc2626), body, 0, -0.02, 0.15);
        for (const s of [-1, 1]) {
            const e = eyeSprite(0xf87171, 0.32);
            e.position.set(s * 0.18, 0.1, 0.42);
            body.add(e);
        }
        body.rotation.x = -0.2;
        return {
            body,
            mats: [cover],
            anim(t, dt, m) {
                const flap = 0.35 + Math.sin(t * 16 + m.phase) * 0.45;
                halves.forEach(({ hinge, s }) => { hinge.rotation.z = s * flap; });
                body.position.y = Math.sin(t * 3 + m.phase) * 0.12;
                tongue.visible = m.attackT > 0;
                spine.rotation.z = 0;
            },
        };
    },

    goblin(elite) {
        const body = new THREE.Group();
        const skin = mat(elite ? 0xc9a227 : 0x6b8e5a, { roughness: 0.8 });
        const cloth = mat(0x4a3424, { roughness: 0.9 });
        const torso = mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.6, 10), cloth, body, 0, 0.72, 0);
        const head = mesh(new THREE.SphereGeometry(0.3, 14, 10), skin, body, 0, 1.18, 0.02);
        for (const s of [-1, 1]) {
            const ear = mesh(new THREE.ConeGeometry(0.1, 0.42, 6), skin, head, s * 0.32, 0.08, 0);
            ear.rotation.z = -s * 1.2;
            const e = eyeSprite(0xfde047, 0.26);
            e.position.set(s * 0.11, 0.04, 0.27);
            head.add(e);
        }
        mesh(new THREE.ConeGeometry(0.07, 0.2, 6), skin, head, 0, -0.04, 0.32).rotation.x = Math.PI / 2;
        const limbs = [];
        for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 0.36, 0.95, 0);
            body.add(arm);
            mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.55, 6), skin, arm, 0, -0.26, 0);
            const leg = new THREE.Group();
            leg.position.set(s * 0.15, 0.45, 0);
            body.add(leg);
            mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.45, 6), cloth, leg, 0, -0.22, 0);
            limbs.push({ arm, leg, s });
        }
        // a little dagger
        mesh(new THREE.BoxGeometry(0.04, 0.04, 0.4), mat(0xcbd5e1, { metalness: 0.8, roughness: 0.2 }), limbs[1].arm, 0, -0.52, 0.18);
        return {
            body,
            mats: [skin],
            anim(t, dt, m) {
                const sp = Math.min(1.3, m.speedNow / 3);
                const w = Math.sin(t * 13 + m.phase) * 0.8 * sp;
                limbs.forEach(({ arm, leg, s }) => {
                    arm.rotation.x = w * s;
                    leg.rotation.x = -w * s;
                });
                if (m.attackT > 0) limbs[1].arm.rotation.x = -1.8 + m.attackT * 3;
                body.position.y = Math.abs(Math.sin(t * 13 + m.phase)) * 0.06 * sp;
                torso.rotation.x = 0.15 * sp;
            },
        };
    },

    archer(elite) {
        const body = new THREE.Group();
        const bone = mat(elite ? 0xfacc15 : 0xe7e2d3, { roughness: 0.6 });
        const dark = mat(0x1f2937);
        const skull = mesh(new THREE.SphereGeometry(0.24, 14, 10), bone, body, 0, 1.72, 0);
        mesh(new THREE.BoxGeometry(0.26, 0.1, 0.2), bone, skull, 0, -0.2, 0.04);
        for (const s of [-1, 1]) {
            mesh(new THREE.SphereGeometry(0.06, 8, 6), dark, skull, s * 0.09, 0.02, 0.2);
            const e = eyeSprite(0x22d3ee, 0.22);
            e.position.set(s * 0.09, 0.02, 0.24);
            skull.add(e);
        }
        mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), bone, body, 0, 1.15, 0);
        for (let k = 0; k < 4; k++) {
            const r = mesh(new THREE.TorusGeometry(0.2 - k * 0.025, 0.025, 5, 14), bone, body, 0, 1.38 - k * 0.11, 0);
            r.rotation.x = Math.PI / 2;
            r.scale.z = 0.7;
        }
        mesh(new THREE.BoxGeometry(0.36, 0.1, 0.16), bone, body, 0, 0.78, 0);
        const limbs = [];
        for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 0.25, 1.48, 0);
            body.add(arm);
            mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.62, 5), bone, arm, 0, -0.3, 0);
            const leg = new THREE.Group();
            leg.position.set(s * 0.13, 0.76, 0);
            body.add(leg);
            mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.74, 5), bone, leg, 0, -0.37, 0);
            limbs.push({ arm, leg, s });
        }
        // the bow
        const bow = new THREE.Group();
        bow.position.set(-0.05, -0.55, 0.2);
        limbs[0].arm.add(bow);
        const bowM = mesh(new THREE.TorusGeometry(0.42, 0.025, 5, 16, Math.PI * 0.9), mat(0x5b3a1f), bow);
        bowM.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.15);
        const glow = eyeSprite(0x22d3ee, 0.5);
        glow.position.set(0, 0, 0.1);
        glow.visible = false;
        bow.add(glow);
        return {
            body,
            mats: [bone],
            anim(t, dt, m) {
                const sp = Math.min(1, m.speedNow / 2.5);
                const w = Math.sin(t * 8 + m.phase) * 0.6 * sp;
                limbs.forEach(({ arm, leg, s }) => {
                    arm.rotation.x = w * s * 0.5;
                    leg.rotation.x = -w * s;
                });
                const aiming = m.aimT > 0;
                glow.visible = aiming;
                if (aiming) {
                    limbs[0].arm.rotation.x = -1.5;
                    limbs[1].arm.rotation.x = -1.3;
                }
                skull.rotation.z = Math.sin(t * 2 + m.phase) * 0.08;
            },
        };
    },

    golem(elite) {
        const body = new THREE.Group();
        const rock = mat(elite ? 0xa1801a : 0x6b6670, { roughness: 0.95, flatShading: true });
        const lava = glowMat(elite ? 0xfff0a0 : 0xff7a1a);
        const chest = mesh(new THREE.DodecahedronGeometry(0.95, 0), rock, body, 0, 1.95, 0);
        chest.scale.set(1.2, 1, 0.9);
        mesh(new THREE.DodecahedronGeometry(0.5, 0), rock, body, 0, 3.0, 0.15);
        mesh(new THREE.DodecahedronGeometry(0.6, 0), rock, body, 0, 1.05, 0).scale.set(1.1, 0.7, 0.9);
        // glowing cracks and eyes
        const core = mesh(new THREE.OctahedronGeometry(0.28, 0), lava, chest, 0, 0.1, 0.75);
        core.castShadow = false;
        for (const s of [-1, 1]) {
            const e = eyeSprite(elite ? 0xfff0a0 : 0xffa94d, 0.4);
            e.position.set(s * 0.18, 3.05, 0.55);
            body.add(e);
        }
        const coreGlow = eyeSprite(0xff7a1a, 1.4);
        coreGlow.position.set(0, 2.05, 0.8);
        body.add(coreGlow);
        const limbs = [];
        for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 1.25, 2.4, 0);
            body.add(arm);
            mesh(new THREE.DodecahedronGeometry(0.42, 0), rock, arm, 0, -0.25, 0);
            mesh(new THREE.DodecahedronGeometry(0.38, 0), rock, arm, 0, -0.9, 0.05);
            mesh(new THREE.DodecahedronGeometry(0.5, 0), rock, arm, 0, -1.55, 0.1);
            const leg = new THREE.Group();
            leg.position.set(s * 0.55, 0.9, 0);
            body.add(leg);
            mesh(new THREE.DodecahedronGeometry(0.45, 0), rock, leg, 0, -0.45, 0);
            limbs.push({ arm, leg, s });
        }
        return {
            body,
            mats: [rock],
            anim(t, dt, m) {
                const sp = Math.min(1, m.speedNow / 1.5);
                const w = Math.sin(t * 4 + m.phase) * 0.45 * sp;
                limbs.forEach(({ arm, leg, s }) => {
                    arm.rotation.x = -w * s;
                    leg.rotation.x = w * s;
                });
                if (m.attackT > 0) {
                    const k = Math.sin(Math.min(1, m.attackT / 0.6) * Math.PI);
                    limbs.forEach(({ arm }) => { arm.rotation.x = -2.6 * k; });
                }
                body.rotation.z = Math.sin(t * 4 + m.phase) * 0.04 * sp;
                coreGlow.material.opacity = 0.6 + Math.sin(t * 5) * 0.3;
            },
        };
    },

    bat(elite) {
        const body = new THREE.Group();
        const fur = mat(elite ? 0xb08d1a : 0x2e1065, { roughness: 0.8 });
        const wingM = new THREE.MeshStandardMaterial({ color: elite ? 0xd4a017 : 0x4c1d95, side: THREE.DoubleSide, roughness: 0.7 });
        mesh(new THREE.SphereGeometry(0.2, 10, 8), fur, body, 0, 0, 0).scale.set(1, 0.9, 1.3);
        for (const s of [-1, 1]) {
            mesh(new THREE.ConeGeometry(0.06, 0.16, 4), fur, body, s * 0.1, 0.2, 0.05);
            const e = eyeSprite(0xef4444, 0.18);
            e.position.set(s * 0.07, 0.04, 0.22);
            body.add(e);
        }
        const wings = [];
        for (const s of [-1, 1]) {
            const hinge = new THREE.Group();
            hinge.position.x = s * 0.12;
            body.add(hinge);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.15, s * 0.7, 0.1, 0.05, s * 0.55, 0, -0.25, 0, 0, 0.15, s * 0.55, 0, -0.25, 0, 0, -0.15], 3));
            g.computeVertexNormals();
            mesh(g, wingM, hinge);
            wings.push({ hinge, s });
        }
        return {
            body,
            mats: [fur],
            anim(t, dt, m) {
                const f = Math.sin(t * 28 + m.phase) * 0.9;
                wings.forEach(({ hinge, s }) => { hinge.rotation.z = s * f; });
                body.position.y = Math.sin(t * 5 + m.phase) * 0.2;
            },
        };
    },

    wizard(elite) {
        const body = new THREE.Group();
        const robe = mat(elite ? 0x8a6a00 : 0x1e1033, { roughness: 0.9 });
        const trim = mat(0xa855f7, { emissive: 0x7e22ce, emissiveIntensity: 0.8 });
        const r = mesh(new THREE.ConeGeometry(0.62, 1.7, 14, 1, true), robe, body, 0, 1.0, 0);
        r.material.side = THREE.DoubleSide;
        mesh(new THREE.TorusGeometry(0.6, 0.04, 6, 20), trim, body, 0, 0.18, 0).rotation.x = Math.PI / 2;
        const hood = mesh(new THREE.ConeGeometry(0.32, 0.7, 12), robe, body, 0, 2.0, 0);
        const face = mesh(new THREE.SphereGeometry(0.22, 12, 8), glowMat(0x050208), body, 0, 1.78, 0.08);
        face.castShadow = false;
        for (const s of [-1, 1]) {
            const e = eyeSprite(0xd8b4fe, 0.24);
            e.position.set(s * 0.08, 1.8, 0.28);
            body.add(e);
        }
        const staff = new THREE.Group();
        staff.position.set(0.55, 1.2, 0.2);
        body.add(staff);
        mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.9, 6), mat(0x3b2412), staff, 0, 0, 0);
        const orb = mesh(new THREE.SphereGeometry(0.14, 12, 8), glowMat(0xe9d5ff), staff, 0, 1.0, 0);
        orb.castShadow = false;
        const orbGlow = eyeSprite(0xa855f7, 1.0);
        orbGlow.position.y = 1.0;
        staff.add(orbGlow);
        hood.rotation.x = -0.1;
        return {
            body,
            mats: [robe],
            anim(t, dt, m) {
                body.position.y = 0.25 + Math.sin(t * 2 + m.phase) * 0.12;
                staff.rotation.z = Math.sin(t * 1.5 + m.phase) * 0.1;
                const charge = m.aimT > 0 ? 1.8 : 1;
                orbGlow.scale.setScalar(charge + Math.sin(t * 6) * 0.15);
                r.rotation.y = Math.sin(t * 1.3) * 0.1;
            },
        };
    },

    titan(elite) {
        const body = new THREE.Group();
        const ink = mat(0x14102e, { roughness: 0.2, metalness: 0.3, emissive: 0x1e1b4b, emissiveIntensity: 0.5 });
        const crystal = new THREE.MeshStandardMaterial({ color: 0xf0abfc, emissive: 0xd946ef, emissiveIntensity: 1.6, roughness: 0.1, flatShading: true });
        const horn = mat(0xe7e2d3);
        mesh(new THREE.SphereGeometry(1.6, 20, 14), ink, body, 0, 3.6, 0).scale.set(1.1, 1.2, 0.9);
        mesh(new THREE.SphereGeometry(1.1, 18, 12), ink, body, 0, 1.7, 0);
        const head = mesh(new THREE.SphereGeometry(0.85, 18, 12), ink, body, 0, 5.4, 0.3);
        for (const s of [-1, 1]) {
            const h = mesh(new THREE.ConeGeometry(0.22, 1.2, 8), horn, head, s * 0.55, 0.55, 0);
            h.rotation.z = -s * 0.6;
            const e = eyeSprite(0xf0abfc, 0.6);
            e.position.set(s * 0.3, 0.05, 0.78);
            head.add(e);
        }
        const core = mesh(new THREE.OctahedronGeometry(0.55, 0), crystal, body, 0, 3.7, 1.35);
        core.castShadow = false;
        const coreGlow = eyeSprite(0xe879f9, 4.5);
        coreGlow.position.set(0, 3.7, 1.5);
        body.add(coreGlow);
        // crystal spikes on the back
        for (let i = 0; i < 6; i++) {
            const sp = mesh(new THREE.ConeGeometry(0.2, 1.0 + (i % 2) * 0.4, 5), crystal, body, (i % 3 - 1) * 0.7, 3.4 + Math.floor(i / 3) * 1.0, -1.3);
            sp.rotation.x = -0.9;
            sp.castShadow = false;
        }
        const limbs = [];
        for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 1.9, 4.4, 0);
            body.add(arm);
            mesh(new THREE.SphereGeometry(0.6, 12, 10), ink, arm, 0, -0.4, 0);
            mesh(new THREE.CylinderGeometry(0.45, 0.35, 1.6, 10), ink, arm, 0, -1.4, 0);
            mesh(new THREE.SphereGeometry(0.75, 12, 10), ink, arm, 0, -2.5, 0.1);
            const leg = new THREE.Group();
            leg.position.set(s * 0.8, 1.3, 0);
            body.add(leg);
            mesh(new THREE.CylinderGeometry(0.55, 0.65, 1.3, 10), ink, leg, 0, -0.65, 0);
            limbs.push({ arm, leg, s });
        }
        return {
            body,
            mats: [ink],
            anim(t, dt, m) {
                const sp = Math.min(1, m.speedNow / 1.2);
                const w = Math.sin(t * 3 + m.phase) * 0.35 * sp;
                limbs.forEach(({ arm, leg, s }) => {
                    arm.rotation.x = -w * s;
                    leg.rotation.x = w * s;
                });
                if (m.attackT > 0) {
                    const k = Math.sin(Math.min(1, m.attackT / 0.9) * Math.PI);
                    limbs.forEach(({ arm }) => { arm.rotation.x = -2.8 * k; });
                }
                core.rotation.y = t * 1.5;
                coreGlow.material.opacity = 0.7 + Math.sin(t * 4) * 0.3;
                head.rotation.y = Math.sin(t * 0.7) * 0.3;
            },
        };
    },
};

// health bar above a monster (always faces the camera)
function makeBar(width) {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.14), new THREE.MeshBasicMaterial({ color: 0x0b0b14, transparent: true, opacity: 0.75, depthTest: false }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(width - 0.06, 0.08), new THREE.MeshBasicMaterial({ color: 0xef4444, depthTest: false }));
    bg.renderOrder = 30;
    fill.renderOrder = 31;
    g.add(bg, fill);
    g.userData = { fill, width: width - 0.06 };
    g.visible = false;
    return g;
}

// ---------------------------------------------------------------- monster objects (shared by the sim and the view)
let nextId = 1;
export function createMonster(scene, kind, { elite = false, mini = false, id = null, x = 0, z = 0, y = 0, hpScale = 1 } = {}) {
    const def = KINDS[kind];
    const root = new THREE.Group();
    // only the big ones throw shadows (lots of small monsters cost a lot to draw twice)
    const shadows = SHADOWS.on;
    SHADOWS.on = shadows && Boolean(def.heavy);
    const built = BUILD[kind](elite);
    SHADOWS.on = shadows;
    const size = (mini ? 0.6 : 1) * (elite ? 1.25 : 1);
    built.body.scale.setScalar(size);
    root.add(built.body);
    const bar = makeBar(def.boss ? 0 : Math.max(0.9, def.radius * 1.8));
    bar.position.y = def.height * size * (def.fly ? 0.5 : 1) + 0.45;
    root.add(bar);
    let aura = null;
    if (elite) {
        aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xfacc15, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 }));
        aura.scale.setScalar(def.height * 2.2 * size + 1);
        aura.position.y = def.fly ? 0 : def.height * size * 0.5;
        root.add(aura);
    }
    root.position.set(x, y + (def.fly || 0), z);
    scene.add(root);
    const maxHp = Math.round(def.hp * hpScale * (elite ? 2.6 : 1) * (mini ? 0.35 : 1));
    return {
        id: id ?? nextId++,
        kind,
        def,
        elite,
        mini,
        size,
        radius: def.radius * size,
        root,
        built,
        bar,
        aura,
        pos: new THREE.Vector3(x, y, z),
        vel: new THREE.Vector3(),
        yaw: 0,
        hp: maxHp,
        maxHp,
        alive: true,
        phase: Math.random() * 10,
        speedNow: 0,
        attackT: 0,
        aimT: 0,
        frozenT: 0,
        hitFlash: 0,
        barT: 0,
        dieT: 0,
        // sim only
        atkCd: Math.random(),
        shootCd: 1 + Math.random() * 2,
        summonCd: def.summon ? def.summon.every * 0.6 : 0,
        teleCd: 3,
        target: null,
        thinkT: Math.random() * 0.3,
        stuckT: 0,
        lastPos: new THREE.Vector3(x, y, z),
    };
}
export const setMonsterShadows = (on) => { SHADOWS.on = on; };

const FREEZE_COLOR = new THREE.Color(0x7dd3fc);
const FLASH_COLOR = new THREE.Color(0xffffff);
const tmpQ = new THREE.Quaternion();

/** Draw a monster for this frame (animation, hit flash, freeze tint, health bar). */
export function updateMonsterVisual(m, t, dt, camera) {
    m.root.position.set(m.pos.x, m.pos.y + (m.def.fly || 0), m.pos.z);
    m.built.body.rotation.y = m.yaw;
    const timeScale = m.frozenT > 0 ? 0.35 : 1;
    m.animT = (m.animT || 0) + dt * timeScale;
    m.built.anim(m.animT, dt, m);
    m.hitFlash = Math.max(0, m.hitFlash - dt * 6);
    m.attackT = Math.max(0, m.attackT - dt);
    m.aimT = Math.max(0, m.aimT - dt);
    for (const mt of m.built.mats) {
        if (!mt.userData.base) mt.userData.base = { e: mt.emissive.clone(), i: mt.emissiveIntensity };
        const b = mt.userData.base;
        if (m.hitFlash > 0) {
            mt.emissive.copy(FLASH_COLOR);
            mt.emissiveIntensity = m.hitFlash * 0.9;
        } else if (m.frozenT > 0) {
            mt.emissive.copy(FREEZE_COLOR);
            mt.emissiveIntensity = 0.7;
        } else {
            mt.emissive.copy(b.e);
            mt.emissiveIntensity = b.i;
        }
    }
    m.barT -= dt;
    const showBar = m.alive && !m.def.boss && (m.barT > 0 || m.elite || m.def.heavy) && m.hp < m.maxHp;
    m.bar.visible = showBar;
    if (showBar) {
        m.bar.quaternion.copy(camera.quaternion);
        const k = Math.max(0.001, m.hp / m.maxHp);
        const { fill, width } = m.bar.userData;
        fill.scale.x = k;
        fill.position.x = -(1 - k) * width / 2;
        fill.material.color.setHex(m.elite ? 0xfacc15 : k > 0.5 ? 0xef4444 : 0xf97316);
    }
    if (m.aura) m.aura.material.opacity = 0.35 + Math.sin(t * 4 + m.phase) * 0.15;
}

/** A dying monster: it pops, shrinks and fades. Returns true when it's gone. */
export function updateDying(m, dt) {
    m.dieT += dt;
    const k = m.dieT / 0.45;
    const s = m.size * Math.max(0.01, 1 - k) * (1 + Math.sin(Math.min(1, k) * Math.PI) * 0.35);
    m.built.body.scale.setScalar(s);
    m.built.body.rotation.y += dt * 9;
    m.bar.visible = false;
    if (m.aura) m.aura.visible = false;
    return k >= 1;
}

export function disposeMonster(scene, m) {
    scene.remove(m.root);
    m.root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
            (Array.isArray(o.material) ? o.material : [o.material]).forEach((mt) => {
                if (mt.map && mt.map !== glowTexture()) mt.map.dispose();
                mt.dispose();
            });
        }
    });
}

/** Ray against a monster's body (a vertical capsule-ish cylinder plus a sphere on top). */
export function rayHitsMonster(m, o, d, maxDist) {
    if (!m.alive) return null;
    const r = m.radius * 1.05;
    const base = m.pos.y + (m.def.fly ? m.def.fly - m.def.height * m.size * 0.5 : 0);
    const top = base + m.def.height * m.size;
    // cylinder (sides)
    const px = o.x - m.pos.x;
    const pz = o.z - m.pos.z;
    const a = d.x * d.x + d.z * d.z;
    let best = null;
    if (a > 1e-9) {
        const b = 2 * (px * d.x + pz * d.z);
        const c = px * px + pz * pz - r * r;
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
            const t = (-b - Math.sqrt(disc)) / (2 * a);
            const y = o.y + d.y * t;
            if (t > 0 && t < maxDist && y > base && y < top) best = { dist: t, weak: y > top - (top - base) * 0.25 };
        }
    }
    // a sphere on the top (the head: a weak spot)
    const hx = o.x - m.pos.x;
    const hy = o.y - (top - r * 0.6);
    const hz = o.z - m.pos.z;
    const bb = hx * d.x + hy * d.y + hz * d.z;
    const cc = hx * hx + hy * hy + hz * hz - r * r * 0.6;
    const disc2 = bb * bb - cc;
    if (disc2 >= 0) {
        const t = -bb - Math.sqrt(disc2);
        if (t > 0 && t < maxDist && (!best || t < best.dist)) best = { dist: t, weak: true };
    }
    return best;
}

/** Centre of a monster's body (for explosions, chains, aim assist). */
export function monsterCenter(m, out) {
    const base = m.pos.y + (m.def.fly ? m.def.fly - m.def.height * m.size * 0.5 : 0);
    return out.set(m.pos.x, base + m.def.height * m.size * 0.5, m.pos.z);
}

// ---------------------------------------------------------------- the simulation (party leader only)
/**
 * ctx: { scene, lib, players(): [{ name, pos, alive, isMe }], hooks: {
 *   hitPlayer(name, dmg, kbx, kbz, kind), hitBook(dmg), shot(proj), died(m, killer), spawned(m) } }
 */
export function createMonsterSim(ctx) {
    const { scene, lib } = ctx;
    const monsters = [];
    const projectiles = []; // { pos, vel, dmg, bookDmg, color, life, homing, target, lob, mesh }
    const fields = new Map(); // player name -> { field, t }
    const tmp = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const tgt = new THREE.Vector3();

    function spawn(kind, opts = {}) {
        let x = opts.x;
        let z = opts.z;
        if (x === undefined) {
            const p = PORTALS[opts.portal ?? Math.floor(Math.random() * PORTALS.length)];
            // step out of the portal toward the centre
            const toC = Math.atan2(-p.x, -p.z);
            const spread = (Math.random() - 0.5) * 6;
            x = p.x + Math.sin(toC) * 2.5 + Math.cos(toC) * spread;
            z = p.z + Math.cos(toC) * 2.5 - Math.sin(toC) * spread;
        }
        const m = createMonster(scene, kind, { ...opts, x, z, y: 0 });
        m.yaw = Math.atan2(-m.pos.x, -m.pos.z);
        monsters.push(m);
        if (ctx.hooks.spawned) ctx.hooks.spawned(m);
        return m;
    }

    function fieldFor(name, pos, time) {
        let f = fields.get(name);
        if (!f) {
            f = { field: new Float32Array(lib.N * lib.N), t: -99 };
            fields.set(name, f);
        }
        if (time - f.t > 0.6) {
            lib.flowField([pos], f.field, 0);
            f.t = time;
        }
        return f.field;
    }

    function damage(m, amount, killer, fx = null) {
        if (!m.alive) return false;
        m.hp -= amount;
        m.barT = 4;
        m.hitFlash = 1;
        if (fx === 'freeze') m.frozenT = 3;
        if (m.def.teleport && m.hp < m.maxHp * 0.6 && m.teleCd <= 0) teleport(m);
        if (m.hp <= 0) {
            m.hp = 0;
            m.alive = false;
            if (ctx.hooks.died) ctx.hooks.died(m, killer);
            // ink slimes split in two
            if (m.kind === 'slime' && !m.mini && (ctx.wave ? ctx.wave() : 1) >= 3) {
                for (const s of [-1, 1]) {
                    const c = spawn('slime', { mini: true, x: m.pos.x + s * 0.6, z: m.pos.z + s * 0.3, hpScale: ctx.hpScale ? ctx.hpScale() : 1 });
                    c.vel.set(s * 3, 0, 0);
                }
            }
            return true;
        }
        return false;
    }

    function teleport(m) {
        m.teleCd = 6;
        for (let k = 0; k < 12; k++) {
            const a = Math.random() * Math.PI * 2;
            const x = m.pos.x + Math.cos(a) * 8;
            const z = m.pos.z + Math.sin(a) * 8;
            if (!lib.isBlocked(x, z) && Math.abs(x) < 60 && Math.abs(z) < 60) {
                if (ctx.hooks.teleported) ctx.hooks.teleported(m, m.pos.clone(), new THREE.Vector3(x, 0, z));
                m.pos.set(x, 0, z);
                return;
            }
        }
    }

    function nearestPlayer(m, maxD, needSight) {
        let best = null;
        let bestD = maxD;
        for (const p of ctx.players()) {
            if (!p.alive) continue;
            const d = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
            if (d >= bestD) continue;
            if (needSight) {
                monsterCenter(m, eye);
                tgt.copy(p.pos).y += 1.2;
                if (!lib.lineOfSight(eye, tgt)) continue;
            }
            best = p;
            bestD = d;
        }
        return best;
    }

    function shoot(m, target) {
        const sh = m.def.shoot;
        monsterCenter(m, eye);
        eye.y += m.def.height * m.size * 0.2;
        if (target === 'book') tgt.set(BOOK_POS.x, 2.2, BOOK_POS.z);
        else tgt.copy(target.pos).y += 1.0;
        dir.subVectors(tgt, eye);
        const dist = dir.length();
        // lead a moving target a little, and miss a bit (they're monsters, not machines)
        if (target !== 'book' && target.vel) tgt.addScaledVector(target.vel, (dist / sh.speed) * 0.6);
        dir.subVectors(tgt, eye).normalize();
        const err = target === 'book' ? 0.01 : 0.05;
        dir.x += (Math.random() - 0.5) * err * 2;
        dir.y += (Math.random() - 0.5) * err;
        dir.z += (Math.random() - 0.5) * err * 2;
        dir.normalize();
        const vel = dir.clone().multiplyScalar(sh.speed);
        if (sh.lob) vel.y += Math.min(10, dist * 0.35);
        const p = { pos: eye.clone(), vel, dmg: sh.dmg * (m.elite ? 1.4 : 1), bookDmg: sh.bookDmg, color: sh.color, life: 4, homing: Boolean(sh.homing), lob: Boolean(sh.lob), target: target === 'book' ? null : target.name, big: m.kind === 'titan' };
        projectiles.push(p);
        if (ctx.hooks.shot) ctx.hooks.shot(p);
    }

    function separate() {
        for (let i = 0; i < monsters.length; i++) {
            const a = monsters[i];
            if (!a.alive) continue;
            for (let j = i + 1; j < monsters.length; j++) {
                const b = monsters[j];
                if (!b.alive || Boolean(a.def.fly) !== Boolean(b.def.fly)) continue;
                const dx = b.pos.x - a.pos.x;
                const dz = b.pos.z - a.pos.z;
                const min = (a.radius + b.radius) * 0.9;
                const d2 = dx * dx + dz * dz;
                if (d2 >= min * min || d2 < 1e-6) continue;
                const d = Math.sqrt(d2);
                const push = (min - d) / d * 0.5;
                const wa = a.def.heavy ? 0.2 : 1;
                const wb = b.def.heavy ? 0.2 : 1;
                a.pos.x -= dx * push * wa;
                a.pos.z -= dz * push * wa;
                b.pos.x += dx * push * wb;
                b.pos.z += dz * push * wb;
            }
        }
    }

    function update(dt, time) {
        const players = ctx.players();
        for (const m of monsters) {
            if (!m.alive) continue;
            const def = m.def;
            m.frozenT = Math.max(0, m.frozenT - dt);
            m.teleCd -= dt;
            const slow = m.frozenT > 0 ? 0.4 : 1;
            // ---- choose a target now and then
            m.thinkT -= dt;
            if (m.thinkT <= 0) {
                m.thinkT = 0.35 + Math.random() * 0.2;
                const bookD = Math.hypot(m.pos.x - BOOK_POS.x, m.pos.z - BOOK_POS.z);
                const p = nearestPlayer(m, def.aggro, true);
                // heavy ones go for the book unless you're right there
                if (p && !(def.heavy && bookD < 14)) m.target = p;
                else if (!p || !m.target || m.target === 'book' || !m.target.alive) m.target = 'book';
                if (m.target !== 'book' && (!m.target.alive || Math.hypot(m.target.pos.x - m.pos.x, m.target.pos.z - m.pos.z) > def.aggro * 1.6)) m.target = 'book';
                // someone up on the shelves is out of reach for walkers that can't shoot: go for the book
                if (m.target !== 'book' && !def.fly && !def.shoot && m.target.pos.y - m.pos.y > 2) m.target = 'book';
            }
            const target = m.target || 'book';
            const tp = target === 'book' ? BOOK_POS : target.pos;
            const dx = tp.x - m.pos.x;
            const dz = tp.z - m.pos.z;
            const dist = Math.hypot(dx, dz);
            const reach = target === 'book' ? BOOK_RADIUS + m.radius + def.range * 0.6 + (def.heavy ? 0.6 : 0) : m.radius + 0.45 + def.range;

            // ---- ranged attackers stop and shoot when they can see the target
            let wantMove = true;
            if (def.shoot) {
                m.shootCd -= dt * slow;
                const inRange = dist < def.shoot.range;
                let canSee = false;
                if (inRange) {
                    monsterCenter(m, eye);
                    if (target === 'book') tgt.set(0, 2.2, 0);
                    else tgt.copy(target.pos).y += 1.0;
                    canSee = lib.lineOfSight(eye, tgt);
                }
                if (inRange && canSee) {
                    if (!def.heavy) wantMove = dist > def.shoot.range * 0.7;
                    if (m.shootCd <= 0.5) m.aimT = 0.5;
                    if (m.shootCd <= 0) {
                        m.shootCd = 1 / def.shoot.rate * (0.8 + Math.random() * 0.4);
                        shoot(m, target);
                    }
                }
            }
            // ---- summoners call friends
            if (def.summon) {
                m.summonCd -= dt;
                if (m.summonCd <= 0) {
                    m.summonCd = def.summon.every;
                    const alive = monsters.filter((o) => o.alive).length;
                    if (alive < 70) {
                        for (let k = 0; k < def.summon.count; k++) {
                            const a = (k / def.summon.count) * Math.PI * 2;
                            spawn(def.summon.kind, { x: m.pos.x + Math.cos(a) * (m.radius + 1.5), z: m.pos.z + Math.sin(a) * (m.radius + 1.5), hpScale: ctx.hpScale ? ctx.hpScale() : 1 });
                        }
                        if (ctx.hooks.summoned) ctx.hooks.summoned(m);
                    }
                }
            }

            // ---- melee
            m.atkCd -= dt * slow;
            if (dist < reach) {
                wantMove = false;
                if (m.atkCd <= 0 && (def.dmg > 0 || target === 'book') && (def.bookDmg > 0 || target !== 'book')) {
                    m.atkCd = 1 / def.rate;
                    m.attackT = def.heavy ? 0.9 : 0.35;
                    const mult = m.elite ? 1.5 : 1;
                    if (def.slam) {
                        // a ground slam hits everyone close by (and the book)
                        if (ctx.hooks.slam) ctx.hooks.slam(m);
                        for (const p of players) {
                            if (!p.alive) continue;
                            const d = Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z);
                            if (d < def.slam + 0.5 && p.pos.y < 2.5) {
                                const kx = (p.pos.x - m.pos.x) / (d || 1);
                                const kz = (p.pos.z - m.pos.z) / (d || 1);
                                ctx.hooks.hitPlayer(p.name, def.dmg * mult * (1 - d / (def.slam + 1) * 0.4), kx * 9, kz * 9, m.kind);
                            }
                        }
                        if (target === 'book' || Math.hypot(m.pos.x, m.pos.z) < BOOK_RADIUS + def.slam) ctx.hooks.hitBook(def.bookDmg * mult);
                    } else if (target === 'book') ctx.hooks.hitBook(def.bookDmg * mult);
                    else if (target.pos.y - m.pos.y < 2.2 || def.fly) ctx.hooks.hitPlayer(target.name, def.dmg * mult, dx / (dist || 1) * 3, dz / (dist || 1) * 3, m.kind);
                }
            }

            // ---- moving
            let mx = 0;
            let mz = 0;
            if (def.fly) {
                // flyers go straight, high over the shelves, and swoop down near the target
                if (dist > 0.01) {
                    mx = dx / dist;
                    mz = dz / dist;
                }
                const want = dist < 7 ? (target === 'book' ? 2.2 : target.pos.y + 0.6) - def.fly + 0.4 : 5.4 - def.fly + 0.4;
                m.pos.y += (Math.max(0, want) - m.pos.y) * Math.min(1, dt * 2.5);
            } else if (target === 'book' || !lib.lineOfSight(tmp.set(m.pos.x, 1, m.pos.z), eye.set(tp.x, 1, tp.z)) || dist > 9) {
                const field = target === 'book' ? lib.bookField : fieldFor(target.name, target.pos, time);
                lib.flowDir(field, m.pos.x, m.pos.z, dir);
                mx = dir.x;
                mz = dir.z;
                if (!mx && !mz && dist > 0.01) {
                    mx = dx / dist;
                    mz = dz / dist;
                }
            } else if (dist > 0.01) {
                mx = dx / dist;
                mz = dz / dist;
            }
            const speed = def.speed * slow * (m.elite ? 1.1 : 1) * (m.mini ? 1.25 : 1);
            const k = Math.min(1, dt * (def.heavy ? 3 : 7));
            const tvx = wantMove ? mx * speed : 0;
            const tvz = wantMove ? mz * speed : 0;
            m.vel.x += (tvx - m.vel.x) * k;
            m.vel.z += (tvz - m.vel.z) * k;
            m.pos.x += m.vel.x * dt;
            m.pos.z += m.vel.z * dt;
            if (!def.fly) {
                lib.pushOut(m.pos, m.radius * 0.85, def.height, 0.8);
                m.pos.y = lib.supportHeight(m.pos.x, m.pos.z, 1, 0.3, 0.8);
            }
            m.speedNow = Math.hypot(m.vel.x, m.vel.z);
            // face where it's going (or the target when close)
            const faceX = dist < reach + 2 || !wantMove ? dx : m.vel.x;
            const faceZ = dist < reach + 2 || !wantMove ? dz : m.vel.z;
            if (Math.abs(faceX) + Math.abs(faceZ) > 0.01) {
                const want = Math.atan2(faceX, faceZ);
                let d = want - m.yaw;
                while (d > Math.PI) d -= Math.PI * 2;
                while (d < -Math.PI) d += Math.PI * 2;
                m.yaw += d * Math.min(1, dt * 8);
            }
            // stuck? nudge sideways
            m.stuckT += dt;
            if (m.stuckT > 1.2) {
                if (wantMove && m.pos.distanceTo(m.lastPos) < 0.4 && !def.fly) {
                    m.pos.x += (Math.random() - 0.5) * 1.2;
                    m.pos.z += (Math.random() - 0.5) * 1.2;
                }
                m.lastPos.copy(m.pos);
                m.stuckT = 0;
            }
        }
        separate();

        // ---- projectiles
        for (let i = projectiles.length - 1; i >= 0; i--) {
            const p = projectiles[i];
            p.life -= dt;
            if (p.homing && p.target) {
                const tp = players.find((pl) => pl.name === p.target && pl.alive);
                if (tp) {
                    tgt.copy(tp.pos).y += 1.0;
                    dir.subVectors(tgt, p.pos).normalize().multiplyScalar(p.vel.length());
                    p.vel.lerp(dir, Math.min(1, dt * 1.6));
                }
            }
            if (p.lob) p.vel.y -= 9 * dt;
            const step = p.vel.length() * dt;
            dir.copy(p.vel).normalize();
            const wall = lib.raycast(p.pos, dir, step + 0.05);
            p.pos.addScaledVector(p.vel, dt);
            let done = p.life <= 0 || wall < step;
            // hit a player?
            for (const pl of players) {
                if (done || !pl.alive) continue;
                tgt.copy(pl.pos).y += 1.0;
                if (tgt.distanceTo(p.pos) < (p.big ? 1.6 : 0.8)) {
                    ctx.hooks.hitPlayer(pl.name, p.dmg, p.vel.x * 0.15, p.vel.z * 0.15, 'shot');
                    done = true;
                }
            }
            // the book's shield
            if (!done && Math.hypot(p.pos.x, p.pos.z) < 3.4 && p.pos.y < 5.5) {
                ctx.hooks.hitBook(p.bookDmg);
                done = true;
            }
            if (done) {
                if (ctx.hooks.projectileDone) ctx.hooks.projectileDone(p, i);
                if (p.big) {
                    // a titan's ink bomb splashes
                    for (const pl of players) {
                        if (!pl.alive) continue;
                        const d = pl.pos.distanceTo(p.pos);
                        if (d < 4) ctx.hooks.hitPlayer(pl.name, p.dmg * 0.5, 0, 0, 'splash');
                    }
                }
                projectiles.splice(i, 1);
            }
        }
    }

    function clear() {
        monsters.length = 0;
        projectiles.length = 0;
    }

    return { monsters, projectiles, spawn, damage, update, clear };
}
