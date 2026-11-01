/**
 * Everyone on the island - you and the bots - is an "actor": the same
 * character model, health and shield, five inventory slots (guns and
 * healing items), ammo, a glider for the drop, and both hands on the gun.
 */
import * as THREE from 'three';
import { weaponMesh, WEAPONS, reloadTime } from './weapons.js';
import { healMesh, isHeal } from './heals.js';
import { addGear } from '../../shared/gear.js';

export const CHARACTER_SCALE = 1.6;
export const BODY_RADIUS = 0.45;
export const BODY_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.45;

let nextId = 1;

// the sail's painted pattern: the glider colour with white chevrons, a dark
// trailing edge and a round badge (one texture per colour)
const sailTextures = new Map();
function sailTexture(color) {
    if (sailTextures.has(color)) return sailTextures.get(color);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    const col = new THREE.Color(color);
    const css = (k) => `rgb(${Math.round(Math.min(255, col.r * 255 * k))},${Math.round(Math.min(255, col.g * 255 * k))},${Math.round(Math.min(255, col.b * 255 * k))})`;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, css(1.15));
    g.addColorStop(1, css(0.8));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    // chevrons pointing to the nose (u = across the wing, v = front to back)
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    for (const v0 of [70, 120]) {
        ctx.beginPath();
        ctx.moveTo(0, v0 + 40);
        ctx.lineTo(128, v0);
        ctx.lineTo(256, v0 + 40);
        ctx.lineTo(256, v0 + 56);
        ctx.lineTo(128, v0 + 16);
        ctx.lineTo(0, v0 + 56);
        ctx.closePath();
        ctx.fill();
    }
    ctx.fillStyle = css(0.45);
    ctx.fillRect(0, 226, 256, 30);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = 8; x < 256; x += 24) ctx.fillRect(x, 0, 2, 256); // seams
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(128, 196, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(0.7);
    ctx.beginPath();
    ctx.moveTo(128, 184);
    ctx.lineTo(139, 204);
    ctx.lineTo(117, 204);
    ctx.closePath();
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    sailTextures.set(color, t);
    return t;
}

const tubeMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.3 });
const darkTubeMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.5, roughness: 0.4 });
const cableMat = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.7 });
function tube(a, b, r, mat) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, dir.length(), 8), mat);
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    m.castShadow = true;
    return m;
}

