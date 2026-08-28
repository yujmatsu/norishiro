// 実データで T-26（pickup_type/drop_off_type の反映）を検証する。
//
// 対象は高知県の「予約が必要な定時便」。土佐清水市は stop_times 168行すべてに
// pickup_type=2（要電話連絡）と pickup_booking_rule_id が付く（docs/17 C-24）。
// 修正前のrouterはこれを通常停留所として扱い、無警告で案内していた（docs/17 T-26）。
//
//   pnpm --filter @norishiro/pipeline run verify:reservation
//
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KNOWN_FEED_FILES, parseFlexFeed, type FlexFeedFiles } from "@norishiro/gtfs";
import { loadShard, plan } from "@norishiro/router";
import type { ParsedFlexFeed, Shard } from "@norishiro/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const flexRoot = path.join(repoRoot, "..", "data", "_work", "flex");

const TARGETS = ["土佐清水市", "香南市", "四万十町"];
const WINDOW_DAYS = 35;

function loadFeed(dir: string): FlexFeedFiles {
  const files: FlexFeedFiles = {};
  for (const name of KNOWN_FEED_FILES) {
    const p = path.join(dir, name);
    if (existsSync(p)) files[name] = readFileSync(p);
  }
  return files;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** calendar.txt/calendar_dates.txt を windowFrom から WINDOW_DAYS 日分の運行日へ展開する */
function expandServiceDates(feed: ParsedFlexFeed, windowFrom: Date): Map<string, string[]> {
  const n = feed.normalized;
  const byService = new Map<string, string[]>();
  const removed = new Map<string, Set<string>>();
  const added = new Map<string, Set<string>>();
  for (const cd of n.calendarDates) {
    const target = cd.exceptionType === 2 ? removed : added;
    let s = target.get(cd.serviceId);
    if (!s) {
      s = new Set<string>();
      target.set(cd.serviceId, s);
    }
    s.add(cd.date);
  }
  for (const cal of n.calendars) {
    const dates: string[] = [];
    for (let i = 0; i < WINDOW_DAYS; i++) {
      const d = new Date(windowFrom);
      d.setDate(d.getDate() + i);
      const iso = isoDate(d);
      const ymd = iso.replace(/-/g, "");
      const dow = d.getDay(); // 0=日
      const runs = [
        cal.days.sunday,
        cal.days.monday,
        cal.days.tuesday,
        cal.days.wednesday,
        cal.days.thursday,
        cal.days.friday,
        cal.days.saturday,
      ][dow];
      // startDate/endDate は欠損しうる（欠損時は期間制限なしとみなす）
      const inRange =
        (cal.startDate === undefined || ymd >= cal.startDate) &&
        (cal.endDate === undefined || ymd <= cal.endDate);
      if (runs && inRange && !removed.get(cal.serviceId)?.has(ymd)) dates.push(iso);
    }
    byService.set(cal.serviceId, dates);
  }
  for (const [sid, set] of added) {
    const cur = byService.get(sid) ?? [];
    for (const ymd of set) {
      const iso = `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
      if (!cur.includes(iso)) cur.push(iso);
    }
    cur.sort();
    byService.set(sid, cur);
  }
  return byService;
}

/** 通常の定時便のみでシャードを組む（Flexの仮想レッグはここでは扱わない） */
function buildShard(feed: ParsedFlexFeed, windowFrom: Date): Shard {
  const n = feed.normalized;
  const serviceDates = expandServiceDates(feed, windowFrom);

  const stopIds = n.stops.map((s) => s.stopId);
  const stopIdxOf = new Map(stopIds.map((id, i) => [id, i]));
  const routeIds = n.routes.map((r) => r.routeId);
  const routeIdxOf = new Map(routeIds.map((id, i) => [id, i]));

  const tripIds: string[] = [];
  const tripIdxOf = new Map<string, number>();
  const tripRouteIdx: number[] = [];
  const tripDates: string[][] = [];
  for (const t of n.trips) {
    tripIdxOf.set(t.tripId, tripIds.length);
    tripIds.push(t.tripId);
    tripRouteIdx.push(t.routeId !== undefined ? (routeIdxOf.get(t.routeId) ?? 0) : 0);
    tripDates.push(t.serviceId !== undefined ? (serviceDates.get(t.serviceId) ?? []) : []);
  }

  const st: Shard["stopTimes"] = {
    tripIdx: [],
    stopSequence: [],
    stopIdx: [],
    arrivalSec: [],
    departureSec: [],
    pickupType: [],
    dropOffType: [],
  };
  for (const row of n.stopTimes) {
    if (row.locationRef.kind !== "stop") continue; // 停留所参照の行のみ
    const ti = tripIdxOf.get(row.tripId);
    const si = stopIdxOf.get(row.locationRef.stopId);
    if (ti === undefined || si === undefined) continue;
    const arr = row.arrivalTime ?? row.departureTime;
    const dep = row.departureTime ?? row.arrivalTime;
    if (arr === undefined || dep === undefined) continue;
    st.tripIdx.push(ti);
    st.stopSequence.push(row.stopSequence);
    st.stopIdx.push(si);
    st.arrivalSec.push(arr);
    st.departureSec.push(dep);
    st.pickupType.push(row.pickupType);
    st.dropOffType.push(row.dropOffType);
  }

  return {
    meta: {
      shardId: "verify",
      shardKind: "prefecture",
      schemaVersion: 1,
      generatedAt: new Date(windowFrom).toISOString(),
      calendarWindow: { from: isoDate(windowFrom), to: isoDate(windowFrom) },
      sourceFeedIds: ["verify"],
      feedStatus: { verify: "ok" },
    },
    stops: {
      stopId: stopIds,
      stopName: n.stops.map((s) => s.name ?? s.stopId),
      lat: n.stops.map((s) => s.lat ?? 0),
      lon: n.stops.map((s) => s.lon ?? 0),
      sourceFeedId: stopIds.map(() => "verify"),
    },
    routes: {
      routeId: routeIds,
      routeShortName: n.routes.map((r) => r.shortName ?? ""),
      routeLongName: n.routes.map((r) => r.longName ?? ""),
      routeType: n.routes.map((r) => r.routeType ?? 3),
      sourceFeedId: routeIds.map(() => "verify"),
    },
    trips: {
      tripId: tripIds,
      routeIdx: tripRouteIdx,
      serviceDates: tripDates,
      headsign: tripIds.map(() => null),
    },
    stopTimes: st,
    flex: null,
    transfers: { fromStopIdx: [], toStopIdx: [], distanceM: [], walkSec: [] },
  };
}

function main(): void {
  for (const agency of TARGETS) {
    const dir = path.join(flexRoot, agency);
    if (!existsSync(dir)) {
      console.log(`\n=== ${agency}: 入力なし（${dir}）`);
      continue;
    }
    const feed = parseFlexFeed(loadFeed(dir));
    const n = feed.normalized;

    // 予約ルール付き かつ 停留所参照 の行を持つtripを1つ選ぶ
    const resRows = n.stopTimes.filter(
      (r) =>
        r.locationRef.kind === "stop" &&
        (r.pickupBookingRuleId !== undefined || r.dropOffBookingRuleId !== undefined),
    );
    if (resRows.length === 0) {
      console.log(`\n=== ${agency}: 予約ルール付きの停留所行が無い`);
      continue;
    }
    const target = resRows[0]!;
    const rows = n.stopTimes
      .filter((r) => r.tripId === target.tripId && r.locationRef.kind === "stop")
      .sort((a, b) => a.stopSequence - b.stopSequence);
    if (rows.length < 2) {
      console.log(`\n=== ${agency}: 対象tripの停留所行が2件未満`);
      continue;
    }
    const from = rows[0]!;
    const to = rows[rows.length - 1]!;
    if (from.locationRef.kind !== "stop" || to.locationRef.kind !== "stop") continue;

    // 運行日を1つ選ぶ
    const trip = n.trips.find((t) => t.tripId === target.tripId);
    const windowFrom = new Date(2026, 7, 28); // 2026-08-28
    const shard = buildShard(feed, windowFrom);
    const ti = shard.trips.tripId.indexOf(target.tripId);
    const dates = ti >= 0 ? shard.trips.serviceDates[ti]! : [];
    if (dates.length === 0) {
      console.log(`\n=== ${agency}: 対象trip(${target.tripId})の運行日が35日窓内に無い`);
      continue;
    }
    const serviceDate = Number(dates[0]!.replace(/-/g, ""));
    const depSec = (from.departureTime ?? from.arrivalTime ?? 0) - 600;

    loadShard(shard);
    const result = plan({
      origin: { kind: "stopId", stopId: from.locationRef.stopId },
      destination: { kind: "stopId", stopId: to.locationRef.stopId },
      departureTime: depSec,
      serviceDate,
    });

    console.log(`\n=== ${agency} ===`);
    console.log(`  trip=${target.tripId} service=${trip?.serviceId ?? "?"} 運行日=${dates[0]}`);
    console.log(
      `  ${from.locationRef.stopId} → ${to.locationRef.stopId} / ` +
        `pickup_type=${from.pickupType} drop_off_type=${to.dropOffType} ` +
        `ルール=${from.pickupBookingRuleId ?? "-"}`,
    );
    if (result.length === 0) {
      console.log("  経路: 見つからず");
      continue;
    }
    const it = result[0]!;
    console.log(`  requiresBooking = ${it.summary.requiresBooking}`);
    for (const leg of it.legs) {
      if (leg.kind !== "transit") continue;
      console.log(
        `  transitレッグ: ${leg.fromStopId} → ${leg.toStopId} ` +
          `boardingRequirement=${leg.boardingRequirement ?? "(なし)"} ` +
          `alightingRequirement=${leg.alightingRequirement ?? "(なし)"}`,
      );
    }
    const rule = from.pickupBookingRuleId
      ? n.bookingRules.get(from.pickupBookingRuleId)
      : undefined;
    if (rule) {
      console.log(
        `  参照ルール: type=${rule.bookingType} durMin=${rule.priorNoticeDurationMin ?? "-"} ` +
          `lastDay=${rule.priorNoticeLastDay ?? "-"} lastTime=${rule.priorNoticeLastTime ?? "-"} ` +
          `tel=${rule.phoneNumber ?? "-"}`,
      );
    }
  }
}

main();
