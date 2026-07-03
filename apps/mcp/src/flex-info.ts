// Flexサービス概要・予約ルールの導出（docs/14 3.3節・3.4節）。
// シャードJSONのflexデータ（docs/12 4章）から、LLM向けの概要文字列と
// そのまま利用者に提示できる案内文（spokenGuidance）を組み立てる。

import type { Shard } from "@norishiro/types";
import { ToolError } from "./errors.js";
import type { ShardRegistryEntry } from "./registry.js";
import { formatHHMM, operatingDaysSummary } from "./time.js";

export interface FlexServiceSummary {
  /** get_booking_rules呼び出し時に指定する識別子。locationGroupId:tripId */
  serviceId: string;
  locationGroupId: string;
  serviceName: string | null;
  providerName: string;
  operatingDaysSummary: string;
  timeWindowSummary: string;
  bookingSummary: string;
  memberStopCount: number;
}

export interface PriorNoticeRule {
  kind: "same_day_minutes_before" | "prior_days" | "real_time" | "unknown";
  minutesBefore?: number;
  lastDayOffset?: number;
  lastTime?: string;
}

export interface BookingRulesDetail {
  serviceId: string;
  bookingType: 0 | 1 | 2;
  phoneNumber: string | null;
  priorNoticeRule: PriorNoticeRule;
  infoUrl: string | null;
  bookingUrl: string | null;
  spokenGuidance: string;
}

interface FlexTripRef {
  flexIdx: number;
  tripIdx: number;
  groupIdx: number;
}

function flexTripRefs(shard: Shard): FlexTripRef[] {
  const flex = shard.flex;
  if (flex === null) return [];
  return flex.flexTrips.tripIdx.map((tripIdx, flexIdx) => ({
    flexIdx,
    tripIdx,
    groupIdx: flex.flexTrips.locationGroupIdx[flexIdx]!,
  }));
}

function priorNoticeRuleOf(shard: Shard, ruleIdx: number | null): PriorNoticeRule {
  const rules = shard.flex?.bookingRules;
  if (rules === undefined || ruleIdx === null) return { kind: "unknown" };
  const type = rules.bookingType[ruleIdx];
  if (type === 0) return { kind: "real_time" };
  if (type === 1) {
    const minutes = rules.priorNoticeDurationMin[ruleIdx];
    if (minutes === null || minutes === undefined) return { kind: "unknown" };
    return { kind: "same_day_minutes_before", minutesBefore: minutes };
  }
  if (type === 2) {
    const rule: PriorNoticeRule = { kind: "prior_days" };
    const lastDay = rules.priorNoticeLastDay[ruleIdx];
    const lastTime = rules.priorNoticeLastTime[ruleIdx];
    if (lastDay !== null && lastDay !== undefined) rule.lastDayOffset = lastDay;
    if (lastTime !== null && lastTime !== undefined) rule.lastTime = lastTime;
    return rule;
  }
  return { kind: "unknown" };
}

function bookingSummaryOf(rule: PriorNoticeRule): string {
  switch (rule.kind) {
    case "real_time":
      return "予約不要（リアルタイム乗車可）";
    case "same_day_minutes_before":
      return `乗車${String(rule.minutesBefore)}分前までに予約が必要`;
    case "prior_days":
      return "前日以前の事前予約が必要";
    case "unknown":
      return "予約条件はget_booking_rulesで確認";
  }
}

