-- ============================================================
-- kv_store（旧・単一テーブルJSON形式）から正規化スキーマへのデータ移行
--
-- 実行順序（必ずこの順番で）：
--   1. schema.sql を実行（新テーブルを作成。kv_store には触れません）
--   2. このファイルを実行（kv_store の中身を新テーブルへコピー）
--   3. Supabaseダッシュボードの Table Editor で employees / destinations /
--      transport_fares / travel_rules / expense_reports / expense_report_legs
--      の中身を確認する
--   4. 問題なければ、アプリ（新バージョン）を開いて動作確認する
--   5. 十分に確認できたら、任意で古い kv_store テーブルを削除する
--      （drop table kv_store; ※本スクリプトはkv_storeを削除しません）
--
-- 注意：このスクリプトは1回のみ実行してください。2回実行すると
-- transport_fares / travel_rules / expense_reports 等が重複登録されます
-- （destinations のみ code の重複はスキップされます）。
-- ============================================================

do $$
declare
  v_employee_map jsonb := '{}'::jsonb; -- 旧 employees.id(text) -> 新 employees.id(uuid) の対応表
  v_row jsonb;
  v_new_id uuid;
  v_report jsonb;
  v_leg jsonb;
  v_new_report_id uuid;
  v_seq integer;
begin
  -- ---------- 出張先マスタ ----------
  for v_row in select jsonb_array_elements(value) from kv_store where key = 'dest_master'
  loop
    insert into destinations (code, category, place, purpose, transport_main, class_main, transport_sub)
    values (
      (v_row->>'code')::integer,
      v_row->>'category',
      v_row->>'place',
      v_row->>'purpose',
      v_row->>'transportMain',
      v_row->>'classMain',
      v_row->>'transportSub'
    )
    on conflict (code) do nothing;
  end loop;

  -- ---------- 交通費マスタ（改定履歴） ----------
  for v_row in select jsonb_array_elements(value) from kv_store where key = 'transport_history'
  loop
    insert into transport_fares (destination_code, effective_date, main_fare, sub_fare, note)
    values (
      (v_row->>'code')::integer,
      (v_row->>'effectiveDate')::date,
      (v_row->>'mainFare')::integer,
      nullif(v_row->>'subFare', '')::integer,
      v_row->>'note'
    );
  end loop;

  -- ---------- 宿泊費・日当マスタ（改定履歴） ----------
  for v_row in select jsonb_array_elements(value) from kv_store where key = 'rule_history'
  loop
    insert into travel_rules (category, effective_date, lodging, per_diem, note)
    values (
      v_row->>'category',
      (v_row->>'effectiveDate')::date,
      (v_row->>'lodging')::integer,
      (v_row->>'perDiem')::integer,
      v_row->>'note'
    );
  end loop;

  -- ---------- 社員マスタ（旧id -> 新idの対応をv_employee_mapに記録） ----------
  for v_row in select jsonb_array_elements(value) from kv_store where key = 'employee_master'
  loop
    insert into employees (name, role, is_admin)
    values (
      v_row->>'name',
      coalesce(v_row->>'role', '一般'),
      coalesce((v_row->>'isAdmin')::boolean, false)
    )
    returning id into v_new_id;
    v_employee_map := v_employee_map || jsonb_build_object(v_row->>'id', v_new_id::text);
  end loop;

  -- ---------- 出張旅費申請（ヘッダ＋区間明細） ----------
  for v_report in select jsonb_array_elements(value) from kv_store where key = 'expense_reports'
  loop
    insert into expense_reports (
      employee_id, applicant, role, apply_date, advance,
      total_transport, total_lodging, total_per_diem, total_grand, balance,
      status, reviewed_by, reviewed_at, review_comment, created_at
    )
    values (
      nullif(v_employee_map->>(v_report->>'employeeId'), '')::uuid,
      v_report->>'applicant',
      v_report->>'role',
      (v_report->>'applyDate')::date,
      coalesce((v_report->>'advance')::integer, 0),
      coalesce((v_report->'totals'->>'transport')::integer, 0),
      coalesce((v_report->'totals'->>'lodging')::integer, 0),
      coalesce((v_report->'totals'->>'perDiem')::integer, 0),
      coalesce((v_report->'totals'->>'grand')::integer, 0),
      coalesce((v_report->>'balance')::integer, 0),
      coalesce(v_report->>'status', 'pending'),
      v_report->>'reviewedBy',
      nullif(v_report->>'reviewedAt', '')::timestamptz,
      v_report->>'reviewComment',
      coalesce(nullif(v_report->>'createdAt', '')::timestamptz, now())
    )
    returning id into v_new_report_id;

    v_seq := 0;
    for v_leg in select jsonb_array_elements(coalesce(v_report->'legs', '[]'::jsonb))
    loop
      insert into expense_report_legs (
        report_id, seq, destination_code, place, category, purpose,
        start_date, end_date, nights, transport, lodging, per_diem, subtotal
      )
      values (
        v_new_report_id, v_seq,
        nullif(v_leg->>'code', '')::integer,
        v_leg->>'place', v_leg->>'category', v_leg->>'purpose',
        nullif(v_leg->>'start', '')::date, nullif(v_leg->>'end', '')::date,
        coalesce((v_leg->>'nights')::integer, 0),
        coalesce((v_leg->>'transport')::integer, 0),
        coalesce((v_leg->>'lodging')::integer, 0),
        coalesce((v_leg->>'perDiem')::integer, 0),
        coalesce((v_leg->>'subtotal')::integer, 0)
      );
      v_seq := v_seq + 1;
    end loop;
  end loop;

  -- ---------- 精算書テンプレート ----------
  insert into report_template (id, file_name, file_base64, kind, uploaded_at)
  select 1, value->>'name', value->>'base64', value->>'kind', nullif(value->>'uploadedAt', '')::timestamptz
  from kv_store
  where key = 'report_template' and value is not null and value <> 'null'::jsonb
  on conflict (id) do update set
    file_name = excluded.file_name,
    file_base64 = excluded.file_base64,
    kind = excluded.kind,
    uploaded_at = excluded.uploaded_at;
end $$;

-- 移行件数の確認用（結果を見て、旧kv_storeの登録件数と一致するか確認してください）
select
  (select count(*) from destinations) as destinations_count,
  (select count(*) from transport_fares) as transport_fares_count,
  (select count(*) from travel_rules) as travel_rules_count,
  (select count(*) from employees) as employees_count,
  (select count(*) from expense_reports) as expense_reports_count,
  (select count(*) from expense_report_legs) as expense_report_legs_count;
