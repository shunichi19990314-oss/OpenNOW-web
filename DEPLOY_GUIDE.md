# OpenNOW Web デプロイガイド(Railway / Render)

---

# Part 1: Railway(Trial プラン)

対象リポジトリ: https://github.com/shunichi19990314-oss/OpenNOW-web
(上流: https://github.com/OpenCloudGaming/Opennow-web)
構成: Node.js (Express 5 + tsx) サーバーが Vite ビルド済み SPA (`dist/`) を配信。
シグナリング用 WebSocket (`/api/signaling`) は同一オリジン・同一ポートで動作。

> 2026-10-10 時点の情報。ローカルで `npm ci` → `npm run build` → `NODE_ENV=production npm start` を実行し、
> SPA 配信 (HTTP 200) と API (HTTP 200) が正常動作することを確認済み。

---

## 0. Trial プランの前提

- 初回サインアップ時に **$5 の一回性クレジット(30日で失効)**、クレジットカード不要(GitHub 認証あり)。
- Trial 中の上限: サービスあたり最大 2 vCPU / 1 GB RAM、5 プロジェクト / 5 サービス、ビルド 20 分・同時 3 本、一時ディスク 1 GB。
- 30 日経過後は Free プラン($1/月、1 vCPU / 0.5 GB)に移行。
- 料金目安(24 時間起動): CPU $0.00000772/vCPU/秒、RAM $0.00000386/GB/秒。
  このアプリはアイドル時 0.1 vCPU / 256 MB 程度なので **月 $3〜5 前後** → $5 クレジットでほぼ収まるが、
  ビルド分も含めるとギリギリ。ゲーム映像は WebRTC で NVIDIA ↔ ブラウザ間を直接流れ、Railway を通るのは軽量なシグナリングのみなので通信料(egress)は少ない。

## 1. リポジトリを Fork する(推奨)

Railway は第三者の公開リポジトリも直接デプロイできるが、**push 時の自動デプロイは contributor 権限がないと効かない**。
GitHub で Fork してから自分の Fork をデプロイするのがおすすめ。

## 2. Railway でプロジェクト作成

1. https://railway.com/new → GitHub アカウントでログイン(初回は Railway GitHub App の許可)。
2. **Deploy from GitHub repo** → Fork した `Opennow-web` を選択。
3. Nixpacks が `package.json` を自動検出し、`npm ci` → `npm run build` → `npm start` を自動実行する(手動設定不要)。
   - 明示したい場合のみ `railway.toml` をリポジトリ直下に置く(本ガイド同梱ファイル参照)。

## 3. サービス変数を設定する(Variables タブ)⚠️ 重要

| 変数 | 値 | 説明 |
|---|---|---|
| `NODE_ENV` | `production` | 未設定だと Vite 開発サーバーで起動してしまう(公開利用不可) |
| `NPM_CONFIG_PRODUCTION` | `false` | **必須の回避策。** `NODE_ENV=production` があると npm が devDependencies をスキップし、`npm run build`(tsc + vite)が失敗する |
| `NIXPACKS_NODE_VERSION` | `22` | README は Node 22+ 必須。package.json に engines 指定がないため明示する |
| `SESSION_SECRET` | 32 文字以上のランダム文字列 | 生成例: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`。全インスタンスで同一値にする。変更すると全員ログアウト |
| `OPENNOW_ORIGIN` | `https://<Railwayのドメイン>` | **手順 4 の後に**正確な公開オリジンを入れる。WebSocket の Origin 検証に使われ、不一致だとシグナリング接続が拒否される |
| `PORT` | (設定しない) | Railway が自動注入し、アプリは `process.env.PORT` を読む |

## 4. 公開ドメインを生成 → OPENNOW_ORIGIN に反映

1. サービス → **Settings → Networking → Generate Domain**(例: `opennow-web-production-xxxx.up.railway.app`)。
2. `OPENNOW_ORIGIN=https://opennow-web-production-xxxx.up.railway.app` を変数に設定(`https://` 込み・末尾スラッシュなし・完全一致)。
3. Redeploy。
4. Railway の公開ドメインは HTTPS と **WebSocket アップグレードに標準対応**なので、`wss://…/api/signaling` は追加設定なしで通る。

## 5. 動作確認

- ブラウザで `https://<ドメイン>/` を開く → OpenNOW の QR ログイン画面が出れば OK。
- Deploy ログに `OpenNOW Web is running at http://localhost:<PORT>` が出る。
- 実際のログイン〜ストリーミング検証には自分の NVIDIA / GeForce NOW アカウントが必要。

## 補足・注意点

- GFN カタログキャッシュはコンテナ内 `.opennow-data/` に書かれる(起動時に自動初期化)。再デプロイで消えるが動作上問題なし。残したい場合のみ Volume(0.5 GB)を `/app/.opennow-data` にマウント。
- 独自ドメインを後から付けたら `OPENNOW_ORIGIN` も必ず更新する。
- Trial クレジットが尽きるとサービスは停止する。Settings → Usage で消費を確認可能。
- 本アプリは **非公式の GeForce NOW クライアント**。利用は自分の NVIDIA アカウント・自己責任であり、NVIDIA の利用規約に照らして判断すること。


---

# Part 2: Render(無料プラン)

同梱の **`render.yaml`(Blueprint)** により、Render でも数クリックでデプロイできます。
Node バージョンは `package.json` の `engines.node: "22"` で両プラットフォーム共通に固定されます。

## デプロイ手順(Blueprint 方式・推奨)

1. [render.com](https://render.com) → GitHub アカウントでサインアップ/ログイン
2. **New +** → **Blueprint** → このリポジトリ(`OpenNOW-web`)を選択
   - 初回は Render GitHub App にリポジトリへのアクセスを許可
3. **Apply** — `render.yaml` から Web サービスが自動作成される:
   - Build: `npm ci --include=dev && npm run build`(typecheck + vite build)
   - Start: `npm start`(`tsx src/server/index.ts`)
   - Healthcheck: `/api/health`
   - `SESSION_SECRET`: Render が強い乱数を自動生成
   - リージョン: singapore(日本から最寄り。dashboard で変更可)
4. 初回デプロイ完了後、**Settings → Networking の URL を確認**
   (例: `https://opennow-web-xxxx.onrender.com`)
5. **Environment** タブで `OPENNOW_ORIGIN` にその URL を
   `https://` 込み・**末尾スラッシュなし・完全一致**で設定 → 自動再デプロイ
6. URL を開いて QR ログイン画面が出れば成功

## 手動設定する場合(Blueprint を使わない)

- New + → **Web Service** → リポジトリ選択
- Runtime: **Node**、Build Command: `npm ci --include=dev && npm run build`、Start Command: `npm start`
- 環境変数: `NODE_ENV=production` / `SESSION_SECRET`(Generate 推奨)/ `OPENNOW_ORIGIN`(手順 5 のとおり後設定)
- Health Check Path: `/api/health`

## Render 無料プランの注意点

- **15 分無通信でスリープ**する仕様への対策を**二重で同梱済み**(下の「スリープ対策」参照)。
  対策なしでの常時運用は有料プラン(Instance が常駐)が必要。
- 512 MB RAM / 0.1 CPU — 本アプリ(アイドル ~200 MB)は収まります。
- WebSocket は無料プランでもサポート済み(`/api/signaling` はそのまま動作)。
- ディスクは一時領域 — GFN カタログキャッシュは再起動ごとに再取得(動作上問題なし)。
- `OPENNOW_ORIGIN` 未設定/不一致の場合、シグナリング WS の Origin 検証で全接続が拒否されます
  (アプリ内「設定 → ストリーム → 接続テスト」の **シグナリングサーバー** 項目で検出可能)。

## スリープ対策(同梱済み・要 1 手順)

無料プランの 15 分スリープに対し、このリポジトリには 2 層の対策が入っています。

### 層 1: アプリ内セルフ ping(自動・設定不要)

`KEEP_ALIVE=true`(`render.yaml` で設定済み)により、サーバーが **10 分ごとに自分の
`/api/health` を外部経由で叩き**、Render のアイドルタイマーをリセットします。
一度起きていれば以後スリープしません。間隔は `KEEP_ALIVE_INTERVAL_MINUTES`(5〜30)で変更可。

### 層 2: GitHub Actions の定期 ping(「起こし役」・1 手順だけ必要)

スリープ中/デプロイ直後はセルフ ping も止まっているため、外からの最初の一撃が必要です。
同梱のワークフロー `.github/workflows/render-keep-awake.yml` が **10 分ごと**に health URL を叩きます
(公開リポジトリなので Actions は無料無制限)。

**設定手順(1 回だけ)**:
1. GitHub リポジトリ → Settings → Secrets and variables → **Actions** → Variables タブ
2. **New repository variable** → Name: `RENDER_PING_URL`、Value: `https://<あなたのサービス>.onrender.com/api/health`
3. 完了 — 以降 Actions タブに 10 分ごとの実行履歴が並びます(手動確認は Run workflow でも可能)

注意: GitHub のスケジュール実行は混雑時に数分遅延することがあり、最悪の場合はコールドスタート
(〜1 分)が 1 回発生し得ます。また 60 日間リポジトリに動きがないと GitHub がスケジュール
ワークフローを自動停止するため、その場合は Actions タブから再有効化してください。

### 代替案(外部サービス)

GitHub Actions を使わない場合は [UptimeRobot](https://uptimerobot.com) や
[cron-job.org](https://cron-job.org) 等で同じ URL を 5〜10 分間隔で監視しても同効果です。

## トラブルシュート(Render で「Request failed (500)」等)

1. **Render ダッシュボード → 対象サービス → Logs** を開き、失敗時刻の前後を確認:
   - `[Server] Unhandled promise rejection ...` / `[Server] Uncaught exception ...`
     → サーバーコード内の未処理エラー(内容を報告してください)
   - `Your service was OOM killed` / 再起動イベント → メモリ不足。
     カタログ操作が重い場合は環境変数 `NODE_OPTIONS` の
     `--max-old-space-size` を下げる(既定 384)か、有料プラン(2 GB)を検討
   - `[CloudMatch] ...` のエラー行 → NVIDIA 側応答の詳細(地域・ゲーム固有の問題の切り分けに有用)
2. **ブラウザ DevTools(F12)→ Network** で赤いリクエストの URL と
   Response の中身を確認(`/api/stream/create` か `/api/resolve-launch-id` か等で原因箇所が分かる)
3. インスタンスがスリープ明け直後はコールドスタートで数十秒応答しないことがあります
   (Actions の定期 ping を設定済みなら通常発生しません)

## Railway ↔ Render 比較(このアプリの場合)

| 項目 | Railway Trial | Render Free |
|---|---|---|
| 常駐性 | 30 日間は常駐($5 クレジット内) | スリープ対策を同梱(セルフ ping + Actions、要 1 手順) |
| リソース | 最大 2 vCPU / 1 GB | 0.1 CPU / 512 MB |
| 自動デプロイ | GitHub 連携 | Blueprint / autoDeploy |
| WebSocket | ✅ | ✅ |
| 無料期間 | 30 日($5 一回性) | 無期限(スリープあり) |

**ゲームプレイ用途では、セッションがスリープで切れない Railway のほうが安定します。**
Render は常時アクセス可能なミラー/バックアップ、または Railway クレジット消化後の受け皿として有用です。
両方にデプロイした場合、`SESSION_SECRET` はサービスごとに別々で問題ありません
(クッキーはオリジン単位のため相互干渉なし)。
