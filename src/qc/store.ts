// 本机保存：localStorage 持久化 + 全部状态变更动作
import { useCallback, useEffect, useState } from "react";
import { judgeEntry, todayStr } from "./judge";
import type {
  Device,
  ExamRecord,
  ExamVersion,
  EyeSide,
  Patient,
  QcState,
  Reading,
} from "./types";

const STORAGE_KEY = "hxwl11-qc-state-v1";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 初始演示数据：一台校准过期设备 + 一条因过期/跨度被拦截的待复核记录 */
function seedState(): QcState {
  const today = todayStr();
  const expired = new Date();
  expired.setDate(expired.getDate() - 30);
  const expiredStr = todayStr(expired);
  const nextYear = new Date();
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  const validStr = todayStr(nextYear);

  const devices: Device[] = [
    { id: "DEV-AR01", name: "自动验光仪 AR-01", calibrateUntil: expiredStr },
    { id: "DEV-AR02", name: "自动验光仪 AR-02", calibrateUntil: validStr },
    { id: "DEV-PH01", name: "综合验光仪 PH-01", calibrateUntil: validStr },
  ];

  const patients: Patient[] = [
    { id: "Patient-032", name: "Patient-032", ageGroup: "儿童", note: "近视随访", createdAt: today },
    { id: "Patient-081", name: "Patient-081", ageGroup: "成人", note: "渐进片初配", createdAt: today },
  ];

  const demoVersion: ExamVersion = {
    id: uid("ver"),
    versionNo: 1,
    eye: "OD",
    deviceId: "DEV-AR01",
    readings: [
      { sphere: -2.75, cylinder: -0.5, axis: 178 },
      { sphere: -2.75, cylinder: -0.5, axis: 180 },
      { sphere: -3.0, cylinder: -0.5, axis: 4 },
    ],
    failReasons: [],
    reviewNote: null,
    createdAt: new Date().toISOString(),
  };
  demoVersion.failReasons = judgeEntry(devices[0], demoVersion.readings, today);

  const records: ExamRecord[] = [
    {
      id: uid("rec"),
      patientId: "Patient-032",
      eye: "OD",
      status: "pending_review",
      currentVersionId: demoVersion.id,
      issuedAt: null,
      versions: [demoVersion],
      createdAt: new Date().toISOString(),
    },
  ];

  return { patients, devices, records };
}

function loadState(): QcState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as QcState;
      if (parsed && Array.isArray(parsed.patients) && Array.isArray(parsed.records)) {
        return parsed;
      }
    }
  } catch {
    // 本地数据损坏时回落到初始数据，不阻塞页面
  }
  return seedState();
}

export interface EntryInput {
  patientId: string;
  eye: EyeSide;
  deviceId: string;
  readings: [Reading, Reading, Reading];
}

export function useQcStore() {
  const [state, setState] = useState<QcState>(loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  /** 录入三次读数：判定不通过只存待复核，通过则直接出方 */
  const submitEntry = useCallback((input: EntryInput) => {
    setState((prev) => {
      const device = prev.devices.find((d) => d.id === input.deviceId);
      const failReasons = judgeEntry(device, input.readings);
      const passed = failReasons.length === 0;
      const version: ExamVersion = {
        id: uid("ver"),
        versionNo: 1,
        eye: input.eye,
        deviceId: input.deviceId,
        readings: input.readings,
        failReasons,
        reviewNote: passed ? "判定通过，直接出方" : null,
        createdAt: new Date().toISOString(),
      };
      const record: ExamRecord = {
        id: uid("rec"),
        patientId: input.patientId,
        eye: input.eye,
        status: passed ? "issued" : "pending_review",
        currentVersionId: version.id,
        issuedAt: passed ? new Date().toISOString() : null,
        versions: [version],
        createdAt: new Date().toISOString(),
      };
      return { ...prev, records: [record, ...prev.records] };
    });
  }, []);

  /**
   * 重测 / 另开版本：
   * - 待复核记录：追加新版本；
   * - 已出方记录：另开新版本并退回待复核，原出方版本继续保留在历史中。
   */
  const submitRetest = useCallback((recordId: string, input: EntryInput) => {
    setState((prev) => ({
      ...prev,
      records: prev.records.map((rec) => {
        if (rec.id !== recordId) return rec;
        const device = prev.devices.find((d) => d.id === input.deviceId);
        const failReasons = judgeEntry(device, input.readings);
        const version: ExamVersion = {
          id: uid("ver"),
          versionNo: rec.versions.length + 1,
          eye: input.eye,
          deviceId: input.deviceId,
          readings: input.readings,
          failReasons,
          reviewNote: null,
          createdAt: new Date().toISOString(),
        };
        return {
          ...rec,
          versions: [...rec.versions, version],
          currentVersionId: version.id,
          status: "pending_review" as const,
          issuedAt: null,
        };
      }),
    }));
  }, []);

  /** 复核通过并出方：要求当前版本判定通过，出方后锁定 */
  const approveRecord = useCallback((recordId: string, note: string) => {
    setState((prev) => ({
      ...prev,
      records: prev.records.map((rec) => {
        if (rec.id !== recordId || rec.status !== "pending_review") return rec;
        const current = rec.versions.find((v) => v.id === rec.currentVersionId);
        if (!current || current.failReasons.length > 0) return rec;
        const versions = rec.versions.map((v) =>
          v.id === current.id ? { ...v, reviewNote: note || "复核通过" } : v
        );
        return {
          ...rec,
          versions,
          status: "issued" as const,
          issuedAt: new Date().toISOString(),
        };
      }),
    }));
  }, []);

  /** 设备校准续期 */
  const renewDevice = useCallback((deviceId: string, until: string) => {
    setState((prev) => ({
      ...prev,
      devices: prev.devices.map((d) =>
        d.id === deviceId ? { ...d, calibrateUntil: until } : d
      ),
    }));
  }, []);

  /** 新增患者档案 */
  const addPatient = useCallback((name: string, ageGroup: string, note: string) => {
    setState((prev) => {
      const id = `Patient-${String(prev.patients.length + 1).padStart(3, "0")}-${Math.random()
        .toString(36)
        .slice(2, 5)}`;
      const patient: Patient = {
        id,
        name: name || id,
        ageGroup,
        note,
        createdAt: todayStr(),
      };
      return { ...prev, patients: [...prev.patients, patient] };
    });
  }, []);

  return { state, submitEntry, submitRetest, approveRecord, renewDevice, addPatient };
}
