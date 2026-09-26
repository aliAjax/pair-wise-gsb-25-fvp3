import { useEffect, useState } from "react";
import type { Device, Reading } from "../types";
import { AXIS_LIMIT, calibrationState, daysBetween, todayISO } from "../domain/qc";

export interface ReadingFormValue {
  deviceId: string;
  readings: Reading[];
}

interface ReadingGridProps {
  devices: Device[];
  initialDeviceId?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit: (v: ReadingFormValue) => string | null | void;
  onCancel?: () => void;
}

function num(v: string): number {
  if (v.trim() === "") return NaN;
  return Number(v);
}

/** 三次球镜/柱镜/轴位录入 + 设备编号选择；提交前做表单校验，质控判定在提交后由领域层完成 */
export function ReadingGrid({
  devices,
  initialDeviceId,
  submitLabel = "提交判定",
  cancelLabel,
  onSubmit,
  onCancel,
}: ReadingGridProps) {
  const [deviceId, setDeviceId] = useState(initialDeviceId ?? devices[0]?.id ?? "");
  const [rows, setRows] = useState<string[][]>([
    ["", "", ""],
    ["", "", ""],
    ["", "", ""],
  ]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialDeviceId) setDeviceId(initialDeviceId);
  }, [initialDeviceId]);

  const setCell = (i: number, j: number, v: string) => {
    setRows((prev) => prev.map((row, ri) => (ri === i ? row.map((c, ci) => (ci === j ? v : c)) : row)));
  };

  const selected = devices.find((d) => d.id === deviceId);
  const calState = selected ? calibrationState(selected.calibrationExpiry) : "unknown";
  const liveAxes = rows.map((r) => num(r[2])).filter((v) => !Number.isNaN(v));
  const liveSpan =
    liveAxes.length === 3
      ? (() => {
          const sorted = [...liveAxes].sort((a, b) => a - b);
          let gap = sorted[0] + 180 - sorted[2];
          gap = Math.max(gap, sorted[1] - sorted[0], sorted[2] - sorted[1]);
          return Math.round((180 - gap) * 10) / 10;
        })()
      : null;

  const submit = () => {
    if (!deviceId) return setError("请选择设备编号");
    if (!selected) return setError("设备编号不在台账中，请先在设备台账登记");
    const readings: Reading[] = [];
    for (const row of rows) {
      const sphere = num(row[0]);
      const cylinder = num(row[1]);
      const axis = num(row[2]);
      if (Number.isNaN(sphere) || Number.isNaN(cylinder) || Number.isNaN(axis)) {
        return setError("三次测量的球镜、柱镜、轴位都必须填写");
      }
      if (axis < 0 || axis > 180) return setError("轴位需在 0–180 之间");
      readings.push({ sphere, cylinder, axis });
    }
    const result = onSubmit({ deviceId, readings });
    if (typeof result === "string" && result) {
      setError(result);
    } else {
      setError(null);
      setRows([
        ["", "", ""],
        ["", "", ""],
        ["", "", ""],
      ]);
    }
  };

  const calHint =
    selected && calState !== "ok"
      ? calState === "expired"
        ? `校准已过期（有效期至 ${selected.calibrationExpiry}），提交后将转待复核`
        : calState === "due_today"
          ? "校准今天到期，提交后将转待复核"
          : "无校准信息"
      : selected
        ? `校准有效至 ${selected.calibrationExpiry}（剩余 ${daysBetween(todayISO(), selected.calibrationExpiry)} 天）`
        : "请先登记设备";

  return (
    <div className="reading-form">
      <label className="device-select">
        <span>设备编号</span>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {devices.length === 0 && <option value="">（台账为空，请先登记）</option>}
          {devices.map((d) => {
            const st = calibrationState(d.calibrationExpiry);
            return (
              <option key={d.id} value={d.id}>
                {d.id} · {d.name}
                {st === "expired" ? "（校准过期）" : st === "due_today" ? "（今天到期）" : ""}
              </option>
            );
          })}
        </select>
        <em className={`cal-hint cal-${calState}`}>{calHint}</em>
      </label>

      <div className="attempt-table-wrap">
        <table className="attempt-table">
          <thead>
            <tr>
              <th>次数</th>
              <th>球镜 DS</th>
              <th>柱镜 DC</th>
              <th>轴位 °</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="attempt-no">第 {i + 1} 次</td>
                <td>
                  <input
                    inputMode="decimal"
                    placeholder="-2.75"
                    value={row[0]}
                    onChange={(e) => setCell(i, 0, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    placeholder="-0.50"
                    value={row[1]}
                    onChange={(e) => setCell(i, 1, e.target.value)}
                  />
                </td>
                <td>
                  <input
                    inputMode="decimal"
                    placeholder="180"
                    value={row[2]}
                    onChange={(e) => setCell(i, 2, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="live-check">
        实时预检：轴位跨度{" "}
        <strong className={liveSpan !== null && liveSpan > AXIS_LIMIT ? "bad" : "good"}>
          {liveSpan === null ? "—" : `${liveSpan}°`}
        </strong>
        ，限值 {AXIS_LIMIT}°
        {liveSpan !== null && liveSpan > AXIS_LIMIT && <span className="warn-text">（超限将转待复核）</span>}
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button className="primary-action" onClick={submit}>
          {submitLabel}
        </button>
        {onCancel && cancelLabel && <button onClick={onCancel}>{cancelLabel}</button>}
      </div>
    </div>
  );
}
