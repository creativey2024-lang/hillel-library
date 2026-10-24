/**
 * Everything drawn on top of the 3D view: health and shield, weapon slots,
 * ammo, healing items, the minimap and the big map, storm timer, players
 * left, kill feed, damage numbers, crosshair and prompts.
 */
import { WEAPONS, RARITIES, AMMO } from './weapons.js';
import { HEALS, isHeal } from './heals.js';
import { itemIcon } from './icons.js';
import { MAP_HALF, POIS } from './world.js';

const $ = (id) => document.getElementById(id);

export function createHud(world) {
    const el = {
        hp: $('hpFill'), hpText: $('hpText'),
        sh: $('shFill'), shText: $('shText'),
        slots: [...document.querySelectorAll('.slot')],
        ammo: $('ammoText'), ammoReserve: $('ammoReserve'), weaponName: $('weaponName'),
        minimap: $('minimap'), bigmap: $('bigmap'), bigmapWrap: $('bigmapWrap'),
        alive: $('aliveCount'), kills: $('killCount'), coins: $('coinCount'),
        storm: $('stormText'), stormBox: $('stormBox'),
        feed: $('killFeed'),
        prompt: $('prompt'),
        progress: $('progress'), progressFill: $('progressFill'), progressText: $('progressText'),
        crosshair: $('crosshair'), hitmarker: $('hitmarker'),
        numbers: $('damageNumbers'),
        message: $('bigMessage'),
        location: $('locationText'),
        stormTint: $('stormTint'),
        scope: $('scope'),
        hurt: $('hurtFlash'),
        speed: $('speedLines'),
    };
    const mm = el.minimap.getContext('2d');
    // only touch the page when something really changed (cheap HUD = smooth game)
    const last = {};
    function setText(node, key, value) {
        if (last[key] === value) return;
        last[key] = value;
        node.textContent = value;
    }
    function setStyle(node, key, prop, value) {
        if (last[key] === value) return;
        last[key] = value;
        node.style.setProperty(prop, value);
    }
    const bm = el.bigmap.getContext('2d');
    let mates = []; // teammates to show on the maps

    function setBars(actor) {
        setStyle(el.hp, 'hpW', 'width', `${Math.ceil(actor.hp)}%`);
        setText(el.hpText, 'hpT', Math.ceil(actor.hp));
        setStyle(el.sh, 'shW', 'width', `${Math.ceil(actor.shield)}%`);
        setText(el.shText, 'shT', Math.ceil(actor.shield));
    }

    function setSlots(actor) {
        const sig = JSON.stringify([actor.current, actor.slots, actor.ammo]);
        if (last.slots === sig) return;
        last.slots = sig;
        el.slots.forEach((s, i) => {
            const it = actor.slots[i];
            const heal = isHeal(it);
            s.classList.toggle('active', i === actor.current);
            s.classList.toggle('is-heal', heal);
            s.style.setProperty('--rarity', it && !heal ? RARITIES[it.rarity].color : heal ? '#0f766e' : 'transparent');
            const name = !it ? '' : heal ? HEALS[it.heal].name : `${WEAPONS[it.kind].name} ${RARITIES[it.rarity].name}`;
            // a little picture of the item instead of its name (the name shows on hover)
            const url = itemIcon(it);
            const img = s.querySelector('.slot-img');
            if (url) {
                if (img.getAttribute('src') !== url) img.src = url;
                img.alt = name;
            }
            s.classList.toggle('has-icon', Boolean(url));
            s.title = name;
            s.querySelector('.slot-name').textContent = url ? '' : name;
            s.querySelector('.slot-ammo').textContent = !it ? '' : heal ? `×${it.count}` : it.ammoInMag;
            s.querySelector('.slot-ico').className = `slot-ico${heal && !url ? ` ico ${HEALS[it.heal].icon}` : ''}`;
            s.classList.toggle('empty', !it);
        });
        const it = actor.slots[actor.current];
        if (isHeal(it)) {
            el.weaponName.textContent = `${HEALS[it.heal].name} · לחצו ירי כדי להשתמש`;
            el.weaponName.style.color = '#5eead4';
            el.ammo.textContent = `×${it.count}`;
            el.ammoReserve.textContent = '';
        } else if (it) {
            const def = WEAPONS[it.kind];
            el.weaponName.textContent = `${def.name} · ${RARITIES[it.rarity].name}`;
            el.weaponName.style.color = RARITIES[it.rarity].color;
            el.ammo.textContent = it.ammoInMag;
            el.ammoReserve.textContent = actor.ammo[def.ammo];
            el.ammoReserve.title = AMMO[def.ammo].name;
        } else {
            el.weaponName.textContent = 'ידיים ריקות';
            el.weaponName.style.color = '#e2e8f0';
            el.ammo.textContent = '–';
            el.ammoReserve.textContent = '';
        }
    }

    function worldToMap(x, z, cx, cz, scale, size) {
        return [size / 2 + (x - cx) * scale, size / 2 + (z - cz) * scale];
    }

    function drawMap(ctx, size, cx, cz, viewHalf, player, storm, rotate) {
        const scale = size / (viewHalf * 2);
        ctx.save();
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = '#1d5f9a';
        ctx.fillRect(0, 0, size, size);
        // the island picture
        const img = world.minimap;
        const imgScale = img.width / (MAP_HALF * 2);
        const sx = (cx - viewHalf + MAP_HALF) * imgScale;
        const sz = (cz - viewHalf + MAP_HALF) * imgScale;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(img, sx, sz, viewHalf * 2 * imgScale, viewHalf * 2 * imgScale, 0, 0, size, size);
        // storm: shade outside the circle, white ring for the next one
        const st = storm.state;
        const [scx, scz] = worldToMap(st.center.x, st.center.y, cx, cz, scale, size);
        ctx.fillStyle = 'rgba(126, 34, 206, 0.45)';
        ctx.beginPath();
        ctx.rect(0, 0, size, size);
        ctx.arc(scx, scz, Math.max(0, st.radius * scale), 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(216, 180, 254, 0.95)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(scx, scz, Math.max(0, st.radius * scale), 0, Math.PI * 2);
        ctx.stroke();
        const [ncx, ncz] = worldToMap(st.next.center.x, st.next.center.y, cx, cz, scale, size);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(ncx, ncz, Math.max(0, st.next.radius * scale), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        // teammates: coloured dots with a white edge
        for (const m of mates) {
            if (!m.alive || !m.netSeen) continue;
            const [mx, mz] = worldToMap(m.pos.x, m.pos.z, cx, cz, scale, size);
            ctx.fillStyle = '#fde047';
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(mx, mz, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }
        // the player arrow
        const [px, pz] = worldToMap(player.pos.x, player.pos.z, cx, cz, scale, size);
        ctx.translate(px, pz);
        ctx.rotate(-player.yaw + Math.PI);
        ctx.fillStyle = '#facc15';
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(6, 7);
        ctx.lineTo(0, 3);
        ctx.lineTo(-6, 7);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }

    function drawBigMap(player, storm) {
        const size = el.bigmap.width;
        drawMap(bm, size, 0, 0, MAP_HALF, player, storm);
        const scale = size / (MAP_HALF * 2);
        bm.font = 'bold 15px system-ui, Arial';
        bm.textAlign = 'center';
        POIS.forEach((p) => {
            const [x, y] = worldToMap(p.x, p.z, 0, 0, scale, size);
            bm.lineWidth = 4;
            bm.strokeStyle = 'rgba(15,23,42,0.85)';
            bm.strokeText(p.name, x, y);
            bm.fillStyle = '#fff';
            bm.fillText(p.name, x, y);
        });
    }

    let feedItems = [];
    function feed(html) {
        const div = document.createElement('div');
        div.className = 'feed-item';
        div.innerHTML = html;
        el.feed.prepend(div);
        feedItems.push(div);
        if (feedItems.length > 6) feedItems.shift().remove();
        setTimeout(() => {
            div.classList.add('fade');
            setTimeout(() => {
                div.remove();
                feedItems = feedItems.filter((d) => d !== div);
            }, 600);
        }, 6000);
    }

    let messageTimer = null;
    function message(text, kind = '') {
        el.message.textContent = text;
        el.message.className = `big-message show ${kind}`;
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => { el.message.className = 'big-message'; }, 2600);
    }

    let locationTimer = null;
    function location(name) {
        el.location.textContent = name;
        el.location.classList.add('show');
        clearTimeout(locationTimer);
        locationTimer = setTimeout(() => el.location.classList.remove('show'), 2800);
    }

    // floating damage numbers at the hit spot (yellow for headshots, blue on shields)
    const numbers = [];
    function damageNumber(pos, amount, head, shield) {
        const div = document.createElement('div');
        div.className = `dmg${head ? ' head' : ''}${shield ? ' shield' : ''}`;
        div.textContent = Math.round(amount);
        el.numbers.appendChild(div);
        numbers.push({ div, pos: pos.clone(), t: 0, dx: (Math.random() - 0.5) * 30 });
    }

    // a small floating label in the world (like "+3" over a coin)
    function floatText(pos, text, cls = '') {
        const div = document.createElement('div');
        div.className = `dmg ${cls}`;
        div.textContent = text;
        el.numbers.appendChild(div);
        numbers.push({ div, pos: pos.clone(), t: 0, dx: 0 });
    }

    function updateNumbers(dt, camera, width, height) {
        for (let i = numbers.length - 1; i >= 0; i--) {
            const n = numbers[i];
            n.t += dt;
            if (n.t > 0.9) {
                n.div.remove();
                numbers.splice(i, 1);
                continue;
            }
            const p = n.pos.clone().project(camera);
            if (p.z > 1) {
                n.div.style.display = 'none';
                continue;
            }
            n.div.style.display = '';
            const x = (p.x * 0.5 + 0.5) * width + n.dx * n.t;
            const y = (-p.y * 0.5 + 0.5) * height - n.t * 50;
            n.div.style.transform = `translate(${x}px, ${y}px) scale(${1 + Math.max(0, 0.3 - n.t)})`;
            n.div.style.opacity = n.t > 0.6 ? (0.9 - n.t) / 0.3 : 1;
        }
    }

    let hitTimer = null;
    function hitmarker(head, kill) {
        el.hitmarker.className = `hitmarker show${head ? ' head' : ''}${kill ? ' kill' : ''}`;
        clearTimeout(hitTimer);
        hitTimer = setTimeout(() => { el.hitmarker.className = 'hitmarker'; }, 160);
    }

    function hurt() {
        el.hurt.classList.remove('show');
        void el.hurt.offsetWidth;
        el.hurt.classList.add('show');
    }

    return {
        setBars,
        setSlots,
        feed,
        message,
        location,
        damageNumber,
        floatText,
        speedLines(v) {
            const q = Math.round(v * 20) / 20;
            setStyle(el.speed, 'speed', 'opacity', String(q));
        },
        hitmarker,
        hurt,
        prompt(text) {
            if (last.prompt === text) return;
            last.prompt = text;
            el.prompt.classList.toggle('hidden', !text);
            if (text) el.prompt.innerHTML = text;
        },
        progress(fraction, text) {
            const show = fraction !== null;
            if (last.progressShow !== show) {
                last.progressShow = show;
                el.progress.classList.toggle('hidden', !show);
            }
            if (show) {
                setStyle(el.progressFill, 'progW', 'width', `${Math.round(Math.min(1, fraction) * 100)}%`);
                setText(el.progressText, 'progT', text);
            }
        },
        stats(alive, kills, coins) {
            setText(el.alive, 'alive', alive);
            setText(el.kills, 'kills', kills);
            setText(el.coins, 'coins', coins);
        },
        storm(status, outside) {
            const m = Math.floor(status.timeLeft / 60);
            const s = Math.floor(status.timeLeft % 60).toString().padStart(2, '0');
            let text;
            if (status.over) text = 'הסערה בגודל הסופי';
            else text = status.stage === 'wait' ? `הסערה תתכווץ בעוד ${m}:${s}` : `הסערה מתכווצת! ${m}:${s}`;
            setText(el.storm, 'storm', text);
            const shrinking = status.stage === 'shrink';
            if (last.shrinking !== shrinking) {
                last.shrinking = shrinking;
                el.stormBox.classList.toggle('shrinking', shrinking);
            }
            if (last.outside !== outside) {
                last.outside = outside;
                el.stormTint.classList.toggle('show', outside);
            }
        },
        crosshair(kind, aiming, spreadPx) {
            const cls = `crosshair ${kind || 'none'}${aiming ? ' aiming' : ''}`;
            if (last.cross !== cls) {
                last.cross = cls;
                el.crosshair.className = cls;
            }
            setStyle(el.crosshair, 'gap', '--gap', `${Math.round(spreadPx)}px`);
        },
        scope(on) {
            if (last.scope === on) return;
            last.scope = on;
            el.scope.classList.toggle('hidden', !on);
        },
        minimap(player, storm, teammates = []) {
            mates = teammates;
            drawMap(mm, el.minimap.width, player.pos.x, player.pos.z, 55, player, storm);
        },
        bigMap(show, player, storm) {
            if (last.big !== show) {
                last.big = show;
                el.bigmapWrap.classList.toggle('hidden', !show);
            }
            if (show) drawBigMap(player, storm);
        },
        updateNumbers,
    };
}
