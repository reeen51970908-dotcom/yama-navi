// 登山指数（てんくら基準 A/B/C）の算出。Worker とフロントの両方から使う純粋関数モジュール。
export const TENKURA_BASIS = 'てんくら基準・山頂標高の予報から独自算出';
export const TENKURA_URL = 'https://tenkura.n-kishou.co.jp/tk/';

// WMO weather code → 表示（ラベルとアイコン名。アイコンは public/js/icons.js）
const WMO = {
  0: ['快晴', 'sun'], 1: ['晴れ', 'sun'], 2: ['晴れ時々曇り', 'sun-cloud'], 3: ['曇り', 'cloud'],
  45: ['霧', 'fog'], 48: ['着氷性の霧', 'fog'],
  51: ['弱い霧雨', 'drizzle'], 53: ['霧雨', 'drizzle'], 55: ['強い霧雨', 'rain'],
  56: ['着氷性の霧雨', 'rain'], 57: ['強い着氷性の霧雨', 'rain'],
  61: ['弱い雨', 'drizzle'], 63: ['雨', 'rain'], 65: ['強い雨', 'heavy-rain'],
  66: ['着氷性の雨', 'rain'], 67: ['強い着氷性の雨', 'heavy-rain'],
  71: ['弱い雪', 'snow'], 73: ['雪', 'snow'], 75: ['強い雪', 'snow'], 77: ['霧雪', 'snow'],
  80: ['にわか雨', 'drizzle'], 81: ['にわか雨', 'rain'], 82: ['激しいにわか雨', 'heavy-rain'],
  85: ['にわか雪', 'snow'], 86: ['強いにわか雪', 'snow'],
  95: ['雷雨', 'thunder'], 96: ['雷雨・ひょう', 'thunder'], 99: ['激しい雷雨・ひょう', 'thunder'],
};
const THUNDER = new Set([95, 96, 99]);
const HEAVY = new Set([55, 57, 65, 67, 75, 82, 86]);

export function weatherLabel(code) {
  const w = WMO[code];
  return w ? { label: w[0], icon: w[1] } : { label: '不明', icon: 'unknown' };
}

/** C: 降水10mm以上 / 風速15m/s以上 / 雷雨, B: 降水3mm以上 / 風速10m/s以上 / 強い雨・雪, それ以外 A */
export function gradeDay({ precip, wind, code }) {
  const p = Number(precip) || 0;
  const w = Number(wind) || 0;
  const reasons = [];
  if (p >= 10) reasons.push('降水10mm以上');
  if (w >= 15) reasons.push('風速15m/s以上');
  if (THUNDER.has(code)) reasons.push('雷雨');
  if (reasons.length) return { grade: 'C', reasons };
  if (p >= 3) reasons.push('降水3mm以上');
  if (w >= 10) reasons.push('風速10m/s以上');
  if (HEAVY.has(code)) reasons.push('強い雨・雪');
  if (reasons.length) return { grade: 'B', reasons };
  return { grade: 'A', reasons: [] };
}

export function openMeteoUrl(lat, lon, elev) {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max',
    wind_speed_unit: 'ms',
    timezone: 'Asia/Tokyo',
    forecast_days: '5',
  });
  if (elev != null && elev !== '') p.set('elevation', String(elev));
  return 'https://api.open-meteo.com/v1/forecast?' + p.toString();
}

/** Open-Meteo のレスポンスから 5 日分の登山指数を作る */
export function buildForecast(json) {
  const d = json && json.daily;
  if (!d || !Array.isArray(d.time)) throw new Error('invalid forecast');
  const round1 = (v) => (v == null || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
  return d.time.slice(0, 5).map((date, i) => {
    const code = d.weather_code?.[i];
    const precip = round1(d.precipitation_sum?.[i]) ?? 0;
    const wind = round1(d.wind_speed_10m_max?.[i]) ?? 0;
    const g = gradeDay({ precip, wind, code });
    return {
      date,
      code,
      ...weatherLabel(code),
      tmax: round1(d.temperature_2m_max?.[i]),
      tmin: round1(d.temperature_2m_min?.[i]),
      precip,
      wind,
      grade: g.grade,
      reasons: g.reasons,
    };
  });
}