function makeGlider(color) {
    const g = new THREE.Group();
    // the sail: a delta wing that billows a little between its tubes
    const nose = new THREE.Vector3(0, 0.28, 1.65);
    const tip = (s) => new THREE.Vector3(s * 2.5, 0.06, -0.85);
    const root = new THREE.Vector3(0, 0.36, -0.7);
    const SU = 16;
    const SV = 6;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= SU; i++) {
        const u = (i / SU) * 2 - 1;
        const s = Math.sign(u) || 1;
        const k = Math.abs(u);
        const le = nose.clone().lerp(tip(s), k);
        const te = root.clone().lerp(tip(s), k);
        for (let j = 0; j <= SV; j++) {
            const v = j / SV;
            const p = le.clone().lerp(te, v);
            p.y -= Math.sin(Math.PI * v) * 0.16 * (1 - k * 0.7) + Math.sin(Math.PI * k) * 0.05;
            pos.push(p.x, p.y, p.z);
            uv.push(i / SU, 1 - v);
        }
    }
    for (let i = 0; i < SU; i++) {
        for (let j = 0; j < SV; j++) {
            const a = i * (SV + 1) + j;
            const b = a + SV + 1;
            idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sail.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sail.setIndex(idx);
    sail.computeVertexNormals();
    const sailMesh = new THREE.Mesh(sail, new THREE.MeshStandardMaterial({ map: sailTexture(color), side: THREE.DoubleSide, roughness: 0.65 }));
    sailMesh.castShadow = true;
    g.add(sailMesh);
    // tubes: leading edges, keel, crossbar
    g.add(tube(nose, tip(-1), 0.035, tubeMat), tube(nose, tip(1), 0.035, tubeMat));
    const keelFront = new THREE.Vector3(0, 0.3, 1.6);
    const keelBack = new THREE.Vector3(0, 0.34, -1.0);
    g.add(tube(keelFront, keelBack, 0.03, darkTubeMat));
    g.add(tube(nose.clone().lerp(tip(-1), 0.45).add(new THREE.Vector3(0, -0.02, 0)), nose.clone().lerp(tip(1), 0.45).add(new THREE.Vector3(0, -0.02, 0)), 0.025, darkTubeMat));
    // a little tail fin
    const fin = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.34, -0.55), new THREE.Vector3(0, 0.75, -1.05), new THREE.Vector3(0, 0.34, -1.0)]), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }));
    fin.geometry.computeVertexNormals();
    g.add(fin);
    // the A-frame and control bar you hold
    const top = new THREE.Vector3(0, 0.3, 0.25);
    const barL = new THREE.Vector3(-0.6, -1.05, 0.55);
    const barR = new THREE.Vector3(0.6, -1.05, 0.55);
    g.add(tube(top, barL, 0.025, tubeMat), tube(top, barR, 0.025, tubeMat), tube(barL, barR, 0.03, darkTubeMat));
    for (const b of [barL, barR]) {
        const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.9 }));
        grip.rotation.z = Math.PI / 2;
        grip.position.copy(b).lerp(new THREE.Vector3(0, b.y, b.z), 0.25);
        g.add(grip);
    }
    // the cables (wires from the control bar to the tips, nose and tail) and the hang strap
    const pts = [barL, tip(-1), barR, tip(1), barL, keelFront, barR, keelFront, barL, keelBack, barR, keelBack, new THREE.Vector3(0, 0.3, 0.05), new THREE.Vector3(0, -0.55, 0.0)];
    g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
    g.position.y = 2.35;
    g.visible = false;
    return g;
}

function makeHealthBar() {
    const g = new THREE.Group();
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.13), new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.7, depthTest: false }));
    const shield = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.05), new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false }));
    const hp = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.05), new THREE.MeshBasicMaterial({ color: 0x4ade80, depthTest: false }));
    shield.position.y = 0.03;
    hp.position.y = -0.03;
    [bg, shield, hp].forEach((m) => {
        m.renderOrder = 20;
        g.add(m);
    });
    g.position.y = 2.25;
    g.visible = false;
    g.userData = { shield, hp };
    return g;
}

