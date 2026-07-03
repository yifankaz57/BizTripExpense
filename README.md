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

### 4-2. Pagesの有効化
`Settings` → `Pages` → `Build and deployment` の `Source` を **「GitHub Actions」** に設定します。

### 4-3. デプロイ
`main` ブランチにpushすると `.github/workflows/deploy.yml` が自動実行され、
数分後に `https://<ユーザー名>.github.io/<リポジトリ名>/` で公開されます。
（既にpush済みの場合は、`Actions` タブから "Deploy to GitHub Pages" を
`Run workflow` で手動実行しても構いません）

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
