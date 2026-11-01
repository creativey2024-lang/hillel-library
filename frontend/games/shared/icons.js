/**
 * One clear set of icons for all the games (drawn in code, no image files):
 * coins, kills, players, power-ups, the storm, grenades, upgrades...
 * Each icon is made of a few coloured layers on a 24x24 grid, so the same
 * drawing works as inline SVG in the HUD and on a canvas (3D badges).
 *
 * In HTML: <i class="gi" data-icon="coin"></i> and call fillIcons().
 */

// layer: { d: SVG path, f: fill, s: stroke, w: stroke width } or { t: text, f, x, y, size }
export const ICONS = {
    coin: [
        { d: 'M12 1.5a10.5 10.5 0 1 0 0 21a10.5 10.5 0 1 0 0-21z', f: '#b45309' },
        { d: 'M12 2.6a9.4 9.4 0 1 0 0 18.8a9.4 9.4 0 1 0 0-18.8z', f: '#f59e0b' },
        { d: 'M12 4.6a7.4 7.4 0 1 0 0 14.8a7.4 7.4 0 1 0 0-14.8z', f: '#fcd34d' },
        { d: 'M12 6.6l1.65 3.35 3.7.54-2.68 2.6.63 3.68L12 15.03l-3.3 1.74.63-3.68-2.68-2.6 3.7-.54z', f: '#d97706' },
        { d: 'M8.2 6.6a6 6 0 0 1 3.8-1.3', s: '#fff7d6', w: 1.2 },
    ],
    // two coins with "x2": double coins
    coins2: [
        { d: 'M15 2a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15z', f: '#b45309' },
        { d: 'M15 3a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z', f: '#fbbf24' },
        { d: 'M9 7a7.5 7.5 0 1 0 0 15a7.5 7.5 0 1 0 0-15z', f: '#b45309' },
        { d: 'M9 8a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z', f: '#fcd34d' },
        { t: '×2', f: '#7c2d12', x: 9, y: 15.2, size: 8.5 },
    ],
    skull: [
        { d: 'M12 2C7.1 2 3.5 5.6 3.5 10.3c0 2.7 1.2 4.8 3.2 6v3.2c0 .9.7 1.5 1.5 1.5h7.6c.8 0 1.5-.6 1.5-1.5v-3.2c2-1.2 3.2-3.3 3.2-6C20.5 5.6 16.9 2 12 2z', f: '#f8fafc' },
        { d: 'M8.6 9.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4zM15.4 9.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4z', f: '#0f172a' },
        { d: 'M12 13.4l-1.2 2.1h2.4z', f: '#0f172a' },
        { d: 'M10.2 18.2v2.6M12 18.2v2.6M13.8 18.2v2.6', s: '#64748b', w: 1 },
    ],
    // a crosshair (for kills in a shooter)
    target: [
        { d: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', s: '#fca5a5', w: 2 },
        { d: 'M12 1v6M12 17v6M1 12h6M17 12h6', s: '#f8fafc', w: 2 },
        { d: 'M12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z', f: '#ef4444' },
    ],
    person: [
        { d: 'M12 2.5a4.3 4.3 0 1 0 0 8.6a4.3 4.3 0 1 0 0-8.6z', f: '#f8fafc' },
        { d: 'M3.5 21.5c0-4.6 3.8-8 8.5-8s8.5 3.4 8.5 8z', f: '#f8fafc' },
    ],
    people: [
        { d: 'M8.5 3.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM16.5 4.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z', f: '#f8fafc' },
        { d: 'M1.5 20c0-4 3.1-7 7-7s7 3 7 7zM14.6 12.6c4.2-.6 7.9 2.2 7.9 6.4h-5.6c0-2.6-.9-4.8-2.3-6.4z', f: '#f8fafc' },
    ],
    // a winged sneaker: jump shoes
    shoes: [
        { d: 'M3 8.5C1 7 1 4.5 2 3c.7 1.7 2.2 2.8 4 3.1M3.6 10.6C2 9.6 1.6 8 2.1 6.7', s: '#f8fafc', w: 1.4 },
        { d: 'M4.5 16.2l1.3-6.4c.2-.8.9-1.3 1.7-1.3h2.2l1.5 2.6c.5.9 1.6 1.3 2.6.9l1.4-.5 5.2 2.3c1.1.5 1.8 1.6 1.8 2.8v.6z', f: '#f8fafc' },
        { d: 'M4.3 16.2h17.9v2.2c0 .7-.6 1.3-1.3 1.3H5.6c-.7 0-1.3-.6-1.3-1.3z', f: '#14532d' },
        { d: 'M10 12.6l1.4-.6M12 14l1.4-.6', s: '#16a34a', w: 1.2 },
    ],
    magnet: [
        { d: 'M4.5 3h5v8.5a2.5 2.5 0 0 0 5 0V3h5v8.5a7.5 7.5 0 0 1-15 0z', f: '#ef4444' },
        { d: 'M4.5 3h5v3.6h-5zM14.5 3h5v3.6h-5z', f: '#e2e8f0' },
        { d: 'M6 11.6a6 6 0 0 0 3 4.6', s: '#fecaca', w: 1.2 },
        { d: 'M2 21l2-2M22 21l-2-2M12 23v-2.5', s: '#fde047', w: 1.6 },
    ],
    // a little person with two arrows up: double jump
    double: [
        { d: 'M6.5 11.5l5.5-5 5.5 5', s: '#f8fafc', w: 2.6 },
        { d: 'M6.5 5.5l5.5-5 5.5 5', s: '#bfdbfe', w: 2.6 },
        { d: 'M12 13.5a2.1 2.1 0 1 0 0 4.2a2.1 2.1 0 1 0 0-4.2zM8.8 23c0-2.4 1.4-4 3.2-4s3.2 1.6 3.2 4z', f: '#f8fafc' },
    ],
    shield: [
        { d: 'M12 1.8l8.5 3.2v6.3c0 5.2-3.6 9.7-8.5 11-4.9-1.3-8.5-5.8-8.5-11V5z', f: '#f8fafc' },
        { d: 'M12 4.3l6 2.3v4.7c0 3.9-2.5 7.3-6 8.5z', f: '#a855f7' },
        { d: 'M8 11.8l2.8 2.8 5.4-5.6', s: '#4c1d95', w: 2.2 },
    ],
    rocket: [
        { d: 'M7.2 15.3c-2.2.3-3.6 2.4-4.2 6.2 3.8-.6 5.9-2 6.2-4.2z', f: '#fde047' },
        { d: 'M7.8 15.6c-1 .3-1.8 1.4-2.2 3.2 1.8-.4 2.9-1.2 3.2-2.2z', f: '#f97316' },
        { d: 'M14 3.5c3.4-1.9 6.5-1.5 6.5-1.5s.4 3.1-1.5 6.5l-7.2 7.2-5-5z', f: '#f8fafc' },
        { d: 'M15.6 6.2a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4z', f: '#38bdf8' },
        { d: 'M6.8 10.7l-3.6.6 2.6-3.2 3.6-.3zM13.3 17.2l-.6 3.6 3.2-2.6.3-3.6z', f: '#ef4444' },
    ],
    storm: [
        { d: 'M6.5 15.5a4.5 4.5 0 0 1-.4-9 6 6 0 0 1 11.3 1.2 3.9 3.9 0 0 1 .1 7.8z', f: '#c4b5fd' },
        { d: 'M12.5 13l-3.5 5.2h3l-1.2 4.8 4.7-6.5h-3.1l1.3-3.5z', f: '#fde047' },
    ],
    grenade: [
        { d: 'M12 7.5a7.3 7.3 0 1 0 0 14.6a7.3 7.3 0 1 0 0-14.6z', f: '#3f6212' },
        { d: 'M5 14.8h14M12 7.5v14.6', s: '#65a30d', w: 1.3 },
        { d: 'M9.5 4.2h5v3.7h-5z', f: '#94a3b8' },
        { d: 'M14.5 5l4.3 2.5', s: '#cbd5e1', w: 1.6 },
        { d: 'M8.2 3.3a2 2 0 1 0 0 .01', s: '#facc15', w: 1.4 },
        { d: 'M8.6 10.6a4 4 0 0 0-2 2.6', s: '#a3e635', w: 1.2 },
    ],
    // an arrow up in a gold badge: upgrade
    upgrade: [
        { d: 'M12 1.5l9 4v7c0 5-3.9 9-9 10-5.1-1-9-5-9-10v-7z', f: '#b45309' },
        { d: 'M12 3.2l7.4 3.3v6c0 4.2-3.2 7.6-7.4 8.5-4.2-.9-7.4-4.3-7.4-8.5v-6z', f: '#fbbf24' },
        { d: 'M12 6.5l5 5.2h-3.1v5.3h-3.8v-5.3H7z', f: '#fff7d6' },
    ],
    book: [
        { d: 'M1.5 5.2c3.4-1.3 7-1 10.2.9v14.6c-3.2-1.8-6.8-2.1-10.2-.9z', f: '#fde68a' },
        { d: 'M22.5 5.2c-3.4-1.3-7-1-10.2.9v14.6c3.2-1.8 6.8-2.1 10.2-.9z', f: '#fcd34d' },
        { d: 'M4 8.6c2-.4 3.9-.2 5.6.6M4 11.4c2-.4 3.9-.2 5.6.6M4 14.2c2-.4 3.9-.2 5.6.6M14.4 9.2c1.7-.8 3.6-1 5.6-.6M14.4 12c1.7-.8 3.6-1 5.6-.6', s: '#b45309', w: 0.9 },
        { d: 'M11.7 6.1v14.6h.6V6.1z', f: '#92400e' },
    ],
    heart: [
        { d: 'M12 21.2s-8.7-5.2-8.7-11.3c0-2.9 2.2-5.1 4.9-5.1 1.6 0 3 .8 3.8 2.1.8-1.3 2.2-2.1 3.8-2.1 2.7 0 4.9 2.2 4.9 5.1 0 6.1-8.7 11.3-8.7 11.3z', f: '#ef4444' },
        { d: 'M6.4 8.3c.5-1 1.4-1.6 2.4-1.6', s: '#fecaca', w: 1.3 },
    ],
    trophy: [
        { d: 'M7 2.5h10v6.5a5 5 0 0 1-10 0z', f: '#fbbf24' },
        { d: 'M7 4.5H3.5c0 3.3 1.7 5.4 4.2 5.8M17 4.5h3.5c0 3.3-1.7 5.4-4.2 5.8', s: '#f59e0b', w: 1.6 },
        { d: 'M10.5 13.6h3v3.6h-3zM7.5 17.2h9v3.8h-9z', f: '#b45309' },
        { d: 'M9.5 4.5v4a2.5 2.5 0 0 0 1.5 2.3', s: '#fff7d6', w: 1.2 },
    ],
    star: [
        { d: 'M12 1.8l3 6.2 6.8.9-4.9 4.8 1.2 6.8L12 17.3l-6.1 3.2 1.2-6.8-4.9-4.8L9 8z', f: '#facc15' },
        { d: 'M12 5.6l1.8 3.7', s: '#fff7d6', w: 1.3 },
    ],
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The icon as an inline SVG string. */
export function iconSVG(name, size = 20, label = '') {
    const layers = ICONS[name];
    if (!layers) return '';
    const body = layers.map((l) => {
        if (l.t) return `<text x="${l.x}" y="${l.y}" font-size="${l.size}" font-weight="900" font-family="system-ui,Arial,sans-serif" text-anchor="middle" fill="${l.f}">${esc(l.t)}</text>`;
        if (l.s) return `<path d="${l.d}" fill="none" stroke="${l.s}" stroke-width="${l.w || 1.5}" stroke-linecap="round" stroke-linejoin="round"/>`;
        return `<path d="${l.d}" fill="${l.f}"/>`;
    }).join('');
    const aria = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" ${aria} style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))">${body}</svg>`;
}

const pathCache = new Map();
const path2d = (d) => {
    if (!pathCache.has(d)) pathCache.set(d, new Path2D(d));
    return pathCache.get(d);
};

/** Draw the icon on a canvas (x, y = top-left corner). */
export function drawIcon(ctx, name, x, y, size) {
    const layers = ICONS[name];
    if (!layers) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const l of layers) {
        if (l.t) {
            ctx.fillStyle = l.f;
            ctx.font = `900 ${l.size}px system-ui, Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(l.t, l.x, l.y);
        } else if (l.s) {
            ctx.strokeStyle = l.s;
            ctx.lineWidth = l.w || 1.5;
            ctx.stroke(path2d(l.d));
        } else {
            ctx.fillStyle = l.f;
            ctx.fill(path2d(l.d));
        }
    }
    ctx.restore();
}

/** Fill every <i data-icon="name"> on the page with its icon. */
export function fillIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
        if (el.dataset.filled === el.dataset.icon) return;
        const size = Number(el.dataset.size) || 20;
        el.innerHTML = iconSVG(el.dataset.icon, size, el.getAttribute('title') || '');
        el.dataset.filled = el.dataset.icon;
        el.style.display = 'inline-flex';
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.background = 'none';
        el.style.boxShadow = 'none';
        el.style.borderRadius = '0';
        el.style.flex = 'none';
    });
}
