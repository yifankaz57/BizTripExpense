-- ============================================================
-- 出張旅費精算アプリ用 Supabase スキーマ（正規化版）
-- Supabaseダッシュボード → SQL Editor に貼り付けて実行してください。
--
-- 旧バージョンの kv_store（全データをJSON1列で保持）を廃止し、
-- マスタ／トランザクションを実カラムを持つテーブルに分離しています。
-- 既に kv_store 運用していた場合は、本SQL実行後に kv_store テーブルは
-- 不要になります（データ移行が必要な場合は別途スクリプトで対応してください）。
-- ============================================================

-- ---------- 社員マスタ ----------
create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null default '一般' check (role in ('役員', '管理職', '一般')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- 出張先マスタ ----------
create table if not exists destinations (
  code integer primary key,
  category text not null check (category in ('国内', '海外')),
  place text not null,
  purpose text,
  transport_main text,
  class_main text,
  transport_sub text,
  created_at timestamptz not null default now()
);

-- ---------- 交通費マスタ（出張先ごとの改定履歴） ----------
create table if not exists transport_fares (
  id uuid primary key default gen_random_uuid(),
  destination_code integer not null references destinations(code) on delete cascade,
  effective_date date not null,
  main_fare integer not null,
  sub_fare integer,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_transport_fares_code_date on transport_fares(destination_code, effective_date);

-- ---------- 宿泊費・日当マスタ（区分ごとの改定履歴） ----------
create table if not exists travel_rules (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('国内', '海外')),
  effective_date date not null,
  lodging integer not null,
  per_diem integer not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_travel_rules_category_date on travel_rules(category, effective_date);

-- ---------- 出張旅費申請（トランザクション・ヘッダ） ----------
create table if not exists expense_reports (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid references employees(id) on delete set null,
  applicant text not null,   -- 申請時点の氏名（社員マスタ変更後も申請時の記録を保持するためのスナップショット）
  role text not null,        -- 申請時点の職責
  apply_date date not null,
  advance integer not null default 0,
  total_transport integer not null default 0,
  total_lodging integer not null default 0,
  total_per_diem integer not null default 0,
  total_grand integer not null default 0,
  balance integer not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now()
);
create index if not exists idx_expense_reports_status on expense_reports(status);
create index if not exists idx_expense_reports_employee on expense_reports(employee_id);

-- ---------- 出張旅費申請 区間明細（トランザクション・明細） ----------
create table if not exists expense_report_legs (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references expense_reports(id) on delete cascade,
  seq integer not null default 0,
  destination_code integer references destinations(code) on delete set null,
  place text,
  category text,
  purpose text,
  start_date date,
  end_date date,
  nights integer not null default 0,
  transport integer not null default 0,
  lodging integer not null default 0,
  per_diem integer not null default 0,
  subtotal integer not null default 0
);
create index if not exists idx_expense_report_legs_report on expense_report_legs(report_id);

-- ---------- 精算書テンプレート（単一設定） ----------
create table if not exists report_template (
  id smallint primary key default 1 check (id = 1),
  file_name text,
  file_base64 text,
  kind text,
  uploaded_at timestamptz
);

-- ============================================================
-- Row Level Security
-- 認証機能を追加するまでの暫定運用として、anon key での読み書きを
-- 全テーブルで許可しています（社内の誰でもアクセスできる想定）。
-- 社外に公開されるURLになる場合や、アクセスを制限したい場合は、
-- Supabase Auth の導入と、ユーザーごとのポリシーへの変更を推奨します。
-- ============================================================
alter table employees enable row level security;
alter table destinations enable row level security;
alter table transport_fares enable row level security;
alter table travel_rules enable row level security;
alter table expense_reports enable row level security;
alter table expense_report_legs enable row level security;
alter table report_template enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['employees', 'destinations', 'transport_fares', 'travel_rules', 'expense_reports', 'expense_report_legs', 'report_template']
  loop
    execute format('drop policy if exists "%s_select" on %I', t, t);
    execute format('create policy "%s_select" on %I for select using (true)', t, t);
    execute format('drop policy if exists "%s_insert" on %I', t, t);
    execute format('create policy "%s_insert" on %I for insert with check (true)', t, t);
    execute format('drop policy if exists "%s_update" on %I', t, t);
    execute format('create policy "%s_update" on %I for update using (true) with check (true)', t, t);
    execute format('drop policy if exists "%s_delete" on %I', t, t);
    execute format('create policy "%s_delete" on %I for delete using (true)', t, t);
  end loop;
end $$;
