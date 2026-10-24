/**
 * Shooting, shared by you and the bots: ammo, fire rate, spread, shotgun
 * pellets, headshots, damage falloff, reloading - plus the visual effects
 * (tracers, muzzle flashes, impact puffs).
 */
import * as THREE from 'three';
import { WEAPONS, weaponDamage, muzzleOffset } from './weapons.js';
import { currentWeapon, applyDamage, rayHitsActor, EYE_HEIGHT } from './actors.js';

// bots are a bit softer on you than on each other, so a good player can win
export const BOT_DAMAGE_TO_PLAYER = 0.72;
// bot-vs-bot fights last longer, so the match isn't over before you get there
export const BOT_DAMAGE_TO_BOT = 0.33;

let glowTex = null;
function glowTexture() {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,230,1)');
    g.addColorStop(0.3, 'rgba(255,200,80,0.8)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
}

export function createEffects(scene) {
    const list = [];
    const tracerMat = new THREE.LineBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.9 });

    function tracer(from, to) {
        const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
        const line = new THREE.Line(geo, tracerMat.clone());
        scene.add(line);
        list.push({ obj: line, t: 0, max: 0.07, kind: 'tracer' });
    }

    function flash(pos, size = 0.7) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        sp.position.copy(pos);
        sp.scale.setScalar(size);
        scene.add(sp);
        list.push({ obj: sp, t: 0, max: 0.06, kind: 'flash' });
    }

    function impact(pos, color = 0xd6d3d1) {
        for (let i = 0; i < 3; i++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false, opacity: 0.8 }));
            sp.position.copy(pos);
            sp.scale.setScalar(0.18);
            scene.add(sp);
            list.push({ obj: sp, t: 0, max: 0.35, kind: 'puff', vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3) });
        }
    }

    // soft round puff texture for dust and smoke
    const puffTex = (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 64;
        const ctx = c.getContext('2d');
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.55, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        return new THREE.CanvasTexture(c);
    })();

    function puff(pos, vel, color, size, life, grow = 2, gravity = 0) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, depthWrite: false, opacity: 0.85 }));
        sp.position.copy(pos);
        sp.scale.setScalar(size);
        scene.add(sp);
        list.push({ obj: sp, t: 0, max: life, kind: 'dust', vel, size, grow, gravity });
    }

    /** A ring of dust where someone lands. */
    function dust(pos, big = true) {
        const n = big ? 12 : 6;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
            const sp = (big ? 3.2 : 1.8) * (0.7 + Math.random() * 0.6);
            const p = pos.clone();
            p.y += 0.15;
            puff(p, new THREE.Vector3(Math.cos(a) * sp, 0.4 + Math.random() * 0.6, Math.sin(a) * sp), 0xd9c9a8, big ? 0.7 : 0.45, 0.7 + Math.random() * 0.3, big ? 2.4 : 1.6);
        }
    }

    /** A colourful pop when someone is eliminated. */
    function burst(pos, color = 0xc4b5fd) {
        for (let i = 0; i < 16; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = new THREE.Vector3(Math.cos(a) * (1 + Math.random() * 2.5), 2 + Math.random() * 3, Math.sin(a) * (1 + Math.random() * 2.5));
            puff(pos.clone().add(new THREE.Vector3(0, 0.8 + Math.random() * 0.8, 0)), v, i % 3 ? color : 0xffffff, 0.5, 0.9 + Math.random() * 0.4, 1.8, 3);
        }
    }

    /** Little golden sparkles (picking up coins). */
    function sparkle(pos) {
        for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2;
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffe08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
            sp.position.copy(pos);
            sp.scale.setScalar(0.35);
            scene.add(sp);
            list.push({ obj: sp, t: 0, max: 0.45, kind: 'dust', vel: new THREE.Vector3(Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2), size: 0.35, grow: -0.6, gravity: 4 });
        }
    }

    function update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            e.t += dt;
            const k = e.t / e.max;
            if (k >= 1) {
                scene.remove(e.obj);
                e.obj.material.dispose();
                if (e.obj.geometry && e.kind === 'tracer') e.obj.geometry.dispose();
                list.splice(i, 1);
                continue;
            }
            if (e.kind === 'dust') {
                e.vel.y -= e.gravity * dt;
                e.vel.multiplyScalar(1 - Math.min(1, dt * 2.5));
                e.obj.position.addScaledVector(e.vel, dt);
                e.obj.material.opacity = 0.85 * (1 - k) * (1 - k * 0.3);
                e.obj.scale.setScalar(Math.max(0.02, e.size * (1 + k * e.grow)));
            } else if (e.kind === 'puff') {
                e.vel.y -= 9 * dt;
                e.obj.position.addScaledVector(e.vel, dt);
                e.obj.material.opacity = 0.8 * (1 - k);
                e.obj.scale.setScalar(0.18 + k * 0.25);
            } else {
                e.obj.material.opacity = 1 - k;
            }
        }
    }

    return { tracer, flash, impact, dust, burst, sparkle, update };
}

const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

