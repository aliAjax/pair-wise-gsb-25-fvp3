import { useState } from "react";
import type { Device, ExamCase } from "../types";
import { formatRx, formatTime, openNewVersion, prescribeCase, retestCase, reviewCase } from "../store/db";
import { STATUS_LABEL } from "../domain/qc";
import { ReadingGrid } from "./ReadingGrid";

const EYE_LABEL = { OD: "右眼 OD", OS: "左眼 OS" } as const;

function QcBadge({ passed }: { passed: boolean }) {
  return <span className={`badge ${passed ? "cal-ok" : "cal-expired"}`}>{passed ? "质控通过" : "质控未过"}</span>;
}

export function CaseCard({
  examCase: c,
  devices,
}: {
  examCase: ExamCase;
  devices: Device[];
}) {
  const [showRetest, setShowRetest] = useState(false);
  const [showVersion, setShowVersion] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const last = c.attempts[c.attempts.length - 1];
  const locked = c.status === "prescribed";

  const doReview = () => {
    const err = reviewCase(c.id);
    setActionError(err);
  };
  const doPrescribe = () => {
    const err = prescribeCase(c.id);
    setActionError(err);
  };

  return (
    <article className={`case-card status-${c.status}`}>
      <header className="case-head">
        <div>
          <h3>
            {c.patientName} <span className="patient-id">{c.patientId}</span>
            <span className="eye-tag">{EYE_LABEL[c.eye]}</span>
            {c.version > 1 && <span className="version-tag">v{c.version}</span>}
          </h3>
          <p className="case-sub">
            {c.id}
            {c.sourceCaseId && <em> · 改自 {c.sourceCaseId}</em>} · 最近更新 {formatTime(c.updatedAt)}
          </p>
        </div>
        <span className={`badge case-status status-badge-${c.status}`}>{STATUS_LABEL[c.status]}</span>
      </header>

      {/* 处方锁定区 */}
      {c.prescription && (
        <div className="rx-box">
          <div>
            <span>已锁定处方 v{c.prescription.version}</span>
            <strong>{formatRx(c.prescription.sphere, c.prescription.cylinder, c.prescription.axis)}</strong>
            <em>出方时间 {formatTime(c.prescription.issuedAt)} · 设备 {c.prescription.deviceId}</em>
          </div>
          <button className="mini" onClick={() => { setShowVersion((v) => !v); setActionError(null); }}>
            {showVersion ? "取消" : "改动·另开版本"}
          </button>
        </div>
      )}

      {/* 历次尝试：原读数与失败原因永久保留 */}
      <div className="attempt-history">
        {c.attempts.map((a, idx) => {
          const isLast = idx === c.attempts.length - 1;
          const expanded = isLast || showHistory;
          return (
            <div key={a.id} className={`attempt-block ${a.qc.passed ? "pass" : "fail"} ${isLast ? "latest" : ""}`}>
              <div className="attempt-title">
                <QcBadge passed={a.qc.passed} />
                <span>
                  第 {idx + 1} 次测量 · 设备 {a.deviceId} · {formatTime(a.at)}
                </span>
                {!isLast && <em className="old-tag">历史记录</em>}
              </div>
              {expanded && (
                <>
                  <table className="reading-table">
                    <thead>
                      <tr><th>次数</th><th>球镜 DS</th><th>柱镜 DC</th><th>轴位 °</th></tr>
                    </thead>
                    <tbody>
                      {a.readings.map((r, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{r.sphere.toFixed(2)}</td>
                          <td>{r.cylinder.toFixed(2)}</td>
                          <td>{r.axis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="qc-detail">
                    <span>
                      判定日 {a.qc.checkedAt} · 设备校准{" "}
                      {a.qc.deviceExpiry ? `至 ${a.qc.deviceExpiry}` : "无记录"} · 轴位跨度 {a.qc.axisSpan}°
                    </span>
                    {a.qc.reasons.length > 0 && (
                      <ul className="reasons">
                        {a.qc.reasons.map((reason, i) => (
                          <li key={i}>⛔ {reason}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
        {c.attempts.length > 1 && (
          <button className="link-btn" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "收起历史测量" : `展开全部 ${c.attempts.length} 次测量与失败原因`}
          </button>
        )}
      </div>

      {/* 操作区 */}
      {!locked && c.status === "in_review" && (
        <>
          {!last.qc.passed && (
            <p className="block-notice">
              最新一次测量质控未通过（{last.qc.reasons.join("；")}）。请先续期设备校准并重测，不能直接出方。
            </p>
          )}
          <div className="case-actions">
            <button onClick={() => { setShowRetest((v) => !v); setActionError(null); }}>
              {showRetest ? "取消重测" : "续期后重测"}
            </button>
            <button className="primary-action" disabled={!last.qc.passed} onClick={doReview} title={last.qc.passed ? "" : "质控未通过，不能复核"}>
              复核通过
            </button>
          </div>
          {showRetest && (
            <ReadingGrid
              devices={devices}
              submitLabel="提交重测"
              cancelLabel="取消"
              onCancel={() => setShowRetest(false)}
              onSubmit={({ deviceId, readings }) => {
                const err = retestCase(c.id, deviceId, readings);
                if (err) return err;
                setShowRetest(false);
              }}
            />
          )}
        </>
      )}

      {!locked && c.status === "approved" && (
        <div className="case-actions">
          <span className="ok-hint">质控与复核均已通过，可以出方</span>
          <button className="primary-action" onClick={doPrescribe}>
            出具处方并锁定
          </button>
        </div>
      )}

      {/* 另开版本 */}
      {locked && showVersion && (
        <ReadingGrid
          devices={devices}
          submitLabel={`另开 v${c.version + 1} 并判定`}
          cancelLabel="取消"
          onCancel={() => setShowVersion(false)}
          onSubmit={({ deviceId, readings }) => {
            const res = openNewVersion(c.id, deviceId, readings);
            if (res.error) return res.error;
            setShowVersion(false);
          }}
        />
      )}

      {/* 流转记录 */}
      <details className="event-log" open={c.status !== "prescribed"}>
        <summary>流转记录（{c.events.length}）</summary>
        <ol>
          {c.events.map((e) => (
            <li key={e.id}>
              <span className={`event-kind event-kind-${e.kind}`}>{eventLabel(e.kind)}</span>
              {e.text}
              <em>{formatTime(e.at)}</em>
            </li>
          ))}
        </ol>
      </details>

      {actionError && <p className="form-error">{actionError}</p>}
    </article>
  );
}

function eventLabel(kind: string): string {
  return (
    { submit: "录入", retest: "重测", review: "复核", prescribe: "出方", version: "新版本" } as Record<string, string>
  )[kind] ?? kind;
}