/** シャード内の全Flexサービス概要（docs/14 3.3節）。tripごとに1サービスとして列挙する */
export function listFlexServices(shard: Shard, entry: ShardRegistryEntry): FlexServiceSummary[] {
  const flex = shard.flex;
  if (flex === null) return [];
  return flexTripRefs(shard).map((ref) => {
    const groupId = flex.locationGroups.locationGroupId[ref.groupIdx]!;
    const tripId = shard.trips.tripId[ref.tripIdx]!;
    const routeIdx = shard.trips.routeIdx[ref.tripIdx]!;
    const feedId = shard.routes.sourceFeedId[routeIdx]!;
    const serviceName =
      shard.routes.routeLongName[routeIdx] ??
      shard.routes.routeShortName[routeIdx] ??
      flex.locationGroups.locationGroupName[ref.groupIdx] ??
      null;
    const rule = priorNoticeRuleOf(shard, flex.flexTrips.pickupBookingRuleIdx[ref.flexIdx]!);
    return {
      serviceId: `${groupId}:${tripId}`,
      locationGroupId: groupId,
      serviceName,
      providerName: entry.providerNameByFeedId[feedId] ?? feedId,
      operatingDaysSummary: operatingDaysSummary(shard.trips.serviceDates[ref.tripIdx] ?? []),
      timeWindowSummary: `${formatHHMM(flex.flexTrips.windowStartSec[ref.flexIdx]!)}-${formatHHMM(
        flex.flexTrips.windowEndSec[ref.flexIdx]!,
      )}`,
      bookingSummary: bookingSummaryOf(rule),
      memberStopCount: flex.locationGroups.memberStopIdx[ref.groupIdx]?.length ?? 0,
    };
  });
}

/** serviceId（locationGroupId:tripId）から予約ルール詳細を解決する（docs/14 3.4節） */
export function getBookingRules(shard: Shard, serviceId: string): BookingRulesDetail {
  const sep = serviceId.indexOf(":");
  const flex = shard.flex;
  if (sep <= 0 || sep === serviceId.length - 1 || flex === null) {
    throw new ToolError(
      "INVALID_INPUT",
      `serviceId「${serviceId}」の形式が正しくありません。list_flex_servicesが返すserviceId（例: mizuhomachi_group:east_trip）を指定してください。`,
    );
  }
  const groupId = serviceId.slice(0, sep);
  const tripId = serviceId.slice(sep + 1);
  const ref = flexTripRefs(shard).find(
    (r) =>
      flex.locationGroups.locationGroupId[r.groupIdx] === groupId &&
      shard.trips.tripId[r.tripIdx] === tripId,
  );
  if (ref === undefined) {
    throw new ToolError(
      "INVALID_INPUT",
      `serviceId「${serviceId}」に該当するデマンド交通サービスが見つかりません。list_flex_servicesでサービス一覧を確認してください。`,
    );
  }
  const ruleIdx = flex.flexTrips.pickupBookingRuleIdx[ref.flexIdx]!;
  const rule = priorNoticeRuleOf(shard, ruleIdx);
  const rules = flex.bookingRules;
  const bookingTypeRaw = ruleIdx !== null ? (rules.bookingType[ruleIdx] ?? 1) : 1;
  const bookingType: 0 | 1 | 2 = bookingTypeRaw === 0 || bookingTypeRaw === 2 ? bookingTypeRaw : 1;
  const message = ruleIdx !== null ? (rules.message[ruleIdx] ?? null) : null;
  const phoneNumber = ruleIdx !== null ? (rules.phoneNumber[ruleIdx] ?? null) : null;
  const infoUrl = ruleIdx !== null ? (rules.infoUrl[ruleIdx] ?? null) : null;

  // spokenGuidanceはbooking_rules.txtのmessage列を正本とし、言い換え・要約をしない
  // （docs/14 3.4節、CLAUDE.md Don't）。message欠損時のみ構造化列から定型文を組み立てる。
  const spokenGuidance =
    message ??
    (rule.kind === "same_day_minutes_before"
      ? `ご利用の${String(rule.minutesBefore)}分前までに予約が必要です。${
          phoneNumber !== null ? `予約電話番号は${phoneNumber}です。` : ""
        }`
      : "予約方法の詳細は運行事業者にお問い合わせください。");

  return {
    serviceId,
    bookingType,
    phoneNumber,
    priorNoticeRule: rule,
    infoUrl,
    bookingUrl: null, // シャード契約（docs/12 4章）にbooking_url列が無いためv1では常にnull
    spokenGuidance,
  };
}
