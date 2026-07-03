import { supabase } from "./supabaseClient";

/* ============================================================
   データアクセス層：正規化されたテーブル（マスタ／トランザクション）と
   アプリ側のcamelCaseオブジェクトとのマッピングをここに集約する。
   ============================================================ */

/* ---------- 社員マスタ ---------- */
function mapEmployee(row) {
  return { id: row.id, name: row.name, role: row.role, isAdmin: row.is_admin };
}
export async function listEmployees() {
  const { data, error } = await supabase.from("employees").select("*").order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapEmployee);
}
export async function insertEmployee({ name, role, isAdmin }) {
  const { data, error } = await supabase.from("employees").insert({ name, role, is_admin: !!isAdmin }).select().single();
  if (error) throw error;
  return mapEmployee(data);
}
export async function insertEmployeesBulk(rows) {
  if (!rows.length) return [];
  const payload = rows.map((r) => ({ name: r.name, role: r.role, is_admin: !!r.isAdmin }));
  const { data, error } = await supabase.from("employees").insert(payload).select();
  if (error) throw error;
  return (data || []).map(mapEmployee);
}
export async function updateEmployee(id, patch) {
  const payload = {};
  if (patch.name !== undefined) payload.name = patch.name;
  if (patch.role !== undefined) payload.role = patch.role;
  if (patch.isAdmin !== undefined) payload.is_admin = patch.isAdmin;
  const { error } = await supabase.from("employees").update(payload).eq("id", id);
  if (error) throw error;
}
export async function deleteEmployee(id) {
  const { error } = await supabase.from("employees").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- 出張先マスタ ---------- */
function mapDestination(row) {
  return {
    code: row.code, category: row.category, place: row.place, purpose: row.purpose,
    transportMain: row.transport_main, classMain: row.class_main, transportSub: row.transport_sub,
  };
}
function destinationPayload(d) {
  return {
    code: d.code, category: d.category, place: d.place, purpose: d.purpose,
    transport_main: d.transportMain, class_main: d.classMain, transport_sub: d.transportSub,
  };
}
export async function listDestinations() {
  const { data, error } = await supabase.from("destinations").select("*").order("code", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapDestination);
}
export async function insertDestination(d) {
  const { data, error } = await supabase.from("destinations").insert(destinationPayload(d)).select().single();
  if (error) throw error;
  return mapDestination(data);
}
export async function insertDestinationsBulk(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from("destinations").insert(rows.map(destinationPayload)).select();
  if (error) throw error;
  return (data || []).map(mapDestination);
}

/* ---------- 交通費マスタ（出張先別・改定履歴） ---------- */
function mapTransportFare(row) {
  return { id: row.id, code: row.destination_code, effectiveDate: row.effective_date, mainFare: row.main_fare, subFare: row.sub_fare, note: row.note };
}
function transportFarePayload(h) {
  return { destination_code: h.code, effective_date: h.effectiveDate, main_fare: h.mainFare, sub_fare: h.subFare ?? null, note: h.note ?? null };
}
export async function listTransportFares() {
  const { data, error } = await supabase.from("transport_fares").select("*").order("destination_code").order("effective_date");
  if (error) throw error;
  return (data || []).map(mapTransportFare);
}
export async function insertTransportFare(h) {
  const { data, error } = await supabase.from("transport_fares").insert(transportFarePayload(h)).select().single();
  if (error) throw error;
  return mapTransportFare(data);
}
export async function insertTransportFaresBulk(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from("transport_fares").insert(rows.map(transportFarePayload)).select();
  if (error) throw error;
  return (data || []).map(mapTransportFare);
}
export async function updateTransportFare(id, h) {
  const { error } = await supabase.from("transport_fares").update(transportFarePayload(h)).eq("id", id);
  if (error) throw error;
}
export async function deleteTransportFare(id) {
  const { error } = await supabase.from("transport_fares").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- 宿泊費・日当マスタ（区分別・改定履歴） ---------- */
function mapTravelRule(row) {
  return { id: row.id, category: row.category, effectiveDate: row.effective_date, lodging: row.lodging, perDiem: row.per_diem, note: row.note };
}
function travelRulePayload(h) {
  return { category: h.category, effective_date: h.effectiveDate, lodging: h.lodging, per_diem: h.perDiem, note: h.note ?? null };
}
export async function listTravelRules() {
  const { data, error } = await supabase.from("travel_rules").select("*").order("category").order("effective_date");
  if (error) throw error;
  return (data || []).map(mapTravelRule);
}
export async function insertTravelRule(h) {
  const { data, error } = await supabase.from("travel_rules").insert(travelRulePayload(h)).select().single();
  if (error) throw error;
  return mapTravelRule(data);
}
export async function insertTravelRulesBulk(rows) {
  if (!rows.length) return [];
  const { data, error } = await supabase.from("travel_rules").insert(rows.map(travelRulePayload)).select();
  if (error) throw error;
  return (data || []).map(mapTravelRule);
}
export async function updateTravelRule(id, h) {
  const { error } = await supabase.from("travel_rules").update(travelRulePayload(h)).eq("id", id);
  if (error) throw error;
}
export async function deleteTravelRule(id) {
  const { error } = await supabase.from("travel_rules").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- 出張旅費申請（ヘッダ＋区間明細） ---------- */
function mapReport(header, legs) {
  return {
    id: header.id,
    employeeId: header.employee_id,
    applicant: header.applicant,
    role: header.role,
    applyDate: header.apply_date,
    advance: header.advance,
    legs: legs.map((l) => ({
      code: l.destination_code, place: l.place, category: l.category, purpose: l.purpose,
      start: l.start_date, end: l.end_date, nights: l.nights,
      transport: l.transport, lodging: l.lodging, perDiem: l.per_diem, subtotal: l.subtotal,
    })),
    totals: { transport: header.total_transport, lodging: header.total_lodging, perDiem: header.total_per_diem, grand: header.total_grand },
    balance: header.balance,
    createdAt: header.created_at,
    status: header.status,
    reviewedBy: header.reviewed_by,
    reviewedAt: header.reviewed_at,
    reviewComment: header.review_comment,
  };
}

export async function listReports() {
  const { data: headers, error } = await supabase.from("expense_reports").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  if (!headers.length) return [];
  const { data: legs, error: legError } = await supabase
    .from("expense_report_legs")
    .select("*")
    .in("report_id", headers.map((h) => h.id))
    .order("seq", { ascending: true });
  if (legError) throw legError;
  const legsByReport = {};
  (legs || []).forEach((l) => { (legsByReport[l.report_id] ||= []).push(l); });
  return headers.map((h) => mapReport(h, legsByReport[h.id] || []));
}

export async function insertReport(report) {
  const { data: header, error } = await supabase
    .from("expense_reports")
    .insert({
      employee_id: report.employeeId || null,
      applicant: report.applicant,
      role: report.role,
      apply_date: report.applyDate,
      advance: report.advance,
      total_transport: report.totals.transport,
      total_lodging: report.totals.lodging,
      total_per_diem: report.totals.perDiem,
      total_grand: report.totals.grand,
      balance: report.balance,
      status: report.status,
      reviewed_by: report.reviewedBy,
      reviewed_at: report.reviewedAt,
      review_comment: report.reviewComment,
    })
    .select()
    .single();
  if (error) throw error;

  const legPayload = (report.legs || []).map((l, idx) => ({
    report_id: header.id,
    seq: idx,
    destination_code: l.code || null,
    place: l.place,
    category: l.category,
    purpose: l.purpose,
    start_date: l.start,
    end_date: l.end,
    nights: l.nights,
    transport: l.transport,
    lodging: l.lodging,
    per_diem: l.perDiem,
    subtotal: l.subtotal,
  }));
  const { data: legs, error: legError } = legPayload.length
    ? await supabase.from("expense_report_legs").insert(legPayload).select()
    : { data: [], error: null };
  if (legError) throw legError;

  return mapReport(header, legs || []);
}

export async function updateReportStatus(id, patch) {
  const payload = {};
  if (patch.status !== undefined) payload.status = patch.status;
  if (patch.reviewedBy !== undefined) payload.reviewed_by = patch.reviewedBy;
  if (patch.reviewedAt !== undefined) payload.reviewed_at = patch.reviewedAt;
  if (patch.reviewComment !== undefined) payload.review_comment = patch.reviewComment;
  const { error } = await supabase.from("expense_reports").update(payload).eq("id", id);
  if (error) throw error;
}

export async function deleteReport(id) {
  const { error } = await supabase.from("expense_reports").delete().eq("id", id);
  if (error) throw error;
}

/* ---------- 精算書テンプレート（単一設定） ---------- */
function mapTemplate(row) {
  if (!row) return null;
  return { name: row.file_name, base64: row.file_base64, kind: row.kind, uploadedAt: row.uploaded_at };
}
export async function getTemplate() {
  const { data, error } = await supabase.from("report_template").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return mapTemplate(data);
}
export async function upsertTemplate(t) {
  const { error } = await supabase.from("report_template").upsert({
    id: 1, file_name: t.name, file_base64: t.base64, kind: t.kind, uploaded_at: t.uploadedAt,
  });
  if (error) throw error;
}
export async function deleteTemplate() {
  const { error } = await supabase.from("report_template").delete().eq("id", 1);
  if (error) throw error;
}

/* ---------- 通知設定（単一設定） ---------- */
function mapNotificationSettings(row) {
  return { teamsMentionEmail: row ? row.teams_mention_email : "" };
}
export async function getNotificationSettings() {
  const { data, error } = await supabase.from("notification_settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return mapNotificationSettings(data);
}
export async function upsertNotificationSettings({ teamsMentionEmail }) {
  const { error } = await supabase.from("notification_settings").upsert({
    id: 1, teams_mention_email: teamsMentionEmail, updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}
