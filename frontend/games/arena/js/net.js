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
            net.status = 'online';
            ws.send(JSON.stringify({ type: 'hello', where: 'arena', skin: net.skin }));
            emit('status', net);
        };
        ws.onmessage = (e) => {
            let msg;
            try {
                msg = JSON.parse(e.data);
            } catch (err) {
                return;
            }
            if (msg.type === 'welcome') net.me = msg.username;
            if (msg.type === 'party') net.party = msg.party;
            emit(msg.type, msg);
        };
        ws.onclose = () => {
            const was = net.status;
            net.status = 'offline';
            emit('status', net);
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
