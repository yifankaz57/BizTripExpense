import React, { useState, useEffect, useMemo, useCallback } from "react";
import * as XLSX from "xlsx";
import * as db from "./lib/db";
import { Plus, Trash2, Download, Printer, Send, RefreshCw, Plane, ListChecks, History, MapPin, ClipboardList, AlertCircle, ShieldCheck, CheckCircle2, XCircle, Clock3, ChevronDown, ChevronUp, Users, Upload, Copy, FileSpreadsheet } from "lucide-react";

/* ============================================================
   出張旅費精算アプリ
   前提マスタ：出張先マスタ / 交通費履歴 / 旅費規程履歴 / 現行一覧（自動算出）
   ============================================================ */

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const todayISO = () => new Date().toISOString().slice(0, 10);
const yen = (n) => (Number(n) || 0).toLocaleString("ja-JP");
const wareki = (dISO) => {
  if (!dISO) return "";
  const [y, m, d] = dISO.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
};
const daysInclusive = (start, end) => {
  if (!start || !end) return 0;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const diff = Math.round((e - s) / 86400000) + 1;
  return diff > 0 ? diff : 0;
};

/* ---------- 初期マスタデータ（アップロードされた規程ファイルの内容を移植） ---------- */
const SEED_DESTINATIONS = [
  { code: 1, category: "国内", place: "八戸", purpose: "営業", transportMain: "新幹線", classMain: "グリーン", transportSub: "" },
  { code: 2, category: "国内", place: "長崎", purpose: "学校訪問", transportMain: "飛行機", classMain: "J", transportSub: "" },
  { code: 3, category: "国内", place: "北海道", purpose: "営業", transportMain: "飛行機", classMain: "J", transportSub: "" },
  { code: 4, category: "国内", place: "名古屋", purpose: "営業", transportMain: "新幹線", classMain: "グリーン", transportSub: "" },
  { code: 5, category: "国内", place: "福岡", purpose: "営業", transportMain: "飛行機", classMain: "J", transportSub: "" },
  { code: 6, category: "国内", place: "神戸", purpose: "お参り", transportMain: "新幹線", classMain: "グリーン", transportSub: "" },
  { code: 7, category: "国内", place: "神戸", purpose: "お参り", transportMain: "飛行機", classMain: "J", transportSub: "" },
  { code: 8, category: "国内", place: "大阪", purpose: "営業", transportMain: "飛行機", classMain: "F", transportSub: "" },
  { code: 9, category: "国内", place: "宮崎", purpose: "研修", transportMain: "飛行機", classMain: "J", transportSub: "" },
  { code: 10, category: "国内", place: "沖縄", purpose: "営業", transportMain: "飛行機", classMain: "J", transportSub: "" },
  { code: 101, category: "海外", place: "サイパン", purpose: "NTTDグループ研修", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 102, category: "海外", place: "クアラルンプール", purpose: "NTTDグループ研修", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 103, category: "海外", place: "USAサンフランシスコ", purpose: "NTTDグループ研修", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 104, category: "海外", place: "マニラ", purpose: "視察", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 105, category: "海外", place: "バンコク", purpose: "タイアルカディア", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 106, category: "海外", place: "マニラ→クアラルンプール", purpose: "視察", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 107, category: "海外", place: "マニラ→バンコク", purpose: "視察", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 108, category: "海外", place: "韓国", purpose: "視察", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
  { code: 109, category: "海外", place: "ニューヨーク", purpose: "視察", transportMain: "飛行機", classMain: "ビジネス", transportSub: "" },
];

const SEED_TRANSPORT_HISTORY = [
  [1, 49280], [2, 71600], [3, 61600], [4, 37520], [5, 67600], [6, 38620], [7, 55340],
  [8, 66980], [9, 84780], [10, 94420], [101, 176100], [102, 378000], [103, 799500],
  [104, 298300], [105, 455500], [106, 200000], [107, 200000], [108, 166980], [109, 965670],
].map(([code, mainFare]) => ({
  id: uid(), code, effectiveDate: "2020-04-01", mainFare, subFare: null, note: "初期データ",
}));

const SEED_RULE_HISTORY = [
  { id: uid(), category: "国内", effectiveDate: "2020-04-01", lodging: 20000, perDiem: 10000, note: "初期データ" },
  { id: uid(), category: "海外", effectiveDate: "2020-04-01", lodging: 40000, perDiem: 20000, note: "初期データ" },
];

const SEED_EMPLOYEES = [
  { id: uid(), name: "保田 一帆", role: "役員", isAdmin: true },
];

/* ---------- 履歴から「基準日時点で有効な最新値」を取り出す（元ブックの MAXIFS/SUMIFS と同じロジック） ---------- */
function currentTransport(history, code, asOf) {
  const rows = history.filter((h) => h.code === code && h.effectiveDate <= asOf);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (b.effectiveDate > a.effectiveDate ? b : a));
}
function currentRule(history, category, asOf) {
  const rows = history.filter((h) => h.category === category && h.effectiveDate <= asOf);
  if (!rows.length) return null;
  return rows.reduce((a, b) => (b.effectiveDate > a.effectiveDate ? b : a));
}

const TABS = [
  { id: "form", label: "精算書作成", icon: Plane },
  { id: "rates", label: "現行レート一覧", icon: ListChecks },
  { id: "employees", label: "社員マスタ", icon: Users },
  { id: "reports", label: "自分の申請", icon: ClipboardList },
  { id: "admin", label: "管理者ページ", icon: ShieldCheck },
];
// 出張先/交通費/宿泊費・日当マスタは通常ナビからは非表示。管理者ページの
// 「マスタ管理」ボタン（onNavigate）経由でのみ遷移する（tab自体はApp内で処理される）。

