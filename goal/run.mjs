// やまナビ E2E テスト（Playwright + 実 Chrome / iPhone 相当のタッチ環境）
//   npm test
// 開発サーバー（scripts/dev-server.mjs）を MOCK_UPSTREAM=1 で起動し、実ブラウザで操作する。
// 横フリックは CDP の Input.dispatchTouchEvent による本物のタッチ操作で行う。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const shotsDir = path.join(here, 'screenshots');
const PORT = Number(process.env.E2E_PORT || 8911);
const FAIL_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const FAIL_BASE = `http://127.0.0.1:${FAIL_PORT}`;
const TENKURA = 'https://tenkura.n-kishou.co.jp/tk/';
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

// 1x1 の淡いグレー PNG（地図タイルのスタブ）
const TILE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP48ePHfwAJ9AP5hX/9MwAAAABJRU5ErkJggg==', 'base64');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const p of ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (existsSync(p)) return p;
  return undefined; // Playwright 同梱の Chromium
}

// ------------------------------------------------------------------ サーバー
async function startServer(port, env) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/dev-server.mjs')], {
    cwd: root, env: { ...process.env, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return child; } catch { /* 起動待ち */ }
    await sleep(100);
  }
  child.kill();
  throw new Error('dev-server が起動しませんでした\n' + log);
}

// ------------------------------------------------------------------ ブラウザ
let browser;
const tileStats = { total: 0 };

async function session({ base = BASE, allowConsole = [], allowHosts = [] } = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'ja-JP', timezoneId: 'Asia/Tokyo', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 yama-navi-e2e',
  });
  const s = { context, errors: [], external: [], tiles: 0, base };
  await context.addInitScript(() => {
    window.__boot = { seen: false, seenAt: 0, hiddenAt: 0 };
    const tick = () => {
      const el = document.getElementById('bootSkeleton');
      if (el && !window.__boot.seen) {
        const r = el.getBoundingClientRect();
        if (r.height > 200 && Number(getComputedStyle(el).opacity) > 0.5) { window.__boot.seen = true; window.__boot.seenAt = performance.now(); }
      }
      if (window.__boot.seen && (!el || !el.isConnected || el.classList.contains('hide'))) { window.__boot.hiddenAt = performance.now(); return; }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return route.continue();
    if (u.hostname === 'cyberjapandata.gsi.go.jp' && u.pathname.startsWith('/xyz/pale/')) {
      s.tiles++; tileStats.total++;
      return route.fulfill({ status: 200, contentType: 'image/png', body: TILE_PNG, headers: { 'access-control-allow-origin': '*' } });
    }
    if (allowHosts.includes(u.hostname)) return route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
    s.external.push(u.href);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => s.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (allowConsole.some((re) => re.test(t))) return;
    s.errors.push('console.error: ' + t);
  });
  s.page = page;
  s.cdp = await context.newCDPSession(page);
  return s;
}

// ---- 本物のタッチ操作（CDP Input.dispatchTouchEvent） ----
async function touchSwipe(s, x1, y1, x2, y2, { steps = 10, ms = 120, hold = 0 } = {}) {
  const tp = (x, y) => [{ x: Math.round(x), y: Math.round(y), radiusX: 4, radiusY: 4, force: 1, id: 1 }];
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(x1, y1) });
  if (hold) await sleep(hold);
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k) });
    await sleep(ms / steps);
  }
  await s.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function flickEl(s, selector, dir, { dist = 0.6, y = 0.5, ms = 120, steps = 10 } = {}) {
  await s.page.locator(selector).first().scrollIntoViewIfNeeded();
  const box = await s.page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`要素が見つかりません: ${selector}`);
  const cy = box.y + box.height * y;
  const span = Math.min(box.width, 390) * dist;
  const cx = box.x + box.width / 2;
  const x1 = dir === 'left' ? cx + span / 2 : cx - span / 2;
  const x2 = dir === 'left' ? cx - span / 2 : cx + span / 2;
  await touchSwipe(s, x1, cy, x2, cy, { ms, steps });
}

// ---- アサーション ----
class AssertError extends Error {}
function assert(cond, msg) { if (!cond) throw new AssertError(msg); }
async function waitFor(s, fn, arg, { timeout = 5000, msg = '条件' } = {}) {
  try {
    await s.page.waitForFunction(fn, arg, { timeout, polling: 50 });
  } catch {
    throw new AssertError(`${msg}（${timeout}ms 以内に満たされませんでした）`);
  }
}
const text = (s, sel) => s.page.locator(sel).first().innerText();

// ---- アプリ操作 ----
async function load(s, hash = '') {
  await s.page.goto(s.base + '/' + hash, { waitUntil: 'domcontentloaded' });
  await waitFor(s, () => document.documentElement.dataset.ready === '1' && !document.getElementById('bootSkeleton'), null, { msg: '起動完了' });
}
async function search(s, q) {
  await s.page.fill('#q', q);
  await sleep(60);
}
async function openBySearch(s, q, name) {
  await search(s, q);
  await s.page.locator('#q').press('Enter');
  await waitDetail(s, name);
}
async function waitDetail(s, name) {
  await waitFor(s, (n) => document.querySelector('#detail .dt-content h2')?.textContent === n
    && document.querySelector('#detail').classList.contains('open'), name, { msg: `詳細「${name}」の表示` });
  await settle(s, '#detail');
}
/** 指定要素内の有限アニメーション（シートのスプリング・カードの登場など）が終わるまで待つ */
async function settle(s, sel) {
  await sleep(50);
  await waitFor(s, (q) => {
    const el = document.querySelector(q);
    return el && el.getAnimations({ subtree: true }).every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity);
  }, sel, { timeout: 4000, msg: 'アニメーション完了' });
}
async function closeDetail(s) {
  await s.page.locator('#detail .dt-back').click();
  await waitFor(s, () => document.getElementById('detail').hidden, null, { msg: '詳細が閉じる' });
}
async function amounts(s) {
  return s.page.evaluate(() => ({
    car: document.querySelector('.cost-car .amount')?.dataset.value,
    transit: document.querySelector('.cost-transit .amount')?.dataset.value,
    carText: document.querySelector('.cost-car .amount')?.textContent,
    transitText: document.querySelector('.cost-transit .amount')?.textContent,
  }));
}
async function setSeason(s, season) {
  await s.page.locator(`.season-toggle button[data-season="${season}"]`).click();
  await waitFor(s, (x) => document.querySelector(`.season-toggle button[data-season="${x}"]`)?.getAttribute('aria-pressed') === 'true', season, { msg: `季節=${season}` });
  await settle(s, '#costCard');
}
async function shot(s, name) {
  await s.page.screenshot({ path: path.join(shotsDir, name + '.png') });
  shots.push(name + '.png');
}
async function scrollDetailTo(s, sel, block = 'start') {
  await s.page.evaluate(([q, b]) => {
    const el = document.querySelector(q);
    const sc = document.getElementById('detailScroll');
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    sc.scrollTop = b === 'center' ? top - (sc.clientHeight - el.offsetHeight) / 2 : top - 12;
  }, [sel, block]);
  await sleep(150);
}

