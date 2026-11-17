# バグ監査レポート — Opennow-web (Railway fork)

監査日: 2026-10-10 / 対象: `shunichi19990314-oss/Opennow-web-railway` main
検証: typecheck ✅ / ユニットテスト 18 件 ✅ / プロダクションビルド ✅ / エンドポイントスモークテスト ✅
再検証 (2026-11-03): typecheck ✅ / ユニットテスト 53 件 ✅ / プロダクションビルド ✅
最新監査 (2026-11-12): typecheck ✅ / ユニットテスト 196 件 ✅ / プロダクションビルド ✅ / HTTP スモーク ✅ → **D 章**
追加修正 (2026-11-14): typecheck ✅ / ユニットテスト 215 件 ✅ / プロダクションビルド ✅ → **E 章**

---

## A. 今回の監査で修正したバグ(2 件)

### A-1.【中・回帰】タッチジェスチャがオーバーレイ UI の操作を壊す
- 場所: `src/client/platforms/gfn/webrtcClient.ts`(`onTouchStart` / `onTouchMove`)
- 症状: タッチリスナーは `.sv` コンテナ(= video の親)に登録されており、スクリーンショットモーダル・終了プロンプト等のオーバーレイは同じコンテナ内の子要素。ストリーミング中にこれらのモーダルを開くと、内部でのタッチ移動が `preventDefault` され、スクロールやスワイプ操作が不能になる可能性があった(サイドバーは `sidebarOpen` ガードで保護済みだったが、モーダル類は未保護)。
- 修正: `touchstart` は **event.target が video 要素そのもののときのみ** hijack。`touchmove` は**追跡中のジェスチャがあるときのみ** `preventDefault`。追跡は video 上で始まったタッチでのみ開始されるため、オーバーレイ UI は常に native 動作を維持。

### A-2.【低】空の `streamingBaseUrl` が不正値に正規化され誤警告をログ出力
- 場所: `src/server/api.ts` `/api/stream/create`
- 症状: `normalizeCloudMatchBaseUrl("")` が `"https:/"`(ゴミ値・truthy)を返し、「untrusted override を無視した」という誤警告が起動のたびにログされる可能性。動作自体はデフォルトへフォールバックするため無害だが、ログ汚染と誤診断の原因。
- 修正: 空文字列を正規化前にガード。

## B. 報告のみ(未修正)— 優先度順

> 更新 (2026-11-03, `OpenNOW-web` main): B-1 / B-2 / B-3 は修正済み。
> - **B-1** `WebAuthSession.MAX_ACTIVE_SESSION_IDS = 16` の FIFO 上限 + `reduceVolatileState()` を追加(ユニットテスト 3 件)。
> - **B-2** `requireAuth` のリフレッシュを try/catch で包み、一過性失敗時は現行トークンで継続(次回リトライ)、既に期限切れのときだけ 401(再サインイン)を返すようにした。502 への劣化を解消(ユニットテスト 6 件)。
> - **B-3** `App.tsx` の重複した `if (launchAbortRef.current) { return; }` を削除。
>
> 追加で判明した **B-7**(`fitResolutionToDisplay` のフォールバックが画面に収まらない場合がある)も同日修正。下記に追記する。

### B-1.【中低・修正済み】放棄されたストリームセッション ID が Cookie に恒久蓄積
- 場所: `src/server/webAuth.ts` `addActiveSession` / `src/server/sessionStore.ts` `persistCookieSession`
- 詳細: `removeActiveSession` は `/api/stream/stop` 時のみ呼ばれる。タブを閉じて放棄されたセッションの ID は 30 日の Cookie 有効期内に蓄積し続ける。スナップショットが 4 チャンク(約 14KB)を超えると `onHeaders` コールバック内で `throw` され、**ヘッダー送信後のため 500 に劣化できず接続が壊れる**。数百件の放棄が必要で確率は低いが、緩やかな劣化として実在。
- 推奨対応: `activeSessionIds` に上限(例: 最新 20 件)を設ける、または `/api/active-sessions` 照合時に GFN 側に存在しない ID を prune。

### B-2.【低・修正済み】トークンリフレッシュにエラーハンドリングなし
- 場所: `src/server/webAuth.ts` `requireAuth`
- 詳細: `refreshAuthTokens(...)` がネットワーク一過性エラーで reject すると、例外がそのまま伝播し全 API が 500(401 相当の「再サインイン」誘導にならない)。`previous.authClientId!` の非 null アサーションも、旧バージョンのスナップショットに対して脆い。リトライ自体は次回リクエストで可能なため実害は限定的。

