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
| `NUMES_API_KEY` | `sk-...`(任意) | AI プレイヤーを使う場合のみ。**サーバー専用**で、ブラウザには一切送られない |

## 3.5. AI プレイヤーを有効にする(任意)

Numes(<https://numes.ai>)で発行した API キーを使い、AI にゲームをプレイさせられます。

1. <https://numes.ai/dashboard/keys> で **Create key** → 表示された `sk-...` をコピー(再表示はできません)。
   無料モデル(Kimi K3.1 Pro / GLM 5.3 / DeepSeek V4.1 Flash など)はクレジット追加なしで試せます。
2. ホスティングの **Environment / Variables** に以下を追加します。

| 変数 | 値の例 | 用途 |
|---|---|---|
| `NUMES_API_KEY` | `sk-...` | 必須。**サーバー側でのみ使用** |
| `NUMES_BASE_URL` | `https://api.numes.ai/api/v1` | 省略可(既定値) |
| `AI_PLAYER_MODEL` | `z-ai/glm-5.3` | 省略可。既定モデル |
| `AI_PLAYER_DAILY_REQUESTS` | `200` | 省略可。1 アカウントあたりの 1 日上限(`0` で無制限) |
| `AI_PLAYER_TIMEOUT_MS` | `60000` | 省略可。1 リクエストの期限(5,000〜180,000)。思考モデルは 90,000 程度を推奨 |

3. Redeploy します。`GET /api/ai/status` が `{"configured":true,...}` を返せば有効です。
4. 配信画面の右下に **AI** ボタンが出ます。パネルには 2 つのモードがあります。
   - **自動操作**: 「自動で操作を開始」でラウンドを回し続けます(もう一度で停止)
   - **チャットで指示**: 「右の宝箱を開けて」のように入力すると、AI が画面を見て 1 回だけ操作し、返答を表示します

**画面送信について**: **画像入力に対応したモデル**でのみ、毎ラウンド配信映像のフレームを
960×540 の JPEG にして添付します。「同じ動きを繰り返す」問題の対策はこれです。

| モデル | 画像入力 | 備考 |
|---|---|---|
| `qwen/qwen3.8-27b` | ○ | 無料。パネルの「画面をAIに送る」で最初に案内される |
| `dealignai/glm-5.3-flash-uncensored-fp8` | ○ | 無料 |
| `uniboshi/kimi-k3-abliterated-v1` | ○ | 無料 |
| `z-ai/glm-5.3`(既定) | × | text-only。**画像を付けると HTTP 400 で全ラウンド失敗する** |
| `deepseek/deepseek-v4.1-flash` / `moonshotai/kimi-k3.1-pro` | × | text-only |

> 2026-11-17 の修正: 以前は既定の `z-ai/glm-5.3` を画像対応として扱っていたため、
> 画面送信をオンにすると毎回 `400 invalid_request` になっていました
> (詳細は `BUG_AUDIT_REPORT.md` §J)。現在は非対応モデルではチェックが入らず、
> 画像対応モデルを選ぶよう案内します。万一プロバイダが画像だけを拒否した場合は、
> そのラウンドを自動でテキストのみに切り替えて続行し、ログに理由を残します。

トークン消費が増えるため、`AI_PLAYER_DAILY_REQUESTS` で上限を設定することを推奨します。
非対応モデルでは自動的にテキストのみで動作します。

**応答速度について**: 思考モデルは 1 ラウンドに数秒〜数十秒かかります。Numes の実測(7 日)では
`moonshotai/kimi-k3.1-pro` が最初の 1 文字まで中央値 8.4 秒 / p90 約 40 秒、
`deepseek/deepseek-v4.1-flash` は約 1.4 秒です。既定の期限は 60 秒で、超えた場合は
「何秒待って諦めたか + モデル名」を日本語で表示します(パネルにも遅いモデルの注意を表示)。
自動操作を軽快に回したい場合は `AI_PLAYER_MODEL=deepseek/deepseek-v4.1-flash` を推奨します。

**セキュリティ上の注意**

- キーは**このアプリの画面・チャット・リポジトリに貼らないでください。** 設定画面にも入力欄はありません(サーバーの環境変数のみ)。
- キーは Numes アカウント全体の残高に紐づきます。`AI_PLAYER_DAILY_REQUESTS` で 1 アカウントあたりの消費を抑えられます。
- `/api/ai/*` は **NVIDIA ログイン済み**のセッションのみ許可されます(アクセスパスワードだけでは通りません)。
- 課金対象のリクエストはサーバーが発行します。ブラウザは決定(計画と操作)だけを受け取ります。
- AI の操作はゲームパッド入力として送信されます。誤操作しうるため、対戦相手がいるゲームでの使用は避けてください。

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

## Render API 連携(デプロイの自動検証)

`render.yaml` の `autoDeploy: true` により、`main` への push で Render が自動ビルドします。
ここに **「本当に本番へ反映されたか」を自動で確認する仕組み**を追加しました。
Render API キーを使うため、ダッシュボードを見に行かなくても失敗に気づけます。

### 仕組み

| 構成要素 | 役割 |
|---|---|
| `.github/workflows/render-deploy.yml` | `main` への push ごとに、その commit のデプロイを Render API で特定 → 完了まで待機 → 本番 `/api/health` の `commit` と突き合わせ |
| `scripts/render-status.mjs` | 上記の実処理。ローカルからも同じコマンドで状態確認・再デプロイが可能 |
| `scripts/render-api.mjs` | Render API クライアント(依存パッケージなし・Node 標準の `fetch` のみ) |
| `scripts/render-api.test.mjs` | API 応答形状・SHA 照合・キー漏えい防止のユニットテスト |

検証は 3 段階です。

1. **デプロイの存在**: その commit に対するデプロイが作られたか
2. **結果**: `live` で終わったか(失敗時はジョブが赤くなり、`build_failed` 等を表示)
3. **本番の同一性**: `https://<service>/api/health` の `commit` がその SHA と一致するか
   (古いビルドが残っている「反映されていないのに緑」を防ぐ)

### セットアップ(GitHub に 2 つの Secret を登録するだけ)

1. Render ダッシュボード → 右上アカウント → **Account Settings** →
   [API Keys](https://dashboard.render.com/u/settings?add-api-key) → **Create API Key**
   (表示は作成時のみ。必ずパスワードマネージャー等に保管)
2. 対象サービスの URL から **サービス ID(`srv-...`)** を控える
   (例: `https://dashboard.render.com/web/srv-cuk123abc` の `srv-cuk123abc`)
3. GitHub リポジトリ → Settings → Secrets and variables → **Actions** →
   **Secrets** タブで 2 件登録:
   - `RENDER_API_KEY` … 手順 1 のキー
   - `RENDER_SERVICE_ID` … 手順 2 の `srv-...`
     (ダッシュボード URL をそのまま貼っても `srv-...` を自動抽出します)
4.(任意)Variables タブに `RENDER_HEALTH_URL`
   (`https://<service>/api/health`)。未設定でも Render API が返す公開 URL から自動決定されます。

> **重要**: API キーは「全ワークスペースにアクセスできる秘密情報」です。
> リポジトリへのコミット・Issue/PR への貼り付け・チャットへの投稿はしないでください
> (漏えいした場合はダッシュボードから即 Revoke)。

Secret 未設定のフォークや初期状態では、ワークフローは**失敗せずスキップ**します。

### ローカルでの使い方

```bash
# 直近デプロイの状態を表示
RENDER_API_KEY=rnd_xxx RENDER_SERVICE_ID=srv-xxxxx npm run render:status

# 特定コミットのデプロイを完了まで追跡し、本番の health まで検証
RENDER_API_KEY=rnd_xxx RENDER_SERVICE_ID=srv-xxxxx \
  npm run render:status -- --commit $(git rev-parse HEAD) --wait

# そのコミットを明示的に再デプロイ(自動デプロイが無効な場合の保険)
RENDER_API_KEY=rnd_xxx RENDER_SERVICE_ID=srv-xxxxx \
  npm run render:status -- --deploy --commit $(git rev-parse HEAD) --wait

# ビルドキャッシュを捨てて再デプロイ(依存関係が壊れたとき)
RENDER_API_KEY=rnd_xxx RENDER_SERVICE_ID=srv-xxxxx \
  npm run render:status -- --deploy --commit HEAD --clear-cache --wait
```

終了コードは `0`=検証成功 / `1`=失敗・未反映 / `2`=設定不足(キーや ID の欠落)。
そのまま CI のゲートとして使えます。

### できること・できないこと

**できること**
- マージ → 本番反映の確認を自動化(失敗時は GitHub の通知メール/画面で分かる)
- 任意コミットの再デプロイ・再起動・キャッシュクリアを CLI から実行
- サービスの設定(ブランチ・自動デプロイ有無・`suspended` 状態・公開 URL)を JSON で取得

**このリポジトリからは行わないこと(意図的)**
- 環境変数(`SESSION_SECRET` / `OPENNOW_ORIGIN` など)の読み書き
  — 秘密情報が CI ログや Artifact に残るリスクを避けるため、設定はダッシュボードで管理します
- API キーをアプリの実行時環境に置くこと
  — キーは CI 専用です。Web アプリ本体は Render API を一切呼びません

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
