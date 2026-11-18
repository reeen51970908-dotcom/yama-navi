// src/worker.js を Node でそのまま実行する開発サーバー
//   PORT=8787 node scripts/dev-server.mjs
//   MOCK_UPSTREAM=1     … Open-Meteo / 国土地理院 をフィクスチャ（goal/fixtures/upstream.json）に差し替え
//   MOCK_WEATHER_FAIL=1 … 気象APIを 503 にする
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');
const PORT = Number(process.env.PORT || 8787);
const MOCK = process.env.MOCK_UPSTREAM === '1';
const WEATHER_FAIL = process.env.MOCK_WEATHER_FAIL === '1';

// ---- Cache API（caches.default）の簡易実装 ----
class MemCache {
  constructor() { this.m = new Map(); }
  async match(req) {
    const e = this.m.get(req.url);
    if (!e || e.exp < Date.now()) return undefined;
    return new Response(e.body, { status: e.status, headers: e.headers });
  }
  async put(req, res) {
    const body = await res.arrayBuffer();
    const cc = res.headers.get('cache-control') || '';
    const ma = /max-age=(\d+)/.exec(cc);
    this.m.set(req.url, { body, status: res.status, headers: [...res.headers], exp: Date.now() + (ma ? Number(ma[1]) * 1000 : 60_000) });
  }
}
globalThis.caches = { default: new MemCache() };

// ---- 外部APIのモック ----
const stats = { weather: 0, geocode: 0 };
if (MOCK || WEATHER_FAIL) {
  const fixtures = MOCK ? JSON.parse(await readFile(path.join(root, 'goal/fixtures/upstream.json'), 'utf8')) : null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    if (url.hostname === 'api.open-meteo.com') {
      stats.weather++;
      if (WEATHER_FAIL) return new Response('Service Unavailable', { status: 503 });
      if (MOCK) {
        const elev = url.searchParams.get('elevation');
        return Response.json({ ...fixtures.weather, latitude: Number(url.searchParams.get('latitude')), longitude: Number(url.searchParams.get('longitude')), elevation: elev ? Number(elev) : fixtures.weather.elevation });
      }
    }
    if (MOCK && url.hostname === 'msearch.gsi.go.jp') {
      stats.geocode++;
      const q = url.searchParams.get('q') || '';
      return Response.json(fixtures.geocode.filter((f) => f.properties.title.includes(q)));
    }
    return realFetch(input, init);
  };
}

const worker = (await import(path.join(root, 'src/worker.js'))).default;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

async function serveStatic(req, res, pathname) {
  let p = decodeURIComponent(pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(pub, p));
  if (!file.startsWith(pub)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not file');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/__dev/stats') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(stats)); return; }
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const request = new Request(url, {
        method: req.method, headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
      });
      const waits = [];
      const r = await worker.fetch(request, {}, { waitUntil: (p) => waits.push(p), passThroughOnException() {} });
      await Promise.allSettled(waits);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('internal error');
  }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`yama-navi dev server: http://127.0.0.1:${PORT}${MOCK ? ' (MOCK_UPSTREAM)' : ''}${WEATHER_FAIL ? ' (MOCK_WEATHER_FAIL)' : ''}`);
});
