// 探索オーケストレーション（docs/15 4.2節・4.4節）。
// routerは当日探索で予約締切超過のFlexレッグを候補から除外する（docs/13 4.4節）。
// 「この便は予約締切を過ぎています。次の候補…」の表示には除外された便の情報が必要なため、
// UI層で (1)厳密探索 → (2)予約制約無視の再探索（差分検出） → (3)出発をずらした再探索（代替提示）
// の最大3回のplan()を組み合わせる。plan()は1回1ms前後（packages/router/PERF.md）で追加コストは無視できる。
import type { FlexLeg, Itinerary, LocationRef, PlanRequest } from "@norishiro/router";

export interface PlanClient {
  plan(req: PlanRequest): Promise<Itinerary[]>;
}

export interface SearchNow {
  serviceDate: number;
  nowSec: number;
}

export interface SearchParams {
  origin: LocationRef;
  destination: LocationRef;
  serviceDate: number;
  departureTime: number;
  now: SearchNow;
}

/** 当日探索で予約締切超過により除外されたFlex便（docs/15 4.2節の打ち切り表示用） */
export interface MissedFlexNotice {
  departureTime: number;
  deadlineSec: number;
}

export interface SearchOutcome {
  /** 予約制約を満たす候補（所要時間昇順） */
  itineraries: Itinerary[];
  missedFlex?: MissedFlexNotice;
  /** 出発をずらせば予約に間に合うFlex候補（docs/15 4.4節の代替提示用） */
  shiftedFlex?: { itinerary: Itinerary; searchedDeparture: number };
}

/** シフト探索の余裕（締切ぎりぎりの候補を提示しないための最低マージン） */
const SHIFT_MARGIN_SEC = 15 * 60;
/** シフト探索の出発時刻はきりの良い5分単位に切り上げる */
const ROUND_UNIT_SEC = 5 * 60;

function hasFlexLeg(itinerary: Itinerary): boolean {
  return itinerary.legs.some((leg) => leg.kind === "flex");
}

function firstFlexLeg(itinerary: Itinerary): FlexLeg | undefined {
  return itinerary.legs.find((leg): leg is FlexLeg => leg.kind === "flex");
}

function sortByDuration(itineraries: readonly Itinerary[]): Itinerary[] {
  return [...itineraries].sort(
    (a, b) =>
      a.summary.durationSec - b.summary.durationSec ||
      a.summary.transferCount - b.summary.transferCount,
  );
}

export async function runSearch(client: PlanClient, params: SearchParams): Promise<SearchOutcome> {
  const strictReq: PlanRequest = {
    origin: params.origin,
    destination: params.destination,
    departureTime: params.departureTime,
    serviceDate: params.serviceDate,
    searchTime: params.now,
  };
  const itineraries = sortByDuration(await client.plan(strictReq));

  // 未来日の探索はrouterが締切情報のみ付与する（除外しない）ため差分検出は不要
  if (params.now.serviceDate !== params.serviceDate) return { itineraries };
  // 予約可能なFlex候補が既にあるなら、締切超過で消えた便は存在しない
  if (itineraries.some(hasFlexLeg)) return { itineraries };

  // 予約制約無視で再探索（isochroneと同じ扱い: serviceDate=-1で当日判定を発火させない）
  const agnostic = await client.plan({
    ...strictReq,
    searchTime: { serviceDate: -1, nowSec: 0 },
  });
  const missedLeg = sortByDuration(agnostic)
    .filter(hasFlexLeg)
    .map(firstFlexLeg)
    .find(
      (leg): leg is FlexLeg & { booking: { deadline: number } } =>
        leg !== undefined &&
        leg.booking.deadline !== undefined &&
        leg.booking.deadline < params.now.nowSec,
    );
  if (missedLeg === undefined) return { itineraries };

  // 事前通知時間（乗車時刻−締切）ぶん出発を遅らせれば予約に間に合う。余裕を上乗せして再探索
  const priorNoticeSec = missedLeg.departureTime - missedLeg.booking.deadline;
  const shiftedDeparture =
    Math.ceil((params.now.nowSec + priorNoticeSec + SHIFT_MARGIN_SEC) / ROUND_UNIT_SEC) *
    ROUND_UNIT_SEC;
  const shifted = sortByDuration(
    await client.plan({ ...strictReq, departureTime: shiftedDeparture }),
  );
  const shiftedItinerary = shifted.find(hasFlexLeg);

  return {
    itineraries,
    missedFlex: {
      departureTime: missedLeg.departureTime,
      deadlineSec: missedLeg.booking.deadline,
    },
    shiftedFlex:
      shiftedItinerary === undefined
        ? undefined
        : { itinerary: shiftedItinerary, searchedDeparture: shiftedDeparture },
  };
}
