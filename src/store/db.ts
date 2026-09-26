import type {
  Attempt,
  CaseEvent,
  DBShape,
  Device,
  ExamCase,
  Eye,
  Prescription,
  Reading,
} from "../types";
import { derivePrescription, evaluateAttempt, todayISO } from "../domain/qc";

const STORAGE_KEY = "hxwl-11-qc-db-v1";

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function makeEvent(kind: CaseEvent["kind"], text: string): CaseEvent {
  return { id: uid("evt"), at: isoNow(), kind, text };
}

/* ---------------- 种子数据 ---------------- */

function seed(): DBShape {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const future = new Date(today);
  future.setDate(today.getDate() + 180);
  const past = new Date(today);
  past.setDate(today.getDate() - 12);

  const devices: Device[] = [
    {
      id: "ARK-01",
      name: "电脑验光仪 1 号机",
      calibrationExpiry: fmt(future),
      renewals: [],
      createdAt: isoNow(),
    },
    {
      id: "ARK-02",
      name: "电脑验光仪 2 号机",
      calibrationExpiry: fmt(past),
      renewals: [],
      createdAt: isoNow(),
    },
    {
      id: "LM-07",
      name: "焦度计（复核台）",
      calibrationExpiry: fmt(future),
      renewals: [],
      createdAt: isoNow(),
    },
  ];

  const r = (sphere: number, cylinder: number, axis: number): Reading => ({
    sphere,
    cylinder,
    axis,
  });

  // 案例 1：校准过期 → 待复核（续期并重测后才能复核通过）
  const readings1 = [r(-2.75, -0.5, 180), r(-2.75, -0.5, 178), r(-2.5, -0.5, 179)];
  const qc1 = evaluateAttempt(readings1, devices[1]);
  const attempt1: Attempt = {
    id: uid("att"),
    at: isoNow(),
    deviceId: "ARK-02",
    readings: readings1,
    qc: qc1,
  };

  // 案例 2：设备有效、轴位稳定 → 复核通过，可出方
  const readings2 = [r(-3.5, -1.0, 25), r(-3.5, -1.0, 27), r(-3.75, -1.0, 26)];
  const qc2 = evaluateAttempt(readings2, devices[0]);
  const attempt2: Attempt = {
    id: uid("att"),
    at: isoNow(),
    deviceId: "ARK-01",
    readings: readings2,
    qc: qc2,
  };

  const cases: ExamCase[] = [
    {
      id: "CASE-1001",
      patientId: "Patient-032",
      patientName: "陈一鸣",
      eye: "OD",
      status: "in_review",
      version: 1,
      attempts: [attempt1],
      events: [
        makeEvent(
          "submit",
          `录入三次读数（设备 ARK-02）：${qc1.passed ? "质控通过" : "质控未通过，转入待复核"}：${qc1.reasons.join("；")}`
        ),
      ],
      prescription: null,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    },
    {
      id: "CASE-1002",
      patientId: "Patient-144",
      patientName: "林晓",
      eye: "OS",
      status: qc2.passed ? "approved" : "in_review",
      version: 1,
      attempts: [attempt2],
      events: [
        makeEvent(
          "submit",
          `录入三次读数（设备 ARK-01）：${qc2.passed ? "质控通过，可出方" : "质控未通过，转入待复核"}：${qc2.reasons.join("；")}`
        ),
      ],
      prescription: null,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    },
  ];

  return { version: 1, devices, cases };
}

/* ---------------- 存取 ---------------- */

let db: DBShape = load();
const listeners = new Set<() => void>();

function load(): DBShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DBShape;
      if (parsed && parsed.version === 1 && Array.isArray(parsed.cases)) {
        return parsed;
      }
    }
  } catch {
    // 数据损坏时回退到种子数据
  }
  const initial = seed();
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  } catch {
    // 隐私模式等场景下降级为内存存储
  }
  return initial;
}

function persist() {
  // 刷新顶层引用，保证 useSyncExternalStore 能捕获嵌套变更
  db = { ...db };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // 忽略写入失败（如隐私模式），内存状态仍可在本次会话使用
  }
  listeners.forEach((fn) => fn());
}

/* ---------------- 查询 ---------------- */

export function getDB(): DBShape {
  return db;
}

export function getDevice(id: string): Device | undefined {
  return db.devices.find((d) => d.id === id.trim());
}

