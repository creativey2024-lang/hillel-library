/**
 * Talks to the library site that shows the game in its "משחק" window:
 *   game -> site: { type: 'run-start', game }      a run began
 *                 { type: 'run-end', game, coins } a run ended with this many coins
 *   site -> game: { type: 'run-saved', earned, coins, limitedByDay, dailyLeft }
 * The site sends the run to the server, which decides how many coins really
 * count (see backend/src/routes/games.js). Opened on its own (not inside the
 * site), the game just works without saving coins.
 */
export function createBridge(game, { getRunCoins, onSaved } = {}) {
    const embedded = window.parent && window.parent !== window;
    let active = false;

    function send(msg) {
        if (!embedded) return;
        try {
            window.parent.postMessage(msg, window.location.origin);
        } catch (e) {
            // ignore
        }
    }

    window.addEventListener('message', (e) => {
        if (e.origin !== window.location.origin) return;
        if (e.data && e.data.type === 'run-saved' && onSaved) onSaved(e.data);
    });

    // closing the window or going back to the game list mid-run still saves the coins
    window.addEventListener('pagehide', () => {
        if (active) runEnded(getRunCoins ? getRunCoins() : 0);
    });

    function runStarted() {
        active = true;
        send({ type: 'run-start', game });
    }

    function runEnded(coins) {
        if (!active) return;
        active = false;
        send({ type: 'run-end', game, coins: Math.max(0, Math.floor(coins || 0)) });
    }

    return { embedded, runStarted, runEnded, isActive: () => active };
}
