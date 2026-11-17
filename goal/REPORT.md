# やまナビ E2E テストレポート

- 実行日時：2026/11/18 7:48:42（JST）
- 結果：**16/16 合格** ✅（132.1秒）
- ブラウザ：Google Chrome 153.0.8010.12（/usr/bin/google-chrome）・ヘッドレス
- 端末エミュレーション：390×844 / deviceScaleFactor 2 / isMobile / hasTouch / ja-JP / Asia/Tokyo
- サーバー：`scripts/dev-server.mjs`（src/worker.js を Node で実行）`MOCK_UPSTREAM=1`（フィクスチャ：goal/fixtures/upstream.json）。テスト14は `MOCK_WEATHER_FAIL=1` のサーバーを使用
- 地図タイル：ルーティングで画像スタブを返却（要求回数 合計 104 回）。それ以外の外部リクエストは遮断し、発生したら失敗
- 横フリック：CDP `Input.dispatchTouchEvent` による実タッチ
- 失敗条件：アサーション違反、`pageerror` または `console.error` が1件でも出た場合（テスト14のみ、意図的に失敗させた通信の "Failed to load resource" を除外）

| # | テスト | 結果 | 時間 | 詳細 |
|---|---|---|---|---|
| 1 | 起動直後に検索欄へフォーカスし「たかお」で高尾山が先頭 | ✅ PASS | 2.0s |  |
| 2 | 起動スケルトンが表示されてから消える | ✅ PASS | 1.1s | スケルトン表示〜消失: 約383ms（入力時スケルトン表示中=true） |
| 3 | 検索：タカオ／takao／八ヶ岳／ふじ／北海道・該当なし・クリア | ✅ PASS | 3.3s | 全86座 |
| 4 | 「初心者向け」チップで難易度2以下に絞り込み | ✅ PASS | 2.5s | 全86座 → 初心者向け38座 |
| 5 | 詳細：スケルトン→難易度・行動時間・適期12ヶ月・登山指数ABCAB・てんくらリンク | ✅ PASS | 5.8s | 難易度初級・適期6/12・指数ABCAB |
| 6 | 地図：S/Gマーカー・ルート線・タイル要求・2点が収まる・ドラッグ・ズーム | ✅ PASS | 7.8s | ズーム9・タイル要求18回（ドラッグ後+12）・道路 約61km（目安） |
| 7 | 交通費：夏→冬で車が上がる・スタッドレス注記・冬季注意・フリック切替 | ✅ PASS | 11.1s | 車 ¥17,230 → ¥17,900（冬） |
| 8 | 富士山：冬は車・公共交通とも利用不可、夏は通行料の注記 | ✅ PASS | 7.8s |  |
| 9 | 出発地：まつもと→松本駅でヘッダー・地図・交通費が変化／住所でも設定・リロード後も保持 | ✅ PASS | 13.0s | 槍ヶ岳 車 東京¥21,920→松本¥5,580 / 公共交通 ¥18,440→¥5,320 |
| 10 | 履歴：開いた順・右フリックでお気に入り・左フリックで削除→元に戻す・タップで詳細 | ✅ PASS | 18.2s |  |
| 11 | ページャ横フリックでタブ切替・カルーセル（画像3枚以上、フリックでドット前進、タブは動かない、スライドから詳細） | ✅ PASS | 9.9s | スライド8枚・ドット2枚目へ・「筑波山」を開いた |
| 12 | ハンバーガー：開閉・aria-expanded・履歴全削除→元に戻す・説明シート・Esc/背景タップで閉じる | ✅ PASS | 15.0s |  |
| 13 | ブラウザの戻るで詳細が閉じる・#m-yari の直リンクで詳細が開く | ✅ PASS | 9.9s |  |
| 14 | 気象APIが落ちてもエラー表示と公式リンクが出る | ✅ PASS | 4.3s |  |
| 15 | Worker API の入出力（health / 400 / weather算出 / geocode / 404 / 405） | ✅ PASS | 0.0s | health/400×7/weather ABCAB+キャッシュHIT/geocode/404/405×3/上流失敗502 |
| 16 | 詳細・全タブ・bodyで横スクロールがはみ出さない | ✅ PASS | 20.1s |  |

## スクリーンショット（goal/screenshots/）

- [01-search-takao.png](screenshots/01-search-takao.png)
- [03-search-hokkaido.png](screenshots/03-search-hokkaido.png)
- [03-search-noresult.png](screenshots/03-search-noresult.png)
- [04-chip-beginner.png](screenshots/04-chip-beginner.png)
- [05-detail-skeleton.png](screenshots/05-detail-skeleton.png)
- [05-detail-top.png](screenshots/05-detail-top.png)
- [05-detail-tenkura.png](screenshots/05-detail-tenkura.png)
- [06-map.png](screenshots/06-map.png)
- [07-cost-summer.png](screenshots/07-cost-summer.png)
- [07-cost-winter.png](screenshots/07-cost-winter.png)
- [08-fuji-winter.png](screenshots/08-fuji-winter.png)
- [08-fuji-summer.png](screenshots/08-fuji-summer.png)
- [09-origin-sheet.png](screenshots/09-origin-sheet.png)
- [09-origin-matsumoto-map.png](screenshots/09-origin-matsumoto-map.png)
- [09-origin-address.png](screenshots/09-origin-address.png)
- [09-origin-reloaded.png](screenshots/09-origin-reloaded.png)
- [10-history.png](screenshots/10-history.png)
- [10-history-fav.png](screenshots/10-history-fav.png)
- [10-history-deleted.png](screenshots/10-history-deleted.png)
- [11-reco.png](screenshots/11-reco.png)
- [11-reco-carousel-moved.png](screenshots/11-reco-carousel-moved.png)
- [12-drawer.png](screenshots/12-drawer.png)
- [12-about.png](screenshots/12-about.png)
- [13-direct-link-yari.png](screenshots/13-direct-link-yari.png)
- [14-weather-error.png](screenshots/14-weather-error.png)