export function getCase(id: string): ExamCase | undefined {
  return db.cases.find((c) => c.id === id);
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/* ---------------- 设备台账 ---------------- */

export function addDevice(input: { id: string; name: string; expiry: string }): string | null {
  const id = input.id.trim();
  if (!id) return "请填写设备编号";
  if (db.devices.some((d) => d.id === id)) return `设备编号 ${id} 已存在`;
  if (!input.expiry) return "请选择校准有效期";
  db.devices = [
    ...db.devices,
    {
      id,
      name: input.name.trim() || id,
      calibrationExpiry: input.expiry,
      renewals: [],
      createdAt: isoNow(),
    },
  ];
  persist();
  return null;
}

/** 续期：设备校准日期往后延，历史读数上的过期判定原样保留 */
export function renewDevice(id: string, nextExpiry: string): string | null {
  const device = db.devices.find((d) => d.id === id);
  if (!device) return "设备不存在";
  if (!nextExpiry) return "请选择新的校准有效期";
  const prev = device.calibrationExpiry;
  device.calibrationExpiry = nextExpiry;
  device.renewals = [
    ...device.renewals,
    { at: isoNow(), prev, next: nextExpiry },
  ];
  persist();
  return null;
}

/* ---------------- 档案流转 ---------------- */

function nextCaseId(): string {
  let max = 1002;
  for (const c of db.cases) {
    const m = c.id.match(/^CASE-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CASE-${max + 1}`;
}

function latestAttempt(c: ExamCase): Attempt {
  return c.attempts[c.attempts.length - 1];
}

export interface NewCaseInput {
  patientId: string;
  patientName: string;
  eye: Eye;
  deviceId: string;
  readings: Reading[];
}

/** 录入三次读数：判定失败先存待复核；通过则可出方 */
export function submitCase(input: NewCaseInput): { id: string } {
  const device = getDevice(input.deviceId);
  const qc = evaluateAttempt(input.readings, device);
  const attempt: Attempt = {
    id: uid("att"),
    at: isoNow(),
    deviceId: input.deviceId.trim(),
    readings: input.readings,
    qc,
  };
  const c: ExamCase = {
    id: nextCaseId(),
    patientId: input.patientId.trim(),
    patientName: input.patientName.trim() || input.patientId.trim(),
    eye: input.eye,
    status: qc.passed ? "approved" : "in_review",
    version: 1,
    attempts: [attempt],
    events: [
      makeEvent(
        "submit",
        `录入三次读数（设备 ${input.deviceId.trim()}）：${
          qc.passed ? "质控通过，可出方" : "质控未通过，转入待复核"
        }${qc.reasons.length ? "：" + qc.reasons.join("；") : ""}`
      ),
    ],
    prescription: null,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
  db = { ...db, cases: [c, ...db.cases] };
  persist();
  return { id: c.id };
}

/** 待复核档案重测：追加一组读数和判定，原读数与失败原因继续保留 */
export function retestCase(
  caseId: string,
  deviceId: string,
  readings: Reading[]
): string | null {
  const c = getCase(caseId);
  if (!c) return "档案不存在";
  if (c.status === "prescribed") return "该版本已出方锁定，请另开新版本";
  const device = getDevice(deviceId);
  const qc = evaluateAttempt(readings, device);
  const attempt: Attempt = {
    id: uid("att"),
    at: isoNow(),
    deviceId: deviceId.trim(),
    readings,
    qc,
  };
  c.attempts = [...c.attempts, attempt];
  c.events = [
    ...c.events,
    makeEvent(
      "retest",
      `重测三次读数（设备 ${deviceId.trim()}）：${
        qc.passed ? "本次质控通过，可复核" : "本次仍未通过：" + qc.reasons.join("；")
      }`
    ),
  ];
  c.updatedAt = isoNow();
  db = { ...db, cases: [...db.cases] };
  persist();
  return null;
}

/** 复核：仅当最新一次测量质控通过才允许通过 */
export function reviewCase(caseId: string): string | null {
  const c = getCase(caseId);
  if (!c) return "档案不存在";
  if (c.status === "prescribed") return "已出方，无需复核";
  const last = latestAttempt(c);
  if (!last.qc.passed) {
    return "最新一次测量质控未通过，请先续期设备并重测";
  }
  c.status = "approved";
  c.events = [...c.events, makeEvent("review", "复核通过，可出具处方")];
  c.updatedAt = isoNow();
  db = { ...db, cases: [...db.cases] };
  persist();
  return null;
}

/** 出方：按复核通过的最新读数生成处方并锁定 */
export function prescribeCase(caseId: string): string | null {
  const c = getCase(caseId);
  if (!c) return "档案不存在";
  if (c.status === "prescribed") return "该版本已出方";
  const last = latestAttempt(c);
  if (!last.qc.passed) return "质控未通过，不能出方";
  const p: Prescription = derivePrescription(
    last.id,
    c.version,
    last.readings,
    last.deviceId
  );
  p.issuedAt = isoNow();
  c.status = "prescribed";
  c.prescription = p;
  c.events = [
    ...c.events,
    makeEvent(
      "prescribe",
      `出具处方 v${c.version} 并锁定：${formatRx(p.sphere, p.cylinder, p.axis)}（设备 ${p.deviceId}）`
    ),
  ];
  c.updatedAt = isoNow();
  db = { ...db, cases: [...db.cases] };
  persist();
  return null;
}

/** 已锁定档案改动另开版本：复制档案头，重新走录入/质控流程，原版本保留 */
export function openNewVersion(
  sourceId: string,
  deviceId: string,
  readings: Reading[]
): { id?: string; error?: string } {
  const src = getCase(sourceId);
  if (!src) return { error: "档案不存在" };
  if (src.status !== "prescribed") return { error: "仅已出方档案需要另开版本" };

  const device = getDevice(deviceId);
  const qc = evaluateAttempt(readings, device);
  const attempt: Attempt = {
    id: uid("att"),
    at: isoNow(),
    deviceId: deviceId.trim(),
    readings,
    qc,
  };
  const c: ExamCase = {
    id: nextCaseId(),
    patientId: src.patientId,
    patientName: src.patientName,
    eye: src.eye,
    status: qc.passed ? "approved" : "in_review",
    version: src.version + 1,
    sourceCaseId: src.id,
    attempts: [attempt],
    events: [
      makeEvent(
        "version",
        `基于已锁定处方 v${src.version}（${src.id}）另开 v${src.version + 1}，本次${
          qc.passed ? "质控通过，可出方" : "质控未通过，转入待复核"
        }${qc.reasons.length ? "：" + qc.reasons.join("；") : ""}`
      ),
    ],
    prescription: null,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
  db = { ...db, cases: [c, ...db.cases] };
  persist();
  return { id: c.id };
}

export function formatRx(sphere: number, cylinder: number, axis: number): string {
  const s = `${sphere > 0 ? "+" : ""}${sphere.toFixed(2)}DS`;
  const c = `${cylinder > 0 ? "+" : ""}${cylinder.toFixed(2)}DC`;
  return `${s} / ${c} × ${axis}°`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}
