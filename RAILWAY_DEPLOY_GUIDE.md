# OpenNOW Web → Railway(Trialプラン)デプロイ手順

対象リポジトリ: https://github.com/OpenCloudGaming/Opennow-web
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