// isPlayer: you (on this computer); human: you or a teammate (vs. a bot)
export function createActor({ scene, gltf, tint, gliderColor, name, isPlayer, human = isPlayer, team = null, gearSeed = null }) {
    const root = new THREE.Group();
    const model = gltf.scene.clone(true);
    model.scale.setScalar(CHARACTER_SCALE);
    model.traverse((c) => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            if (tint) {
                c.material = c.material.clone();
                c.material.color.multiply(new THREE.Color(tint));
            }
        }
    });
    // a backpack, belt, hat... (bots get a lighter version)
    addGear(model, { seed: gearSeed ?? name, lite: !human });
    root.add(model);
    scene.add(root);

    const mixer = new THREE.AnimationMixer(model);
    const actions = {};
    gltf.animations.forEach((clip) => { actions[clip.name] = mixer.clipAction(clip); });
    if (actions.jump) {
        actions.jump.setLoop(THREE.LoopOnce, 1);
        actions.jump.clampWhenFinished = true;
    }

    let armRight = null;
    let armLeft = null;
    let torso = null;
    let legLeft = null;
    let legRight = null;
    model.traverse((c) => {
        if (c.name === 'arm-right') armRight = c;
        if (c.name === 'arm-left') armLeft = c;
        if (c.name === 'torso') torso = c;
        if (c.name === 'leg-left') legLeft = c;
        if (c.name === 'leg-right') legRight = c;
    });
    // what's in your hands hangs off the chest; the arms reach for it every frame
    const hand = new THREE.Group();
    (torso || model).add(hand);
    const rest = {
        rightPos: armRight ? armRight.position.clone() : null,
        rightQuat: armRight ? armRight.quaternion.clone() : null,
        leftPos: armLeft ? armLeft.position.clone() : null,
        leftQuat: armLeft ? armLeft.quaternion.clone() : null,
        legL: legLeft ? legLeft.quaternion.clone() : null,
        legR: legRight ? legRight.quaternion.clone() : null,
    };

    const glider = makeGlider(gliderColor || 0xf97316);
    root.add(glider);
    const healthBar = isPlayer ? null : makeHealthBar(human);
    if (healthBar) root.add(healthBar);

    const actor = {
        id: nextId++,
        name,
        isPlayer: Boolean(isPlayer),
        human: Boolean(human),
        team,
        alive: true,
        hp: 100,
        shield: 0,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        yaw: 0,
        pitch: 0,
        onGround: false,
        phase: 'sky', // sky -> glide -> ground
        slots: [null, null, null, null, null],
        current: 0,
        ammo: { light: 0, medium: 0, shells: 0, heavy: 0 },
        kills: 0,
        coins: 0,
        reloadT: 0,
        cooldown: 0,
        using: null,       // { heal, slot, t, total }
        moving: false,
        aiming: false,
        healthBarT: 0,
        lastHitBy: null,
        root,
        model,
        mixer,
        actions,
        armRight,
        armLeft,
        legLeft,
        legRight,
        rest,
        posed: false,
        airPosed: false,
        // little animation springs: squash & stretch, gun kick, weapon switch, flinch, walk cycle
        fx: { squash: 0, squashV: 0, recoil: 0, switchT: 0, flinch: 0, walk: 0, roll: 0, gliderT: 0 },
        justLanded: null,  // 'soft' | 'hard' for one frame after touching down
        justJumped: false,
        hand,
        glider,
        healthBar,
        weaponObj: null,
        weaponKey: '',
        currentAction: null,
    };
    playAction(actor, 'idle');
    return actor;
}

export function playAction(actor, name, fade = 0.15) {
    const next = actor.actions[name];
    if (!next || next === actor.currentAction) return;
    next.reset().fadeIn(fade).play();
    if (actor.currentAction) actor.currentAction.fadeOut(fade);
    actor.currentAction = next;
}

/** The gun in hand (null when holding heals or nothing). */
export function currentWeapon(actor) {
    const it = actor.slots[actor.current];
    return it && !isHeal(it) ? it : null;
}

/** Whatever is in the selected slot: a gun, a stack of heals, or null. */
export function currentItem(actor) {
    return actor.slots[actor.current];
}

// where the left hand grabs each gun (along the gun, in its own space)
const FOREGRIP = { pistol: 0.06, smg: 0.32, ar: 0.5, shotgun: 0.6, sniper: 0.62, dmr: 0.5, heavy: 0.7 };
const HELD_SCALE = 1 / CHARACTER_SCALE * 1.15; // guns keep their real size in the scaled-up character

/** Show the gun (or healing item) of the selected slot in the actor's hands. */
export function refreshWeaponVisual(actor) {
    const it = currentItem(actor);
    const key = !it ? '' : isHeal(it) ? `heal:${it.heal}` : `${it.kind}:${it.rarity}`;
    if (key === actor.weaponKey) return;
    actor.weaponKey = key;
    if (key) actor.fx.switchT = 1; // the new item comes up into the hands
    if (actor.weaponObj) actor.hand.remove(actor.weaponObj);
    actor.weaponObj = null;
    if (!it) return;
    actor.weaponObj = isHeal(it) ? healMesh(it.heal) : weaponMesh(it.kind, it.rarity);
    actor.weaponObj.scale.setScalar(isHeal(it) ? HELD_SCALE * 0.9 : HELD_SCALE);
    if (isHeal(it)) actor.weaponObj.position.set(0, 0.06, 0.08);
    actor.hand.add(actor.weaponObj);
}