// ------------------------------------------------------------------ テスト
const shots = [];
const tests = [];
const T = (name, fn, opt = {}) => tests.push({ name, fn, opt });

T('起動直後に検索欄へフォーカスし「たかお」で高尾山が先頭', async (s) => {
  await s.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const active = await s.page.evaluate(() => document.activeElement?.id);
  assert(active === 'q', `フォーカス先が検索欄ではありません: ${active}`);
  await s.page.keyboard.type('たかお');
  await waitFor(s, () => document.documentElement.dataset.ready === '1', null, { msg: '起動完了' });
  await waitFor(s, () => document.querySelector('#results .mname')?.textContent.startsWith('高尾山'), null, { msg: '先頭が高尾山' });
  assert(await s.page.inputValue('#q') === 'たかお', '入力値が保持されていません');
  await waitFor(s, () => !document.getElementById('bootSkeleton'), null);
  await shot(s, '01-search-takao');
});

T('起動スケルトンが表示されてから消える', async (s) => {
  await s.page.goto(BASE + '/', { waitUntil: 'commit' });
  await waitFor(s, () => window.__boot?.seen, null, { msg: '起動スケルトンの表示' });
  await waitFor(s, () => !document.getElementById('bootSkeleton'), null, { msg: '起動スケルトンが消える' });
  const b = await s.page.evaluate(() => window.__boot);
  assert(b.hiddenAt > 0, 'スケルトンの終了を検出できません');
  const shown = b.hiddenAt; // ナビゲーション開始からの経過ms
  assert(shown >= 350, `スケルトンの表示時間が短すぎます: ${Math.round(shown)}ms`);
  // スケルトン表示中も検索欄に入力できる
  await s.page.goto(BASE + '/', { waitUntil: 'commit' });
  await s.page.waitForSelector('#q');
  await s.page.locator('#q').pressSequentially('ふじ');
  const stillSkeleton = await s.page.evaluate(() => !!document.getElementById('bootSkeleton'));
  await waitFor(s, () => document.querySelector('#results .mname')?.textContent.startsWith('富士山'), null, { msg: 'スケルトン中の入力が反映' });
  return `スケルトン表示〜消失: 約${Math.round(shown)}ms（入力時スケルトン表示中=${stillSkeleton}）`;
});

T('検索：タカオ／takao／八ヶ岳／ふじ／北海道・該当なし・クリア', async (s) => {
  await load(s);
  const first = () => s.page.evaluate(() => [...document.querySelectorAll('#results .mcard')].map((c) => c.querySelector('.mname').firstChild.textContent));
  await search(s, 'タカオ'); assert((await first())[0] === '高尾山', 'タカオ → 高尾山が先頭でない');
  await search(s, 'takao'); assert((await first())[0] === '高尾山', 'takao → 高尾山が先頭でない');
  await search(s, 'ＴＡＫＡＯ'); assert((await first())[0] === '高尾山', '全角 ＴＡＫＡＯ → 高尾山が先頭でない');
  await search(s, '八ヶ岳'); const y = await first(); assert(y.includes('赤岳') && y.includes('蓼科山'), `八ヶ岳 → 赤岳・蓼科山が出ない: ${y}`);
  await search(s, 'ふじ'); assert((await first())[0] === '富士山', 'ふじ → 富士山が先頭でない');
  await search(s, '北海道'); const h = await first();
  const hp = await s.page.evaluate(() => [...document.querySelectorAll('#results .mcard .mmeta')].map((e) => e.textContent));
  assert(h.includes('旭岳') && h.includes('羊蹄山') && h.length >= 2 && hp.every((t) => t.startsWith('北海道')), `北海道 → 北海道の山だけ: ${h}`);
  await shot(s, '03-search-hokkaido');
  await search(s, 'ぞぞぞぞ');
  await waitFor(s, () => !document.getElementById('noResult').hidden, null, { msg: '該当なし表示' });
  assert((await text(s, '#noResult')).includes('見つかりません'), '該当なしの文言');
  assert(await s.page.locator('#results .mcard').count() === 0, '該当なしなのに結果がある');
  await shot(s, '03-search-noresult');
  assert(await s.page.locator('#qClear').isVisible(), 'クリアボタンが見えない');
  await s.page.locator('#qClear').click();
  assert(await s.page.inputValue('#q') === '', 'クリアされない');
  assert(!(await s.page.locator('#qClear').isVisible()), 'クリア後もボタンが見える');
  assert(await s.page.evaluate(() => document.activeElement.id) === 'q', 'クリア後に検索欄へフォーカスが戻らない');
  const n = await s.page.locator('#results .mcard').count();
  assert(n >= 30, `全件表示に戻らない: ${n}`);
  assert((await text(s, '#resultHead')).startsWith('人気の山（タップで詳細）'), `見出し: ${await text(s, '#resultHead')}`);
  return `全${n}座`;
});

