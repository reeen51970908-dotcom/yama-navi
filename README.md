# 山ヤクザ — 登山計画Webアプリ

開いた瞬間に山を検索して、**登山指数（A/B/C）・出発地からの地図・往復交通費と移動時間**をまとめて確認できる、モバイルファーストの登山計画アプリです。
ビルド不要の Vanilla JS（ES Modules）＋CSS で作り、Cloudflare Workers（Workers Static Assets）で配信しています。

## 主な機能

- **即検索**：検索欄は `autofocus`＋インラインscriptで即フォーカス。山データ（全国219座・日本百名山100座すべて）はJSに同梱しているので、ネットワーク待ちゼロで検索できます
  - 正規化：NFKC／カタカナ→ひらがな／小文字化／空白・長音除去
  - 山名・よみ・ローマ字・都道府県・エリア・別名・タグで部分一致（先頭一致を優先）。Enterで先頭を開く、クリアボタン
  - 絞り込みチップ：今が適期／初心者向け（難易度2以下）／日帰り（8時間以下）／公共交通OK／冬も登れる／百名山
  - 並び替え：「近い順」で出発地から登山口までの距離が近い順（選択は端末に保存）
- **タブ（検索／履歴）**：横フリックで切替（scroll-snap ページャ）、インジケーターがスクロールに追従
  - 履歴：開いた山を自動記録（最大50件）。左フリックで削除（トーストで元に戻す）、右フリックでお気に入り（★で上に固定）