const X_POS = new THREE.Vector3(1, 0, 0);
const X_NEG = new THREE.Vector3(-1, 0, 0);
const Z_POS = new THREE.Vector3(0, 0, 1);
const aimDir = new THREE.Vector3();
const armDir = new THREE.Vector3();
const grip = new THREE.Vector3();
const gunFwd = new THREE.Vector3();
const shoulder = new THREE.Vector3();
const ARM_REACH = 0.28; // the robot's arm, from the shoulder to the hand (model units)

/**
 * Two hands on the gun: the right arm points forward along the right side
 * of the chest with the gun in that hand, the left arm reaches across for
 * the front grip.
 * Everything is in the torso's own space (the model faces +z).
 */
function poseHolding(actor, it, time) {
    const { armRight, armLeft, hand } = actor;
    let p = Math.max(-1.1, Math.min(1.1, actor.pitch));
    const healing = isHeal(it);
    if (healing) p = actor.using ? 0.75 + Math.sin(time * 9) * 0.08 : -0.25;
    aimDir.set(0, Math.sin(p), Math.cos(p));

    // right arm: straight ahead along the right side of the chest, so the gun
    // is beside the body (where the over-the-shoulder camera can see it)
    shoulder.set(-0.36, 0.16, 0.1);
    armDir.copy(aimDir).addScaledVector(X_POS, 0.04).normalize();
    armRight.position.copy(shoulder);
    armRight.quaternion.setFromUnitVectors(X_NEG, armDir);
    // the gun's grip sits in the right hand, pointing where you aim
    hand.position.copy(shoulder).addScaledVector(armDir, ARM_REACH);
    hand.quaternion.setFromUnitVectors(Z_POS, aimDir);
    const fx = actor.fx;
    // a little sway while walking
    if (actor.moving && actor.onGround) {
        hand.position.y += Math.sin(fx.walk * 2) * 0.012;
        hand.position.x += Math.cos(fx.walk) * 0.01;
    }
    // shooting kicks the gun back and up
    if (fx.recoil > 0) {
        hand.position.addScaledVector(aimDir, -0.1 * fx.recoil);
        hand.rotateX(-0.4 * fx.recoil);
    }
    // reloading: tip the gun over and back
    if (actor.reloadT > 0 && !healing) {
        const total = reloadTime(it);
        const k = Math.sin(Math.min(1, 1 - actor.reloadT / total) * Math.PI);
        hand.rotateZ(0.75 * k);
        hand.rotateX(0.45 * k);
        hand.position.y -= 0.06 * k;
    }
    // a newly picked item comes up from below
    if (fx.switchT > 0) {
        hand.position.y -= 0.25 * fx.switchT;
        hand.rotateX(1.0 * fx.switchT);
    }

    if (!armLeft) return;
    // left arm: reach for the front grip (or hold the item with both hands)
    const along = healing ? 0.02 : (FOREGRIP[it.kind] || 0.4) * HELD_SCALE;
    gunFwd.set(0, 0, 1).applyQuaternion(hand.quaternion);
    grip.copy(hand.position).addScaledVector(gunFwd, along);
    grip.x += healing ? 0.12 : 0.03;
    grip.y -= healing ? 0 : 0.03;
    // left arm: from the front of the chest, across to the gun
    shoulder.set(0.1, 0.17, 0.3);
    armDir.subVectors(grip, shoulder);
    const len = armDir.length();
    armDir.divideScalar(len || 1);
    // the arm is short: if the grip is too far, the shoulder slides forward
    if (len > ARM_REACH) shoulder.addScaledVector(armDir, len - ARM_REACH);
    armLeft.position.copy(shoulder);
    armLeft.quaternion.setFromUnitVectors(X_POS, armDir);
}

function restoreArms(actor) {
    const { armRight, armLeft, rest } = actor;
    if (armRight) {
        armRight.position.copy(rest.rightPos);
        armRight.quaternion.copy(rest.rightQuat);
    }
    if (armLeft) {
        armLeft.position.copy(rest.leftPos);
        armLeft.quaternion.copy(rest.leftQuat);
    }
}

const RIGHT = new THREE.Vector3();