### B-3.【無害・修正済み】完全重複したデッドコード
- 場所: `src/client/App.tsx`(旧 2685–2691 行)— `if (launchAbortRef.current) { return; }` が連続 2 回(上流リポジトリ由来)。動作影響なし。→ 重複ブロックを削除。

### B-4.【設計通り】ja/en 以外のロケール欠落
- de/es/fr/ko/nl/pl/ro/ru/tr/zh は en 比 244 キー欠落(英語フォールバック、意図された設計)。**プレースホルダ `{{...}}` の不一致は 12 ロケール全てで 0 件**。ja は完全翻訳済み。

### B-5.【監視】キャッシュのディスク成長
- `.opennow-data`(gfn-cache / media-thumbs)は読み出し時 TTL(12h)チェックと一部クリーンアップ経路のみで、定期 sweep はなし。Railway の 1GB 一時ディスクは再デプロイでリセットされるため実務リスクは低いが、長期無デプロイ運用ではサムネイル数に留意。

### B-6.【許容】広めの CSP `connect-src`
- `connect-src 'self' https: ws: wss:` は GFN 全地域エンドポイントへの到達に必要。`script-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'` 等は適切に絞られている。

### B-7.【中・修正済み】`fitResolutionToDisplay` のフォールバックが画面に収まらないことがある
- 場所: `src/client/webDefaults.ts` `fitResolutionToDisplay`
- 症状: 「画面より大きい要求は device default に落とす」実装だったが、`chooseStreamDefaultsForDevice` の判定は `longEdge <= 1600 && shortEdge <= 900` のみ。そのため
  - **1680x1050 パネル**(longEdge 1680 > 1600 で「small」扱いされない)に 1920x1080 を要求 → device default は **1920x1080 のまま**で、依然としてパネルより大きい値を rig に送る(=この関数の目的が果たされない)。
  - **4:3 の 1024x768 パネル**では default の 1280x720 が横方向に収まらない。
- 影響: 直近コミット `fc59685`(「小さいパネルでのカクつき低減」)が、まさに上記の中間サイズのパネルで効いていなかった。
- 修正: device default がパネルに収まることを検証し、収まらない場合は **GFN が実際に受け付けるモード**(`@shared/gfn/entitlements` の `STREAM_MODE_PRESETS` と同一集合)から「パネルに収まる最大面積・要求と同じアスペクト比優先」で一段下げる。どれも収まらない極小パネルでは推測せず要求をそのまま返す。
  - 注意: 対応外解像度(例 1024x576)を返すと `resolveEntitledStreamProfile` が完全一致に失敗し、**最も大きい entitled モード**へ再バインドされて逆効果になるため、候補は必ずサポート済みモードに限定している。
- テスト: `webDefaults.test.ts` に 7 件追加(旧実装では 5 件が fail することを確認済み)。

---

## D. 2026-11-12 監査(`main` = b4573e8 / PR #3 マージ後)

検証: `npm test` 23 files / 196 tests ✅ / `npm run typecheck` ✅ / `npm run build` ✅ /
本番モード起動 + HTTP スモーク(`/api/health`, `/`, `/assets/*`, Basic 認証ヘッダ)✅

新規機能(コマンドパレット / 続きからプレイ / お気に入り固定 / 自動チューニング)に
集中して確認し、以下の 9 件を修正しました。

### D-1.【中】コマンドパレットの検索対象が先頭 12 件のゲームだけだった
- 場所: `src/client/components/CommandPalette.tsx`, `src/client/lib/commandPalette.ts`
- 症状: 一覧構築時に `DEFAULT_GAME_LIMIT = 12` でゲームを切り、**その後に**検索していた。
  13 件目以降のタイトルは、名前で検索しても永久に出てこない(パレットの主目的が機能しない)。
- 修正: 構築側の上限を「検索コーパスの上限」(`MAX_GAME_LIMIT = 300`)に分離し、
  描画件数は従来どおり `filterCommandPaletteEntries(..., 60)` で制限。
- テスト: 120 件中 119 番目のタイトルが検索で引けること、900 件要求しても 300 件で
  打ち切られることを追加。

