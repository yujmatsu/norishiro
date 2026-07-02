// Flex仮想レッグ注入（docs/13 4章）: 時間窓判定・所要時間推定・予約制約評価。
import { haversineMeters } from "./geo.js";
import { flexActiveBits, isBitSet } from "./load-shard.js";
import type {
  BookingRuleTable,
  DurationEstimatorParams,
  RaptorState,
  RouterShard,
  SearchTimeContext,
} from "./types.js";

/** 確定済み設計判断4の既定パラメータ（迂回係数1.4、時速22km、乗降バッファ5分） */
export const DEFAULT_ESTIMATOR_PARAMS: DurationEstimatorParams = {
  detourFactor: 1.4,
  averageSpeedMps: (22 * 1000) / 3600,
  boardingBufferSec: 300,
};

export function estimateDurationFromDistance(
  params: DurationEstimatorParams,
  distanceMeters: number,
): number {
  return (distanceMeters * params.detourFactor) / params.averageSpeedMps + params.boardingBufferSec;
}

export function estimateDurationBetween(
  params: DurationEstimatorParams,
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  return estimateDurationFromDistance(params, haversineMeters(lat1, lon1, lat2, lon2));
}

/** docs/13 4.3節の推定式そのまま（Haversine×迂回係数÷平均速度＋乗降バッファ） */
export function estimateFlexDuration(
  params: DurationEstimatorParams,
  shard: RouterShard,
  fromStopIdx: number,
  toStopIdx: number,
): number {
  return estimateDurationBetween(
    params,
    shard.stopLat[fromStopIdx]!,
    shard.stopLon[fromStopIdx]!,
    shard.stopLat[toStopIdx]!,
    shard.stopLon[toStopIdx]!,
  );
}

export function isFlexServiceActive(
  shard: RouterShard,
  flexTripIdx: number,
  serviceDate: number,
): boolean {
  return isBitSet(flexActiveBits(shard, serviceDate), flexTripIdx);
}