/** Springs and body lean: squash & stretch, flinch, lean while running, roll while flying. */
function animateBody(actor, dt, time) {
    const fx = actor.fx;
    // landing squash / jump stretch: a damped spring
    if (actor.justLanded) {
        fx.squashV -= actor.justLanded === 'hard' ? 5.5 : 2.6;
        actor.justLanded = null;
    }
    if (actor.justJumped) {
        fx.squashV += 2.4;
        actor.justJumped = false;
    }
    fx.squashV += (-70 * fx.squash - 10 * fx.squashV) * dt;
    fx.squash = Math.max(-0.3, Math.min(0.3, fx.squash + fx.squashV * dt));
    const sq = fx.squash;
    actor.model.scale.set(CHARACTER_SCALE * (1 - sq * 0.5), CHARACTER_SCALE * (1 + sq), CHARACTER_SCALE * (1 - sq * 0.5));
    fx.recoil = Math.max(0, fx.recoil - dt * 9);
    fx.switchT = Math.max(0, fx.switchT - dt * 4.5);
    fx.flinch = Math.max(0, fx.flinch - dt * 5);
    const speed = Math.hypot(actor.vel.x, actor.vel.z);
    fx.walk += dt * speed * 1.9;
    // sideways speed (for leaning into turns while flying)
    RIGHT.set(-Math.cos(actor.yaw), 0, Math.sin(actor.yaw));
    const lateral = actor.vel.x * RIGHT.x + actor.vel.z * RIGHT.z;
    let pitch = 0;
    let roll = 0;
    if (actor.phase === 'sky') {
        // belly down, arms and legs spread, wobbling in the wind
        pitch = 1.15 + Math.sin(time * 5.3 + actor.id) * 0.05;
        roll = -lateral * 0.035 + Math.sin(time * 6.1 + actor.id) * 0.07;
    } else if (actor.phase === 'glide') {
        pitch = 0.18 + Math.min(0.25, speed * 0.012);
        roll = -lateral * 0.045 + Math.sin(time * 1.7 + actor.id) * 0.04;
    } else {
        // lean a little into running, rock back when hit
        pitch = Math.min(0.12, speed * 0.015) - fx.flinch * 0.32;
        roll = Math.sin(fx.flinch * 9) * fx.flinch * 0.12;
    }
    fx.roll += (roll - fx.roll) * Math.min(1, dt * 5);
    const k = Math.min(1, dt * (actor.phase === 'ground' ? 12 : 4));
    actor.model.rotation.x += (pitch - actor.model.rotation.x) * k;
    actor.model.rotation.z = fx.roll;
    // the glider pops open and banks with you
    if (actor.glider.visible) {
        fx.gliderT = Math.min(1, fx.gliderT + dt * 3.5);
        const t = fx.gliderT;
        const pop = 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2; // ease out with a little overshoot
        actor.glider.scale.setScalar(Math.max(0.01, pop));
        actor.glider.rotation.z = fx.roll * 0.9;
        actor.glider.rotation.x = -actor.model.rotation.x * 0.5;
    } else {
        fx.gliderT = 0;
    }
}

/** Arms and legs in the air: spread out in free fall, hanging from the bar on the glider. */
function airPose(actor, time) {
    const { armRight, armLeft, legLeft, legRight, id } = actor;
    armRight.position.copy(actor.rest.rightPos);
    if (armLeft) armLeft.position.copy(actor.rest.leftPos);
    if (actor.phase === 'sky') {
        const flap = Math.sin(time * 17 + id) * 0.12;
        armRight.rotation.set(flap, 0, -0.25 + flap);
        if (armLeft) armLeft.rotation.set(-flap, 0, 0.25 - flap);
        if (legLeft) legLeft.rotation.set(0.25 + Math.sin(time * 13 + id) * 0.15, 0, 0.45);
        if (legRight) legRight.rotation.set(0.25 + Math.sin(time * 13 + id + 1.5) * 0.15, 0, -0.45);
    } else {
        armRight.rotation.set(0, 0, -1.2);
        if (armLeft) armLeft.rotation.set(0, 0, 1.2);
        // legs dangle and swing
        if (legLeft) legLeft.rotation.set(Math.sin(time * 2.6 + id) * 0.3, 0, 0.08);
        if (legRight) legRight.rotation.set(Math.sin(time * 2.6 + id + Math.PI) * 0.3, 0, -0.08);
    }
    actor.airPosed = true;
}