### D-2.【中】パレットの IME 確定 Enter でゲームが起動していた(日本語環境で致命的)
- 場所: `src/client/components/CommandPalette.tsx`
- 症状: 入力欄は通常のテキストフィールドなので、日本語入力の変換候補を Enter で
  確定すると、同じ Enter がパネルのハンドラに届き `runEntry()` が走る。
  候補選択のつもりが**ゲーム起動 / ストリーム停止**になる。
- 修正: `isComposing`(`event.nativeEvent.isComposing` と keyCode 229)を判定し、
  変換中はコマンドを実行しない。

### D-3.【中】ストリーム中にパレットを開いても、キー入力がゲームへ流れていた
- 場所: `src/client/App.tsx`(パレット用 `inputPaused` 制御)
- 症状: 早期 return が 2 つあり、**カタログ画面で開いた場合**に `wasPaused` を保存せず
  抜けていた。さらに「ストリーム停止」コマンドはパレットを閉じつつクライアントを破棄するため、
  復帰処理でクライアントが既に消えており、保存値が残留。次のセッションでは
  `!== null` により**一時停止が丸ごとスキップ**され、パレットに入力した文字が
  そのまま遠隔のゲームへ送られていた。
- 修正: 開くときはクライアントがある場合のみ保存、閉じるときは**クライアントの有無に
  関係なく必ず保存値をクリア**する。

### D-4.【中】自動チューニングが 4:3 パネルで「画面に収まらない解像度」を推奨
- 場所: `src/client/lib/streamAutoTune.ts`(`chooseResolution`)
- 症状: フォールバックが `1280x720` 固定だったため、1024x768 / 1112x834 のパネルでは
  横にはみ出す値を推奨(過去に B-7 で直したのと同じ種類の退行)。1680x1050 では
  1080p のままだった。
- 修正: `@shared/gfn` の `supportedStreamResolutions()`(GFN が実際に受け付けるモード)
  の中から「パネルに収まる最大・要求と同じアスペクト比優先」を選ぶ。収まるモードが
  無ければ要求をそのまま返す(未対応解像度を発明しない)。
- テスト: 1024x768 → `1024x768`、1680x1050 → `1600x900`(16:9 優先)、
  4 種のパネルで必ずサポート済みモードになることを追加。

### D-5.【低】25 Mbps の回線で 1080p60 を推奨していた
- 場所: `src/client/lib/streamAutoTune.ts`(`chooseFps`)
- 症状: 1080p60 には約 40 Mbps 必要だが、`< 15 Mbps` のときしか 30fps に落として
  いなかった。「good」判定の 25 Mbps 回線で 60fps を推奨し、フレーム落ちの原因になる。
- 修正: 35 Mbps 未満では 30fps。

### D-6.【中】言語セレクタが機能していなかった(12 言語を同梱しているのに日本語固定)
- 場所: `src/client/i18n.ts`, `src/client/components/settings/sections/SettingsInterfaceSection.tsx`
- 症状: `getAvailableLocales()` が `["ja"]` を返し、`setLocale()` が引数を無視して
  常に日本語を書き込んでいた。設定画面の言語ドロップダウンは選択しても何も起きない。
- 修正: 同梱ロケールを glob から列挙(追加ファイルだけで選択可能になる)、
  `setLocale()` を実装、`resolveInitialLocale()` で**保存済みの選択を復元**
  (未知のロケールは日本語へフォールバック)。ドロップダウンは実際の表示名順に整列。
- テスト: `src/client/i18n.test.ts` 5 件。

### D-7.【中】Basic 認証下で静的アセットがブラウザにキャッシュされ続ける
- 場所: `src/server/privateAccess.ts`
- 症状: Chromium の HTTP キャッシュは URL のみをキーにし **Authorization を含めない**。
  `express.static` は `max-age=3600` を付けるため、一度認証したプロファイルでは
  パスワード変更後も資格情報の再検証なしに HTML/アセットが再利用され得る。
- 修正: 認証済みリクエストに対し、アセットは `private, no-cache, must-revalidate`、
  ドキュメントは `private, no-store`、いずれも `Vary: Authorization` を付与。
  `/api/*` の既存 no-store は不変。実サーバーでヘッダを確認済み。
- テスト: 対象パスの判定 3 件 + ミドルウェア挙動 2 件。

