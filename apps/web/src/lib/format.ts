// 表示整形ユーティリティ（docs/15 3.3節: 所要・乗換数・徒歩量の3指標、7.2節: 数字の判読性）
import type { Leg } from "@norishiro/router";

const SECONDS_PER_DAY = 86400;

/** サービス日の秒をHH:MM表示にする。24時超え（GTFS方式）は「翌HH:MM」 */
export function formatClock(sec: number): string {
  const daySec = ((sec % SECONDS_PER_DAY) + SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const prefix = sec >= SECONDS_PER_DAY ? "翌" : "";
  const h = Math.floor(daySec / 3600);
  const m = Math.floor((daySec % 3600) / 60);
  return `${prefix}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 秒を「13分」「1時間5分」形式にする。1分未満は1分に切り上げ（0分と表示しない） */
export function formatDurationMin(sec: number): string {
  const minutes = Math.max(1, Math.round(sec / 60));
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

export type WalkAmount = "少" | "中" | "多";

/**
 * 徒歩量の3段階表示（docs/15 3.3節のワイヤーフレーム「徒歩 少/中/多」）。
 * 閾値はdocsに規定が無いためUI側の暫定値（300m/800m。800mはrouterの徒歩上限既定と同値）。
 * I-9の磨き込みで再調整の余地あり（docs/17 D-10）。
 */
export function walkAmountLabel(totalMeters: number): WalkAmount {
  if (totalMeters <= 300) return "少";
  if (totalMeters <= 800) return "中";
  return "多";
}

/** 経路内の徒歩レッグの合計距離（メートル） */
export function totalWalkMeters(legs: readonly Leg[]): number {
  return legs.reduce((sum, leg) => (leg.kind === "walk" ? sum + leg.distanceMeters : sum), 0);
}
