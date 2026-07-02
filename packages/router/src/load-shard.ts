// シャードJSON（docs/12 4章）→ ランタイム内部表現RouterShard（docs/13 2章・9.2節）の変換。
// packages/routerはfetch/JSON.parseを行わない（環境非依存、docs/13 9.4節）。
import type { Shard } from "@norishiro/types";
import { RouterInputError } from "./errors.js";
import type { FlexGroupTable, GridIndex, RouterShard } from "./types.js";

/** 公開契約上は不透明ハンドル（docs/13 8章） */
export type RouterShardHandle = unknown;

let activeShard: RouterShard | null = null;

/** テスト・内部実装用: ハンドルから内部表現を取り出す */
export function internalShardOf(handle: RouterShardHandle): RouterShard {
  return handle as RouterShard;
}

export function getActiveShard(): RouterShard | null {
  return activeShard;
}

function yyyymmdd(isoDate: string): number {
  return Number(isoDate.replaceAll("-", ""));
}

function parseTimeSec(v: string): number {
  const [h, m, s] = v.split(":").map(Number);
  return (h ?? 0) * 3600 + (m ?? 0) * 60 + (s ?? 0);
}

const GRID_CELL_SIZE_DEG = 0.01; // 約1.1km四方（docs/13 9.3節: walkLimit 800mを基準とする粒度）

function gridKey(lat: number, lon: number): string {
  return `${Math.floor(lat / GRID_CELL_SIZE_DEG)}:${Math.floor(lon / GRID_CELL_SIZE_DEG)}`;
}

function buildGrid(lat: Float64Array, lon: Float64Array): GridIndex {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < lat.length; i++) {
    const key = gridKey(lat[i]!, lon[i]!);
    let cell = cells.get(key);
    if (cell === undefined) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(i);
  }
  return { cellSizeDeg: GRID_CELL_SIZE_DEG, cells };
}

