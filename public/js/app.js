import { MOUNTAINS, MOUNTAIN_BY_ID, DIFFICULTY_LABEL } from '../data/mountains.js';
import { STATIONS } from '../data/stations.js';
import { PHOTOS } from '../data/photos.js';
import { icon } from './icons.js';
import { $, $$, esc, normalize, currentMonth, fmtDuration, yen, haversineKm, reducedMotion, WEEK } from './util.js';
import { searchMountains, FILTERS } from './search.js';
import { mountainArt } from './art.js';
import { TileMap } from './map.js';
import { calcAll, defaultSeason, COST } from './cost.js';
import { getWeather, geocode } from './api.js';
import { TENKURA_BASIS, TENKURA_URL } from './tenkura.js';
import * as store from './store.js';
import { toast, hideToast, installRipple, countUp, onHSwipe } from './ui.js';

/** 山の画像：SVGイラストの上に写真を重ねる（写真がない・読み込めない場合はイラストが見える） */
function pic(m, art, size) {
  const svg = mountainArt(m, art);
  if (!PHOTOS[m.id]) return svg;
  const src = `img/m/${m.id}${size === 's' ? '-s' : ''}.webp`;
  return `${svg}<img class="mphoto" src="${src}" alt="${esc(m.name)}の写真" loading="${size === 'hero' ? 'eager' : 'lazy'}" decoding="async">`;
}
function photoCredit(m) {
  const p = PHOTOS[m.id];
  if (!p) return '';
  return `写真：${esc(p.artist)}／<a href="${esc(p.source)}" target="_blank" rel="noopener">${esc(p.license)}</a>（Wikimedia Commons）`;
}

const BOOT_MIN_MS = 380;
const DETAIL_SKELETON_MS = 500;

const state = {
  origin: store.getOrigin(),
  season: defaultSeason(currentMonth()),
  filters: new Set(),
  sort: store.getSort(),
  page: 0,
  detail: null, // { m, token, pushed, map, abort }
};

const el = {
  q: $('#q'), qClear: $('#qClear'), chips: $('#chips'), results: $('#results'), resultHead: $('#resultHead'), noResult: $('#noResult'),
  pager: $('#pager'), tabs: $$('.tab'), ind: $('.tab-ind'),
  carousel: $('#carousel'), dots: $('#dots'), beginner: $('#beginnerList'), recoHead: $('#recoHead'),
  hist: $('#historyList'), histEmpty: $('#historyEmpty'),
  menuBtn: $('#menuBtn'), drawer: $('#drawer'), drawerScrim: $('#drawerScrim'),
  detail: $('#detail'), detailScroll: $('#detailScroll'),
  originChip: $('#originChip'), originName: $('#originName'),
  originSheet: $('#originSheet'), originInput: $('#originInput'), originList: $('#originList'), originCurrent: $('#originCurrent'),
  aboutSheet: $('#aboutSheet'), sheetScrim: $('#sheetScrim'),
};

// ------------------------------------------------------------------ 共通部品
const LV_CLASS = ['', 'easy', 'easy', 'mid', 'hard', 'hard'];
const shortPref = (p) => p.split('・').map((x) => (x === '北海道' ? x : x.replace(/[都府県]$/, ''))).join('・');
const round100 = (n) => Math.round(n / 100) * 100;
const fmtH = (h) => `約${Number.isInteger(h) ? h : h.toFixed(1)}h`;

function costTile(label, c, cheaper) {
  const v = c.available
    ? `<b>¥${round100(c.total).toLocaleString('ja-JP')}</b>`
    : `<b class="na">${state.season === 'winter' ? '冬季不可' : '利用不可'}</b>`;
  return `<span class="mstat${cheaper ? ' cheap' : ''}"><span class="k">${label}${cheaper ? '<i>安い</i>' : ''}</span>${v}</span>`;
}

function cardHtml(m, i) {
  const dist = Math.round(haversineKm(state.origin, m.trailhead));
  const c = calcAll(m, state.origin, state.season);
  const both = c.car.available && c.transit.available;
  const carCheap = both && c.car.total < c.transit.total;
  const trCheap = both && c.transit.total < c.car.total;
  const lv = LV_CLASS[m.difficulty];
  return `<li style="--i:${Math.min(i, 12)}"><button type="button" class="mcard glass rp" data-id="${m.id}" aria-label="${esc(m.name)}の詳細を開く">
    <span class="mhead">
      <span class="mbody">
        <span class="mname">${esc(m.name)}</span>
        <span class="mmeta">${esc(shortPref(m.pref))}・標高${m.elev}m・出発地から約${dist.toLocaleString('ja-JP')}km</span>
        <span class="mlv lv${m.difficulty} ${lv}"><span class="mdots" aria-hidden="true">${[1, 2, 3, 4, 5].map((k) => `<i${k <= m.difficulty ? ' class="on"' : ''}></i>`).join('')}</span>${DIFFICULTY_LABEL[m.difficulty]}</span>
      </span>
      <span class="mthumb" aria-hidden="true">${pic(m, { w: 120, h: 120, cls: 'art' }, 's')}</span>
    </span>
    <span class="mstats">
      <span class="mstat"><span class="k">標準タイム</span><b>${fmtH(m.courseTime)}</b></span>
      ${costTile('車(往復)', c.car, carCheap)}
      ${costTile('電車・バス', c.transit, trCheap)}
    </span>
  </button></li>`;
}

