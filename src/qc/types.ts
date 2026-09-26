// 质控工作台领域模型：患者档案、验光记录版本、设备校准

export type EyeSide = "OD" | "OS";

export type RecordStatus = "pending_review" | "issued";

export interface Patient {
  id: string;
  name: string;
  ageGroup: string;
  note: string;
  createdAt: string;
}

/** 单次读数：球镜 DS / 柱镜 DC / 轴位 ° */
export interface Reading {
  sphere: number;
  cylinder: number;
  axis: number;
}

/** 一次验光录入（三次读数 + 设备），判定结果随录入保存 */
export interface ExamVersion {
  id: string;
  versionNo: number;
  eye: EyeSide;
  deviceId: string;
  readings: [Reading, Reading, Reading];
  /** 判定不通过的原因（校准过期 / 轴位跨度超差），通过时为空 */
  failReasons: string[];
  /** 复核结论；待复核记录复核通过前为 null */
  reviewNote: string | null;
  createdAt: string;
}

export interface ExamRecord {
  id: string;
  patientId: string;
  eye: EyeSide;
  status: RecordStatus;
  /** 当前生效版本；出方后锁定 */
  currentVersionId: string;
  /** 出方时间；未出方为 null */
  issuedAt: string | null;
  versions: ExamVersion[];
  createdAt: string;
}

export interface Device {
  id: string;
  name: string;
  /** 校准到期日，YYYY-MM-DD；早于今天即视为过期 */
  calibrateUntil: string;
}

export interface QcState {
  patients: Patient[];
  devices: Device[];
  records: ExamRecord[];
}

export const EYE_LABEL: Record<EyeSide, string> = {
  OD: "右眼",
  OS: "左眼",
};

export const STATUS_LABEL: Record<RecordStatus, string> = {
  pending_review: "待复核",
  issued: "已出方",
};
