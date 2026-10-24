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
        return res.sendFile(filePath);
      }
      return res.sendFile(indexFile);
    });
  };
}

module.exports = staticMiddleware;