function listNote() {
  const w = state.season === 'winter';
  return `<span class="ln-text">${esc(state.origin.name)}発・往復の目安（${w ? '冬季' : '夏季'}）</span>`
    + `<span class="mini-seg" role="group" aria-label="交通費の季節" data-season="${state.season}">`
    + `<button type="button" data-season-btn="summer" aria-pressed="${!w}" aria-label="夏季">${icon('sun')}夏</button>`
    + `<button type="button" data-season-btn="winter" aria-pressed="${w}" aria-label="冬季">${icon('snowflake')}冬</button></span>`;
}

function refreshLists() {
  renderResults();
  renderBeginners();
}

function openMountain(id) {
  state.navFromApp = true;
  if (location.hash === '#m-' + id) route();
  else location.hash = 'm-' + id;
}

// ------------------------------------------------------------------ 検索
function renderChips() {
  el.chips.innerHTML = Object.entries(FILTERS).map(([k, f]) =>
    `<button type="button" class="chip rp" data-f="${k}" aria-pressed="${state.filters.has(k)}">${f.label}</button>`).join('')
    + `<button type="button" class="chip sort-chip rp" data-sort="near" aria-pressed="${state.sort === 'near'}" aria-label="出発地から近い順に並べる"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5Z" fill="currentColor"/></svg>近い順</button>`;
}

const distFromOrigin = (m) => haversineKm(state.origin, m.trailhead);

function renderResults() {
  const q = el.q.value;
  el.qClear.hidden = !q;
  let list = searchMountains(q, [...state.filters]);
  if (state.sort === 'near') list = list.map((m) => [m, distFromOrigin(m)]).sort((a, b) => a[1] - b[1]).map((x) => x[0]);
  const filtered = state.filters.size > 0;
  const head = (q.trim() ? `「${esc(q.trim())}」の検索結果 ${list.length}件` : filtered ? `絞り込み結果 ${list.length}件` : state.sort === 'near' ? `全${list.length}座` : '人気の山<span class="head-hint">（タップで詳細）</span>')
    + (state.sort === 'near' ? '<span class="sort-tag">近い順</span>' : '');
  el.resultHead.innerHTML = `<span class="head-main">${head}</span><small class="list-note">${listNote()}</small>`;
  el.results.innerHTML = list.map(cardHtml).join('');
  el.noResult.hidden = list.length > 0;
  if (!list.length) el.noResult.textContent = q.trim() ? `「${q.trim()}」に該当する山が見つかりません。別のことばで探してみてください。` : '条件に合う山がありません。';
}

function bindSearch() {
  el.q.addEventListener('input', () => {
    renderResults();
    if (state.page !== 0) goPage(0);
  });
  el.q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const first = el.results.querySelector('.mcard');
      if (first) openMountain(first.dataset.id);
    }
  });
  el.qClear.addEventListener('click', () => { el.q.value = ''; renderResults(); el.q.focus(); });
  el.chips.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    if (b.dataset.sort) {
      state.sort = state.sort === 'near' ? 'popular' : 'near';
      store.setSort(state.sort);
      b.setAttribute('aria-pressed', String(state.sort === 'near'));
      renderResults();
      return;
    }
    const f = b.dataset.f;
    state.filters.has(f) ? state.filters.delete(f) : state.filters.add(f);
    b.setAttribute('aria-pressed', String(state.filters.has(f)));
    renderResults();
  });
  document.addEventListener('click', (e) => {
    const sb = e.target.closest('[data-season-btn]');
    if (sb) { setSeason(sb.dataset.seasonBtn); return; }
    const c = e.target.closest('.mcard, .slide');
    if (c?.dataset.id) openMountain(c.dataset.id);
  });
}

// ------------------------------------------------------------------ タブ／ページャ
function goPage(i, smooth = true) {
  const w = el.pager.clientWidth;
  el.pager.scrollTo({ left: i * w, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  setActiveTab(i);
}
function setActiveTab(i) {
  if (state.page === i && el.tabs[i].getAttribute('aria-selected') === 'true') return;
  state.page = i;
  el.tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
  if (i === 2) renderHistory();
}
function bindPager() {
  let raf = 0;
  const sync = () => {
    raf = 0;
    const w = el.pager.clientWidth || 1;
    const p = el.pager.scrollLeft / w;
    const tw = el.tabs[0].offsetWidth;
    el.ind.style.transform = `translateX(${p * tw}px)`;
    const i = Math.round(p);
    if (i !== state.page && Math.abs(p - i) < 0.2) setActiveTab(i);
  };
  el.pager.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(sync); }, { passive: true });
  el.tabs.forEach((t, i) => t.addEventListener('click', () => goPage(i)));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = (state.page + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
    goPage(i); el.tabs[i].focus();
  });
  window.addEventListener('resize', () => { el.pager.scrollLeft = state.page * el.pager.clientWidth; sync(); });
  sync();
}