### D-8.【低】`/api/speedtest` にレート制限が無かった
- 場所: `src/server/api.ts`
- 症状: 1 回 24 MiB の従量 egress。認証済みなら誰でも連打でき、無料プランの
  転送量を焼き切れる。
- 修正: アカウント単位(`WebAuthSession.accountingKey()`)で 5 秒クールダウン、
  `429` + `Retry-After`。追跡 Map は 256 件で FIFO 打ち切り(メモリ上限)。
- テスト: 4 件(初回許可 / クールダウン中拒否 / 経過後許可 / 訪問者ごとの独立性 / Map 上限)。

### D-9.【低】QR コードの有効期限切れが「残り 0:00」と表示され続ける
- 場所: `src/client/components/LoginScreen.tsx` + 12 ロケール
- 症状: 期限切れ後も `残り 0:00` が出続け、カウントダウンが生きているように見える。
- 修正: 期限切れ時は `auth.qr.codeExpired`(12 ロケールに追加)を表示し、
  `.is-expired` で強調。

### その他(軽微)
- `usePlaytime`: 同じゲームを終了処理なしで再開すると開始時刻が上書きされ、
  経過時間が失われていた → 未計上分を繰り越して加算。`formatPlaytime` は
  `Infinity h` を表示し得たため非有限値をガード(テスト 4 件)。
- `localPreferences`: 続きからプレイの同着順がブラウザ既定ロケール依存だった →
  UI 言語に固定した比較関数へ。
- パレット: 閉じた後にフォーカスが `body` へ落ちていた → 開く前の要素へ復帰。
  `aria-modal` なのに Tab が背後へ抜けていた → フォーカストラップ追加。
  描画中に更新していたカウンタ(`runningIndex`)を index map に置換。
- `styles.css`: `settings-action-button`(パネル主要ボタン)と `home-continue-row` が
  **未定義**で、無装飾のブラウザ既定ボタンとして表示されていた → 追加。

### 未修正(設計判断として報告のみ)
- **UI 言語の切り替え範囲**: 設定画面など一部の文言は `getAppLanguageLabel()` 等の
  固定英語文字列(例: "Push-to-Talk" / "English (US)")を使っており、日本語 UI でも
  英語のままです。ショートカットの競合メッセージ(8 箇所で同一文字列)も同様。
  翻訳キー化は 12 ロケール × 多数キーの追加になるため、別 PR としました。
- de/es/fr/ko/nl/pl/ro/ru/tr/zh は en 比 412 キー欠落(英語→日本語フォールバック)。
  今回追加したキーはすべて 12 ロケールに入れてあります。

---

## E. 2026-11-14 追加修正(利用者報告 2 件)

### E-1.【中】プレイ時間が実態と合わない(18 回プレイで 1 h 11 min / 未プレイと 1 回プレイの同居)
- 場所: `src/client/utils/usePlaytime.ts` → `src/client/lib/playtimeStore.ts`(新規)、
  `HomePage.tsx`, `LibraryPage.tsx`, `localPreferences.ts`
- 症状と原因は 3 つ:
  1. **正常終了でしか加算していなかった。** 加算は `/api/stream/stop` と想定クローズの
     2 経路のみ。Web ではタブを閉じる/リロードする/スリープするのが普通の終わり方で、
     その経路ではセッション全体が捨てられていた。
  2. **「最終プレイ」の参照元が画面ごとに違った。** レールは「ローカル記録または
     カタログ値の新しい方」、ヒーローとライブラリはカタログ値のみ。同じカードで
     「3日前」と「未プレイ」が並ぶ原因。
  3. 保存がブラウザ単位(localStorage)であることが UI 上どこにも示されていなかった。
- 修正:
  - 15 秒ごと + `pagehide` / `visibilitychange` で**チェックポイント保存**。
    リロード・タブクローズで失うのは最大 1 インターバル分だけ。
  - 起動時に**未終了セッションを回収**。クレジットは「最終ハートビート + 猶予」に
    限定し、閉じたままの一晩をプレイ時間として計上しない(連続 5 分以内の空白は
    バックグラウンドタブのスロットリングとみなして連続プレイ扱い)。
  - 保存形式を `{ store, active }` のエンベロープに拡張。旧形式(素のマップ)も読める。
  - `gameActivityTimestamp()` を唯一の情報源にし、**ヒーロー・レール・ライブラリが
    同じ値**を使うように統一。ライブラリの重複表示(相対時刻の二重表示)も削除。
  - `continueGame` がローカル記録も見るようになり、サーバーが `lastPlayed` を返す前
    でもヒーローが埋まる。
