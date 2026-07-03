# 出張旅費精算アプリ（Supabase + GitHub Pages版）

このアプリは元々 Claude のアーティファクト内蔵ストレージ（`window.storage`）でデータを
保持していましたが、独立したReactアプリとして動くよう構成し、データの保存先を
**Supabase**（PostgreSQL）に置き換えたものです。GitHub Pages に静的サイトとしてデプロイできます。

データベースは `kv_store`（全データを1テーブルにJSON形式でまとめて保持）ではなく、
マスタ（社員・出張先・交通費・宿泊費日当）とトランザクション（出張旅費申請とその区間明細）を
それぞれ実カラムを持つテーブルに分離した構成です。詳細は `supabase/schema.sql` を参照してください。

---

## 0. できること・できないこと

このプロジェクト一式はそのまま動く状態で用意していますが、以下は**あなたの環境・アカウントで
実行する必要があります**（Claude側からは実行できません）。

- GitHubリポジトリの作成・push
- Supabaseプロジェクトの作成、APIキーの取得
- GitHub Pagesの有効化、Secretsの登録

以下、その手順を順番に説明します。

---

## 1. Supabase側の準備

あなたのSupabaseプロジェクト: `https://sgwaszxmsrisixtnqzhh.supabase.co`

1. [Supabaseダッシュボード](https://supabase.com/dashboard) で該当プロジェクトを開く
2. 左メニュー「SQL Editor」→「New query」を開き、`supabase/schema.sql` の中身を貼り付けて実行
   （`employees` / `destinations` / `transport_fares` / `travel_rules` / `expense_reports` /
   `expense_report_legs` / `report_template` の各テーブルが作成されます。既存の `kv_store` には
   影響しません）
3. **旧バージョン（kv_store形式）を既に使っていて、社員・出張先・申請などのデータが入っている場合**：
   続けて `supabase/migrate_from_kv_store.sql` の中身を貼り付けて実行してください。
   `kv_store` の内容を新しいテーブルへコピーします（`kv_store` 自体は削除されません）。
   このスクリプトは**1回だけ**実行してください（2回実行すると履歴系データが重複登録されます）。
   移行後、Table Editorで各テーブルの件数が想定通りか確認してから、アプリ（新バージョン）を
   開くようにしてください。先にアプリを開いてしまうと、テーブルが空の状態でアプリ内蔵の
   初期データが自動登録されてしまいます。
4. 左メニュー「Project Settings」→「API」を開き、以下をメモする
   - **Project URL**（例のURLと同じはずです）
   - **anon public** キー（`service_role` ではなく `anon` の方を使ってください）

> **注意**: `anon` キーはブラウザに公開される前提のキーです。今回のSQLではRLS
> （行レベルセキュリティ）を有効にしつつ「誰でも読み書き可」のポリシーにしています。
> これは社内の誰でもアクセスできる想定に合わせたものです。もし社外に公開されるURLに
> なる場合や、アクセスを制限したい場合は、Supabase Authの導入をおすすめします（必要であれば
> 追加で実装します）。

---

## 2. ローカルで動作確認（任意だが推奨）

```bash
cd tabi-expense-app
npm install
cp .env.example .env
```

`.env` を開き、`VITE_SUPABASE_ANON_KEY` に手順1でメモした anon key を貼り付けます。

```bash
npm run dev
```

表示されるURL（例: http://localhost:5173）を開いて、マスタ登録や申請が
Supabase側に保存されることを確認してください（Supabaseダッシュボードの
「Table Editor」→「kv_store」でデータが増えるのが見えます）。

---

## 3. GitHubリポジトリの作成とpush

```bash
cd tabi-expense-app
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<あなたのユーザー名>/<リポジトリ名>.git
git push -u origin main
```

（`.env` は `.gitignore` に含まれているため、誤ってキーをpushすることはありません）

---

## 4. GitHub側の設定（Secrets & Pages）

### 4-1. Secretsの登録
リポジトリの `Settings` → `Secrets and variables` → `Actions` → `New repository secret` で
以下の2つを登録します。

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://sgwaszxmsrisixtnqzhh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | 手順1でメモした anon key |

### 4-2. デプロイ（1回目：gh-pagesブランチの作成）
`main` ブランチにpushすると `.github/workflows/deploy.yml` が自動実行され、
ビルド成果物が `gh-pages` ブランチに自動作成・pushされます
（`peaceiris/actions-gh-pages` を使用。以前の `actions/deploy-pages`
方式は、Pages Deployments APIのステータス確認が不安定に失敗することが
あったため、より安定した「ブランチへのデプロイ」方式に変更しています）。
（既にpush済みの場合は、`Actions` タブから "Deploy to GitHub Pages" を
`Run workflow` で手動実行しても構いません）

### 4-3. Pagesの有効化（2回目：gh-pagesブランチができてから）
`gh-pages` ブランチが作成されたのを確認したら、`Settings` → `Pages` →
`Build and deployment` の `Source` を **「Deploy from a branch」**、
ブランチを **「gh-pages」／「/ (root)」** に設定して保存します。
数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。

---

## 5. 構成ファイルの補足

- `src/App.jsx` … アプリ本体（UI・計算ロジック）
- `src/lib/supabaseClient.js` … Supabaseクライアントの初期化
- `src/lib/db.js` … Supabaseの各テーブルとアプリ内オブジェクトとの読み書きをまとめたデータ層
- `supabase/schema.sql` … マスタ（社員・出張先・交通費・宿泊費日当）とトランザクション
  （出張旅費申請・区間明細）を実カラムで保持する正規化テーブル一式の作成SQL
- `supabase/migrate_from_kv_store.sql` … 旧バージョン（`kv_store` に全データをJSON形式で
  保持する構成）からのデータ移行スクリプト。初めてこのアプリを使う場合は不要です
- `.github/workflows/deploy.yml` … push時に自動ビルド・自動デプロイするワークフロー
  （リポジトリ名から `base` パスを自動算出するため、リポジトリ名を変えても
  `vite.config.js` を手動で書き換える必要はありません）

## 6. データ移行について

旧バージョン（`kv_store` 形式）から移行する場合は、上記「1. Supabase側の準備」の手順3を
参照してください。それ以前（Claudeアーティファクト上の `window.storage`）のデータについては、
保存場所の互換性がないため自動移行の対象外です。

## 7. Teams通知（任意・Microsoft 365側の設定が必要）

申請が送信された際にTeamsへ自動投稿し、指定した相手にメンションする仕組みは、
**Supabase Database Webhook → Power Automate → Teams** という構成で実現できます。
アプリ側のコードは変更不要です。管理者ページの「通知設定」でメンション先メールアドレスを
登録しておく必要があります（`notification_settings` テーブルに保存されます）。

以下はMicrosoft 365側（Power Automate・Teams管理権限が必要）での設定手順です。

### 7-1. Power Automateフローの作成
1. [Power Automate](https://make.powerautomate.com/) で新規フローを作成し、
   トリガーに **「HTTP要求の受信時」(When a HTTP request is received)** を選択
2. 続けて以下のアクションを追加
   - **HTTP**（GET）: `notification_settings` からメンション先メールアドレスを取得
     - URI: `https://sgwaszxmsrisixtnqzhh.supabase.co/rest/v1/notification_settings?select=teams_mention_email&id=eq.1`
     - ヘッダー: `apikey: <SupabaseのanonKey>` / `Authorization: Bearer <SupabaseのanonKey>`
   - **Office 365ユーザー：ユーザープロファイルの取得(V2)**: 上記で取得したメールアドレスを
     ユーザー(UPN)に指定し、Teamsメンションに必要なAAD ID（Id列）を取得
   - **Teams：チャットまたはチャネルでのアダプティブカードの投稿**（または「メッセージの投稿」）:
     投稿先チーム／チャネルを指定し、本文に取得したAAD IDで `<at>ユーザー名</at>` 形式のメンションと、
     トリガー本文（`triggerBody()`）から申請者名・金額などを差し込む
3. 保存後、トリガーの「HTTP要求の受信時」に生成されたURLをコピーする

### 7-2. Supabase Database Webhookの設定
1. Supabaseダッシュボード → 左メニュー「Database」→「Webhooks」→「Create a new hook」
2. 以下を設定
   - Table: `expense_reports`
   - Events: `Insert` のみチェック
   - Type: `HTTP Request`
   - URL: 手順7-1でコピーしたPower AutomateのフローURL
   - Method: `POST`
3. 保存すると、以後 `expense_reports` にINSERTされるたびに自動でフローが呼ばれます

### 補足
- Power Automateの「HTTP要求の受信時」トリガーのスキーマは、Supabase Webhookのペイロード
  （`{"type":"INSERT","table":"expense_reports","record":{...申請ヘッダの全カラム...},"old_record":null}`）
  に合わせて生成しておくと、以降のアクションで `record.applicant` のようにフィールドを参照できます
- 区間明細（出張先・日程など）は `expense_report_legs` テーブルに別途保存されているため、
  通知本文に含めたい場合はWebhookのペイロードに含まれる `record.id`（申請ID）を使って
  Supabase REST APIから追加取得してください
