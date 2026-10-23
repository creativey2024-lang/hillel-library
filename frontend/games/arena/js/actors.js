/**
 * Everyone on the island - you and the bots - is an "actor": the same
 * character model, health and shield, five inventory slots (guns and
 * healing items), ammo, a glider for the drop, and both hands on the gun.
 */
import * as THREE from 'three';
import { weaponMesh, WEAPONS } from './weapons.js';
import { healMesh, isHeal } from './heals.js';

export const CHARACTER_SCALE = 1.6;
export const BODY_RADIUS = 0.45;
export const BODY_HEIGHT = 1.75;
export const EYE_HEIGHT = 1.45;

let nextId = 1;

function makeGlider(color) {
    const g = new THREE.Group();
    const sail = new THREE.BufferGeometry();
    // a hang-glider wing: two triangles meeting at the nose
    sail.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.2, 1.6, -2.4, 0, -0.9, 0, 0.35, -0.6,
        0, 0.2, 1.6, 0, 0.35, -0.6, 2.4, 0, -0.9,
    ], 3));
    sail.computeVertexNormals();
    const sailMesh = new THREE.Mesh(sail, new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.6 }));
    sailMesh.castShadow = true;
    g.add(sailMesh);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 2.3), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    stripe.position.set(0, 0.3, 0.45);
    g.add(stripe);
    const barMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
    [-0.5, 0.5].forEach((x) => {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 6), barMat);
        bar.position.set(x * 0.9, -0.8, 0.1);
        bar.rotation.z = x * 0.5;
        g.add(bar);
    });
    g.position.y = 2.7;
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

export function createActor({ scene, gltf, tint, gliderColor, name, isPlayer }) {
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
    model.traverse((c) => {
        if (c.name === 'arm-right') armRight = c;
        if (c.name === 'arm-left') armLeft = c;
        if (c.name === 'torso') torso = c;
    });
    // what's in your hands hangs off the chest; the arms reach for it every frame
    const hand = new THREE.Group();
    (torso || model).add(hand);
    const rest = {
        rightPos: armRight ? armRight.position.clone() : null,
        rightQuat: armRight ? armRight.quaternion.clone() : null,
        leftPos: armLeft ? armLeft.position.clone() : null,
        leftQuat: armLeft ? armLeft.quaternion.clone() : null,
    };

    const glider = makeGlider(gliderColor || 0xf97316);
    root.add(glider);
    const healthBar = isPlayer ? null : makeHealthBar();
    if (healthBar) root.add(healthBar);

    const actor = {
        id: nextId++,
        name,
        isPlayer: Boolean(isPlayer),
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
        rest,
        posed: false,
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

    if (!armLeft) return;
    // left arm: reach for the front grip (or hold the item with both hands)
    const along = healing ? 0.02 : (FOREGRIP[it.kind] || 0.4) * HELD_SCALE;
    grip.copy(hand.position).addScaledVector(aimDir, along);
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

/** Per-frame look: position, facing, animation, hands on the gun. */
export function updateActorVisual(actor, dt, camera, time = 0) {
    actor.root.position.copy(actor.pos);
    actor.root.rotation.y = actor.yaw;
    actor.mixer.update(dt);
    const it = currentItem(actor);
    if (actor.alive && actor.armRight && it && actor.phase === 'ground') {
        poseHolding(actor, it, time);
        actor.posed = true;
    } else if (actor.posed) {
        restoreArms(actor);
        actor.posed = false;
    }
    if (actor.phase !== 'ground' && actor.armRight) {
        // hands up on the glider bar
        actor.armRight.rotation.set(0, 0, -1.2);
        if (actor.armLeft) actor.armLeft.rotation.set(0, 0, 1.2);
        actor.posed = true; // put the arms back down after landing
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
