// UI アイコン（絵文字の代わりに使う SVG。線の太さを揃えた 24×24、色は currentColor）
const P = {
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>',
  sparkle: '<path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.5 10.2 12.6 4.5 10.8 10.2 9Z"/><path d="M18.5 3.5v3M17 5h3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10 10.5v5.5M14 10.5v5.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  snowflake: '<path d="M12 2.8v18.4M4 7.4l16 9.2M4 16.6l16-9.2M9.5 4.6 12 6.6l2.5-2M9.5 19.4l2.5-2 2.5 2M3.9 10.6l3.1-.6-1-3M20.1 13.4l-3.1.6 1 3M3.9 13.4l3.1.6-1 3M20.1 10.6 17 10l1-3"/>',
  car: '<path d="M4 16.5V12l1.8-4.4A2 2 0 0 1 7.6 6.3h8.8a2 2 0 0 1 1.8 1.3L20 12v4.5"/><path d="M3.5 12h17v4.5h-17zM6 16.5v2M18 16.5v2"/><circle cx="7.5" cy="14.2" r=".9"/><circle cx="16.5" cy="14.2" r=".9"/>',
  train: '<rect x="5.5" y="3.5" width="13" height="13" rx="3"/><path d="M5.5 10.5h13M9 13.8h.01M15 13.8h.01M8 20.5l2-4M16 20.5l-2-4"/>',
  home: '<path d="M4 11 12 4.5 20 11M6.5 9.2v10.3h11V9.2M10 19.5v-5h4v5"/>',
  star: '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  // 天気
  'sun-cloud': '<circle cx="9" cy="8.5" r="3.2"/><path d="M9 2.8v1.4M3.3 8.5h1.4M4.9 4.4l1 1M13.1 4.4l-1 1"/><path d="M8.5 19.5h9a3.5 3.5 0 0 0 .3-7 4.8 4.8 0 0 0-9.1 1.5A2.8 2.8 0 0 0 8.5 19.5Z"/>',
  cloud: '<path d="M7.5 18.5h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.5 1.8A3.1 3.1 0 0 0 7.5 18.5Z"/>',
  fog: '<path d="M7 11.5h10a3.4 3.4 0 0 0 .3-6.8 4.6 4.6 0 0 0-8.8 1.5A2.7 2.7 0 0 0 7 11.5Z"/><path d="M4 15h16M6 18.5h12"/>',
  drizzle: '<path d="M7.5 14h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 7.5 14Z"/><path d="M9 17v1.5M13 17v1.5M17 17v1.5"/>',
  rain: '<path d="M7.5 13.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 7.5 13.5Z"/><path d="m9 16-1 3.5M13 16l-1 3.5M17 16l-1 3.5"/>',
  'heavy-rain': '<path d="M7.5 12.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 7.5 12.5Z"/><path d="m8 15-1.5 5M11.5 15 10 20M15 15l-1.5 5M18.5 15 17 20"/>',
  snow: '<path d="M7.5 13h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 7.5 13Z"/><path d="M8.5 17h.01M12 16h.01M15.5 17h.01M10 20h.01M14 20h.01"/>',
  thunder: '<path d="M7.5 12.5h10a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.6A2.8 2.8 0 0 0 7.5 12.5Z"/><path d="m12.5 13.5-2.5 4h3l-2 4"/>',
  unknown: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.2"/>',
};

/** @param {string} name @param {string} [cls] @param {boolean} [filled] */
export function icon(name, cls = '', filled = false) {
  const d = P[name] || P.unknown;
  return `<svg class="ico ico-${name}${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}
