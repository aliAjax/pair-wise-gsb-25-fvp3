import { useMemo, useState } from "react";
import "./styles.css";
import { axisSpan, finalizeReadings, isCalibrationExpired, judgeEntry, todayStr, AXIS_SPAN_LIMIT } from "./qc/judge";
import { useQcStore, type EntryInput } from "./qc/store";
import type { Device, ExamRecord, EyeSide, Reading } from "./qc/types";
import { EYE_LABEL, STATUS_LABEL } from "./qc/types";

const emptyReading = (): Reading => ({ sphere: 0, cylinder: 0, axis: 0 });

function fmtD(v: number): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

function readingText(r: Reading): string {
  return `${fmtD(r.sphere)}DS / ${fmtD(r.cylinder)}DC × ${r.axis}°`;
}

/* ---------- 三次读数录入行 ---------- */
function ReadingRows({
  value,
  onChange,
}: {
  value: [Reading, Reading, Reading];
  onChange: (next: [Reading, Reading, Reading]) => void;
}) {
  return (
    <div className="reading-rows">
      <div className="reading-head">
        <span />
        <span>球镜 DS</span>
        <span>柱镜 DC</span>
        <span>轴位 °</span>
      </div>
      {value.map((reading, i) => (
        <div className="reading-row" key={i}>
          <span className="reading-no">第{i + 1}次</span>
          {(["sphere", "cylinder", "axis"] as const).map((key) => (
            <input
              key={key}
              type="number"
              step={key === "axis" ? 1 : 0.25}
              min={key === "axis" ? 0 : undefined}
              max={key === "axis" ? 180 : undefined}
              value={reading[key]}
              onChange={(e) => {
                const num = Number(e.target.value);
                const next = value.map((r, j) =>
                  j === i ? { ...r, [key]: Number.isFinite(num) ? num : 0 } : r
                ) as [Reading, Reading, Reading];
                onChange(next);
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ---------- 设备校准台账 ---------- */
function DevicePanel({
  devices,
  onRenew,
}: {
  devices: Device[];
  onRenew: (id: string, until: string) => void;
}) {
  const today = todayStr();
  const [renewing, setRenewing] = useState<string | null>(null);
  const [date, setDate] = useState("");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>设备状态</p>
          <h2>校准台账</h2>
        </div>
      </div>
      <div className="device-list">
        {devices.map((d) => {
          const expired = isCalibrationExpired(d, today);
          return (
            <article key={d.id} className={`device-card ${expired ? "device-expired" : ""}`}>
              <div>
                <h3>{d.name}</h3>
                <p>
                  {d.id} · 校准至 {d.calibrateUntil || "无记录"}
                  <em className={expired ? "tag tag-danger" : "tag tag-ok"}>
                    {expired ? "已过期" : "有效"}
                  </em>
                </p>
              </div>
              {renewing === d.id ? (
                <div className="renew-row">
                  <input
                    type="date"
                    value={date}
                    min={today}
                    onChange={(e) => setDate(e.target.value)}
                  />
                  <button
                    className="primary-action"
                    disabled={!date}
                    onClick={() => {
                      onRenew(d.id, date);
                      setRenewing(null);
                      setDate("");
                    }}
                  >
                    确认续期
                  </button>
                  <button onClick={() => setRenewing(null)}>取消</button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setRenewing(d.id);
                    setDate("");
                  }}
                >
                  校准续期
                </button>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- 患者档案 ---------- */
function PatientPanel({
  patients,
  onAdd,
}: {
  patients: { id: string; name: string; ageGroup: string; note: string }[];
  onAdd: (name: string, ageGroup: string, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ageGroup, setAgeGroup] = useState("成人");
  const [note, setNote] = useState("");

  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>档案</p>
          <h2>患者档案</h2>
        </div>
        <button onClick={() => setOpen((v) => !v)}>{open ? "收起" : "新建档案"}</button>
      </div>
      {open && (
        <div className="patient-form">
          <label>
            <span>姓名 / 编号</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如 Patient-155" />
          </label>
          <label>
            <span>分组</span>
            <select value={ageGroup} onChange={(e) => setAgeGroup(e.target.value)}>
              <option>儿童</option>
              <option>成人</option>
              <option>渐进片</option>
              <option>角膜塑形镜</option>
            </select>
          </label>
          <label>
            <span>备注</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="随访重点" />
          </label>
          <button
            className="primary-action"
            onClick={() => {
              onAdd(name.trim(), ageGroup, note.trim());
              setName("");
              setNote("");
              setOpen(false);
            }}
          >
            保存档案
          </button>
        </div>
      )}
      <div className="chips">
        {patients.map((p) => (
          <span key={p.id} title={p.note}>
            {p.name} · {p.ageGroup}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ---------- 验光录入（含实时判定预览） ---------- */
function EntryForm({
  patients,
  devices,
  defaultEye,
  defaultDeviceId,
  defaultReadings,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  patients: { id: string; name: string }[];
  devices: Device[];
  defaultEye: EyeSide;
  defaultDeviceId: string;
  defaultReadings: [Reading, Reading, Reading];
  submitLabel: string;
  onSubmit: (input: EntryInput) => void;
  onCancel?: () => void;
}) {
  const [patientId, setPatientId] = useState(patients[0]?.id ?? "");
  const [eye, setEye] = useState<EyeSide>(defaultEye);
  const [deviceId, setDeviceId] = useState(defaultDeviceId);
  const [readings, setReadings] = useState<[Reading, Reading, Reading]>(defaultReadings);
  const [error, setError] = useState("");

  const device = devices.find((d) => d.id === deviceId);
  const previewReasons = useMemo(() => judgeEntry(device, readings), [device, readings]);
  const span = axisSpan(readings.map((r) => r.axis));

  const handleSubmit = () => {
    if (!patientId) {
      setError("请先选择患者档案");
      return;
    }
    if (!deviceId) {
      setError("请选择验光设备");
      return;
    }
    const invalid = readings.some(
      (r) =>
        !Number.isFinite(r.sphere) ||
        !Number.isFinite(r.cylinder) ||
        !Number.isFinite(r.axis) ||
        r.axis < 0 ||
        r.axis > 180
    );
    if (invalid) {
      setError("读数不完整：轴位需在 0–180° 之间");
      return;
    }
    setError("");
    onSubmit({ patientId, eye, deviceId, readings });
  };

  return (
    <div className="entry-form">
      <div className="field-grid">
        <label>
          <span>患者</span>
          <select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>眼别</span>
          <select value={eye} onChange={(e) => setEye(e.target.value as EyeSide)}>
            <option value="OD">右眼 OD</option>
            <option value="OS">左眼 OS</option>
          </select>
        </label>
        <label>
          <span>验光设备</span>
          <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}（校准至 {d.calibrateUntil || "无记录"}）
              </option>
            ))}
          </select>
        </label>
      </div>

      <ReadingRows value={readings} onChange={setReadings} />

      <div className={`judge-preview ${previewReasons.length ? "judge-block" : "judge-pass"}`}>
        {previewReasons.length ? (
          <>
            <strong>质控拦截：仅保存为待复核，不能出方</strong>
            <ul>
              {previewReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        ) : (
          <strong>判定通过：提交后直接出方（轴位跨度 {span}° ≤ {AXIS_SPAN_LIMIT}°）</strong>
        )}
      </div>

      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button className="primary-action" onClick={handleSubmit}>
          {submitLabel}
        </button>
        {onCancel && <button onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}

/* ---------- 版本历史（原读数与失败原因保留） ---------- */
function VersionHistory({ record }: { record: ExamRecord }) {
  return (
    <details className="version-history">
      <summary>版本历史（{record.versions.length}）</summary>
      {record.versions.map((v) => (
        <div key={v.id} className="version-item">
          <header>
            <strong>V{v.versionNo}</strong>
            <span>{new Date(v.createdAt).toLocaleString()}</span>
            {v.id === record.currentVersionId && <em className="tag tag-ok">当前</em>}
          </header>
          <p>设备 {v.deviceId} · {v.readings.map(readingText).join("；")}</p>
          {v.failReasons.length > 0 && (
            <ul className="fail-list">
              {v.failReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {v.reviewNote && <p className="review-note">复核：{v.reviewNote}</p>}
        </div>
      ))}
    </details>
  );
}

/* ---------- 待复核卡片 ---------- */
function PendingCard({
  record,
  patientName,
  devices,
  onRetest,
  onApprove,
}: {
  record: ExamRecord;
  patientName: string;
  devices: Device[];
  onRetest: (input: EntryInput) => void;
  onApprove: (note: string) => void;
}) {
  const [mode, setMode] = useState<"view" | "retest">("view");
  const [note, setNote] = useState("");
  const current = record.versions.find((v) => v.id === record.currentVersionId)!;
  const canApprove = current.failReasons.length === 0;

  return (
    <article className="record-card qc-pending">
      <div className="record-index">复</div>
      <div className="record-body">
        <header className="record-head">
          <h3>
            {patientName} · {EYE_LABEL[record.eye]}
          </h3>
          <em className="tag tag-warn">{STATUS_LABEL[record.status]}</em>
        </header>
        <p>
          当前 V{current.versionNo} · 设备 {current.deviceId} ·{" "}
          {current.readings.map(readingText).join("；")}
        </p>
        {current.failReasons.length > 0 && (
          <ul className="fail-list">
            {current.failReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}

        {mode === "retest" ? (
          <EntryForm
            patients={[{ id: record.patientId, name: patientName }]}
            devices={devices}
            defaultEye={record.eye}
            defaultDeviceId={current.deviceId}
            defaultReadings={current.readings}
            submitLabel="保存重测（生成新版本）"
            onSubmit={(input) => {
              onRetest(input);
              setMode("view");
            }}
            onCancel={() => setMode("view")}
          />
        ) : (
          <div className="form-actions">
            <button onClick={() => setMode("retest")}>重测</button>
            <input
              className="note-input"
              placeholder="复核说明"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="primary-action"
              disabled={!canApprove}
              title={canApprove ? "" : "当前版本仍被拦截，需续期/重测至判定通过"}
              onClick={() => onApprove(note.trim())}
            >
              复核通过并出方
            </button>
          </div>
        )}
        <VersionHistory record={record} />
      </div>
    </article>
  );
}

/* ---------- 已出方卡片（锁定，改动另开版本） ---------- */
function IssuedCard({
  record,
  patientName,
  devices,
  onReopen,
}: {
  record: ExamRecord;
  patientName: string;
  devices: Device[];
  onReopen: (input: EntryInput) => void;
}) {
  const [mode, setMode] = useState<"view" | "retest">("view");
  const current = record.versions.find((v) => v.id === record.currentVersionId)!;
  const final = finalizeReadings(current.readings);
  return (
    <article className="record-card qc-issued">
      <div className="record-index locked">锁</div>
      <div className="record-body">
        <header className="record-head">
          <h3>
            {patientName} · {EYE_LABEL[record.eye]}
          </h3>
          <em className="tag tag-ok">{STATUS_LABEL[record.status]}</em>
        </header>
        <p className="final-rx">
          处方：{readingText(final)} · 设备 {current.deviceId} · 出方于{" "}
          {record.issuedAt ? new Date(record.issuedAt).toLocaleString() : "-"}
        </p>
        <p className="lock-hint">已锁定：值不可改动，任何修改需另开新版本</p>

        {mode === "retest" ? (
          <EntryForm
            patients={[{ id: record.patientId, name: patientName }]}
            devices={devices}
            defaultEye={record.eye}
            defaultDeviceId={current.deviceId}
            defaultReadings={current.readings}
            submitLabel="另开新版本（记录退回待复核）"
            onSubmit={(input) => {
              onReopen(input);
              setMode("view");
            }}
            onCancel={() => setMode("view")}
          />
        ) : (
          <div className="form-actions">
            <button onClick={() => setMode("retest")}>另开版本修改</button>
          </div>
        )}
        <VersionHistory record={record} />
      </div>
    </article>
  );
}

/* ---------- 主页面 ---------- */
function App() {
  const { state, submitEntry, submitRetest, approveRecord, renewDevice, addPatient } = useQcStore();
  const [showEntry, setShowEntry] = useState(false);

  const patientName = (id: string) => state.patients.find((p) => p.id === id)?.name ?? id;
  const pending = state.records.filter((r) => r.status === "pending_review");
  const issued = state.records.filter((r) => r.status === "issued");
  const expiredCount = state.devices.filter((d) => isCalibrationExpired(d)).length;

  const metrics = [
    { label: "待复核记录", value: String(pending.length), cls: "status-watch" },
    { label: "已出方处方", value: String(issued.length), cls: "status-ok" },
    { label: "校准过期设备", value: String(expiredCount), cls: "status-danger" },
    { label: "患者档案", value: String(state.patients.length), cls: "status-ok" },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · 质控工作台</p>
          <h1>眼科验光质控</h1>
          <p className="subtitle">
            验光结果与设备校准状态联动判定：校准过期或三次轴位跨度超过 {AXIS_SPAN_LIMIT}°
            的记录只存待复核，续期重测通过后方可出方；出方即锁定，改动另开版本。
          </p>
        </div>
        <div className="stack-card">
          <span>本机保存</span>
          <strong>localStorage 持久化，关闭重开数据仍在</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={m.cls} />
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="side">
          <DevicePanel devices={state.devices} onRenew={renewDevice} />
          <PatientPanel patients={state.patients} onAdd={addPatient} />
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>录入与判定</p>
              <h2>验光录入</h2>
            </div>
            <button className="primary-action" onClick={() => setShowEntry((v) => !v)}>
              {showEntry ? "收起" : "新增验光记录"}
            </button>
          </div>
          {showEntry ? (
            <EntryForm
              patients={state.patients}
              devices={state.devices}
              defaultEye="OD"
              defaultDeviceId={state.devices[0]?.id ?? ""}
              defaultReadings={[emptyReading(), emptyReading(), emptyReading()]}
              submitLabel="提交（自动判定）"
              onSubmit={(input) => {
                submitEntry(input);
                setShowEntry(false);
              }}
            />
          ) : (
            <p className="panel-hint">
              按患者和眼别录入三次球镜 / 柱镜 / 轴位及设备编号，提交时自动判定：校准过期或轴位跨度超{" "}
              {AXIS_SPAN_LIMIT}° 只存待复核。
            </p>
          )}
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>拦截队列</p>
            <h2>待复核（{pending.length}）</h2>
          </div>
        </div>
        <div className="record-list">
          {pending.length === 0 && <p className="panel-hint">暂无待复核记录。</p>}
          {pending.map((rec) => (
            <PendingCard
              key={rec.id}
              record={rec}
              patientName={patientName(rec.patientId)}
              devices={state.devices}
              onRetest={(input) => submitRetest(rec.id, input)}
              onApprove={(note) => approveRecord(rec.id, note)}
            />
          ))}
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>已锁定</p>
            <h2>已出方（{issued.length}）</h2>
          </div>
        </div>
        <div className="record-list">
          {issued.length === 0 && <p className="panel-hint">暂无已出方记录。</p>}
          {issued.map((rec) => (
            <IssuedCard
              key={rec.id}
              record={rec}
              patientName={patientName(rec.patientId)}
              devices={state.devices}
              onReopen={(input) => submitRetest(rec.id, input)}
            />
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
