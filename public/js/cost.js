// 往復交通費・移動時間の概算
import { haversineKm } from './util.js';
import { SHINKANSEN_STATIONS, SHINKANSEN_HUBS, hubPath } from '../data/shinkansen.js';

export const COST = {
  roadFactor: 1.3, roadAdd: 2,
  highwayThreshold: 40, highwayBase: 25, highwayRatio: 0.85,
  kmPerL: { summer: 13, winter: 11.5 }, gasYen: 175,
  tollPerKm: 24.6, tollTax: 1.1, tollBase: 150,
  speedHighway: 80, speedLocal: 35, winterTimeFactor: 1.25,
  railFactor: 1.2, fareKm: 16.5, fareKmLong: 13.2, fareLongFrom: 300, fareMin: 150,
  taxiBase: 500, taxiKm: 420,
  // 新幹線
  shinRouteFactor: 1.18, shinSpeed: 190, shinOriginMaxKm: 30, shinDestMaxKm: 35, shinMinKm: 60,
  localSpeed: 40, expressSpeed: 80,
};

/** 新幹線 指定席特急料金（片道・通常期の目安） */
export function shinkansenFee(km) {
  if (km <= 100) return 2500;
  if (km <= 200) return 3200;
  if (km <= 300) return 4300;
  if (km <= 400) return 5000;
  if (km <= 500) return 5500;
  if (km <= 600) return 5800;
  if (km <= 800) return 7000;
  if (km <= 1000) return 8000;
  return 9300;
}

const HUB_LINES = { 東京: ['W', 'T'], 大宮: ['T', 'J', 'H'], 高崎: ['J', 'H'], 福島: ['T', 'Y'], 盛岡: ['T', 'A'], 博多: ['W'], 武雄温泉: ['N'] };

function pathDist(st, hub) {
  let d = 0; let prev = st;
  for (const h of hubPath(st)) {
    d += haversineKm(prev, SHINKANSEN_HUBS[h]);
    prev = SHINKANSEN_HUBS[h];
    if (h === hub) return d;
  }
  return Infinity;
}

/** 新幹線2駅間の経路距離（分岐点を経由した直線距離の和、km） */
export function shinkansenRouteKm(a, b) {
  if (a.line === b.line) return haversineKm(a, b);
  let best = Infinity;
  for (const h of hubPath(a)) {
    const viaA = pathDist(a, h);
    if (hubPath(b).includes(h)) best = Math.min(best, viaA + pathDist(b, h));
    if (HUB_LINES[h]?.includes(b.line)) best = Math.min(best, viaA + haversineKm(SHINKANSEN_HUBS[h], b));
  }
  for (const h of hubPath(b)) {
    if (HUB_LINES[h]?.includes(a.line)) best = Math.min(best, pathDist(b, h) + haversineKm(SHINKANSEN_HUBS[h], a));
  }
  return best;
}

function nearestShinkansen(p, maxKm) {
  let best = null; let bestD = maxKm;
  for (const st of SHINKANSEN_STATIONS) {
    const d = haversineKm(p, st);
    if (d <= bestD) { best = st; bestD = d; }
  }
  return best;
}

/** 新幹線を使う経路（使えない・近すぎる場合は null） */
export function shinkansenPlan(origin, dest, hint) {
  const so = nearestShinkansen(origin, COST.shinOriginMaxKm);
  const sd = (hint && SHINKANSEN_STATIONS.find((x) => x.name === hint + '駅')) || nearestShinkansen(dest, COST.shinDestMaxKm);
  if (!so || !sd || so.name === sd.name) return null;
  const shinKm = shinkansenRouteKm(so, sd) * COST.shinRouteFactor;
  if (shinKm < COST.shinMinKm) return null;
  const leg1 = haversineKm(origin, so) * COST.railFactor;
  const leg2 = haversineKm(sd, dest) * COST.railFactor;
  const transfers = (leg1 > 1 ? 1 : 0) + (leg2 > 1 ? 1 : 0);
  // 新幹線駅から先が長い場合は在来線特急に乗り継ぐ
  const leg2Express = leg2 >= 50 ? (leg2 < 100 ? 1300 : expressFee(leg2)) : 0;
  return {
    so, sd, shinKm, leg1, leg2, leg2Express,
    fare: railFare(leg1 + shinKm + leg2),
    fee: shinkansenFee(shinKm),
    hours: leg1 / COST.localSpeed + shinKm / COST.shinSpeed + leg2 / (leg2 >= 50 ? COST.expressSpeed : COST.localSpeed) + transfers * 0.25 + 0.15,
  };
}

