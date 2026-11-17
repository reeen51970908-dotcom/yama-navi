import { MOUNTAINS, transitOk } from '../data/mountains.js';
import { normalize, currentMonth } from './util.js';

const INDEX = MOUNTAINS.map((m) => ({
  m,
  primary: [m.name, m.kana, m.romaji].map(normalize),
  fields: [m.name, m.kana, m.romaji, m.pref, m.area, ...(m.aliases || []), ...(m.tags || [])].map(normalize),
}));

export const FILTERS = {
  season: { label: '今が適期', test: (m) => m.bestMonths.includes(currentMonth()) },
  beginner: { label: '初心者向け', test: (m) => m.difficulty <= 2 },
  day: { label: '日帰り', test: (m) => m.courseTime <= 8 },
  transit: { label: '公共交通OK', test: (m) => transitOk(m) },
  winter: { label: '冬も登れる', test: (m) => m.winter.climb === 'ok' },
};

/** 部分一致検索。先頭一致を優先、同点は人気順 */
export function searchMountains(query, filters = []) {
  const q = normalize(query);
  const tests = filters.map((f) => FILTERS[f]?.test).filter(Boolean);
  const out = [];
  for (const it of INDEX) {
    if (!tests.every((t) => t(it.m))) continue;
    if (!q) { out.push({ m: it.m, score: 0 }); continue; }
    let score = 0;
    if (it.primary.some((f) => f.startsWith(q))) score = 4;
    else if (it.fields.some((f) => f.startsWith(q))) score = 3;
    else if (it.primary.some((f) => f.includes(q))) score = 2;
    else if (it.fields.some((f) => f.includes(q))) score = 1;
    if (score) out.push({ m: it.m, score });
  }
  out.sort((a, b) => b.score - a.score || b.m.popular - a.m.popular);
  return out.map((x) => x.m);
}
