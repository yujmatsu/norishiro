// 瑞穂町フィクスチャ（packages/gtfs/tests/fixtures/mizuho/）をdocs/12 4章のShard形式へ
// 変換するテスト専用ヘルパー（docs/13 10章「apps/pipeline相当の変換」に対応）。
// 依存方向ルール（packages/routerはpackages/gtfsに依存しない）を守るため、
// @norishiro/gtfs はimportせず、既知のクリーンなフィクスチャ限定の簡易CSV読みで済ませる。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Shard } from "@norishiro/types";

const fixtureDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "gtfs",
  "tests",
  "fixtures",
  "mizuho",
);

/** フィクスチャ限定の簡易CSV読み（クオート・カンマ埋め込みが無いことを確認済みのファイル専用） */
function readCsv(name: string): Record<string, string>[] {
  const lines = readFileSync(path.join(fixtureDir, name), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const header = lines[0]!.split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function parseTimeSec(v: string): number {
  const [h, m, s] = v.split(":").map(Number);
  return h! * 3600 + m! * 60 + s!;
}

/** カレンダーの曜日パターンから、windowFrom〜windowTo（YYYY-MM-DD）の運行日リストを作る */
function expandServiceDates(
  days: Record<string, string>,
  windowFrom: string,
  windowTo: string,
): string[] {
  const dayColumns = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dates: string[] = [];
  const cur = new Date(`${windowFrom}T00:00:00Z`);
  const end = new Date(`${windowTo}T00:00:00Z`);
  while (cur <= end) {
    if (days[dayColumns[cur.getUTCDay()]!] === "1") {
      dates.push(cur.toISOString().slice(0, 10));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

export const MIZUHO_WINDOW = { from: "2026-07-06", to: "2026-07-12" } as const;
/** 火曜（east_service運行日） */
export const TUESDAY = 20260707;
/** 水曜（west_serviceのみ運行） */
export const WEDNESDAY = 20260708;
/** 木曜（両サービスとも非運行） */
export const THURSDAY = 20260709;

/** 瑞穂町フィクスチャからShard JSONを構築する。stopIdx = stop_id - 1 になるようソート済み */
export function buildMizuhoShard(): Shard {
  const stops = readCsv("stops.txt").sort((a, b) => Number(a.stop_id) - Number(b.stop_id));
  const calendars = new Map(readCsv("calendar.txt").map((r) => [r.service_id!, r]));
  const tripsCsv = readCsv("trips.txt");
  const stopTimesCsv = readCsv("stop_times.txt");
  const bookingRulesCsv = readCsv("booking_rules.txt");
  const groupStops = readCsv("location_group_stops.txt");
  const groups = readCsv("location_groups.txt");

  const stopIdxOf = new Map(stops.map((s, i) => [s.stop_id!, i]));
  const ruleIdxOf = new Map(bookingRulesCsv.map((r, i) => [r.booking_rule_id!, i]));
  const groupIdxOf = new Map(groups.map((g, i) => [g.location_group_id!, i]));
  const tripIdxOf = new Map(tripsCsv.map((t, i) => [t.trip_id!, i]));

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
  for (const trip of tripsCsv) {
    const rows = stopTimesCsv.filter((st) => st.trip_id === trip.trip_id);
    const pickupRow = rows.find((r) => r.pickup_type === "2");
    const dropoffRow = rows.find((r) => r.drop_off_type === "2");
    if (!pickupRow || !dropoffRow) continue;
    flexTrips.tripIdx.push(tripIdxOf.get(trip.trip_id!)!);
    flexTrips.locationGroupIdx.push(groupIdxOf.get(pickupRow.location_group_id!)!);
    flexTrips.windowStartSec.push(parseTimeSec(pickupRow.start_pickup_drop_off_window!));
    flexTrips.windowEndSec.push(parseTimeSec(pickupRow.end_pickup_drop_off_window!));
    flexTrips.pickupBookingRuleIdx.push(ruleIdxOf.get(pickupRow.pickup_booking_rule_id!) ?? null);
    flexTrips.dropOffBookingRuleIdx.push(
      ruleIdxOf.get(dropoffRow.drop_off_booking_rule_id!) ?? null,
    );
    flexTrips.meanDurationFactor.push(null);
    flexTrips.meanDurationOffset.push(null);
  }

  return {
    meta: {
      shardId: "13-mizuho",
      shardKind: "prefecture",
      schemaVersion: 1,
      generatedAt: "2026-07-02T00:00:00Z",
      calendarWindow: { ...MIZUHO_WINDOW },
      sourceFeedIds: ["mizuho-flex"],
      feedStatus: { "mizuho-flex": "ok" },
    },
    stops: {
      stopId: stops.map((s) => s.stop_id!),
      stopName: stops.map((s) => s.stop_name!),
      lat: stops.map((s) => Number(s.stop_lat)),
      lon: stops.map((s) => Number(s.stop_lon)),
      sourceFeedId: stops.map(() => "mizuho-flex"),
    },
    routes: {
      routeId: ["mizuhomachi_route"],
      routeShortName: ["瑞穂町デマンド"],
      routeLongName: ["チョイソコみずほまち"],
      routeType: [715],
      sourceFeedId: ["mizuho-flex"],
    },
    trips: {
      tripId: tripsCsv.map((t) => t.trip_id!),
      routeIdx: tripsCsv.map(() => 0),
      serviceDates: tripsCsv.map((t) =>
        expandServiceDates(calendars.get(t.service_id!)!, MIZUHO_WINDOW.from, MIZUHO_WINDOW.to),
      ),
      headsign: tripsCsv.map((t) => t.trip_headsign ?? null),
    },
    // 瑞穂町のstop_timesは全行がlocation_group参照（時間窓方式）のためstopIdx=-1（docs/12 4.3節）
    stopTimes: {
      tripIdx: stopTimesCsv.map((st) => tripIdxOf.get(st.trip_id!)!),
      stopSequence: stopTimesCsv.map((st) => Number(st.stop_sequence)),
      stopIdx: stopTimesCsv.map(() => -1),
      arrivalSec: stopTimesCsv.map(() => null),
      departureSec: stopTimesCsv.map(() => null),
      pickupType: stopTimesCsv.map((st) => Number(st.pickup_type)),
      dropOffType: stopTimesCsv.map((st) => Number(st.drop_off_type)),
    },
    flex: {
      locationGroups: {
        locationGroupId: groups.map((g) => g.location_group_id!),
        locationGroupName: groups.map((g) => g.location_group_name ?? null),
        memberStopIdx: groups.map((g) =>
          groupStops
            .filter((gs) => gs.location_group_id === g.location_group_id)
            .map((gs) => stopIdxOf.get(gs.stop_id!)!),
        ),
      },
      flexTrips,
      bookingRules: {
        bookingRuleId: bookingRulesCsv.map((r) => r.booking_rule_id!),
        bookingType: bookingRulesCsv.map((r) => Number(r.booking_type)),
        priorNoticeDurationMin: bookingRulesCsv.map((r) =>
          r.prior_notice_duration_min ? Number(r.prior_notice_duration_min) : null,
        ),
        priorNoticeDurationMax: bookingRulesCsv.map(() => null),
        priorNoticeLastDay: bookingRulesCsv.map(() => null),
        priorNoticeLastTime: bookingRulesCsv.map(() => null),
        message: bookingRulesCsv.map((r) => r.message ?? null),
        phoneNumber: bookingRulesCsv.map((r) => r.phone_number ?? null),
        infoUrl: bookingRulesCsv.map((r) => r.info_url ?? null),
      },
    },
    transfers: { fromStopIdx: [], toStopIdx: [], distanceM: [], walkSec: [] },
  };
}
