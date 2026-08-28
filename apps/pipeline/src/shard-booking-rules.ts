// Normalized層のbooking_rules → シャード契約のCompressedBookingRules（docs/12 4.4節）。
//
// schemaVersion 2 で予約ルールはシャードのトップレベルへ移した。Flexレッグ（location_group型）と
// 予約制の定時便（停留所型、docs/17 C-24）が同じテーブルを参照するため、正本は1箇所に置く。
import type { NormalizedBookingRule, Shard } from "@norishiro/types";

/** GtfsTime（0時からの秒）→ シャード契約の"HH:MM:SS"表記。24時超えも桁を切らずに保つ */
export function formatGtfsTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (v: number): string => String(v).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export interface CompressedBookingRulesResult {
  /** シャードのトップレベルに載せる予約ルール表。ルールが1件も無ければnull */
  bookingRules: Shard["bookingRules"];
  /** booking_rule_id → bookingRules配列内の添字 */
  ruleIdxOf: Map<string, number>;
}

/**
 * 予約ルールをシャードの列指向表現へ変換する。
 * ルールIDの並びは入力Mapの挿入順（=フィードの行順）をそのまま使い、ビルドの決定性を保つ。
 */
export function compressBookingRules(
  rules: Map<string, NormalizedBookingRule>,
): CompressedBookingRulesResult {
  const ruleIds = [...rules.keys()];
  const ruleIdxOf = new Map(ruleIds.map((id, i) => [id, i]));
  if (ruleIds.length === 0) return { bookingRules: null, ruleIdxOf };

  const at = (id: string): NormalizedBookingRule => rules.get(id)!;
  return {
    ruleIdxOf,
    bookingRules: {
      bookingRuleId: ruleIds,
      bookingType: ruleIds.map((id) => at(id).bookingType),
      priorNoticeDurationMin: ruleIds.map((id) => at(id).priorNoticeDurationMin ?? null),
      priorNoticeDurationMax: ruleIds.map((id) => at(id).priorNoticeDurationMax ?? null),
      priorNoticeLastDay: ruleIds.map((id) => at(id).priorNoticeLastDay ?? null),
      priorNoticeLastTime: ruleIds.map((id) => {
        const t = at(id).priorNoticeLastTime;
        return t === undefined ? null : formatGtfsTime(t);
      }),
      message: ruleIds.map((id) => at(id).message ?? null),
      phoneNumber: ruleIds.map((id) => at(id).phoneNumber ?? null),
      infoUrl: ruleIds.map((id) => at(id).infoUrl ?? null),
    },
  };
}