T('絞り込み：初心者向け（難易度2以下）・百名山（100座）・出発地から近い順', async (s) => {
  await load(s);
  const all = await s.page.locator('#results .mcard').count();
  const chip = s.page.locator('.chip', { hasText: '初心者向け' });
  await chip.click();
  assert(await chip.getAttribute('aria-pressed') === 'true', 'aria-pressed が true にならない');
  const lv = await s.page.evaluate(() => [...document.querySelectorAll('#results .mcard')].map((c) => Number(/lv(\d)/.exec(c.querySelector('[class*="lv"]').className)[1])));
  assert(lv.length > 0 && lv.length < all, `件数が変わらない: ${lv.length}/${all}`);
  assert(lv.every((x) => x <= 2), `難易度3以上が混ざる: ${lv}`);
  await shot(s, '04-chip-beginner');
  await s.page.locator('.chip', { hasText: '日帰り' }).click();
  const both = await s.page.locator('#results .mcard').count();
  assert(both <= lv.length, 'チップの組み合わせが効かない');
  await s.page.locator('.chip', { hasText: '日帰り' }).click();
  await chip.click();
  assert(await s.page.locator('#results .mcard').count() === all, '解除で全件に戻らない');
  // 一覧の季節切替
  await s.page.locator('#resultHead [data-season-btn="winter"]').click();
  await waitFor(s, () => document.querySelector('#resultHead [data-season-btn="winter"]')?.getAttribute('aria-pressed') === 'true'
    && document.querySelector('#resultHead .ln-text').textContent.includes('冬季'), null, { msg: '一覧の季節が冬季になる' });
  const naW = await s.page.evaluate(() => document.querySelectorAll('#results .mstat b.na').length);
  assert(naW > 0, '冬季に「冬季不可」の山が表示されない');
  await shot(s, '04-list-winter');
  await s.page.locator('#resultHead [data-season-btn="summer"]').click();
  await waitFor(s, () => document.querySelector('#resultHead .ln-text').textContent.includes('夏季')
    && document.querySelectorAll('#results .mstat b.na').length < 5, null, { msg: '一覧の季節が夏季に戻る' });
  // 百名山
  const hy = s.page.locator('.chip', { hasText: '百名山' });
  await hy.click();
  const nHy = await s.page.locator('#results .mcard').count();
  assert(nHy === 100, `百名山が100座でない: ${nHy}`);
  await hy.click();
  // 出発地から近い順（東京駅発）
  const dists = () => s.page.evaluate(() => [...document.querySelectorAll('#results .mcard .mmeta')].map((e) => Number(/出発地から約([\d,]+)km/.exec(e.textContent)[1].replace(/,/g, ''))));
  const near = s.page.locator('.sort-chip');
  await near.click();
  assert(await near.getAttribute('aria-pressed') === 'true', '近い順が押下状態にならない');
  const d = await dists();
  assert(d.length === all && d.every((x, i) => i === 0 || d[i - 1] <= x), `近い順に並んでいない: ${d.slice(0, 8)}`);
  const firstNear = await s.page.evaluate(() => document.querySelector('#results .mname').firstChild.textContent);
  await shot(s, '04-sort-near');
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(s, () => document.documentElement.dataset.ready === '1', null, { msg: 'リロード' });
  assert(await s.page.locator('.sort-chip').getAttribute('aria-pressed') === 'true', '近い順がリロード後に保持されない');
  await s.page.locator('.sort-chip').click();
  assert(await s.page.locator('.sort-chip').getAttribute('aria-pressed') === 'false', '近い順を解除できない');
  return `全${all}座 → 初心者向け${lv.length}座・百名山${nHy}座・近い順の先頭「${firstNear}」`;
});

T('詳細：スケルトン→難易度・標準タイム・適期12ヶ月・登山指数ABCAB・てんくらリンク', async (s) => {
  await load(s);
  await search(s, 'たかお');
  await s.page.locator('#results .mcard').first().tap();
  await waitFor(s, () => !!document.querySelector('#detail .detail-skel'), null, { timeout: 1500, msg: '詳細スケルトン' });
  await shot(s, '05-detail-skeleton');
  await waitDetail(s, '高尾山');
  const r = await s.page.evaluate(() => ({
    dots: document.querySelectorAll('.dt-difficulty .dot.on').length,
    dotsAll: document.querySelectorAll('.dt-difficulty .dot').length,
    level: document.querySelector('.dt-difficulty b').textContent,
    time: document.querySelector('.dt-time').innerText,
    months: document.querySelectorAll('.months .m').length,
    on: document.querySelectorAll('.months .m.on').length,
    now: document.querySelectorAll('.months .m.now').length,
  }));
  assert(r.dotsAll === 5 && r.dots === 1 && r.level === '初級', `難易度表示: ${JSON.stringify(r)}`);
  assert(r.time.includes('標準タイム') && r.time.includes('3時間') && r.time.includes('1号路'), `標準タイム: ${r.time}`);
  const tile = await s.page.evaluate(() => document.querySelector('#results .mstat .k')?.textContent);
  assert(tile === '標準タイム', `一覧の表記: ${tile}`);
  assert(r.months === 12 && r.on === 6 && r.now === 1, `適期バー: ${JSON.stringify(r)}`);
  await waitFor(s, () => document.querySelectorAll('#tkDays .tk-day').length === 5, null, { msg: '登山指数5日分' });
  const grades = await s.page.evaluate(() => [...document.querySelectorAll('#tkDays .grade')].map((g) => g.textContent).join(''));
  assert(grades === 'ABCAB', `登山指数がフィクスチャと一致しない: ${grades}`);
  const basis = await text(s, '.tk-basis');
  assert(basis.includes('てんくら基準・山頂標高の予報から独自算出'), '算出方法の明記がない');
  const href = await s.page.locator('#tenkura .tenkura-link').getAttribute('href');
  assert(href === TENKURA, `てんくらリンク: ${href}`);
  await shot(s, '05-detail-top');
  await scrollDetailTo(s, '#tenkura');
  await shot(s, '05-detail-tenkura');
  return `難易度${r.level}・適期${r.on}/12・指数${grades}`;
});

