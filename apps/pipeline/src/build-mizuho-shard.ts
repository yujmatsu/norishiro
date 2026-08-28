// 瑞穂町MVPシャード生成スクリプト（docs/12 4章形式。I-6全国パイプラインの最小先行実装）。
// 実行: pnpm --filter @norishiro/pipeline run build:mizuho
// 出力: apps/web/public/shards/13-mizuho.json（コミット対象。再生成はこのコマンド1回）
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyStopTimeRow, parseFlexFeed, type FlexFeedFiles } from "@norishiro/gtfs";
import { loadShard, plan } from "@norishiro/router";
import type {
  NormalizedCalendar,
  NormalizedCalendarDate,
  ParsedFlexFeed,
  Shard,
} from "@norishiro/types";
import { compressBookingRules } from "./shard-booking-rules.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const fixtureDir = path.join(repoRoot, "packages", "gtfs", "tests", "fixtures", "mizuho");
const outPath = path.join(repoRoot, "apps", "web", "public", "shards", "13-mizuho.json");

const FEED_ID = "mizuho-flex";
const CALENDAR_WINDOW_DAYS = 35; // docs/12 3.4節「向こう35日分」

/**
 * コミット対象成果物のカレンダー窓の開始日。
 * apps/mcp・apps/web のテストが 2026-07-07（火・east_trip運行日）を前提にしているため固定する。
 */
const PINNED_WINDOW_FROM = "2026-07-02";

function validateIsoDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(
      `NORISHIRO_SHARD_WINDOW_FROM は YYYY-MM-DD か "today" を指定する（受け取った値: ${value}）`,
    );
  }
  return value;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function yyyymmdd(d: Date): string {
  return isoDate(d).replaceAll("-", "");
}

/** calendar.txt＋calendar_dates.txtから、ウィンドウ内の運行日（YYYY-MM-DD）を展開する（docs/12 3.4節） */
function expandServiceDates(
  calendar: NormalizedCalendar | undefined,
  exceptions: NormalizedCalendarDate[],
  from: Date,
  days: number,
): string[] {
  const dayKeys = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;
  const added = new Set(exceptions.filter((e) => e.exceptionType === 1).map((e) => e.date));
  const removed = new Set(exceptions.filter((e) => e.exceptionType === 2).map((e) => e.date));

  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    const ymd = yyyymmdd(d);
    const inRange =
      calendar !== undefined &&
      (calendar.startDate === undefined || ymd >= calendar.startDate) &&
      (calendar.endDate === undefined || ymd <= calendar.endDate);
    const byWeekday = inRange && calendar.days[dayKeys[d.getUTCDay()]!];
    const active = (byWeekday && !removed.has(ymd)) || added.has(ymd);
    if (active) dates.push(isoDate(d));
  }
  return dates;
}

