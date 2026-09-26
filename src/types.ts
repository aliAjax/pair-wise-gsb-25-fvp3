// 验光质控工作台领域模型：档案、判定结果、设备台账、处方版本

export type Eye = "OD" | "OS"; // OD 右眼 / OS 左眼

export type CaseStatus =
  | "in_review" // 待复核：质控未通过，不能出方
  | "approved" // 复核通过（或首次判定即通过），可出方
  | "prescribed"; // 已出方，值锁定

export interface Reading {
  sphere: number; // 球镜 DS
  cylinder: number; // 柱镜 DC
  axis: number; // 轴位 0-180
}

export type CalibrationState = "ok" | "due_today" | "expired" | "unknown";

/** 单次质控判定快照（随读数永久保留，设备后续续期不改变历史判定） */
export interface QcResult {
  checkedAt: string; // yyyy-mm-dd
  deviceId: string;
  deviceExpiry: string | null;
  calibrationState: CalibrationState;
  calibrationBlocked: boolean;
  axisSpan: number; // 三次轴位圆周跨度（度）
  axisBlocked: boolean;
  passed: boolean;
  reasons: string[]; // 失败原因
}

/** 一次测量尝试：三次读数 + 当时的质控判定；复核不通过后重测会追加新尝试 */
export interface Attempt {
  id: string;
  at: string; // ISO 时间
  deviceId: string;
  readings: Reading[]; // 固定 3 次
  qc: QcResult;
}

export interface CaseEvent {
  id: string;
  at: string;
  kind: "submit" | "retest" | "review" | "prescribe" | "version";
  text: string;
}

/** 出方后锁定的处方值 */
export interface Prescription {
  version: number;
  attemptId: string;
  deviceId: string;
  sphere: number;
  cylinder: number;
  axis: number;
  issuedAt: string;
}

/** 一份验光档案：同一患者同一眼别，可含多次重测尝试，出方后另开版本 */
export interface ExamCase {
  id: string;
  patientId: string;
  patientName: string;
  eye: Eye;
  status: CaseStatus;
  version: number;
  sourceCaseId?: string; // 改动另开版本时指向原档案
  attempts: Attempt[];
  events: CaseEvent[];
  prescription: Prescription | null;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string; // 设备编号
  name: string;
  calibrationExpiry: string; // 校准有效期至 yyyy-mm-dd
  renewals: { at: string; prev: string; next: string }[];
  createdAt: string;
}

export interface DBShape {
  version: 1;
  devices: Device[];
  cases: ExamCase[];
}
