/**
 * How everyone moves: falling from the sky, gliding, running, jumping,
 * bumping into walls and stepping onto low things. Shared by you and the bots.
 */
import * as THREE from 'three';
import { BODY_RADIUS, BODY_HEIGHT, playAction } from './actors.js';

export const GRAVITY = 24;
export const RUN_SPEED = 7.2;
export const AIM_SPEED = 4.3;
export const HEAL_SPEED = 3.2;
export const JUMP_SPEED = 8.4;
export const SKYDIVE_FALL = 34;
export const SKYDIVE_SIDE = 22;
export const GLIDE_FALL = 6.5;
export const GLIDE_SIDE = 14;
export const GLIDER_OPEN_HEIGHT = 55;

/**
 * input: { x, z } world direction (length 0..1), jump (bool)
 * returns an event: 'glider' | 'landed' | null
 */
export function moveActor(actor, world, input, dt) {
    let event = null;
    const p = actor.pos;
    const v = actor.vel;

    if (actor.phase === 'sky' || actor.phase === 'glide') {
        const ground = world.supportHeight(p.x, p.z, p.y);
        if (actor.phase === 'sky') {
            v.y = -SKYDIVE_FALL;
            v.x = THREE.MathUtils.lerp(v.x, input.x * SKYDIVE_SIDE, Math.min(1, dt * 2));
            v.z = THREE.MathUtils.lerp(v.z, input.z * SKYDIVE_SIDE, Math.min(1, dt * 2));
            if (p.y - ground < GLIDER_OPEN_HEIGHT || input.openGlider) {
                actor.phase = 'glide';
                actor.glider.visible = true;
                event = 'glider';
            }
        } else {
            v.y = THREE.MathUtils.lerp(v.y, -GLIDE_FALL, Math.min(1, dt * 3));
            v.x = THREE.MathUtils.lerp(v.x, input.x * GLIDE_SIDE, Math.min(1, dt * 1.5));
            v.z = THREE.MathUtils.lerp(v.z, input.z * GLIDE_SIDE, Math.min(1, dt * 1.5));
        }
        p.addScaledVector(v, dt);
        world.pushOut(p, BODY_RADIUS, BODY_HEIGHT);
        const g2 = world.supportHeight(p.x, p.z, p.y + 0.5);
        if (p.y <= g2) {
            p.y = g2;
            v.set(0, 0, 0);
            actor.phase = 'ground';
            actor.onGround = true;
            actor.glider.visible = false;
            actor.root.rotation.x = 0;
            playAction(actor, 'idle', 0.1);
            event = 'landed';
        }
        // lean into the direction you steer
        const sideSpeed = Math.hypot(v.x, v.z);
        if (actor.phase === 'sky') playAction(actor, 'jump', 0.2);
        actor.model.rotation.x = actor.phase === 'sky' ? 0.9 : Math.min(0.35, sideSpeed * 0.02);
        if (actor.phase === 'ground') actor.model.rotation.x = 0;
        return event;
    }

    // ---- on foot
    let speed = actor.aiming ? AIM_SPEED : RUN_SPEED;
    if (actor.using) speed = HEAL_SPEED;
    const groundNow = world.terrainHeight(p.x, p.z);
    if (p.y < 0.25 && groundNow < 0.25) speed *= 0.6; // wading through water

    const accel = actor.onGround ? 14 : 4;
    v.x = THREE.MathUtils.lerp(v.x, input.x * speed, Math.min(1, dt * accel));
    v.z = THREE.MathUtils.lerp(v.z, input.z * speed, Math.min(1, dt * accel));

    if (input.jump && actor.onGround) {
        v.y = JUMP_SPEED;
        actor.onGround = false;
        playAction(actor, 'jump', 0.05);
        event = 'jump';
    }
    v.y -= GRAVITY * dt;

    const prevY = p.y;
    p.x += v.x * dt;
    p.z += v.z * dt;
    p.y += v.y * dt;
    world.pushOut(p, BODY_RADIUS, BODY_HEIGHT);

    const support = world.supportHeight(p.x, p.z, Math.max(prevY, p.y));
    if (p.y <= support) {
        if (!actor.onGround && prevY - support > 0.8) event = 'landed';
        p.y = support;
        v.y = 0;
        actor.onGround = true;
    } else if (actor.onGround && v.y <= 0 && p.y - support < 0.6) {
        // walking down a slope or off a low step
        p.y = support;
        v.y = 0;
    } else {
        actor.onGround = false;
    }

    actor.moving = Math.hypot(v.x, v.z) > 0.6;
    if (actor.onGround) {
        if (actor.moving) {
            playAction(actor, 'walk', 0.12);
            actor.currentAction.timeScale = Math.hypot(v.x, v.z) / 3.2;
        } else {
            playAction(actor, 'idle', 0.15);
        }
    }
    return event;
}