// ------------------------------------------------------------------ おすすめ
function renderReco() {
  const mo = currentMonth();
  el.recoHead.textContent = `${mo}月が適期の山`;
  const list = MOUNTAINS.filter((m) => m.bestMonths.includes(mo)).sort((a, b) => b.popular - a.popular).slice(0, 8);
  el.carousel.innerHTML = list.map((m, i) => `<button type="button" class="slide glass" data-id="${m.id}" aria-label="${esc(m.name)}の詳細を開く（${i + 1}/${list.length}）">
      <span class="slide-art">${pic(m, { w: 320, h: 200 }, 'l')}</span>
      <span class="slide-cap"><b>${esc(m.name)}</b><small>${esc(m.pref)}・${m.elev.toLocaleString()}m・${DIFFICULTY_LABEL[m.difficulty]}</small></span>
    </button>`).join('');
  el.dots.innerHTML = list.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('');
  renderBeginners();
  requestAnimationFrame(syncCarousel);
}
function renderBeginners() {
  const mo = currentMonth();
  const beginners = MOUNTAINS.filter((m) => m.difficulty <= 2).sort((a, b) => (b.bestMonths.includes(mo) - a.bestMonths.includes(mo)) || b.popular - a.popular).slice(0, 10);
  el.beginner.innerHTML = beginners.map(cardHtml).join('');
  const note = document.getElementById('beginnerNote');
  if (note) note.innerHTML = listNote();
}
function syncCarousel() {
  const c = el.carousel;
  const mid = c.scrollLeft + c.clientWidth / 2;
  let best = 0; let bestD = Infinity;
  [...c.children].forEach((s, i) => {
    const center = s.offsetLeft + s.offsetWidth / 2;
    const d = Math.abs(center - mid);
    const k = Math.min(1, d / (s.offsetWidth || 1));
    s.style.setProperty('--k', (1 - k).toFixed(3));
    if (d < bestD) { bestD = d; best = i; }
  });
  [...el.dots.children].forEach((d, i) => d.classList.toggle('active', i === best));
  c.dataset.index = String(best);
}
function bindCarousel() {
  let raf = 0;
  el.carousel.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; syncCarousel(); }); }, { passive: true });
  window.addEventListener('resize', syncCarousel);
}

// ------------------------------------------------------------------ 履歴
let lastHistory = null;
function renderHistory() {
  const list = store.getHistory().filter((h) => MOUNTAIN_BY_ID[h.id]);
  const sorted = [...list.filter((h) => h.fav), ...list.filter((h) => !h.fav)];
  el.histEmpty.hidden = sorted.length > 0;
  el.hist.innerHTML = sorted.map((h, i) => {
    const m = MOUNTAIN_BY_ID[h.id];
    const d = new Date(h.t);
    return `<li class="hitem" data-id="${m.id}" style="--i:${Math.min(i, 12)}">
      <div class="hbg hbg-fav" aria-hidden="true">${icon('star', '', true)}${h.fav ? 'お気に入り解除' : 'お気に入り'}</div>
      <div class="hbg hbg-del" aria-hidden="true">削除${icon('trash')}</div>
      <button type="button" class="hcard glass" data-id="${m.id}" aria-label="${esc(m.name)}の詳細を開く${h.fav ? '（お気に入り）' : ''}">
        <span class="hthumb">${pic(m, { w: 120, h: 90 }, 's')}</span>
        <span class="mbody"><span class="mname">${h.fav ? `<span class="fav-star" aria-hidden="true">${icon('star', '', true)}</span>` : ''}${esc(m.name)}<small>${esc(m.kana)}</small></span>
        <span class="mmeta">${esc(m.pref)}・${m.elev.toLocaleString()}m</span>
        <span class="mmeta small">${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} に表示</span></span>
      </button>
    </li>`;
  }).join('');
  for (const li of el.hist.children) bindHistoryItem(li);
}
function bindHistoryItem(li) {
  const card = li.querySelector('.hcard');
  const id = li.dataset.id;
  card.addEventListener('click', () => openMountain(id));
  onHSwipe(card, {
    onMove(dx) {
      card.style.transition = 'none';
      card.style.transform = `translateX(${dx}px)`;
      li.classList.toggle('to-del', dx < -20);
      li.classList.toggle('to-fav', dx > 20);
    },
    onEnd(dx, vx) {
      card.style.transition = '';
      const w = card.offsetWidth;
      if (dx < -Math.min(110, w * 0.3) || (dx < -40 && vx < -0.6)) {
        card.style.transform = `translateX(${-w - 40}px)`;
        li.classList.add('removing');
        setTimeout(() => removeHistory(id), 220);
      } else if (dx > Math.min(110, w * 0.3) || (dx > 40 && vx > 0.6)) {
        card.style.transform = '';
        const fav = store.toggleFav(id);
        toast(fav ? `${MOUNTAIN_BY_ID[id].name}をお気に入りに追加しました` : 'お気に入りを解除しました');
        setTimeout(renderHistory, 180);
      } else {
        card.style.transform = '';
        li.classList.remove('to-del', 'to-fav');
      }
    },
  });
}
function removeHistory(id) {
  const before = store.getHistory();
  store.setHistory(before.filter((h) => h.id !== id));
  renderHistory();
  toast(`${MOUNTAIN_BY_ID[id].name}を履歴から削除しました`, {
    action: '元に戻す',
    onAction: () => { store.setHistory(before); renderHistory(); },
  });
}
function clearHistory() {
  const before = store.getHistory();
  if (!before.length) { toast('履歴はありません'); return; }
  lastHistory = before;
  store.setHistory([]);
  renderHistory();
  toast('履歴をすべて削除しました', {
    action: '元に戻す',
    onAction: () => { store.setHistory(lastHistory); renderHistory(); },
  });
}

