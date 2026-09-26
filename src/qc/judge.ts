// 质控判定：校准有效期、三次轴位跨度
import type { Device, Reading } from "./types";

/** 三次轴位允许的最大跨度（度） */
export const AXIS_SPAN_LIMIT = 5;

export function todayStr(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 校准到期日早于今天即过期；空日期视为无校准记录，按过期处理 */
export function isCalibrationExpired(device: Device, today: string = todayStr()): boolean {
  if (!device.calibrateUntil) return true;
  return device.calibrateUntil < today;
}

/**
 * 三次轴位的最小覆盖跨度。
 * 轴位以 180° 为周期（0 与 180 等价），先归一化到 [0,180)，
 * 再沿圆周取三点覆盖弧长的最小值，避免 179°/1° 被误判为跨度 178°。
 */
export function axisSpan(axes: number[]): number {
  if (axes.length === 0) return 0;
  const norm = axes
    .map((a) => ((a % 180) + 180) % 180)
    .sort((a, b) => a - b);
  const n = norm.length;
  let maxGap = 0;
  for (let i = 0; i < n; i += 1) {
    const next = i === n - 1 ? norm[0] + 180 : norm[i + 1];
    maxGap = Math.max(maxGap, next - norm[i]);
  }
  return Math.round((180 - maxGap) * 100) / 100;
}

/** 汇总一次录入的拦截原因；返回空数组表示可出方 */
export function judgeEntry(
  device: Device | undefined,
  readings: Reading[],
  today: string = todayStr()
): string[] {
  const reasons: string[] = [];
  if (!device) {
    reasons.push("设备未登记，无法确认校准状态");
  } else if (isCalibrationExpired(device, today)) {
    reasons.push(
      `设备 ${device.name} 校准已于 ${device.calibrateUntil || "（无记录）"} 到期，需续期后重测`
    );
  }
  const span = axisSpan(readings.map((r) => r.axis));
  if (span > AXIS_SPAN_LIMIT) {
    reasons.push(`三次轴位跨度 ${span}°，超过 ${AXIS_SPAN_LIMIT}° 上限，需重测复核`);
  }
  return reasons;
}

/** 出方值：三次读数均值，球镜/柱镜保留 0.25D 步进，轴位取整 */
export function finalizeReadings(readings: Reading[]): Reading {
  const avg = (key: keyof Reading) =>
    readings.reduce((sum, r) => sum + r[key], 0) / readings.length;
  const quarter = (v: number) => Math.round(v * 4) / 4;
  return {
    sphere: quarter(avg("sphere")),
    cylinder: quarter(avg("cylinder")),
    axis: Math.round(avg("axis")),
  };
}
