/**
 * Bot brains. Each bot drops onto the island, loots chests and weapons,
 * keeps ahead of the storm, and fights whoever it can see - you or other
 * bots. They are meant to feel like decent players, not aimbots:
 *  - they need a moment to react when they first see you,
 *  - their aim gets better the longer they track you, and is worse at range
 *    and against someone who is moving or jumping,
 *  - they keep the right distance for their gun, strafe and jump,
 *  - they lose you behind walls and bushes, go check where you were,
 *  - they back off and heal when they're hurt.
 * Every bot has its own "skill", so some are tougher than others.
 */
import * as THREE from 'three';
import { WEAPONS, RARITIES } from './weapons.js';
import { currentWeapon, refreshWeaponVisual, EYE_HEIGHT } from './actors.js';
import { isHeal, healCount } from './heals.js';
import { fire, startReload } from './combat.js';
import { moveActor } from './movement.js';
import { POIS } from './world.js';

const rand = (a, b) => a + Math.random() * (b - a);

const PREFERRED_RANGE = { shotgun: 5, smg: 11, pistol: 16, ar: 26, dmr: 45, sniper: 60, heavy: 70 };
const KIND_SCORE = { pistol: 1, smg: 2.2, shotgun: 2.6, ar: 3, dmr: 2.6, sniper: 2.4, heavy: 2.5 };
// how far off their aim is (radians-ish), per gun
const AIM_ERROR = { pistol: 0.028, smg: 0.04, ar: 0.026, shotgun: 0.06, dmr: 0.016, sniper: 0.012, heavy: 0.012 };

// slots hold guns and heals; heals count as "worth a little" so a bot will
// swap them out for a real gun when its bag is full
function weaponScore(w) {
    if (!w) return 0;
    if (isHeal(w)) return 0.8;
    return KIND_SCORE[w.kind] + w.rarity * 0.55;
}

const isGun = (w) => w && !isHeal(w);