// ------------------------------------------------------------------ ドロワー
function openDrawer() {
  el.drawerScrim.hidden = false;
  el.drawer.inert = false;
  el.drawer.setAttribute('aria-hidden', 'false');
  requestAnimationFrame(() => { el.drawer.classList.add('open'); el.drawerScrim.classList.add('show'); });
  el.menuBtn.setAttribute('aria-expanded', 'true');
  el.menuBtn.setAttribute('aria-label', 'メニューを閉じる');
  el.menuBtn.classList.add('x');
  setTimeout(() => el.drawer.querySelector('.dnav')?.focus({ preventScroll: true }), 60);
}
function closeDrawer(focusBack = true) {
  if (!el.drawer.classList.contains('open')) return;
  el.drawer.classList.remove('open');
  el.drawerScrim.classList.remove('show');
  el.drawer.setAttribute('aria-hidden', 'true');
  el.drawer.inert = true;
  el.menuBtn.setAttribute('aria-expanded', 'false');
  el.menuBtn.setAttribute('aria-label', 'メニューを開く');
  el.menuBtn.classList.remove('x');
  setTimeout(() => { if (!el.drawer.classList.contains('open')) el.drawerScrim.hidden = true; }, 320);
  if (focusBack) el.menuBtn.focus({ preventScroll: true });
}
function bindDrawer() {
  el.menuBtn.addEventListener('click', () => (el.drawer.classList.contains('open') ? closeDrawer() : openDrawer()));
  el.drawerScrim.addEventListener('click', () => closeDrawer());
  el.drawer.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    closeDrawer(false);
    if (act === 'origin') openOriginSheet();
    else if (act === 'reco') goPage(1);
    else if (act === 'history') goPage(2);
    else if (act === 'clear') clearHistory();
    else if (act === 'about') openSheet(el.aboutSheet);
  });
}

// ------------------------------------------------------------------ シート
let sheetReturnFocus = null;
function openSheet(sheet) {
  sheetReturnFocus = document.activeElement;
  for (const s of [el.originSheet, el.aboutSheet]) if (s !== sheet && !s.hidden) closeSheet(s, false);
  el.sheetScrim.hidden = false;
  sheet.hidden = false;
  requestAnimationFrame(() => { sheet.classList.add('open'); el.sheetScrim.classList.add('show'); });
}
function closeSheet(sheet, focusBack = true) {
  if (sheet.hidden) return;
  sheet.classList.remove('open');
  el.sheetScrim.classList.remove('show');
  setTimeout(() => {
    if (!sheet.classList.contains('open')) sheet.hidden = true;
    if (![el.originSheet, el.aboutSheet].some((s) => s.classList.contains('open'))) el.sheetScrim.hidden = true;
  }, 340);
  if (focusBack && sheetReturnFocus?.isConnected) sheetReturnFocus.focus({ preventScroll: true });
}
const openSheetEl = () => [el.originSheet, el.aboutSheet].find((s) => s.classList.contains('open'));
function bindSheets() {
  el.sheetScrim.addEventListener('click', () => { const s = openSheetEl(); if (s) closeSheet(s); });
  $$('.sheet-close').forEach((b) => b.addEventListener('click', () => closeSheet(b.closest('.sheet'))));
}

// ------------------------------------------------------------------ 出発地
function renderOrigin() {
  el.originName.textContent = state.origin.name;
  el.originCurrent.textContent = state.origin.name;
  el.originChip.setAttribute('aria-label', `出発地：${state.origin.name}（タップで変更）`);
}
let geoAbort = null; let geoTimer = 0;
function renderOriginList() {
  const raw = el.originInput.value.trim();
  const q = normalize(raw);
  const stations = q
    ? STATIONS.map((s) => {
      const f = [s.name, s.kana, s.romaji, s.pref].map(normalize);
      const sc = f.slice(0, 3).some((x) => x.startsWith(q)) ? 2 : f.some((x) => x.includes(q)) ? 1 : 0;
      return { s, sc };
    }).filter((x) => x.sc).sort((a, b) => b.sc - a.sc).slice(0, 8).map((x) => x.s)
    : STATIONS.slice(0, 12);
  const items = stations.map((s, i) => `<li style="--i:${i}"><button type="button" class="oitem rp" data-kind="station" data-name="${esc(s.name)}" data-lat="${s.lat}" data-lon="${s.lon}">
      <span class="oico" aria-hidden="true">${icon('train')}</span><span><b>${esc(s.name)}</b><small>${esc(s.kana)}・${esc(s.pref)}</small></span></button></li>`);
  el.originList.innerHTML = `<li class="ohead">${q ? '駅' : '主要駅'}</li>${items.join('') || '<li class="onone">該当する駅がありません</li>'}<li class="ohead" id="geoHead" ${raw.length >= 2 ? '' : 'hidden'}>住所検索</li><li id="geoSlot"></li>`;
  clearTimeout(geoTimer);
  geoAbort?.abort();
  if (raw.length >= 2) {
    $('#geoSlot').innerHTML = '<div class="sk sk-line w80"></div><div class="sk sk-line w60"></div>';
    geoTimer = setTimeout(() => runGeocode(raw), 250);
  }
}
async function runGeocode(raw) {
  geoAbort = new AbortController();
  const signal = geoAbort.signal;
  try {
    const results = await geocode(raw, signal);
    if (signal.aborted || el.originInput.value.trim() !== raw) return;
    const slot = $('#geoSlot');
    if (!slot) return;
    slot.outerHTML = results.length
      ? results.slice(0, 6).map((r, i) => `<li style="--i:${i}"><button type="button" class="oitem rp" data-kind="address" data-name="${esc(r.name)}" data-lat="${r.lat}" data-lon="${r.lon}">
        <span class="oico" aria-hidden="true">${icon('home')}</span><span><b>${esc(r.name)}</b><small>住所検索（国土地理院）</small></span></button></li>`).join('')
      : '<li class="onone" id="geoSlot">住所が見つかりませんでした</li>';
  } catch {
    if (signal.aborted) return;
    const slot = $('#geoSlot');
    if (slot) slot.outerHTML = '<li class="onone" id="geoSlot">住所検索に失敗しました。駅名で選ぶか、時間をおいて再度お試しください。</li>';
  }
}
function openOriginSheet() {
  el.originInput.value = '';
  renderOriginList();
  openSheet(el.originSheet);
  setTimeout(() => el.originInput.focus({ preventScroll: true }), 80);
}
function setOrigin(o) {
  state.origin = o;
  store.setOrigin(o);
  renderOrigin();
  refreshLists();
  if (state.detail?.content) { renderMap(state.detail.m); renderCost(state.detail.m); }
  toast(`出発地を「${o.name}」にしました`);
}
function bindOrigin() {
  el.originChip.addEventListener('click', openOriginSheet);
  el.originInput.addEventListener('input', renderOriginList);
  el.originList.addEventListener('click', (e) => {
    const b = e.target.closest('.oitem');
    if (!b) return;
    setOrigin({ name: b.dataset.name, lat: Number(b.dataset.lat), lon: Number(b.dataset.lon), kind: b.dataset.kind });
    closeSheet(el.originSheet);
  });
  el.originInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); el.originList.querySelector('.oitem')?.click(); }
  });
}