/** Normalized層のフィード → docs/12 4章のShard（瑞穂町=Flexのみの最小構成） */
function buildShard(feed: ParsedFlexFeed, windowFrom: Date): Shard {
  const n = feed.normalized;
  // stopIdxを安定させるためstop_id数値順にソート（router側の前提ではなく生成側の決め事）
  const stops = [...n.stops].sort((a, b) => Number(a.stopId) - Number(b.stopId));
  const stopIdxOf = new Map(stops.map((s, i) => [s.stopId, i]));
  const routeIdxOf = new Map(n.routes.map((r, i) => [r.routeId, i]));
  const tripIdxOf = new Map(n.trips.map((t, i) => [t.tripId, i]));
  const groupIdxOf = new Map(n.locationGroups.map((g, i) => [g.locationGroupId, i]));
  const { bookingRules, ruleIdxOf } = compressBookingRules(n.bookingRules);
  const calendarOf = new Map(n.calendars.map((c) => [c.serviceId, c]));

  const windowTo = new Date(windowFrom);
  windowTo.setUTCDate(windowTo.getUTCDate() + CALENDAR_WINDOW_DAYS - 1);

  // Flexトリップ: 同一trip内のpickup_only行とdropoff_only行のペアから構築（docs/10 3.3節）
  const flexTrips: NonNullable<Shard["flex"]>["flexTrips"] = {
    tripIdx: [],
    locationGroupIdx: [],
    windowStartSec: [],
    windowEndSec: [],
    pickupBookingRuleIdx: [],
    dropOffBookingRuleIdx: [],
    meanDurationFactor: [],
    meanDurationOffset: [],
  };
  for (const trip of n.trips) {
    const rows = n.stopTimes.filter((st) => st.tripId === trip.tripId);
    const pickupRow = rows.find((r) => classifyStopTimeRow(r) === "pickup_only");
    const dropoffRow = rows.find((r) => classifyStopTimeRow(r) === "dropoff_only");
    if (!pickupRow?.pickupWindow || !dropoffRow || pickupRow.locationRef.kind !== "locationGroup") {
      continue;
    }
    flexTrips.tripIdx.push(tripIdxOf.get(trip.tripId)!);
    flexTrips.locationGroupIdx.push(groupIdxOf.get(pickupRow.locationRef.locationGroupId)!);
    flexTrips.windowStartSec.push(pickupRow.pickupWindow.start);
    flexTrips.windowEndSec.push(pickupRow.pickupWindow.end);
    flexTrips.pickupBookingRuleIdx.push(
      pickupRow.pickupBookingRuleId !== undefined
        ? (ruleIdxOf.get(pickupRow.pickupBookingRuleId) ?? null)
        : null,
    );
    flexTrips.dropOffBookingRuleIdx.push(
      dropoffRow.dropOffBookingRuleId !== undefined
        ? (ruleIdxOf.get(dropoffRow.dropOffBookingRuleId) ?? null)
        : null,
    );
    flexTrips.meanDurationFactor.push(null);
    flexTrips.meanDurationOffset.push(null);
  }

  return {
    meta: {
      shardId: "13-mizuho",
      shardKind: "prefecture",
      schemaVersion: 2,
      // ウィンドウ開始日の0時とする。実行時刻を入れると同一入力でも毎回差分が出て、
      // コミット対象成果物のレビューがノイズで埋まるため（日単位の粒度で足りる）
      generatedAt: `${isoDate(windowFrom)}T00:00:00Z`,
      calendarWindow: { from: isoDate(windowFrom), to: isoDate(windowTo) },
      sourceFeedIds: [FEED_ID],
      feedStatus: { [FEED_ID]: feed.warnings.length > 0 ? "ok_with_warnings" : "ok" },
    },
    stops: {
      stopId: stops.map((s) => s.stopId),
      stopName: stops.map((s) => s.name ?? s.stopId),
      lat: stops.map((s) => s.lat ?? 0),
      lon: stops.map((s) => s.lon ?? 0),
      sourceFeedId: stops.map(() => FEED_ID),
    },
    routes: {
      routeId: n.routes.map((r) => r.routeId),
      routeShortName: n.routes.map((r) => r.shortName ?? ""),
      routeLongName: n.routes.map((r) => r.longName ?? ""),
      routeType: n.routes.map((r) => r.routeType ?? 3),
      sourceFeedId: n.routes.map(() => FEED_ID),
    },
    trips: {
      tripId: n.trips.map((t) => t.tripId),
      routeIdx: n.trips.map((t) =>
        t.routeId !== undefined ? (routeIdxOf.get(t.routeId) ?? 0) : 0,
      ),
      serviceDates: n.trips.map((t) =>
        expandServiceDates(
          t.serviceId !== undefined ? calendarOf.get(t.serviceId) : undefined,
          n.calendarDates.filter((cd) => cd.serviceId === t.serviceId),
          windowFrom,
          CALENDAR_WINDOW_DAYS,
        ),
      ),
      headsign: n.trips.map((t) => t.headsign ?? null),
    },
    // 瑞穂町のstop_timesは全行が時間窓方式（location_group参照）のため固定路線行なし
    stopTimes: {
      tripIdx: n.stopTimes.map((st) => tripIdxOf.get(st.tripId)!),
      stopSequence: n.stopTimes.map((st) => st.stopSequence),
      stopIdx: n.stopTimes.map((st) =>
        st.locationRef.kind === "stop" ? (stopIdxOf.get(st.locationRef.stopId) ?? -1) : -1,
      ),
      arrivalSec: n.stopTimes.map((st) => st.arrivalTime ?? null),
      departureSec: n.stopTimes.map((st) => st.departureTime ?? null),
      pickupType: n.stopTimes.map((st) => st.pickupType),
      dropOffType: n.stopTimes.map((st) => st.dropOffType),
      // 瑞穂町は全行がlocation_group参照でFlex経路に載るため、定時便側の予約ルール参照は空になる。
      // 列自体は契約に含めておき、停留所型フィード（docs/17 C-24）と同じ形にする
      pickupBookingRuleIdx: n.stopTimes.map((st) =>
        st.locationRef.kind === "stop" && st.pickupBookingRuleId !== undefined
          ? (ruleIdxOf.get(st.pickupBookingRuleId) ?? null)
          : null,
      ),
      dropOffBookingRuleIdx: n.stopTimes.map((st) =>
        st.locationRef.kind === "stop" && st.dropOffBookingRuleId !== undefined
          ? (ruleIdxOf.get(st.dropOffBookingRuleId) ?? null)
          : null,
      ),
    },
    bookingRules,
    flex: {
      locationGroups: {
        locationGroupId: n.locationGroups.map((g) => g.locationGroupId),
        locationGroupName: n.locationGroups.map((g) => g.name ?? null),
        memberStopIdx: n.locationGroups.map((g) =>
          [...(n.locationGroupStops.get(g.locationGroupId) ?? [])].map((stopId) =>
            stopIdxOf.get(stopId)!,
          ),
        ),
      },
      flexTrips,
    },
    transfers: { fromStopIdx: [], toStopIdx: [], distanceM: [], walkSec: [] },
  };
}

