// Pareto枝刈りと結果の再構成（docs/13 6章）。
import { evaluateBooking } from "./flex.js";
import type { EgressTarget } from "./raptor.js";
import type {
  BoardingRequirement,
  BookingInfo,
  FlexLeg,
  Itinerary,
  Leg,
  LocationRef,
  TransitLeg,
  WalkLeg,
} from "./public-types.js";
import type {
  BookingRuleTable,
  LegRecord,
  RaptorState,
  RouterShard,
  SearchTimeContext,
} from "./types.js";

/**
 * pickup_type/drop_off_type を公開契約のBoardingRequirementへ写す（docs/10 2.5.1節）。
 * 0・空（通常）と1（乗降不可、そもそも経路に現れない）はキーを立てない。
 */
function boardingRequirementOf<K extends string>(
  type: number,
  key: K,
): Partial<Record<K, BoardingRequirement>> {
  if (type === 2) return { [key]: "phone_agency" } as Record<K, BoardingRequirement>;
  if (type === 3) return { [key]: "coordinate_with_driver" } as Record<K, BoardingRequirement>;
  return {};
}

/** BookingRuleTableから表示用の文字列フィールドを引く。優先ルール→代替ルールの順に解決する */
function bookingFieldsOf(
  rules: BookingRuleTable,
  primaryIdx: number,
  fallbackIdx: number,
): Pick<BookingInfo, "phoneNumber" | "message" | "infoUrl" | "bookingUrl"> {
  const pick = <T>(table: (T | undefined)[]): T | undefined =>
    (primaryIdx >= 0 ? table[primaryIdx] : undefined) ??
    (fallbackIdx >= 0 ? table[fallbackIdx] : undefined);
  return {
    phoneNumber: pick(rules.phoneNumbers),
    message: pick(rules.messages),
    infoUrl: pick(rules.infoUrls),
    bookingUrl: pick(rules.bookingUrls),
  };
}

/**
 * 予約制の定時便（transitレッグ）の予約情報を解決する（docs/17 C-24）。
 *
 * 乗車側の`pickup_booking_rule_id`を第一に、無ければ降車側の`drop_off_booking_rule_id`を使う
 * （利用者が行動を起こす時点は乗車であるため、締切の基準時刻はどちらの場合も乗車時刻とする）。
 * 参照が両側とも無ければundefinedを返す。この場合、`boardingRequirement`が立っていても
 * 「フィードが締切・連絡先を提供していない」状態であり、予約不要を意味しない（docs/20 §2.3）。
 *
 * Flexレッグと異なり、締切超過でもレッグを捨てない。理由は`reconstructItineraries`のコメント参照。
 */
function transitBookingOf(
  shard: RouterShard,
  rec: Extract<LegRecord, { kind: "transit" }>,
  searchTime: SearchTimeContext,
  serviceDate: number,
): BookingInfo | undefined {
  const rules = shard.bookingRules;
  if (rules === null) return undefined;
  const offset = shard.tripStopTimesOffset[rec.tripIdx]!;
  const pickupIdx = shard.stopTimesPickupBookingRuleIdx[offset + rec.boardSeqIdx]!;
  const dropOffIdx = shard.stopTimesDropOffBookingRuleIdx[offset + rec.alightSeqIdx]!;
  if (pickupIdx < 0 && dropOffIdx < 0) return undefined;

  const ruleIdx = pickupIdx >= 0 ? pickupIdx : dropOffIdx;
  const evaluated = evaluateBooking(rules, ruleIdx, rec.departSec, searchTime, serviceDate);
  return {
    ...bookingFieldsOf(rules, pickupIdx, dropOffIdx),
    deadline: evaluated.deadlineSec,
  };
}

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
  searchTime: SearchTimeContext,
  serviceDate: number,
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
      const booking = transitBookingOf(shard, rec, searchTime, serviceDate);
      const transitLeg: TransitLeg = {
        kind: "transit",
        routeId: shard.tripRouteIds[rec.tripIdx]!,
        tripId: shard.tripIds[rec.tripIdx]!,
        fromStopId: shard.stopIds[rec.boardStopIdx]!,
        toStopId: shard.stopIds[rec.alightStopIdx]!,
        departureTime: rec.departSec,
        arrivalTime: rec.arriveSec,
        ...(intermediate.length > 0 ? { intermediateStopIds: intermediate } : {}),
        ...boardingRequirementOf(rec.boardPickupType, "boardingRequirement"),
        ...boardingRequirementOf(rec.alightDropOffType, "alightingRequirement"),
        ...(booking !== undefined ? { booking } : {}),
      };
      legs.push(transitLeg);
      currentTime = rec.arriveSec;
    } else {
      const flex = shard.flex!;
      const rules = shard.bookingRules;
      const pickupIdx = rules === null ? -1 : rec.pickupBookingRuleIdx;
      const dropoffIdx = rules === null ? -1 : rec.dropoffBookingRuleIdx;
      // booking情報は必ず添付する（確定済み設計判断4、docs/13 6.4節）。
      // infoUrl/bookingUrlを乗車側ルールのみから解決するのは同節の擬似コードどおり
      // （transitレッグは降車側へフォールバックする点が異なる。transitBookingOfを参照）
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
            (pickupIdx >= 0 ? rules?.phoneNumbers[pickupIdx] : undefined) ??
            (dropoffIdx >= 0 ? rules?.phoneNumbers[dropoffIdx] : undefined),
          message:
            (pickupIdx >= 0 ? rules?.messages[pickupIdx] : undefined) ??
            (dropoffIdx >= 0 ? rules?.messages[dropoffIdx] : undefined),
          deadline: rec.bookingDeadlineSec,
          infoUrl: pickupIdx >= 0 ? rules?.infoUrls[pickupIdx] : undefined,
          bookingUrl: pickupIdx >= 0 ? rules?.bookingUrls[pickupIdx] : undefined,
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

/**
 * Pareto候補からItineraryを組み立てる（docs/13 6章）。
 *
 * `searchTime`/`serviceDate`は予約制定時便の締切算出にのみ使う。Flexレッグと違い
 * **締切超過を理由にtransitレッグを枝刈りしない**。締切を過ぎた便を結果から消すと利用者は
 * 「そんな便は無い」と受け取ってしまうため、締切情報を添付したうえで残し、表示側で
 * 「締切を過ぎています」と示して代替を案内する（docs/15 4.4節、docs/20 P-10）。
 */
export function reconstructItineraries(
  shard: RouterShard,
  state: RaptorState,
  departureTime: number,
  origin: LocationRef,
  destination: LocationRef,
  egress: EgressTarget[],
  searchTime: SearchTimeContext,
  serviceDate: number,
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
    const legs = toPublicLegs(
      shard,
      records,
      departureTime,
      origin,
      destination,
      candidate,
      searchTime,
      serviceDate,
    );
    if (legs.length === 0) continue;
    const vehicleLegs = legs.filter((l) => l.kind === "transit" || l.kind === "flex").length;
    itineraries.push({
      legs,
      summary: {
        departureTime,
        arrivalTime: candidate.arrival,
        durationSec: candidate.arrival - departureTime,
        transferCount: Math.max(0, vehicleLegs - 1),
        // Flexレッグ、または固定路線で事業者への電話連絡が必要な乗降を含む場合に立てる。
        // 運転手との調整のみ（値3）は事前予約ではないため含めない。
        requiresBooking: legs.some(
          (l) =>
            l.kind === "flex" ||
            (l.kind === "transit" &&
              (l.boardingRequirement === "phone_agency" ||
                l.alightingRequirement === "phone_agency")),
        ),
      },
    });
  }
  return itineraries;
}