// ------------------------------------------------------------------ 詳細
function route() {
  const mm = /^#m-([a-z0-9-]+)$/.exec(location.hash);
  const m = mm && MOUNTAIN_BY_ID[mm[1]];
  const fromApp = !!state.navFromApp;
  state.navFromApp = false;
  if (m) showDetail(m, fromApp);
  else hideDetail();
}

function closeDetail() {
  if (!state.detail) return;
  if (state.detail.pushed) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); hideDetail(); }
}

let detailReturnFocus = null;
function showDetail(m, pushed) {
  if (state.detail?.m.id === m.id) return;
  if (state.detail) teardownDetail();
  closeDrawer(false);
  for (const s of [el.originSheet, el.aboutSheet]) closeSheet(s, false);
  hideToast();
  store.pushHistory(m.id);
  if (state.page === 2) renderHistory();
  if (!el.detail.classList.contains('open')) detailReturnFocus = document.activeElement;
  const token = Symbol(m.id);
  const abort = new AbortController();
  state.detail = { m, token, pushed, abort, weather: null, content: false };
  el.detail.hidden = false;
  el.detail.classList.remove('closing');
  el.detailScroll.scrollTop = 0;
  el.detailScroll.innerHTML = detailSkeleton();
  el.detail.setAttribute('aria-busy', 'true');
  document.title = `${m.name}｜やまナビ`;
  requestAnimationFrame(() => el.detail.classList.add('open'));
  // 天気は並行して取得
  getWeather(m, abort.signal)
    .then((w) => { if (state.detail?.token === token) { state.detail.weather = { ok: true, w }; fillWeather(); } })
    .catch(() => { if (state.detail?.token === token && !abort.signal.aborted) { state.detail.weather = { ok: false }; fillWeather(); } });
  setTimeout(() => {
    if (state.detail?.token !== token) return;
    el.detailScroll.innerHTML = detailHtml(m);
    el.detail.removeAttribute('aria-busy');
    state.detail.content = true;
    bindDetail(m);
    renderMap(m);
    renderCost(m, true);
    fillWeather();
    $('.dt-back', el.detail)?.focus({ preventScroll: true });
  }, reducedMotion() ? 120 : DETAIL_SKELETON_MS);
}

function teardownDetail() {
  state.detail?.abort.abort();
  state.detail?.map?.destroy();
  state.detail = null;
}

function hideDetail() {
  if (!state.detail) return;
  teardownDetail();
  document.title = 'やまナビ';
  el.detail.classList.remove('open');
  el.detail.classList.add('closing');
  setTimeout(() => {
    if (state.detail) return;
    el.detail.hidden = true;
    el.detail.classList.remove('closing');
    el.detailScroll.innerHTML = '';
  }, reducedMotion() ? 0 : 380);
  if (state.page === 2) renderHistory();
  if (detailReturnFocus?.isConnected) detailReturnFocus.focus({ preventScroll: true });
}

function detailSkeleton() {
  return `<div class="detail-skel" aria-label="読み込み中">
    <div class="sk sk-hero"></div>
    <div class="dt-body">
      <div class="sk-block glass"><div class="sk sk-line w40"></div><div class="sk-row"><div class="sk sk-box"></div><div class="sk sk-box"></div><div class="sk sk-box"></div></div><div class="sk sk-line w90"></div></div>
      <div class="sk-block glass"><div class="sk sk-line w50"></div><div class="sk-row"><div class="sk sk-day"></div><div class="sk sk-day"></div><div class="sk sk-day"></div><div class="sk sk-day"></div><div class="sk sk-day"></div></div></div>
      <div class="sk-block glass"><div class="sk sk-line w30"></div><div class="sk sk-map"></div></div>
    </div></div>`;
}

