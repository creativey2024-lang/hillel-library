/**
 * The live connection to the library server (WebSocket /api/live): parties,
 * invites, ready, and the messages of a team match. If there is no server
 * (or you're not logged in) the game simply stays in solo mode.
 */
export function createNet() {
    const listeners = {};
    const net = {
        status: 'off', // off | connecting | online | offline
        me: null,
        party: null,
        skin: '',
        replaced: false, // the same user opened the game somewhere else
        on(type, fn) {
            (listeners[type] = listeners[type] || []).push(fn);
        },
        send(msg) {
            if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
        },
        // a game message to the other players in the party (or to one of them)
        relay(data, to) {
            if (ws && ws.readyState === 1) ws.send(JSON.stringify(to ? { type: 'net', data, to } : { type: 'net', data }));
        },
        connect,
    };
    let ws = null;
    let retries = 0;

    function emit(type, msg) {
        (listeners[type] || []).forEach((fn) => fn(msg));
        (listeners['*'] || []).forEach((fn) => fn(msg));
    }

    function connect(skin = net.skin) {
        net.skin = skin || '';
        if (!/^https?:$/.test(window.location.protocol)) {
            net.status = 'offline';
            emit('status', net);
            return;
        }
        net.status = 'connecting';
        emit('status', net);
        try {
            ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/live`);
        } catch (e) {
            net.status = 'offline';
            emit('status', net);
            return;
        }
        ws.onopen = () => {
            retries = 0;
            // this browser tab's own login (the library site keeps it per tab),
            // so another account logged in on another tab doesn't take over here
            let token = '';
            try {
                token = sessionStorage.getItem('hillel_tab_session') || '';
            } catch (err) {
                // storage blocked: the site's cookie is used
            }
            if (token) ws.send(JSON.stringify({ type: 'auth', token }));
            ws.send(JSON.stringify({ type: 'hello', where: 'arena', skin: net.skin }));
        };
        ws.onmessage = (e) => {
            let msg;
            try {
                msg = JSON.parse(e.data);
            } catch (err) {
                return;
            }
            if (msg.type === 'welcome') {
                net.me = msg.username;
                net.status = 'online';
                emit('status', net);
            }
            if (msg.type === 'replaced') net.replaced = true;
            if (msg.type === 'party') net.party = msg.party;
            emit(msg.type, msg);
        };
        ws.onclose = (e) => {
            const was = net.status;
            net.status = 'offline';
            net.party = null;
            emit('status', net);
            // not logged in, or the game was opened elsewhere: don't try again
            if (net.replaced || (e && (e.code === 4001 || e.code === 4002))) return;
            // came online before and dropped: try again a few times
            if (was === 'online' && retries < 5) {
                retries += 1;
                setTimeout(() => connect(), 1500 * retries);
            }
        };
        ws.onerror = () => {};
    }

    return net;
}
