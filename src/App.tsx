import { useMemo, useState } from "react";
import "./styles.css";
import type { Eye } from "./types";
import { useDB } from "./store/useDB";
import { submitCase } from "./store/db";
import { DevicePanel } from "./components/DevicePanel";
import { CaseCard } from "./components/CaseCard";
import { ReadingGrid } from "./components/ReadingGrid";

type FilterKey = "all" | "in_review" | "approved" | "prescribed";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "in_review", label: "待复核" },
  { key: "approved", label: "可出方" },
  { key: "prescribed", label: "已出方锁定" },
];

function NewCasePanel({ devices }: { devices: ReturnType<typeof useDB>["devices"] }) {
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [eye, setEye] = useState<Eye>("OD");
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>三次测量 · 质控判定</p>
          <h2>验光录入</h2>
        </div>
        <span className="rule-tag">轴位跨度 &gt; 5° 或校准到期 → 待复核，不能出方</span>
      </div>

      <div className="patient-row">
        <label>
          <span>患者编号</span>
          <input value={patientId} placeholder="如 Patient-201" onChange={(e) => setPatientId(e.target.value)} />
        </label>
        <label>
          <span>患者姓名</span>
          <input value={patientName} placeholder="选填" onChange={(e) => setPatientName(e.target.value)} />
        </label>
        <label className="eye-field">
          <span>眼别</span>
          <div className="eye-toggle">
            {(["OD", "OS"] as Eye[]).map((e) => (
              <button
                key={e}
                type="button"
                className={eye === e ? "active" : ""}
                onClick={() => setEye(e)}
              >
                {e === "OD" ? "右眼 OD" : "左眼 OS"}
              </button>
            ))}
          </div>
        </label>
      </div>

      <ReadingGrid
        devices={devices}
        submitLabel="录入并质控判定"
        onSubmit={({ deviceId, readings }) => {
          if (!patientId.trim()) {
            setError("请填写患者编号");
            return;
          }
          setError(null);
          submitCase({ patientId, patientName, eye, deviceId, readings });
          setPatientId("");
          setPatientName("");
        }}
      />
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function App() {
  const db = useDB();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [keyword, setKeyword] = useState("");

  const metrics = useMemo(() => {
    const inReview = db.cases.filter((c) => c.status === "in_review").length;
    const approved = db.cases.filter((c) => c.status === "approved").length;
    const prescribed = db.cases.filter((c) => c.status === "prescribed").length;
    const expiredDevices = db.devices.filter(
      (d) => d.calibrationExpiry <= new Date().toISOString().slice(0, 10)
    ).length;
    return [
      { label: "待复核档案", value: String(inReview), cls: "status-danger" },
      { label: "可出方", value: String(approved), cls: "status-watch" },
      { label: "已锁定处方", value: String(prescribed), cls: "status-ok" },
      { label: "设备到期/过期", value: String(expiredDevices), cls: expiredDevices ? "status-danger" : "status-ok" },
    ];
  }, [db]);

  const cases = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return db.cases
      .filter((c) => (filter === "all" ? true : c.status === filter))
      .filter((c) =>
        kw
          ? c.patientId.toLowerCase().includes(kw) ||
            c.patientName.toLowerCase().includes(kw) ||
            c.id.toLowerCase().includes(kw)
          : true
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [db, filter, keyword]);

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · 验光质控工作台</p>
          <h1>验光记录 × 设备校准质控</h1>
          <p className="subtitle">
            按患者与眼别录入三次球镜、柱镜、轴位及设备编号。仪器校准到期或三次轴位跨度超过
            5° 时先存待复核，续期并重测后方可复核出方；原读数与失败原因全程保留，出方值锁定，改动另开版本。数据保存在本机，关闭再打开仍可查询。
          </p>
        </div>
        <div className="stack-card">
          <span>质控流转</span>
          <strong>录入判定 → 待复核 → 续期重测 → 复核 → 出方锁定 → 另开版本</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article key={m.label} className="metric-card">
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.cls} />
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <DevicePanel devices={db.devices} />
        </aside>
        <NewCasePanel devices={db.devices} />
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>本机档案（localStorage 持久化）</p>
            <h2>验光档案</h2>
          </div>
          <input
            className="search-box"
            placeholder="搜索患者编号 / 姓名 / 档案号"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className="chips muted filter-chips">
          {FILTERS.map((f) => (
            <button key={f.key} className={filter === f.key ? "active" : ""} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="record-list">
          {cases.map((c) => (
            <CaseCard key={c.id} examCase={c} devices={db.devices} />
          ))}
          {cases.length === 0 && <p className="empty-hint">没有符合条件的档案</p>}
        </div>
      </section>
    </main>
  );
}

export default App;
