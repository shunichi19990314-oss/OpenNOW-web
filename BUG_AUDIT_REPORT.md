# バグ監査レポート — Opennow-web (Railway fork)

監査日: 2026-10-10 / 対象: `shunichi19990314-oss/Opennow-web-railway` main
検証: typecheck ✅ / ユニットテスト 18 件 ✅ / プロダクションビルド ✅ / エンドポイントスモークテスト ✅

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

### B-1.【中低】放棄されたストリームセッション ID が Cookie に恒久蓄積
- 場所: `src/server/webAuth.ts` `addActiveSession` / `src/server/sessionStore.ts` `persistCookieSession`
- 詳細: `removeActiveSession` は `/api/stream/stop` 時のみ呼ばれる。タブを閉じて放棄されたセッションの ID は 30 日の Cookie 有効期内に蓄積し続ける。スナップショットが 4 チャンク(約 14KB)を超えると `onHeaders` コールバック内で `throw` され、**ヘッダー送信後のため 500 に劣化できず接続が壊れる**。数百件の放棄が必要で確率は低いが、緩やかな劣化として実在。
- 推奨対応: `activeSessionIds` に上限(例: 最新 20 件)を設ける、または `/api/active-sessions` 照合時に GFN 側に存在しない ID を prune。

### B-2.【低】トークンリフレッシュにエラーハンドリングなし
- 場所: `src/server/webAuth.ts` `requireAuth`
- 詳細: `refreshAuthTokens(...)` がネットワーク一過性エラーで reject すると、例外がそのまま伝播し全 API が 500(401 相当の「再サインイン」誘導にならない)。`previous.authClientId!` の非 null アサーションも、旧バージョンのスナップショットに対して脆い。リトライ自体は次回リクエストで可能なため実害は限定的。

### B-3.【無害】完全重複したデッドコード
- 場所: `src/client/App.tsx` 2685–2691 行 — `if (launchAbortRef.current) { return; }` が連続 2 回(上流リポジトリ由来)。動作影響なし。

### B-4.【設計通り】ja/en 以外のロケール欠落
- de/es/fr/ko/nl/pl/ro/ru/tr/zh は en 比 244 キー欠落(英語フォールバック、意図された設計)。**プレースホルダ `{{...}}` の不一致は 12 ロケール全てで 0 件**。ja は完全翻訳済み。

### B-5.【監視】キャッシュのディスク成長
- `.opennow-data`(gfn-cache / media-thumbs)は読み出し時 TTL(12h)チェックと一部クリーンアップ経路のみで、定期 sweep はなし。Railway の 1GB 一時ディスクは再デプロイでリセットされるため実務リスクは低いが、長期無デプロイ運用ではサムネイル数に留意。

### B-6.【許容】広めの CSP `connect-src`
- `connect-src 'self' https: ws: wss:` は GFN 全地域エンドポイントへの到達に必要。`script-src 'self'`、`object-src 'none'`、`frame-ancestors 'none'` 等は適切に絞られている。

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
