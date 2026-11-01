/**
 * The opening screen: you and your friends stand on the marble steps in
 * front of the Golden Book while the camera slowly circles the library.
 * Empty spots show a "+" to invite someone (same look as the island game).
 */
import * as THREE from 'three';
import { applySkin } from '../../shared/skins.js';

const SPOTS = [
    new THREE.Vector3(0, 0.35, 6.0),
    new THREE.Vector3(-2.2, 0.35, 5.6),
    new THREE.Vector3(2.2, 0.35, 5.6),
    new THREE.Vector3(-4.2, 0.35, 4.7),
];
const easeOutBack = (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2;

export function createStage({ scene, camera, gltf, labels }) {
    const group = new THREE.Group();
    scene.add(group);
    const spots = SPOTS.map((p) => {
        const g = new THREE.Group();
        g.position.copy(p);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xfcd34d, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.025, 8, 64), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.03;
        g.add(ring);
        const burstMat = new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
        const burst = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.06, 8, 64), burstMat);
        burst.rotation.x = Math.PI / 2;
        burst.position.y = 0.04;
        g.add(burst);
        group.add(g);
        return { group: g, ring, ringMat, burst, burstMat, burstT: 1, member: null, model: null, mixer: null, skin: null, clips: null, inT: 1 };
    });

    function makeCharacter(skinId) {
        const model = gltf.scene.clone(true);
        model.scale.setScalar(1.6);
        model.traverse((c) => {
            if (c.isMesh) {
                c.material = c.material.clone();
                c.castShadow = true;
            }
        });
        const mixer = new THREE.AnimationMixer(model);
        const clips = Object.fromEntries(gltf.animations.map((a) => [a.name, a]));
        if (clips.idle) mixer.clipAction(clips.idle).play();
        const skin = applySkin({ model, scene: group, skinId, height: 1.76 });
        return { model, mixer, skin, clips };
    }

    let canInvite = false;
    let labelSig = '';
    function setMembers(members, opts = {}) {
        canInvite = Boolean(opts.canInvite);
        spots.forEach((s, i) => {
            const m = members[i] || null;
            const changed = !s.member !== !m || (m && (s.member.name !== m.name || s.member.skin !== m.skin));
            if (changed) {
                if (s.model) s.group.remove(s.model);
                s.model = null;
                s.mixer = null;
                s.skin = null;
                if (m) {
                    const c = makeCharacter(m.skin);
                    s.group.add(c.model);
                    Object.assign(s, c);
                    s.inT = 0;
                }
            }
            if (m && m.ready && !(s.member && s.member.ready)) {
                s.burstT = 0;
                if (s.mixer && s.clips.jump) {
                    const a = s.mixer.clipAction(s.clips.jump);
                    a.setLoop(THREE.LoopOnce, 1);
                    a.reset().play();
                }
            }
            s.member = m ? { ...m } : null;
            s.group.visible = Boolean(m) || canInvite;
            s.ringMat.color.setHex(!m ? 0x8b7bd8 : m.ready ? 0x4ade80 : 0xfcd34d);
        });
        labelSig = '';
    }

    let w = 1;
    let h = 1;
    function resize(width, height) {
        w = width;
        h = height;
    }

    const tmp = new THREE.Vector3();
    const els = [];
    function renderLabels() {
        const sig = spots.map((s) => (s.member ? `${s.member.name}|${s.member.ready}|${s.member.me}|${s.member.leader}` : s.group.visible ? '+' : '-')).join(',');
        if (sig !== labelSig) {
            labelSig = sig;
            labels.innerHTML = '';
            els.length = 0;
            spots.forEach((s) => {
                const div = document.createElement('div');
                div.className = 'lb-pin';
                if (s.member) {
                    const m = s.member;
                    div.innerHTML = `<div class="lb-plate${m.ready ? ' ready' : ''}${m.me ? ' me' : ''}"><span class="dot"></span><b>${m.leader ? '<i class="crown">♛</i>' : ''}${esc(m.name)}</b><small>${m.ready ? 'מוכן' : 'ממתין'}</small></div>`;
                } else if (s.group.visible) {
                    div.innerHTML = '<div class="lb-plus"><button type="button" aria-label="הזמנת חבר" title="הזמנת חבר"><span>+</span></button></div>';
                    div.querySelector('button').addEventListener('click', () => labels.dispatchEvent(new CustomEvent('invite-click')));
                }
                labels.appendChild(div);
                els.push(div);
            });
        }
        spots.forEach((s, i) => {
            const el = els[i];
            if (!el) return;
            tmp.copy(s.group.position);
            tmp.y += s.member ? -0.15 : 0.7;
            tmp.project(camera);
            const x = (tmp.x * 0.5 + 0.5) * w;
            const y = (-tmp.y * 0.5 + 0.5) * h;
            el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${s.member ? '0' : '-50%'})`;
        });
    }

    function update(dt, t) {
        // a slow, swinging camera in front of the book (wider on narrow screens)
        const narrow = w / h < 1.15;
        const a = Math.sin(t * 0.09) * 0.55;
        const dist = narrow ? 19 : 12.5;
        camera.position.set(Math.sin(a) * dist, 2.7 + Math.sin(t * 0.2) * 0.15, 4 + Math.cos(a) * dist);
        camera.lookAt(0, 1.7, 3.2);
        if (camera.fov !== 55) {
            camera.fov = 55;
            camera.updateProjectionMatrix();
        }
        spots.forEach((s, i) => {
            if (s.mixer) s.mixer.update(dt);
            if (s.skin && s.model) s.skin.update(dt, { position: s.group.position, worldVelocity: null, moving: false });
            if (s.model && s.inT < 1) {
                s.inT = Math.min(1, s.inT + dt * 1.8);
                const k = easeOutBack(s.inT);
                s.model.position.y = (1 - Math.min(1, s.inT * 1.4)) * 2.2;
                s.model.scale.setScalar(1.6 * Math.max(0.01, k));
            }
            if (s.model) {
                // look toward the camera
                s.model.rotation.y = Math.atan2(camera.position.x - s.group.position.x, camera.position.z - s.group.position.z) * 0.7 + Math.sin(t * 0.5 + i) * 0.06;
            }
            s.ringMat.opacity = (s.member ? 0.8 : 0.4) + Math.sin(t * 2 + i) * 0.15;
            if (s.burstT < 1) {
                s.burstT = Math.min(1, s.burstT + dt * 1.4);
                s.burst.scale.setScalar(1 + s.burstT * 1.6);
                s.burstMat.opacity = (1 - s.burstT) * 0.9;
            }
        });
        renderLabels();
    }

    function hide() {
        group.visible = false;
        labels.innerHTML = '';
        labelSig = '';
        spots.forEach((s) => {
            if (s.skin && s.skin.dispose) s.skin.dispose();
        });
    }
    function show() {
        group.visible = true;
        labelSig = '';
    }

    return { setMembers, update, resize, hide, show };
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
