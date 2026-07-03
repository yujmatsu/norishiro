// 時刻変換ユーティリティ。MCP入力のISO 8601日時（オフセット必須、docs/14 3.1節）を、
// packages/routerの契約（serviceDate: YYYYMMDD ＋ サービス日0時からの秒、docs/13 8章）へ変換する。
// 日本の公共交通データが前提のため、壁時計はJST（UTC+9）に正規化する。

import { ToolError } from "./errors.js";

export interface ServiceDateTime {
  /** YYYYMMDD（JST基準） */
  serviceDate: number;
  /** サービス日0時からの秒（JST基準） */
  secOfDay: number;
}

const JST_OFFSET_MS = 9 * 3600 * 1000;

/** タイムゾーンオフセット（Z or ±hh:mm）を末尾に持つことの検査（docs/14 3.1節: オフセット必須） */
const OFFSET_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/;

/** ISO 8601（オフセット付き）をJST壁時計のserviceDate+秒へ変換する。不正形式はINVALID_INPUT */
export function parseDepartureTime(iso: string): ServiceDateTime {
  const epochMs = OFFSET_PATTERN.test(iso) ? Date.parse(iso) : NaN;
  if (Number.isNaN(epochMs)) {
    throw new ToolError(
      "INVALID_INPUT",
      `departureTimeの形式が正しくありません。ISO 8601形式（例: 2026-07-07T09:00:00+09:00、タイムゾーンオフセット必須）で指定してください。`,
      `受け取った値: ${iso}`,
    );
  }
  const jst = new Date(epochMs + JST_OFFSET_MS);
  return {
    serviceDate: jst.getUTCFullYear() * 10000 + (jst.getUTCMonth() + 1) * 100 + jst.getUTCDate(),
    secOfDay: jst.getUTCHours() * 3600 + jst.getUTCMinutes() * 60 + jst.getUTCSeconds(),
  };
}

const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const; // 月曜始まりで表示する

/** カレンダー展開済み運行日（YYYY-MM-DD配列）から「火・金・土」形式の曜日概要を作る（docs/14 3.3節） */
export function operatingDaysSummary(serviceDates: readonly string[]): string {
  const present = new Set<number>();
  for (const d of serviceDates) {
    present.add(new Date(`${d}T00:00:00Z`).getUTCDay());
  }
  if (present.size === 7) return "毎日";
  const labels = WEEKDAY_ORDER.filter((w) => present.has(w)).map((w) => WEEKDAY_LABELS[w]);
  return labels.length === 0 ? "運行日なし" : labels.join("・");
}

/** サービス日秒を"HH:MM"へ（時間窓概要の表示用） */
export function formatHHMM(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
