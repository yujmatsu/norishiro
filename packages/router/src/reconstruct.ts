// Pareto枝刈りと結果の再構成（docs/13 6章）。
import type { EgressTarget } from "./raptor.js";
import type { FlexLeg, Itinerary, Leg, LocationRef, TransitLeg, WalkLeg } from "./public-types.js";
import type { LegRecord, RaptorState, RouterShard } from "./types.js";

interface ParetoCandidate {
  round: number;
  arrival: number;
  egress: EgressTarget;
}

/** 乗換回数昇順に見て、到着時刻が改善しない候補を除去する（docs/13 6.1節removeDominated） */
function removeDominated(candidates: ParetoCandidate[]): ParetoCandidate[] {
  const sorted = [...candidates].sort((a, b) => a.round - b.round);
  const front: ParetoCandidate[] = [];
  let best = Infinity;
  for (const c of sorted) {
    if (c.arrival < best) {
      front.push(c);
      best = c.arrival;
    }
  }
  return front;
}

/** journeyLegsを目的地からorigin方向へ逆順にたどる（docs/13 6.2節trace） */
function traceLegs(state: RaptorState, egressStopIdx: number, targetRound: number): LegRecord[] {
  const legs: LegRecord[] = [];
  let cursor = egressStopIdx;
  let round = targetRound;

  for (let guard = 0; guard < 1000; guard++) {
    const leg = state.legs[round]?.[cursor];
    if (leg === undefined) break;
    legs.unshift(leg);
    if (leg.kind === "walk") {
      if (leg.access) break; // originからのaccess徒歩に到達したら完了
      cursor = leg.fromStopIdx;
      round = leg.round; // 徒歩はラウンドを消費しない
    } else {
      cursor = leg.kind === "transit" ? leg.boardStopIdx : leg.fromStopIdx;
      round = leg.round - 1;
      if (round < 0) break;
    }
  }
  return legs;
}

function stopRef(shard: RouterShard, stopIdx: number): LocationRef {
  return { kind: "stopId", stopId: shard.stopIds[stopIdx]! };
}

/** 内部LegRecord列を公開Leg列へ変換する（docs/13 6.3節・6.4節） */
function toPublicLegs(
  shard: RouterShard,
  records: LegRecord[],
  departureTime: number,
  origin: LocationRef,
  destination: LocationRef,
  candidate: ParetoCandidate,
): Leg[] {
  const legs: Leg[] = [];
  let currentTime = departureTime;

  for (const rec of records) {
    if (rec.kind === "walk") {
      const arrival = rec.access ? departureTime + rec.walkSec : currentTime + rec.walkSec;
      if (rec.walkSec > 0) {
        const walkLeg: WalkLeg = {
          kind: "walk",
          from: rec.access ? origin : stopRef(shard, rec.fromStopIdx),
          to: stopRef(shard, rec.toStopIdx),
          departureTime: rec.access ? departureTime : currentTime,
          arrivalTime: arrival,
          distanceMeters: rec.distanceM,
        };
        legs.push(walkLeg);
      }
      currentTime = arrival;
    } else if (rec.kind === "transit") {
      const routeStart = shard.routeStopsStart[rec.routeIdx]!;
      const intermediate: string[] = [];
      for (let s = rec.boardSeqIdx + 1; s < rec.alightSeqIdx; s++) {
        intermediate.push(shard.stopIds[shard.routeStops[routeStart + s]!]!);
      }
      const transitLeg: TransitLeg = {
        kind: "transit",
        routeId: shard.tripRouteIds[rec.tripIdx]!,
        tripId: shard.tripIds[rec.tripIdx]!,
        fromStopId: shard.stopIds[rec.boardStopIdx]!,
        toStopId: shard.stopIds[rec.alightStopIdx]!,
        departureTime: rec.departSec,
        arrivalTime: rec.arriveSec,
        ...(intermediate.length > 0 ? { intermediateStopIds: intermediate } : {}),
      };
      legs.push(transitLeg);
      currentTime = rec.arriveSec;
    } else {
      const flex = shard.flex!;
      const rules = flex.bookingRules;
      const pickupIdx = rec.pickupBookingRuleIdx;
      const dropoffIdx = rec.dropoffBookingRuleIdx;
      // booking情報は必ず添付する（確定済み設計判断4、docs/13 6.4節）
      const flexLeg: FlexLeg = {
        kind: "flex",
        locationGroupId: flex.flexGroupIds[rec.groupIdx]!,
        tripId: flex.flexTripIds[rec.flexTripIdx]!,
        fromStopId: shard.stopIds[rec.fromStopIdx]!,
        toStopId: shard.stopIds[rec.toStopIdx]!,
        departureTime: rec.departSec,
        arrivalTime: rec.arriveSec,
        booking: {
          phoneNumber:
            (pickupIdx >= 0 ? rules.phoneNumbers[pickupIdx] : undefined) ??
            (dropoffIdx >= 0 ? rules.phoneNumbers[dropoffIdx] : undefined),
          message:
            (pickupIdx >= 0 ? rules.messages[pickupIdx] : undefined) ??
            (dropoffIdx >= 0 ? rules.messages[dropoffIdx] : undefined),
          deadline: rec.bookingDeadlineSec,
          infoUrl: pickupIdx >= 0 ? rules.infoUrls[pickupIdx] : undefined,
          bookingUrl: pickupIdx >= 0 ? rules.bookingUrls[pickupIdx] : undefined,
        },
      };
      legs.push(flexLeg);
      currentTime = rec.arriveSec;
    }
  }

  // egress徒歩（最後の到達stop → destination、docs/13 5.4節）
  if (candidate.egress.walkSec > 0) {
    const egressLeg: WalkLeg = {
      kind: "walk",
      from: stopRef(shard, candidate.egress.stopIdx),
      to: destination,
      departureTime: currentTime,
      arrivalTime: currentTime + candidate.egress.walkSec,
      distanceMeters: candidate.egress.distanceM,
    };
    legs.push(egressLeg);
  }
  return legs;
}

export function reconstructItineraries(
  shard: RouterShard,
  state: RaptorState,
  departureTime: number,
  origin: LocationRef,
  destination: LocationRef,
  egress: EgressTarget[],
): Itinerary[] {
  // ラウンドごとの最良egress到着からPareto候補を作る（docs/13 6.1節）
  const candidates: ParetoCandidate[] = [];
  for (let k = 0; k < state.tauRounds.length; k++) {
    const tau = state.tauRounds[k]!;
    let best: ParetoCandidate | undefined;
    for (const e of egress) {
      const arrival = tau[e.stopIdx]! + e.walkSec;
      if (Number.isFinite(arrival) && (best === undefined || arrival < best.arrival)) {
        best = { round: k, arrival, egress: e };
      }
    }
    if (best) candidates.push(best);
  }

  const itineraries: Itinerary[] = [];
  for (const candidate of removeDominated(candidates)) {
    const records = traceLegs(state, candidate.egress.stopIdx, candidate.round);
    const legs = toPublicLegs(shard, records, departureTime, origin, destination, candidate);
    if (legs.length === 0) continue;
    const vehicleLegs = legs.filter((l) => l.kind === "transit" || l.kind === "flex").length;
    itineraries.push({
      legs,
      summary: {
        departureTime,
        arrivalTime: candidate.arrival,
        durationSec: candidate.arrival - departureTime,
        transferCount: Math.max(0, vehicleLegs - 1),
        requiresBooking: legs.some((l) => l.kind === "flex"),
      },
    });
  }
  return itineraries;
}