/** 座標の近傍セルからstop候補を列挙する（正確な距離判定は呼び出し側がHaversineで行う） */
export function gridQuery(shard: RouterShard, lat: number, lon: number, radiusM: number): number[] {
  const latMargin = radiusM / 111000;
  const lonMargin = radiusM / (111000 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const result: number[] = [];
  const size = shard.grid.cellSizeDeg;
  for (
    let cy = Math.floor((lat - latMargin) / size);
    cy <= Math.floor((lat + latMargin) / size);
    cy++
  ) {
    for (
      let cx = Math.floor((lon - lonMargin) / size);
      cx <= Math.floor((lon + lonMargin) / size);
      cx++
    ) {
      const cell = shard.grid.cells.get(`${cy}:${cx}`);
      if (cell) result.push(...cell);
    }
  }
  return result;
}

/** CSR構築ヘルパー: itemsPerKey[k] = keyに属する値の配列 */
function buildCsr(
  count: number,
  itemsPerKey: number[][],
): { start: Uint32Array; items: Uint32Array } {
  const start = new Uint32Array(count + 1);
  for (let k = 0; k < count; k++) start[k + 1] = start[k]! + (itemsPerKey[k]?.length ?? 0);
  const items = new Uint32Array(start[count]!);
  for (let k = 0; k < count; k++) {
    const list = itemsPerKey[k] ?? [];
    for (let i = 0; i < list.length; i++) items[start[k]! + i] = list[i]!;
  }
  return { start, items };
}

function buildFlexTable(shard: Shard, stopCount: number): FlexGroupTable | null {
  const flex = shard.flex;
  if (flex === null) return null;

  const groupCount = flex.locationGroups.locationGroupId.length;
  const memberLists = flex.locationGroups.memberStopIdx.map((list) => [...new Set(list)]);
  const groupStopsCsr = buildCsr(groupCount, memberLists);

  const stopGroupLists: number[][] = Array.from({ length: stopCount }, () => []);
  memberLists.forEach((stops, g) => {
    for (const s of stops) stopGroupLists[s]!.push(g);
  });
  const stopGroupsCsr = buildCsr(stopCount, stopGroupLists);

  const groupFlexTripLists: number[][] = Array.from({ length: groupCount }, () => []);
  flex.flexTrips.locationGroupIdx.forEach((g, ft) => groupFlexTripLists[g]!.push(ft));
  const groupFlexTripsCsr = buildCsr(groupCount, groupFlexTripLists);

  const rules = flex.bookingRules;
  return {
    flexGroupIds: flex.locationGroups.locationGroupId,
    groupStopsStart: groupStopsCsr.start,
    groupStops: groupStopsCsr.items,
    stopGroupsStart: stopGroupsCsr.start,
    stopGroups: stopGroupsCsr.items,
    groupFlexTripsStart: groupFlexTripsCsr.start,
    groupFlexTrips: groupFlexTripsCsr.items,
    flexTripGroup: Uint32Array.from(flex.flexTrips.locationGroupIdx),
    flexTripIds: flex.flexTrips.tripIdx.map((ti) => shard.trips.tripId[ti]!),
    flexTripServiceDates: flex.flexTrips.tripIdx.map((ti) =>
      shard.trips.serviceDates[ti]!.map(yyyymmdd),
    ),
    pickupWindowStart: Int32Array.from(flex.flexTrips.windowStartSec),
    pickupWindowEnd: Int32Array.from(flex.flexTrips.windowEndSec),
    pickupBookingRuleIdx: Int32Array.from(flex.flexTrips.pickupBookingRuleIdx.map((v) => v ?? -1)),
    dropoffWindowStart: Int32Array.from(flex.flexTrips.windowStartSec),
    dropoffWindowEnd: Int32Array.from(flex.flexTrips.windowEndSec),
    dropoffBookingRuleIdx: Int32Array.from(
      flex.flexTrips.dropOffBookingRuleIdx.map((v) => v ?? -1),
    ),
    bookingRules: {
      bookingRuleIds: rules.bookingRuleId,
      bookingType: Uint8Array.from(rules.bookingType),
      priorNoticeDurationMin: Int32Array.from(rules.priorNoticeDurationMin.map((v) => v ?? -1)),
      priorNoticeDurationMax: Int32Array.from(rules.priorNoticeDurationMax.map((v) => v ?? -1)),
      priorNoticeLastDayOffset: Int32Array.from(rules.priorNoticeLastDay.map((v) => v ?? -1)),
      priorNoticeLastTimeSec: Int32Array.from(
        rules.priorNoticeLastTime.map((v) => (v === null ? -1 : parseTimeSec(v))),
      ),
      messages: rules.message.map((v) => v ?? undefined),
      phoneNumbers: rules.phoneNumber.map((v) => v ?? undefined),
      infoUrls: rules.infoUrl.map((v) => v ?? undefined),
      // docs/12 4.4節のCompressedBookingRulesにbooking_url列は無いため常にundefined
      bookingUrls: rules.bookingRuleId.map(() => undefined),
    },
    // 確定済み設計判断4の既定値（docs/13 2.6節）
    durationEstimatorParams: {
      detourFactor: 1.4,
      averageSpeedMps: (22 * 1000) / 3600,
      boardingBufferSec: 300,
    },
  };
}

/**
 * シャードのロード（docs/13 8章の公開契約）。
 * 未知のschemaVersionはロードを拒否する（docs/12 4.6節）。
 * ロードしたシャードは「アクティブシャード」としてplan()/isochrone()の対象になる
 * （受け渡し方式はdocs/13 11.2節U-3の暫定実装。apps実装時に再検討する）。
 */
export function loadShard(shardJson: Shard): RouterShardHandle {
  if (shardJson.meta.schemaVersion !== 1) {
    throw new RouterInputError(
      `未対応のシャードschemaVersion: ${String(shardJson.meta.schemaVersion)}`,
    );
  }

  const stopCount = shardJson.stops.stopId.length;
  const stopLat = Float64Array.from(shardJson.stops.lat);
  const stopLon = Float64Array.from(shardJson.stops.lon);

  // --- 固定路線: tripごとにstop_times行を集める（Flex行 stopIdx=-1 は除外） ---
  const flexTripIdxSet = new Set(shardJson.flex?.flexTrips.tripIdx ?? []);
  const rowsByTrip = new Map<
    number,
    { seq: number; stopIdx: number; arr: number; dep: number }[]
  >();
  const st = shardJson.stopTimes;
  for (let i = 0; i < st.tripIdx.length; i++) {
    if (st.stopIdx[i]! < 0) continue;
    const arr = st.arrivalSec[i] ?? st.departureSec[i];
    const dep = st.departureSec[i] ?? st.arrivalSec[i];
    if (arr === null || dep === null || arr === undefined || dep === undefined) continue;
    const ti = st.tripIdx[i]!;
    let rows = rowsByTrip.get(ti);
    if (rows === undefined) {
      rows = [];
      rowsByTrip.set(ti, rows);
    }
    rows.push({ seq: st.stopSequence[i]!, stopIdx: st.stopIdx[i]!, arr, dep });
  }

  // 停留所列パターンで内部routeに分割する（docs/13 2.2節「1 RouteIdx = 1停留所列パターン」）
  interface RouteAccum {
    pattern: number[];
    routeId: string;
    trips: { shardTripIdx: number; times: { arr: number; dep: number }[] }[];
  }
  const routeByKey = new Map<string, RouteAccum>();
  for (const [shardTripIdx, rows] of rowsByTrip) {
    if (flexTripIdxSet.has(shardTripIdx) || rows.length < 2) continue;
    rows.sort((a, b) => a.seq - b.seq);
    const pattern = rows.map((r) => r.stopIdx);
    const shardRouteIdx = shardJson.trips.routeIdx[shardTripIdx]!;
    const key = `${shardRouteIdx}|${pattern.join(",")}`;
    let accum = routeByKey.get(key);
    if (accum === undefined) {
      accum = { pattern, routeId: shardJson.routes.routeId[shardRouteIdx]!, trips: [] };
      routeByKey.set(key, accum);
    }
    accum.trips.push({ shardTripIdx, times: rows.map((r) => ({ arr: r.arr, dep: r.dep })) });
  }

  const routes = [...routeByKey.values()];
  const routeCount = routes.length;
  const routeTripsStart = new Uint32Array(routeCount + 1);
  const routeStopsStart = new Uint32Array(routeCount + 1);
  let tripCount = 0;
  let stopTimesTotal = 0;
  routes.forEach((r, ri) => {
    // route内tripは最初の停留所の出発時刻順にソート（docs/13 2.2節routeTripsの単調性）
    r.trips.sort((a, b) => a.times[0]!.dep - b.times[0]!.dep);
    routeTripsStart[ri + 1] = routeTripsStart[ri]! + r.trips.length;
    routeStopsStart[ri + 1] = routeStopsStart[ri]! + r.pattern.length;
    tripCount += r.trips.length;
    stopTimesTotal += r.trips.length * r.pattern.length;
  });

  const routeTrips = new Uint32Array(tripCount);
  const routeStops = new Uint32Array(routeStopsStart[routeCount]!);
  const tripIds: string[] = new Array<string>(tripCount);
  const tripRouteIds: string[] = new Array<string>(tripCount);
  const tripRoute = new Uint32Array(tripCount);
  const tripStopTimesOffset = new Uint32Array(tripCount);
  const stopTimesArrival = new Int32Array(stopTimesTotal);
  const stopTimesDeparture = new Int32Array(stopTimesTotal);
  const tripServiceDates: number[][] = new Array<number[]>(tripCount);

  const stopRouteLists: number[][] = Array.from({ length: stopCount }, () => []);
  let tripCursor = 0;
  let stCursor = 0;
  routes.forEach((r, ri) => {
    r.pattern.forEach((stopIdx, i) => {
      routeStops[routeStopsStart[ri]! + i] = stopIdx;
      if (!stopRouteLists[stopIdx]!.includes(ri)) stopRouteLists[stopIdx]!.push(ri);
    });
    for (const trip of r.trips) {
      routeTrips[tripCursor] = tripCursor;
      tripIds[tripCursor] = shardJson.trips.tripId[trip.shardTripIdx]!;
      tripRouteIds[tripCursor] = r.routeId;
      tripRoute[tripCursor] = ri;
      tripStopTimesOffset[tripCursor] = stCursor;
      tripServiceDates[tripCursor] = shardJson.trips.serviceDates[trip.shardTripIdx]!.map(yyyymmdd);
      for (const t of trip.times) {
        stopTimesArrival[stCursor] = t.arr;
        stopTimesDeparture[stCursor] = t.dep;
        stCursor++;
      }
      tripCursor++;
    }
  });
  const stopRoutesCsr = buildCsr(stopCount, stopRouteLists);

  // --- 徒歩transfer CSR ---
  const transferLists: { to: number; sec: number; dist: number }[][] = Array.from(
    { length: stopCount },
    () => [],
  );
  const tr = shardJson.transfers;
  for (let i = 0; i < tr.fromStopIdx.length; i++) {
    transferLists[tr.fromStopIdx[i]!]!.push({
      to: tr.toStopIdx[i]!,
      sec: tr.walkSec[i]!,
      dist: tr.distanceM[i]!,
    });
  }
  const transfersStart = new Uint32Array(stopCount + 1);
  for (let s = 0; s < stopCount; s++) {
    transfersStart[s + 1] = transfersStart[s]! + transferLists[s]!.length;
  }
  const transfersTo = new Uint32Array(transfersStart[stopCount]!);
  const transfersDurationSec = new Int32Array(transfersStart[stopCount]!);
  const transfersDistanceM = new Float64Array(transfersStart[stopCount]!);
  for (let s = 0; s < stopCount; s++) {
    transferLists[s]!.forEach((t, i) => {
      transfersTo[transfersStart[s]! + i] = t.to;
      transfersDurationSec[transfersStart[s]! + i] = t.sec;
      transfersDistanceM[transfersStart[s]! + i] = t.dist;
    });
  }

  const shard: RouterShard = {
    stopIds: shardJson.stops.stopId,
    stopNames: shardJson.stops.stopName,
    stopLat,
    stopLon,
    stopCount,
    stopIdxOf: new Map(shardJson.stops.stopId.map((id, i) => [id, i])),
    routeCount,
    routeTripsStart,
    routeTrips,
    routeStopsStart,
    routeStops,
    tripCount,
    tripIds,
    tripRouteIds,
    tripRoute,
    tripStopTimesOffset,
    stopTimesArrival,
    stopTimesDeparture,
    tripServiceDates,
    stopRoutesStart: stopRoutesCsr.start,
    stopRoutes: stopRoutesCsr.items,
    transfersStart,
    transfersTo,
    transfersDurationSec,
    transfersDistanceM,
    defaultServiceDate: yyyymmdd(shardJson.meta.calendarWindow.from),
    activeTripBitsCache: new Map(),
    activeFlexBitsCache: new Map(),
    flex: buildFlexTable(shardJson, stopCount),
    grid: buildGrid(stopLat, stopLon),
  };
  activeShard = shard;
  return shard;
}

function buildBits(
  count: number,
  datesOf: (i: number) => number[],
  serviceDate: number,
): Uint8Array {
  const bits = new Uint8Array(Math.ceil(count / 8) || 1);
  for (let i = 0; i < count; i++) {
    if (datesOf(i).includes(serviceDate)) bits[i >> 3] = bits[i >> 3]! | (1 << (i & 7));
  }
  return bits;
}

/** 固定tripのサービス日アクティブ判定（O(1)ビット参照、docs/13 2.3節。ビットセットは日付ごとに遅延構築） */
export function tripActiveBits(shard: RouterShard, serviceDate: number): Uint8Array {
  let bits = shard.activeTripBitsCache.get(serviceDate);
  if (bits === undefined) {
    bits = buildBits(shard.tripCount, (i) => shard.tripServiceDates[i]!, serviceDate);
    shard.activeTripBitsCache.set(serviceDate, bits);
  }
  return bits;
}

export function flexActiveBits(shard: RouterShard, serviceDate: number): Uint8Array {
  let bits = shard.activeFlexBitsCache.get(serviceDate);
  if (bits === undefined) {
    const flex = shard.flex;
    bits = buildBits(
      flex?.flexTripIds.length ?? 0,
      (i) => flex?.flexTripServiceDates[i] ?? [],
      serviceDate,
    );
    shard.activeFlexBitsCache.set(serviceDate, bits);
  }
  return bits;
}

export function isBitSet(bits: Uint8Array, i: number): boolean {
  return (bits[i >> 3]! & (1 << (i & 7))) !== 0;
}
