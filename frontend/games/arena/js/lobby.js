/**
 * The lobby before a match: you and your teammates on a softly lit stage.
 * Characters drop onto their spots with a little bounce; an empty spot shows
 * a faint silhouette with a "+" to invite someone; a green ring flashes when
 * someone is ready. Name plates (HTML) sit under everyone's feet.
 */
import * as THREE from 'three';
import { applySkin } from '../../shared/skins.js';

// four spots: you in the middle, your friends on both sides, a step back
const SPOTS = [
    new THREE.Vector3(0, 0, 0.25),
    new THREE.Vector3(-2.15, 0, -0.45),
    new THREE.Vector3(2.15, 0, -0.45),
    new THREE.Vector3(-4.1, 0, -1.25),
];
const MAX = 4;

function radialTexture(stops, size = 256) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([at, color]) => g.addColorStop(at, color));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function backgroundTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(256, 210, 20, 256, 256, 420);
    g.addColorStop(0, '#2b3f9e');
    g.addColorStop(0.45, '#17205c');
    g.addColorStop(1, '#070a1f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

export function createLobby({ renderer, gltf, labels }) {
    const scene = new THREE.Scene();
    scene.background = backgroundTexture();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);

    scene.add(new THREE.HemisphereLight(0xc7d6ff, 0x1a1440, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.3);
    key.position.set(2.5, 6, 7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb7ff, 2.4);
    rim.position.set(-3, 4, -6);
    scene.add(rim);
    const warm = new THREE.PointLight(0xffc97a, 6, 9);
    warm.position.set(0, 2.5, 3);
    scene.add(warm);

    // a big soft glow behind everyone
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: radialTexture([[0, 'rgba(120,150,255,0.55)'], [0.4, 'rgba(90,90,220,0.22)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    glow.scale.set(16, 10, 1);
    glow.position.set(0, 2.6, -5);
    scene.add(glow);

    // the floor fades softly into the background (no hard edge)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshBasicMaterial({
        map: radialTexture([[0, 'rgba(46,62,160,0.95)'], [0.3, 'rgba(34,46,128,0.7)'], [0.65, 'rgba(26,34,100,0.25)'], [1, 'rgba(20,28,90,0)']]),
        transparent: true, depthWrite: false,
    }));
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = -2;
    scene.add(floor);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(6.5, 64), new THREE.MeshBasicMaterial({
        map: radialTexture([[0, 'rgba(140,170,255,0.45)'], [0.6, 'rgba(90,110,230,0.12)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.01;
    pool.renderOrder = -1;
    scene.add(pool);

    // slow floating dust
    const dustCount = 140;
    const dustPos = new Float32Array(dustCount * 3);
    const dustSpeed = new Float32Array(dustCount);
    for (let i = 0; i < dustCount; i++) {
        dustPos[i * 3] = (Math.random() - 0.5) * 16;
        dustPos[i * 3 + 1] = Math.random() * 7;
        dustPos[i * 3 + 2] = -6 + Math.random() * 8;
        dustSpeed[i] = 0.08 + Math.random() * 0.2;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
        size: 0.07, map: radialTexture([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']], 64),
        transparent: true, depthWrite: false, opacity: 0.7, blending: THREE.AdditiveBlending, color: 0xbcd0ff,
    }));
    scene.add(dust);

    // the spots: a thin glowing ring, a soft disc, and a ring that bursts when you're ready
    const discTex = radialTexture([[0, 'rgba(160,200,255,0.55)'], [0.7, 'rgba(120,160,255,0.18)'], [1, 'rgba(0,0,0,0)']]);
    const spots = SPOTS.map((p) => {
        const g = new THREE.Group();
        g.position.copy(p);
        const disc = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ map: discTex, transparent: true, depthWrite: false }));
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = 0.015;
        g.add(disc);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x9cc4ff, transparent: true, opacity: 0.85 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.016, 8, 72), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.03;
        g.add(ring);
        const burstMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0, depthWrite: false });
        const burst = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.05, 8, 72), burstMat);
        burst.rotation.x = Math.PI / 2;
        burst.position.y = 0.04;
        g.add(burst);
        scene.add(g);
        return { group: g, ring, ringMat, disc, burst, burstMat, burstT: 1, member: null, model: null, mixer: null, skin: null, clips: null, inT: 1, appear: 1 };
    });

    function makeCharacter(skinId) {
        const model = gltf.scene.clone(true);
        model.scale.setScalar(1.55);
        model.traverse((c) => { if (c.isMesh) c.material = c.material.clone(); });
        const mixer = new THREE.AnimationMixer(model);
        const clips = Object.fromEntries(gltf.animations.map((a) => [a.name, a]));
        if (clips.idle) mixer.clipAction(clips.idle).play();
        const skin = applySkin({ model, scene, skinId, height: 1.7 });
        return { model, mixer, skin, clips };
    }

    // members: [{ name, ready, skin, me, leader }] - yours first.
    // Free spots (with a "+") only show when you can invite someone.
    let canInvite = false;
    function setMembers(members, opts = {}) {
        canInvite = Boolean(opts.canInvite);
        for (let i = 0; i < MAX; i++) {
            const s = spots[i];
            const m = members[i] || null;
            const changed = !s.member !== !m || (m && (s.member.name !== m.name || s.member.skin !== m.skin));
            if (changed) {
                if (s.model) s.group.remove(s.model);
                s.model = null;
                s.mixer = null;
                s.skin = null;
                if (m) {
                    const c = makeCharacter(m.skin);
                    c.model.rotation.y = -SPOTS[i].x * 0.07;
                    s.group.add(c.model);
                    Object.assign(s, { model: c.model, mixer: c.mixer, skin: c.skin, clips: c.clips });
                    s.inT = 0; // drop in
                }
            }
            if (m && m.ready && !(s.member && s.member.ready)) {
                // ready: a green ring bursts out and a happy hop
                s.burstT = 0;
                if (s.mixer && s.clips.jump) {
                    const a = s.mixer.clipAction(s.clips.jump);
                    a.setLoop(THREE.LoopOnce, 1);
                    a.reset().play();
                }
            }
            s.member = m ? { ...m } : null;
            const show = Boolean(m) || canInvite;
            if (show && !s.group.visible) s.appear = 0;
            s.group.visible = show;
            s.ringMat.color.setHex(!m ? 0x5a6ea8 : m.ready ? 0x4ade80 : 0x9cc4ff);
        }
        labelSig = '';
    }

    let w = 1;
    let h = 1;
    let narrow = false;
    function resize(width, height) {
        w = width;
        h = height;
        camera.aspect = width / height;
        narrow = camera.aspect < 1.15;
        camera.updateProjectionMatrix();
    }

    const tmp = new THREE.Vector3();
    function screenPos(i, y) {
        tmp.copy(SPOTS[i]);
        tmp.y = y;
        tmp.project(camera);
        return [(tmp.x * 0.5 + 0.5) * w, (-tmp.y * 0.5 + 0.5) * h];
    }

    // name plates under the feet and "+" on the free spots (HTML: crisp, clickable)
    let labelSig = '';
    const els = [];
    function renderLabels() {
        const sig = spots.map((s) => (s.member ? `${s.member.name}|${s.member.ready}|${s.member.me}|${s.member.leader}` : s.group.visible ? '+' : '-')).join(',');
        if (sig !== labelSig) {
            labelSig = sig;
            labels.innerHTML = '';
            els.length = 0;
            spots.forEach((s) => {
                // the outer box only follows the stage; the inner one animates
                const div = document.createElement('div');
                div.className = 'lb-pin';
                if (s.member) {
                    const m = s.member;
                    div.innerHTML = `<div class="lb-plate${m.ready ? ' ready' : ''}${m.me ? ' me' : ''}"><span class="dot"></span><b>${m.leader ? '<i class="crown">♛</i>' : ''}${escapeHtml(m.name)}</b><small>${m.ready ? 'מוכן' : 'ממתין'}</small></div>`;
                } else if (s.group.visible) {
                    div.innerHTML = '<div class="lb-plus"><button type="button" aria-label="הזמנת חבר" title="הזמנת חבר"><span>+</span></button></div>';
                    div.querySelector('button').addEventListener('click', () => labels.dispatchEvent(new CustomEvent('invite-click')));
                }
                labels.appendChild(div);
                els.push(div);
            });
        }
        // follow the (gently moving) camera
        spots.forEach((s, i) => {
            const el = els[i];
            if (!el) return;
            const [x, y] = screenPos(i, s.member ? -0.12 : 0.6);
            el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${s.member ? '0' : '-50%'})`;
        });
    }

    function update(dt, t) {
        // a slow, breathing camera
        // (aimed a little low so everyone stands above the ready button)
        const dist = narrow ? 13.5 : 9;
        camera.position.set(Math.sin(t * 0.13) * 0.35, 1.85 + Math.sin(t * 0.21) * 0.06, dist);
        camera.lookAt(0, 0.45, 0);
        spots.forEach((s, i) => {
            if (s.mixer) s.mixer.update(dt);
            if (s.skin && s.model) s.skin.update(dt, { position: s.group.position, worldVelocity: null, moving: false });
            // drop in with a bounce
            if (s.model && s.inT < 1) {
                s.inT = Math.min(1, s.inT + dt * 1.8);
                const k = easeOutBack(s.inT);
                s.model.position.y = (1 - Math.min(1, s.inT * 1.4)) * 2.2;
                s.model.scale.setScalar(1.55 * Math.max(0.01, k));
            }
            if (s.model) s.model.rotation.y = -SPOTS[i].x * 0.07 + Math.sin(t * 0.5 + i) * 0.06;
            s.ringMat.opacity = (s.member ? 0.75 : 0.35) + Math.sin(t * 2 + i) * 0.12;
            // a free spot fades/grows in when it appears
            if (s.appear < 1) {
                s.appear = Math.min(1, s.appear + dt * 2.5);
                const k = easeOutBack(s.appear);
                s.disc.scale.setScalar(Math.max(0.01, k));
                s.ring.scale.setScalar(Math.max(0.01, k));
            }
            if (s.burstT < 1) {
                s.burstT = Math.min(1, s.burstT + dt * 1.4);
                s.burst.scale.setScalar(1 + s.burstT * 1.6);
                s.burstMat.opacity = (1 - s.burstT) * 0.9;
            }
        });
        // dust drifts up and wraps around
        const pos = dustGeo.attributes.position;
        for (let i = 0; i < dustCount; i++) {
            let y = pos.getY(i) + dustSpeed[i] * dt;
            if (y > 7) y = 0;
            pos.setY(i, y);
            pos.setX(i, pos.getX(i) + Math.sin(t * 0.4 + i) * 0.002);
        }
        pos.needsUpdate = true;
        glow.material.opacity = 0.85 + Math.sin(t * 0.7) * 0.15;
        renderLabels();
    }

    function render() {
        renderer.render(scene, camera);
    }

    return { setMembers, update, render, resize, scene, camera };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