const WINTER_CLIMB = { ok: ['冬も登れる', 'ok'], snow: ['雪山装備が必要', 'snow'], closed: ['冬季閉山', 'closed'] };

function detailHtml(m) {
  const mo = currentMonth();
  const fav = store.isFav(m.id);
  const wc = WINTER_CLIMB[m.winter.climb];
  const months = Array.from({ length: 12 }, (_, i) => i + 1).map((k) =>
    `<li class="m${m.bestMonths.includes(k) ? ' on' : ''}${k === mo ? ' now' : ''}" style="--i:${k}" aria-label="${k}月${m.bestMonths.includes(k) ? '（適期）' : ''}${k === mo ? '・今月' : ''}"><span class="bar"></span><span class="ml">${k}</span></li>`).join('');
  const rw = m.access.ropeway;
  return `<article class="dt-content">
  <header class="hero">
    <div class="hero-art">${pic(m, { w: 390, h: 260 }, 'hero')}</div>
    <div class="hero-shade"></div>
    <button type="button" class="hero-btn dt-back glass rp" aria-label="戻る"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    <button type="button" class="hero-btn dt-fav glass rp" aria-pressed="${fav}" aria-label="お気に入り">${icon('star', '', fav)}</button>
    ${PHOTOS[m.id] ? `<p class="hero-credit">${photoCredit(m)}</p>` : ''}
    <div class="hero-text">
      <p class="hero-kana">${esc(m.kana)}</p>
      <h2 id="dtTitle">${esc(m.name)}</h2>
      <p class="hero-meta">${esc(m.pref)}・${esc(m.area)}・${m.elev.toLocaleString()}m</p>
    </div>
  </header>
  <div class="dt-body">
    <section class="card glass in" style="--i:0" aria-labelledby="h-ov">
      <h3 id="h-ov">概要</h3>
      <div class="stats">
        <div class="stat dt-difficulty"><span class="k">難易度</span>
          <span class="dots5" role="img" aria-label="難易度 ${m.difficulty}/5（${DIFFICULTY_LABEL[m.difficulty]}）">${[1, 2, 3, 4, 5].map((k) => `<i class="dot${k <= m.difficulty ? ' on' : ''}"></i>`).join('')}</span>
          <b>${DIFFICULTY_LABEL[m.difficulty]}</b></div>
        <div class="stat dt-time"><span class="k">標準タイム</span><b>${fmtDuration(m.courseTime)}</b><small>${esc(m.course)}</small></div>
        <div class="stat"><span class="k">標高</span><b>${m.elev.toLocaleString()}<small>m</small></b></div>
        <div class="stat"><span class="k">冬季</span><b class="wc wc-${wc[1]}">${wc[0]}</b></div>
      </div>
      <div class="season-head"><span class="k">適期</span><small>${m.bestMonths.includes(mo) ? '今月は適期です' : `今月（${mo}月）は適期外`}</small></div>
      <ol class="months" aria-label="適期">${months}</ol>
    </section>

    <section class="card glass in" style="--i:1" aria-labelledby="h-tk" id="tenkura" aria-busy="true">
      <div class="card-head"><h3 id="h-tk">登山指数</h3><span class="legend"><i class="g gA">A</i>登山に適す <i class="g gB">B</i>やや適す <i class="g gC">C</i>適さない</span></div>
      <div class="tk-days" id="tkDays">${Array.from({ length: 5 }, () => '<div class="sk sk-day"></div>').join('')}</div>
      <p class="tk-basis">${TENKURA_BASIS}（山頂${m.elev.toLocaleString()}m）。公式の予報は <a class="tenkura-link" href="${TENKURA_URL}" target="_blank" rel="noopener">てんきとくらす</a> で確認してください。</p>
    </section>

    <section class="card glass in" style="--i:2" aria-labelledby="h-map">
      <div class="card-head"><h3 id="h-map">地図</h3><button type="button" class="link-btn rp" id="dtOrigin">出発地：<b>${esc(state.origin.name)}</b> ▸</button></div>
      <div class="map" id="map" role="img" aria-label="出発地と登山口の地図"></div>
      <div class="map-legend"><span><i class="lg s">S</i>出発地</span><span><i class="lg g">G</i>${esc(m.trailhead.name)}</span></div>
      <div class="gmap-links" id="gmapLinks"></div>
    </section>

    <section class="card glass in cost-card" style="--i:3" aria-labelledby="h-cost" id="costCard">
      <div class="card-head"><h3 id="h-cost">往復交通費・移動時間</h3>
        <div class="season-toggle" role="group" aria-label="季節">
          <button type="button" data-season="summer" aria-pressed="false">${icon('sun')}夏季</button>
          <button type="button" data-season="winter" aria-pressed="false">${icon('snowflake')}冬季</button>
          <span class="seg-ind" aria-hidden="true"></span>
        </div></div>
      <p class="swipe-hint">カードを左右にフリックしても切り替えられます</p>
      <div class="cost-body" id="costBody"></div>
    </section>

    <section class="card glass in" style="--i:4" aria-labelledby="h-course">
      <h3 id="h-course">コース情報</h3>
      <dl class="info">
        <dt>コース</dt><dd>${esc(m.course)}（${fmtDuration(m.courseTime)}）</dd>
        <dt>登山口</dt><dd>${esc(m.trailhead.name)}</dd>
        <dt>最寄り駅</dt><dd>${esc(m.access.station)}${m.access.bus ? `<br><small>${esc(m.access.bus.note)}（片道${m.access.bus.fare.toLocaleString()}円・約${m.access.bus.min}分）</small>` : m.access.walk ? '<br><small>駅から徒歩</small>' : `<br><small>路線バスなし（タクシー約${m.access.taxi.km}km）</small>`}</dd>
        ${rw ? `<dt>ロープウェイ等</dt><dd>${esc(rw.name)}：${rw.fare.toLocaleString()}円${rw.required ? '（利用前提）' : '（任意）'}</dd>` : ''}
        <dt>駐車場</dt><dd>${esc(m.parking.name)}（${m.parking.fee ? m.parking.fee.toLocaleString() + '円/日' : '無料'}）${m.carShuttle ? `<br><small>${esc(m.carShuttle.note)}</small>` : ''}</dd>
        <dt>入山料</dt><dd>${m.fee ? m.fee.toLocaleString() + '円' : 'なし'}${m.feeNote ? `<br><small>${esc(m.feeNote)}</small>` : ''}</dd>
        <dt>冬季の注意</dt><dd>${esc(m.winter.note)}</dd>
        ${PHOTOS[m.id] ? `<dt>写真</dt><dd><small>${photoCredit(m)}</small></dd>` : ''}
      </dl>
      <div class="tags-row">${m.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    </section>

    <p class="disclaimer in" style="--i:5">※ 交通費・移動時間は出発地からの直線距離をもとにした<b>概算</b>です（車：燃費${COST.kmPerL.summer}km/L（冬${COST.kmPerL.winter}）・ガソリン${COST.gasYen}円/L、公共交通：距離制の目安運賃）。実際の運賃・料金・規制・運行状況は各公式情報を必ず確認してください。</p>
  </div>
</article>`;
}

