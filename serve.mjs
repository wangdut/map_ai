import { createServer } from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
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
const CONFIG_FILE = join(ROOT, 'config.json');
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

async function loadConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** 对外只给掩码，明文 key 永远不离开服务端 */
const maskKey = (k) => (!k ? '' : k.length > 9 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '•'.repeat(k.length));

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

const LOCAL_HOSTS = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
/** 高德 web 服务 key 是 16–64 位字母数字（个别带 - _），挡掉误粘贴整段网页的情况 */
const KEY_SHAPE = /^[A-Za-z0-9_-]{16,64}$/;

async function handleSettings(req, res, cfg) {
  if (req.method !== 'POST') return send(res, 405, '{"error":"method_not_allowed"}', JSON_HEADERS);

  const ip = req.socket.remoteAddress || '';
  const fromLoopback = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1');
  const requested = req.headers['x-requested-with'] === 'map_ai';
  const origin = req.headers.origin;
  if (!fromLoopback || !requested || (origin && !LOCAL_HOSTS.test(origin))) {
    return send(res, 403, JSON.stringify({ error: 'forbidden', message: '只能由本机的页面修改 key' }), JSON_HEADERS);
  }

  let payload;
  try {
    payload = JSON.parse((await readBody(req))?.toString('utf8') || '{}');
  } catch {
    return send(res, 400, '{"error":"bad_json"}', JSON_HEADERS);
  }
  if (typeof payload.amapKey !== 'string') {
    return send(res, 400, JSON.stringify({ error: 'missing_field', message: '需要 amapKey 字段' }), JSON_HEADERS);
  }

  const key = payload.amapKey.trim();
  if (key && !KEY_SHAPE.test(key)) {
    return send(
      res,
      400,
      JSON.stringify({ error: 'bad_key', message: '格式不像高德 Web 服务 key（应为 16–64 位字母或数字）' }),
      JSON_HEADERS,
    );
  }

  // 以磁盘内容为准再合并，避免覆盖服务启动后用户手改的其它字段
  const fresh = await loadConfig();
  fresh.amapKey = key;
  await writeFile(CONFIG_FILE, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
  Object.assign(cfg, fresh);
  console.log(`config.json 已更新：高德 key ${key ? `已保存（${maskKey(key)}）` : '已删除'}`);
  send(res, 200, JSON.stringify({ ok: true, hasAmapKey: Boolean(key), amapKeyMask: maskKey(key) }), JSON_HEADERS);
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
          amapKeyMask: maskKey(cfg.amapKey),
          tileProvider: cfg.tileProvider || 'amap',
          routeProvider: cfg.routeProvider || 'auto',
          proxy: true,
        }),
        JSON_HEADERS,
      );
    }
    if (url.pathname === '/api/settings') return await handleSettings(req, res, cfg);
    if (url.pathname.startsWith('/api/')) return await handleProxy(req, res, url);
    return await handleStatic(res, url.pathname === '/' ? '/index.html' : url.pathname);
  } catch (err) {
    send(res, 500, 'server error', { 'Content-Type': 'text/plain' });
    console.error(err);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`map_ai 已启动: http://localhost:${port}  (仅本机可访问；高德 key: ${cfg.amapKey ? '已配置' : '未配置，使用免 key 模式'})`);
});
