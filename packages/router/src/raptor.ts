// RAPTOR本体（docs/13 3章の擬似コードを実装）。
// ホットパスは文字列比較・オブジェクト生成を行わず、StopIdx/RouteIdx/TripIdxの数値のみで動作する（9.1節）。
import { scanFlexLegs } from "./flex.js";
import { isBitSet, tripActiveBits } from "./load-shard.js";
import type { AccessLegSet, RaptorState, RouterShard, SearchTimeContext } from "./types.js";

export const DEFAULT_MAX_TRANSFERS = 6;

/** 初期化（docs/13 3.2節）: accessで到達可能なstopにτを設定する */
export function initialize(
  shard: RouterShard,
  source: AccessLegSet,
  departureTime: number,
): RaptorState {
  const tau0 = new Float64Array(shard.stopCount).fill(Infinity);
  const tauBest = new Float64Array(shard.stopCount).fill(Infinity);
  const legs0: RaptorState["legs"][number] = new Array<undefined>(shard.stopCount);
  const marked = new Set<number>();

  for (const { stopIdx, walkSec, distanceM } of source.reachableStops) {
    const arrival = departureTime + walkSec;
    if (arrival < tau0[stopIdx]!) {
      tau0[stopIdx] = arrival;
      tauBest[stopIdx] = arrival;
      marked.add(stopIdx);
      legs0[stopIdx] = {
        kind: "walk",
        access: true,
        fromStopIdx: -1,
        toStopIdx: stopIdx,
        walkSec,
        distanceM,
        round: 0,
      };
    }
  }
  return { tauBest, tauRounds: [tau0], legs: [legs0], marked };
}

export function ensureRound(state: RaptorState, k: number, stopCount: number): void {
  if (state.tauRounds[k] === undefined) {
    state.tauRounds[k] = state.tauRounds[k - 1]!.slice();
    state.legs[k] = state.legs[k - 1]!.slice();
  }
  void stopCount;
}

/** markedStopsを経由するrouteと、その中で最小の乗車検討開始位置を集める（docs/13 3.3節のQ） */
function collectRoutesServing(shard: RouterShard, marked: Set<number>): Map<number, number> {
  const q = new Map<number, number>();
  for (const stopIdx of marked) {
    for (let i = shard.stopRoutesStart[stopIdx]!; i < shard.stopRoutesStart[stopIdx + 1]!; i++) {
      const routeIdx = shard.stopRoutes[i]!;
      // route内でのこのstopの位置（同一stopが複数回現れる場合は最初の位置）
      const start = shard.routeStopsStart[routeIdx]!;
      const end = shard.routeStopsStart[routeIdx + 1]!;
      for (let s = start; s < end; s++) {
        if (shard.routeStops[s] === stopIdx) {
          const seqIdx = s - start;
          const existing = q.get(routeIdx);
          if (existing === undefined || seqIdx < existing) q.set(routeIdx, seqIdx);
          break;
        }
      }
    }
  }
  return q;
}

function stopTimeArrival(shard: RouterShard, tripIdx: number, seqIdx: number): number {
  return shard.stopTimesArrival[shard.tripStopTimesOffset[tripIdx]! + seqIdx]!;
}

function stopTimeDeparture(shard: RouterShard, tripIdx: number, seqIdx: number): number {
  return shard.stopTimesDeparture[shard.tripStopTimesOffset[tripIdx]! + seqIdx]!;
}

/** seqIdx位置でtime以降に出発する最速のアクティブなtripを探す（routeTripsは出発時刻順ソート済み） */
function earliestTripDepartingAtOrAfter(
  shard: RouterShard,
  routeIdx: number,
  seqIdx: number,
  time: number,
  activeBits: Uint8Array,
): number {
  for (let i = shard.routeTripsStart[routeIdx]!; i < shard.routeTripsStart[routeIdx + 1]!; i++) {
    const tripIdx = shard.routeTrips[i]!;
    if (!isBitSet(activeBits, tripIdx)) continue;
    if (stopTimeDeparture(shard, tripIdx, seqIdx) >= time) return tripIdx;
  }
  return -1;
}