T('地図：S/Gマーカー・ルート線・タイル要求・2点が収まる・ドラッグ・ズーム', async (s) => {
  await load(s);
  await openBySearch(s, 'たかお', '高尾山');
  await scrollDetailTo(s, '#map', 'center');
  await sleep(1400); // ピン落下・ルート描画アニメーション
  const geo = await s.page.evaluate(() => {
    const m = document.getElementById('map').getBoundingClientRect();
    const pin = (q) => { const r = document.querySelector(q + ' .pin-in').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, r }; };
    const ps = pin('.pin-s'); const pg = pin('.pin-g');
    const inside = (p) => p.r.left >= m.left && p.r.right <= m.right && p.r.top >= m.top && p.r.bottom <= m.bottom;
    const route = document.querySelector('#map .route');
    return {
      inS: inside(ps), inG: inside(pg), d: route.getAttribute('d'), len: route.getTotalLength(),
      zoom: Number(document.getElementById('map').dataset.zoom), center: document.getElementById('map').dataset.center,
      tiles: document.querySelectorAll('#map img.tile').length, label: document.querySelector('.tmap-label').textContent,
      gmaps: [...document.querySelectorAll('#gmapLinks a')].map((a) => a.href),
    };
  });
  assert(geo.inS && geo.inG, `S/G が地図内に収まらない: S=${geo.inS} G=${geo.inG}`);
  assert(/^M[\d.\-]+ [\d.\-]+ Q/.test(geo.d) && geo.len > 30, `ルート線が描かれていない: ${geo.d}`);
  assert(geo.tiles > 0 && s.tiles > 0, `タイル要求がない: img=${geo.tiles} req=${s.tiles}`);
  assert(/道路 約\d+km（目安）/.test(geo.label), `距離ラベル: ${geo.label}`);
  assert(geo.gmaps.length === 2 && geo.gmaps[0].includes('travelmode=driving') && geo.gmaps[1].includes('travelmode=transit'), 'Googleマップ経路リンク');
  await shot(s, '06-map');
  // ドラッグ（タッチ）
  const box = await s.page.locator('#map').boundingBox();
  const before = geo.center;
  const tilesBefore = s.tiles;
  await touchSwipe(s, box.x + box.width * 0.5, box.y + box.height * 0.6, box.x + box.width * 0.2, box.y + box.height * 0.3, { steps: 12, ms: 300 });
  await sleep(200);
  const after = await s.page.getAttribute('#map', 'data-center');
  assert(after !== before, `ドラッグで地図が動かない: ${before} → ${after}`);
  const [bx, by] = before.split(',').map(Number); const [ax, ay] = after.split(',').map(Number);
  assert(ax - bx > 50 && ay - by > 30, `ドラッグ方向・量が不正: ${before} → ${after}`);
  // ズーム
  await s.page.locator('#map [data-act="in"]').click();
  assert(Number(await s.page.getAttribute('#map', 'data-zoom')) === geo.zoom + 1, '＋でズームしない');
  await s.page.locator('#map [data-act="out"]').click();
  await s.page.locator('#map [data-act="out"]').click();
  assert(Number(await s.page.getAttribute('#map', 'data-zoom')) === geo.zoom - 1, '－でズームアウトしない');
  await s.page.locator('#map [data-act="fit"]').click();
  assert(Number(await s.page.getAttribute('#map', 'data-zoom')) === geo.zoom, '全体表示で元のズームに戻らない');
  assert(await s.page.getAttribute('#map', 'data-center') === before, '全体表示で中心が戻らない');
  await sleep(300);
  return `ズーム${geo.zoom}・タイル要求${s.tiles}回（ドラッグ後+${s.tiles - tilesBefore}）・${geo.label}`;
});

T('交通費：夏→冬で車が上がる・スタッドレス注記・冬季注意・フリック切替', async (s) => {
  await load(s);
  await openBySearch(s, 'たにがわ', '谷川岳');
  await scrollDetailTo(s, '#costCard');
  await setSeason(s, 'summer');
  await sleep(1000);
  const sum = await amounts(s);
  assert(Number(sum.car) > 0 && Number(sum.transit) > 0, `夏季の金額: ${JSON.stringify(sum)}`);
  assert(sum.carText === '¥' + Number(sum.car).toLocaleString('ja-JP'), `カウントアップ後の表示: ${sum.carText}`);
  assert(!(await s.page.locator('.winter-note').count()), '夏季に冬季注意が出ている');
  await shot(s, '07-cost-summer');
  await setSeason(s, 'winter');
  await sleep(1000);
  const win = await amounts(s);
  assert(Number(win.car) > Number(sum.car), `冬の車の費用が上がらない: ${sum.car} → ${win.car}`);
  const notes = await text(s, '#costBody');
  assert(notes.includes('スタッドレス・チェーン必須'), 'スタッドレス注記がない');
  assert(await s.page.locator('.winter-note').isVisible(), '冬季の注意が表示されない');
  assert((await text(s, '.winter-note')).includes('雪崩'), '冬季注意の内容');
  await shot(s, '07-cost-winter');
  // フリックで切替（右→夏季、左→冬季）
  await flickEl(s, '#costCard', 'right', { y: 0.35 });
  await waitFor(s, () => document.querySelector('.season-toggle [data-season="summer"]').getAttribute('aria-pressed') === 'true', null, { msg: '右フリックで夏季' });
  await sleep(300);
  await flickEl(s, '#costCard', 'left', { y: 0.35 });
  await waitFor(s, () => document.querySelector('.season-toggle [data-season="winter"]').getAttribute('aria-pressed') === 'true', null, { msg: '左フリックで冬季' });
  return `車 ¥${Number(sum.car).toLocaleString()} → ¥${Number(win.car).toLocaleString()}（冬）`;
});