const round10 = (n) => Math.round(n / 10) * 10;

export function expressFee(railKm) {
  if (railKm < 100) return 0;
  if (railKm < 200) return 1800;
  if (railKm < 400) return 3200;
  if (railKm < 600) return 4800;
  return 6200;
}

export function railFare(railKm) {
  if (railKm < 0.5) return 0;
  const f = railKm <= COST.fareLongFrom
    ? railKm * COST.fareKm
    : COST.fareLongFrom * COST.fareKm + (railKm - COST.fareLongFrom) * COST.fareKmLong;
  return Math.max(COST.fareMin, round10(f));
}

export const taxiFare = (km) => round10(COST.taxiBase + km * COST.taxiKm);

/** 初期の季節：12〜3月は冬季 */
export const defaultSeason = (month) => ([12, 1, 2, 3].includes(month) ? 'winter' : 'summer');

export function calcCar(m, origin, season) {
  const winter = season === 'winter';
  const straight = haversineKm(origin, m.trailhead);
  const road = straight * COST.roadFactor + COST.roadAdd;
  const res = { mode: 'car', straight, road, notes: [] };
  if (winter && m.winter.car === 'closed') {
    return { ...res, available: false, reason: '冬季通行止め（マイカーで登山口まで行けません）' };
  }
  const highway = road > COST.highwayThreshold ? (road - COST.highwayBase) * COST.highwayRatio : 0;
  const local = road - highway;
  const fuel = round10(((road * 2) / COST.kmPerL[season]) * COST.gasYen);
  const toll = highway > 0 ? round10((highway * COST.tollPerKm * COST.tollTax + COST.tollBase) * 2) : 0;
  const parking = m.parking?.fee || 0;
  const shuttle = !winter && m.carShuttle ? m.carShuttle.fare : 0;
  const ropeway = m.access.ropeway?.required ? m.access.ropeway.fare : 0;
  const fee = m.fee || 0;
  let hours = (highway / COST.speedHighway + local / COST.speedLocal) * (winter ? COST.winterTimeFactor : 1);
  if (shuttle) hours += m.carShuttle.min / 60;
  const items = [
    ['ガソリン代', fuel, `${Math.round(road * 2)}km・燃費${COST.kmPerL[season]}km/L`],
    ['高速料金', toll, highway > 0 ? `高速 約${Math.round(highway)}km×往復` : '一般道のみ'],
    ['駐車場', parking, m.parking?.name || ''],
  ];
  if (shuttle) items.push([m.carShuttle.label || 'シャトル', shuttle, '往復']);
  if (ropeway) items.push([ropewayShort(m), ropeway, '必須']);
  if (fee) items.push(['入山料等', fee, '']);
  if (winter && m.winter.car === 'chains') res.notes.push({ type: 'warn', text: 'スタッドレス・チェーン必須' });
  if (shuttle) res.notes.push({ type: 'info', text: m.carShuttle.note });
  if (!m.access.ropeway?.required && m.access.ropeway) res.notes.push({ type: 'info', text: `${m.access.ropeway.name}は任意（往復${m.access.ropeway.fare.toLocaleString()}円・合計に含まず）` });
  if (fee && m.feeNote) res.notes.push({ type: 'info', text: m.feeNote });
  return {
    ...res, available: true, highway, local, items,
    total: fuel + toll + parking + shuttle + ropeway + fee,
    hours,
  };
}

function ropewayShort(m) {
  if (m.access.ropeway.label) return m.access.ropeway.label;
  const n = m.access.ropeway.name.replace(/（.*?）/g, '');
  return n.length > 10 ? 'ロープウェイ等' : n;
}

