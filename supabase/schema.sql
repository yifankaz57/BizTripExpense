-- ============================================================
-- 出張旅費精算アプリ用 Supabase スキーマ
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
-- ============================================================

-- アプリの全データ（マスタ・申請・テンプレート等）を key-value 形式で保持する単一テーブル。
-- アプリ側の window.storage 互換レイヤー（src/lib/supabaseClient.js + App.jsx の
-- loadShared/saveShared）がこのテーブルを読み書きします。
create table if not exists kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security を有効化
alter table kv_store enable row level security;

-- 認証なし（anon key）でも読み書きできるようにするポリシー。
-- ※ このアプリには認証機能がなく、社内の全利用者が同じデータを共有する前提です。
--    社外に公開されるURLにする場合は、Supabase Auth を組み込んだ上でポリシーを
--    ユーザーごとに制限することを強く推奨します。
drop policy if exists "kv_store_select" on kv_store;
create policy "kv_store_select" on kv_store for select using (true);

drop policy if exists "kv_store_insert" on kv_store;
create policy "kv_store_insert" on kv_store for insert with check (true);

drop policy if exists "kv_store_update" on kv_store;
create policy "kv_store_update" on kv_store for update using (true) with check (true);

drop policy if exists "kv_store_delete" on kv_store;
create policy "kv_store_delete" on kv_store for delete using (true);

-- updated_at を自動更新するトリガー（任意・upsert時にアプリ側でも設定していますが念のため）
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_kv_store_updated_at on kv_store;
create trigger trg_kv_store_updated_at
  before update on kv_store
  for each row
  execute function set_updated_at();