export default function App() {
  const [tab, setTab] = useState("form");
  const [loading, setLoading] = useState(true);
  const [destinations, setDestinations] = useState([]);
  const [transportHistory, setTransportHistory] = useState([]);
  const [ruleHistory, setRuleHistory] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [reports, setReports] = useState([]);
  const [toast, setToast] = useState("");
  const [duplicateSource, setDuplicateSource] = useState(null);
  const [template, setTemplate] = useState(null);
  const [notificationSettings, setNotificationSettings] = useState({ teamsMentionEmail: "" });
  const [adminUnlocked, setAdminUnlocked] = useState(() => sessionStorage.getItem("adminUnlocked") === "1");

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(""), 2200); };
  const unlockAdmin = () => { sessionStorage.setItem("adminUnlocked", "1"); setAdminUnlocked(true); };

  useEffect(() => {
    (async () => {
      try {
        const [d, t, r, e, rp, tpl, ns] = await Promise.all([
          db.listDestinations(),
          db.listTransportFares(),
          db.listTravelRules(),
          db.listEmployees(),
          db.listReports(),
          db.getTemplate(),
          db.getNotificationSettings(),
        ]);
        setDestinations(d.length ? d : await db.insertDestinationsBulk(SEED_DESTINATIONS));
        setTransportHistory(t.length ? t : await db.insertTransportFaresBulk(SEED_TRANSPORT_HISTORY));
        setRuleHistory(r.length ? r : await db.insertTravelRulesBulk(SEED_RULE_HISTORY));
        setEmployees(e.length ? e : await db.insertEmployeesBulk(SEED_EMPLOYEES));
        setReports(rp);
        setTemplate(tpl);
        setNotificationSettings(ns);
      } catch (err) {
        console.error(err);
        flash(`データの読み込みに失敗しました：${err.message || err}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const addDestination = async (row) => {
    const inserted = await db.insertDestination(row);
    setDestinations((prev) => [...prev, inserted]);
  };

  const addTransportFare = async (row) => {
    const inserted = await db.insertTransportFare(row);
    setTransportHistory((prev) => [...prev, inserted]);
  };
  const updateTransportFareRow = async (id, patch) => {
    await db.updateTransportFare(id, patch);
    setTransportHistory((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  };
  const deleteTransportFareRow = async (id) => {
    await db.deleteTransportFare(id);
    setTransportHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const addTravelRule = async (row) => {
    const inserted = await db.insertTravelRule(row);
    setRuleHistory((prev) => [...prev, inserted]);
  };
  const updateTravelRuleRow = async (id, patch) => {
    await db.updateTravelRule(id, patch);
    setRuleHistory((prev) => prev.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  };
  const deleteTravelRuleRow = async (id) => {
    await db.deleteTravelRule(id);
    setRuleHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const addEmployee = async (row) => {
    const inserted = await db.insertEmployee(row);
    setEmployees((prev) => [...prev, inserted]);
  };
  const addEmployeesBulk = async (rows) => {
    const inserted = await db.insertEmployeesBulk(rows);
    setEmployees((prev) => [...prev, ...inserted]);
  };
  const updateEmployeeRow = async (id, patch) => {
    await db.updateEmployee(id, patch);
    setEmployees((prev) => prev.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };
  const deleteEmployeeRow = async (id) => {
    await db.deleteEmployee(id);
    setEmployees((prev) => prev.filter((e) => e.id !== id));
  };

  const addReport = async (report) => {
    const inserted = await db.insertReport(report);
    setReports((prev) => [inserted, ...prev]);
    return inserted;
  };
  const updateReportRow = async (id, patch) => {
    await db.updateReportStatus(id, patch);
    setReports((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const deleteReportRow = async (id) => {
    await db.deleteReport(id);
    setReports((prev) => prev.filter((r) => r.id !== id));
  };

  const changeTemplate = async (next) => {
    if (next) { await db.upsertTemplate(next); setTemplate(next); }
    else { await db.deleteTemplate(); setTemplate(null); }
  };

  const changeNotificationSettings = async (next) => {
    await db.upsertNotificationSettings(next);
    setNotificationSettings(next);
  };

  if (loading) {
    return (
      <div style={styles.loadingWrap}>
        <RefreshCw size={22} className="spin" />
        <span style={{ marginLeft: 10 }}>マスタデータを読み込んでいます…</span>
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <GlobalStyle />
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>
            <div style={styles.brandMark}>旅費</div>
            <div>
              <div style={styles.brandTitle}>出張旅費精算</div>
              <div style={styles.brandSub}>規程・履歴に基づく自動計算ワークスペース</div>
            </div>
          </div>
          <nav style={styles.nav}>
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }}>
                  <Icon size={15} style={{ marginRight: 6 }} />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main style={styles.main}>
        {tab === "form" && (
          <ReportForm
            destinations={destinations}
            transportHistory={transportHistory}
            ruleHistory={ruleHistory}
            employees={employees}
            duplicateSource={duplicateSource}
            onDuplicateConsumed={() => setDuplicateSource(null)}
            onSubmitApplication={async (report) => {
              await addReport(report);
              flash(report.status === "approved" ? "申請を送信し、自動承認されました。" : "申請を送信しました。管理者の承認をお待ちください。");
              setTab("reports");
            }}
          />
        )}
        {tab === "rates" && (
          <RatesView destinations={destinations} transportHistory={transportHistory} ruleHistory={ruleHistory} />
        )}
        {tab === "employees" && (
          <EmployeeMaster
            employees={employees}
            onAdd={addEmployee}
            onAddBulk={addEmployeesBulk}
            onUpdate={updateEmployeeRow}
            onDelete={deleteEmployeeRow}
            flash={flash}
          />
        )}
        {tab === "dest" && (
          adminUnlocked ? (
            <DestMaster destinations={destinations} onAdd={addDestination} flash={flash} />
          ) : (
            <AdminGate onUnlock={unlockAdmin} />
          )
        )}
        {tab === "transport" && (
          adminUnlocked ? (
            <TransportHistoryView
              destinations={destinations}
              history={transportHistory}
              onAdd={addTransportFare}
              onUpdate={updateTransportFareRow}
              onDelete={deleteTransportFareRow}
              flash={flash}
            />
          ) : (
            <AdminGate onUnlock={unlockAdmin} />
          )
        )}
        {tab === "rules" && (
          adminUnlocked ? (
            <RuleHistoryView history={ruleHistory} onAdd={addTravelRule} onUpdate={updateTravelRuleRow} onDelete={deleteTravelRuleRow} flash={flash} />
          ) : (
            <AdminGate onUnlock={unlockAdmin} />
          )
        )}
        {tab === "reports" && (
          <ReportsList
            reports={reports}
            flash={flash}
            onDelete={async (id) => {
              await deleteReportRow(id);
              flash("削除しました");
            }}
            onDuplicate={(report) => {
              setDuplicateSource(report);
              setTab("form");
              flash("過去の申請内容を複製しました。日付を入力してください。");
            }}
          />
        )}
        {tab === "admin" && (
          adminUnlocked ? (
            <AdminPanel
              reports={reports}
              flash={flash}
              template={template}
              onTemplateChange={changeTemplate}
              onUpdate={updateReportRow}
              onNavigate={setTab}
              notificationSettings={notificationSettings}
              onNotificationSettingsChange={changeNotificationSettings}
            />
          ) : (
            <AdminGate onUnlock={unlockAdmin} />
          )
        )}
      </main>

      {toast && <div style={styles.toast}>{toast}</div>}
    </div>
  );
}

/* ================= 精算書作成フォーム ================= */
const AUTO_APPROVE_ROLES = ["役員", "管理職"];

function ReportForm({ destinations, transportHistory, ruleHistory, employees, duplicateSource, onDuplicateConsumed, onSubmitApplication }) {
  const [employeeId, setEmployeeId] = useState("");
  const [applyDate, setApplyDate] = useState(todayISO());
  const [advance, setAdvance] = useState(0);
  const [legs, setLegs] = useState([{ id: uid(), code: "", start: "", end: "", purposeOverride: "" }]);
  const [autoApproveNotice, setAutoApproveNotice] = useState(null);
  const [highlightDates, setHighlightDates] = useState(false);

  useEffect(() => {
    if (!duplicateSource) return;
    const src = duplicateSource;
    const matchedEmployee = employees.find((e) => e.id === src.employeeId) || employees.find((e) => e.name === src.applicant);
    setEmployeeId(matchedEmployee ? matchedEmployee.id : "");
    setApplyDate(todayISO());
    setAdvance(src.advance || 0);
    setLegs(
      (src.legs || []).length
        ? src.legs.map((l) => ({ id: uid(), code: l.code, start: "", end: "", purposeOverride: l.purpose || "" }))
        : [{ id: uid(), code: "", start: "", end: "", purposeOverride: "" }]
    );
    setHighlightDates(true);
    onDuplicateConsumed();
  }, [duplicateSource, employees, onDuplicateConsumed]);

  const sortedEmployees = useMemo(() => [...employees].sort((a, b) => a.name.localeCompare(b.name, "ja")), [employees]);
  const selectedEmployee = useMemo(() => employees.find((e) => e.id === employeeId) || null, [employees, employeeId]);
  const applicant = selectedEmployee?.name || "";
  const role = selectedEmployee?.role || "";
  const autoApproves = AUTO_APPROVE_ROLES.includes(role);

  const destByCode = useMemo(() => Object.fromEntries(destinations.map((d) => [d.code, d])), [destinations]);

  const addLeg = () => setLegs((l) => [...l, { id: uid(), code: "", start: "", end: "", purposeOverride: "" }]);
  const removeLeg = (id) => setLegs((l) => (l.length > 1 ? l.filter((x) => x.id !== id) : l));
  const updateLeg = (id, patch) => setLegs((l) => l.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const computed = useMemo(() => {
    return legs.map((leg) => {
      const dest = destByCode[leg.code];
      const nights = daysInclusive(leg.start, leg.end);
      if (!dest || !nights) {
        return { ...leg, dest, nights: 0, transport: 0, lodgingUnit: 0, perDiemUnit: 0, lodging: 0, perDiem: 0, subtotal: 0, missingRate: false };
      }
      const asOf = leg.start; // 出発日時点で有効な規程を適用
      const tr = currentTransport(transportHistory, dest.code, asOf);
      const rule = currentRule(ruleHistory, dest.category, asOf);
      const transport = tr ? (tr.mainFare || 0) + (tr.subFare || 0) : 0;
      const lodgingUnit = rule ? rule.lodging : 0;
      const perDiemUnit = rule ? rule.perDiem : 0;
      const lodging = lodgingUnit * nights;
      const perDiem = perDiemUnit * nights;
      return {
        ...leg, dest, nights, transport, lodgingUnit, perDiemUnit, lodging, perDiem,
        subtotal: transport + lodging + perDiem,
        missingRate: !tr || !rule,
      };
    });
  }, [legs, destByCode, transportHistory, ruleHistory]);

  const totals = useMemo(() => computed.reduce((acc, c) => ({
    transport: acc.transport + c.transport,
    lodging: acc.lodging + c.lodging,
    perDiem: acc.perDiem + c.perDiem,
    grand: acc.grand + c.subtotal,
  }), { transport: 0, lodging: 0, perDiem: 0, grand: 0 }), [computed]);

  const balance = totals.grand - (Number(advance) || 0);
  const canSave = !!employeeId && computed.every((c) => c.dest && c.nights > 0) && computed.length > 0;

  const buildReport = () => ({
    id: uid(),
    employeeId, applicant, role, applyDate, advance: Number(advance) || 0,
    legs: computed.map((c) => ({
      code: c.code, place: c.dest?.place, category: c.dest?.category,
      purpose: c.purposeOverride || c.dest?.purpose, start: c.start, end: c.end,
      nights: c.nights, transport: c.transport, lodging: c.lodging, perDiem: c.perDiem, subtotal: c.subtotal,
    })),
    totals, balance, createdAt: new Date().toISOString(),
    status: "pending", reviewedBy: null, reviewedAt: null, reviewComment: "",
  });

  const handleSubmitClick = () => {
    const report = buildReport();
    if (autoApproves) {
      report.status = "approved";
      report.reviewedAt = new Date().toISOString();
      report.reviewedBy = `自動承認（${role}）`;
      setAutoApproveNotice(report);
    } else {
      onSubmitApplication(report);
    }
  };

  const confirmAutoApprove = () => {
    if (!autoApproveNotice) return;
    onSubmitApplication(autoApproveNotice);
    setAutoApproveNotice(null);
  };

  const exportExcel = () => {
    const report = buildReport();
    const wb = XLSX.utils.book_new();
    const aoa = [
      ["出張旅費清算書", null, null, null, null, null, null, `作成日: ${wareki(report.applyDate)}`],
      [],
      ["氏名", report.applicant, "職責", report.role, "仮払額", report.advance, "円", null],
      [],
      ["月日(出発)", "月日(帰着)", "出張先", "区分", "目的", "日数", "交通費", "宿泊費", "日当", "小計"],
      ...report.legs.map((l) => [l.start, l.end, l.place, l.category, l.purpose, l.nights, l.transport, l.lodging, l.perDiem, l.subtotal]),
      [],
      ["合計", null, null, null, null, null, report.totals.transport, report.totals.lodging, report.totals.perDiem, report.totals.grand],
      ["仮払額", report.advance],
      ["過不足額", report.balance],
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
    ws["!cols"] = [{ wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, "出張旅費清算書");
    XLSX.writeFile(wb, `出張旅費清算書_${report.applicant || "無記名"}_${report.applyDate}.xlsx`);
  };

  return (
    <div style={styles.grid2}>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>基本情報</h2>
        <div style={styles.formRow}>
          <label style={styles.label}>出張者氏名</label>
          <select style={styles.input} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">選択してください</option>
            {sortedEmployees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}（{e.role}）</option>
            ))}
          </select>
          {!employees.length && (
            <div style={styles.hint}>社員が登録されていません。「社員マスタ」タブから登録してください。</div>
          )}
        </div>
        <div style={styles.formRow}>
          <label style={styles.label}>職責（氏名選択で自動反映）</label>
          <div style={styles.readonlyField}>{role || "—"}</div>
        </div>
        <div style={styles.formRow2}>
          <div>
            <label style={styles.label}>申請日</label>
            <input type="date" style={styles.input} value={applyDate} onChange={(e) => setApplyDate(e.target.value)} />
          </div>
          <div>
            <label style={styles.label}>仮払額（円）</label>
            <input type="number" style={styles.input} value={advance} onChange={(e) => setAdvance(e.target.value)} />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22 }}>
          <h2 style={{ ...styles.cardTitle, margin: 0 }}>出張区間</h2>
          <button onClick={addLeg} style={styles.smallBtn}><Plus size={14} style={{ marginRight: 4 }} />区間を追加</button>
        </div>

        {legs.map((leg, i) => {
          const c = computed[i];
          return (
            <div key={leg.id} style={styles.legCard}>
              <div style={styles.legHead}>
                <span style={styles.legIndex}>#{i + 1}</span>
                {legs.length > 1 && (
                  <button onClick={() => removeLeg(leg.id)} style={styles.iconBtn}><Trash2 size={14} /></button>
                )}
              </div>
              <div style={styles.formRow}>
                <label style={styles.label}>出張先</label>
                <select style={styles.input} value={leg.code} onChange={(e) => updateLeg(leg.id, { code: Number(e.target.value) || "" })}>
                  <option value="">選択してください</option>
                  <optgroup label="国内">
                    {destinations.filter((d) => d.category === "国内").map((d) => (
                      <option key={d.code} value={d.code}>{d.place}（{d.purpose}）</option>
                    ))}
                  </optgroup>
                  <optgroup label="海外">
                    {destinations.filter((d) => d.category === "海外").map((d) => (
                      <option key={d.code} value={d.code}>{d.place}（{d.purpose}）</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div style={styles.formRow2}>
                <div>
                  <label style={styles.label}>出発日</label>
                  <input
                    type="date"
                    style={{ ...styles.input, ...(highlightDates && !leg.start ? styles.blinkAttention : {}) }}
                    value={leg.start}
                    onChange={(e) => updateLeg(leg.id, { start: e.target.value })}
                  />
                </div>
                <div>
                  <label style={styles.label}>帰着日</label>
                  <input
                    type="date"
                    style={{ ...styles.input, ...(highlightDates && !leg.end ? styles.blinkAttention : {}) }}
                    value={leg.end}
                    onChange={(e) => updateLeg(leg.id, { end: e.target.value })}
                  />
                </div>
              </div>
              <div style={styles.formRow}>
                <label style={styles.label}>目的（任意で上書き）</label>
                <input style={styles.input} placeholder={c?.dest?.purpose || ""} value={leg.purposeOverride} onChange={(e) => updateLeg(leg.id, { purposeOverride: e.target.value })} />
              </div>

              {c && c.dest && c.nights > 0 ? (
                <div style={styles.legSummary}>
                  <SummaryItem label="日数" value={`${c.nights} 日`} />
                  <SummaryItem label="交通費" value={`¥${yen(c.transport)}`} />
                  <SummaryItem label="宿泊費" value={`¥${yen(c.lodging)}`} sub={`単価¥${yen(c.lodgingUnit)}×${c.nights}`} />
                  <SummaryItem label="日当" value={`¥${yen(c.perDiem)}`} sub={`単価¥${yen(c.perDiemUnit)}×${c.nights}`} />
                  <SummaryItem label="小計" value={`¥${yen(c.subtotal)}`} strong />
                  {c.missingRate && (
                    <div style={styles.warn}><AlertCircle size={13} style={{ marginRight: 4 }} />出発日時点で有効な規程が見つかりません</div>
                  )}
                </div>
              ) : (
                <div style={styles.hint}>出張先と出発日・帰着日を入力すると自動計算されます</div>
              )}
            </div>
          );
        })}
      </section>

      <section style={{ ...styles.card, position: "sticky", top: 84, alignSelf: "start" }}>
        <h2 style={styles.cardTitle}>清算プレビュー</h2>
        <div style={styles.previewRow}><span>交通費 合計</span><b>¥{yen(totals.transport)}</b></div>
        <div style={styles.previewRow}><span>宿泊費 合計</span><b>¥{yen(totals.lodging)}</b></div>
        <div style={styles.previewRow}><span>日当 合計</span><b>¥{yen(totals.perDiem)}</b></div>
        <div style={{ ...styles.previewRow, borderTop: "1px solid #E2E5EA", paddingTop: 10, marginTop: 6 }}>
          <span>清算額</span><b style={{ fontSize: 20, color: "#1B4B6B" }}>¥{yen(totals.grand)}</b>
        </div>
        <div style={styles.previewRow}><span>仮払額</span><b>¥{yen(advance)}</b></div>
        <div style={styles.previewRow}>
          <span>過不足額</span>
          <b style={{ color: balance === 0 ? "#2F6B4F" : balance > 0 ? "#B4472B" : "#1B4B6B" }}>
            {balance > 0 ? `不足 ¥${yen(balance)}` : balance < 0 ? `過払 ¥${yen(-balance)}` : "¥0"}
          </b>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
          <button disabled={!canSave} onClick={handleSubmitClick} style={{ ...styles.primaryBtn, opacity: canSave ? 1 : 0.45 }}>
            <Send size={15} style={{ marginRight: 6 }} />申請する
          </button>
          <button disabled={!canSave} onClick={exportExcel} style={{ ...styles.secondaryBtn, opacity: canSave ? 1 : 0.45 }}>
            <Download size={15} style={{ marginRight: 6 }} />Excelでダウンロード
          </button>
        </div>
        {!canSave && <div style={styles.hint}>氏名・すべての区間（出張先/出発日/帰着日）を入力してください</div>}
        <div style={styles.hint}>
          {autoApproves
            ? "選択中の職責（役員・管理職）は申請と同時に自動承認されます。"
            : "「申請する」を押すと管理者ページの一覧に表示され、承認待ちになります。"}
        </div>
      </section>

      {autoApproveNotice && (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={styles.modalIcon}><CheckCircle2 size={22} color="#2F6B4F" /></div>
            <h3 style={styles.modalTitle}>役員、管理者は自動承認となります。</h3>
            <p style={styles.modalBody}>
              {autoApproveNotice.applicant} 様（{autoApproveNotice.role}）の申請は、承認操作を経ずに自動で承認済みとして登録されます。
            </p>
            <div style={styles.modalTotal}>清算額　¥{yen(autoApproveNotice.totals.grand)}</div>
            <button onClick={confirmAutoApprove} style={{ ...styles.primaryBtn, marginTop: 18 }}>OK（承認して申請を送信）</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryItem({ label, value, sub, strong }) {
  return (
    <div style={styles.summaryItem}>
      <div style={styles.summaryLabel}>{label}</div>
      <div style={{ fontSize: strong ? 17 : 15, fontWeight: strong ? 800 : 700, color: strong ? "#1B4B6B" : "#22262B" }}>{value}</div>
      {sub && <div style={styles.summarySub}>{sub}</div>}
    </div>
  );
}

/* ================= 現行レート一覧（現行一覧シート相当） ================= */
function RatesView({ destinations, transportHistory, ruleHistory }) {
  const [asOf, setAsOf] = useState(todayISO());
  const rules = ["国内", "海外"].map((cat) => ({ cat, rule: currentRule(ruleHistory, cat, asOf) }));

  return (
    <div>
      <section style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={styles.cardTitle}>現行 旅費規程（基準日時点）</h2>
          <div>
            <label style={{ ...styles.label, marginRight: 8 }}>基準日</label>
            <input type="date" style={{ ...styles.input, width: 170, display: "inline-block" }} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
          </div>
        </div>
        <table style={styles.table}>
          <thead><tr><th>区分</th><th>宿泊費</th><th>日当</th><th>適用開始日</th></tr></thead>
          <tbody>
            {rules.map(({ cat, rule }) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td>{rule ? `¥${yen(rule.lodging)}` : "—"}</td>
                <td>{rule ? `¥${yen(rule.perDiem)}` : "—"}</td>
                <td>{rule ? rule.effectiveDate : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ ...styles.card, marginTop: 20 }}>
        <h2 style={styles.cardTitle}>出張先別 現行交通費（基準日時点）</h2>
        <table style={styles.table}>
          <thead>
            <tr><th>コード</th><th>区分</th><th>出張先</th><th>目的</th><th>乗り物(主)</th><th>クラス(主)</th><th>主交通費</th><th>副交通費</th><th>適用開始日</th></tr>
          </thead>
          <tbody>
            {destinations.map((d) => {
              const tr = currentTransport(transportHistory, d.code, asOf);
              return (
                <tr key={d.code}>
                  <td>{d.code}</td><td>{d.category}</td><td>{d.place}</td><td>{d.purpose}</td>
                  <td>{d.transportMain}</td><td>{d.classMain}</td>
                  <td>{tr ? `¥${yen(tr.mainFare)}` : "—"}</td>
                  <td>{tr && tr.subFare ? `¥${yen(tr.subFare)}` : ""}</td>
                  <td>{tr ? tr.effectiveDate : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ================= 社員マスタ管理 ================= */
function EmployeeMaster({ employees, onAdd, onAddBulk, onUpdate, onDelete, flash }) {
  const [form, setForm] = useState({ name: "", role: "一般", isAdmin: false });
  const [bulkText, setBulkText] = useState("");
  const [showBulk, setShowBulk] = useState(false);

  const submit = async () => {
    if (!form.name.trim()) { flash("氏名を入力してください"); return; }
    if (employees.some((e) => e.name === form.name.trim())) { flash("同姓同名の社員が既に登録されています"); return; }
    try {
      await onAdd({ name: form.name.trim(), role: form.role, isAdmin: !!form.isAdmin });
      setForm({ name: "", role: "一般", isAdmin: false });
      flash("社員を登録しました");
    } catch (err) {
      flash(`登録に失敗しました：${err.message || err}`);
    }
  };

  const remove = async (id) => {
    try {
      await onDelete(id);
      flash("削除しました");
    } catch (err) {
      flash(`削除に失敗しました：${err.message || err}`);
    }
  };

  const toggleAdmin = async (id) => {
    const target = employees.find((e) => e.id === id);
    if (!target) return;
    try {
      await onUpdate(id, { isAdmin: !target.isAdmin });
    } catch (err) {
      flash(`更新に失敗しました：${err.message || err}`);
    }
  };

  const submitBulk = async () => {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) { flash("貼り付ける内容がありません"); return; }
    const existing = new Set(employees.map((e) => e.name));
    const added = [];
    for (const line of lines) {
      const [rawName, rawRole, rawAdmin] = line.split(/[,、\t]/).map((s) => (s || "").trim());
      if (!rawName) continue;
      const role = ["役員", "管理職", "一般"].includes(rawRole) ? rawRole : "一般";
      const isAdmin = ["管理者", "admin", "○", "はい", "true", "1"].includes((rawAdmin || "").toLowerCase());
      if (existing.has(rawName)) continue;
      existing.add(rawName);
      added.push({ name: rawName, role, isAdmin });
    }
    if (!added.length) { flash("追加できる行がありませんでした（重複または空欄）"); return; }
    try {
      await onAddBulk(added);
      setBulkText("");
      setShowBulk(false);
      flash(`${added.length}件の社員を一括登録しました`);
    } catch (err) {
      flash(`一括登録に失敗しました：${err.message || err}`);
    }
  };

  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name, "ja"));

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>社員マスタ</h2>
        <p style={styles.notice}>
          このアプリは組み込みのブラウザ環境から動作するため、Microsoft&nbsp;365（Entra&nbsp;ID）のプロフィールに直接サインインして氏名一覧を取得することはできません。
          Microsoft&nbsp;365管理センターやTeams管理者からエクスポートしたユーザー一覧（氏名・職責）をこの画面で登録・一括貼り付けしておくことで、
          精算書作成タブの「出張者氏名」をプルダウンから選択できるようにしています。「管理者」にチェックした社員は、将来的に管理者ページの操作権限を判定する際の目印として利用できます。
        </p>
      </section>

      <section style={{ ...styles.card, marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ ...styles.cardTitle, margin: 0 }}>社員を1件ずつ登録</h2>
          <button onClick={() => setShowBulk((s) => !s)} style={styles.smallBtn}>
            <Upload size={14} style={{ marginRight: 4 }} />{showBulk ? "一括登録を閉じる" : "CSVで一括登録"}
          </button>
        </div>
        <div style={{ ...styles.formGrid, gridTemplateColumns: "2fr 1fr auto auto", marginTop: 14 }}>
          <div>
            <label style={styles.label}>氏名</label>
            <input style={styles.input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例）保田 一帆" />
          </div>
          <div>
            <label style={styles.label}>職責</label>
            <select style={styles.input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="役員">役員</option>
              <option value="管理職">管理職</option>
              <option value="一般">一般</option>
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 9 }}>
            <label style={styles.radioLabel}>
              <input type="checkbox" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} /> 管理者
            </label>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <button onClick={submit} style={{ ...styles.primaryBtn, width: "auto", padding: "9px 18px" }}><Plus size={15} style={{ marginRight: 6 }} />登録</button>
          </div>
        </div>

        {showBulk && (
          <div style={{ marginTop: 16, background: "#FAFBFC", border: "1px solid #E7EAEF", borderRadius: 10, padding: 14 }}>
            <label style={styles.label}>氏名,職責,管理者 の形式で1行ずつ貼り付け（職責を省略すると「一般」／管理者列に「管理者」「○」等を入れるとチェック）</label>
            <textarea
              style={{ ...styles.input, minHeight: 100, resize: "vertical", fontFamily: "monospace" }}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={"保田 一帆,役員,管理者\n山田 太郎,管理職\n鈴木 花子"}
            />
            <button onClick={submitBulk} style={{ ...styles.primaryBtn, width: "auto", padding: "9px 18px", marginTop: 10 }}>
              <Upload size={15} style={{ marginRight: 6 }} />一括登録する
            </button>
          </div>
        )}
      </section>

      <section style={{ ...styles.card, marginTop: 16 }}>
        <h2 style={styles.cardTitle}>登録済み社員（{sorted.length}名）</h2>
        {sorted.length === 0 ? (
          <p style={styles.notice}>まだ社員が登録されていません。</p>
        ) : (
          <table style={styles.table}>
            <thead><tr><th>氏名</th><th>職責</th><th>管理者</th><th></th></tr></thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td>{e.role}</td>
                  <td>
                    <input type="checkbox" checked={!!e.isAdmin} onChange={() => toggleAdmin(e.id)} style={{ width: 16, height: 16, cursor: "pointer" }} />
                  </td>
                  <td><button onClick={() => remove(e.id)} style={styles.iconBtn}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ================= 出張先マスタ管理 ================= */
function DestMaster({ destinations, onAdd, flash }) {
  const [form, setForm] = useState({ code: "", category: "国内", place: "", purpose: "", transportMain: "", classMain: "", transportSub: "" });

  const nextCode = () => {
    const domestic = destinations.filter((d) => d.category === "国内").map((d) => d.code);
    const overseas = destinations.filter((d) => d.category === "海外").map((d) => d.code);
    return form.category === "国内" ? (domestic.length ? Math.max(...domestic) + 1 : 1) : (overseas.length ? Math.max(...overseas) + 1 : 101);
  };

  const submit = async () => {
    if (!form.place.trim()) { flash("出張先名を入力してください"); return; }
    const code = form.code ? Number(form.code) : nextCode();
    if (destinations.some((d) => d.code === code)) { flash("そのコードは既に使用されています"); return; }
    try {
      await onAdd({ ...form, code });
      setForm({ code: "", category: "国内", place: "", purpose: "", transportMain: "", classMain: "", transportSub: "" });
      flash("出張先を追加しました");
    } catch (err) {
      flash(`追加に失敗しました：${err.message || err}`);
    }
  };

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>出張先を追加</h2>
        <div style={styles.formGrid}>
          <div><label style={styles.label}>コード（空欄で自動採番）</label><input style={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder={String(nextCode())} /></div>
          <div><label style={styles.label}>区分</label>
            <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="国内">国内</option><option value="海外">海外</option>
            </select>
          </div>
          <div><label style={styles.label}>出張先(地名等)</label><input style={styles.input} value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} /></div>
          <div><label style={styles.label}>目的</label><input style={styles.input} value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></div>
          <div><label style={styles.label}>乗り物(主)</label><input style={styles.input} value={form.transportMain} onChange={(e) => setForm({ ...form, transportMain: e.target.value })} /></div>
          <div><label style={styles.label}>クラス(主)</label><input style={styles.input} value={form.classMain} onChange={(e) => setForm({ ...form, classMain: e.target.value })} /></div>
          <div><label style={styles.label}>乗り物(副)</label><input style={styles.input} value={form.transportSub} onChange={(e) => setForm({ ...form, transportSub: e.target.value })} /></div>
        </div>
        <button onClick={submit} style={{ ...styles.primaryBtn, marginTop: 14, width: "auto", padding: "10px 20px" }}><Plus size={15} style={{ marginRight: 6 }} />追加</button>
      </section>

      <section style={{ ...styles.card, marginTop: 20 }}>
        <h2 style={styles.cardTitle}>出張先一覧（{destinations.length}件）</h2>
        <table style={styles.table}>
          <thead><tr><th>コード</th><th>区分</th><th>出張先</th><th>目的</th><th>乗り物(主)</th><th>クラス(主)</th><th>乗り物(副)</th></tr></thead>
          <tbody>
            {destinations.map((d) => (
              <tr key={d.code}><td>{d.code}</td><td>{d.category}</td><td>{d.place}</td><td>{d.purpose}</td><td>{d.transportMain}</td><td>{d.classMain}</td><td>{d.transportSub}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ================= 交通費マスタ管理 ================= */
function TransportHistoryView({ destinations, history, onAdd, onUpdate, onDelete, flash }) {
  const [form, setForm] = useState({ code: "", effectiveDate: todayISO(), mainFare: "", subFare: "", note: "" });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const submit = async () => {
    if (!form.code || !form.mainFare) { flash("出張先と主交通費を入力してください"); return; }
    try {
      await onAdd({ code: Number(form.code), effectiveDate: form.effectiveDate, mainFare: Number(form.mainFare), subFare: form.subFare ? Number(form.subFare) : null, note: form.note });
      setForm({ code: "", effectiveDate: todayISO(), mainFare: "", subFare: "", note: "" });
      flash("交通費を追加しました");
    } catch (err) {
      flash(`追加に失敗しました：${err.message || err}`);
    }
  };

  const startEdit = (h) => {
    setEditingId(h.id);
    setEditDraft({ code: String(h.code), effectiveDate: h.effectiveDate, mainFare: String(h.mainFare), subFare: h.subFare != null ? String(h.subFare) : "", note: h.note || "" });
    setDeletingId(null);
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };
  const saveEdit = async (id) => {
    if (!editDraft.code || !editDraft.mainFare) { flash("出張先と主交通費を入力してください"); return; }
    try {
      await onUpdate(id, { code: Number(editDraft.code), effectiveDate: editDraft.effectiveDate, mainFare: Number(editDraft.mainFare), subFare: editDraft.subFare ? Number(editDraft.subFare) : null, note: editDraft.note });
      setEditingId(null);
      setEditDraft(null);
      flash("交通費を更新しました");
    } catch (err) {
      flash(`更新に失敗しました：${err.message || err}`);
    }
  };
  const confirmDelete = async (id) => {
    try {
      await onDelete(id);
      setDeletingId(null);
      flash("交通費を削除しました");
    } catch (err) {
      flash(`削除に失敗しました：${err.message || err}`);
    }
  };

  const sorted = [...history].sort((a, b) => (a.code - b.code) || a.effectiveDate.localeCompare(b.effectiveDate));
  const placeOf = (code) => destinations.find((d) => d.code === code)?.place || "—";

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>交通費を追加</h2>
        <p style={styles.notice}>適用開始日を変えて追加すると、改定の履歴として扱われます。既存データは下の一覧から直接編集・削除できます。</p>
        <div style={styles.formGrid}>
          <div><label style={styles.label}>出張先</label>
            <select style={styles.input} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
              <option value="">選択してください</option>
              {destinations.map((d) => <option key={d.code} value={d.code}>{d.code}：{d.place}</option>)}
            </select>
          </div>
          <div><label style={styles.label}>適用開始日</label><input type="date" style={styles.input} value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></div>
          <div><label style={styles.label}>主交通費</label><input type="number" style={styles.input} value={form.mainFare} onChange={(e) => setForm({ ...form, mainFare: e.target.value })} /></div>
          <div><label style={styles.label}>副交通費</label><input type="number" style={styles.input} value={form.subFare} onChange={(e) => setForm({ ...form, subFare: e.target.value })} /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={styles.label}>備考</label><input style={styles.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <button onClick={submit} style={{ ...styles.primaryBtn, marginTop: 14, width: "auto", padding: "10px 20px" }}><Plus size={15} style={{ marginRight: 6 }} />追加</button>
      </section>

      <section style={{ ...styles.card, marginTop: 20 }}>
        <h2 style={styles.cardTitle}>交通費一覧（{sorted.length}件）</h2>
        <table style={styles.table}>
          <thead><tr><th>コード</th><th>出張先</th><th>適用開始日</th><th>主交通費</th><th>副交通費</th><th>備考</th><th></th></tr></thead>
          <tbody>
            {sorted.map((h) => {
              const isEditing = editingId === h.id;
              return (
                <tr key={h.id}>
                  {isEditing ? (
                    <>
                      <td>
                        <select style={styles.input} value={editDraft.code} onChange={(e) => setEditDraft({ ...editDraft, code: e.target.value })}>
                          {destinations.map((d) => <option key={d.code} value={d.code}>{d.code}：{d.place}</option>)}
                        </select>
                      </td>
                      <td>{placeOf(Number(editDraft.code))}</td>
                      <td><input type="date" style={styles.input} value={editDraft.effectiveDate} onChange={(e) => setEditDraft({ ...editDraft, effectiveDate: e.target.value })} /></td>
                      <td><input type="number" style={styles.input} value={editDraft.mainFare} onChange={(e) => setEditDraft({ ...editDraft, mainFare: e.target.value })} /></td>
                      <td><input type="number" style={styles.input} value={editDraft.subFare} onChange={(e) => setEditDraft({ ...editDraft, subFare: e.target.value })} /></td>
                      <td><input style={styles.input} value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => saveEdit(h.id)} style={styles.smallBtn}>保存</button>
                          <button onClick={cancelEdit} style={styles.iconBtn}><XCircle size={13} /></button>
                        </div>
                      </td>
                    </>
                  ) : deletingId === h.id ? (
                    <>
                      <td colSpan={6} style={{ color: "#B4472B", fontWeight: 700 }}>
                        <AlertCircle size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                        {placeOf(h.code)}（{h.effectiveDate}）のデータを削除します。よろしいですか？
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => confirmDelete(h.id)} style={{ ...styles.primaryBtn, width: "auto", padding: "6px 12px", background: "#B4472B" }}>削除</button>
                          <button onClick={() => setDeletingId(null)} style={{ ...styles.secondaryBtn, width: "auto", padding: "6px 12px" }}>キャンセル</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{h.code}</td>
                      <td>{placeOf(h.code)}</td>
                      <td>{h.effectiveDate}</td>
                      <td>¥{yen(h.mainFare)}</td>
                      <td>{h.subFare ? `¥${yen(h.subFare)}` : ""}</td>
                      <td>{h.note}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => startEdit(h)} style={styles.smallBtn}>編集</button>
                          <button onClick={() => setDeletingId(h.id)} style={styles.iconBtn}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ================= 宿泊費・日当マスタ管理 ================= */
function RuleHistoryView({ history, onAdd, onUpdate, onDelete, flash }) {
  const [form, setForm] = useState({ category: "国内", effectiveDate: todayISO(), lodging: "", perDiem: "", note: "" });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const submit = async () => {
    if (!form.lodging || !form.perDiem) { flash("宿泊費・日当を入力してください"); return; }
    try {
      await onAdd({ category: form.category, effectiveDate: form.effectiveDate, lodging: Number(form.lodging), perDiem: Number(form.perDiem), note: form.note });
      setForm({ category: "国内", effectiveDate: todayISO(), lodging: "", perDiem: "", note: "" });
      flash("宿泊費・日当を追加しました");
    } catch (err) {
      flash(`追加に失敗しました：${err.message || err}`);
    }
  };

  const startEdit = (h) => {
    setEditingId(h.id);
    setEditDraft({ category: h.category, effectiveDate: h.effectiveDate, lodging: String(h.lodging), perDiem: String(h.perDiem), note: h.note || "" });
    setDeletingId(null);
  };
  const cancelEdit = () => { setEditingId(null); setEditDraft(null); };
  const saveEdit = async (id) => {
    if (!editDraft.lodging || !editDraft.perDiem) { flash("宿泊費・日当を入力してください"); return; }
    try {
      await onUpdate(id, { category: editDraft.category, effectiveDate: editDraft.effectiveDate, lodging: Number(editDraft.lodging), perDiem: Number(editDraft.perDiem), note: editDraft.note });
      setEditingId(null);
      setEditDraft(null);
      flash("宿泊費・日当を更新しました");
    } catch (err) {
      flash(`更新に失敗しました：${err.message || err}`);
    }
  };
  const confirmDelete = async (id) => {
    try {
      await onDelete(id);
      setDeletingId(null);
      flash("宿泊費・日当を削除しました");
    } catch (err) {
      flash(`削除に失敗しました：${err.message || err}`);
    }
  };

  const sorted = [...history].sort((a, b) => a.category.localeCompare(b.category) || a.effectiveDate.localeCompare(b.effectiveDate));

  return (
    <div>
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>宿泊費・日当を追加</h2>
        <p style={styles.notice}>適用開始日を変えて追加すると、改定の履歴として扱われます。既存データは下の一覧から直接編集・削除できます。</p>
        <div style={styles.formGrid}>
          <div><label style={styles.label}>区分</label>
            <select style={styles.input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="国内">国内</option><option value="海外">海外</option>
            </select>
          </div>
          <div><label style={styles.label}>適用開始日</label><input type="date" style={styles.input} value={form.effectiveDate} onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })} /></div>
          <div><label style={styles.label}>宿泊費（1泊）</label><input type="number" style={styles.input} value={form.lodging} onChange={(e) => setForm({ ...form, lodging: e.target.value })} /></div>
          <div><label style={styles.label}>日当（1日）</label><input type="number" style={styles.input} value={form.perDiem} onChange={(e) => setForm({ ...form, perDiem: e.target.value })} /></div>
          <div style={{ gridColumn: "1 / -1" }}><label style={styles.label}>備考</label><input style={styles.input} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
        </div>
        <button onClick={submit} style={{ ...styles.primaryBtn, marginTop: 14, width: "auto", padding: "10px 20px" }}><Plus size={15} style={{ marginRight: 6 }} />追加</button>
      </section>

      <section style={{ ...styles.card, marginTop: 20 }}>
        <h2 style={styles.cardTitle}>宿泊費・日当一覧（{sorted.length}件）</h2>
        <table style={styles.table}>
          <thead><tr><th>区分</th><th>適用開始日</th><th>宿泊費</th><th>日当</th><th>備考</th><th></th></tr></thead>
          <tbody>
            {sorted.map((h) => {
              const isEditing = editingId === h.id;
              return (
                <tr key={h.id}>
                  {isEditing ? (
                    <>
                      <td>
                        <select style={styles.input} value={editDraft.category} onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}>
                          <option value="国内">国内</option><option value="海外">海外</option>
                        </select>
                      </td>
                      <td><input type="date" style={styles.input} value={editDraft.effectiveDate} onChange={(e) => setEditDraft({ ...editDraft, effectiveDate: e.target.value })} /></td>
                      <td><input type="number" style={styles.input} value={editDraft.lodging} onChange={(e) => setEditDraft({ ...editDraft, lodging: e.target.value })} /></td>
                      <td><input type="number" style={styles.input} value={editDraft.perDiem} onChange={(e) => setEditDraft({ ...editDraft, perDiem: e.target.value })} /></td>
                      <td><input style={styles.input} value={editDraft.note} onChange={(e) => setEditDraft({ ...editDraft, note: e.target.value })} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => saveEdit(h.id)} style={styles.smallBtn}>保存</button>
                          <button onClick={cancelEdit} style={styles.iconBtn}><XCircle size={13} /></button>
                        </div>
                      </td>
                    </>
                  ) : deletingId === h.id ? (
                    <>
                      <td colSpan={5} style={{ color: "#B4472B", fontWeight: 700 }}>
                        <AlertCircle size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                        {h.category}（{h.effectiveDate}）のデータを削除します。よろしいですか？
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => confirmDelete(h.id)} style={{ ...styles.primaryBtn, width: "auto", padding: "6px 12px", background: "#B4472B" }}>削除</button>
                          <button onClick={() => setDeletingId(null)} style={{ ...styles.secondaryBtn, width: "auto", padding: "6px 12px" }}>キャンセル</button>
                        </div>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{h.category}</td>
                      <td>{h.effectiveDate}</td>
                      <td>¥{yen(h.lodging)}</td>
                      <td>¥{yen(h.perDiem)}</td>
                      <td>{h.note}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button onClick={() => startEdit(h)} style={styles.smallBtn}>編集</button>
                          <button onClick={() => setDeletingId(h.id)} style={styles.iconBtn}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/* ================= 共通：ステータスバッジ ================= */
const STATUS_META = {
  pending: { label: "申請中", color: "#8A6D1D", bg: "#FBF2DC", icon: Clock3 },
  approved: { label: "承認済み", color: "#2F6B4F", bg: "#E3F1E9", icon: CheckCircle2 },
  rejected: { label: "却下", color: "#B4472B", bg: "#FBEEEB", icon: XCircle },
};
function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.pending;
  const Icon = meta.icon;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: meta.bg, color: meta.color, padding: "4px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 800 }}>
      <Icon size={12} />{meta.label}
    </span>
  );
}

/* ================= 自分の申請（精算履歴） ================= */
function ReportsList({ reports, onDelete, onDuplicate, flash }) {
  if (!reports.length) {
    return <section style={styles.card}><p style={styles.notice}>まだ申請はありません。「精算書作成」タブから申請できます。</p></section>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <section style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ ...styles.cardTitle, marginBottom: 4 }}>自分の申請</h2>
            <p style={styles.notice}>これまでに提出した申請の一覧です。</p>
          </div>
          <button onClick={() => exportReportsWorkbook(reports, flash, { fileTag: "自分の申請", splitByStatus: true })} style={{ ...styles.primaryBtn, width: "auto", padding: "8px 16px" }}>
            <Download size={14} style={{ marginRight: 6 }} />Excelで一括エクスポート
          </button>
        </div>
      </section>
      {reports.map((r) => (
        <section key={r.id} style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                <h2 style={{ ...styles.cardTitle, margin: 0 }}>{r.applicant}（{r.role}）</h2>
                <StatusBadge status={r.status || "pending"} />
              </div>
              <div style={styles.notice}>申請日：{wareki(r.applyDate)}　/　申請日時：{new Date(r.createdAt).toLocaleString("ja-JP")}</div>
              {r.status === "rejected" && r.reviewComment && (
                <div style={{ ...styles.warn, marginTop: 6 }}><AlertCircle size={13} style={{ marginRight: 4 }} />却下理由：{r.reviewComment}</div>
              )}
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#1B4B6B" }}>¥{yen(r.totals.grand)}</div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                <button onClick={() => onDuplicate(r)} style={styles.smallBtn}><Copy size={13} style={{ marginRight: 4 }} />複製して新規作成</button>
                <button onClick={() => onDelete(r.id)} style={styles.iconBtn}><Trash2 size={14} /></button>
              </div>
            </div>
          </div>
          <table style={{ ...styles.table, marginTop: 10 }}>
            <thead><tr><th>出発</th><th>帰着</th><th>出張先</th><th>目的</th><th>日数</th><th>交通費</th><th>宿泊費</th><th>日当</th><th>小計</th></tr></thead>
            <tbody>
              {r.legs.map((l, i) => (
                <tr key={i}><td>{l.start}</td><td>{l.end}</td><td>{l.place}</td><td>{l.purpose}</td><td>{l.nights}</td><td>¥{yen(l.transport)}</td><td>¥{yen(l.lodging)}</td><td>¥{yen(l.perDiem)}</td><td>¥{yen(l.subtotal)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

/* ================= 管理者ページ ================= */
const REPORT_STATUS_LABEL = { pending: "申請中", approved: "承認済み", rejected: "却下" };
const REPORT_SUMMARY_HEADER = ["申請日時", "申請日", "氏名", "職責", "出張先", "出発日", "帰着日", "交通費", "宿泊費", "日当", "合計", "仮払額", "過不足額", "ステータス", "審査日時", "却下理由"];
const REPORT_DETAIL_HEADER = ["氏名", "職責", "ステータス", "出発日", "帰着日", "出張先", "目的", "日数", "交通費", "宿泊費", "日当", "小計"];

function tripRange(legs) {
  const starts = (legs || []).map((l) => l.start).filter(Boolean).sort();
  const ends = (legs || []).map((l) => l.end).filter(Boolean).sort();
  return { start: starts[0] || "", end: ends[ends.length - 1] || "" };
}

function reportSummaryRow(r) {
  const { start, end } = tripRange(r.legs);
  return [
    new Date(r.createdAt).toLocaleString("ja-JP"),
    r.applyDate,
    r.applicant,
    r.role,
    (r.legs || []).map((l) => l.place).join("、"),
    start, end,
    r.totals.transport, r.totals.lodging, r.totals.perDiem, r.totals.grand,
    r.advance, r.balance,
    REPORT_STATUS_LABEL[r.status || "pending"],
    r.reviewedAt ? new Date(r.reviewedAt).toLocaleString("ja-JP") : "",
    r.status === "rejected" ? (r.reviewComment || "") : "",
  ];
}

function exportReportsWorkbook(reports, flash, { fileTag = "エクスポート", splitByStatus = true } = {}) {
  if (!reports.length) { flash("エクスポートする申請がありません"); return; }
  const wb = XLSX.utils.book_new();
  const sorted = [...reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const addSummarySheet = (name, list) => {
    const aoa = [REPORT_SUMMARY_HEADER, ...list.map(reportSummaryRow)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 9 }, { wch: 18 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, name);
  };

  addSummarySheet("全件", sorted);
  if (splitByStatus) {
    addSummarySheet("申請中", sorted.filter((r) => (r.status || "pending") === "pending"));
    addSummarySheet("承認済み", sorted.filter((r) => r.status === "approved"));
    addSummarySheet("却下", sorted.filter((r) => r.status === "rejected"));
  }

  const detailAoa = [REPORT_DETAIL_HEADER];
  sorted.forEach((r) => {
    (r.legs || []).forEach((l) => {
      detailAoa.push([r.applicant, r.role, REPORT_STATUS_LABEL[r.status || "pending"], l.start, l.end, l.place, l.purpose, l.nights, l.transport, l.lodging, l.perDiem, l.subtotal]);
    });
  });
  const detailWs = XLSX.utils.aoa_to_sheet(detailAoa);
  detailWs["!cols"] = [{ wch: 14 }, { wch: 8 }, { wch: 9 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 7 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, detailWs, "区間別明細");

  XLSX.writeFile(wb, `出張旅費申請_${fileTag}_${todayISO()}.xlsx`);
  flash("Excelブックをダウンロードしました");
}

/* ---------- 罫線付き「出張旅費精算書」出力（本物のxlsxを自前生成） ----------
   SheetJS Community版はセルの罫線・塗りつぶし等のスタイル書き出しに対応していないため、
   ZIP（xlsx）とスタイル定義を自前で組み立てることで、罫線・見出し色付きの本物の.xlsxを出力します。 */
function xmlEscape(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function sanitizeSheetName(name, used) {
  let base = String(name || "Sheet").replace(/[\\/?*\[\]:]/g, "").trim().slice(0, 28) || "Sheet";
  let candidate = base;
  let i = 2;
  while (used.has(candidate)) { candidate = `${base}(${i})`; i++; }
  used.add(candidate);
  return candidate;
}

const BORDERED_COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
// スタイルインデックス（xl/styles.xmlのcellXfsに対応）
const XS = { plain: 0, textB: 1, numB: 2, title: 3, label: 4, header: 5, totalText: 6, totalNum: 7 };

function borderedStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><name val="Meiryo"/></font>
<font><b/><sz val="11"/><name val="Meiryo"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Meiryo"/></font>
<font><b/><sz val="16"/><name val="Meiryo"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1B4B6B"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="3" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function borderedCellXml(ref, value, isString, style) {
  const sAttr = style != null ? ` s="${style}"` : "";
  if (value === null || value === undefined || value === "") return `<c r="${ref}"${sAttr}/>`;
  if (isString) return `<c r="${ref}"${sAttr} t="str"><v>${xmlEscape(value)}</v></c>`;
  return `<c r="${ref}"${sAttr}><v>${value}</v></c>`;
}
function borderedRowXml(rowNum, cellDefs, merges) {
  const slots = {};
  cellDefs.forEach((cd) => {
    const span = cd.span || 1;
    const startIdx = BORDERED_COLS.indexOf(cd.col);
    if (span > 1) merges.push(`${cd.col}${rowNum}:${BORDERED_COLS[startIdx + span - 1]}${rowNum}`);
    for (let i = 0; i < span; i++) {
      const col = BORDERED_COLS[startIdx + i];
      slots[col] = i === 0 ? { value: cd.value, isString: cd.isString, style: cd.style } : { value: null, isString: false, style: cd.style };
    }
  });
  let out = "";
  BORDERED_COLS.forEach((col) => {
    const s = slots[col] || { value: null, isString: false, style: XS.plain };
    out += borderedCellXml(col + rowNum, s.value, s.isString, s.style);
  });
  return `<row r="${rowNum}">${out}</row>`;
}

function buildBorderedSheetXml(report) {
  const merges = [];
  const rowsXml = [];
  let r = 1;

  rowsXml.push(borderedRowXml(r, [
    { col: "A", value: "出張旅費清算書", isString: true, style: XS.title, span: 7 },
    { col: "H", value: `作成日: ${wareki(report.applyDate)}`, isString: true, style: XS.plain, span: 3 },
  ], merges)); r++;

  rowsXml.push(borderedRowXml(r, [
    { col: "A", value: "氏名", isString: true, style: XS.label },
    { col: "B", value: report.applicant, isString: true, style: XS.plain, span: 2 },
    { col: "D", value: "職責", isString: true, style: XS.label },
    { col: "E", value: report.role, isString: true, style: XS.plain, span: 2 },
    { col: "G", value: "仮払額", isString: true, style: XS.label },
    { col: "H", value: report.advance, isString: false, style: XS.numB, span: 2 },
    { col: "J", value: "円", isString: true, style: XS.plain },
  ], merges)); r++;

  const statusLabel = REPORT_STATUS_LABEL[report.status || "pending"];
  const reviewedAt = report.reviewedAt ? new Date(report.reviewedAt).toLocaleString("ja-JP") : "";
  const rejectReason = report.status === "rejected" ? (report.reviewComment || "") : "";
  rowsXml.push(borderedRowXml(r, [
    { col: "A", value: "ステータス", isString: true, style: XS.label },
    { col: "B", value: statusLabel, isString: true, style: XS.plain, span: 2 },
    { col: "D", value: "審査日時", isString: true, style: XS.label },
    { col: "E", value: reviewedAt, isString: true, style: XS.plain, span: 3 },
    { col: "H", value: "却下理由", isString: true, style: XS.label },
    { col: "I", value: rejectReason, isString: true, style: XS.plain, span: 2 },
  ], merges)); r++;

  const headers = ["月日(出発)", "月日(帰着)", "出張先", "区分", "目的", "日数", "交通費", "宿泊費", "日当", "小計"];
  rowsXml.push(borderedRowXml(r, headers.map((h, i) => ({ col: BORDERED_COLS[i], value: h, isString: true, style: XS.header })), merges)); r++;

  (report.legs || []).forEach((l) => {
    rowsXml.push(borderedRowXml(r, [
      { col: "A", value: l.start, isString: true, style: XS.textB },
      { col: "B", value: l.end, isString: true, style: XS.textB },
      { col: "C", value: l.place, isString: true, style: XS.textB },
      { col: "D", value: l.category, isString: true, style: XS.textB },
      { col: "E", value: l.purpose, isString: true, style: XS.textB },
      { col: "F", value: l.nights, isString: false, style: XS.numB },
      { col: "G", value: l.transport, isString: false, style: XS.numB },
      { col: "H", value: l.lodging, isString: false, style: XS.numB },
      { col: "I", value: l.perDiem, isString: false, style: XS.numB },
      { col: "J", value: l.subtotal, isString: false, style: XS.numB },
    ], merges)); r++;
  });

  rowsXml.push(borderedRowXml(r, [
    { col: "A", value: "合計", isString: true, style: XS.totalText, span: 6 },
    { col: "G", value: report.totals.transport, isString: false, style: XS.totalNum },
    { col: "H", value: report.totals.lodging, isString: false, style: XS.totalNum },
    { col: "I", value: report.totals.perDiem, isString: false, style: XS.totalNum },
    { col: "J", value: report.totals.grand, isString: false, style: XS.totalNum },
  ], merges)); r++;

  rowsXml.push(borderedRowXml(r, [
    { col: "A", value: "仮払額", isString: true, style: XS.textB, span: 9 },
    { col: "J", value: `${yen(report.advance)}円`, isString: true, style: XS.textB },
  ], merges)); r++;

  const balanceLabel = report.balance > 0 ? `不足 ${yen(report.balance)}円` : report.balance < 0 ? `過払 ${yen(-report.balance)}円` : "0円";
  rowsXml.push(borderedRowXml(r, [
    { col: "A", value: "過不足額", isString: true, style: XS.textB, span: 9 },
    { col: "J", value: balanceLabel, isString: true, style: XS.textB },
  ], merges)); r++;

  const lastRow = r - 1;
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  const colsXml = `<cols>${BORDERED_COLS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="14" customWidth="1"/>`).join("")}</cols>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:J${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
${colsXml}
<sheetData>${rowsXml.join("")}</sheetData>
${mergeXml}
</worksheet>`;
}

async function buildBorderedWorkbookBytes(sheets) {
  const encoder = new TextEncoder();
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const entries = [
    ["[Content_Types].xml", encoder.encode(contentTypes)],
    ["_rels/.rels", encoder.encode(rootRels)],
    ["xl/workbook.xml", encoder.encode(workbookXml)],
    ["xl/_rels/workbook.xml.rels", encoder.encode(workbookRels)],
    ["xl/styles.xml", encoder.encode(borderedStylesXml())],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, encoder.encode(s.xml)]),
  ];
  return await writeZip(entries);
}

async function exportBorderedReport(report, flash) {
  try {
    const sheetName = sanitizeSheetName(`${report.applicant}_${report.applyDate}`, new Set());
    const bytes = await buildBorderedWorkbookBytes([{ name: sheetName, xml: buildBorderedSheetXml(report) }]);
    downloadBinary(bytes, `出張旅費精算書_${report.applicant || "無記名"}_${report.applyDate || todayISO()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    flash("出張旅費精算書（罫線付き・xlsx）を出力しました");
  } catch (err) {
    console.error(err);
    flash(`出力に失敗しました：${err.message || err}`);
  }
}

async function exportBorderedReportsBulk(reports, flash, label = "対象") {
  if (!reports.length) { flash(`出力対象の申請がありません（${label}）`); return; }
  try {
    const used = new Set();
    const sheets = reports.map((r) => ({
      name: sanitizeSheetName(`${r.applicant || "無記名"}_${r.applyDate || ""}`, used),
      xml: buildBorderedSheetXml(r),
    }));
    const bytes = await buildBorderedWorkbookBytes(sheets);
    downloadBinary(bytes, `出張旅費精算書_一括_${label}_${todayISO()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    flash(`${reports.length}件の出張旅費精算書を1つのxlsxブック（シート分割）として出力しました`);
  } catch (err) {
    console.error(err);
    flash(`出力に失敗しました：${err.message || err}`);
  }
}

/* ============================================================
   テンプレートxlsxへの値差し込み（本物の.xlsxをテンプレートの書式のまま出力）
   ブラウザ内蔵のCompressionStream/DecompressionStream（deflate-raw）を使い、
   xlsx（=ZIP）を自前で読み書きすることで、SheetJS Community版では書き出せない
   罫線・フォント等の書式をテンプレートからそのまま維持します。
   ============================================================ */

const CRC_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function concatBytes(chunks) {
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
async function streamThrough(stream, bytes) {
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return concatBytes(chunks);
}
const deflateRaw = (bytes) => streamThrough(new CompressionStream("deflate-raw"), bytes);
const inflateRaw = (bytes) => streamThrough(new DecompressionStream("deflate-raw"), bytes);

async function readZipEntries(buf) {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("テンプレートファイルの形式を読み取れませんでした（zip終端が見つかりません）");
  const cdCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const dir = [];
  let p = cdOffset;
  for (let i = 0; i < cdCount; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("テンプレートのZIP構造が不正です");
    const method = view.getUint16(p + 10, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    dir.push({ name, method, compSize, uncompSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const result = {};
  for (const e of dir) {
    const lp = e.localHeaderOffset;
    if (view.getUint32(lp, true) !== 0x04034b50) throw new Error(`テンプレート内の ${e.name} を読み取れませんでした`);
    const lNameLen = view.getUint16(lp + 26, true);
    const lExtraLen = view.getUint16(lp + 28, true);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    const compData = bytes.subarray(dataStart, dataStart + e.compSize);
    result[e.name] = e.method === 8 ? await inflateRaw(compData) : e.method === 0 ? compData : (() => { throw new Error("未対応の圧縮方式です"); })();
  }
  return result;
}

async function writeZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name);
    const compData = await deflateRaw(data);
    const useStore = compData.length >= data.length;
    const method = useStore ? 0 : 8;
    const finalData = useStore ? data : compData;
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, finalData.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, finalData);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, finalData.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + finalData.length;
  }
  const centralStart = offset;
  const centralSize = centralParts.reduce((a, c) => a + c.length, 0);

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);

  return concatBytes([...localParts, ...centralParts, eocd]);
}

function bufToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function downloadBinary(bytes, filename, mime) {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* テンプレートの想定レイアウト（このアプリの「Excelでダウンロード」で出力される構成に準拠）
   1行目:タイトル/作成日　3行目:氏名/職責/仮払額　5行目:見出し　6行目〜:出張区間　
   その次の行に合計、その次に仮払額、その次に過不足額 */
const TEMPLATE_SHEET_PATH = "xl/worksheets/sheet1.xml";
const TEMPLATE_ROWS = { info: 3, header: 5, legStart: 6, origTotal: 8, origAdvance: 9, origBalance: 10 };

function xmlNewEl(doc, tag) { return doc.createElementNS(doc.documentElement.namespaceURI, tag); }
function findRow(sheetData, r) {
  return Array.from(sheetData.children).find((el) => el.tagName === "row" && el.getAttribute("r") === String(r)) || null;
}
function findCell(rowEl, colLetter) {
  if (!rowEl) return null;
  const rowNum = rowEl.getAttribute("r");
  return Array.from(rowEl.children).find((c) => c.getAttribute("r") === colLetter + rowNum) || null;
}
function setCellValue(cellEl, value, isString) {
  if (!cellEl) return;
  if (isString) cellEl.setAttribute("t", "str"); else cellEl.removeAttribute("t");
  const fEl = cellEl.getElementsByTagName("f")[0];
  if (fEl) cellEl.removeChild(fEl); // 数式が入っていた場合は静的な値に置き換える（アプリ側の計算値を優先）
  let vEl = cellEl.getElementsByTagName("v")[0];
  if (!vEl) { vEl = xmlNewEl(cellEl.ownerDocument, "v"); cellEl.appendChild(vEl); }
  vEl.textContent = String(value ?? "");
}
function cloneRowAs(rowEl, doc, newRowNum) {
  const clone = xmlNewEl(doc, "row");
  clone.setAttribute("r", String(newRowNum));
  Array.from(rowEl.attributes).forEach((a) => { if (a.name !== "r") clone.setAttribute(a.name, a.value); });
  Array.from(rowEl.children).forEach((c) => {
    const cc = c.cloneNode(true);
    const col = (c.getAttribute("r") || "").replace(/\d+$/, "");
    cc.setAttribute("r", col + newRowNum);
    clone.appendChild(cc);
  });
  return clone;
}

async function fillSimpleTemplateXlsx(templateBuf, report) {
  const files = await readZipEntries(templateBuf);
  if (!files[TEMPLATE_SHEET_PATH]) throw new Error("テンプレートに想定するシートが見つかりませんでした");
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const xmlStr = decoder.decode(files[TEMPLATE_SHEET_PATH]);
  const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("テンプレートのシートXMLを解析できませんでした");
  const sheetData = doc.getElementsByTagName("sheetData")[0];
  if (!sheetData) throw new Error("テンプレートのsheetDataが見つかりませんでした");

  const row1 = findRow(sheetData, 1);
  setCellValue(findCell(row1, "H"), `作成日: ${wareki(report.applyDate)}`, true);

  const infoRow = findRow(sheetData, TEMPLATE_ROWS.info);
  setCellValue(findCell(infoRow, "B"), report.applicant, true);
  setCellValue(findCell(infoRow, "D"), report.role, true);
  setCellValue(findCell(infoRow, "F"), report.advance, false);

  const legTemplateRow = findRow(sheetData, TEMPLATE_ROWS.legStart);
  const totalTemplateRow = findRow(sheetData, TEMPLATE_ROWS.origTotal);
  const advanceTemplateRow = findRow(sheetData, TEMPLATE_ROWS.origAdvance);
  const balanceTemplateRow = findRow(sheetData, TEMPLATE_ROWS.origBalance);
  if (!legTemplateRow || !totalTemplateRow || !advanceTemplateRow || !balanceTemplateRow) {
    throw new Error("テンプレートの行構成が想定と異なるため差し込めませんでした");
  }
  [legTemplateRow, totalTemplateRow, advanceTemplateRow, balanceTemplateRow].forEach((el) => sheetData.removeChild(el));

  const legs = report.legs && report.legs.length ? report.legs : [{ start: "", end: "", place: "", category: "", purpose: "", nights: 0, transport: 0, lodging: 0, perDiem: 0, subtotal: 0 }];
  legs.forEach((leg, idx) => {
    const rNum = TEMPLATE_ROWS.legStart + idx;
    const newRow = cloneRowAs(legTemplateRow, doc, rNum);
    setCellValue(findCell(newRow, "A"), leg.start, true);
    setCellValue(findCell(newRow, "B"), leg.end, true);
    setCellValue(findCell(newRow, "C"), leg.place, true);
    setCellValue(findCell(newRow, "D"), leg.category, true);
    setCellValue(findCell(newRow, "E"), leg.purpose, true);
    setCellValue(findCell(newRow, "F"), leg.nights, false);
    setCellValue(findCell(newRow, "G"), leg.transport, false);
    setCellValue(findCell(newRow, "H"), leg.lodging, false);
    setCellValue(findCell(newRow, "I"), leg.perDiem, false);
    setCellValue(findCell(newRow, "J"), leg.subtotal, false);
    sheetData.appendChild(newRow);
  });

  const totalRowNum = TEMPLATE_ROWS.legStart + legs.length + 1;
  const advanceRowNum = totalRowNum + 1;
  const balanceRowNum = totalRowNum + 2;

  const newTotalRow = cloneRowAs(totalTemplateRow, doc, totalRowNum);
  setCellValue(findCell(newTotalRow, "G"), report.totals.transport, false);
  setCellValue(findCell(newTotalRow, "H"), report.totals.lodging, false);
  setCellValue(findCell(newTotalRow, "I"), report.totals.perDiem, false);
  setCellValue(findCell(newTotalRow, "J"), report.totals.grand, false);
  sheetData.appendChild(newTotalRow);

  const newAdvanceRow = cloneRowAs(advanceTemplateRow, doc, advanceRowNum);
  setCellValue(findCell(newAdvanceRow, "B"), report.advance, false);
  sheetData.appendChild(newAdvanceRow);

  const newBalanceRow = cloneRowAs(balanceTemplateRow, doc, balanceRowNum);
  setCellValue(findCell(newBalanceRow, "B"), report.balance, false);
  sheetData.appendChild(newBalanceRow);

  const dim = doc.getElementsByTagName("dimension")[0];
  if (dim) dim.setAttribute("ref", `A1:J${balanceRowNum}`);

  const newXml = new XMLSerializer().serializeToString(doc);
  files[TEMPLATE_SHEET_PATH] = encoder.encode(newXml);

  const entries = Object.entries(files).sort((a, b) => (a[0] === "[Content_Types].xml" ? -1 : b[0] === "[Content_Types].xml" ? 1 : 0));
  return await writeZip(entries);
}

/* ============================================================
   ZZ-2形式テンプレート（「出張申請書」＋「出張旅費清算書」の2シート構成）への差し込み
   合計・過不足額などはテンプレート側のExcel数式（SUM等）をそのまま残し、
   入力セルにだけ値を書き込むことで、書式・数式を一切崩さずに反映します。
   ============================================================ */
const ZZ2_APP_SHEET = "出張申請書";
const ZZ2_SETTLE_SHEET = "出張旅費清算書";
const ZZ2_MAX_LEGS = 2; // 「出張旅費清算書」側は1区間につき出発・帰着の2ブロックを使うため最大2区間まで対応

function dateToExcelSerial(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00Z");
  const epoch = Date.UTC(1899, 11, 30);
  return Math.round((d.getTime() - epoch) / 86400000);
}
function isoMonth(isoDate) { return isoDate ? Number(isoDate.split("-")[1]) : ""; }
function isoDay(isoDate) { return isoDate ? Number(isoDate.split("-")[2]) : ""; }

function clearCellValue(cellEl) {
  if (!cellEl) return;
  cellEl.removeAttribute("t");
  const v = cellEl.getElementsByTagName("v")[0];
  if (v) cellEl.removeChild(v);
  const is = cellEl.getElementsByTagName("is")[0];
  if (is) cellEl.removeChild(is);
  const f = cellEl.getElementsByTagName("f")[0];
  if (f) cellEl.removeChild(f);
}
function setNum(cellEl, value) { setCellValue(cellEl, value === "" || value == null ? "" : value, false); if (value === "" || value == null) clearCellValue(cellEl); }
function setStr(cellEl, value) { if (!value) { clearCellValue(cellEl); return; } setCellValue(cellEl, value, true); }

async function getSheetPathMap(files) {
  const decoder = new TextDecoder();
  const wbXml = decoder.decode(files["xl/workbook.xml"]);
  const wbDoc = new DOMParser().parseFromString(wbXml, "application/xml");
  const sheetEls = Array.from(wbDoc.getElementsByTagName("sheet"));
  const relsXml = files["xl/_rels/workbook.xml.rels"] ? decoder.decode(files["xl/_rels/workbook.xml.rels"]) : "";
  const relsDoc = relsXml ? new DOMParser().parseFromString(relsXml, "application/xml") : null;
  const relMap = {};
  if (relsDoc) {
    Array.from(relsDoc.getElementsByTagName("Relationship")).forEach((r) => {
      relMap[r.getAttribute("Id")] = r.getAttribute("Target");
    });
  }
  const map = {};
  sheetEls.forEach((s) => {
    const name = s.getAttribute("name");
    const rId = s.getAttribute("r:id") || s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const target = relMap[rId];
    if (name && target) map[name] = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.?\//, "");
  });
  return map;
}

async function detectTemplateKind(files) {
  try {
    const sheetMap = await getSheetPathMap(files);
    if (sheetMap[ZZ2_APP_SHEET] && sheetMap[ZZ2_SETTLE_SHEET]) return "zz2";
  } catch (e) { /* fall through */ }
  if (files[TEMPLATE_SHEET_PATH]) return "simple";
  return null;
}

function zz2RoleCell(cells, role) {
  return cells[role] || null;
}

async function fillZZ2TemplateXlsx(templateBuf, report) {
  const files = await readZipEntries(templateBuf);
  const sheetMap = await getSheetPathMap(files);
  const appPath = sheetMap[ZZ2_APP_SHEET];
  const settlePath = sheetMap[ZZ2_SETTLE_SHEET];
  if (!appPath || !settlePath) throw new Error("テンプレートに「出張申請書」「出張旅費清算書」の両シートが見つかりませんでした");

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const legs = (report.legs && report.legs.length ? report.legs : []).slice(0, ZZ2_MAX_LEGS);
  const omitted = (report.legs || []).length - legs.length;
  const tripStart = legs.length ? legs.reduce((a, l) => (!a || l.start < a ? l.start : a), "") : "";
  const tripEnd = legs.length ? legs.reduce((a, l) => (!a || l.end > a ? l.end : a), "") : "";

  /* ---- 出張申請書 ---- */
  {
    const xmlStr = decoder.decode(files[appPath]);
    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("「出張申請書」シートのXMLを解析できませんでした");
    const sheetData = doc.getElementsByTagName("sheetData")[0];
    if (!sheetData) throw new Error("「出張申請書」シートのsheetDataが見つかりませんでした");

    const r4 = findRow(sheetData, 4), r5 = findRow(sheetData, 5), r6 = findRow(sheetData, 6), r7 = findRow(sheetData, 7);
    setNum(findCell(r4, "C"), isoMonth(report.applyDate) ? new Date(report.applyDate).getFullYear() : "");
    setNum(findCell(r4, "E"), isoMonth(report.applyDate));
    setNum(findCell(r4, "G"), isoDay(report.applyDate));
    setNum(findCell(r5, "C"), tripStart ? new Date(tripStart).getFullYear() : "");
    setNum(findCell(r5, "E"), isoMonth(tripStart));
    setNum(findCell(r5, "G"), isoDay(tripStart));
    setNum(findCell(r6, "C"), tripEnd ? new Date(tripEnd).getFullYear() : "");
    setNum(findCell(r6, "E"), isoMonth(tripEnd));
    setNum(findCell(r6, "G"), isoDay(tripEnd));
    setNum(findCell(r7, "C"), report.advance);

    const roleRowMap = { "役員": r5, "管理職": r6, "一般": r7 };
    ["役員", "管理職", "一般"].forEach((role) => {
      const cell = findCell(roleRowMap[role], "I");
      if (role === report.role) setStr(cell, "〇"); else clearCellValue(cell);
    });
    setStr(findCell(r5, "K"), report.applicant);

    const legBlockRows = [9, 15, 21, 27];
    legBlockRows.forEach((rowNum, idx) => {
      const rowEl = findRow(sheetData, rowNum);
      const leg = legs[idx];
      setStr(findCell(rowEl, "A"), leg ? leg.place : "");
      setStr(findCell(rowEl, "C"), leg ? leg.purpose : "");
    });

    const r34 = findRow(sheetData, 34);
    setNum(findCell(r34, "G"), report.totals.transport);
    setNum(findCell(r34, "J"), report.totals.lodging);
    setNum(findCell(r34, "L"), report.totals.perDiem);

    files[appPath] = encoder.encode(new XMLSerializer().serializeToString(doc));
  }

  /* ---- 出張旅費清算書 ---- */
  {
    const xmlStr = decoder.decode(files[settlePath]);
    const doc = new DOMParser().parseFromString(xmlStr, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("「出張旅費清算書」シートのXMLを解析できませんでした");
    const sheetData = doc.getElementsByTagName("sheetData")[0];
    if (!sheetData) throw new Error("「出張旅費清算書」シートのsheetDataが見つかりませんでした");

    const r2 = findRow(sheetData, 2);
    setNum(findCell(r2, "S"), report.applyDate ? new Date(report.applyDate).getFullYear() : "");
    setNum(findCell(r2, "U"), isoMonth(report.applyDate));
    setNum(findCell(r2, "W"), isoDay(report.applyDate));

    const r4 = findRow(sheetData, 4);
    const r5 = findRow(sheetData, 5);
    const r6 = findRow(sheetData, 6);
    setNum(findCell(r4, "J"), report.advance); // 仮払額
    setNum(findCell(r5, "D"), dateToExcelSerial(report.applyDate)); // 仮払年月日
    setNum(findCell(r5, "J"), report.totals.grand); // 過不足額の計算式(J4-J5)用ミラー
    setStr(findCell(r5, "O"), report.applicant);

    const roleRowMap = { "役員": r5, "管理職": r6, "一般": findRow(sheetData, 7) };
    ["役員", "管理職", "一般"].forEach((role) => {
      const cell = findCell(roleRowMap[role], "L");
      if (role === report.role) setStr(cell, "○"); else clearCellValue(cell);
    });

    const blockRows = [9, 15, 21, 27];
    const costRows = [13, 19, 25, 31];
    // 1区間につき「出発（データ入力）」「帰着（日付のみ）」の2ブロックを使用
    for (let pair = 0; pair < 2; pair++) {
      const leg = legs[pair];
      const depIdx = pair * 2, retIdx = pair * 2 + 1;
      const depRow = findRow(sheetData, blockRows[depIdx]);
      const retRow = findRow(sheetData, blockRows[retIdx]);
      const costRow = findRow(sheetData, costRows[depIdx]);
      if (leg) {
        setNum(findCell(depRow, "A"), isoMonth(leg.start));
        setNum(findCell(depRow, "C"), isoDay(leg.start));
        setStr(findCell(depRow, "D"), leg.place);
        setNum(findCell(costRow, "K"), leg.transport);
        setNum(findCell(costRow, "S"), leg.lodging);
        setNum(findCell(costRow, "U"), leg.perDiem);
        setNum(findCell(retRow, "A"), isoMonth(leg.end));
        setNum(findCell(retRow, "C"), isoDay(leg.end));
      } else {
        setNum(findCell(depRow, "A"), "");
        setNum(findCell(depRow, "C"), "");
        setStr(findCell(depRow, "D"), "");
        setNum(findCell(costRow, "K"), "");
        setNum(findCell(costRow, "S"), "");
        setNum(findCell(costRow, "U"), "");
        setNum(findCell(retRow, "A"), "");
        setNum(findCell(retRow, "C"), "");
      }
    }

    files[settlePath] = encoder.encode(new XMLSerializer().serializeToString(doc));
  }

  // 数式セル（合計・清算額・過不足額など）を書き換えずに残しているため、
  // Excelで開いた瞬間に必ず再計算されるようワークブック設定にフラグを立てる
  if (files["xl/workbook.xml"]) {
    let wbXml = decoder.decode(files["xl/workbook.xml"]);
    if (/<calcPr\b[^>]*fullCalcOnLoad=/.test(wbXml)) {
      wbXml = wbXml.replace(/fullCalcOnLoad="[^"]*"/, 'fullCalcOnLoad="true"');
    } else if (/<calcPr\b[^>]*\/>/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr\b/, '<calcPr fullCalcOnLoad="true"');
    } else if (/<\/workbook>/.test(wbXml)) {
      wbXml = wbXml.replace("</workbook>", '<calcPr fullCalcOnLoad="true"/></workbook>');
    }
    files["xl/workbook.xml"] = encoder.encode(wbXml);
  }

  const entries = Object.entries(files).sort((a, b) => (a[0] === "[Content_Types].xml" ? -1 : b[0] === "[Content_Types].xml" ? 1 : 0));
  const bytes = await writeZip(entries);
  return { bytes, omitted };
}

async function fillTemplateAuto(templateBuf, report) {
  const files = await readZipEntries(templateBuf);
  const kind = await detectTemplateKind(files);
  if (kind === "zz2") {
    const { bytes, omitted } = await fillZZ2TemplateXlsx(templateBuf, report);
    return { bytes, omitted, kind };
  }
  if (kind === "simple") {
    const bytes = await fillSimpleTemplateXlsx(templateBuf, report);
    return { bytes, omitted: 0, kind };
  }
  throw new Error("対応していないテンプレート形式です（「出張旅費清算書」単体、または「出張申請書」＋「出張旅費清算書」の2シート構成に対応）");
}

async function exportFromTemplate(report, template, flash) {
  try {
    const { bytes, omitted } = await fillTemplateAuto(base64ToBuf(template.base64), report);
    downloadBinary(bytes, `出張旅費精算書_${report.applicant || "無記名"}_${report.applyDate || todayISO()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    flash(omitted > 0 ? `出張旅費精算書を出力しました（テンプレートの制約により区間を${omitted}件省略しています）` : "テンプレートの書式のまま出張旅費精算書を出力しました");
  } catch (err) {
    console.error(err);
    flash(`テンプレートからの出力に失敗しました：${err.message || err}`);
  }
}

async function exportFromTemplateBulk(reports, template, flash, label = "対象") {
  if (!reports.length) { flash(`出力対象の申請がありません（${label}）`); return; }
  try {
    const used = new Set();
    const entries = [];
    let omittedTotal = 0;
    for (const r of reports) {
      const { bytes, omitted } = await fillTemplateAuto(base64ToBuf(template.base64), r);
      omittedTotal += omitted;
      const base = sanitizeSheetName(`${r.applicant || "無記名"}_${r.applyDate || ""}`, used);
      entries.push([`出張旅費精算書_${base}.xlsx`, bytes]);
    }
    const zipBytes = await writeZip(entries);
    downloadBinary(zipBytes, `出張旅費精算書_一括_${label}_${todayISO()}.zip`, "application/zip");
    flash(`${reports.length}件をテンプレートの書式のままxlsxで作成し、1つのZIPにまとめて出力しました${omittedTotal > 0 ? `（区間を合計${omittedTotal}件省略）` : ""}`);
  } catch (err) {
    console.error(err);
    flash(`一括出力に失敗しました：${err.message || err}`);
  }
}

/* ================= テンプレート管理 ================= */
function TemplateManager({ template, onChange, flash }) {
  const [busy, setBusy] = useState(false);

  const handleFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      flash("テンプレートは.xlsx形式のみ対応しています。.xlsの場合はExcelで「名前を付けて保存」からxlsx形式に変換してからアップロードしてください。");
      return;
    }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const testReport = {
        applicant: "検証用", role: "一般", applyDate: todayISO(), advance: 0,
        legs: [{ start: todayISO(), end: todayISO(), place: "検証", category: "国内", purpose: "検証", nights: 1, transport: 0, lodging: 0, perDiem: 0, subtotal: 0 }],
        totals: { transport: 0, lodging: 0, perDiem: 0, grand: 0 }, balance: 0,
      };
      const { kind } = await fillTemplateAuto(buf, testReport);
      onChange({ name: file.name, base64: bufToBase64(buf), uploadedAt: new Date().toISOString(), kind });
      flash(kind === "zz2" ? "テンプレートを登録しました（出張申請書＋出張旅費清算書の2シート構成）" : "テンプレートを登録しました");
    } catch (err) {
      console.error(err);
      flash(`このファイルはテンプレートとして使用できません：${err.message || err}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={styles.card}>
      <h2 style={styles.cardTitle}>テンプレート管理（書式を保ったままxlsx出力）</h2>
      <p style={styles.notice}>
        次の2種類のテンプレートに対応しています：①このアプリの「Excelでダウンロード」で出力した精算書をExcelで装飾したもの（1シート構成）、
        ②「出張申請書」「出張旅費清算書」の2シートで構成された社内様式（行の構成は変更しないでください）。
        いずれも<b>.xlsx形式</b>でアップロードしてください（.xlsは非対応。Excelで「名前を付けて保存」からxlsx形式に変換してください）。
      </p>
      {template ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          <div style={styles.notice}>
            現在のテンプレート：<b style={{ color: "#22262B" }}>{template.name}</b>
            {template.kind === "zz2" && <span> （出張申請書＋出張旅費清算書）</span>}
            　（登録：{new Date(template.uploadedAt).toLocaleString("ja-JP")}）
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ ...styles.smallBtn, cursor: "pointer" }}>
              <Upload size={13} style={{ marginRight: 4 }} />差し替え
              <input type="file" accept=".xlsx" onChange={handleFile} style={{ display: "none" }} />
            </label>
            <button onClick={() => onChange(null)} style={styles.iconBtn}><Trash2 size={13} /></button>
          </div>
        </div>
      ) : (
        <label style={{ ...styles.smallBtn, cursor: "pointer", marginTop: 10, width: "fit-content" }}>
          <Upload size={14} style={{ marginRight: 6 }} />{busy ? "検証中…" : "テンプレートをアップロード"}
          <input type="file" accept=".xlsx" onChange={handleFile} style={{ display: "none" }} disabled={busy} />
        </label>
      )}
    </section>
  );
}

/* ================= 管理者ページ：簡易パスワードゲート ================= */
const ADMIN_PASSWORD = "0507";

function AdminGate({ onUnlock }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  const submit = () => {
    if (input === ADMIN_PASSWORD) {
      onUnlock();
    } else {
      setError(true);
    }
  };

  return (
    <section style={{ ...styles.card, maxWidth: 360, margin: "40px auto" }}>
      <h2 style={styles.cardTitle}>管理者ページ（要パスワード）</h2>
      <div style={styles.formRow}>
        <label style={styles.label}>パスワード</label>
        <input
          type="password"
          style={styles.input}
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(false); }}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          autoFocus
        />
        {error && <div style={{ ...styles.warn, marginTop: 6 }}><AlertCircle size={13} style={{ marginRight: 4 }} />パスワードが違います</div>}
      </div>
      <button onClick={submit} style={{ ...styles.primaryBtn, marginTop: 6 }}>入室する</button>
    </section>
  );
}

/* ================= 通知設定（Teamsメンション先） ================= */
function NotificationSettingsEditor({ settings, onChange, flash }) {
  const [email, setEmail] = useState(settings?.teamsMentionEmail || "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await onChange({ teamsMentionEmail: email.trim() });
      flash("通知設定を保存しました");
    } catch (err) {
      flash(`保存に失敗しました：${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section style={{ ...styles.card, marginTop: 16 }}>
      <h2 style={{ ...styles.cardTitle, marginBottom: 4 }}>通知設定</h2>
      <p style={styles.notice}>
        申請が送信された際にTeamsへ自動投稿する仕組み（Supabase Database Webhook →
        Power Automate → Teams）を設定する場合、ここで指定したメールアドレス（Teamsの
        ユーザープリンシパル名）宛にメンションされます。Power Automateフロー側の設定は別途必要です。
      </p>
      <div style={styles.formRow}>
        <label style={styles.label}>メンション先メールアドレス</label>
        <input
          type="email"
          style={styles.input}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="例）yasuda@example.com"
        />
      </div>
      <button onClick={save} disabled={saving} style={{ ...styles.primaryBtn, width: "auto", padding: "9px 18px", opacity: saving ? 0.6 : 1 }}>
        {saving ? "保存中…" : "保存"}
      </button>
    </section>
  );
}

function AdminPanel({ reports, onUpdate, flash, template, onTemplateChange, onNavigate, notificationSettings, onNotificationSettingsChange }) {
  const [filter, setFilter] = useState("pending");
  const [expandedId, setExpandedId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectDraft, setRejectDraft] = useState("");

  const counts = useMemo(() => ({
    all: reports.length,
    pending: reports.filter((r) => (r.status || "pending") === "pending").length,
    approved: reports.filter((r) => r.status === "approved").length,
    rejected: reports.filter((r) => r.status === "rejected").length,
  }), [reports]);

  const filtered = useMemo(() => {
    const list = filter === "all" ? reports : reports.filter((r) => (r.status || "pending") === filter);
    return [...list].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [reports, filter]);

  const approve = (r) => {
    onUpdate(r.id, { status: "approved", reviewedAt: new Date().toISOString(), reviewComment: "" });
    flash(`${r.applicant} さんの申請を承認しました`);
  };
  const startReject = (r) => { setRejectingId(r.id); setRejectDraft(""); };
  const confirmReject = (r) => {
    onUpdate(r.id, { status: "rejected", reviewedAt: new Date().toISOString(), reviewComment: rejectDraft.trim() });
    flash(`${r.applicant} さんの申請を却下しました`);
    setRejectingId(null);
    setRejectDraft("");
  };
  const resetToPending = (r) => {
    onUpdate(r.id, { status: "pending", reviewedAt: null, reviewComment: "" });
    flash("申請中に戻しました");
  };

  const exportWorkbook = () => exportReportsWorkbook(reports, flash, { fileTag: "エクスポート", splitByStatus: true });

  const filters = [
    { id: "pending", label: "申請中" },
    { id: "approved", label: "承認済み" },
    { id: "rejected", label: "却下" },
    { id: "all", label: "すべて" },
  ];

  return (
    <div>
      <section style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div>
            <h2 style={{ ...styles.cardTitle, marginBottom: 4 }}>管理者ページ</h2>
            <p style={styles.notice}>すべての出張旅費申請を確認し、承認・却下できます。</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 6 }}>
              {filters.map((f) => (
                <button key={f.id} onClick={() => setFilter(f.id)} style={{ ...styles.smallBtn, ...(filter === f.id ? { background: "#1B4B6B", color: "#fff", borderColor: "#1B4B6B" } : {}) }}>
                  {f.label}（{counts[f.id]}）
                </button>
              ))}
            </div>
            <button onClick={exportWorkbook} style={{ ...styles.primaryBtn, width: "auto", padding: "8px 16px" }}>
              <Download size={14} style={{ marginRight: 6 }} />Excelで一括エクスポート
            </button>
            <button
              onClick={() => exportBorderedReportsBulk(filtered, flash, filters.find((f) => f.id === filter)?.label || "全件")}
              style={{ ...styles.secondaryBtn, width: "auto", padding: "8px 16px" }}
            >
              <FileSpreadsheet size={14} style={{ marginRight: 6 }} />出張旅費精算書作成（一括）
            </button>
          </div>
        </div>
        <p style={styles.hint}>「全件」「申請中」「承認済み」「却下」「区間別明細」の5シートを1つのExcelブックとして出力します（表計算向け）。</p>
        <p style={styles.hint}>「出張旅費精算書作成（一括）」は、現在の絞り込み表示（{filters.find((f) => f.id === filter)?.label}）に含まれる申請を、罫線付きの精算書として1つのExcelブックにシート分けして出力します。</p>
        {template && (
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => exportFromTemplateBulk(filtered, template, flash, filters.find((f) => f.id === filter)?.label || "全件")}
              style={{ ...styles.secondaryBtn, width: "auto", padding: "8px 16px" }}
            >
              <FileSpreadsheet size={14} style={{ marginRight: 6 }} />テンプレートから一括作成（xlsx / zip）
            </button>
            <p style={styles.hint}>アップロード済みのテンプレート（{template.name}）の書式のまま、対象申請ごとに本物のxlsxを作成し、1つのZIPにまとめます。</p>
          </div>
        )}
      </section>

      <section style={{ ...styles.card, marginTop: 16 }}>
        <h2 style={{ ...styles.cardTitle, marginBottom: 10 }}>マスタ管理</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => onNavigate("dest")} style={styles.smallBtn}><MapPin size={13} style={{ marginRight: 4 }} />出張先マスタを編集</button>
          <button onClick={() => onNavigate("transport")} style={styles.smallBtn}><History size={13} style={{ marginRight: 4 }} />交通費マスタを編集</button>
          <button onClick={() => onNavigate("rules")} style={styles.smallBtn}><History size={13} style={{ marginRight: 4 }} />宿泊費・日当マスタを編集</button>
        </div>
      </section>

      <NotificationSettingsEditor settings={notificationSettings} onChange={onNotificationSettingsChange} flash={flash} />

      {/* テンプレート管理UIは非表示（機能自体は保持。再度使う場合はこのコメントを外す） */}
      {/* <TemplateManager template={template} onChange={onTemplateChange} flash={flash} /> */}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
        {filtered.length === 0 && (
          <section style={styles.card}><p style={styles.notice}>該当する申請はありません。</p></section>
        )}
        {filtered.map((r) => {
          const expanded = expandedId === r.id;
          const status = r.status || "pending";
          return (
            <section key={r.id} style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", cursor: "pointer" }} onClick={() => setExpandedId(expanded ? null : r.id)}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                    <h2 style={{ ...styles.cardTitle, margin: 0 }}>{r.applicant}（{r.role}）</h2>
                    <StatusBadge status={status} />
                  </div>
                  <div style={styles.notice}>
                    申請日：{wareki(r.applyDate)}　/　出張先：{r.legs.map((l) => l.place).join("、")}　/　申請日時：{new Date(r.createdAt).toLocaleString("ja-JP")}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1B4B6B" }}>¥{yen(r.totals.grand)}</div>
                  {expanded ? <ChevronUp size={16} color="#8993A1" /> : <ChevronDown size={16} color="#8993A1" />}
                </div>
              </div>

              {expanded && (
                <div style={{ marginTop: 14, borderTop: "1px solid #EDEFF2", paddingTop: 14 }}>
                  <table style={styles.table}>
                    <thead><tr><th>出発</th><th>帰着</th><th>出張先</th><th>目的</th><th>日数</th><th>交通費</th><th>宿泊費</th><th>日当</th><th>小計</th></tr></thead>
                    <tbody>
                      {r.legs.map((l, i) => (
                        <tr key={i}><td>{l.start}</td><td>{l.end}</td><td>{l.place}</td><td>{l.purpose}</td><td>{l.nights}</td><td>¥{yen(l.transport)}</td><td>¥{yen(l.lodging)}</td><td>¥{yen(l.perDiem)}</td><td>¥{yen(l.subtotal)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12.5, color: "#5B6472" }}>
                    <span>仮払額：¥{yen(r.advance)}</span>
                    <span>過不足額：{r.balance > 0 ? `不足 ¥${yen(r.balance)}` : r.balance < 0 ? `過払 ¥${yen(-r.balance)}` : "¥0"}</span>
                  </div>

                  {status === "rejected" && r.reviewComment && (
                    <div style={{ ...styles.warn, marginTop: 10 }}><AlertCircle size={13} style={{ marginRight: 4 }} />却下理由：{r.reviewComment}</div>
                  )}
                  {r.reviewedAt && (
                    <div style={styles.hint}>審査日時：{new Date(r.reviewedAt).toLocaleString("ja-JP")}</div>
                  )}

                  {rejectingId === r.id ? (
                    <div style={{ marginTop: 12, background: "#FAFBFC", border: "1px solid #E7EAEF", borderRadius: 10, padding: 12 }}>
                      <label style={styles.label}>却下理由（任意）</label>
                      <textarea
                        style={{ ...styles.input, minHeight: 60, resize: "vertical" }}
                        value={rejectDraft}
                        onChange={(e) => setRejectDraft(e.target.value)}
                        placeholder="例）領収書を添付のうえ再申請してください"
                      />
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button onClick={() => confirmReject(r)} style={{ ...styles.primaryBtn, width: "auto", padding: "8px 16px", background: "#B4472B" }}>却下を確定</button>
                        <button onClick={() => setRejectingId(null)} style={{ ...styles.secondaryBtn, width: "auto", padding: "8px 16px" }}>キャンセル</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      {status !== "approved" && (
                        <button onClick={() => approve(r)} style={{ ...styles.primaryBtn, width: "auto", padding: "9px 16px", background: "#2F6B4F" }}>
                          <CheckCircle2 size={15} style={{ marginRight: 6 }} />承認する
                        </button>
                      )}
                      {status !== "rejected" && (
                        <button onClick={() => startReject(r)} style={{ ...styles.secondaryBtn, width: "auto", padding: "9px 16px", color: "#B4472B", borderColor: "#B4472B" }}>
                          <XCircle size={15} style={{ marginRight: 6 }} />却下する
                        </button>
                      )}
                      {status !== "pending" && (
                        <button onClick={() => resetToPending(r)} style={{ ...styles.smallBtn }}>申請中に戻す</button>
                      )}
                      <button onClick={() => exportBorderedReport(r, flash)} style={{ ...styles.smallBtn, marginLeft: "auto" }}>
                        <FileSpreadsheet size={13} style={{ marginRight: 4 }} />出張旅費精算書作成
                      </button>
                      {template && (
                        <button onClick={() => exportFromTemplate(r, template, flash)} style={styles.smallBtn}>
                          <FileSpreadsheet size={13} style={{ marginRight: 4 }} />テンプレートから作成（xlsx）
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ================= スタイル ================= */
const styles = {
  loadingWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: 320, color: "#5B6472", fontSize: 14, fontFamily: "'Hiragino Kaku Gothic ProN','Noto Sans JP',sans-serif" },
  app: { fontFamily: "'Hiragino Kaku Gothic ProN','Noto Sans JP',-apple-system,BlinkMacSystemFont,sans-serif", background: "#F3F5F8", minHeight: "100%", color: "#22262B" },
  header: { background: "#12283B", position: "sticky", top: 0, zIndex: 10 },
  headerInner: { maxWidth: 1180, margin: "0 auto", padding: "14px 20px", display: "flex", flexDirection: "column", gap: 12 },
  brand: { display: "flex", alignItems: "center", gap: 12 },
  brandMark: { width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#2E6E8E,#1B4B6B)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, letterSpacing: 1 },
  brandTitle: { color: "#fff", fontSize: 17, fontWeight: 800, letterSpacing: 0.3 },
  brandSub: { color: "#9FB3C4", fontSize: 11.5, marginTop: 1 },
  nav: { display: "flex", gap: 6, flexWrap: "wrap" },
  navBtn: { display: "flex", alignItems: "center", background: "transparent", border: "1px solid transparent", color: "#C7D5E0", padding: "7px 12px", borderRadius: 8, fontSize: 12.5, cursor: "pointer", fontWeight: 600 },
  navBtnActive: { background: "#1B4B6B", color: "#fff", border: "1px solid #2E6E8E" },
  main: { maxWidth: 1180, margin: "0 auto", padding: "24px 20px 60px" },
  grid2: { display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 20 },
  card: { background: "#fff", border: "1px solid #E3E7EC", borderRadius: 14, padding: "20px 22px", boxShadow: "0 1px 2px rgba(20,30,45,0.04)" },
  cardTitle: { fontSize: 15, fontWeight: 800, marginBottom: 14, color: "#12283B" },
  formRow: { marginBottom: 14 },
  formRow2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  label: { display: "block", fontSize: 12, fontWeight: 700, color: "#5B6472", marginBottom: 5 },
  input: { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px solid #D6DBE2", fontSize: 13.5, fontFamily: "inherit", color: "#22262B", boxSizing: "border-box", background: "#FBFCFD" },
  readonlyField: { width: "100%", padding: "9px 11px", borderRadius: 8, border: "1px dashed #D6DBE2", fontSize: 13.5, color: "#5B6472", boxSizing: "border-box", background: "#F2F4F7", fontWeight: 700 },
  blinkAttention: { border: "2.5px solid #E53935", boxShadow: "0 0 0 2px rgba(229,57,53,0.25)", animation: "dateBlink 1s ease-in-out infinite" },
  radioLabel: { fontSize: 13, display: "flex", alignItems: "center", gap: 5, color: "#3B4149" },
  smallBtn: { display: "flex", alignItems: "center", background: "#EEF3F7", border: "1px solid #D6E0E8", color: "#1B4B6B", padding: "7px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: "pointer" },
  iconBtn: { background: "#FBEEEB", border: "1px solid #F1D3CB", color: "#B4472B", padding: "6px 8px", borderRadius: 7, cursor: "pointer", display: "flex" },
  legCard: { border: "1px solid #E7EAEF", borderRadius: 12, padding: 16, marginTop: 14, background: "#FAFBFC" },
  legHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  legIndex: { fontSize: 11, fontWeight: 800, color: "#8993A1", letterSpacing: 0.5 },
  legSummary: { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10, marginTop: 12, padding: "12px 4px 2px", borderTop: "1px dashed #E0E4EA" },
  summaryItem: { display: "flex", flexDirection: "column", gap: 2 },
  summaryLabel: { fontSize: 10.5, color: "#8993A1", fontWeight: 700 },
  summarySub: { fontSize: 10, color: "#A5ADB8" },
  warn: { gridColumn: "1 / -1", display: "flex", alignItems: "center", fontSize: 11.5, color: "#B4472B", marginTop: 4 },
  hint: { fontSize: 12, color: "#8993A1", marginTop: 10 },
  previewRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", fontSize: 13.5, color: "#3B4149" },
  primaryBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", background: "#1B4B6B", color: "#fff", border: "none", padding: "11px 14px", borderRadius: 9, fontSize: 13.5, fontWeight: 800, cursor: "pointer" },
  secondaryBtn: { display: "flex", alignItems: "center", justifyContent: "center", width: "100%", background: "#fff", color: "#1B4B6B", border: "1.5px solid #1B4B6B", padding: "10px 14px", borderRadius: 9, fontSize: 13.5, fontWeight: 800, cursor: "pointer" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 4 },
  notice: { fontSize: 12, color: "#8993A1", marginBottom: 4 },
  toast: { position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: "#12283B", color: "#fff", padding: "10px 18px", borderRadius: 10, fontSize: 13, fontWeight: 600, boxShadow: "0 6px 18px rgba(0,0,0,0.2)" },
  modalOverlay: { position: "fixed", inset: 0, background: "rgba(18,40,59,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 },
  modalCard: { background: "#fff", borderRadius: 16, padding: "28px 26px", width: "100%", maxWidth: 380, textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" },
  modalIcon: { width: 46, height: 46, borderRadius: "50%", background: "#E3F1E9", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" },
  modalTitle: { fontSize: 16, fontWeight: 800, color: "#12283B", margin: "0 0 10px" },
  modalBody: { fontSize: 13, color: "#5B6472", lineHeight: 1.6, margin: 0 },
  modalTotal: { marginTop: 14, fontSize: 15, fontWeight: 800, color: "#1B4B6B" },
};

function GlobalStyle() {
  return (
    <style>{`
      table th, table td { border-bottom: 1px solid #EDEFF2; padding: 8px 10px; text-align: left; white-space: nowrap; }
      table th { color: #8993A1; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; }
      table tbody tr:hover { background: #F7F9FB; }
      @media (max-width: 860px) {
        div[style*="grid-template-columns: 1.5fr 1fr"] { grid-template-columns: 1fr !important; }
      }
      @keyframes dateBlink {
        0%, 100% { border-color: #E53935; box-shadow: 0 0 0 2px rgba(229,57,53,0.25); }
        50% { border-color: #8B0000; box-shadow: 0 0 0 0 rgba(229,57,53,0); }
      }
    `}</style>
  );
}
