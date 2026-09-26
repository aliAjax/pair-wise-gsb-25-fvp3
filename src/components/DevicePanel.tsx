import { useState } from "react";
import type { Device } from "../types";
import { addDevice, renewDevice } from "../store/db";
import { calibrationState, daysBetween, todayISO } from "../domain/qc";

const STATE_TEXT: Record<string, { label: string; cls: string }> = {
  ok: { label: "校准有效", cls: "cal-ok" },
  due_today: { label: "今日到期", cls: "cal-due_today" },
  expired: { label: "校准过期", cls: "cal-expired" },
  unknown: { label: "无信息", cls: "cal-unknown" },
};

function defaultRenew(): string {
  const d = new Date();
  d.setDate(d.getDate() + 365);
  return d.toISOString().slice(0, 10);
}

export function DevicePanel({ devices }: { devices: Device[] }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState(defaultRenew());
  const [formError, setFormError] = useState<string | null>(null);
  const [renewingId, setRenewingId] = useState<string | null>(null);
  const [renewDate, setRenewDate] = useState(defaultRenew());
  const [renewError, setRenewError] = useState<string | null>(null);

  const register = () => {
    const err = addDevice({ id, name, expiry });
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setId("");
    setName("");
    setExpiry(defaultRenew());
    setOpen(false);
  };

  const today = todayISO();
  const expiredCount = devices.filter(
    (d) => calibrationState(d.calibrationExpiry, today) !== "ok"
  ).length;

  return (
    <div className="device-panel">
      <div className="device-panel-head">
        <strong>设备校准台账</strong>
        <button className="mini" onClick={() => setOpen((v) => !v)}>
          {open ? "收起" : "登记设备"}
        </button>
      </div>

      {expiredCount > 0 && (
        <p className="device-alert">
          {expiredCount} 台设备校准到期/过期，相关测量只能存待复核
        </p>
      )}

      {open && (
        <div className="device-form">
          <label>
            <span>设备编号</span>
            <input value={id} placeholder="如 ARK-03" onChange={(e) => setId(e.target.value)} />
          </label>
          <label>
            <span>设备名称</span>
            <input value={name} placeholder="如 电脑验光仪 3 号机" onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            <span>校准有效期至</span>
            <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </label>
          {formError && <p className="form-error">{formError}</p>}
          <button className="primary-action mini" onClick={register}>
            保存到台账
          </button>
        </div>
      )}

      <ul className="device-list">
        {devices.map((d) => {
          const st = calibrationState(d.calibrationExpiry, today);
          const meta = STATE_TEXT[st];
          const left = daysBetween(today, d.calibrationExpiry);
          const renewing = renewingId === d.id;
          return (
            <li key={d.id} className={`device-item ${meta.cls}`}>
              <div className="device-row">
                <div>
                  <strong>{d.id}</strong>
                  <span className="device-name">{d.name}</span>
                </div>
                <span className={`badge ${meta.cls}`}>{meta.label}</span>
              </div>
              <div className="device-meta">
                有效期至 {d.calibrationExpiry}
                {st === "ok" ? `（剩 ${left} 天）` : left === 0 ? "（今天）" : `（已过期 ${-left} 天）`}
                {d.renewals.length > 0 && <em> · 已续期 {d.renewals.length} 次</em>}
              </div>
              {st !== "ok" && (
                <button className="mini renew-btn" onClick={() => { setRenewingId(renewing ? null : d.id); setRenewError(null); }}>
                  {renewing ? "取消续期" : "续期校准"}
                </button>
              )}
              {renewing && (
                <div className="renew-box">
                  <input type="date" value={renewDate} onChange={(e) => setRenewDate(e.target.value)} />
                  <button
                    className="primary-action mini"
                    onClick={() => {
                      const err = renewDevice(d.id, renewDate);
                      if (err) setRenewError(err);
                      else setRenewingId(null);
                    }}
                  >
                    确认续期
                  </button>
                  {renewError && <p className="form-error">{renewError}</p>}
                </div>
              )}
            </li>
          );
        })}
        {devices.length === 0 && <li className="empty-hint">台账为空，请先登记设备</li>}
      </ul>
    </div>
  );
}