- テスト: `playtimeStore.test.ts` 15 件(正常終了 / タブクローズ回収 / 二重計上なし /
  リロード復帰 / 同ゲーム再開の繰り越し / 別ゲームへの切り替え / 不正タイムスタンプ /
  一晩放置の過大計上防止 / スロットリング耐性 / 旧形式・破損データの読み込み)。
  実測シミュレーション(18 回 × 4 分、毎回タブクローズ)で 76 分 → 期待どおり。

### E-2.【中】初回表示でヒーロー帯が出ず、後から挿入されて内容が飛ぶ
- 場所: `src/client/hooks/useCatalogData.ts`, `HomePage.tsx`, `styles.css`
- 症状: ヒーローは `fetchFeaturedGames` という**別リクエスト**の結果に依存するため、
  初回描画では存在せず(レールが最上部)、後から届くと上に挿入されて下の行が全部
  押し下げられる。さらに画像は通常読み込みで、挿入後にもう一段待ちが発生していた。
- 修正:
  - `isLoadingFeaturedGames` を公開し、未確定の間は `.home-hero` と**同じ高さの
    スケルトン**を確保(レイアウトシフトなし、`prefers-reduced-motion` 対応)。
  - ヒーロー画像を `loading="eager"` / `fetchPriority="high"` に。
  - ヒーローの有無が確定したら(スライド 0 件)プレースホルダは消える。
- テスト: `CommandPalette.test.tsx` に 3 件追加(未確定時はスケルトン、確定後は
  出ない、新 prop 無しでも描画できる)。

---

## F. 2026-11-14 新機能: AI プレイヤー(Numes 連携)