T('富士山：冬は車・公共交通とも利用不可、夏は通行料の注記', async (s) => {
  await load(s);
  await openBySearch(s, 'ふじさん', '富士山');
  await scrollDetailTo(s, '#costCard');
  await setSeason(s, 'winter');
  const w = await amounts(s);
  assert(w.carText === '利用不可' && w.transitText === '利用不可', `冬の富士山: ${JSON.stringify(w)}`);
  await shot(s, '08-fuji-winter');
  await setSeason(s, 'summer');
  await sleep(1000);
  const sm = await amounts(s);
  assert(Number(sm.car) > 0 && Number(sm.transit) > 0, `夏の富士山: ${JSON.stringify(sm)}`);
  const notes = await text(s, '#costBody');
  assert(notes.includes('通行料'), '通行料の注記がない');
  assert(notes.includes('マイカー規制'), 'マイカー規制の注記がない');
  await shot(s, '08-fuji-summer');
});

T('出発地：まつもと→松本駅でヘッダー・地図・交通費が変化／住所でも設定・リロード後も保持', async (s) => {
  await load(s);
  assert((await text(s, '#originName')) === '東京駅', '初期値が東京駅でない');
  await openBySearch(s, 'やりがたけ', '槍ヶ岳');
  await setSeason(s, 'summer');
  await sleep(1000);
  const tokyo = await amounts(s);
  const tokyoCenter = await s.page.getAttribute('#map', 'data-center');
  const tokyoLabel = await text(s, '.tmap-label');
  await scrollDetailTo(s, '#map', 'center');
  await s.page.locator('#dtOrigin').click();
  await waitFor(s, () => document.getElementById('originSheet').classList.contains('open'), null, { msg: '出発地シート' });
  await s.page.locator('#originInput').fill('まつもと');
  await s.page.locator('.oitem[data-name="松本駅"]').waitFor();
  await sleep(400);
  await shot(s, '09-origin-sheet');
  await s.page.locator('.oitem[data-name="松本駅"]').click();
  await waitFor(s, () => document.getElementById('originName').textContent === '松本駅', null, { msg: 'ヘッダーが松本駅' });
  await sleep(1100);
  const mt = await amounts(s);
  assert((await text(s, '#dtOrigin b')) === '松本駅', '地図カードの出発地が変わらない');
  assert(await s.page.getAttribute('#map', 'data-center') !== tokyoCenter, '地図が変わらない');
  assert((await text(s, '.tmap-label')) !== tokyoLabel, '距離ラベルが変わらない');
  assert(Number(mt.car) < Number(tokyo.car) && Number(mt.transit) < Number(tokyo.transit), `松本発の方が安くない: 東京${JSON.stringify(tokyo)} 松本${JSON.stringify(mt)}`);
  assert((await text(s, '.cost-from')).startsWith('松本駅発'), '交通費の出発地表示');
  await shot(s, '09-origin-matsumoto-map');
  await closeDetail(s);
  // 住所（モック）
  await s.page.locator('#originChip').click();
  await waitFor(s, () => document.getElementById('originSheet').classList.contains('open'), null, { msg: '出発地シート' });
  await s.page.locator('#originInput').fill('横浜市中区');
  await s.page.locator('.oitem[data-kind="address"]').first().waitFor({ timeout: 4000 });
  await shot(s, '09-origin-address');
  await s.page.locator('.oitem[data-kind="address"]', { hasText: '本町' }).click();
  await waitFor(s, () => document.getElementById('originName').textContent === '神奈川県横浜市中区本町', null, { msg: '住所が出発地になる' });
  await s.page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(s, () => document.documentElement.dataset.ready === '1', null, { msg: 'リロード' });
  assert((await text(s, '#originName')) === '神奈川県横浜市中区本町', 'リロード後に出発地が保持されない');
  await shot(s, '09-origin-reloaded');
  return `槍ヶ岳 車 東京¥${Number(tokyo.car).toLocaleString()}→松本¥${Number(mt.car).toLocaleString()} / 公共交通 ¥${Number(tokyo.transit).toLocaleString()}→¥${Number(mt.transit).toLocaleString()}`;
});

T('履歴：開いた順・右フリックでお気に入り・左フリックで削除→元に戻す・タップで詳細', async (s) => {
  await load(s);
  for (const [q, n] of [['たかお', '高尾山'], ['ふじさん', '富士山'], ['やりがたけ', '槍ヶ岳']]) {
    await openBySearch(s, q, n);
    await closeDetail(s);
  }
  await s.page.locator('#tab-history').click();
  await waitFor(s, () => document.getElementById('tab-history').getAttribute('aria-selected') === 'true', null, { msg: '履歴タブ' });
  await sleep(700);
  const ids = () => s.page.evaluate(() => [...document.querySelectorAll('#historyList .hitem')].map((li) => li.dataset.id));
  assert((await ids()).join() === 'yari,fuji,takao', `履歴の順序: ${await ids()}`);
  await shot(s, '10-history');
  // 右フリック → お気に入り
  await flickEl(s, '#historyList .hitem[data-id="takao"] .hcard', 'right', { dist: 0.55 });
  await waitFor(s, () => document.querySelector('#historyList .hitem')?.dataset.id === 'takao'
    && !!document.querySelector('#historyList .hitem[data-id="takao"] .fav-star'), null, { msg: '右フリックでお気に入り（★で先頭）' });
  assert((await ids()).join() === 'takao,yari,fuji', `お気に入り後の順序: ${await ids()}`);
  await sleep(500);
  await shot(s, '10-history-fav');
  // 左フリック → 削除 → 元に戻す
  await flickEl(s, '#historyList .hitem[data-id="fuji"] .hcard', 'left', { dist: 0.55 });
  await waitFor(s, () => !document.querySelector('#historyList .hitem[data-id="fuji"]'), null, { msg: '左フリックで削除' });
  await waitFor(s, () => document.getElementById('toast').classList.contains('show'), null, { msg: 'トースト' });
  assert((await text(s, '#toast')).includes('元に戻す'), 'トーストに「元に戻す」がない');
  await shot(s, '10-history-deleted');
  await s.page.locator('#toast .toast-action').click();
  await waitFor(s, () => !!document.querySelector('#historyList .hitem[data-id="fuji"]'), null, { msg: '元に戻すで復元' });
  assert((await ids()).join() === 'takao,yari,fuji', `復元後の順序: ${await ids()}`);
  // タップで詳細
  await s.page.locator('#historyList .hitem[data-id="yari"] .hcard').tap();
  await waitDetail(s, '槍ヶ岳');
});