export function calcTransit(m, origin, season) {
  const winter = season === 'winter';
  const a = m.access;
  const straight = haversineKm(origin, a);
  const rail = straight * COST.railFactor;
  const res = { mode: 'transit', straight, rail, notes: [] };
  if (winter && m.winter.transit === 'closed') {
    return { ...res, available: false, reason: '冬季運休（バス・ロープウェイ等が運行していません）' };
  }
  // 在来線（特急）と新幹線を比べ、速いほうを採用
  const convHours = rail < 0.5 ? 0 : rail / (rail >= 100 ? COST.expressSpeed : COST.localSpeed) + 0.25;
  const shin = rail >= 80 ? shinkansenPlan(origin, a, a.shinkansen) : null;
  const useShin = !!shin && shin.hours < convHours - 0.1;
  const fare = useShin ? shin.fare : railFare(rail);
  const express = useShin ? shin.fee : expressFee(rail);
  let secondFare = 0; let secondLabel = ''; let secondHours = 0; let secondNote = '';
  const useTaxi = (winter && m.winter.transit === 'taxi') || (!a.bus && !a.walk && a.taxi?.km > 0);
  if (useTaxi) {
    secondFare = taxiFare(a.taxi.km);
    secondLabel = 'タクシー';
    secondHours = a.taxi.km / 30;
    secondNote = winter && a.bus ? '冬はバス運休のためタクシー概算' : `タクシー概算（${a.taxi.km}km）`;
  } else if (a.bus) {
    secondFare = a.bus.fare;
    secondLabel = 'バス';
    secondHours = a.bus.min / 60;
    secondNote = a.bus.note;
  }
  const ropeway = a.ropeway?.required ? a.ropeway.fare : 0;
  const fee = m.fee || 0;
  const railHours = useShin ? shin.hours : convHours;
  const railKm = useShin ? shin.leg1 + shin.shinKm + shin.leg2 : rail;
  const items = [
    ['鉄道運賃', fare * 2, rail < 0.5 ? '最寄り駅から出発' : `${a.station}まで 約${Math.round(railKm)}km`],
  ];
  if (express) items.push([useShin ? '新幹線特急料金' : '特急料金', express * 2, useShin ? '指定席・往復' : '往復']);
  const express2 = useShin ? shin.leg2Express : 0;
  if (express2) items.push(['在来線特急料金', express2 * 2, `${shin.sd.name}から・往復`]);
  if (useShin) {
    res.via = 'shinkansen';
    res.shinkansen = { from: shin.so.name, to: shin.sd.name, km: Math.round(shin.shinKm) };
    res.notes.push({ type: 'info', text: `新幹線 ${shin.so.name}→${shin.sd.name}（約${Math.round(shin.shinKm)}km）を利用${shin.leg2 > 1 ? `、${a.station}まで${shin.leg2Express ? '在来線特急' : '在来線'}` : ''}` });
  }
  if (secondFare) items.push([secondLabel, secondFare * 2, '往復']);
  if (ropeway) items.push([ropewayShort(m), ropeway, '必須']);
  if (fee) items.push(['入山料等', fee, '']);
  if (secondNote) res.notes.push({ type: useTaxi && winter ? 'warn' : 'info', text: secondNote });
  if (a.walk) res.notes.push({ type: 'info', text: `${a.station}から登山口まで徒歩` });
  if (a.ropeway && !a.ropeway.required) res.notes.push({ type: 'info', text: `${a.ropeway.name}は任意（往復${a.ropeway.fare.toLocaleString()}円・合計に含まず）` });
  if (!winter && a.bus?.months && a.bus.months.length < 12) res.notes.push({ type: 'info', text: `バスは${monthsRange(a.bus.months)}の運行` });
  if (fee && m.feeNote) res.notes.push({ type: 'info', text: m.feeNote });
  if (railKm > 600) res.notes.push({ type: 'info', text: '遠方のため飛行機の利用も検討してください' });
  return {
    ...res, available: true, items,
    total: fare * 2 + express * 2 + express2 * 2 + secondFare * 2 + ropeway + fee,
    hours: railHours + secondHours,
  };
}

function monthsRange(ms) {
  const s = [...ms].sort((x, y) => x - y);
  return `${s[0]}〜${s[s.length - 1]}月`;
}

export function calcAll(m, origin, season) {
  return { car: calcCar(m, origin, season), transit: calcTransit(m, origin, season) };
}
