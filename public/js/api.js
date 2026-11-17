// /api を優先し、使えない場合は Open-Meteo / 国土地理院 を直接呼ぶ
import { buildForecast, openMeteoUrl } from './tenkura.js';

const GSI_URL = 'https://msearch.gsi.go.jp/address-search/AddressSearch?q=';

async function fetchJson(url, ms = 9000, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  signal?.addEventListener('abort', () => ctl.abort());
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

export async function getWeather(m, signal) {
  const qs = new URLSearchParams({ lat: m.lat, lon: m.lon, elev: m.elev });
  try {
    const j = await fetchJson('/api/weather?' + qs, 9000, signal);
    if (Array.isArray(j.days) && j.days.length) return { ...j, via: 'api' };
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  // フォールバック：Open-Meteo を直接呼んで、同じ基準で算出
  const raw = await fetchJson(openMeteoUrl(m.lat, m.lon, m.elev), 9000, signal);
  return { days: buildForecast(raw), elev: m.elev, via: 'direct' };
}

export async function geocode(q, signal) {
  try {
    const j = await fetchJson('/api/geocode?q=' + encodeURIComponent(q), 8000, signal);
    if (Array.isArray(j.results)) return j.results;
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  const raw = await fetchJson(GSI_URL + encodeURIComponent(q), 8000, signal);
  return toResults(raw);
}

export function toResults(raw) {
  return (Array.isArray(raw) ? raw : []).slice(0, 10).map((f) => ({
    name: f.properties?.title || '',
    lat: f.geometry?.coordinates?.[1],
    lon: f.geometry?.coordinates?.[0],
  })).filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lon));
}