T('ページャ横フリックでタブ切替（検索⇔履歴）・インジケーター追従', async (s) => {
  await load(s);
  await s.page.locator('#q').blur();
  assert(await s.page.locator('.tab').count() === 2, 'タブが2つ（検索・履歴）でない');
  assert(await s.page.locator('#tab-reco, #page-reco, .dnav[data-act="reco"]').count() === 0, 'おすすめタブが残っている');
  await flickEl(s, '#page-search', 'left', { dist: 0.75, y: 0.6, ms: 150 });
  await waitFor(s, () => document.getElementById('tab-history').getAttribute('aria-selected') === 'true', null, { msg: '左フリックで「履歴」タブ' });
  await waitFor(s, () => Math.abs(document.getElementById('pager').scrollLeft - document.getElementById('pager').clientWidth) < 2, null, { msg: 'ページャがスナップ' });
  await sleep(300);
  const ind = await s.page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.tab-ind')).transform).m41);
  assert(ind > 80, `インジケーターが追従しない: ${ind}`);
  await shot(s, '11-history-tab');
  await flickEl(s, '#page-history', 'right', { dist: 0.75, y: 0.5, ms: 150 });
  await waitFor(s, () => document.getElementById('tab-search').getAttribute('aria-selected') === 'true', null, { msg: '右フリックで「検索」タブ' });
  await waitFor(s, () => document.getElementById('pager').scrollLeft < 2, null, { msg: 'ページャが先頭にスナップ' });
  return 'タブ2つ・左右フリックで切替';
});

T('ハンバーガー：開閉・aria-expanded・履歴全削除→元に戻す・説明シート・Esc/背景タップで閉じる', async (s) => {
  await load(s);
  await openBySearch(s, 'たかお', '高尾山'); await closeDetail(s);
  await openBySearch(s, 'つくば', '筑波山'); await closeDetail(s);
  const btn = s.page.locator('#menuBtn');
  assert(await btn.getAttribute('aria-expanded') === 'false', '初期 aria-expanded');
  await btn.click();
  await waitFor(s, () => document.getElementById('drawer').classList.contains('open'), null, { msg: 'ドロワーが開く' });
  assert(await btn.getAttribute('aria-expanded') === 'true', 'aria-expanded が true にならない');
  await sleep(500);
  await shot(s, '12-drawer');
  await s.page.keyboard.press('Escape');
  await waitFor(s, () => !document.getElementById('drawer').classList.contains('open'), null, { msg: 'Esc で閉じる' });
  assert(await btn.getAttribute('aria-expanded') === 'false', '閉じても aria-expanded が false にならない');
  await btn.click();
  await waitFor(s, () => document.getElementById('drawer').classList.contains('open'), null, { msg: '再度開く' });
  await sleep(400);
  await s.page.mouse.click(370, 500);
  await waitFor(s, () => !document.getElementById('drawer').classList.contains('open'), null, { msg: '背景タップで閉じる' });
  await sleep(350);
  // 履歴をすべて削除 → 元に戻す
  await btn.click(); await sleep(400);
  await s.page.locator('.dnav[data-act="clear"]').click();
  const len = () => s.page.evaluate(() => JSON.parse(localStorage.getItem('yamanavi.history') || '[]').length);
  assert(await len() === 0, '履歴が削除されない');
  await waitFor(s, () => document.getElementById('toast').classList.contains('show'), null, { msg: 'トースト' });
  await s.page.locator('#toast .toast-action').click();
  assert(await len() === 2, `元に戻らない: ${await len()}`);
  await s.page.locator('#tab-history').click();
  await waitFor(s, () => document.querySelectorAll('#historyList .hitem').length === 2, null, { msg: '履歴が2件表示' });
  // 説明シート
  await sleep(300);
  await btn.click(); await sleep(400);
  await s.page.locator('.dnav[data-act="about"]').click();
  await waitFor(s, () => document.getElementById('aboutSheet').classList.contains('open'), null, { msg: '説明シート' });
  await sleep(600);
  assert((await text(s, '#aboutSheet')).includes('てんきとくらす'), '説明シートの内容');
  await shot(s, '12-about');
  await s.page.keyboard.press('Escape');
  await waitFor(s, () => document.getElementById('aboutSheet').hidden, null, { msg: '説明シートが Esc で閉じる' });
  // 出発地シートも背景タップで閉じる
  await s.page.locator('#originChip').click();
  await waitFor(s, () => document.getElementById('originSheet').classList.contains('open'), null, { msg: '出発地シート' });
  await sleep(500);
  await s.page.mouse.click(195, 40);
  await waitFor(s, () => document.getElementById('originSheet').hidden, null, { msg: '出発地シートが背景タップで閉じる' });
});

