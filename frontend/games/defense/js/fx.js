/**
 * Effects: explosions, lightning, frost, ink splats, glowing projectiles,
 * pickups' sparkle, and the floating damage numbers.
 */
import * as THREE from 'three';
import { glowTexture } from './paint.js';

export function createFx(scene, camera) {
    const list = [];
    const spriteMats = new Map();
    function spriteMat(color, additive = true) {
        const key = `${color}:${additive}`;
        if (!spriteMats.has(key)) {
            spriteMats.set(key, new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
        }
        return spriteMats.get(key);
    }
    function glow(pos, color, size, life, { grow = 0, vel = null, gravity = 0, fade = true } = {}) {
        const s = new THREE.Sprite(spriteMat(color).clone());
        s.position.copy(pos);
        s.scale.setScalar(size);
        scene.add(s);
        list.push({ obj: s, t: 0, life, size, grow, vel, gravity, fade, kind: 'sprite' });
        return s;
    }

    // a flash of light (a real light for a moment, kept to a few at once)
    const lights = [];
    for (let i = 0; i < 3; i++) {
        const l = new THREE.PointLight(0xffaa55, 0, 14, 2);
        scene.add(l);
        lights.push({ l, t: 1 });
    }
    // fewer real lights on slow computers (each light costs on every pixel)
    function setFlashLights(n) {
        lights.forEach((s, i) => { s.l.visible = i < n; });
    }
    function flashLight(pos, color, power = 30, range = 14) {
        const on = lights.filter((s) => s.l.visible);
        if (!on.length) return;
        const slot = on.reduce((a, b) => (a.t > b.t ? a : b));
        slot.l.position.copy(pos);
        slot.l.color.setHex(color);
        slot.l.distance = range;
        slot.l.userData.power = power;
        slot.t = 0;
    }

    function explosion(pos, radius = 5, color = 0xff8a3d) {
        glow(pos, 0xfff3c4, radius * 1.2, 0.18, { grow: radius * 2 });
        glow(pos, color, radius * 2.2, 0.45, { grow: radius });
        for (let i = 0; i < 16; i++) {
            const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.4, (Math.random() - 0.5) * 2).normalize().multiplyScalar(radius * (1.5 + Math.random() * 2));
            glow(pos, i % 3 ? color : 0x52525b, 0.8 + Math.random() * 0.8, 0.6 + Math.random() * 0.4, { vel: v, gravity: 6, grow: 1.5 });
        }
        // a ring on the floor
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
        ring.position.set(pos.x, 0.06, pos.z);
        scene.add(ring);
        list.push({ obj: ring, t: 0, life: 0.5, kind: 'ring', size: radius });
        flashLight(pos, color, 60, radius * 4);
    }

    function shockwave(pos, radius, color = 0xa78bfa) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        ring.position.set(pos.x, 0.08, pos.z);
        scene.add(ring);
        list.push({ obj: ring, t: 0, life: 0.6, kind: 'ring', size: radius });
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            glow(new THREE.Vector3(pos.x, 0.3, pos.z), 0x78716c, 1.4, 0.7, { vel: new THREE.Vector3(Math.cos(a) * radius * 1.6, 2, Math.sin(a) * radius * 1.6), grow: 1.8, gravity: 3 });
        }
    }

    function lightning(points, color = 0x93c5fd) {
        // a jagged bright line through all the points
        const pts = [];
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            const segs = 7;
            for (let k = 0; k < segs; k++) {
                const t = k / segs;
                const p = a.clone().lerp(b, t);
                if (k > 0) p.add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7));
                pts.push(p);
            }
        }
        pts.push(points[points.length - 1].clone());
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        for (const [c, w] of [[0xffffff, 1], [color, 1]]) {
            const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: c, transparent: true, opacity: w, blending: THREE.AdditiveBlending, depthWrite: false }));
            scene.add(line);
            list.push({ obj: line, t: 0, life: 0.16, kind: 'line' });
        }
        points.slice(1).forEach((p) => glow(p, color, 1.6, 0.25, { grow: 2 }));
        flashLight(points[0], color, 25, 10);
    }

    function frost(pos) {
        for (let i = 0; i < 5; i++) {
            glow(pos, 0xbae6fd, 0.35, 0.45, { vel: new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4), gravity: 5 });
        }
    }

    function splat(pos, color = 0x6366f1, n = 10) {
        for (let i = 0; i < n; i++) {
            glow(pos, color, 0.4 + Math.random() * 0.4, 0.5 + Math.random() * 0.3, { vel: new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6), gravity: 12 });
        }
    }

    function poof(pos, color = 0xd8b4fe, size = 2) {
        glow(pos, color, size, 0.5, { grow: size * 1.5 });
        for (let i = 0; i < 8; i++) glow(pos, color, 0.5, 0.6, { vel: new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4, (Math.random() - 0.5) * 5), gravity: -1 });
    }

    function sparkle(pos, color = 0xfde68a) {
        for (let i = 0; i < 8; i++) glow(pos, color, 0.25, 0.6, { vel: new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3), gravity: 4 });
    }

    // glowing balls that fly (monster shots, rockets) - drawn from a list each frame
    function orb(color, size = 0.6) {
        const g = new THREE.Group();
        const core = new THREE.Sprite(spriteMat(0xffffff).clone());
        core.scale.setScalar(size * 0.45);
        const halo = new THREE.Sprite(spriteMat(color).clone());
        halo.scale.setScalar(size * 1.4);
        g.add(core, halo);
        scene.add(g);
        return g;
    }
    function trail(pos, color, size = 0.5) {
        glow(pos, color, size, 0.3, { grow: -size * 1.5 });
    }
    function removeObj(obj) {
        scene.remove(obj);
        obj.traverse((o) => {
            if (o.material) o.material.dispose();
        });
    }

    function update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
            const e = list[i];
            e.t += dt;
            const k = e.t / e.life;
            if (k >= 1) {
                scene.remove(e.obj);
                if (e.obj.material) e.obj.material.dispose();
                if (e.kind === 'ring' || e.kind === 'line') e.obj.geometry.dispose();
                list.splice(i, 1);
                continue;
            }
            if (e.kind === 'sprite') {
                if (e.vel) {
                    e.vel.y -= e.gravity * dt;
                    e.obj.position.addScaledVector(e.vel, dt);
                    e.vel.multiplyScalar(1 - Math.min(1, dt * 1.5));
                }
                e.obj.scale.setScalar(Math.max(0.01, e.size + e.grow * k));
                if (e.fade) e.obj.material.opacity = 1 - k;
            } else if (e.kind === 'ring') {
                e.obj.scale.setScalar(0.5 + e.size * k);
                e.obj.material.opacity = 0.9 * (1 - k);
            } else if (e.kind === 'line') {
                e.obj.material.opacity = 1 - k;
            }
        }
        for (const s of lights) {
            s.t += dt;
            s.l.intensity = s.t < 0.35 ? (s.l.userData.power || 0) * (1 - s.t / 0.35) : 0;
        }
    }

    // ---- damage numbers (HTML, crisp)
    const layer = document.getElementById('damageNumbers');
    const numbers = [];
    const proj = new THREE.Vector3();
    function number(pos, value, kind = '') {
        if (!layer) return;
        const el = document.createElement('div');
        el.className = `dmg ${kind}`;
        el.textContent = Math.round(value);
        layer.appendChild(el);
        numbers.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0.3, (Math.random() - 0.5) * 0.6)), t: 0 });
        if (numbers.length > 40) {
            const old = numbers.shift();
            old.el.remove();
        }
    }
    function updateNumbers(dt, w, h) {
        for (let i = numbers.length - 1; i >= 0; i--) {
            const n = numbers[i];
            n.t += dt;
            if (n.t > 0.9) {
                n.el.remove();
                numbers.splice(i, 1);
                continue;
            }
            proj.copy(n.pos);
            proj.y += n.t * 1.2;
            proj.project(camera);
            if (proj.z > 1) {
                n.el.style.opacity = '0';
                continue;
            }
            const x = (proj.x * 0.5 + 0.5) * w;
            const y = (-proj.y * 0.5 + 0.5) * h;
            const s = n.t < 0.12 ? 1.4 - n.t * 3 : 1;
            n.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(2)})`;
            n.el.style.opacity = String(Math.min(1, (0.9 - n.t) * 3));
        }
    }

    return { explosion, shockwave, lightning, frost, splat, poof, sparkle, orb, trail, removeObj, glow, update, number, updateNumbers, flashLight, setFlashLights };
}
