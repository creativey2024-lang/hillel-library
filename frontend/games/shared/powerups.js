/**
 * Power-up items shared by both games: how they look in the world (a glowing
 * badge with an icon inside a spinning ring) and the little timer badges in
 * the corner of the screen. Icons are drawn on a canvas, so no image files.
 */
import * as THREE from 'three';
import { drawIcon } from './icons.js';

export const POWERUPS = {
    shoes: { label: 'נעלי קפיצה', color: '#22c55e', seconds: 10 },
    magnet: { label: 'מגנט', color: '#ef4444', seconds: 10 },
    x2: { label: 'מטבעות כפול', color: '#f59e0b', seconds: 12 },
    double: { label: 'קפיצה כפולה', color: '#3b82f6', seconds: 12 },
    shield: { label: 'מגן', color: '#a855f7', seconds: 0 }, // lasts until it saves you once
    jetpack: { label: 'רקטה', color: '#f97316', seconds: 5 },
};

// which picture from the shared icon set (shared/icons.js) each power-up uses
const ICON_OF = { shoes: 'shoes', magnet: 'magnet', x2: 'coins2', double: 'double', shield: 'shield', jetpack: 'rocket' };

const iconCache = {};

/** A canvas with the icon on a coloured disc (used for the world badge and the HUD). */
export function iconCanvas(kind, size = 128) {
    const key = `${kind}:${size}`;
    if (iconCache[key]) return iconCache[key];
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c = size / 2;
    const def = POWERUPS[kind];
    // a coloured rim around a dark disc, so every picture stands out
    const rim = ctx.createLinearGradient(0, 0, 0, size);
    rim.addColorStop(0, shade(def.color, 0.35));
    rim.addColorStop(1, shade(def.color, -0.3));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.96, 0, Math.PI * 2);
    ctx.fill();
    const inner = ctx.createRadialGradient(c, c * 0.7, size * 0.05, c, c, c * 0.8);
    inner.addColorStop(0, '#334155');
    inner.addColorStop(1, '#0b1120');
    ctx.fillStyle = inner;
    ctx.beginPath();
    ctx.arc(c, c, c * 0.78, 0, Math.PI * 2);
    ctx.fill();
    // a soft shine on top
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.ellipse(c, c * 0.55, c * 0.55, c * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, ICON_OF[kind] || 'star', size * 0.2, size * 0.2, size * 0.6);
    iconCache[key] = canvas;
    return canvas;
}

function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(amount > 0 ? v + (255 - v) * amount : v + v * amount)));
    return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
}

let glowTex = null;
function glowTexture() {
    if (glowTex) return glowTex;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(canvas);
    return glowTex;
}

/** The floating item in the world. Call item.userData.animate(time) every frame. */
export function createPowerupMesh(kind, size = 1) {
    const group = new THREE.Group();
    const tex = new THREE.CanvasTexture(iconCanvas(kind));
    tex.colorSpace = THREE.SRGBColorSpace;

    const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
    icon.scale.setScalar(0.9 * size);
    group.add(icon);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture(), color: POWERUPS[kind].color, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    }));
    glow.scale.setScalar(1.9 * size);
    group.add(glow);

    const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.62 * size, 0.05 * size, 8, 40),
        new THREE.MeshBasicMaterial({ color: POWERUPS[kind].color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    group.add(ring);

    group.userData.kind = kind;
    group.userData.animate = (t) => {
        ring.rotation.y = t * 2.4;
        ring.rotation.x = Math.sin(t * 1.7) * 0.5;
        glow.material.opacity = 0.6 + Math.sin(t * 5) * 0.2;
        icon.position.y = Math.sin(t * 3) * 0.08;
    };
    return group;
}

/** Timer badges in the corner of the screen. */
export function createPowerupHud(parent) {
    const style = document.createElement('style');
    style.textContent = `
        .pu-hud { position:absolute; top:56px; right:10px; display:flex; flex-direction:column; gap:6px; z-index:5; pointer-events:none; }
        .pu-item { display:flex; align-items:center; gap:8px; background:rgba(15,23,42,0.55); color:#fff; border-radius:999px;
            padding:4px 12px 4px 4px; font:700 13px system-ui, Arial, sans-serif; backdrop-filter:blur(4px); direction:rtl;
            animation: pu-pop .25s ease; }
        .pu-item canvas { width:28px; height:28px; border-radius:50%; }
        .pu-bar { width:56px; height:5px; border-radius:3px; background:rgba(255,255,255,0.25); overflow:hidden; }
        .pu-bar i { display:block; height:100%; background:#fff; border-radius:3px; }
        .pu-item.ending { animation: pu-blink .4s steps(2) infinite; }
        @keyframes pu-pop { from { transform:scale(.6); opacity:0 } to { transform:scale(1); opacity:1 } }
        @keyframes pu-blink { 50% { opacity:.4 } }
    `;
    document.head.appendChild(style);
    const box = document.createElement('div');
    box.className = 'pu-hud';
    parent.appendChild(box);
    const items = {};

    return {
        // remaining / total in seconds; total 0 = "until used" (no bar)
        set(kind, remaining, total) {
            let el = items[kind];
            if (!el) {
                el = document.createElement('div');
                el.className = 'pu-item';
                const icon = document.createElement('canvas');
                icon.width = 56;
                icon.height = 56;
                icon.getContext('2d').drawImage(iconCanvas(kind), 0, 0, 56, 56);
                const label = document.createElement('span');
                label.textContent = POWERUPS[kind].label;
                el.append(icon, label);
                if (total > 0) {
                    const bar = document.createElement('div');
                    bar.className = 'pu-bar';
                    bar.appendChild(document.createElement('i'));
                    el.appendChild(bar);
                }
                box.appendChild(el);
                items[kind] = el;
            }
            if (total > 0) {
                el.querySelector('.pu-bar i').style.width = `${Math.max(0, Math.min(1, remaining / total)) * 100}%`;
                el.classList.toggle('ending', remaining < 2);
            }
        },
        remove(kind) {
            if (items[kind]) {
                items[kind].remove();
                delete items[kind];
            }
        },
        clear() {
            Object.keys(items).forEach((k) => this.remove(k));
        },
    };
}

/** A list on the start screen: each power-up's badge, its name and what it does. */
export function renderPowerLegend(el, list) {
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('pu-legend');
    const style = document.createElement('style');
    style.textContent = `
        .pu-legend { list-style:none; display:grid; grid-template-columns:1fr 1fr; gap:6px 10px; padding-top:6px; }
        .pu-legend .pu-row { display:flex; align-items:center; gap:7px; text-align:right; line-height:1.25; }
        .pu-legend canvas { width:30px; height:30px; flex:none; }
        .pu-legend b { display:block; font-size:12.5px; }
        .pu-legend small { display:block; font-size:11px; opacity:.8; }
        @media (max-width:520px) { .pu-legend { grid-template-columns:1fr; } }
    `;
    el.appendChild(style);
    for (const [kind, text] of list) {
        const row = document.createElement('div');
        row.className = 'pu-row';
        const c = document.createElement('canvas');
        c.width = 60;
        c.height = 60;
        c.getContext('2d').drawImage(iconCanvas(kind), 0, 0, 60, 60);
        const t = document.createElement('div');
        t.innerHTML = `<b style="color:${POWERUPS[kind].color}">${POWERUPS[kind].label}</b><small>${text}</small>`;
        row.append(c, t);
        el.appendChild(row);
    }
}
