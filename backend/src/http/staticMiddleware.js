const fs = require('fs');
const path = require('path');

// Serves the frontend/ folder as static files, with an index.html fallback for
// any GET request that isn't an API call and doesn't match a real file
// (keeps the single-page app working no matter what path is opened).
function staticMiddleware(rootDir) {
  const indexFile = path.join(rootDir, 'index.html');

  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api/')) return next();

    const safePath = path.normalize(req.path).replace(/^(\.\.[/\\])+/, '');
    const requestedPath = safePath === '/' ? '/index.html' : safePath;
    const filePath = path.join(rootDir, requestedPath);

    if (!filePath.startsWith(rootDir)) {
      return next();
    }

    fs.stat(filePath, (err, stat) => {
      if (!err && stat.isFile()) {
        // Browsers check back for a newer copy every time (and get a quick
        // "304 not changed" if there isn't one), so after an update nobody
        // ends up with old and new game files mixed together.
        const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
        if (req.headers['if-none-match'] === etag) {
          res.statusCode = 304;
          return res.end();
        }
        return res.sendFile(filePath);
      }
      // A missing file (like /games/x/game.js) is a real "not found" - sending
      // the site's page instead would break the game in a confusing way.
      if (path.extname(requestedPath)) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        return res.end('קובץ לא נמצא');
      }
      return res.sendFile(indexFile);
    });
  };
}

module.exports = staticMiddleware;
