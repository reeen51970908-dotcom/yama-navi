// 山・駅データの検査（npm test の最初に実行）。問題があれば一覧を出して終了コード1。
import { MOUNTAINS } from '../public/data/mountains.js';
import { EXTRA_MOUNTAINS } from '../public/data/mountains-extra.js';
import { STATIONS, DEFAULT_ORIGIN } from '../public/data/stations.js';
import { SHINKANSEN_STATIONS } from '../public/data/shinkansen.js';
import { calcAll } from '../public/js/cost.js';
import { haversineKm } from '../public/js/util.js';

const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);
const inJapan = (p) => p && p.lat >= 24 && p.lat <= 46 && p.lon >= 122 && p.lon <= 146;
const dup = (arr) => arr.filter((x, i) => arr.indexOf(x) !== i);

for (const d of dup(MOUNTAINS.map((m) => m.id))) err(d, 'id が重複');
for (const d of dup(MOUNTAINS.map((m) => m.name))) err(d, '山名が重複');
for (const d of dup(STATIONS.map((s) => s.name))) err(d, '駅名が重複');

const STR = ['id', 'name', 'kana', 'romaji', 'pref', 'area', 'course'];
for (const m of MOUNTAINS) {
  const id = m.id || '(id なし)';
  for (const k of STR) if (typeof m[k] !== 'string' || !m[k]) err(id, `${k} がない`);
  if (!/^[a-z0-9-]+$/.test(m.id)) err(id, 'id は半角英小文字・数字・ハイフンのみ');
  if (!/^[ぁ-ゖー]+$/.test(m.kana)) err(id, 'kana はひらがなのみ');
  if (!/^[a-z.-]+$/.test(m.romaji)) err(id, 'romaji は半角英小文字');
  if (!Number.isFinite(m.elev) || m.elev < 100 || m.elev > 3776) err(id, `elev が不正: ${m.elev}`);
  if (!inJapan(m)) err(id, '山頂の座標が日本の範囲外');
  if (!Number.isInteger(m.difficulty) || m.difficulty < 1 || m.difficulty > 5) err(id, 'difficulty は1〜5');
  if (!Array.isArray(m.bestMonths) || !m.bestMonths.length || m.bestMonths.some((x) => !Number.isInteger(x) || x < 1 || x > 12)) err(id, 'bestMonths は1〜12の配列');
  if (!Number.isFinite(m.popular)) err(id, 'popular がない');
  if (!(m.courseTime > 0 && m.courseTime < 40)) err(id, 'courseTime が不正');
  if (!m.trailhead?.name || !inJapan(m.trailhead)) err(id, 'trailhead が不正');
  else if (haversineKm(m, m.trailhead) > 25) err(id, `登山口が山頂から遠すぎる（${Math.round(haversineKm(m, m.trailhead))}km）`);
  if (!m.parking?.name || !Number.isFinite(m.parking.fee)) err(id, 'parking が不正');
  if (!Number.isFinite(m.fee)) err(id, 'fee がない');
  const a = m.access;
  if (!a?.station || !inJapan(a)) err(id, 'access の駅が不正');
  else if (haversineKm(a, m.trailhead) > 160) err(id, '最寄り駅が登山口から遠すぎる');
  if (a?.bus && !(a.bus.fare >= 0 && a.bus.min > 0 && a.bus.note)) err(id, 'access.bus が不正');
  if (!a?.bus && !a?.walk && !(a?.taxi?.km > 0)) err(id, 'バス・徒歩・タクシーのいずれも使えない');
  if (a?.ropeway && !(a.ropeway.fare > 0 && a.ropeway.name)) err(id, 'ropeway が不正');
  if (a?.shinkansen && !SHINKANSEN_STATIONS.some((s) => s.name === a.shinkansen + '駅')) err(id, `新幹線の乗換駅「${a.shinkansen}」が見つからない`);
  const w = m.winter;
  if (!['ok', 'snow', 'closed'].includes(w?.climb) || !['ok', 'chains', 'closed'].includes(w?.car) || !['ok', 'taxi', 'closed'].includes(w?.transit) || !w?.note) err(id, 'winter が不正');
  if (w?.transit === 'taxi' && !(a?.taxi?.km > 0)) err(id, '冬にタクシーを使うのに taxi.km がない');
  if (!Array.isArray(m.tags)) err(id, 'tags がない');
  for (const season of ['summer', 'winter']) {
    const c = calcAll(m, DEFAULT_ORIGIN, season);
    for (const x of [c.car, c.transit]) if (x.available && !(x.total > 0 && Number.isFinite(x.hours))) err(id, `${season} の交通費が計算できない`);
  }
}
for (const s of STATIONS) if (!inJapan(s) || !s.kana) err(s.name, '駅データが不正');

if (errors.length) {
  console.error(`データ検査：${errors.length}件の問題\n- ` + errors.join('\n- '));
  process.exit(1);
}
console.log(`データ検査OK：山${MOUNTAINS.length}座（うち追加${EXTRA_MOUNTAINS.length}座）・駅${STATIONS.length}駅・新幹線駅${SHINKANSEN_STATIONS.length}駅`);
