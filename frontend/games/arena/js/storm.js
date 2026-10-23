/**
 * The storm: a circle that waits, then shrinks to a smaller circle inside it,
 * again and again. Outside it you lose health every second, more in later
 * phases - it pushes everyone together for the final fights.
 */
import * as THREE from 'three';

const PHASES = [
    { wait: 60, shrink: 50, radius: 240, dps: 1 },
    { wait: 45, shrink: 40, radius: 150, dps: 2 },
    { wait: 35, shrink: 32, radius: 90, dps: 4 },
    { wait: 30, shrink: 26, radius: 48, dps: 6 },
    { wait: 25, shrink: 22, radius: 22, dps: 8 },
    { wait: 20, shrink: 20, radius: 8, dps: 11 },
    { wait: 15, shrink: 20, radius: 0, dps: 15 },
];

export function createStorm(scene, world) {
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x9333ea, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, fog: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 160, 1, true), wallMat);
    wall.renderOrder = 5;
    scene.add(wall);
    // a brighter edge line where the storm meets the ground
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xd8b4fe, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, fog: false });
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true), edgeMat);
    scene.add(edge);

    const s = {
        center: new THREE.Vector2(0, 0),
        radius: 430,
        from: { center: new THREE.Vector2(0, 0), radius: 430 },
        next: { center: new THREE.Vector2(0, 0), radius: 430 },
        phase: -1,
        stage: 'wait',
        timer: 0,
        dps: 1,
    };

    function pickNext(i) {
        const r = PHASES[i].radius;
        const room = Math.max(0, s.radius - r);
        // a spot on land, inside the current circle
        for (let k = 0; k < 40; k++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * room * 0.9;
            const x = s.center.x + Math.cos(a) * d;
            const z = s.center.y + Math.sin(a) * d;
            if (world.terrainHeight(x, z) > 1.8 || k === 39) {
                s.next.center.set(x, z);
                s.next.radius = r;
                return;
            }
        }
    }

    function startPhase(i) {
        s.phase = i;
        s.stage = 'wait';
        s.timer = PHASES[i].wait;
        s.from.center.copy(s.center);
        s.from.radius = s.radius;
        pickNext(i);
    }

    startPhase(0);
    s.dps = PHASES[0].dps;

    function update(dt, t, viewer) {
        if (s.phase >= PHASES.length) return null;
        let event = null;
        s.timer -= dt;
        const p = PHASES[s.phase];
        if (s.stage === 'wait' && s.timer <= 0) {
            s.stage = 'shrink';
            s.timer = p.shrink;
            s.dps = p.dps;
            event = 'shrink';
        } else if (s.stage === 'shrink') {
            const k = 1 - Math.max(0, s.timer) / p.shrink;
            s.center.lerpVectors(s.from.center, s.next.center, k);
            s.radius = s.from.radius + (s.next.radius - s.from.radius) * k;
            if (s.timer <= 0) {
                s.center.copy(s.next.center);
                s.radius = s.next.radius;
                if (s.phase + 1 < PHASES.length) {
                    startPhase(s.phase + 1);
                    event = 'wait';
                } else {
                    s.phase = PHASES.length;
                }
            }
        }
        const r = Math.max(0.5, s.radius);
        wall.scale.set(r, 300, r);
        wall.position.set(s.center.x, 120, s.center.y);
        edge.scale.set(r, 3, r);
        edge.position.set(s.center.x, world.terrainHeight(s.center.x, s.center.y) + 0.5, s.center.y);
        // the wall is see-through when it's far away, thicker when you're close to it
        let near = 1;
        if (viewer) {
            const d = Math.abs(Math.hypot(viewer.x - s.center.x, viewer.z - s.center.y) - r);
            near = 1 - Math.min(1, Math.max(0, (d - 30) / 250)) * 0.7;
        }
        wallMat.opacity = (0.28 + Math.sin(t * 2) * 0.05) * near;
        return event;
    }

    function isOutside(pos) {
        return Math.hypot(pos.x - s.center.x, pos.z - s.center.y) > s.radius;
    }

    // seconds until the next change, and what it is
    function status() {
        return { stage: s.stage, timeLeft: Math.max(0, s.timer), phase: s.phase, over: s.phase >= PHASES.length };
    }

    return { state: s, update, isOutside, status };
}
