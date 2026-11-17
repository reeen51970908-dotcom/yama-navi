// 山の写真を Wikimedia Commons（自由ライセンス）から取得して public/img/m/ に保存する
//   node scripts/fetch-photos.mjs            … 写真が未取得の山だけ
//   node scripts/fetch-photos.mjs takao fuji … 指定した山だけ（取り直し）
//   ※ プロキシ環境では NODE_USE_ENV_PROXY=1 を付けて実行
//   SKIP=id1,id2 … 写真を使わない山（public/data/photo-overrides.json の skip にも書ける）
// 候補：日本語版ウィキペディア記事の冒頭（基本情報欄）に出てくる写真 → 見つからなければ Commons 検索
// 採用条件：Commons にあり、CC BY / CC BY-SA / CC0 / パブリックドメインであること
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { MOUNTAINS } from '../public/data/mountains.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgDir = path.join(root, 'public/img/m');
const dataFile = path.join(root, 'public/data/photos.js');
const overridesFile = path.join(root, 'public/data/photo-overrides.json');
const UA = 'yama-navi-photo-fetch/1.0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ウィキペディアの記事名が山名と違うもの
const TITLE = {
  oyama: '大山 (神奈川県)', daisen: '大山 (鳥取県)', mitake: '御岳山 (東京都)', kurodake: '黒岳 (石狩市・上川町)',
  kongo: '金剛山 (金剛山地)', asama: '浅間山', kirigamine: '霧ヶ峰', aso: '阿蘇山', azuma: '吾妻山',
  warusawa: '悪沢岳', odaigahara: '大台ヶ原', hakkyo: '八経ヶ岳', zao: '蔵王連峰', nasu: '那須岳',
  akagi: '赤城山', karakuni: '韓国岳', tsurugi: '剣山', kuju: '久住山', nikkoshirane: '日光白根山',
  hachimantai: '八幡平', utsukushigahara: '美ヶ原', iwaki: '岩木山', hakkoda: '八甲田山', unzen: '雲仙岳',
  ibuki: '伊吹山', azumaya: '四阿山', kusatsushirane: '草津白根山', suisho: '水晶岳', tateyama: '立山',
};
const BAD = /(map|地図|location|relief|locator|logo|icon|flag|symbol|emblem|紋|章|sign|標識|diagram|graph|chart|route|ルート|コース|位置|\.svg$)/i;
const OK_LICENSE = /^(cc[ -]by(-sa)?[ -]?\d|cc0|public domain|pd)/i;

let lastCall = 0;
async function api(host, params) {
  const u = `https://${host}/w/api.php?` + new URLSearchParams({ format: 'json', formatversion: '2', maxlag: '5', ...params });
  for (let i = 0; i < 6; i++) {
    const wait = lastCall + 1500 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const r = await fetch(u, { headers: { 'user-agent': UA, 'accept-encoding': 'gzip' } });
    if (r.ok) return r.json();
    const ra = Number(r.headers.get('retry-after')) || 0;
    await sleep(Math.max(ra * 1000, 15000 * (i + 1)));
  }
  throw new Error('API error ' + u);
}

async function candidatesFromWiki(m) {
  const title = TITLE[m.id] || m.name.replace(/（.*?）/g, '');
  const j = await api('ja.wikipedia.org', { action: 'parse', page: title, prop: 'wikitext', section: '0', redirects: '1' }).catch(() => null);
  const text = j?.parse?.wikitext || '';
  const names = [...text.matchAll(/([^\[\]|=\n:{}]+?\.(?:jpe?g|png|webp|tiff?))/gi)].map((x) => x[1].trim().replace(/^(file|ファイル|画像|image):/i, ''));
  return [...new Set(names)].filter((n) => !BAD.test(n));
}

async function candidatesFromCommons(m) {
  const j = await api('commons.wikimedia.org', { action: 'query', list: 'search', srnamespace: '6', srlimit: '10', srsearch: `${m.name.replace(/（.*?）/g, '')} filetype:bitmap` });
  return (j?.query?.search || []).map((x) => x.title.replace(/^File:/, '')).filter((n) => !BAD.test(n));
}