### 目的
[numes.ai](https://numes.ai) で発行した API キーを使い、AI にゲームをプレイさせる。
Numes は OpenAI Chat Completions 互換(`https://api.numes.ai/api/v1`)で、
GLM 5.3 / DeepSeek V4.1 Flash / Kimi K3.1 Pro などの**無料モデル**が使える。

### 構成(キーをブラウザに置かないための分割)

| 層 | ファイル | 役割 |
|---|---|---|
| 契約 | `src/shared/aiPlayer.ts` | 型・既定モデル・上限値 |
| サーバープロキシ | `src/server/aiPlayer.ts` | 環境変数からキーを読み、provider へ 1 往復。入力のサニタイズ、日次上限、エラー整形 |
| ルート | `src/server/api.ts` | `GET /api/ai/status` / `POST /api/ai/decide`(どちらも `requireAuth()`) |
| 判断の解釈 | `src/client/lib/aiPlayerPrompt.ts` | 返答 JSON の抽出・検証。**許可された操作以外は破棄** |
| 操作表 | `src/client/lib/aiPlayerActions.ts` | 操作名 → ゲームパッドビットマスク |
| ループ | `src/client/lib/aiPlayerLoop.ts` | 観測 → 判断 → 押下 → 解放。中断・バックオフ |
| 入力注入 | `src/client/platforms/gfn/webrtcClient.ts` | `sendAiGamepadState()`(パケット生成は既存経路と同一) |
| UI | `src/client/components/AiPlayerPanel.tsx` | 配信画面右下のオーバーレイ |
| 設定 | `src/client/components/settings/sections/SettingsAiSection.tsx` | 設定 → AI プレイヤー(キーの入力欄は**作らない**) |

### 設計上の判断
- **キーはサーバーの環境変数のみ。** 設定画面にキー入力欄を作らないのは意図的:
  入力させるとブラウザ・スクリーンショット・issue に残る。
- `/api/ai/*` はアクセスパスワードではなく **NVIDIA ログイン**を要求する。
  キーは運営者の残高に紐づくため、匿名の来訪者に消費させない。
- モデル ID は `author/model` 形式のみ許可。URL やパスを渡せないようにしてある。
- プロバイダのエラー本文は中継しない(キーが混ざる可能性があるため、ステータスコードのみ)。
- AI は**ゲームパッド入力のみ**。キーボードやクリップボードには触れない。
- 停止時・ストリーム終了時は必ず中立状態を送信し、押しっぱなしを残さない。

### テスト
`src/server/aiPlayer.test.ts` 17 件(設定読み取り / サニタイズ / モデル許可 / 日次上限 /
429 の Retry-After / エラー本文の非中継 / 空応答 / キーが URL・body に出ないこと)、
`src/client/lib/aiPlayer.test.ts` 19 件(操作表 / 日本語エイリアス / 未知操作の拒否 /
duration クランプ / fenced JSON / ループの解放保証 / バックオフ)、
`src/client/components/AiPlayerPanel.test.tsx` 4 件(非表示条件 / キー入力欄が無いこと)。

### 実測
ローカルの OpenAI 互換スタブに対して `requestAiPlayerDecision` を実行し、
`Authorization: Bearer` でのみキーが送られ、URL・body・エラー文に現れないことを確認。
実サーバーでは `/api/ai/status` が匿名で **401**、`/api/ai/decide` が **403** を返すことを確認。

---

## G. 2026-11-16 AI プレイヤー: 設定は「利用可能」なのに HTTP 403

### 症状
設定 → AI プレイヤーは「利用可能 / NUMES_API_KEY を検出しました」と表示されるのに、
ゲーム開始後に AI を実行すると「AI リクエストが失敗しました (HTTP 403)。」だけが出る。

### 原因(3 つの重なり)
1. **CSRF マーカーの付け忘れ(主因)。** `src/server/index.ts` の同一オリジン検証は、
   `POST /api/*` に `X-OpenNOW-Client: web` ヘッダを要求する。ブラウザの共通ヘルパー
   `api()` は自動で付けるが、AI ループは**素の `fetch()`** で `/api/ai/decide` を叩いていた。
   ヘッダが無いため認証より先に 403 で弾かれていた。
   設定画面の `/api/ai/status` は **GET** なので検証対象外 → 「利用可能」に見えた。これが
   “設定では使えるのに実行できない” の正体。
2. **エラー本文の握り潰し。** 403 の本文は `{"error":"Invalid same-origin request."}` なのに、
   クライアントは `message` フィールドしか読んでおらず、汎用文言にフォールバックしていた。
   結果、原因が分からない「HTTP 403」だけが表示された。
3. **`api()` が人間向け文言よりコードを優先。** サーバーが `{error: "missing_key", message: "..."}`
   を返した場合、`payload.error` を採用していたため `missing_key` という生のコードが出る経路があった。

### 修正
- `src/client/lib/aiPlayerLoop.ts`: 素の `fetch` を廃止し、共通の `api()` を使用
  (`X-OpenNOW-Client` を送信し、`httpStatus` 付きの Error を投げる)。テスト用に `post` を注入可能。
- `src/server/index.ts`: `/api/ai/decide` と `/api/ai/status` を CSRF マーカー検証から除外。
  配信画面をフルスクリーン/別ウィンドウで開くと設定画面とセッション Cookie が競合しうるため、
  「ヘッダを付ける」だけでは再発しうる。AI ルートは Cookie 認証 + 同一サイト限定 + JSON 本文のみ
  なので、除外しても強度は下がらない。他の `POST /api/*` は従来どおり 403 で拒否。
- `src/client/api.ts`: `message` を優先し、コードは `errorCode` として保持(既存呼び出しは無変更)。
- `src/client/lib/aiPlayerLoop.ts`: 401/403 を「このタブのログインが切れている。再読み込みして
  ログインし直す」と明示し、パネルに **ページを再読み込み** ボタンを表示。
  ログ文言を `code` で分類し、12 ロケールで翻訳するようにした(`aiPlayer.log.*`)。

### テスト
- `src/server/clientMarker.test.ts`(新規 4 件): マーカー有りは通過 / 無しは 403 / AI ルートは免除 /
  GET は影響なし。
- `src/client/lib/aiPlayer.test.ts`(+3 件、計 22 件): 403 → 「再読み込み」案内 / 401・403 の分類 /
  サーバー文言の保持。
- 実サーバーで確認: マーカー無しの `POST /api/ai/decide` は **401**(認証エラー、旧: 403)、
  マーカー無しの `POST /api/logout` は従来どおり **403**。

---

## H. 2026-11-16 AI プレイヤーが 51 ラウンド動いてもゲームが反応しない

### 症状
AI パネルは「ラウンド 51」まで進み、ログにも計画が並ぶのに、ゲーム側は一切操作されない。

### 原因
`GfnWebRtcClient.sendAiGamepadState()` がゲームパッド入力を**自前で組み立てて**いたため、
実機のパッド経路が行っている 2 つの前提を満たしていなかった。

1. **コントローラを通知していなかった。** `encodeGamepadState` はスロットビットマップを
   積む。ビットが立っていないスロットからのパケットは「存在しないコントローラ」の入力として
   破棄される。物理パッド(`updateGamepadBitmap`)とタッチパッド
   (`acquireVirtualGamepadSlot`)は必ずビットを立ててから送るが、AI 経路は
   スロット 0 に直接送っていた。
2. **キープアライブが無かった。** ゲームはパケットが届き続けることで
   「コントローラが接続されている」と判断する。物理パッドは 100 ms ごとに再送している
   (`GAMEPAD_KEEPALIVE_MS`)。AI は決定ラウンドの間(1.5 秒以上)沈黙するため、
   相手側はパッドが外れたと判断し、以降の入力を無視していた。

### 修正
- `sendAiGamepadState()` を**タッチパッド経路(`sendVirtualGamepadFrame`)への委譲**に変更。
  実運用で実績のある経路がスロット確保・ビットマップ通知・変化検出・キープアライブ・
  XInput の Y 反転をすべて持っているため、重複実装をやめた。
- `maintainAiGamepad()` を追加し、`AiPlayerInputSink.keepAlive` 経由で
  ラウンド間の待機中も 100 ms ごとに直近フレームを再送。
- ループの待機を 100 ms スライスに分割してキープアライブを刻む(`abort` 応答性は維持)。
- 誤操作の切り分け用に、実際に送信したボタンビットをログに 1 行出し、
  パネルに **「◯ 回入力送信」** を表示。これで
  「AI が考えているだけ」と「送っているがゲームが無視している」が区別できる。

### テスト
`src/client/platforms/gfn/aiGamepadInjection.test.ts`(新規 2 件): ビットマップ有無で
パケットが変わること(= 通知が wire に乗っていること)、ボタンビットがエンコードされること。
`aiPlayer.test.ts`(+4 件、計 26 件): 待機中のキープアライブ刻み / フック無しでも従来動作 /
キープアライブが例外を投げても継続 / 送信ビットのログ。

### 未確認(正直な注記)
実機の GFN セッションに対する最終確認はこの環境では行えない(サンドボックスから
`api.numes.ai` / GFN へ到達不可)。ビットマップとキープアライブは**既存の実績ある経路と
同一**になったため充足していると判断しているが、それでも反応しない場合は
NVIDIA 側の入力権限(コントローラ非対応ゲーム、キーボード必須の画面)を疑う必要がある。
その場合はログの「入力送信」行が出ているかで切り分けられる。

---

## I. 2026-11-16 AI プレイヤー: 画面送信・ログ改善・2 モード化

### 要望
1. ずっと同じ動きを繰り返す → 画面を AI に送れるようにしたい
2. ログを見やすく、すべて日本語表示に
3. 自動操作モードと、チャットで指示するモードの 2 つにしたい

### 1. 画面送信(繰り返しの根本対策)
- `src/client/lib/aiPlayerCapture.ts`: `videoRef` の現在フレームを
  **毎ラウンド**取得し、JPEG data URL として添付する。長辺 960×540 に縮小
  (トークン節約)、小さい映像は拡大しない、偶数サイズに丸める、上限超過は送らない。
- サーバー `sanitizeFrame()`: `data:image/jpeg;base64,` 以外は受け付けない。
  任意 URL を通すと運営者のキーで第三者リソースを取りに行く経路になり、SVG は
  スクリプトを運べるため。上限超過は**切り詰めず拒否**(半端な画像は課金だけ発生する)。
- 画像対応モデルのみ image パートを添付(`AI_PLAYER_VISION_MODELS`)。
  非対応モデルに parts を送ると多くのプロバイダで 400 になる。
- **併用する繰り返し対策** `src/client/lib/aiPlayerVariety.ts`:
  直前の操作をプロンプトに含め、さらに同一操作が `AI_PLAYER_REPEAT_LIMIT`(3) 回
  続いたら**探索ローテーションで強制的に別の操作**へ差し替える
  (視点を振る操作を優先 = 次の画面が変わる)。待機(操作なし)は繰り返しに数えない。
- 視点操作はフル入力ではなく 40% に変更。フルだと一瞬で向きが変わり、
  画面がほぼ同じまま = モデルが同じ判断をし続ける原因だった。

### 2. ログと日本語化
- ログを `[アイコン][本文][操作チップ]` の行構造にし、色分け
  (info/warn/error/強制切替)、最新行へ自動スクロール、消去ボタン、最大 60 行。
- ループが出す文言は**すべて日本語**。パーサのエラー文言も英語から日本語へ
  (`空の応答でした` など)。
- 操作名は `aiPlayer.actions.*` で日本語表示(`move_forward` → 「前進」など 40 種)。
- 統計行(ラウンド / 入力送信 / 画面送信 / 自動切替)を追加。
  「考えているだけ」と「送っているが反応がない」を切り分けられる。
- 12 ロケールすべてにキーを追加。ja/en/ko は UI 文言も翻訳し、
  残り 9 言語はログ本文が日本語生成であることに合わせて日本語のまま統一。

### 3. 2 モード
- **自動操作**(`mode: auto`): 従来どおりラウンドを回し続ける。
- **チャットで指示**(`mode: chat`): 入力を送ると `/api/ai/chat` に 1 往復し、
  AI の返答を会話欄に表示して**その指示に対してだけ**操作する
  (`maxRounds: 1`)。指示は 1 回で消費され、次のラウンドには残らない
  (残すと 1 回の指示が永続コマンドになる)。
- どちらも同じ送信・押下・解放経路を通るため、キープアライブや入力検証の
  修正が両モードに効く。

### テスト
| ファイル | 件数 | 内容 |
|---|---|---|
| `src/client/lib/aiPlayerVariety.test.ts` | 10 | 連続検出 / 待機は除外 / 強制切替 / 未提示操作は選ばない / ローテーション |
| `src/client/lib/aiPlayerCapture.test.ts` | 7 | 縮小率 / アスペクト比 / 非拡大 / 空映像 / 予算 |
| `src/server/aiPlayer.test.ts` | 25 | frame 検証(URL・SVG 拒否)/ 画像パートの有無 / vision 判定 / チャット prompt / 空メッセージ拒否 |
| `src/client/lib/aiPlayer.test.ts` | 30 | ラウンド毎のフレーム取得 / 取得失敗でも停止しない / チャットは 1 ラウンド / 指示の消費 |

合計 `npm test` **31 files / 297 passed**、typecheck 0 errors、build OK。

### 実測(ローカルの OpenAI 互換スタブ)
上流が受け取った内容を確認: `parts: ["text", "image_url"]` /
`hasImageData: true` / チャット時のみ `systemIsChat: true` かつ指示文を含む。
画像付きラウンドは `max_tokens` を 700 に上げ、切り詰めで JSON が壊れないようにした。

## C. 問題なしを確認した領域

| 領域 | 確認内容 | 結果 |
|---|---|---|
| sessionStore 暗号 | AES-256-GCM・ランダム 12B nonce・AAD・バージョン・brotli・4 チャンク分割・HttpOnly/SameSite=Strict/Secure(prod)/path=/api | ✅ 健全 |
| signalingBridge | Origin 検証(OPENNOW_ORIGIN 完全一致)、セッション所有権チェック、maxPayload 2MB、close 時のシグナリング解除 | ✅ |
| `/api/speedtest` | 認証必須・サイズ 256KB〜24MB バウンド・no-store・drain/abort 処理 | ✅ |
| 地域選択修正 | `*.nvidiagrid.net` https のみの allowlist(SSRF 防止)、poll/claim は既存動作を尊重 | ✅ |
| タイマー/リスナー | heartbeat・stats・gamepad poll・input リスナーは detach/dispose でクリーンアップ | ✅ リークなし |
| 浮遊 Promise | サーバー側は全て `void ... .catch(next)` 等で処理 | ✅ |
| 緩い等値比較 | 検出された `==` は全て `== null` イディオム | ✅ |
| タッチ実装(機能面) | 2 本指→1 本指遷移、3 本指以上、cancel 経路、ボタン解放の冪等性 | ✅ |
| 接続テスト | 401 ハンドリング、タイムアウト、AbortController、逐次レポート | ✅ |
