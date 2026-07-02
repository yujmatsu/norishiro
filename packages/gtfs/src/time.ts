// GTFS時刻のパース。深夜0時からの経過秒数として表現する（docs/10 2.5節）。
// GTFSの時刻は"24:00:00"を超える値（翌日にまたがる運行）を許容する。
import type { GtfsTime } from "@norishiro/types";

/** 1日分の秒数（終日利用可能ウィンドウ 00:00:00-24:00:00 の終端に使う） */
export const SECONDS_PER_DAY: GtfsTime = 24 * 3600;

const TIME_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/;

/**
 * "HH:MM:SS"（"H:MM:SS"や24時超も許容）をGtfsTimeに変換する。
 * 形式に合わない値・空値はundefinedを返す（例外を投げない）。
 */
export function parseGtfsTime(value: string | undefined): GtfsTime | undefined {
  if (value === undefined) return undefined;
  const m = TIME_PATTERN.exec(value.trim());
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}
