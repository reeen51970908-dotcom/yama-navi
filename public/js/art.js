// 山の ID から毎回同じ形になる SVG イラストを生成する
let uid = 0;

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

const SKIES = [
  ['#8ec5ff', '#e0f0ff', '#fff6e0'],
  ['#a5b4fc', '#e0e7ff', '#fde2e4'],
  ['#7dd3fc', '#e0f7ff', '#f0fdf4'],
  ['#fbc2a8', '#fde8d7', '#fff7ed'],
  ['#93c5fd', '#dbeafe', '#fef9c3'],
  ['#c4b5fd', '#ede9fe', '#ffe4e6'],
];
const RIDGES = [
  ['#9fb8d6', '#6f8fb8', '#3f5f8a'],
  ['#a7c4bc', '#6f9e8f', '#3d6b5c'],
  ['#b5b0d6', '#8279b3', '#4b4580'],
  ['#c3b7a6', '#8f7f6b', '#5a4c3d'],
  ['#9ec5d9', '#5f94b0', '#2e5f78'],
];

function ridgePath(r, w, h, base, amp, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (w / n) * i;
    const y = base - amp * (0.35 + r() * 0.65);
    pts.push([x, y]);
  }
  let d = `M0 ${h} L0 ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` Q${cx.toFixed(1)} ${(Math.min(y0, y1) - amp * 0.1).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return d + ` L${w} ${h} Z`;
}

/**
 * @param {{id:string, elev:number}} m
 * @param {{w?:number,h?:number,cls?:string,title?:string}} opt
 */
export function mountainArt(m, opt = {}) {
  const w = opt.w || 320; const h = opt.h || 200;
  const r = rng(hash(m.id));
  const sky = SKIES[Math.floor(r() * SKIES.length)];
  const ridge = RIDGES[Math.floor(r() * RIDGES.length)];
  const id = `a${(uid++).toString(36)}`;
  const sunX = w * (0.15 + r() * 0.7); const sunY = h * (0.12 + r() * 0.18); const sunR = h * (0.07 + r() * 0.05);
  // 主峰：標高が高いほど尖って高い
  const peakX = w * (0.3 + r() * 0.4);
  const tall = Math.min(1, Math.max(0, (m.elev - 500) / 3300));
  const peakY = h * (0.42 - tall * 0.24);
  const baseY = h * 0.86;
  const lw = w * (0.38 + r() * 0.16); const rw = w * (0.38 + r() * 0.16);
  const shoulderL = peakY + (baseY - peakY) * (0.25 + r() * 0.2);
  const shoulderR = peakY + (baseY - peakY) * (0.25 + r() * 0.2);
  const main = `M${(peakX - lw).toFixed(1)} ${h} L${(peakX - lw * 0.55).toFixed(1)} ${shoulderL.toFixed(1)} `
    + `L${(peakX - lw * 0.18).toFixed(1)} ${(peakY + (shoulderL - peakY) * 0.3).toFixed(1)} L${peakX.toFixed(1)} ${peakY.toFixed(1)} `
    + `L${(peakX + rw * 0.2).toFixed(1)} ${(peakY + (shoulderR - peakY) * 0.35).toFixed(1)} L${(peakX + rw * 0.6).toFixed(1)} ${shoulderR.toFixed(1)} `
    + `L${(peakX + rw).toFixed(1)} ${h} Z`;
  let snow = '';
  if (m.elev > 1700) {
    const depth = (baseY - peakY) * (0.18 + Math.min(0.2, (m.elev - 1700) / 8000));
    const sy = peakY + depth;
    const lx = peakX - (lw * 0.18) * (depth / ((peakY + (shoulderL - peakY) * 0.3) - peakY || 1)) * 0.9;
    const rx = peakX + (rw * 0.2) * (depth / ((peakY + (shoulderR - peakY) * 0.35) - peakY || 1)) * 0.9;
    snow = `<path d="M${peakX.toFixed(1)} ${peakY.toFixed(1)} L${Math.min(peakX - 4, lx).toFixed(1)} ${sy.toFixed(1)} `
      + `L${(peakX - (peakX - lx) * 0.5).toFixed(1)} ${(sy - depth * 0.22).toFixed(1)} L${(peakX - (peakX - lx) * 0.15).toFixed(1)} ${(sy + depth * 0.05).toFixed(1)} `
      + `L${(peakX + (rx - peakX) * 0.3).toFixed(1)} ${(sy - depth * 0.25).toFixed(1)} L${Math.max(peakX + 4, rx).toFixed(1)} ${sy.toFixed(1)} Z" fill="#fff" opacity=".95"/>`;
  }
  const back = ridgePath(r, w, h, h * 0.62, h * 0.22, 5);
  const front = ridgePath(r, w, h, h * 0.96, h * 0.16, 4);
  const title = opt.title ? `<title>${opt.title}</title>` : '';
  return `<svg class="${opt.cls || 'art'}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${opt.title || m.name || ''}のイラスト" xmlns="http://www.w3.org/2000/svg">${title}
<defs><linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky[0]}"/><stop offset=".6" stop-color="${sky[1]}"/><stop offset="1" stop-color="${sky[2]}"/></linearGradient>
<linearGradient id="${id}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${ridge[1]}"/><stop offset="1" stop-color="${ridge[2]}"/></linearGradient>
<radialGradient id="${id}g"><stop offset="0" stop-color="#fff7d6" stop-opacity=".95"/><stop offset="1" stop-color="#fff7d6" stop-opacity="0"/></radialGradient></defs>
<rect width="${w}" height="${h}" fill="url(#${id}s)"/>
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${(sunR * 2.6).toFixed(1)}" fill="url(#${id}g)"/>
<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${sunR.toFixed(1)}" fill="#fffbea"/>
<path d="${back}" fill="${ridge[0]}" opacity=".55"/>
<path d="${main}" fill="url(#${id}m)"/>${snow}
<path d="${front}" fill="${ridge[2]}" opacity=".85"/>
</svg>`;
}