export function createBotController(ctx) {
    const { world, loot, storm } = ctx;
    const tmp = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const targetPoint = new THREE.Vector3();
    const dir = new THREE.Vector3();

    function initBot(bot) {
        // where to land: mostly the named places, sometimes anywhere
        let lx;
        let lz;
        if (Math.random() < 0.7) {
            const weights = POIS.map((p) => (p.kind === 'city' ? 1.8 : p.kind === 'lighthouse' || p.kind === 'camp' ? 0.7 : 1.1));
            let x = Math.random() * weights.reduce((a, b) => a + b, 0);
            let poi = POIS[0];
            for (let i = 0; i < POIS.length; i++) {
                x -= weights[i];
                if (x < 0) {
                    poi = POIS[i];
                    break;
                }
            }
            const a = Math.random() * Math.PI * 2;
            const r = Math.random() * poi.r;
            lx = poi.x + Math.cos(a) * r;
            lz = poi.z + Math.sin(a) * r;
        } else {
            // anywhere on land
            for (let k = 0; k < 30; k++) {
                const a = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * 280;
                lx = Math.cos(a) * r;
                lz = Math.sin(a) * r;
                if (world.terrainHeight(lx, lz) > 2) break;
            }
        }
        bot.ai = {
            state: 'drop',
            landing: new THREE.Vector3(lx, 0, lz),
            goal: null,
            goalKind: null,
            goalObj: null,
            target: null,
            visible: false,
            reaction: 0,
            aimTime: 0,
            strafe: Math.random() < 0.5 ? -1 : 1,
            strafeT: 0,
            lastSeen: new THREE.Vector3(),
            searchT: 0,
            thinkT: Math.random() * 0.3,
            skill: rand(0.35, 0.8),
            stuckT: 0,
            lastPos: new THREE.Vector3(),
            detourT: 0,
            detour: new THREE.Vector3(),
            roamT: 0,
            jumpT: rand(1, 3),
            switchT: 0,
            healWait: 0,
            calmUntil: 0,
            peaceUntil: 0,
            botFightT: 0,
            fightLimit: rand(5, 9),
            moveDir: new THREE.Vector3(),
            pauseT: 0,
            wph: Math.random() * 10, // personal phase for weaving and looking around
            holdT: 0,
            landedOnce: false,
        };
    }

    function aliveEnemies(bot) {
        return ctx.actors.filter((a) => a !== bot && a.alive);
    }

    function canSee(bot, other, maxDist) {
        const d = bot.pos.distanceTo(other.pos);
        if (d > maxDist) return false;
        if (other.phase !== 'ground' && d > 60) return false;
        // field of view: in front of them, or close by, or they just got shot by them
        const fx = Math.sin(bot.yaw);
        const fz = Math.cos(bot.yaw);
        const dx = (other.pos.x - bot.pos.x) / (d || 1);
        const dz = (other.pos.z - bot.pos.z) / (d || 1);
        const shotByThem = bot.lastHitBy === other && ctx.time - (bot.lastHitAt ?? -99) < 3;
        if (fx * dx + fz * dz < 0.2 && d > 10 && !shotByThem) return false;
        eye.copy(bot.pos).y += EYE_HEIGHT;
        targetPoint.copy(other.pos).y += 1.1;
        return world.lineOfSight(eye, targetPoint, true);
    }

    function bestWeaponFor(bot, dist) {
        let best = -1;
        let bestScore = -Infinity;
        bot.slots.forEach((w, i) => {
            if (!isGun(w)) return;
            const def = WEAPONS[w.kind];
            if (w.ammoInMag <= 0 && bot.ammo[def.ammo] <= 0) return;
            const pref = PREFERRED_RANGE[w.kind];
            const fit = 1 / (1 + Math.abs(Math.log((dist + 2) / (pref + 2))));
            const score = fit * 3 + weaponScore(w);
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        });
        return best;
    }

    function hasUsableWeapon(bot) {
        return bot.slots.some((w) => isGun(w) && (w.ammoInMag > 0 || bot.ammo[WEAPONS[w.kind].ammo] > 0));
    }

    // things worth walking to: unopened chests, better weapons, ammo when low
    function findLoot(bot, radius) {
        let best = null;
        let bestScore = 0;
        const myBest = Math.max(0, ...bot.slots.map(weaponScore));
        const emptySlot = bot.slots.some((s) => !s);
        for (const c of loot.chests) {
            if (c.opened) continue;
            const d = c.pos.distanceTo(bot.pos);
            if (d > radius || c.claimedBy && c.claimedBy !== bot && c.claimedBy.alive) continue;
            const score = (emptySlot || myBest < 4 ? 3 : 1) / (1 + d * 0.06);
            if (score > bestScore) {
                bestScore = score;
                best = { kind: 'chest', obj: c, pos: c.pos };
            }
        }
        for (const it of loot.items) {
            if (it.vel) continue;
            const d = it.pos.distanceTo(bot.pos);
            if (d > radius) continue;
            let value = 0;
            if (it.type === 'weapon') {
                const s = weaponScore(it.weapon);
                if (emptySlot && s > 0) value = 2 + s * 0.3;
                else if (s > Math.min(...bot.slots.map(weaponScore)) + 0.5) value = 1 + (s - myBest) * 0.4;
            } else if (it.type === 'ammo') {
                const needs = bot.slots.some((w) => isGun(w) && WEAPONS[w.kind].ammo === it.ammoType && bot.ammo[it.ammoType] < 60);
                value = needs ? 1.2 : 0;
            } else if (it.type === 'heal') {
                // walking over heals puts them in the bag (onto a stack or a free slot)
                const room = emptySlot || bot.slots.some((x) => x && x.heal === it.heal && x.count < 3);
                value = room && healCount(bot, it.heal) < 2 ? 0.8 : 0;
            } else if (it.type === 'coin') {
                value = 0.15;
            }
            const score = value / (1 + d * 0.06);
            if (score > bestScore) {
                bestScore = score;
                best = { kind: it.type, obj: it, pos: it.pos };
            }
        }
        return best;
    }

    // a random spot inside the (next) safe circle, on land
    function safeSpot(bot) {
        const st = storm.state;
        const c = st.next.radius < st.radius ? st.next : st;
        for (let k = 0; k < 20; k++) {
            const a = Math.random() * Math.PI * 2;
            const r = Math.sqrt(Math.random()) * Math.max(3, c.radius * 0.8);
            const x = c.center.x + Math.cos(a) * r;
            const z = c.center.y + Math.sin(a) * r;
            if (world.terrainHeight(x, z) > 1.5) return new THREE.Vector3(x, 0, z);
        }
        return new THREE.Vector3(c.center.x, 0, c.center.y);
    }

    function outsideSafe(bot, margin = 0) {
        const st = storm.state;
        const c = st.stage === 'shrink' || storm.status().timeLeft < 20 ? st.next : st;
        return Math.hypot(bot.pos.x - c.center.x, bot.pos.z - c.center.y) > c.radius - margin;
    }

    function useHealIfNeeded(bot) {
        if (bot.using || bot.reloadT > 0) return false;
        const h = {
            bandage: healCount(bot, 'bandage'),
            medkit: healCount(bot, 'medkit'),
            smallShield: healCount(bot, 'smallShield'),
            bigShield: healCount(bot, 'bigShield'),
        };
        if (bot.shield < 50 && h.smallShield > 0 && bot.shield <= 25) return ctx.startUse(bot, 'smallShield');
        if (bot.shield < 50 && h.bigShield > 0) return ctx.startUse(bot, 'bigShield');
        if (bot.hp <= 55 && h.medkit > 0) return ctx.startUse(bot, 'medkit');
        if (bot.hp < 75 && h.bandage > 0) return ctx.startUse(bot, 'bandage');
        if (bot.shield < 100 && h.bigShield > 0) return ctx.startUse(bot, 'bigShield');
        if (bot.shield < 50 && h.smallShield > 0) return ctx.startUse(bot, 'smallShield');
        return false;
    }

    function think(bot) {
        const ai = bot.ai;
        // 1. look for enemies
        const cur = currentWeapon(bot);
        // early in the match bots are busy looting and only fight close by,
        // like real players; later they look further
        const early = ctx.time < 70;
        // just after landing everyone grabs loot first
        const calm = ctx.time < ai.calmUntil;
        const sightRange = calm ? 8 : early ? 18 : cur && WEAPONS[cur.kind].scope ? 110 : 50;
        const botVsBot = ctx.time < 150 ? 0.5 : ctx.time < 240 ? 0.75 : 1;
        // after a long bot-vs-bot fight a bot backs off for a while (heals,
        // loots elsewhere) - so not everyone is dead before you even meet them
        if (ai.target && !ai.target.isPlayer && ai.state === 'fight') {
            ai.botFightT += 0.25;
            const limit = ctx.time < 240 ? ai.fightLimit : ai.fightLimit * 2;
            if (ai.botFightT > limit || bot.hp + bot.shield < 45) {
                ai.peaceUntil = ctx.time + rand(14, 24);
                ai.target = null;
                ai.visible = false;
                ai.botFightT = 0;
                ai.fightLimit = rand(5, 9);
                ai.goal = null;
            }
        } else if (!ai.target) {
            ai.botFightT = Math.max(0, ai.botFightT - 0.25);
        }
        const peace = ctx.time < ai.peaceUntil;
        let best = null;
        let bestD = Infinity;
        for (const other of aliveEnemies(bot)) {
            const d = bot.pos.distanceTo(other.pos);
            const shotMe = bot.lastHitBy === other && ctx.time - (bot.lastHitAt ?? -99) < 4;
            // backing off: only the player, or a bot right in its face, gets attention
            if (peace && !other.isPlayer && d > 7) continue;
            // bots notice each other later than they notice you, so the
            // lobby thins out over the whole match instead of in the first minutes
            const range = shotMe ? 130 : other.isPlayer ? sightRange : sightRange * botVsBot;
            if (d > range || d > bestD) continue;
            // keep the current target if still visible (no flip-flopping)
            const bias = other === ai.target ? 0.6 : 1;
            if (d * bias < bestD && canSee(bot, other, range)) {
                best = other;
                bestD = d * bias;
            }
        }
        if (best) {
            if (best !== ai.target || !ai.visible) {
                // first sight: a human-like moment to react
                ai.reaction = 0.35 + (1 - ai.skill) * 0.55 + Math.random() * 0.2;
                ai.aimTime = 0;
            }
            ai.target = best;
            ai.visible = true;
            ai.lastSeen.copy(best.pos);
            ai.searchT = 5;
        } else {
            ai.visible = false;
        }

        // 2. decide what to do
        const hurt = bot.hp + bot.shield < 70;
        const inStorm = storm.isOutside(bot.pos);
        if (ai.target && ai.target.alive && (ai.visible || (ai.searchT > 0 && !inStorm)) && hasUsableWeapon(bot)) {
            ai.state = 'fight';
            if (!ai.visible && hurt && useHealIfNeeded(bot)) ai.state = 'heal';
            return;
        }
        if (ai.target && (!ai.target.alive || ai.searchT <= 0)) ai.target = null;
        // in the storm: get out first, heal later
        if (outsideSafe(bot, -2) && storm.isOutside(bot.pos)) {
            if (ai.state !== 'storm' || !ai.goal) ai.goal = safeSpot(bot);
            ai.state = 'storm';
            return;
        }
        if (bot.using) {
            ai.state = 'heal';
            return;
        }
        if (hurt && useHealIfNeeded(bot)) {
            ai.state = 'heal';
            return;
        }
        if (outsideSafe(bot, 4)) {
            if (ai.state !== 'storm' || !ai.goal) ai.goal = safeSpot(bot);
            ai.state = 'storm';
            return;
        }
        if (bot.shield < 100 && useHealIfNeeded(bot)) {
            ai.state = 'heal';
            return;
        }
        // in the mood for looting or for exploring? (decided every few seconds, not every moment)
        if (ctx.time > (ai.moodT || 0)) {
            ai.lootMood = Math.random() < 0.6;
            ai.moodT = ctx.time + rand(5, 10);
        }
        const wantLoot = !hasUsableWeapon(bot) || bot.slots.filter(isGun).length < 3 || ai.lootMood;
        if (wantLoot) {
            const l = findLoot(bot, hasUsableWeapon(bot) ? 35 : 70);
            if (l) {
                if (ai.goalObj !== l.obj) {
                    // loot inside a house: walk in through the door
                    ai.goalDoor = null;
                    if (l.obj.door) {
                        eye.copy(bot.pos).y += EYE_HEIGHT;
                        targetPoint.copy(l.pos).y += 0.8;
                        if (!world.lineOfSight(eye, targetPoint, false)) ai.goalDoor = new THREE.Vector3(l.obj.door.x, 0, l.obj.door.z);
                    }
                }
                ai.state = 'loot';
                ai.goal = l.pos.clone();
                ai.goalKind = l.kind;
                ai.goalObj = l.obj;
                if (l.kind === 'chest') l.obj.claimedBy = bot;
                return;
            }
        }
        ai.roamT -= 0.25;
        const arrived = ai.state === 'roam' && ai.goal && Math.hypot(ai.goal.x - bot.pos.x, ai.goal.z - bot.pos.z) < 4;
        if (ai.state !== 'roam' || !ai.goal || ai.roamT <= 0 || arrived) {
            ai.goal = safeSpot(bot);
            ai.roamT = rand(15, 30);
            // got where it was going: sometimes stop and look around before heading off
            if (arrived && Math.random() < 0.5) ai.pauseT = rand(0.8, 2.2);
        }
        ai.state = 'roam';
    }

    // walk toward a point, steering around walls
    function steer(bot, goal, out) {
        out.set(goal.x - bot.pos.x, 0, goal.z - bot.pos.z);
        const len = out.length();
        if (len < 0.01) return out.set(0, 0, 0);
        out.divideScalar(len);
        const ai = bot.ai;
        if (ai.detourT > 0) return out.copy(ai.detour);
        // feelers: if a wall is in the way, try angles to the sides
        // (hills don't count: you can walk up them)
        eye.copy(bot.pos).y += 0.8;
        if (world.raycast(eye, out, 2.5, { noTerrain: true }) < 2.4) {
            for (const ang of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9]) {
                tmp.copy(out).applyAxisAngle(THREE.Object3D.DEFAULT_UP, ang * ai.strafe);
                if (world.raycast(eye, tmp, 3, { noTerrain: true }) >= 2.9) {
                    ai.detour.copy(tmp);
                    ai.detourT = 0.6;
                    return out.copy(tmp);
                }
            }
        }
        return out;
    }

    // turn toward a point - smoothly, and no faster than a person turns (maxRate rad/s)
    function faceTowards(bot, x, z, dt, speed = 8, maxRate = 6) {
        const want = Math.atan2(x - bot.pos.x, z - bot.pos.z);
        let diff = want - bot.yaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        let step = diff * Math.min(1, dt * speed);
        const max = maxRate * dt;
        if (step > max) step = max;
        else if (step < -max) step = -max;
        bot.yaw += step;
    }

    function update(bot, dt) {
        const ai = bot.ai;
        const input = { x: 0, z: 0, jump: false, toggleGlider: false };
        const move = new THREE.Vector3();

        // ---- in the air: steer to the landing spot
        if (bot.phase !== 'ground') {
            ai.calmUntil = ctx.time + rand(8, 14);
            steerFlat(bot, ai.landing, move);
            input.x = move.x;
            input.z = move.z;
            if (Math.hypot(ai.landing.x - bot.pos.x, ai.landing.z - bot.pos.z) < 3) {
                input.x = 0;
                input.z = 0;
            }
            faceTowards(bot, ai.landing.x, ai.landing.z, dt, 2);
            moveActor(bot, world, input, dt);
            return;
        }

        // just landed: look around for a moment before running off
        if (!ai.landedOnce) {
            ai.landedOnce = true;
            ai.pauseT = rand(0.5, 1.3);
        }
        ai.thinkT -= dt;
        ai.searchT -= dt;
        ai.detourT -= dt;
        if (ai.thinkT <= 0) {
            ai.thinkT = 0.25;
            think(bot);
        }

        // walking but not getting any closer to where it wants to go? take a detour
        if (ai.pauseT > 0) {
            ai.progressT = 0;
            ai.progressD = undefined;
            ai.stuckT = 0;
        } else if (ai.goal && ai.state !== 'fight' && ai.state !== 'heal') {
            ai.progressT = (ai.progressT || 0) + dt;
            if (ai.progressT > 4) {
                const d = Math.hypot(ai.goal.x - bot.pos.x, ai.goal.z - bot.pos.z);
                if (ai.progressD !== undefined && d > ai.progressD - 2 && d > 3) {
                    ai.detour.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
                    ai.detourT = rand(1.2, 2.2);
                    ai.goalDoor = null;
                    input.jump = true;
                }
                ai.progressD = d;
                ai.progressT = 0;
            }
        }
        // stuck? try another way and hop
        ai.stuckT += dt;
        if (ai.stuckT > 1.2) {
            if (bot.pos.distanceTo(ai.lastPos) < 0.6 && ai.state !== 'heal' && ai.state !== 'fight') {
                ai.detour.set(rand(-1, 1), 0, rand(-1, 1)).normalize();
                ai.detourT = 0.9;
                input.jump = true;
            }
            ai.lastPos.copy(bot.pos);
            ai.stuckT = 0;
        }

        bot.aiming = false;
        if (ai.state === 'fight' && ai.target) fight(bot, dt, input, move);
        else if (ai.state === 'heal') {
            // shuffle a little while healing
            input.x = 0;
            input.z = 0;
        } else if (ai.pauseT > 0 && ai.state !== 'storm') {
            // standing still for a moment, looking around (like a person checking the area)
            ai.pauseT -= dt;
            bot.yaw += Math.sin(ctx.time * 1.7 + ai.wph) * dt * 1.3;
            bot.pitch += (Math.sin(ctx.time * 1.1 + ai.wph) * 0.15 - bot.pitch) * Math.min(1, dt * 3);
        } else if (ai.goal) {
            let target = ai.goal;
            // inside a house and going somewhere else: out through the door first
            const inHouse = world.houseAt(bot.pos.x, bot.pos.z, bot.pos.y);
            if (inHouse && world.houseAt(ai.goal.x, ai.goal.z) !== inHouse) {
                const dIn = Math.hypot(inHouse.doorIn.x - bot.pos.x, inHouse.doorIn.z - bot.pos.z);
                tmp.set(dIn > 1.0 ? inHouse.doorIn.x : inHouse.doorOut.x, 0, dIn > 1.0 ? inHouse.doorIn.z : inHouse.doorOut.z);
                target = tmp.clone();
                ai.detourT = 0;
            } else if (ai.state === 'loot' && ai.goalDoor) {
                if (Math.hypot(ai.goalDoor.x - bot.pos.x, ai.goalDoor.z - bot.pos.z) < 1.4) ai.goalDoor = null;
                else target = ai.goalDoor;
            }
            steer(bot, target, move);
            const dist = Math.hypot(target.x - bot.pos.x, target.z - bot.pos.z);
            // people don't walk in ruler-straight lines: a gentle weave on longer walks
            if (ai.detourT <= 0 && dist > 8 && !inHouse) {
                const weave = Math.sin(ctx.time * 0.55 + ai.wph) * 0.24 + Math.sin(ctx.time * 1.9 + ai.wph * 2) * 0.07;
                move.applyAxisAngle(THREE.Object3D.DEFAULT_UP, weave);
            }
            // jog when exploring, run to loot and away from the storm, slow down when arriving
            let pace = ai.state === 'storm' ? 1 : ai.state === 'loot' ? 0.92 : 0.62;
            if (ai.state === 'loot' && dist < 3) pace = 0.5;
            input.x = move.x * pace;
            input.z = move.z * pace;
            faceTowards(bot, bot.pos.x + move.x, bot.pos.z + move.z, dt, 5, 4.5);
            bot.pitch += (-0.05 - bot.pitch) * Math.min(1, dt * 3);
            // arrived at loot
            if (ai.state === 'loot' && Math.hypot(ai.goal.x - bot.pos.x, ai.goal.z - bot.pos.z) < 1.6) {
                if (ai.goalKind === 'chest') {
                    loot.openChest(ai.goalObj);
                    ai.pauseT = rand(0.5, 1.1); // a moment to look at what came out
                } else if (ai.goalKind === 'weapon' && loot.items.includes(ai.goalObj)) takeWeaponSmart(bot, ai.goalObj);
                ai.goal = null;
                ai.thinkT = 0.4;
            }
            // pick the best gun for walking around
            if (!currentWeapon(bot) || Math.random() < 0.01) selectSlot(bot, bestWeaponFor(bot, 25));
        }

        if (bot.using) {
            input.x *= 0.3;
            input.z *= 0.3;
        }
        // change direction gradually (no robotic instant turns)
        const rate = ai.state === 'fight' ? 6 : 3.5;
        const k = Math.min(1, dt * rate);
        ai.moveDir.x += (input.x - ai.moveDir.x) * k;
        ai.moveDir.z += (input.z - ai.moveDir.z) * k;
        input.x = ai.moveDir.x;
        input.z = ai.moveDir.z;
        moveActor(bot, world, input, dt);
        ai.pickT = (ai.pickT || 0) - dt;
        if (ai.pickT <= 0) {
            ai.pickT = 0.2;
            loot.autoPickup(bot);
        }
    }

    function steerFlat(bot, goal, out) {
        out.set(goal.x - bot.pos.x, 0, goal.z - bot.pos.z);
        const len = out.length();
        if (len > 1) out.divideScalar(len);
        return out;
    }

    function selectSlot(bot, i) {
        if (i < 0 || i === bot.current) return;
        bot.current = i;
        bot.reloadT = 0;
        refreshWeaponVisual(bot);
    }

    function takeWeaponSmart(bot, item) {
        const empty = bot.slots.findIndex((s) => !s);
        let slot = empty;
        if (slot < 0) {
            // swap out the weakest gun
            let worst = 0;
            bot.slots.forEach((w, i) => { if (weaponScore(w) < weaponScore(bot.slots[worst])) worst = i; });
            if (weaponScore(item.weapon) <= weaponScore(bot.slots[worst])) return;
            slot = worst;
        }
        loot.takeWeapon(bot, item, slot);
        // a little starting ammo so they can use what they find
        const def = WEAPONS[item.weapon.kind];
        bot.ammo[def.ammo] += def.mag * 2;
        selectSlot(bot, slot);
        refreshWeaponVisual(bot);
    }

    function fight(bot, dt, input, move) {
        const ai = bot.ai;
        const t = ai.target;
        const dist = bot.pos.distanceTo(t.pos);

        // the right gun for this distance
        ai.switchT -= dt;
        if (ai.switchT <= 0) {
            const best = bestWeaponFor(bot, dist);
            if (best >= 0 && best !== bot.current) selectSlot(bot, best);
            ai.switchT = rand(0.8, 1.6);
        }
        const w = currentWeapon(bot);
        if (!w) return;
        const def = WEAPONS[w.kind];

        const aimAt = ai.visible ? t.pos : ai.lastSeen;
        faceTowards(bot, aimAt.x, aimAt.z, dt, 9, 5 + ai.skill * 6);

        // keep the right distance, strafe side to side, hop now and then
        const pref = PREFERRED_RANGE[w.kind];
        const toward = new THREE.Vector3(aimAt.x - bot.pos.x, 0, aimAt.z - bot.pos.z).normalize();
        const side = new THREE.Vector3(toward.z, 0, -toward.x).multiplyScalar(ai.strafe);
        let forward = 0;
        if (!ai.visible) forward = 1; // go look where they were
        else if (dist > pref * 1.3) forward = 1;
        else if (dist < pref * 0.6) forward = -0.8;
        const lowHealth = bot.hp + bot.shield < 45 && bot.slots.some(isHeal);
        if (lowHealth && ai.visible) forward = -1; // back off to heal
        ai.holdT -= dt;
        // sometimes plant your feet for a steadier shot
        const sideAmt = !ai.visible ? 0.2 : ai.holdT > 0 ? 0 : 0.85;
        move.copy(toward).multiplyScalar(forward).addScaledVector(side, sideAmt);
        if (move.lengthSq() > 1) move.normalize();
        if (forward > 0.5) steer(bot, tmp.copy(bot.pos).addScaledVector(move, 5), move);
        input.x = move.x;
        input.z = move.z;
        ai.strafeT -= dt;
        if (ai.strafeT <= 0) {
            ai.strafe *= -1;
            ai.strafeT = rand(0.8, 2.2);
            if (Math.random() < 0.25) ai.holdT = rand(0.4, 0.9);
        }
        ai.jumpT -= dt;
        if (ai.jumpT <= 0 && ai.visible) {
            input.jump = Math.random() < 0.3;
            ai.jumpT = rand(2, 5);
        }

        // shooting
        if (w.ammoInMag <= 0) {
            if (!startReload(bot)) {
                const other = bestWeaponFor(bot, dist);
                if (other >= 0 && other !== bot.current) selectSlot(bot, other);
            }
            return;
        }
        if (!ai.visible) return;
        ai.reaction -= dt;
        ai.aimTime += dt;
        eye.copy(bot.pos).y += EYE_HEIGHT;
        // aim at the body, sometimes the head
        targetPoint.copy(t.pos).y += Math.random() < 0.15 + ai.skill * 0.15 ? 1.5 : 0.85;
        const dy = targetPoint.y - eye.y;
        bot.pitch = Math.atan2(dy, Math.hypot(targetPoint.x - eye.x, targetPoint.z - eye.z));
        if (ai.reaction > 0 || dist > def.range * 1.05) return;
        bot.aiming = dist > 18 && w.kind !== 'shotgun';

        // aim error: worse at range, against moving/jumping targets, and right after spotting
        const targetSpeed = Math.hypot(t.vel.x, t.vel.z) + Math.abs(t.vel.y) * 0.5;
        let err = AIM_ERROR[w.kind] * (1.6 - ai.skill) + targetSpeed * 0.0045;
        err *= Math.max(0.55, 1.4 - ai.aimTime * 0.35);
        if (!bot.onGround) err *= 1.5;
        dir.subVectors(targetPoint, eye).normalize();
        dir.x += (Math.random() - 0.5) * err * 2;
        dir.y += (Math.random() - 0.5) * err * 2;
        dir.z += (Math.random() - 0.5) * err * 2;
        dir.normalize();
        // people shoot in bursts and re-aim; semi-automatic guns aren't spammed
        ai.burstT = (ai.burstT ?? rand(0.5, 1.2)) - dt;
        if (ai.burstT < 0) {
            if (ai.burstT < -rand(0.35, 0.9)) ai.burstT = rand(0.5, 1.3);
            return;
        }
        if (!def.auto && Math.random() < 0.35) return;
        fire(bot, eye, dir, ctx.combat);
    }

    return { initBot, update, weaponScore };
}