function bindDetail(m) {
  $('.dt-back', el.detail).addEventListener('click', closeDetail);
  $('.dt-fav', el.detail).addEventListener('click', (e) => {
    store.pushHistory(m.id);
    const fav = store.toggleFav(m.id);
    e.currentTarget.setAttribute('aria-pressed', String(fav));
    e.currentTarget.innerHTML = icon('star', '', fav);
    e.currentTarget.classList.remove('pop'); void e.currentTarget.offsetWidth; e.currentTarget.classList.add('pop');
    toast(fav ? 'お気に入りに追加しました' : 'お気に入りを解除しました');
  });
  $('#dtOrigin').addEventListener('click', openOriginSheet);
  $$('.season-toggle button', el.detail).forEach((b) => b.addEventListener('click', () => setSeason(b.dataset.season)));
  const card = $('#costCard');
  onHSwipe(card, {
    onMove(dx) { card.style.setProperty('--dx', `${Math.max(-40, Math.min(40, dx / 3))}px`); card.classList.add('swiping'); },
    onEnd(dx) {
      card.classList.remove('swiping');
      card.style.setProperty('--dx', '0px');
      if (dx < -50) setSeason('winter');
      else if (dx > 50) setSeason('summer');
    },
  });
}

function setSeason(s) {
  if (state.season === s) return;
  state.season = s;
  if (state.detail?.content) renderCost(state.detail.m, true);
  refreshLists();
}

function renderMap(m) {
  const d = state.detail;
  const host = $('#map');
  if (!host) return;
  const road = haversineKm(state.origin, m.trailhead) * COST.roadFactor + COST.roadAdd;
  if (!d.map) d.map = new TileMap(host);
  d.map.setPoints(state.origin, m.trailhead, `道路 約${Math.round(road).toLocaleString()}km（目安）`);
  const o = `${state.origin.lat},${state.origin.lon}`; const g = `${m.trailhead.lat},${m.trailhead.lon}`;
  const gm = (mode) => `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${g}&travelmode=${mode}`;
  $('#gmapLinks').innerHTML = `<a class="gbtn rp" href="${gm('driving')}" target="_blank" rel="noopener">${icon('car')}Googleマップ（車）</a><a class="gbtn rp" href="${gm('transit')}" target="_blank" rel="noopener">${icon('train')}Googleマップ（電車）</a>`;
  const ob = $('#dtOrigin b');
  if (ob) ob.textContent = state.origin.name;
}

function costCol(c, kind, m) {
  const title = kind === 'car' ? `${icon('car')}車` : `${icon('train')}公共交通`;
  if (!c.available) {
    return `<div class="cost-col cost-${kind} na"><h4>${title}</h4><div class="amount na" data-value="">利用不可</div><p class="na-reason">${esc(c.reason)}</p></div>`;
  }
  return `<div class="cost-col cost-${kind}"><h4>${title}</h4>
    <div class="amount" data-value="${c.total}">¥0</div>
    <div class="ctime">片道 約${fmtDuration(c.hours)}</div>
    <ul class="breakdown">${c.items.filter((x) => x[1] > 0 || x[0] === '鉄道運賃').map(([k, v, s]) => `<li><span class="bk-k">${esc(k)}</span><b>${yen(v)}</b>${s ? `<small>${esc(s)}</small>` : ''}</li>`).join('')}</ul>
</div>`;
}