/** World position of the gun's muzzle (falls back to eye height). */
export function muzzlePosition(actor, out) {
    const w = currentWeapon(actor);
    if (actor.weaponObj && w) {
        actor.weaponObj.updateWorldMatrix(true, false);
        out.set(0, 0.12, muzzleOffset(w.kind)).applyMatrix4(actor.weaponObj.matrixWorld);
        return out;
    }
    return out.copy(actor.pos).add(tmpV.set(0, EYE_HEIGHT, 0));
}

function randomCone(dir, angle, out) {
    // a random direction within `angle` radians of dir
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(1 - v * (1 - Math.cos(angle)));
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.sin(phi) * Math.sin(theta);
    const z = Math.cos(phi);
    tmpQ.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
    return out.set(x, y, z).applyQuaternion(tmpQ);
}

export function startReload(actor) {
    const w = currentWeapon(actor);
    if (!w || actor.reloadT > 0) return false;
    const def = WEAPONS[w.kind];
    if (w.ammoInMag >= def.mag || actor.ammo[def.ammo] <= 0) return false;
    actor.reloadT = def.reload;
    actor.using = null;
    return true;
}

/** Called every frame for every actor: reload timer and fire cooldown. */
export function tickWeapon(actor, dt) {
    actor.cooldown = Math.max(0, actor.cooldown - dt);
    if (actor.reloadT > 0) {
        actor.reloadT -= dt;
        if (actor.reloadT <= 0) {
            actor.reloadT = 0;
            const w = currentWeapon(actor);
            if (w) {
                const def = WEAPONS[w.kind];
                const need = def.mag - w.ammoInMag;
                const take = Math.min(need, actor.ammo[def.ammo]);
                w.ammoInMag += take;
                actor.ammo[def.ammo] -= take;
            }
        }
    }
}

/**
 * Fire the actor's gun from `origin` toward `dir` (unit vector).
 * ctx: { world, actors, effects, audio, listener, onHit(shooter, target, dmg, head, killed, point, shieldHit) }
 * Returns true if a shot was fired.
 */
export function fire(actor, origin, dir, ctx) {
    const w = currentWeapon(actor);
    if (!w || actor.cooldown > 0 || actor.reloadT > 0 || actor.using) return false;
    const def = WEAPONS[w.kind];
    if (w.ammoInMag <= 0) {
        startReload(actor);
        return false;
    }
    w.ammoInMag -= 1;
    actor.cooldown = 1 / def.rate;
    if (actor.fx) actor.fx.recoil = Math.min(1, 0.55 + def.recoil * 9);

    let spread = actor.aiming ? def.adsSpread : def.spread;
    if (actor.moving) spread *= 1.4;
    if (!actor.onGround) spread *= 1.8;

    const muzzle = muzzlePosition(actor, new THREE.Vector3());
    ctx.effects.flash(muzzle, def.pellets > 1 ? 1.1 : 0.7);
    ctx.audio.shot(def.sound, def.pitch, ctx.listener ? ctx.listener.distanceTo(origin) : 0);

    const base = weaponDamage(w);
    const shotEnds = ctx.onShot ? [] : null;
    const d = new THREE.Vector3();
    for (let p = 0; p < def.pellets; p++) {
        randomCone(dir, spread, d);
        const wallDist = ctx.world.raycast(origin, d, def.range);
        let hitActor = null;
        let hit = null;
        for (const other of ctx.actors) {
            if (other === actor || !other.alive) continue;
            if (actor.team && other.team === actor.team) continue; // no friendly fire: bullets pass teammates
            const h = rayHitsActor(other, origin, d, wallDist);
            if (h && (!hit || h.dist < hit.dist)) {
                hit = h;
                hitActor = other;
            }
        }
        const dist = hit ? hit.dist : wallDist;
        const point = origin.clone().addScaledVector(d, dist);
        if (p < 3) {
            ctx.effects.tracer(muzzle, point);
            if (shotEnds) shotEnds.push(point);
        }
        if (hitActor) {
            // falloff: full damage up to 40% of the range, down to 55% at max range
            const falloff = 1 - Math.max(0, (dist / def.range - 0.4) / 0.6) * 0.45;
            let dmg = base * falloff * (hit.head ? def.head || 1.6 : 1);
            if (!actor.human && hitActor.human) dmg *= BOT_DAMAGE_TO_PLAYER;
            else if (!actor.human && !hitActor.human) dmg *= BOT_DAMAGE_TO_BOT;
            const shieldHit = hitActor.shield > 0;
            // in a team match the damage may belong to another computer (ctx.damage decides)
            const killed = ctx.damage ? ctx.damage(actor, hitActor, dmg, hit.head) : applyDamage(hitActor, dmg);
            hitActor.lastHitBy = actor;
            if (hitActor.fx) hitActor.fx.flinch = Math.min(1, 0.4 + dmg / 60);
            hitActor.lastHitAt = ctx.time; // game time, in seconds
            ctx.onHit(actor, hitActor, dmg, hit.head, killed, point, shieldHit);
        } else if (dist < def.range - 0.1) {
            ctx.effects.impact(point);
        }
    }
    if (shotEnds) ctx.onShot(actor, shotEnds);
    return true;
}
