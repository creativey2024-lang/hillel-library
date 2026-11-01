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
import { glowTexture, runeTexture } from './paint.js';
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
        const mouth = mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glowMat(0x0b0420), blob, 0, -0.12, 0.5);
        mouth.scale.set(1.3, 0.8, 0.5);
        mesh(new THREE.SphereGeometry(0.06, 8, 6), mat(0xe11d48), blob, 0.03, -0.2, 0.52).scale.set(1.2, 0.6, 1);
        // bubbles floating inside the ink
        for (let i = 0; i < 3; i++) mesh(new THREE.SphereGeometry(0.05 + i * 0.02, 8, 6), new THREE.MeshBasicMaterial({ color: 0x818cf8, transparent: true, opacity: 0.5 }), blob, 0.25 - i * 0.2, 0.3 - i * 0.12, 0.35).castShadow = false;
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
        const skin = mat(elite ? 0xc9a227 : 0x6f9a4f, { roughness: 0.75 });
        const skinDark = mat(elite ? 0x9a7a10 : 0x4d7a35, { roughness: 0.8 });
        const leather = mat(0x6b4226, { roughness: 0.85 });
        const cloth = mat(0x3f3a52, { roughness: 0.95 });
        const metal = mat(0xb8c2cc, { metalness: 0.8, roughness: 0.3 });
        const gold = mat(0xd4a017, { metalness: 0.8, roughness: 0.3 });
        const bone = mat(0xf5f0e1, { roughness: 0.5 });
        const black = glowMat(0x111111);
        const hip = new THREE.Group();
        hip.position.y = 0.62;
        body.add(hip);
        // hunched body: leather tunic, belt with a gold buckle, a shoulder pad
        const torso = new THREE.Group();
        hip.add(torso);
        torso.rotation.x = 0.28;
        mesh(new THREE.CylinderGeometry(0.27, 0.33, 0.55, 12), leather, torso, 0, 0.27, 0);
        mesh(new THREE.SphereGeometry(0.27, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), leather, torso, 0, 0.53, 0).scale.set(1, 0.6, 0.9);
        const belt = mesh(new THREE.TorusGeometry(0.31, 0.04, 6, 18), mat(0x3b2412), torso, 0, 0.06, 0);
        belt.rotation.x = Math.PI / 2;
        mesh(new THREE.BoxGeometry(0.11, 0.09, 0.04), gold, torso, 0, 0.06, 0.32);
        mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal, torso, -0.3, 0.5, 0).rotation.z = 0.5;
        // a little sack on the back
        mesh(new THREE.SphereGeometry(0.17, 10, 8), mat(0x9a7b4f, { roughness: 1 }), torso, 0, 0.32, -0.3).scale.set(1, 1.1, 0.8);
        // head
        const head = new THREE.Group();
        head.position.set(0, 0.68, 0.12);
        torso.add(head);
        mesh(new THREE.SphereGeometry(0.29, 16, 12), skin, head).scale.set(1.1, 0.95, 1);
        mesh(new THREE.BoxGeometry(0.42, 0.07, 0.1), skinDark, head, 0, 0.09, 0.22).rotation.x = -0.3; // brow
        mesh(new THREE.ConeGeometry(0.07, 0.24, 8), skin, head, 0, 0.0, 0.33).rotation.x = Math.PI / 2 + 0.25; // nose
        mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), black, head, 0, -0.13, 0.25); // mouth
        for (const s of [-1, 1]) {
            mesh(new THREE.ConeGeometry(0.025, 0.09, 5), bone, head, s * 0.07, -0.09, 0.27);
            const eye = mesh(new THREE.SphereGeometry(0.06, 10, 8), glowMat(0xfde047), head, s * 0.11, 0.03, 0.25);
            mesh(new THREE.BoxGeometry(0.018, 0.08, 0.02), black, eye, 0, 0, 0.05);
            const ear = new THREE.Group();
            ear.position.set(s * 0.3, 0.05, 0);
            ear.rotation.z = -s * 1.25;
            head.add(ear);
            mesh(new THREE.ConeGeometry(0.1, 0.48, 6), skin, ear, 0, 0.2, 0);
            mesh(new THREE.ConeGeometry(0.055, 0.34, 6), mat(0xd98a8a), ear, 0, 0.17, 0.04);
            const e = eyeSprite(0xfde047, 0.2);
            e.position.set(s * 0.11, 0.03, 0.3);
            head.add(e);
        }
        // a leather cap
        mesh(new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), leather, head, 0, 0.06, -0.02).scale.set(1.08, 0.85, 1.05);
        // arms and legs (thigh + shin + foot)
        const limbs = [];
        for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 0.34, 0.45, 0.02);
            torso.add(arm);
            mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.3, 8), skin, arm, 0, -0.15, 0);
            const fore = new THREE.Group();
            fore.position.y = -0.3;
            fore.rotation.x = -0.5;
            arm.add(fore);
            mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.28, 8), skin, fore, 0, -0.14, 0);
            mesh(new THREE.BoxGeometry(0.1, 0.06, 0.12), leather, fore, 0, -0.06, 0); // bracer
            mesh(new THREE.SphereGeometry(0.075, 8, 6), skinDark, fore, 0, -0.3, 0);
            const leg = new THREE.Group();
            leg.position.set(s * 0.15, 0, 0);
            hip.add(leg);
            mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.3, 8), cloth, leg, 0, -0.15, 0);
            mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.28, 8), skin, leg, 0, -0.42, 0);
            mesh(new THREE.BoxGeometry(0.13, 0.07, 0.24), skinDark, leg, 0, -0.57, 0.05);
            limbs.push({ arm, fore, leg, s });
        }
        // a dagger: handle, guard, blade
        const dag = new THREE.Group();
        dag.position.set(0, -0.32, 0.06);
        dag.rotation.x = Math.PI / 2;
        limbs[1].fore.add(dag);
        mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.12, 6), mat(0x3b2412), dag, 0, 0, 0);
        mesh(new THREE.BoxGeometry(0.14, 0.025, 0.04), gold, dag, 0, 0.07, 0);
        mesh(new THREE.BoxGeometry(0.05, 0.3, 0.015), metal, dag, 0, 0.23, 0);
        return {
            body,
            mats: [skin, skinDark],
            anim(t, dt, m) {
                const sp = Math.min(1.3, m.speedNow / 3);
                const ph = t * 13 + m.phase;
                const w = Math.sin(ph) * 0.8 * sp;
                limbs.forEach(({ arm, leg, s }) => {
                    arm.rotation.x = w * s * 0.8;
                    leg.rotation.x = -w * s;
                });
                if (m.attackT > 0) {
                    limbs[1].arm.rotation.x = -2.2 + m.attackT * 4;
                    limbs[1].fore.rotation.x = -0.2;
                } else limbs[1].fore.rotation.x = -0.5;
                hip.position.y = 0.62 + Math.abs(Math.sin(ph)) * 0.06 * sp;
                torso.rotation.x = 0.28 + 0.12 * sp;
                head.rotation.y = Math.sin(t * 2 + m.phase) * 0.25;
            },
        };
    },

    archer(elite) {
        const body = new THREE.Group();
        const bone = mat(elite ? 0xfacc15 : 0xe9e3d0, { roughness: 0.6 });
        const boneDark = mat(elite ? 0xb08d1a : 0xb9b29c, { roughness: 0.7 });
        const hole = glowMat(0x050507);
        const cloak = mat(0x2a1f3d, { roughness: 1, side: THREE.DoubleSide });
        const wood = mat(0x5b3a1f, { roughness: 0.7 });
        const bar = (len, r, parent, x, y, z) => mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 6), bone, parent, x, y, z);
        const joint = (parent, x, y, z, r = 0.045) => mesh(new THREE.SphereGeometry(r, 8, 6), boneDark, parent, x, y, z);
        // skull: cranium, eye sockets with blue fire, nose, jaw with teeth
        const skull = new THREE.Group();
        skull.position.set(0, 1.72, 0.02);
        body.add(skull);
        mesh(new THREE.SphereGeometry(0.2, 16, 12), bone, skull).scale.set(1, 1.05, 1.1);
        mesh(new THREE.BoxGeometry(0.26, 0.12, 0.2), bone, skull, 0, -0.1, 0.06);
        for (const s of [-1, 1]) {
            mesh(new THREE.SphereGeometry(0.058, 8, 6), hole, skull, s * 0.075, 0.0, 0.17);
            const e = eyeSprite(0x22d3ee, 0.2);
            e.position.set(s * 0.075, 0, 0.23);
            skull.add(e);
        }
        mesh(new THREE.ConeGeometry(0.025, 0.05, 3), hole, skull, 0, -0.07, 0.21).rotation.x = Math.PI;
        const jaw = new THREE.Group();
        jaw.position.set(0, -0.15, 0.04);
        skull.add(jaw);
        mesh(new THREE.BoxGeometry(0.2, 0.05, 0.16), bone, jaw, 0, -0.02, 0.04);
        for (let k = -2; k <= 2; k++) mesh(new THREE.BoxGeometry(0.022, 0.035, 0.02), bone, jaw, k * 0.032, 0.02, 0.13);
        // spine, ribs, collarbones, pelvis
        for (let k = 0; k < 6; k++) mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.07, 6), boneDark, body, 0, 0.88 + k * 0.1, -0.04);
        for (let k = 0; k < 4; k++) {
            const r = mesh(new THREE.TorusGeometry(0.19 - k * 0.022, 0.022, 5, 16, Math.PI * 1.5), bone, body, 0, 1.43 - k * 0.1, 0);
            r.rotation.set(Math.PI / 2, 0, Math.PI * 0.75);
            r.scale.z = 0.75;
        }
        bar(0.36, 0.022, body, 0, 1.25, 0.15); // sternum (lying)
        body.children[body.children.length - 1].rotation.x = 0.1;
        mesh(new THREE.BoxGeometry(0.5, 0.04, 0.05), bone, body, 0, 1.53, 0.02);
        const pelvis = mesh(new THREE.TorusGeometry(0.14, 0.045, 6, 14), bone, body, 0, 0.8, 0);
        pelvis.rotation.x = Math.PI / 2.4;
        // a ragged hood and cape
        const hood = mesh(new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), cloak, skull, 0, 0.03, -0.03);
        hood.scale.set(1.05, 1.1, 1.15);
        // (a cape hanging at the back only, so the bones show in front)
        const cape = mesh(new THREE.ConeGeometry(0.4, 1.05, 10, 1, true, Math.PI * 0.65, Math.PI * 0.7), cloak, body, 0, 1.02, -0.06);
        // quiver on the back with arrows
        const quiver = new THREE.Group();
        quiver.position.set(0.12, 1.3, -0.2);
        quiver.rotation.z = -0.35;
        body.add(quiver);
        mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.5, 10), mat(0x6b4226), quiver, 0, 0, 0);
        for (let k = 0; k < 4; k++) {
            mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.25, 4), wood, quiver, (k - 1.5) * 0.03, 0.33, (k % 2) * 0.02);
            mesh(new THREE.BoxGeometry(0.004, 0.08, 0.04), mat(0xdc2626, { side: THREE.DoubleSide }), quiver, (k - 1.5) * 0.03, 0.42, (k % 2) * 0.02);
        }
        // arms (upper, two thin forearm bones, hand) and legs
        const limbs = [];
        for (const s of [-1, 1]) {
            const arm = new THREE.Group();
            arm.position.set(s * 0.26, 1.5, 0);
            body.add(arm);
            joint(arm, 0, 0, 0, 0.05);
            bar(0.32, 0.026, arm, 0, -0.16, 0);
            const fore = new THREE.Group();
            fore.position.y = -0.33;
            arm.add(fore);
            joint(fore, 0, 0, 0);
            bar(0.3, 0.016, fore, 0.02, -0.15, 0);
            bar(0.3, 0.016, fore, -0.02, -0.15, 0);
            mesh(new THREE.BoxGeometry(0.07, 0.08, 0.04), bone, fore, 0, -0.33, 0);
            const leg = new THREE.Group();
            leg.position.set(s * 0.12, 0.8, 0);
            body.add(leg);
            joint(leg, 0, 0, 0, 0.05);
            bar(0.38, 0.03, leg, 0, -0.19, 0);
            joint(leg, 0, -0.39, 0);
            bar(0.36, 0.022, leg, 0, -0.58, 0);
            mesh(new THREE.BoxGeometry(0.09, 0.04, 0.17), bone, leg, 0, -0.78, 0.04);
            limbs.push({ arm, fore, leg, s });
        }
        // the bow: wooden arc with a string, and an arrow when aiming
        const bow = new THREE.Group();
        bow.position.set(0, -0.34, 0.04);
        limbs[0].fore.add(bow);
        const arc = mesh(new THREE.TorusGeometry(0.45, 0.022, 5, 18, Math.PI * 0.85), wood, bow);
        arc.rotation.set(0, Math.PI / 2, Math.PI / 2 + Math.PI * 0.075);
        mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.88, 3), mat(0xf5f5f4), bow, 0, 0, -0.06);
        const arrow = new THREE.Group();
        bow.add(arrow);
        mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.7, 4), wood, arrow, 0, 0, 0.25).rotation.x = Math.PI / 2;
        mesh(new THREE.ConeGeometry(0.025, 0.08, 4), glowMat(0x67e8f9), arrow, 0, 0, 0.62).rotation.x = Math.PI / 2;
        const glow = eyeSprite(0x22d3ee, 0.45);
        glow.position.set(0, 0, 0.62);
        arrow.add(glow);
        return {
            body,
            mats: [bone, boneDark],
            anim(t, dt, m) {
                const sp = Math.min(1, m.speedNow / 2.5);
                const w = Math.sin(t * 8 + m.phase) * 0.6 * sp;
                limbs.forEach(({ arm, fore, leg, s }) => {
                    arm.rotation.set(w * s * 0.5, 0, 0);
                    fore.rotation.x = -0.2;
                    leg.rotation.x = -w * s;
                });
                const aiming = m.aimT > 0;
                arrow.visible = aiming;
                if (aiming) {
                    limbs[0].arm.rotation.set(-1.45, 0, -0.15);
                    limbs[0].fore.rotation.x = 0;
                    limbs[1].arm.rotation.set(-1.3, 0, 0.5);
                    limbs[1].fore.rotation.x = -1.2;
                }
                jaw.rotation.x = 0.1 + Math.max(0, Math.sin(t * 3 + m.phase)) * 0.25;
                skull.rotation.z = Math.sin(t * 2 + m.phase) * 0.08;
                cape.rotation.x = -0.1 - sp * 0.15 + Math.sin(t * 5) * 0.03;
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
        const fur = mat(elite ? 0xb08d1a : 0x3b1f5c, { roughness: 0.9 });
        const furLight = mat(elite ? 0xd4b44a : 0x6b4a8e, { roughness: 0.9 });
        const wingM = new THREE.MeshStandardMaterial({ color: elite ? 0xd4a017 : 0x5b2a86, side: THREE.DoubleSide, roughness: 0.7, transparent: true, opacity: 0.95 });
        const finger = mat(elite ? 0x8a6a00 : 0x2a1440);
        mesh(new THREE.SphereGeometry(0.2, 12, 10), fur, body, 0, 0, 0).scale.set(1, 0.9, 1.25);
        mesh(new THREE.SphereGeometry(0.13, 10, 8), furLight, body, 0, -0.04, 0.12).scale.set(1, 0.9, 1);
        const head = new THREE.Group();
        head.position.set(0, 0.08, 0.22);
        body.add(head);
        mesh(new THREE.SphereGeometry(0.13, 12, 10), fur, head);
        mesh(new THREE.SphereGeometry(0.06, 8, 6), furLight, head, 0, -0.03, 0.11).scale.set(1.2, 0.8, 1);
        for (const s of [-1, 1]) {
            const ear = mesh(new THREE.ConeGeometry(0.06, 0.2, 5), fur, head, s * 0.08, 0.15, -0.02);
            ear.rotation.z = -s * 0.3;
            mesh(new THREE.ConeGeometry(0.035, 0.14, 5), mat(0xd98ab0), ear, 0, -0.01, 0.025);
            mesh(new THREE.ConeGeometry(0.012, 0.05, 4), mat(0xffffff), head, s * 0.025, -0.08, 0.12).rotation.x = Math.PI; // fangs
            const e = eyeSprite(0xef4444, 0.16);
            e.position.set(s * 0.05, 0.03, 0.12);
            head.add(e);
            mesh(new THREE.SphereGeometry(0.022, 6, 5), glowMat(0xff3b3b), head, s * 0.05, 0.03, 0.115);
        }
        // wings: three finger bones each, with skin stretched between them
        const wings = [];
        for (const s of [-1, 1]) {
            const hinge = new THREE.Group();
            hinge.position.x = s * 0.14;
            body.add(hinge);
            const tips = [[s * 0.75, 0.18, 0.05], [s * 0.7, -0.02, -0.22], [s * 0.42, -0.05, -0.36]];
            const pts = [0, 0.02, 0.1];
            const tri = [];
            let prev = [s * 0.05, 0, 0.12];
            for (const tp of tips) {
                const len = Math.hypot(tp[0], tp[1], tp[2]);
                const b = mesh(new THREE.CylinderGeometry(0.012, 0.008, len, 4), finger, hinge);
                b.position.set(tp[0] / 2, tp[1] / 2, tp[2] / 2);
                b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...tp).normalize());
                tri.push(...pts, ...prev, ...tp);
                prev = tp;
            }
            tri.push(...pts, ...prev, s * 0.05, -0.05, -0.2);
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
            g.computeVertexNormals();
            mesh(g, wingM, hinge);
            wings.push({ hinge, s });
        }
        for (const s of [-1, 1]) mesh(new THREE.ConeGeometry(0.02, 0.08, 4), finger, body, s * 0.06, -0.17, -0.12).rotation.x = Math.PI;
        return {
            body,
            mats: [fur],
            anim(t, dt, m) {
                const f = Math.sin(t * 26 + m.phase);
                wings.forEach(({ hinge, s }) => {
                    hinge.rotation.z = s * f * 0.95;
                    hinge.rotation.y = -s * 0.15 * f;
                });
                body.position.y = Math.sin(t * 5 + m.phase) * 0.2 - f * 0.04;
                head.rotation.x = m.attackT > 0 ? 0.5 : 0;
            },
        };
    },

    wizard(elite) {
        const body = new THREE.Group();
        const robe = mat(elite ? 0x8a6a00 : 0x241338, { roughness: 0.95, side: THREE.DoubleSide });
        const robeDark = mat(elite ? 0x5a4500 : 0x150a24, { roughness: 1, side: THREE.DoubleSide });
        const trim = mat(0xd4a017, { metalness: 0.7, roughness: 0.35, emissive: 0x3a2400, emissiveIntensity: 0.5 });
        const magic = glowMat(0xd8b4fe);
        // a flowing robe (turned profile) with a gold hem
        const prof = [[0.01, 0], [0.62, 0], [0.55, 0.3], [0.42, 0.8], [0.32, 1.25], [0.3, 1.5], [0.2, 1.62], [0.01, 1.66]].map(([x, y]) => new THREE.Vector2(x, y));
        const robeM = mesh(new THREE.LatheGeometry(prof, 18), robe, body, 0, 0.12, 0);
        const hem = mesh(new THREE.TorusGeometry(0.6, 0.035, 6, 30), trim, body, 0, 0.14, 0);
        hem.rotation.x = Math.PI / 2;
        // the front opening: a darker stripe with buttons
        mesh(new THREE.BoxGeometry(0.16, 1.1, 0.02), robeDark, body, 0, 0.75, 0.47).rotation.x = -0.18;
        for (let k = 0; k < 3; k++) mesh(new THREE.SphereGeometry(0.03, 6, 5), trim, body, 0, 1.0 + k * 0.17, 0.42 - k * 0.04);
        // belt with a glowing gem
        const belt = mesh(new THREE.TorusGeometry(0.4, 0.04, 6, 24), trim, body, 0, 1.0, 0);
        belt.rotation.x = Math.PI / 2;
        belt.scale.set(1, 0.85, 1);
        mesh(new THREE.OctahedronGeometry(0.06, 0), magic, body, 0, 1.0, 0.36);
        // a cape over the shoulders
        mesh(new THREE.SphereGeometry(0.42, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), robeDark, body, 0, 1.52, 0).scale.set(1, 0.6, 0.9);
        // hood with a dark face and glowing eyes
        const head = new THREE.Group();
        head.position.set(0, 1.86, 0.02);
        body.add(head);
        const hoodProf = [[0.01, 0.48], [0.1, 0.42], [0.22, 0.25], [0.27, 0.05], [0.25, -0.12], [0.2, -0.18]].map(([x, y]) => new THREE.Vector2(x, y));
        mesh(new THREE.LatheGeometry(hoodProf, 16, 0.35, Math.PI * 2 - 0.7), robe, head).rotation.y = Math.PI / 2 + 0.35;
        mesh(new THREE.SphereGeometry(0.19, 12, 10), glowMat(0x040208), head, 0, 0.02, 0.04);
        for (const s of [-1, 1]) {
            mesh(new THREE.SphereGeometry(0.03, 6, 5), magic, head, s * 0.07, 0.04, 0.2);
            const e = eyeSprite(0xc084fc, 0.22);
            e.position.set(s * 0.07, 0.04, 0.24);
            head.add(e);
            // sleeves with glowing hands
            const arm = new THREE.Group();
            arm.position.set(s * 0.33, 1.45, 0.05);
            arm.rotation.z = s * 0.35;
            arm.userData.s = s;
            body.add(arm);
            mesh(new THREE.CylinderGeometry(0.09, 0.17, 0.62, 10, 1, true), robe, arm, 0, -0.3, 0);
            mesh(new THREE.TorusGeometry(0.16, 0.025, 5, 16), trim, arm, 0, -0.6, 0).rotation.x = Math.PI / 2;
            mesh(new THREE.SphereGeometry(0.07, 8, 6), mat(0xc4b5fd, { emissive: 0x7c3aed, emissiveIntensity: 0.6 }), arm, 0, -0.66, 0);
            body.userData[s < 0 ? 'armL' : 'armR'] = arm;
        }
        // staff: twisted wood, gold claws and a crystal
        const staff = new THREE.Group();
        staff.position.set(0.55, 1.15, 0.22);
        body.add(staff);
        const twist = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([[0, -0.95, 0], [0.03, -0.4, 0.02], [-0.02, 0.2, -0.02], [0.02, 0.75, 0], [0, 0.9, 0]].map((p) => new THREE.Vector3(...p))), 20, 0.03, 6);
        mesh(twist, mat(0x3b2412, { roughness: 0.8 }), staff);
        for (let k = 0; k < 3; k++) {
            const claw = mesh(new THREE.ConeGeometry(0.02, 0.2, 4), trim, staff, Math.cos(k * 2.1) * 0.06, 0.98, Math.sin(k * 2.1) * 0.06);
            claw.rotation.set(Math.sin(k * 2.1) * 0.5, 0, -Math.cos(k * 2.1) * 0.5);
        }
        const orb = mesh(new THREE.OctahedronGeometry(0.11, 0), new THREE.MeshStandardMaterial({ color: 0xe9d5ff, emissive: 0xa855f7, emissiveIntensity: 1.5, flatShading: true }), staff, 0, 1.08, 0);
        orb.castShadow = false;
        const orbGlow = eyeSprite(0xa855f7, 1.0);
        orbGlow.position.y = 1.08;
        staff.add(orbGlow);
        // little runes circling the staff, and a magic circle on the floor
        const sparks = [];
        for (let k = 0; k < 3; k++) {
            const sp = eyeSprite(0xd8b4fe, 0.18);
            staff.add(sp);
            sparks.push(sp);
        }
        const circle = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: runeTexture('192,132,252'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 }));
        circle.position.y = -0.2;
        body.add(circle);
        return {
            body,
            mats: [robe],
            anim(t, dt, m) {
                const tt = t + m.phase;
                body.position.y = 0.25 + Math.sin(tt * 2) * 0.12;
                circle.position.y = -0.22 - Math.sin(tt * 2) * 0.12;
                circle.rotation.y = tt * 0.8;
                staff.rotation.z = Math.sin(tt * 1.5) * 0.1;
                orb.rotation.y = tt * 2;
                const charge = m.aimT > 0 ? 1.8 : 1;
                orbGlow.scale.setScalar(charge + Math.sin(tt * 6) * 0.15);
                sparks.forEach((sp, k) => {
                    const a = tt * 2.5 + k * 2.1;
                    sp.position.set(Math.cos(a) * 0.25, 1.08 + Math.sin(a * 1.3) * 0.1, Math.sin(a) * 0.25);
                });
                robeM.rotation.y = Math.sin(tt * 1.3) * 0.1;
                const raise = m.aimT > 0 ? -1.2 : 0;
                if (body.userData.armL) body.userData.armL.rotation.x = raise + Math.sin(tt * 1.7) * 0.1;
                head.rotation.y = Math.sin(tt * 0.9) * 0.2;
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
                // (textures are shared between monsters: only the materials go)
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
