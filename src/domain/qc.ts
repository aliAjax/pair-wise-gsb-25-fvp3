import type {
  CalibrationState,
  CaseStatus,
  Device,
  Prescription,
  QcResult,
  Reading,
} from "../types";

export const AXIS_LIMIT = 5; // 三次轴位跨度阈值（度），> 5 判失败

export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00").getTime();
  const b = new Date(toISO + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

/**
 * 校准状态：到期日已过（含今天）即不可用。
 * 校准通常在到期日当天就需重新检定，故「到期日」也拦截。
 */
export function calibrationState(
  expiry: string | null | undefined,
  today: string = todayISO()
): CalibrationState {
  if (!expiry) return "unknown";
  const left = daysBetween(today, expiry);
  if (left < 0) return "expired";
  if (left === 0) return "due_today";
  return "ok";
}

export function isCalibrationBlocked(state: CalibrationState): boolean {
  return state === "expired" || state === "due_today" || state === "unknown";
}

/**
 * 轴位按 0–180 圆周处理（0 与 180 同向）。
 * 取相邻间隔中最大的缺口，跨度 = 180 - 最大缺口，跨 0° 也正确。
 */
export function axisSpan(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = values.map((v) => ((v % 180) + 180) % 180).sort((a, b) => a - b);
  let maxGap = sorted[0] + 180 - sorted[sorted.length - 1]; // 环绕缺口
  for (let i = 1; i < sorted.length; i++) {
    maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
  }
  return Math.round((180 - maxGap) * 10) / 10;
}

/** 对一次测量（三次读数）做质控判定 */
export function evaluateAttempt(
  readings: Reading[],
  device: Device | undefined,
  today: string = todayISO()
): QcResult {
  const state = calibrationState(device?.calibrationExpiry, today);
  const calibrationBlocked = isCalibrationBlocked(state);
  const span = axisSpan(readings.map((r) => r.axis));
  const axisBlocked = span > AXIS_LIMIT;

  const reasons: string[] = [];
  if (state === "expired") {
    reasons.push(
      `设备 ${device?.id ?? ""} 校准已过期（有效期至 ${device?.calibrationExpiry}），需先续期`
    );
  } else if (state === "due_today") {
    reasons.push(`设备 ${device?.id ?? ""} 校准今天到期（${device?.calibrationExpiry}），需先续期`);
  } else if (state === "unknown") {
    reasons.push("设备编号不在台账中，无法确认校准状态");
  }
  if (axisBlocked) {
    reasons.push(`三次轴位跨度 ${span}°，超过 ${AXIS_LIMIT}° 限值`);
  }

  return {
    checkedAt: today,
    deviceId: device?.id ?? "",
    deviceExpiry: device?.calibrationExpiry ?? null,
    calibrationState: state,
    calibrationBlocked,
    axisSpan: span,
    axisBlocked,
    passed: !calibrationBlocked && !axisBlocked,
    reasons,
  };
}

/** 复核/出方取值：球镜柱镜取中位数，轴位取圆周均值 */
export function derivePrescription(
  attemptId: string,
  version: number,
  readings: Reading[],
  deviceId: string
): Prescription {
  const mid = (nums: number[]) => {
    const s = [...nums].sort((a, b) => a - b);
    const midVal = s[Math.floor(s.length / 2)];
    return Math.round(midVal * 100) / 100;
  };
  const axes = readings.map((r) => ((r.axis % 180) + 180) % 180);
  const doubled = axes.map((a) => (a * 2 * Math.PI) / 180);
  const sin = doubled.reduce((s, x) => s + Math.sin(x), 0);
  const cos = doubled.reduce((s, x) => s + Math.cos(x), 0);
  let deg = (Math.atan2(sin, cos) * 180) / (2 * Math.PI);
  if (deg < 0) deg += 180;
  const axis = Math.round(deg);

  return {
    version,
    attemptId,
    deviceId,
    sphere: mid(readings.map((r) => r.sphere)),
    cylinder: mid(readings.map((r) => r.cylinder)),
    axis: axis === 180 ? 0 : axis,
    issuedAt: "",
  };
}

export const STATUS_LABEL: Record<CaseStatus, string> = {
  in_review: "待复核",
  approved: "复核通过·可出方",
  prescribed: "已出方·已锁定",
};
