const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { parseCookies } = require('../util/cookies');

// A tiny, dependency-free HTTP router/app in the style of Express, so the whole
// backend can run with plain `node server.js` - no `npm install` required.
// Supports: app.use(middleware), app.use('/prefix', router), req.params/query/body/cookies,
// res.status().json()/.send()/.sendFile().

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function compilePattern(pattern) {
  const keys = [];
  const regexStr = pattern
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      if (segment === '*') {
        return '.*';
      }
      return segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp(`^${regexStr}$`), keys };
}

class Router {
  constructor() {
    this.routes = [];
  }

  _add(method, pattern, handlers) {
    const { regex, keys } = compilePattern(pattern);
    this.routes.push({ method, regex, keys, handlers });
  }

  get(pattern, ...handlers) {
    this._add('GET', pattern, handlers);
  }

  post(pattern, ...handlers) {
    this._add('POST', pattern, handlers);
  }

  patch(pattern, ...handlers) {
    this._add('PATCH', pattern, handlers);
  }

  delete(pattern, ...handlers) {
    this._add('DELETE', pattern, handlers);
  }
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 5_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: 'הנתיב המבוקש לא נמצא' });
}

function createApp() {
  const globalMiddlewares = []; // { mount: string|null, fn }
  const mountedRouters = []; // { prefix, router }

  function use(a, b) {
    if (typeof a === 'function') {
      globalMiddlewares.push({ mount: null, fn: a });
    } else if (b instanceof Router) {
      const prefix = a === '/' ? '' : a.replace(/\/$/, '');
      mountedRouters.push({ prefix, router: b });
    } else if (typeof b === 'function') {
      const mount = a === '/' ? '' : a.replace(/\/$/, '');
      globalMiddlewares.push({ mount, fn: b });
    }
  }

  async function handleRequest(req, res) {
    const parsed = url.parse(req.url, true);
    req.query = parsed.query;
    req.path = decodeURIComponent(parsed.pathname || '/');
    req.cookies = parseCookies(req.headers.cookie);
    req.body = {};

    res.status = (code) => {
      res.statusCode = code;
      return res;
    };
    res.json = (obj) => {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }
      res.end(JSON.stringify(obj));
    };
    res.send = (strOrBuffer) => {
      res.end(strOrBuffer);
    };
    res.sendFile = (filePath) => {
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('קובץ לא נמצא');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        if (!res.getHeader('Content-Type')) {
          res.setHeader('Content-Type', MIME_TYPES[ext] || 'application/octet-stream');
        }
        res.end(data);
      });
    };

    try {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
        const raw = await readRequestBody(req);
        if (raw) {
          const contentType = req.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              req.body = JSON.parse(raw);
            } catch (err) {
              req.body = {};
            }
          }
        }
      }
    } catch (err) {
      res.statusCode = 400;
      res.end('Bad request body');
      return;
    }

    const chain = globalMiddlewares
      .filter((mw) => mw.mount === null || req.path.startsWith(mw.mount))
      .map((mw) => mw.fn);

    let matchedHandlers = null;
    let matchedParams = {};

    for (const mounted of mountedRouters) {
      if (!req.path.startsWith(mounted.prefix)) continue;
      const subPath = req.path.slice(mounted.prefix.length) || '/';

      for (const route of mounted.router.routes) {
        if (route.method !== req.method) continue;
        const match = route.regex.exec(subPath);
        if (match) {
          matchedHandlers = route.handlers;
          route.keys.forEach((key, i) => {
            matchedParams[key] = decodeURIComponent(match[i + 1]);
          });
          break;
        }
      }
      if (matchedHandlers) break;
    }

    req.params = matchedParams;

    const allHandlers = matchedHandlers ? [...chain, ...matchedHandlers] : [...chain, notFoundHandler];

    let index = 0;
    const next = (err) => {
      if (err) {
        console.error('[server] Unhandled error:', err);
        if (!res.headersSent) res.status(500).json({ error: 'שגיאת שרת פנימית' });
        return;
      }
      const fn = allHandlers[index++];
      if (!fn) return;
      try {
        const result = fn(req, res, next);
        if (result && typeof result.catch === 'function') {
          result.catch(next);
        }
      } catch (syncErr) {
        next(syncErr);
      }
    };

    next();
  }

  return {
    use,
    listen(port, callback) {
      const server = http.createServer((req, res) => {
        handleRequest(req, res).catch((err) => {
          console.error('[server] Fatal request error:', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('Internal server error');
          }
        });
      });
      return server.listen(port, callback);
    },
  };
}

module.exports = { createApp, Router };