/** Per-frame look: position, facing, animation, hands on the gun. */
export function updateActorVisual(actor, dt, camera, time = 0) {
    actor.root.position.copy(actor.pos);
    actor.root.rotation.y = actor.yaw;
    actor.mixer.update(dt);
    animateBody(actor, dt, time);
    const it = currentItem(actor);
    if (actor.alive && actor.armRight && it && actor.phase === 'ground') {
        poseHolding(actor, it, time);
        actor.posed = true;
    } else if (actor.posed) {
        restoreArms(actor);
        actor.posed = false;
    }
    if (actor.phase !== 'ground' && actor.armRight) {
        airPose(actor, time);
        actor.posed = true; // put the arms back down after landing
    } else if (actor.airPosed) {
        if (actor.legLeft) actor.legLeft.quaternion.copy(actor.rest.legL);
        if (actor.legRight) actor.legRight.quaternion.copy(actor.rest.legR);
        actor.airPosed = false;
    }
    if (actor.weaponObj) actor.weaponObj.visible = actor.phase === 'ground' && actor.alive;
    if (actor.healthBar) {
        actor.healthBarT -= dt;
        const show = actor.alive && actor.healthBarT > 0;
        actor.healthBar.visible = show;
        if (show && camera) {
            actor.healthBar.quaternion.copy(camera.quaternion);
            // the bar is a child of the rotated root: cancel the root's turn
            actor.healthBar.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -actor.yaw));
            const { shield, hp } = actor.healthBar.userData;
            hp.scale.x = Math.max(0.001, actor.hp / 100);
            hp.position.x = -(1 - hp.scale.x) / 2;
            shield.scale.x = Math.max(0.001, actor.shield / 100);
            shield.position.x = -(1 - shield.scale.x) / 2;
        }
    }
}

/** Damage goes to the shield first, then to health. Returns true if this killed them. */
export function applyDamage(actor, amount) {
    if (!actor.alive) return false;
    const toShield = Math.min(actor.shield, amount);
    actor.shield -= toShield;
    actor.hp -= amount - toShield;
    actor.healthBarT = 3;
    if (actor.hp <= 0) {
        actor.hp = 0;
        actor.alive = false;
        return true;
    }
    return false;
}

/**
 * Does a ray hit this actor? Body = upright cylinder, head = sphere (headshot).
 * Returns { dist, head } or null.
 */
export function rayHitsActor(actor, o, d, maxDist) {
    if (!actor.alive) return null;
    let best = null;
    // head
    const hx = actor.pos.x;
    const hy = actor.pos.y + 1.52;
    const hz = actor.pos.z;
    const hr = 0.33;
    const ox = o.x - hx;
    const oy = o.y - hy;
    const oz = o.z - hz;
    const b = ox * d.x + oy * d.y + oz * d.z;
    const c = ox * ox + oy * oy + oz * oz - hr * hr;
    const disc = b * b - c;
    if (disc >= 0) {
        const t = -b - Math.sqrt(disc);
        if (t > 0 && t < maxDist) best = { dist: t, head: true };
    }
    // body
    const r = BODY_RADIUS;
    const px = o.x - actor.pos.x;
    const pz = o.z - actor.pos.z;
    const a = d.x * d.x + d.z * d.z;
    if (a > 1e-9) {
        const bb = 2 * (px * d.x + pz * d.z);
        const cc = px * px + pz * pz - r * r;
        const dd = bb * bb - 4 * a * cc;
        if (dd >= 0) {
            const t = (-bb - Math.sqrt(dd)) / (2 * a);
            const y = o.y + d.y * t;
            if (t > 0 && t < maxDist && y > actor.pos.y && y < actor.pos.y + 1.32 && (!best || t < best.dist)) best = { dist: t, head: false };
        }
    }
    return best;
}
