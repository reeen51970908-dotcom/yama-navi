import { DEFAULT_ORIGIN } from '../data/stations.js';

const K = { history: 'yamanavi.history', origin: 'yamanavi.origin' };
const MAX_HISTORY = 50;

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 容量超過・プライベートモード */ }
}

export function getOrigin() {
  const o = read(K.origin, null);
  return o && Number.isFinite(o.lat) && Number.isFinite(o.lon) && o.name ? o : { ...DEFAULT_ORIGIN };
}
export const setOrigin = (o) => write(K.origin, { name: o.name, lat: o.lat, lon: o.lon, kind: o.kind || 'station' });

/** @returns {{id:string,t:number,fav?:boolean}[]} */
export const getHistory = () => read(K.history, []).filter((h) => h && typeof h.id === 'string');
export const setHistory = (list) => write(K.history, list.slice(0, MAX_HISTORY));

export function pushHistory(id) {
  const list = getHistory();
  const prev = list.find((h) => h.id === id);
  const next = [{ id, t: Date.now(), fav: !!prev?.fav }, ...list.filter((h) => h.id !== id)];
  setHistory(next);
}
export function toggleFav(id) {
  const list = getHistory();
  const h = list.find((x) => x.id === id);
  if (h) h.fav = !h.fav;
  setHistory(list);
  return !!h?.fav;
}
export const isFav = (id) => !!getHistory().find((h) => h.id === id)?.fav;
