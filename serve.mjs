import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

const PROXIES = [
  { prefix: '/api/amap/', base: 'https://restapi.amap.com/' },
  { prefix: '/api/osrm/', base: 'https://router.project-osrm.org/' },
  { prefix: '/api/datav/', base: 'https://geo.datav.aliyun.com/' },
  { prefix: '/api/esri/', base: 'https://server.arcgisonline.com/' },
  { prefix: '/api/nominatim/', base: 'https://nominatim.openstreetmap.org/' },
  { prefix: '/api/photon/', base: 'https://photon.komoot.io/api/' },
  { prefix: '/api/overpass/', base: 'https://overpass-api.de/api/' },
];

const HIDDEN = new Set(['/config.json', '/serve.mjs', '/.git']);

async function loadConfig() {
  try {
    return JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
  } catch {
    return {};
  }
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : null;
}

async function handleProxy(req, res, url) {
  const rule = PROXIES.find((r) => url.pathname.startsWith(r.prefix));
  if (!rule) return send(res, 404, 'unknown proxy path', { 'Content-Type': 'text/plain' });

  const target = new URL(rule.base + url.pathname.slice(rule.prefix.length) + url.search);
  if (target.origin !== new URL(rule.base).origin) return send(res, 400, 'bad target');

  if (rule.prefix === '/api/amap/') {
    const cfg = await loadConfig();
    if (cfg.amapKey) target.searchParams.set('key', cfg.amapKey);
  }

  const init = { method: req.method, headers: { 'User-Agent': 'map-ai-dev-server' } };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await readBody(req);
    if (body) {
      init.body = body;
      init.headers['Content-Type'] = req.headers['content-type'] || 'application/x-www-form-urlencoded';
    }
  }

  try {
    const upstream = await fetch(target, init);
    const buf = Buffer.from(await upstream.arrayBuffer());
    send(res, upstream.status, buf, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
    });
  } catch (err) {
    send(res, 502, JSON.stringify({ error: 'upstream_failed', message: String(err?.message || err) }), {
      'Content-Type': 'application/json; charset=utf-8',
    });
  }
}

async function handleStatic(res, pathname) {
  if (HIDDEN.has(pathname)) return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
  let filePath = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!filePath.startsWith(ROOT)) return send(res, 403, 'forbidden', { 'Content-Type': 'text/plain' });
  try {
    if ((await stat(filePath)).isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    return send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
  }
  try {
    const buf = await readFile(filePath);
    send(res, 200, buf, { 'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'not found', { 'Content-Type': 'text/plain' });
  }
}

const cfg = await loadConfig();
const port = Number(process.env.PORT || cfg.port || 8080);

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/api/config') {
      return send(
        res,
        200,
        JSON.stringify({
          hasAmapKey: Boolean(cfg.amapKey),
          tileProvider: cfg.tileProvider || 'amap',
          routeProvider: cfg.routeProvider || 'auto',
          proxy: true,
        }),
        { 'Content-Type': 'application/json; charset=utf-8' },
      );
    }
    if (url.pathname.startsWith('/api/')) return await handleProxy(req, res, url);
    return await handleStatic(res, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (err) {
    send(res, 500, 'server error', { 'Content-Type': 'text/plain' });
    console.error(err);
  }
}).listen(port, () => {
  console.log(`map_ai 已启动: http://localhost:${port}  (高德 key: ${cfg.amapKey ? '已配置' : '未配置，使用免 key 模式'})`);
});
