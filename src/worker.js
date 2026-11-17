// やまナビ API（Cloudflare Workers）。/api/* 以外は Workers Static Assets（public/）が配信する。
import { buildForecast, openMeteoUrl, TENKURA_BASIS } from '../public/js/tenkura.js';

const GSI_SEARCH = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';
const WEATHER_TTL = 30 * 60; // 30分
const GEOCODE_TTL = 24 * 60 * 60; // 1日

const BASE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'x-content-type-options': 'nosniff',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}
const bad = (msg) => json({ ok: false, error: 'bad_request', message: msg }, 400, { 'cache-control': 'no-store' });

function num(v) {
  if (v == null || String(v).trim() === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Cache API でラップ（キャッシュできない環境ではそのまま） */
async function withCache(ctx, key, ttl, produce) {
  const cache = globalThis.caches?.default;
  const keyReq = new Request(key, { method: 'GET' });
  if (cache) {
    try {
      const hit = await cache.match(keyReq);
      if (hit) {
        const r = new Response(hit.body, hit);
        r.headers.set('x-cache', 'HIT');
        return r;
      }
    } catch { /* キャッシュ障害は無視 */ }
  }
  const res = await produce();
  if (res.status === 200) {
    res.headers.set('cache-control', `public, max-age=${ttl}`);
    if (cache) {
      const p = cache.put(keyReq, res.clone()).catch(() => {});
      if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
    }
  }
  res.headers.set('x-cache', 'MISS');
  return res;
}

async function upstream(url) {
  const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'yama-navi/1.0' } });
  if (!r.ok) {
    const e = new Error('upstream ' + r.status);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function weather(url, ctx) {
  const lat = num(url.searchParams.get('lat'));
  const lon = num(url.searchParams.get('lon'));
  const elevRaw = url.searchParams.get('elev');
  const elev = elevRaw == null || elevRaw === '' ? null : num(elevRaw);
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return bad('lat は -90〜90 の数値で指定してください');
  if (Number.isNaN(lon) || lon < -180 || lon > 180) return bad('lon は -180〜180 の数値で指定してください');
  if (elev !== null && (Number.isNaN(elev) || elev < -500 || elev > 9000)) return bad('elev は -500〜9000 の数値（m）で指定してください');
  const la = lat.toFixed(4); const lo = lon.toFixed(4); const el = elev === null ? '' : String(Math.round(elev));
  const key = `https://cache.yama-navi.internal/weather?lat=${la}&lon=${lo}&elev=${el}`;
  return withCache(ctx, key, WEATHER_TTL, async () => {
    try {
      const raw = await upstream(openMeteoUrl(la, lo, el));
      const days = buildForecast(raw);
      return json({
        ok: true, source: 'open-meteo', basis: TENKURA_BASIS,
        lat: Number(la), lon: Number(lo), elev: elev === null ? raw.elevation ?? null : Math.round(elev),
        generatedAt: new Date().toISOString(), days,
      });
    } catch (e) {
      return json({ ok: false, error: 'upstream_error', message: '気象データを取得できませんでした', status: e.status || 0 }, 502, { 'cache-control': 'no-store' });
    }
  });
}

async function geocode(url, ctx) {
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return bad('q（住所・駅名）を指定してください');
  if (q.length > 80) return bad('q は80文字以内で指定してください');
  const key = `https://cache.yama-navi.internal/geocode?q=${encodeURIComponent(q.normalize('NFKC'))}`;
  return withCache(ctx, key, GEOCODE_TTL, async () => {
    try {
      const raw = await upstream(GSI_SEARCH + encodeURIComponent(q));
      const results = (Array.isArray(raw) ? raw : []).slice(0, 10).map((f) => ({
        name: f?.properties?.title || '',
        lat: Number(f?.geometry?.coordinates?.[1]),
        lon: Number(f?.geometry?.coordinates?.[0]),
      })).filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));
      return json({ ok: true, source: 'gsi', q, results });
    } catch (e) {
      return json({ ok: false, error: 'upstream_error', message: '住所検索に失敗しました', status: e.status || 0 }, 502, { 'cache-control': 'no-store' });
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (env?.ASSETS) return env.ASSETS.fetch(request);
      return json({ ok: false, error: 'not_found' }, 404);
    }
    if (request.method !== 'GET') {
      return json({ ok: false, error: 'method_not_allowed' }, 405, { allow: 'GET' });
    }
    switch (url.pathname) {
      case '/api/health': return json({ ok: true }, 200, { 'cache-control': 'no-store' });
      case '/api/weather': return weather(url, ctx);
      case '/api/geocode': return geocode(url, ctx);
      default: return json({ ok: false, error: 'not_found' }, 404);
    }
  },
};
