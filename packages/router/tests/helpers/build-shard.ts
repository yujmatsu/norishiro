// テスト用の合成シャードビルダー（docs/12 4章のShard形式を生成する）。
// packages/router のテスト専用。実運用の変換は apps/pipeline（I-6）が担う。
import type { Shard } from "@norishiro/types";

export interface StopSpec {
  id: string;
  lat: number;
  lon: number;
}

export interface TripSpec {
  tripId: string;
  routeId: string;
  /** 経由するstop idの並び（stop_sequence順） */
  stops: string[];
  /** 各停留所の時刻（秒）。arrival=departureとして扱う */
  times: number[];
  /** 運行日（YYYY-MM-DD）。省略時はdefaultDate */
  dates?: string[];
}

export interface FlexTripSpec {
  tripId: string;
  routeId: string;
  groupId: string;
  windowStartSec: number;
  windowEndSec: number;
  dates?: string[];
  pickupBookingRuleIdx?: number | null;
  dropOffBookingRuleIdx?: number | null;
}

export interface BookingRuleSpec {
  bookingRuleId: string;
  bookingType: number;
  priorNoticeDurationMin?: number | null;
  message?: string | null;
  phoneNumber?: string | null;
}

export interface TransferSpec {
  from: string;
  to: string;
  distanceM: number;
  walkSec: number;
}

export interface ShardSpec {
  stops: StopSpec[];
  trips?: TripSpec[];
  flexGroups?: { groupId: string; memberStops: string[] }[];
  flexTrips?: FlexTripSpec[];
  bookingRules?: BookingRuleSpec[];
  transfers?: TransferSpec[];
  defaultDate?: string;
}

export const DEFAULT_DATE = "2026-07-07"; // 火曜日

export function buildShard(spec: ShardSpec): Shard {
  const defaultDate = spec.defaultDate ?? DEFAULT_DATE;
  const stopIdxOf = new Map(spec.stops.map((s, i) => [s.id, i]));
  const idx = (id: string): number => {
    const i = stopIdxOf.get(id);
    if (i === undefined) throw new Error(`unknown stop id: ${id}`);
    return i;
  };

  const routeIds: string[] = [];
  const routeIdxOf = new Map<string, number>();
  const routeIdx = (routeId: string): number => {
    let r = routeIdxOf.get(routeId);
    if (r === undefined) {
      r = routeIds.length;
      routeIds.push(routeId);
      routeIdxOf.set(routeId, r);
    }
    return r;
  };

  const trips: Shard["trips"] = { tripId: [], routeIdx: [], serviceDates: [], headsign: [] };
  const stopTimes: Shard["stopTimes"] = {
    tripIdx: [],
    stopSequence: [],
    stopIdx: [],
    arrivalSec: [],
    departureSec: [],
    pickupType: [],
    dropOffType: [],
  };

  for (const t of spec.trips ?? []) {
    const ti = trips.tripId.length;
    trips.tripId.push(t.tripId);
    trips.routeIdx.push(routeIdx(t.routeId));
    trips.serviceDates.push(t.dates ?? [defaultDate]);
    trips.headsign.push(null);
    t.stops.forEach((stopId, seq) => {
      stopTimes.tripIdx.push(ti);
      stopTimes.stopSequence.push(seq + 1);
      stopTimes.stopIdx.push(idx(stopId));
      stopTimes.arrivalSec.push(t.times[seq]!);
      stopTimes.departureSec.push(t.times[seq]!);
      stopTimes.pickupType.push(0);
      stopTimes.dropOffType.push(0);
    });
  }

  const groups = spec.flexGroups ?? [];
  const groupIdxOf = new Map(groups.map((g, i) => [g.groupId, i]));
  const flexTripSpecs = spec.flexTrips ?? [];
  const flexTripIndices: number[] = [];
  for (const ft of flexTripSpecs) {
    const ti = trips.tripId.length;
    trips.tripId.push(ft.tripId);
    trips.routeIdx.push(routeIdx(ft.routeId));
    trips.serviceDates.push(ft.dates ?? [defaultDate]);
    trips.headsign.push(null);
    flexTripIndices.push(ti);
  }

  const flex =
    groups.length === 0
      ? null
      : {
          locationGroups: {
            locationGroupId: groups.map((g) => g.groupId),
            locationGroupName: groups.map(() => null),
            memberStopIdx: groups.map((g) => g.memberStops.map(idx)),
          },
          flexTrips: {
            tripIdx: flexTripIndices,
            locationGroupIdx: flexTripSpecs.map((ft) => {
              const g = groupIdxOf.get(ft.groupId);
              if (g === undefined) throw new Error(`unknown group: ${ft.groupId}`);
              return g;
            }),
            windowStartSec: flexTripSpecs.map((ft) => ft.windowStartSec),
            windowEndSec: flexTripSpecs.map((ft) => ft.windowEndSec),
            pickupBookingRuleIdx: flexTripSpecs.map((ft) => ft.pickupBookingRuleIdx ?? null),
            dropOffBookingRuleIdx: flexTripSpecs.map((ft) => ft.dropOffBookingRuleIdx ?? null),
            meanDurationFactor: flexTripSpecs.map(() => null),
            meanDurationOffset: flexTripSpecs.map(() => null),
          },
          bookingRules: {
            bookingRuleId: (spec.bookingRules ?? []).map((b) => b.bookingRuleId),
            bookingType: (spec.bookingRules ?? []).map((b) => b.bookingType),
            priorNoticeDurationMin: (spec.bookingRules ?? []).map(
              (b) => b.priorNoticeDurationMin ?? null,
            ),
            priorNoticeDurationMax: (spec.bookingRules ?? []).map(() => null),
            priorNoticeLastDay: (spec.bookingRules ?? []).map(() => null),
            priorNoticeLastTime: (spec.bookingRules ?? []).map(() => null),
            message: (spec.bookingRules ?? []).map((b) => b.message ?? null),
            phoneNumber: (spec.bookingRules ?? []).map((b) => b.phoneNumber ?? null),
            infoUrl: (spec.bookingRules ?? []).map(() => null),
          },
        };

  const transfers: Shard["transfers"] = {
    fromStopIdx: [],
    toStopIdx: [],
    distanceM: [],
    walkSec: [],
  };
  for (const tr of spec.transfers ?? []) {
    // 両方向を明示的に2行として格納する（docs/12 4.5節）
    transfers.fromStopIdx.push(idx(tr.from), idx(tr.to));
    transfers.toStopIdx.push(idx(tr.to), idx(tr.from));
    transfers.distanceM.push(tr.distanceM, tr.distanceM);
    transfers.walkSec.push(tr.walkSec, tr.walkSec);
  }

  return {
    meta: {
      shardId: "test",
      shardKind: "prefecture",
      schemaVersion: 1,
      generatedAt: "2026-07-02T00:00:00Z",
      calendarWindow: { from: defaultDate, to: defaultDate },
      sourceFeedIds: ["test-feed"],
      feedStatus: { "test-feed": "ok" },
    },
    stops: {
      stopId: spec.stops.map((s) => s.id),
      stopName: spec.stops.map((s) => s.id),
      lat: spec.stops.map((s) => s.lat),
      lon: spec.stops.map((s) => s.lon),
      sourceFeedId: spec.stops.map(() => "test-feed"),
    },
    routes: {
      routeId: routeIds,
      routeShortName: routeIds,
      routeLongName: routeIds,
      routeType: routeIds.map(() => 3),
      sourceFeedId: routeIds.map(() => "test-feed"),
    },
    trips,
    stopTimes,
    flex,
    transfers,
  };
}