export interface BookingResult {
  feasible: boolean;
  deadlineSec?: number;
  reason?: string;
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 予約制約の評価（docs/13 4.4節）。「当日でない未来日の探索では締切情報のみ付与」 */
export function evaluateBooking(
  rules: BookingRuleTable,
  ruleIdx: number,
  boardingTimeSec: number,
  searchTime: SearchTimeContext,
  serviceDate: number,
): BookingResult {
  if (ruleIdx < 0) return { feasible: true }; // 予約ルールなし

  const type = rules.bookingType[ruleIdx]!;

  if (type === 0) return { feasible: true }; // リアルタイム予約: 締切なし

  if (type === 1) {
    const minutes = rules.priorNoticeDurationMin[ruleIdx]!;
    if (minutes < 0) {
      // 寛容パーサのフォールバック: 欠損時は締切不明として通す
      return { feasible: true, reason: "prior_notice_duration_min欠損のため締切判定不可" };
    }
    const deadlineSec = boardingTimeSec - minutes * 60;
    if (searchTime.serviceDate !== serviceDate) {
      return {
        feasible: true,
        deadlineSec,
        reason: "締切情報のみ（当日探索ではないため実行可能性には反映しない）",
      };
    }
    if (searchTime.nowSec > deadlineSec) {
      return {
        feasible: false,
        deadlineSec,
        reason: `締切(${formatTime(deadlineSec)})を過ぎているため予約不可`,
      };
    }
    return { feasible: true, deadlineSec };
  }

  if (type === 2) {
    const lastDay = rules.priorNoticeLastDayOffset[ruleIdx]!;
    const lastTime = rules.priorNoticeLastTimeSec[ruleIdx]!;
    if (lastDay < 0 || lastTime < 0) {
      return { feasible: true, reason: "prior_notice_last_day/last_time欠損のため締切判定不可" };
    }
    // サービス日0時を基準とした相対秒（lastDay日前のlastTime）
    const deadlineSec = lastTime - lastDay * 86400;
    if (searchTime.serviceDate !== serviceDate) {
      return { feasible: true, deadlineSec, reason: "締切情報のみ" };
    }
    if (searchTime.nowSec > deadlineSec) {
      return { feasible: false, deadlineSec, reason: "prior_notice_last_dayの締切を過ぎている" };
    }
    return { feasible: true, deadlineSec };
  }

  return { feasible: true }; // bookingType未定義の異常系（寛容フォールバック）
}

export interface FlexScanContext {
  serviceDate: number;
  searchTime: SearchTimeContext;
}

/**
 * Flex仮想レッグのスキャン（docs/13 4.2節）。
 *
 * 実装上の注記（docs/17 C-17参照）: docs/13 3.3節の擬似コードは「同一ラウンドの固定路線スキャン結果
 * （roundMarked）」を走査対象とするが、その方式では (1)出発直後のstopからFlexに乗る経路（ラウンド1、
 * 瑞穂町の主要ケース）が走査対象に入らない、(2)同一ラウンド内のバス→Flex連鎖がレッグ復元の
 * ラウンド整合性を壊す、という問題がある。本実装は固定路線スキャンと同じ「前ラウンド終了時点で
 * 到達済みのstop（sourceStops）」を走査対象とする厳密なラウンド意味論を採る。
 * Flexレッグが乗換1回を消費する仕様（docs/10 3.5節・T-FLEX-05）はこの方式で自然に満たされる。
 */
export function scanFlexLegs(
  shard: RouterShard,
  sourceStops: Iterable<number>,
  state: RaptorState,
  k: number,
  ctx: FlexScanContext,
  outMarked: Set<number>,
  targetPrune: number,
): void {
  const flex = shard.flex;
  if (flex === null) return;
  const tauPrev = state.tauRounds[k - 1]!;
  const tauCur = state.tauRounds[k]!;
  const legs = state.legs[k]!;

  for (const stopIdx of sourceStops) {
    const tArrival = tauPrev[stopIdx]!;
    if (!Number.isFinite(tArrival)) continue;

    for (let gi = flex.stopGroupsStart[stopIdx]!; gi < flex.stopGroupsStart[stopIdx + 1]!; gi++) {
      const groupIdx = flex.stopGroups[gi]!;

      for (
        let fi = flex.groupFlexTripsStart[groupIdx]!;
        fi < flex.groupFlexTripsStart[groupIdx + 1]!;
        fi++
      ) {
        const flexTripIdx = flex.groupFlexTrips[fi]!;
        if (!isFlexServiceActive(shard, flexTripIdx, ctx.serviceDate)) continue;

        // 時間窓判定その1: 乗車が窓内か
        if (
          tArrival < flex.pickupWindowStart[flexTripIdx]! ||
          tArrival > flex.pickupWindowEnd[flexTripIdx]!
        ) {
          continue;
        }

        // 予約制約判定（乗車側ルール）。乗車時刻はグループ内の全ペアで共通のため先に評価する
        const booking = evaluateBooking(
          flex.bookingRules,
          flex.pickupBookingRuleIdx[flexTripIdx]!,
          tArrival,
          ctx.searchTime,
          ctx.serviceDate,
        );
        if (!booking.feasible) continue;

        // 中間の時間窓レコード無視ルール（docs/10 2.6節）: groupStopsは平坦な集合であり、
        // 中間行という概念を最初から持たない（docs/13 4.2節）
        for (
          let si = flex.groupStopsStart[groupIdx]!;
          si < flex.groupStopsStart[groupIdx + 1]!;
          si++
        ) {
          const otherStopIdx = flex.groupStops[si]!;
          if (otherStopIdx === stopIdx) continue;

          const durationSec = estimateFlexDuration(
            flex.durationEstimatorParams,
            shard,
            stopIdx,
            otherStopIdx,
          );
          const tDropoff = tArrival + durationSec;

          // 時間窓判定その2: 降車推定時刻も窓内に収まること
          if (
            tDropoff < flex.dropoffWindowStart[flexTripIdx]! ||
            tDropoff > flex.dropoffWindowEnd[flexTripIdx]!
          ) {
            continue;
          }

          if (tDropoff < tauCur[otherStopIdx]! && tDropoff < targetPrune) {
            tauCur[otherStopIdx] = tDropoff;
            if (tDropoff < state.tauBest[otherStopIdx]!) state.tauBest[otherStopIdx] = tDropoff;
            outMarked.add(otherStopIdx);
            legs[otherStopIdx] = {
              kind: "flex",
              flexTripIdx,
              groupIdx,
              fromStopIdx: stopIdx,
              toStopIdx: otherStopIdx,
              departSec: tArrival,
              arriveSec: tDropoff,
              pickupBookingRuleIdx: flex.pickupBookingRuleIdx[flexTripIdx]!,
              dropoffBookingRuleIdx: flex.dropoffBookingRuleIdx[flexTripIdx]!,
              bookingDeadlineSec: booking.deadlineSec,
              round: k,
            };
          }
        }
      }
    }
  }
}
