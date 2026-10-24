/**
 * The lobby before a match: your character and your teammates' characters
 * standing on glowing pads (up to 4), names and "ready" tags over their
 * heads, and a "+" on the empty pads to invite someone.
 */
import * as THREE from 'three';
import { applySkin } from '../../shared/skins.js';

const PAD_X = [-1.25, 1.25, -3.75, 3.75]; // you, then your teammates
const MAX = 4;

function gradientTexture() {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#0a1430');
    g.addColorStop(0.55, '#123a7a');
    g.addColorStop(1, '#0b1d3f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

function floorTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#163a6e';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(120, 200, 255, 0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 256);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(256, i);
        ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(10, 10);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function createLobby({ renderer, gltf, labels }) {
    const scene = new THREE.Scene();
    scene.background = gradientTexture();
    scene.fog = new THREE.Fog(0x0e2a5a, 14, 34);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    // the pads sit a little to the left: the team panel is on the right
    camera.position.set(1.9, 2.3, 10.5);
    camera.lookAt(1.9, 1.25, 0);

    scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x10204a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 6, 8);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fd3ff, 2.0);
    rim.position.set(-4, 3, -6);
    scene.add(rim);

    // a shiny floor with light lines, and glowing strips in the back
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.6, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x58c4ff, transparent: true, opacity: 0.55 });
    for (let i = -6; i <= 6; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 9, 0.08), stripMat);
        s.position.set(i * 2.6, 4.5, -9 - Math.abs(i) * 0.4);
        scene.add(s);
    }

    // the pads
    const pads = PAD_X.map((x) => {
        const g = new THREE.Group();
        g.position.set(x, 0, 0);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.15, 0.22, 40), new THREE.MeshStandardMaterial({ color: 0x1b2f52, metalness: 0.6, roughness: 0.3 }));
        base.position.y = 0.11;
        g.add(base);
        const glowMat = new THREE.MeshBasicMaterial({ color: 0x38d6ff, transparent: true, opacity: 0.85 });
        const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.04, 40), glowMat);
        glow.position.y = 0.24;
        g.add(glow);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0xbff1ff, transparent: true, opacity: 0.9 });
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.035, 8, 48), ringMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.23;
        g.add(ring);
        const beamMat = new THREE.MeshBasicMaterial({ color: 0x38d6ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 3.6, 32, 1, true), beamMat);
        beam.position.y = 2.0;
        g.add(beam);
        scene.add(g);
        return { group: g, glowMat, ringMat, beamMat, member: null, model: null, mixer: null, skin: null, action: null, label: null };
    });

    function makeCharacter(skinId) {
        const model = gltf.scene.clone(true);
        model.scale.setScalar(1.55);
        model.traverse((c) => { if (c.isMesh) c.material = c.material.clone(); });
        const mixer = new THREE.AnimationMixer(model);
        const clips = Object.fromEntries(gltf.animations.map((a) => [a.name, a]));
        const idle = clips.idle ? mixer.clipAction(clips.idle) : null;
        if (idle) idle.play();
        const skin = applySkin({ model, scene, skinId, height: 1.7 });
        return { model, mixer, skin, clips };
    }

    // members: [{ name, ready, skin, me }] - the first one stands in the middle
    function setMembers(members) {
        for (let i = 0; i < MAX; i++) {
            const pad = pads[i];
            const m = members[i] || null;
            const changed = !pad.member !== !m || (m && (pad.member.name !== m.name || pad.member.skin !== m.skin));
            if (changed) {
                if (pad.model) pad.group.remove(pad.model);
                pad.model = null;
                pad.mixer = null;
                pad.skin = null;
                if (m) {
                    const c = makeCharacter(m.skin);
                    c.model.position.y = 0.25;
                    c.model.rotation.y = i === 0 ? 0 : (PAD_X[i] < 0 ? 0.35 : -0.35);
                    pad.group.add(c.model);
                    pad.model = c.model;
                    pad.mixer = c.mixer;
                    pad.skin = c.skin;
                    pad.clips = c.clips;
                }
            }
            // a little jump when someone becomes ready
            if (m && m.ready && pad.member && !pad.member.ready && pad.mixer && pad.clips.jump) {
                const a = pad.mixer.clipAction(pad.clips.jump);
                a.setLoop(THREE.LoopOnce, 1);
                a.reset().play();
            }
            pad.member = m ? { ...m } : null;
            const color = !m ? 0x3a5a8a : m.ready ? 0x4ade80 : 0x38d6ff;
            pad.glowMat.color.setHex(color);
            pad.beamMat.color.setHex(color);
            pad.ringMat.opacity = m ? 0.9 : 0.35;
            pad.beamMat.opacity = m ? 0.16 : 0.05;
        }
        renderLabels(true);
    }

    let w = 1;
    let h = 1;
    function resize(width, height) {
        w = width;
        h = height;
        camera.aspect = width / height;
        // keep all four pads in view on narrow screens
        // keep the pads clear of the team panel on the right (narrower window = shift more)
        const narrow = camera.aspect < 1.2;
        const shift = narrow ? 0 : width < 980 ? 2.6 : 1.9;
        camera.position.set(shift, 2.3, narrow ? 15 : width < 980 ? 11.5 : 10.5);
        camera.lookAt(shift, 1.25, 0);
        camera.updateProjectionMatrix();
    }

    const tmp = new THREE.Vector3();
    function screenPos(i, y) {
        tmp.set(PAD_X[i], y, 0).project(camera);
        return [(tmp.x * 0.5 + 0.5) * w, (-tmp.y * 0.5 + 0.5) * h];
    }

    // name tags and "+" buttons (HTML, so they're crisp and clickable)
    let labelSig = '';
    function renderLabels(force) {
        const sig = pads.map((p) => (p.member ? `${p.member.name}|${p.member.ready}|${p.member.me}|${p.member.leader}` : '+')).join(',') + `|${w}x${h}`;
        if (!force && sig === labelSig) return;
        labelSig = sig;
        labels.innerHTML = '';
        pads.forEach((p, i) => {
            const div = document.createElement('div');
            if (p.member) {
                const [x, y] = screenPos(i, 2.75);
                div.className = 'pad-tag';
                div.style.left = `${x}px`;
                div.style.top = `${y}px`;
                div.innerHTML = `<b>${p.member.leader ? '👑 ' : ''}${escapeHtml(p.member.name)}${p.member.me && p.member.name !== 'את/ה' ? ' (את/ה)' : ''}</b><span class="${p.member.ready ? 'ok' : 'no'}">${p.member.ready ? 'מוכן' : 'לא מוכן'}</span>`;
            } else {
                const [x, y] = screenPos(i, 1.3);
                div.className = 'pad-plus';
                div.style.left = `${x}px`;
                div.style.top = `${y}px`;
                div.innerHTML = '<button type="button" title="הזמנת חבר">+</button>';
                div.querySelector('button').addEventListener('click', () => {
                    const input = document.getElementById('inviteName');
                    if (input) input.focus();
                });
            }
            labels.appendChild(div);
        });
    }

    function update(dt, t) {
        pads.forEach((p, i) => {
            if (p.mixer) p.mixer.update(dt);
            if (p.skin && p.model) p.skin.update(dt, { position: p.group.position, worldVelocity: null, moving: false });
            if (p.model) p.model.rotation.y += Math.sin(t * 0.6 + i) * 0.0015;
            p.ringMat.opacity = (p.member ? 0.75 : 0.3) + Math.sin(t * 2.4 + i) * 0.15;
            p.beamMat.opacity = (p.member ? 0.14 : 0.04) + Math.sin(t * 1.7 + i) * 0.03;
        });
        stripMat.opacity = 0.45 + Math.sin(t * 1.3) * 0.1;
        renderLabels(false);
    }

    function render() {
        renderer.render(scene, camera);
    }

    return { setMembers, update, render, resize, scene, camera };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
