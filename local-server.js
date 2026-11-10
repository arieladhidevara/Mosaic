const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8000);
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const {loopback}=require('./lib/dev-auth');
if(process.env.MOSAIC_DEV_AUTH==='true'&&!loopback(HOST)&&HOST!=='localhost')throw Error('MOSAIC_DEV_AUTH requires a loopback-only server binding.');

const apiRoutes = new Map([
  ['/api/session', require('./api/session')],
  ['/api/credits', require('./api/credits')],
  ['/api/ai/connection', require('./api/ai/connection')],
  ['/api/activity', require('./api/activity')],
  ['/api/admin', require('./api/admin')],
  ['/api/ai/master', require('./api/ai/generate')],
  ['/api/ai/edit', require('./api/ai/generate')],
  ['/api/ai/harmonize', require('./api/ai/generate')],
  ['/api/ai/classify', require('./api/ai/classify')],
  ['/api/ai/sam3', require('./api/ai/sam3')],
  ['/api/ai/object-intent', require('./api/ai/object-intent')],
  ['/api/ai/object-map', require('./api/ai/object-map')],
  ['/api/ai/option-name', require('./api/ai/option-name')],
  ['/api/ai/scene-intent', require('./api/ai/scene-intent')],
]);

const publicFiles = new Set([
  'index.html',
  'privacy.html',
  'terms.html',
  'legal.css',
  'styles.css',
  'auth.js',
  'key-vault.js',
  'workspace-ui.js',
  'canvas-workspace.js',
  'canvas-workspace.css',
  'workspace-ui.css',
  'geometry-edit.css',
  'workspace-simplified.css',
  'account.js',
  'account.css',
  'landing.css',
  'credits.js',
  'demo-credits.js',
  'master-resolution.js',
  'auth-callback.html',
  'auth-callback.js',
  'assets/atelier.svg',
  'assets/mozai-homepage-demo.mov',
  'admin.html',
  'admin.js',
  'admin.css',
  'app.js',
  'mask-geometry.js',
  'mask-feather.js',
  'generation-pool.js',
  // Keep the local origin in sync with the production editor module graph.
  // Module workers require explicit allowlisting and JavaScript MIME types.
  'mask-progress.js',
  'mask-cleanup.mjs',
  'slimsam-wand.js',
  'slimsam-worker.mjs',
  'slimsam-mask-utils.mjs',
  'auto-regions.js',
  'object-aware.js',
  'geometry-edit.js',
  'scene-targeting.js',
  'scene-versioning.js',
  'geometry-mask.mjs',
  'object-map.js',
  'object-management.js',
  'generated-image.mjs',
  'object-map-utils.mjs',
  'object-map-cleanup.mjs',
  'object-map-geometry.mjs',
  'object-mask-utils.mjs',
  'object-repair-worker.js',
  'premium.js',
  'regions.js',
  'source-editor.js',
  'sources.js',
  'project-file.js',
  'assets/mosaic-logo.svg',
]);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.mov': 'video/quicktime',
};

function jsonResponse(res) {
  res.status = function status(code) {
    res.statusCode = code;
    return res;
  };
  res.json = function json(body) {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
    return res;
  };
}

function readJsonBody(req,limit=MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const error = new Error('Request is too large. Try a smaller canvas.');
        error.statusCode = 413;
        reject(error);
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const error = new Error('Invalid JSON request.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function serveApi(req, res, handler) {
  jsonResponse(res);
  try {
    req.body = await readJsonBody(req,req.url.startsWith('/api/ai/')?MAX_BODY_BYTES:16384);
    await handler(req, res);
  } catch (error) {
    if (res.writableEnded) return;
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Local API server error.',
    });
  }
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end('Method not allowed');
    return;
  }

  const cleanPage = pathname.match(/^\/(admin|privacy|terms)\/?$/);
  const fileName = pathname === '/' ? 'index.html' : cleanPage ? `${cleanPage[1]}.html` : pathname.slice(1);
  if (!publicFiles.has(fileName)) {
    res.statusCode = 404;
    res.end('Not found');
    return;
  }

  const filePath = path.join(ROOT, fileName);
  fs.stat(filePath, (error, stat) => {
    if (error || !stat.isFile()) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', contentTypes[path.extname(fileName)] || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`).pathname;
  } catch {
    res.statusCode = 400;
    res.end('Bad request');
    return;
  }

  const handler = apiRoutes.get(pathname);
  if (handler) {
    await serveApi(req, res, handler);
    return;
  }
  serveStatic(req, res, pathname);
});

server.requestTimeout = 300_000;
server.headersTimeout = 305_000;

server.listen(PORT, HOST, () => {
  console.log(`mozAI local server: http://${HOST}:${PORT}`);
  console.log('Open the URL above, then add your OpenAI API key in the mozAI toolbar.');
  if(process.env.NODE_ENV==='development'&&process.env.MOSAIC_DEV_AUTH==='true')console.log('Local auto-login enabled: dev@mosaic.local. Development data stays in .mosaic-dev.');
});

server.on('error', error => {
  console.error(`Local server failed: ${error.message}`);
  process.exitCode = 1;
});