T('ブラウザの戻るで詳細が閉じる・#m-yari の直リンクで詳細が開く', async (s) => {
  await load(s);
  await openBySearch(s, 'たかお', '高尾山');
  assert(await s.page.evaluate(() => location.hash) === '#m-takao', 'URL が #m-takao にならない');
  await s.page.goBack();
  await waitFor(s, () => document.getElementById('detail').hidden && location.hash === '', null, { msg: '戻るで詳細が閉じる' });
  await s.page.goForward();
  await waitDetail(s, '高尾山');
  await s.page.keyboard.press('Escape');
  await waitFor(s, () => document.getElementById('detail').hidden, null, { msg: 'Esc で詳細が閉じる' });
  // 直リンク
  await s.page.goto(BASE + '/#m-yari', { waitUntil: 'domcontentloaded' });
  await waitDetail(s, '槍ヶ岳');
  await shot(s, '13-direct-link-yari');
  await s.page.locator('#detail .dt-back').click();
  await waitFor(s, () => document.getElementById('detail').hidden && location.hash === '', null, { msg: '直リンクから戻るボタンで閉じる' });
  assert(await s.page.evaluate(() => location.href) === BASE + '/', 'URL がトップに戻らない');
});

T('気象APIが落ちてもエラー表示と公式リンクが出る', async (s) => {
  await load(s);
  await openBySearch(s, 'たかお', '高尾山');
  await waitFor(s, () => !!document.querySelector('#tkDays .tk-error'), null, { timeout: 8000, msg: 'エラー表示' });
  const href = await s.page.locator('#tkDays .tk-error .tenkura-link').getAttribute('href');
  assert(href === TENKURA, `公式リンク: ${href}`);
  assert((await text(s, '#tkDays')).includes('取得できませんでした'), 'エラー文言');
  await scrollDetailTo(s, '#tenkura');
  await shot(s, '14-weather-error');
  // 他の部分（地図・交通費）は表示されている
  assert(await s.page.locator('.cost-car .amount').count() === 1, '交通費が表示されない');
}, { base: FAIL_BASE, allowConsole: [/Failed to load resource/], allowHosts: ['api.open-meteo.com'] });

T('Worker API の入出力（health / 400 / weather算出 / geocode / 404 / 405）', async () => {
  const get = async (p, init) => { const r = await fetch(BASE + p, init); return { status: r.status, headers: r.headers, body: await r.json().catch(() => null) }; };
  const h = await get('/api/health');
  assert(h.status === 200 && h.body.ok === true, `health: ${JSON.stringify(h.body)}`);
  for (const q of ['', '?lat=35', '?lat=abc&lon=139', '?lat=95&lon=139', '?lat=35&lon=200', '?lat=35&lon=139&elev=abc', '?lat=35&lon=139&elev=99999']) {
    const r = await get('/api/weather' + q);
    assert(r.status === 400 && r.body.error === 'bad_request', `weather${q} が400でない: ${r.status}`);
  }
  const w = await get('/api/weather?lat=35.6251&lon=139.2437&elev=599');
  assert(w.status === 200 && w.body.days.length === 5, `weather: ${w.status}`);
  assert(w.body.days.map((d) => d.grade).join('') === 'ABCAB', `指数: ${w.body.days.map((d) => d.grade)}`);
  assert(w.body.days[2].reasons.includes('雷雨') && w.body.days[1].reasons.includes('降水3mm以上') && w.body.days[4].reasons.includes('風速10m/s以上'), '判定理由');
  assert(w.body.elev === 599 && w.body.basis.includes('てんくら基準'), 'elev/basis');
  assert(/max-age=1800/.test(w.headers.get('cache-control')), `weather のキャッシュ: ${w.headers.get('cache-control')}`);
  const w2 = await get('/api/weather?lat=35.6251&lon=139.2437&elev=599');
  assert(w2.headers.get('x-cache') === 'HIT', `2回目がキャッシュヒットしない: ${w2.headers.get('x-cache')}`);
  const g = await get('/api/geocode?q=' + encodeURIComponent('横浜市中区'));
  assert(g.status === 200 && g.body.results.length >= 1 && Number.isFinite(g.body.results[0].lat) && g.body.results[0].name.includes('横浜市中区'), `geocode: ${JSON.stringify(g.body)}`);
  assert(/max-age=86400/.test(g.headers.get('cache-control')), 'geocode のキャッシュ（1日）');
  const g0 = await get('/api/geocode?q=');
  assert(g0.status === 400, `geocode 空クエリ: ${g0.status}`);
  const g1 = await get('/api/geocode?q=' + 'あ'.repeat(81));
  assert(g1.status === 400, `geocode 長すぎ: ${g1.status}`);
  const nf = await get('/api/unknown');
  assert(nf.status === 404, `404: ${nf.status}`);
  for (const m of ['POST', 'PUT', 'DELETE']) {
    const r = await get('/api/health', { method: m });
    assert(r.status === 405, `${m} が405でない: ${r.status}`);
  }
  // 気象APIが503のとき 502 を返す
  const f = await fetch(FAIL_BASE + '/api/weather?lat=35.6&lon=139.2&elev=599');
  assert(f.status === 502, `上流失敗時: ${f.status}`);
  return 'health/400×7/weather ABCAB+キャッシュHIT/geocode/404/405×3/上流失敗502';
}, { noBrowser: true });