function renderCost(m, animate) {
  const body = $('#costBody');
  if (!body) return;
  const winter = state.season === 'winter';
  $$('.season-toggle button', el.detail).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.season === state.season)));
  $('.season-toggle', el.detail).dataset.season = state.season;
  $('#costCard').dataset.season = state.season;
  const prev = Object.fromEntries($$('.amount', body).map((a) => [a.closest('.cost-col').classList.contains('cost-car') ? 'car' : 'transit', a.dataset.value]));
  const c = calcAll(m, state.origin, state.season);
  const noteMap = new Map();
  for (const [who, x] of [['car', c.car], ['transit', c.transit]]) {
    for (const n of x.available ? x.notes : []) {
      const e = noteMap.get(n.text) || { ...n, who: new Set() };
      e.who.add(who);
      noteMap.set(n.text, e);
    }
  }
  const whoIcon = (w) => (w.size === 2 ? ['info', '共通'] : w.has('car') ? ['car', '車'] : ['train', '公共交通']);
  const notes = [...noteMap.values()].map((n) => {
    const [ic, label] = whoIcon(n.who);
    return `<li class="cost-note n-${n.type}"><span class="who" role="img" aria-label="${label}">${icon(ic)}</span><span>${esc(n.text)}</span></li>`;
  }).join('');
  body.innerHTML = `<div class="cost-cols">${costCol(c.car, 'car', m)}${costCol(c.transit, 'transit', m)}</div>
    ${notes ? `<ul class="notes">${notes}</ul>` : ''}
    ${winter ? `<div class="winter-note" role="note"><b>冬季の注意</b>${esc(m.winter.note)}</div>` : ''}
    <p class="cost-from">${esc(state.origin.name)}発・${winter ? '冬季' : '夏季'}の往復概算</p>`;
  body.classList.remove('flip'); void body.offsetWidth; body.classList.add('flip');
  for (const a of $$('.amount', body)) {
    if (!a.dataset.value) continue;
    const kind = a.closest('.cost-car') ? 'car' : 'transit';
    a.dataset.from = prev[kind] || 0;
    countUp(a, Number(a.dataset.value), { dur: animate ? 900 : 1 });
  }
}

function fillWeather() {
  const d = state.detail;
  const box = $('#tkDays');
  if (!d || !d.content || !box || !d.weather) return;
  const card = $('#tenkura');
  card.removeAttribute('aria-busy');
  if (!d.weather.ok) {
    box.innerHTML = `<div class="tk-error" role="alert"><b>天気予報を取得できませんでした</b><span>通信状況を確認するか、<a class="tenkura-link" href="${TENKURA_URL}" target="_blank" rel="noopener">てんきとくらす（公式）</a>で登山指数を確認してください。</span></div>`;
    return;
  }
  box.innerHTML = d.weather.w.days.map((day, i) => {
    const dt = new Date(day.date + 'T00:00:00+09:00');
    const label = `${dt.getMonth() + 1}/${dt.getDate()}(${WEEK[dt.getDay()]})`;
    return `<div class="tk-day g${day.grade}" style="--i:${i}" title="${esc(day.reasons.join('・') || '登山に適しています')}">
      <span class="tk-date">${label}</span>
      <span class="grade g${day.grade}" aria-label="登山指数${day.grade}">${day.grade}</span>
      <span class="tk-ico" aria-hidden="true">${icon(/^[a-z-]+$/.test(day.icon) ? day.icon : 'unknown')}</span>
      <span class="tk-w">${esc(day.label)}</span>
      <span class="tk-t"><b class="hi">${day.tmax ?? '-'}°</b>/<b class="lo">${day.tmin ?? '-'}°</b></span>
      <span class="tk-wind">風 ${day.wind}m/s</span>
      <span class="tk-p">${day.precip}mm</span>
    </div>`;
  }).join('');
}

// ------------------------------------------------------------------ キーボード
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const s = openSheetEl();
    if (s) { closeSheet(s); return; }
    if (el.drawer.classList.contains('open')) { closeDrawer(); return; }
    if (state.detail) closeDetail();
  });
}

// ------------------------------------------------------------------ 起動
function boot() {
  for (const d of $$('[data-icon]')) d.innerHTML = icon(d.dataset.icon);
  // 写真が読み込めなければ下のイラストを見せる
  document.addEventListener('error', (e) => { if (e.target?.classList?.contains('mphoto')) e.target.remove(); }, true);
  document.addEventListener('load', (e) => { if (e.target?.classList?.contains('mphoto')) e.target.classList.add('loaded'); }, true);
  const mc = document.getElementById('mtCount');
  if (mc) mc.textContent = String(MOUNTAINS.length);
  installRipple();
  renderOrigin();
  renderChips();
  renderResults();
  renderReco();
  bindSearch();
  bindPager();
  bindCarousel();
  bindDrawer();
  bindSheets();
  bindOrigin();
  bindKeys();
  window.addEventListener('hashchange', route);
  route();
  const sk = $('#bootSkeleton');
  const wait = Math.max(0, BOOT_MIN_MS - performance.now());
  setTimeout(() => {
    sk.classList.add('hide');
    document.documentElement.dataset.ready = '1';
    setTimeout(() => sk.remove(), reducedMotion() ? 0 : 420);
  }, wait);
  if (!state.detail && document.activeElement !== el.q && document.activeElement === document.body) el.q.focus();
}

boot();
