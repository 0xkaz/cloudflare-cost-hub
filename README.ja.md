# Cloudflare Cost Hub

Cloudflare の利用状況とコストを「見える化」するダッシュボードです。**Cloudflare でサインイン**すると、アカウントのアナリティクスを読み取り、無料枠の使用状況・有料プランの推定コスト・各クォータを消費しているインスタンス・コスト推移・メール通知までを一画面に表示します。実装はすべて Cloudflare スタック上です。

> [English README is here](./README.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![ko-fi](https://img.shields.io/badge/Ko--fi-Support-ff5e5b?logo=ko-fi&logoColor=white)](https://ko-fi.com/0xkaz)

**セルフホストは完全無料。** ホスト版は寄付で運用しています。役に立ったら
[Ko-fi で応援](https://ko-fi.com/0xkaz)してください。

## スクリーンショット

![Cloudflare Cost Hub ランディングページ](./docs/screenshots/landing.png)

**ダッシュボード** — 当月の推定コスト・日次リクエスト・無料枠ステータス・月末予測。

![ダッシュボード](./docs/screenshots/dashboard.png)

**Services** — 全プロダクト横断の Top cost drivers を推定コスト／有料枠シェア順に表示。

![Services ビュー](./docs/screenshots/services.png)

**インスタンス詳細** — 任意のメトリクスをドリルダウンし、無料枠 vs 有料枠の使用量と推定コストを確認。

![インスタンス詳細](./docs/screenshots/d1-detail.png)

<!-- これらのキャプチャはアカウント名・インスタンス名をボカしています（金額は実値）。 -->

## 主な機能

- **Cloudflare でサインイン**（OAuth 2.0 + PKCE）— 読み取り専用のアナリティクスアクセス。API トークンの手入力不要。トークンは暗号化して保存。
- **複数アカウント対応** — 複数の Cloudflare アカウントを認可し、アプリ内で切り替え。
- **全プロダクトを一覧** — Workers / D1 / KV / R2 / Pages / Durable Objects / Queues / Workers AI（リクエスト・行数・操作数・ストレージ・実行時間・Neurons など）。
- **無料枠 vs 有料プランの3色表示** — 🟢 無料枠内 / 🟡 無料枠超だが有料含有枠内（コスト$0）/ 🔴 課金発生。有料プランはトークンが billing を読める場合のみサブスクリプションから自動判定（`Billing Read` 付き API トークンが必要。OAuth サインインでは billing を読めないため、取得可能な場合のみ表示）。
- **推定コスト＆月末予測** — 有料プランの含有量を超えた分の使用量ベース推定。ランレートから月末コストを外挿。
- **インスタンス別内訳** — メトリクスをクリックすると、どの DB / バケット / namespace / スクリプト / モデルが消費しているかをコスト・枠シェア順に表示（ID は名前に解決）。
- **Services ビュー** — サービス横断の「Top cost drivers」と製品別の月次トレンド。
- **コスト推移・履歴** — 日次スナップショットで、Cloudflare の約90日保持を超えてコスト履歴を保持（アカウント単位で D1 + R2）。
- **異常検知** — 使用量グラフでスパイク日をハイライト。
- **予算（Budgets）** — アカウント別に月額予算を設定。日次ダイジェストが月末予測の予算接近・超過を警告。
- **メールアラート** — 課金発生・無料枠接近・予算超過時にユーザー単位の日次ダイジェスト（Resend）。日次 cron が接続済み全アカウントをスナップショット／アラート（重複排除の fan-out）。宛先・ON/OFF はユーザー単位。
- **レポート（Reports）** — 月次コスト履歴・現在の使用状況を CSV エクスポート。

## 技術スタック

- React 18 + Vite + TypeScript + Tailwind CSS + Recharts（ルート分割・遅延ロード）
- Cloudflare Workers 上の Hono（単一 Worker が API と SPA を配信）
- D1（users / トークン / スナップショット / アラート設定 / 予算 / アカウント entitlement）
- R2（日次スナップショットのアーカイブ・アカウント単位）
- KV（ダッシュボード/使用量レスポンスの SWR キャッシュ・任意）
- Durable Objects（アラート重複排除の土台）
- Cloudflare GraphQL Analytics + REST API
- Cloudflare OAuth（self-managed client）によるサインイン
- Resend（メールアラート）

## アーキテクチャ

```
ブラウザ ──HTTPS──▶  Cloudflare Worker (Hono)
                     ├─ /api/auth/cf/*     Cloudflare OAuth ログイン(PKCE)・セッション(JWT Cookie)
                     ├─ /api/dashboard/*   usage / services / breakdown / trend / snapshot / alert-test
                     ├─ /api/settings/*    アカウント/プラン・ユーザー別アラート設定
                     ├─ /api/budgets       月額予算(取得/設定/削除) + 予測ステータス
                     ├─ /api/reports/*     CSV エクスポート（コスト履歴・使用状況）
                     └─ *                  React SPA を配信 (Workers Sites)

Worker ──▶ Cloudflare GraphQL Analytics   (製品別の使用量)
Worker ──▶ Cloudflare REST API            (アカウント一覧・プラン・ID→名前解決)
Worker ──▶ D1                             (users / cf_oauth_tokens[暗号化] / snapshots /
                                           budgets / account_entitlements / アラート設定)
Worker ──▶ R2                             (日次スナップショット・アカウント単位)
Worker ──▶ KV (CACHE)                     (ダッシュボード/使用量の SWR キャッシュ・任意)
Worker ──▶ Resend                         (日次アラートメール)
Cron(日次) ──▶ 接続済み全アカウントのスナップショット + アラート（重複排除の fan-out）
```

認証は設計上「二層・単一サインイン」です。**Cloudflare でサインイン**が、ユーザー認証（セッション発行）と読み取り専用アナリティクスの認可を同時に行います。アクセス／リフレッシュトークンは `TOKEN_ENC_KEY` で AES-GCM 暗号化し、ユーザー単位で D1 に保存。データ取得時はユーザーの保存トークンからアクティブアカウントを解決し、定期ジョブでは env 設定のアカウントにフォールバックします。

コスト履歴・予算は **Cloudflare アカウント単位**（ユーザー単位ではない）でスコープされ、同じアカウントを連携したチームメンバーは履歴を共有します。アラートの宛先・ON/OFF はユーザー単位。なお**アプリ自体に有料プランはなく、全機能が無料**です（[セルフホストと応援について](#セルフホストと応援について)参照）。

## 前提

- Node.js 20+
- Cloudflare アカウント（フルなデータには Workers Paid 推奨）
- Cloudflare [OAuth クライアント](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/)
- [Resend](https://resend.com) の API キー（任意・メールアラート用）

## セットアップ

1. 依存のインストールとローカル設定の作成:

   ```bash
   npm install
   cp wrangler.example.toml wrangler.toml   # 自分の ID を埋める（下のフォーク時の注意を参照）
   ```

2. D1 を作成し、返却された `database_id` を `wrangler.toml` に反映:

   ```bash
   npx wrangler d1 create cloudflare-cost-hub-db
   ```

3. マイグレーション適用:

   ```bash
   npm run db:migrate
   ```

4. （任意）レスポンスキャッシュ用の KV namespace を作成し、id を `wrangler.toml`（`CACHE` バインディング）に設定。無くても動作します（毎回再計算）。

   ```bash
   npx wrangler kv namespace create CACHE
   ```

5. Cloudflare OAuth クライアントを作成（アカウント → アカウントの管理 → OAuth クライアント）:
   - グラントタイプ **Authorization Code**、トークン認証方式 **None (PKCE)**（public）または client secret（confidential）
   - リダイレクト URL: `https://<ドメイン>/api/auth/cf/callback`
   - 必須スコープ: `Account Analytics Read` / `Account Settings Read` / `D1 Read` / `Workers KV Storage Read` / `Workers Scripts Read`
   - 任意: `Queues Read`（Queue インスタンス名の解決）, `User Details Read`（実 email — `CF_OAUTH_EXTRA_SCOPES` 参照）
   - 注意: `Billing Read` は OAuth クライアントでは提供されないため、有料プラン自動検出は手動発行の API トークンでのみ可能
   - 他人のアカウント連携を許すには **public** クライアント化（DNS TXT のドメイン検証が必要）

6. `wrangler.toml` の vars とシークレットを設定:

   ```bash
   # vars: CF_OAUTH_CLIENT_ID, CF_OAUTH_REDIRECT_URI, ALERT_EMAIL_FROM, ALERT_EMAIL_TO
   npx wrangler secret put SESSION_SECRET        # ランダム文字列
   npx wrangler secret put TOKEN_ENC_KEY         # base64 32バイト: openssl rand -base64 32
   npx wrangler secret put CF_OAUTH_CLIENT_SECRET # confidential クライアントのみ
   npx wrangler secret put RESEND_API_KEY        # 任意（メールアラート）
   ```

7. ローカル開発:

   ```bash
   make dev   # SPA :5173 → Worker :8787 へプロキシ
   ```

> **フォーク時の注意:** `wrangler.toml` は git 管理から除外され、代わりに
> プレースホルダ入りの `wrangler.example.toml` を同梱しています。これを
> `wrangler.toml` にコピーし、`routes` のカスタムドメイン・`database_id`・`CACHE`
> の `id`・`CF_ACCOUNT_ID` / `CF_ACCOUNT_NAME`・`APP_URL`・`CF_OAUTH_CLIENT_ID` /
> `CF_OAUTH_REDIRECT_URI` を自分のものに埋めてください。秘密情報はコミットされません
> （`wrangler secret put` で設定）。

## ビルド & デプロイ

```bash
make build
npm run deploy   # または wrangler deploy
```

日次 cron（`0 1 * * *`）がコストのスナップショット取得とアラート送信を行います。

## コマンド

| コマンド | 説明 |
| --- | --- |
| `make dev` | フロントエンド + Worker の開発サーバ起動 |
| `make lint` | ESLint |
| `make test` | Vitest（ユニット + e2e）|
| `make test-e2e` | API の e2e テストのみ実行 |
| `make build` | フロント + Worker のビルド |
| `npm run deploy` | ビルドしてデプロイ |
| `npm run db:migrate` | D1 マイグレーション適用 |

## ディレクトリ構成

```
src/
├── client/                 # React SPA（Dashboard / Services / Budgets / Alerts / Reports / Settings / Login …）
├── server/
│   ├── index.ts            # Hono アプリ + SPA フォールバック + cron(全アカウント fan-out)
│   ├── cloudflare-api.ts   # GraphQL 使用量・料金・無料枠カード・インスタンス内訳
│   ├── cloudflare-rest.ts  # アカウントプラン(accessible) + ID→名前解決
│   ├── cf-oauth.ts         # Cloudflare OAuth(PKCE)・トークン保存・アカウント解決・identity
│   ├── services.ts         # サービス横断分析 + Top cost drivers
│   ├── snapshots.ts        # アカウント単位スナップショット + コストトレンド(読取専用)
│   ├── alerts.ts           # ユーザー単位の日次ダイジェスト(Resend) + 予算バナー + entitlement
│   ├── budgets.ts          # 予算評価(純粋関数)
│   ├── reports.ts          # CSV 生成(純粋関数)
│   ├── cache.ts            # KV stale-while-revalidate キャッシュ
│   ├── crypto.ts           # AES-GCM トークン暗号化
│   ├── routes/             # auth / cf-oauth / dashboard / settings / budgets / reports
│   └── db/                 # D1 データアクセス（snapshots / budgets / account-entitlements …）
└── shared/                 # 共有 TypeScript 型
migrations/                 # D1 スキーマ(0001〜0014)
```

## 環境変数

非機密値は `wrangler.toml` の `[vars]`、機密値は `wrangler secret put` で設定します。全項目は `.env.example` を参照。

| 変数 | 種別 | 説明 |
| --- | --- | --- |
| `CF_OAUTH_CLIENT_ID` | var | Cloudflare OAuth クライアント ID |
| `CF_OAUTH_REDIRECT_URI` | var | OAuth コールバック URL |
| `CF_OAUTH_CLIENT_SECRET` | secret | confidential クライアントのみ（PKCE は不要） |
| `SESSION_SECRET` | secret | セッション/OAuth state Cookie の署名 |
| `TOKEN_ENC_KEY` | secret | 保存トークン用 base64 32バイト AES-GCM 鍵 |
| `APP_URL` | var | アラートメール内リンクの公開ベース URL（任意） |
| `RESEND_API_KEY` | secret | メールアラート（任意） |
| `ALERT_EMAIL_FROM` / `ALERT_EMAIL_TO` | var | アラートの送信元 / フォールバック宛先（ユーザー未設定時） |
| `ALERTS_REQUIRE_PAYMENT` | var | 将来の有料化用に残した未使用フック。既定オフ（全機能無料） |
| `CF_OAUTH_EXTRA_SCOPES` | var | 既定スコープに追加する OAuth スコープ。例: 実 email 取得用の `user-details.read` |
| `CF_ANALYTICS_TOKEN` / `CF_ACCOUNT_ID` / `CF_ACCOUNT_NAME` | secret/var | 定期ジョブ用フォールバックアカウント |

`CACHE` KV namespace は `wrangler.toml` でバインド（env var ではない）。省略するとキャッシュ無効。

## セルフホストと応援について

本プロジェクトは **オープンソースで、セルフホストは完全無料**です。自分の
Cloudflare アカウントにデプロイすれば、自動アラートを含む全機能が動きます
（`ALERTS_REQUIRE_PAYMENT` は既定でオフ）。

自分で運用したくない人向けにホスト版も用意しています。維持には少しコスト
（cron・メール）がかかるので、役に立ったら
[**Ko-fi でプロジェクトを応援**](https://ko-fi.com/0xkaz)してください。
ペイウォールではなく寄付です。ホスト版のどの機能も課金の裏に隠していません。

> コードにはアカウント単位の entitlement モデル（`account_entitlements`・
> `ALERTS_REQUIRE_PAYMENT`）を残してあり、将来運用者が自動アラートを有料化
> *できる* 余地はありますが、リファレンス配備では意図的に行いません。

## 注意

- コストは Cloudflare の公開料金に基づく**推定値**で、実際の請求と異なる場合があります。
- Cloudflare Analytics の保持は約90日。それ以前はアカウント単位のスナップショットから表示します。
- 本プロジェクトは Cloudflare, Inc. とは無関係です。

## ライセンス

MIT