const strip = (html) => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/** 複数ファイルの情報をまとめて取得（Commons にないものは結果に含まれない） */
async function commonsInfoMany(names) {
  const out = new Map();
  if (!names.length) return out;
  const j = await api('commons.wikimedia.org', { action: 'query', titles: names.map((n) => 'File:' + n).join('|'), prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime' });
  const norm = new Map((j?.query?.normalized || []).map((x) => [x.to, x.from]));
  for (const p of j?.query?.pages || []) {
    const ii = p?.imageinfo?.[0];
    const original = (norm.get(p.title) || p.title).replace(/^File:/, '');
    if (!ii || p.missing) continue;
    out.set(original, judge(original, ii));
  }
  return out;
}

function judge(name, ii) {
  const md = ii.extmetadata || {};
  const license = strip(md.LicenseShortName?.value);
  if (!OK_LICENSE.test(license)) return { reject: `ライセンス対象外（${license || '不明'}）` };
  if (!/jpe?g|png|webp|tiff/.test(ii.mime)) return { reject: '写真ではない' };
  if (ii.width < 800 || ii.height < 450) return { reject: '解像度不足' };
  if (ii.height > ii.width * 1.15) return { reject: '縦長' };
  if (ii.size > 20e6) return { reject: '容量が大きすぎる' };
  return {
    file: name,
    thumb: ii.url, // 原寸（upload.wikimedia.org）を取得して手元で縮小する
    page: ii.descriptionurl,
    license,
    licenseUrl: md.LicenseUrl?.value || '',
    artist: strip(md.Artist?.value).slice(0, 80) || '不明',
  };
}

async function main() {
  await mkdir(imgDir, { recursive: true });
  let photos = {};
  if (existsSync(dataFile)) {
    const txt = await readFile(dataFile, 'utf8');
    photos = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  }
  const ov = existsSync(overridesFile) ? JSON.parse(await readFile(overridesFile, 'utf8')) : {};
  const skip = new Set([...(ov.skip || []), ...(process.env.SKIP || '').split(',').filter(Boolean)]);
  const only = process.argv.slice(2);
  const targets = MOUNTAINS.filter((m) => (only.length ? only.includes(m.id) : !photos[m.id]) && !skip.has(m.id));
  for (const id of skip) delete photos[id];
  let ok = 0; const miss = [];
  for (const m of targets) {
    let picked = null; const why = [];
    const forced = ov.file?.[m.id];
    try {
      for (const source of forced ? [async () => [forced]] : [() => candidatesFromWiki(m), () => candidatesFromCommons(m)]) {
        const cands = [...new Set(await source())].slice(0, 12);
        const infos = await commonsInfoMany(cands);
        for (const name of cands) {
          const info = infos.get(name);
          if (!info) { why.push(`${name}: Commons になし`); continue; }
          if (info.reject) { why.push(`${name}: ${info.reject}`); continue; }
          picked = info; break;
        }
        if (picked) break;
      }
    } catch (e) { why.push('API エラー: ' + e.message.slice(0, 60)); }
    if (!picked) { miss.push(`${m.id}（${m.name}）: ${why.slice(0, 3).join(' / ') || '候補なし'}`); delete photos[m.id]; continue; }
    let r = null;
    for (let i = 0; i < 4; i++) {
      r = await fetch(picked.thumb, { headers: { 'user-agent': UA } }).catch(() => null);
      if (r?.ok) break;
      await sleep(10000 * (i + 1));
    }
    if (!r?.ok) { miss.push(`${m.id}: ダウンロード失敗 ${r?.status}`); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const pos = ov.position?.[m.id] || 'centre';
    await sharp(buf).rotate().resize(960, 600, { fit: 'cover', position: pos }).webp({ quality: 70 }).toFile(path.join(imgDir, `${m.id}.webp`));
    await sharp(buf).rotate().resize(240, 240, { fit: 'cover', position: pos }).webp({ quality: 68 }).toFile(path.join(imgDir, `${m.id}-s.webp`));
    photos[m.id] = { artist: picked.artist, license: picked.license, licenseUrl: picked.licenseUrl, source: picked.page, file: picked.file };
    ok++;
    console.log(`✓ ${m.name}  ${picked.file}  [${picked.license} / ${picked.artist}]`);
    await sleep(1500);
  }
  const sorted = Object.fromEntries(Object.keys(photos).sort().map((k) => [k, photos[k]]));
  await writeFile(dataFile, `// 山の写真のクレジット（scripts/fetch-photos.mjs が生成）。画像は public/img/m/<id>.webp・<id>-s.webp\n// すべて Wikimedia Commons の自由ライセンス画像\nexport const PHOTOS = ${JSON.stringify(sorted, null, 2)};\n`);
  console.log(`\n取得 ${ok} 座 / 写真あり合計 ${Object.keys(sorted).length} 座 / 見つからず ${miss.length} 座`);
  if (miss.length) console.log('- ' + miss.join('\n- '));
}

main().catch((e) => { console.error(e); process.exit(1); });
