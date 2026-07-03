# 出張旅費精算アプリ（Supabase + GitHub Pages版）

このアプリは元々 Claude のアーティファクト内蔵ストレージ（`window.storage`）でデータを
保持していましたが、独立したReactアプリとして動くよう構成し、データの保存先を
**Supabase**（PostgreSQL）に置き換えたものです。GitHub Pages に静的サイトとしてデプロイできます。

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
   （`kv_store` テーブルが作成されます）
3. 左メニュー「Project Settings」→「API」を開き、以下をメモする
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

- `src/App.jsx` … アプリ本体（元のアーティファクトから、データ保存部分だけ
  Supabase対応に書き換えたもの。UI・機能はすべて同一です）
- `src/lib/supabaseClient.js` … Supabaseクライアントの初期化
- `supabase/schema.sql` … `kv_store` テーブルの作成SQL（key-value形式でマスタ・申請・
  テンプレートなど全データを保持）
- `.github/workflows/deploy.yml` … push時に自動ビルド・自動デプロイするワークフロー
  （リポジトリ名から `base` パスを自動算出するため、リポジトリ名を変えても
  `vite.config.js` を手動で書き換える必要はありません）

## 6. データ移行について

これまでClaudeアーティファクト上（`window.storage`）に貯まっていたデータ
（社員マスタ・出張先マスタ・申請履歴など）は、保存場所が異なるため自動的には
引き継がれません。必要であれば、既存データをエクスポートしてSupabaseに
インポートする移行スクリプトも作成できますので、お知らせください。