T('詳細・全タブ・bodyで横スクロールがはみ出さない', async (s) => {
  await load(s);
  const check = (scope) => s.page.evaluate((sc) => {
    const vw = window.innerWidth;
    const out = [];
    const de = document.documentElement;
    if (de.scrollWidth > vw) out.push(`html ${de.scrollWidth}>${vw}`);
    if (document.body.scrollWidth > vw) out.push(`body ${document.body.scrollWidth}>${vw}`);
    const root = document.querySelector(sc);
    if (root.scrollWidth > root.clientWidth + 1) out.push(`${sc} scrollWidth ${root.scrollWidth}>${root.clientWidth}`);
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('.carousel, .tmap, .hitem') || (el.ownerSVGElement)) continue; // SVG の子要素は SVG のビューポートで切り取られる
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > vw + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} [${Math.round(r.left)},${Math.round(r.right)}]`);
      if (out.length > 5) break;
    }
    return out;
  }, scope);
  const problems = [];
  for (const [i, id] of [[0, 'search'], [1, 'history']]) {
    await s.page.locator('#tab-' + id).click();
    await waitFor(s, (x) => Math.abs(document.getElementById('pager').scrollLeft - x * document.getElementById('pager').clientWidth) < 2, i, { msg: `タブ${id}` });
    await sleep(250);
    problems.push(...(await check('#page-' + id)).map((p) => `[${id}] ${p}`));
  }
  for (const [q, n] of [['ふじさん', '富士山'], ['たてやま', '立山'], ['あさひだけ', '旭岳'], ['りしり', '利尻山']]) {
    await openBySearch(s, q, n);
    for (const season of ['summer', 'winter']) {
      await setSeason(s, season);
      problems.push(...(await check('#detailScroll')).map((p) => `[${n}/${season}] ${p}`));
    }
    await closeDetail(s);
  }
  await s.page.locator('#originChip').click();
  await s.page.locator('#originInput').fill('横浜市中区');
  await s.page.locator('.oitem[data-kind="address"]').first().waitFor();
  problems.push(...(await check('#originSheet')).map((p) => `[出発地] ${p}`));
  assert(problems.length === 0, '横はみ出し: ' + problems.join(' / '));
});

// ------------------------------------------------------------------ 実行
async function main() {
  await mkdir(shotsDir, { recursive: true });
  for (const f of await readdir(shotsDir)) if (f.endsWith('.png')) await unlink(path.join(shotsDir, f));
  const servers = [
    await startServer(PORT, { MOCK_UPSTREAM: '1' }),
    await startServer(FAIL_PORT, { MOCK_UPSTREAM: '1', MOCK_WEATHER_FAIL: '1' }),
  ];
  const exe = chromePath();
  browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox', '--lang=ja-JP'] });
  const version = browser.version();
  const results = [];
  const t0 = Date.now();
  for (const [i, t] of tests.entries()) {
    const no = i + 1;
    if (ONLY && !ONLY.includes(no)) continue;
    const start = Date.now();
    let s = null; let status = 'PASS'; let detail = ''; let error = '';
    try {
      if (!t.opt.noBrowser) s = await session({ base: t.opt.base || BASE, allowConsole: t.opt.allowConsole, allowHosts: t.opt.allowHosts });
      detail = (await t.fn(s)) || '';
      if (s) {
        await sleep(100);
        if (s.errors.length) throw new AssertError('ブラウザエラー: ' + s.errors.join(' | '));
        if (s.external.length) throw new AssertError('想定外の外部リクエスト: ' + s.external.slice(0, 3).join(', '));
      }
    } catch (e) {
      status = 'FAIL';
      error = e instanceof AssertError ? e.message : (e.stack || String(e));
      if (s?.errors.length) error += '\n  ブラウザエラー: ' + s.errors.join(' | ');
      if (s?.page) await s.page.screenshot({ path: path.join(shotsDir, `fail-${String(no).padStart(2, '0')}.png`) }).catch(() => {});
    } finally {
      await s?.context.close().catch(() => {});
    }
    const ms = Date.now() - start;
    results.push({ no, name: t.name, status, ms, detail, error });
    console.log(`${status === 'PASS' ? '✅' : '❌'} ${String(no).padStart(2)}. ${t.name} (${ms}ms)${detail ? '\n     ' + detail : ''}${error ? '\n     ' + error : ''}`);
  }
  await browser.close();
  servers.forEach((c) => c.kill());
  const pass = results.filter((r) => r.status === 'PASS').length;
  const total = results.length;
  console.log(`\n${pass}/${total} 合格（${((Date.now() - t0) / 1000).toFixed(1)}秒）`);
  await writeReport({ results, pass, total, version, exe, secs: (Date.now() - t0) / 1000 });
  process.exit(pass === total ? 0 : 1);
}

async function writeReport({ results, pass, total, version, exe, secs }) {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  const esc = (x) => String(x).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const md = `# やまナビ E2E テストレポート

- 実行日時：${now}（JST）
- 結果：**${pass}/${total} 合格**${pass === total ? ' ✅' : ' ❌'}（${secs.toFixed(1)}秒）
- ブラウザ：${exe ? `Google Chrome ${version}（${exe}）` : `Chromium ${version}（Playwright 同梱）`}・ヘッドレス
- 端末エミュレーション：390×844 / deviceScaleFactor 2 / isMobile / hasTouch / ja-JP / Asia/Tokyo
- サーバー：\`scripts/dev-server.mjs\`（src/worker.js を Node で実行）\`MOCK_UPSTREAM=1\`（フィクスチャ：goal/fixtures/upstream.json）。テスト14は \`MOCK_WEATHER_FAIL=1\` のサーバーを使用
- 地図タイル：ルーティングで画像スタブを返却（要求回数 合計 ${tileStats.total} 回）。それ以外の外部リクエストは遮断し、発生したら失敗
- 横フリック：CDP \`Input.dispatchTouchEvent\` による実タッチ
- 失敗条件：アサーション違反、\`pageerror\` または \`console.error\` が1件でも出た場合（テスト14のみ、意図的に失敗させた通信の "Failed to load resource" を除外）

| # | テスト | 結果 | 時間 | 詳細 |
|---|---|---|---|---|
${results.map((r) => `| ${r.no} | ${esc(r.name)} | ${r.status === 'PASS' ? '✅ PASS' : '❌ FAIL'} | ${(r.ms / 1000).toFixed(1)}s | ${esc(r.error || r.detail || '')} |`).join('\n')}

## スクリーンショット（goal/screenshots/）

${shots.map((f) => `- [${f}](screenshots/${f})`).join('\n')}
`;
  await writeFile(path.join(here, 'REPORT.md'), md);
}

main().catch((e) => { console.error(e); process.exit(1); });
