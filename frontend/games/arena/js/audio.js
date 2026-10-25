/**
 * Sounds with the Web Audio API: sound files are decoded once and can play
 * many times at once (lots of gunfire) without lag. Distance makes far-away
 * shots quieter. Shotgun and sniper booms are made from filtered noise.
 */
const FILES = ['blaster', 'blaster_repeater', 'enemy_hurt', 'weapon_change', 'jump_a', 'land', 'coin', 'eliminate'];

export function createAudio() {
    let ctx = null;
    let master = null;
    const buffers = {};
    let noiseBuffer = null;
    let muted = false;
    try {
        muted = window.localStorage.getItem('hillel_arena_muted') === '1';
    } catch (e) {
        // ignore
    }

    async function init() {
        if (ctx) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.6;
        master.connect(ctx.destination);
        // white noise for the big guns
        noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        await Promise.all(FILES.map(async (name) => {
            try {
                const res = await fetch(`./sounds/${name}.ogg`);
                buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
            } catch (e) {
                // a missing sound is not a problem
            }
        }));
    }

    function play(name, { volume = 1, rate = 1 } = {}) {
        if (!ctx || muted || !buffers[name]) return;
        // (a sound must never break the game, whatever numbers come in)
        if (!Number.isFinite(volume) || !Number.isFinite(rate) || volume <= 0) return;
        const src = ctx.createBufferSource();
        src.buffer = buffers[name];
        src.playbackRate.value = rate * (0.95 + Math.random() * 0.1);
        const g = ctx.createGain();
        g.gain.value = volume;
        src.connect(g).connect(master);
        src.start();
    }

    function boom({ volume = 1, low = 400, length = 0.35 } = {}) {
        if (!ctx || muted || !noiseBuffer) return;
        if (!Number.isFinite(volume) || !Number.isFinite(low) || !Number.isFinite(length) || volume <= 0) return;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = low;
        const g = ctx.createGain();
        const t = ctx.currentTime;
        g.gain.setValueAtTime(volume, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + length);
        src.connect(filter).connect(g).connect(master);
        src.start(t);
        src.stop(t + length + 0.05);
    }

    // a little rising chime when a chest opens
    function chime() {
        if (!ctx || muted) return;
        const t = ctx.currentTime;
        [523, 659, 784, 1047].forEach((f, i) => {
            const o = ctx.createOscillator();
            o.type = 'triangle';
            o.frequency.value = f;
            const g = ctx.createGain();
            g.gain.setValueAtTime(0, t + i * 0.07);
            g.gain.linearRampToValueAtTime(0.18, t + i * 0.07 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.5);
            o.connect(g).connect(master);
            o.start(t + i * 0.07);
            o.stop(t + i * 0.07 + 0.6);
        });
    }

    return {
        init,
        play,
        chime,
        get muted() {
            return muted;
        },
        toggleMute() {
            muted = !muted;
            try {
                window.localStorage.setItem('hillel_arena_muted', muted ? '1' : '0');
            } catch (e) {
                // ignore
            }
            if (master) master.gain.value = muted ? 0 : 0.6;
            return muted;
        },
        /** a gunshot; distance in world units from the listener */
        shot(sound, pitch, distance = 0) {
            const vol = Math.max(0, 1 - distance / 140) ** 1.6;
            if (vol <= 0.02) return;
            if (sound === 'shotgun') boom({ volume: 0.9 * vol, low: 900, length: 0.4 });
            else if (sound === 'sniper') {
                boom({ volume: 1.0 * vol, low: 600, length: 0.7 });
                play('blaster', { volume: 0.5 * vol, rate: 0.6 });
            } else play(sound === 'repeater' ? 'blaster_repeater' : 'blaster', { volume: 0.55 * vol, rate: pitch });
        },
    };
}