/** 1routeのスキャン（docs/13 3.3節のscanRoute） */
function scanRoute(
  shard: RouterShard,
  routeIdx: number,
  boardFromSeqIdx: number,
  state: RaptorState,
  k: number,
  targetPrune: number,
  roundMarked: Set<number>,
  activeBits: Uint8Array,
): void {
  const stopsStart = shard.routeStopsStart[routeIdx]!;
  const stopsEnd = shard.routeStopsStart[routeIdx + 1]!;
  const tauPrev = state.tauRounds[k - 1]!;
  const tauCur = state.tauRounds[k]!;
  const legs = state.legs[k]!;

  let currentTrip = -1;
  let boardedAtSeqIdx = -1;

  for (let seqIdx = boardFromSeqIdx; seqIdx < stopsEnd - stopsStart; seqIdx++) {
    const stopIdx = shard.routeStops[stopsStart + seqIdx]!;

    // (i) 乗車中とみなしているtripでの到着改善判定
    if (currentTrip >= 0) {
      const arrivalSec = stopTimeArrival(shard, currentTrip, seqIdx);
      if (arrivalSec < Math.min(tauCur[stopIdx]!, targetPrune)) {
        tauCur[stopIdx] = arrivalSec;
        if (arrivalSec < state.tauBest[stopIdx]!) state.tauBest[stopIdx] = arrivalSec;
        roundMarked.add(stopIdx);
        legs[stopIdx] = {
          kind: "transit",
          tripIdx: currentTrip,
          routeIdx,
          boardStopIdx: shard.routeStops[stopsStart + boardedAtSeqIdx]!,
          alightStopIdx: stopIdx,
          boardSeqIdx: boardedAtSeqIdx,
          alightSeqIdx: seqIdx,
          departSec: stopTimeDeparture(shard, currentTrip, boardedAtSeqIdx),
          arriveSec: arrivalSec,
          round: k,
        };
      }
    }

    // (ii) この停留所でより早いtripに乗り換えられるか（前ラウンド到達時刻から判定）
    const prevArrival = tauPrev[stopIdx]!;
    if (Number.isFinite(prevArrival)) {
      const bound = currentTrip >= 0 ? stopTimeDeparture(shard, currentTrip, seqIdx) : Infinity;
      if (prevArrival <= bound) {
        const candidate = earliestTripDepartingAtOrAfter(
          shard,
          routeIdx,
          seqIdx,
          prevArrival,
          activeBits,
        );
        if (
          candidate >= 0 &&
          (currentTrip < 0 ||
            stopTimeDeparture(shard, candidate, seqIdx) <
              stopTimeDeparture(shard, currentTrip, seqIdx))
        ) {
          currentTrip = candidate;
          boardedAtSeqIdx = seqIdx;
        }
      }
    }
  }
}

/** 徒歩transferの緩和（docs/13 5.3節）。乗換回数を消費しない同一ラウンド内の緩和 */
function relaxTransfers(
  shard: RouterShard,
  roundMarked: Set<number>,
  state: RaptorState,
  k: number,
): void {
  const tauCur = state.tauRounds[k]!;
  const legs = state.legs[k]!;
  const queue = [...roundMarked];
  while (queue.length > 0) {
    const stopIdx = queue.pop()!;
    for (let i = shard.transfersStart[stopIdx]!; i < shard.transfersStart[stopIdx + 1]!; i++) {
      const target = shard.transfersTo[i]!;
      const candidate = tauCur[stopIdx]! + shard.transfersDurationSec[i]!;
      if (candidate < tauCur[target]!) {
        tauCur[target] = candidate;
        if (candidate < state.tauBest[target]!) state.tauBest[target] = candidate;
        roundMarked.add(target);
        queue.push(target);
        legs[target] = {
          kind: "walk",
          access: false,
          fromStopIdx: stopIdx,
          toStopIdx: target,
          walkSec: shard.transfersDurationSec[i]!,
          distanceM: shard.transfersDistanceM[i]!,
          round: k,
        };
      }
    }
  }
}

export interface EgressTarget {
  stopIdx: number;
  walkSec: number;
  distanceM: number;
}

export interface RunOptions {
  access: AccessLegSet;
  departureTime: number;
  serviceDate: number;
  maxTransfers: number;
  searchTime: SearchTimeContext;
  /** 目的地枝刈りの初期値（isochroneではcutoff上限、planではegress初期評価） */
  targetPruneInit: number;
  egress?: EgressTarget[];
}

export interface RunResult {
  state: RaptorState;
  roundsExecuted: number;
}

/** ラウンド処理本体（docs/13 3.3節のrun()） */
export function runRaptor(shard: RouterShard, opts: RunOptions): RunResult {
  const state = initialize(shard, opts.access, opts.departureTime);
  const activeBits = tripActiveBits(shard, opts.serviceDate);
  const flexCtx = { serviceDate: opts.serviceDate, searchTime: opts.searchTime };

  let targetPrune = opts.targetPruneInit;
  const updatePrune = (k: number): void => {
    if (!opts.egress) return;
    const tau = state.tauRounds[k]!;
    for (const e of opts.egress) {
      const arrival = tau[e.stopIdx]! + e.walkSec;
      if (arrival < targetPrune) targetPrune = arrival;
    }
  };
  updatePrune(0);

  let roundsExecuted = 0;
  for (let k = 1; k <= opts.maxTransfers; k++) {
    if (state.marked.size === 0) break; // 打ち切り: これ以上改善する見込みがない
    roundsExecuted++;

    ensureRound(state, k, shard.stopCount);
    const sourceStops = state.marked;
    const roundMarked = new Set<number>();

    // (a) 固定路線tripのスキャン
    const q = collectRoutesServing(shard, sourceStops);
    for (const [routeIdx, boardFromSeqIdx] of q) {
      scanRoute(shard, routeIdx, boardFromSeqIdx, state, k, targetPrune, roundMarked, activeBits);
    }

    // (b) Flexレッグのスキャン（docs/13 4章。走査起点はflex.tsの注記どおり前ラウンド到達stop）
    scanFlexLegs(shard, sourceStops, state, k, flexCtx, roundMarked, targetPrune);

    // (c) 徒歩transferの緩和
    relaxTransfers(shard, roundMarked, state, k);

    updatePrune(k);
    state.marked = roundMarked;
  }

  return { state, roundsExecuted };
}