- **山の詳細**（`#m-<id>` で直リンク、ブラウザの戻るで閉じる）
  - 概要：難易度（5段階）・標準タイム（コース名）・標高・冬季の可否・適期（12ヶ月のバー、今月を強調）
  - 登山指数：てんきとくらすと同じ A/B/C の3段階で5日分（日付・天気・最高/最低気温・風速）
    - **C**：降水10mm以上 / 風速15m/s以上 / 雷雨　**B**：降水3mm以上 / 風速10m/s以上 / 強い雨・雪　**A**：それ以外
    - Open-Meteo の**山頂標高**の予報から独自に算出（公式値ではありません）。[てんきとくらす](https://tenkura.n-kishou.co.jp/tk/) へのリンク付き
  - 地図：国土地理院の淡色地図タイル上に出発地(S)と登山口(G)。ライブラリなしの自作タイル地図（自動ズーム・ドラッグ・＋／－／全体表示・曲線ルートの描画アニメーション・道路距離の目安）。Googleマップの経路リンク（車・電車）
  - 往復交通費・移動時間：夏季／冬季の切替（タップ or カードの左右フリック、12〜3月は冬季が初期値）。車と公共交通を並べて表示し、金額はカウントアップ
  - コース情報（登山口・最寄り駅・駐車場・入山料・冬季の注意）と免責
- **出発地**：主要駅135駅（よみ付き）を即時候補に、2文字以上で住所検索（国土地理院）。localStorage に保存（初期値：東京駅）
- **UI**：白ベースのリキッドグラス（`backdrop-filter: blur(22px) saturate(180%)`・白い縁取り・内側ハイライト・上部の光沢）と、ゆっくり動く背景のぼかし円。スプリングのシート、段差フェードイン、ハンバーガー→×、リップル、ピン落下、月バー伸長、全画面スケルトン（起動時約380ms・詳細は約500ms）、トースト。`prefers-reduced-motion` 対応、Escキーで各画面を閉じる、aria属性
- **山のイラスト**：外部画像を使わず、山のIDから毎回同じ形のSVGを生成（空・太陽・稜線、標高1700m超は雪）

## 構成

```
public/               フロントエンド（Workers Static Assets で配信）
  index.html
  css/app.css
  js/app.js           画面・操作
  js/search.js        検索・絞り込み
  js/map.js           自作タイル地図
  js/cost.js          交通費・移動時間の概算
  js/tenkura.js       登山指数（Worker と共用）
  js/art.js           山のSVGイラスト
  js/api.js           /api 呼び出し＋直接呼び出しのフォールバック
  js/store.js         localStorage（履歴・出発地）
  data/mountains.js   山データ（基本76座）
  data/mountains-extra.js  追加の山データ（基本データ以外の山）
  data/stations.js    主要駅（135駅）
  data/shinkansen.js  新幹線の駅（全路線・約130駅）と路線の分岐点
src/worker.js         API（/api/* のみ Worker が処理）
scripts/dev-server.mjs  src/worker.js を Node で動かす開発サーバー
scripts/check-data.mjs  山・駅データの検査（重複・必須項目・座標・交通費が計算できるか）
goal/run.mjs          E2E テスト（Playwright＋実Chrome）
goal/REPORT.md        テスト結果、goal/screenshots/ スクリーンショット
.github/workflows/ci-deploy.yml  push で E2E → main ならデプロイ
```

### API（`src/worker.js`、Cache API でキャッシュ）

| エンドポイント | 内容 |
|---|---|
| `GET /api/health` | `{ "ok": true }` |
| `GET /api/weather?lat=&lon=&elev=` | Open-Meteo（`elevation`=山頂標高、daily: weather_code / temperature_2m_max・min / precipitation_sum / wind_speed_10m_max、`wind_speed_unit=ms`、`timezone=Asia/Tokyo`、5日）から登山指数を算出。30分キャッシュ。不正な値は 400、上流障害は 502 |
| `GET /api/geocode?q=` | 国土地理院 住所検索API で住所・駅名→座標。1日キャッシュ。空・80文字超は 400 |
| その他 | 不明パス 404、GET 以外 405 |

フロントは `/api` が使えない場合、Open-Meteo / 国土地理院を直接呼ぶフォールバックを持ちます。

## 使い方

```bash
npm install
npm run dev          # http://127.0.0.1:8787 （実際の外部APIを使用）
npm run dev:mock     # 外部APIをフィクスチャに差し替え（オフライン開発）
npm run check:data   # 山・駅データの検査（件数も表示）
npm test             # データ検査＋E2E（goal/REPORT.md と goal/screenshots/ を更新）
npx wrangler deploy  # Cloudflare Workers へデプロイ
```

- 開発サーバーの環境変数：`PORT`、`MOCK_UPSTREAM=1`（Open-Meteo・国土地理院を `goal/fixtures/upstream.json` に差し替え）、`MOCK_WEATHER_FAIL=1`（気象APIを503に）
- E2E は `/usr/bin/google-chrome` があればそれを使い（`CHROME_PATH` で変更可）、なければ Playwright 同梱の Chromium を使います。`ONLY=5,6 npm test` で一部だけ実行できます

### デプロイ（GitHub Actions）

`main` への push で E2E が通ると `cloudflare/wrangler-action@v3` でデプロイされます。リポジトリの Secrets に次を設定してください。

- `CLOUDFLARE_API_TOKEN`（Workers の編集権限を持つ API トークン）
- `CLOUDFLARE_ACCOUNT_ID`

## 注意

- **交通費・移動時間は概算です。** 出発地からの直線距離をもとに、車は「道路距離＝直線×1.3＋2km、40km超は(道路距離−25)×0.85を高速区間、燃費13km/L（冬11.5）、ガソリン175円/L、高速料金＝高速km×24.6×1.1＋150円（片道）」、公共交通は「鉄道距離＝直線×1.2、16.5円/km（300km超の部分は13.2円/km、最低150円）、100km以上は特急料金」で計算しています。**新幹線**は、出発地から30km以内と最寄り駅から35km以内（または山ごとに指定した乗換駅：石鎚山＝岡山、北海道の山＝新函館北斗など）に新幹線駅があり、在来線より速い場合に採用します。新幹線の距離は東京・大宮・高崎・福島・盛岡などの分岐点を経由した直線距離×1.18、特急料金は距離帯ごとの指定席・通常期の目安（`public/js/cost.js` の `shinkansenFee`）です実際の運賃・料金・所要時間とは異なります
- 山データ（座標・駐車場代・バス運賃・運行期間・冬季閉鎖・マイカー規制など）は概算・調査時点のものです。富士山の通行料、上高地・乗鞍・南アルプス林道などのマイカー規制、季節運行バスは年によって変わるため、必ず各公式情報を確認してください
- 登山指数は「てんくら基準」を参考にOpen-Meteoの予報から独自に算出したもので、てんきとくらすの公式値ではありません
- 地図は[地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)、住所検索は国土地理院の住所検索APIを利用しています
- 登山は自己責任です。天候・装備・体力に合わせて無理のない計画を立ててください
- ロゴの文字には [Dela Gothic One](https://github.com/syakuzen/DelaGothic)（SIL Open Font License 1.1）を、ロゴに使う4文字だけに切り出して同梱しています（`public/fonts/`、ライセンス文 `public/fonts/DelaGothicOne-OFL.txt`）
- ロゴの角印の梵字「カーン」（不動明王の種字）は [Noto Sans Siddham](https://github.com/notofonts/siddham)（SIL Open Font License 1.1）の字形を SVG 図形に変換したものです（ライセンス文 `public/fonts/NotoSansSiddham-OFL.txt`）