function main(): void {
  // 1. フィクスチャ読み込み→パース
  const files: FlexFeedFiles = {};
  for (const name of readdirSync(fixtureDir)) {
    if (name.endsWith(".txt") || name.endsWith(".geojson")) {
      files[name] = new Uint8Array(readFileSync(path.join(fixtureDir, name)));
    }
  }
  const feed = parseFlexFeed(files);
  if (feed.warnings.length > 0) {
    console.warn(`パース警告 ${feed.warnings.length}件:`, feed.warnings);
  }

  // 2. シャード構築。ウィンドウ開始は既定で生成日のUTC日付だが、コミット対象の成果物は
  //    PINNED_WINDOW_FROM に固定する。実行日で窓がずれると 2026-07-07 を前提とする
  //    apps/mcp・apps/web のテストが落ちるため（成果物の再現性を保つ）。
  //    別日の窓で生成したい場合は NORISHIRO_SHARD_WINDOW_FROM=YYYY-MM-DD か "today" を渡す。
  const windowFromEnv = process.env.NORISHIRO_SHARD_WINDOW_FROM ?? PINNED_WINDOW_FROM;
  const windowFromIso =
    windowFromEnv === "today" ? isoDate(new Date()) : validateIsoDate(windowFromEnv);
  const windowFrom = new Date(`${windowFromIso}T00:00:00Z`);
  const shard = buildShard(feed, windowFrom);

  // 3. 書き出し
  mkdirSync(path.dirname(outPath), { recursive: true });
  const json = JSON.stringify(shard);
  writeFileSync(outPath, json);
  console.log(`出力: ${outPath} (${(json.length / 1024).toFixed(1)} KB)`);

  // 4. スモークテスト: 生成したシャードをloadShardし、ウィンドウ内の運行日でplan()が経路を返すこと
  loadShard(shard);
  const firstServiceDate = shard.trips.serviceDates.flat().sort()[0];
  if (firstServiceDate === undefined) {
    throw new Error("スモークテスト失敗: 運行日が1日も展開されていない");
  }
  const serviceDate = Number(firstServiceDate.replaceAll("-", ""));
  const itineraries = plan({
    origin: { kind: "stopId", stopId: "1" },
    destination: { kind: "stopId", stopId: "37" },
    departureTime: 36000,
    serviceDate,
    searchTime: { serviceDate, nowSec: 32400 },
  });
  if (itineraries.length === 0 || !itineraries[0]!.legs.some((l) => l.kind === "flex")) {
    throw new Error("スモークテスト失敗: 殿ケ谷会館→みずほ病院のFlex経路が返らない");
  }
  console.log(
    `スモークテストOK: ${firstServiceDate} 10:00発 殿ケ谷会館→みずほ病院 → ${itineraries.length}件（Flexレッグあり）`,
  );
}

main();
