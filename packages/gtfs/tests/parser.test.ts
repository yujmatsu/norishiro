// GTFS-Flexパーサ単体テスト T-P01〜T-P09（docs/10_GTFS-Flex実装仕様.md 5.1節）
// 瑞穂町フィクスチャ（tests/fixtures/mizuho/）を正とする。
// 寛容性検証（T-P07〜T-P09）はフィクスチャ本体を改変せず、メモリ上で改変したコピーを使う。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyStopTimeRow, parseFlexFeed, type FlexFeedFiles } from "../src/index.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "mizuho");

/** 瑞穂町フィクスチャ12ファイルをバイト列のまま読み込む（README.mdは除外） */
function loadMizuhoFiles(): FlexFeedFiles {
  const files: FlexFeedFiles = {};
  for (const name of readdirSync(fixtureDir)) {
    if (name.endsWith(".txt")) {
      files[name] = new Uint8Array(readFileSync(path.join(fixtureDir, name)));
    }
  }
  return files;
}

function loadMizuhoText(name: string): string {
  return readFileSync(path.join(fixtureDir, name), "utf-8");
}

const HOUR = 3600;

describe("T-P01: 瑞穂町12ファイルの読み込み", () => {
  it("12ファイル全てをパースエラーなく完了する", () => {
    const files = loadMizuhoFiles();
    expect(Object.keys(files)).toHaveLength(12);
    const feed = parseFlexFeed(files);
    expect(feed.warnings).toEqual([]);
    expect(feed.normalized.stops).toHaveLength(120);
    expect(feed.normalized.stopTimes).toHaveLength(4);
    expect(feed.normalized.trips).toHaveLength(2);
  });

  it("locations.geojsonの不存在は警告ではなく正常系（該当ファイルなしフラグ）として扱う", () => {
    const feed = parseFlexFeed(loadMizuhoFiles());
    expect(feed.locationsGeojsonPresent).toBe(false);
    expect(feed.missingFiles).toContain("locations.geojson");
    expect(feed.warnings).toEqual([]);
  });
});

describe("T-P02: stop_timesの時間窓正規化", () => {
  it("4行全てがarrival/departure未定義・時間窓09:00-17:00として正規化される", () => {
    const feed = parseFlexFeed(loadMizuhoFiles());
    expect(feed.normalized.stopTimes).toHaveLength(4);
    for (const st of feed.normalized.stopTimes) {
      expect(st.arrivalTime).toBeUndefined();
      expect(st.departureTime).toBeUndefined();
      expect(st.pickupWindow).toEqual({ start: 9 * HOUR, end: 17 * HOUR });
    }
  });
});

describe("T-P03: pickup/drop_off_typeのパースと乗降行分類（3.3節）", () => {
  it("east_tripのstop_sequence=1がpickup_only、=2がdropoff_onlyと判定される", () => {
    const feed = parseFlexFeed(loadMizuhoFiles());
    const eastRows = feed.normalized.stopTimes.filter((st) => st.tripId === "east_trip");
    expect(eastRows).toHaveLength(2);

    const seq1 = eastRows.find((st) => st.stopSequence === 1);
    const seq2 = eastRows.find((st) => st.stopSequence === 2);
    expect(seq1).toBeDefined();
    expect(seq2).toBeDefined();

    expect(seq1?.pickupType).toBe(2);
    expect(seq1?.dropOffType).toBe(1);
    expect(classifyStopTimeRow(seq1!)).toBe("pickup_only");

    expect(seq2?.pickupType).toBe(1);
    expect(seq2?.dropOffType).toBe(2);
    expect(classifyStopTimeRow(seq2!)).toBe("dropoff_only");
  });
});

describe("T-P04: location_group_stopsの集合構築", () => {
  it("mizuhomachi_groupに属するstop_idの集合が{1..120}（要素数120、重複なし）になる", () => {
    const feed = parseFlexFeed(loadMizuhoFiles());
    const stops = feed.normalized.locationGroupStops.get("mizuhomachi_group");
    expect(stops).toBeDefined();
    expect(stops!.size).toBe(120);
    const expected = new Set(Array.from({ length: 120 }, (_, i) => String(i + 1)));
    expect(stops).toEqual(expected);
  });
});

describe("T-P05: booking_rulesの正規化", () => {
  it("generalルールがbookingType=1, priorNoticeDurationMin=30、未定義列はundefinedになる", () => {
    const feed = parseFlexFeed(loadMizuhoFiles());
    const rule = feed.normalized.bookingRules.get("general");
    expect(rule).toBeDefined();
    expect(rule?.bookingType).toBe(1);
    expect(rule?.priorNoticeDurationMin).toBe(30);
    expect(rule?.priorNoticeDurationMax).toBeUndefined();
    expect(rule?.priorNoticeLastDay).toBeUndefined();
    expect(rule?.priorNoticeLastTime).toBeUndefined();
    expect(rule?.priorNoticeStartDay).toBeUndefined();
    expect(rule?.phoneNumber).toBe("050-2030-2630");
    // booking_urlは列が存在するが値が空文字（4.1節の逸脱6）→ undefinedとして扱う
    expect(rule?.bookingUrl).toBeUndefined();
  });
});

describe("T-P06: calendarの曜日解釈", () => {
  it("east_serviceが火・金・土、west_serviceが月・水・土として解釈される", () => {
    const feed = parseFlexFeed(loadMizuhoFiles());
    const east = feed.normalized.calendars.find((c) => c.serviceId === "east_service");
    const west = feed.normalized.calendars.find((c) => c.serviceId === "west_service");
    expect(east?.days).toEqual({
      monday: false,
      tuesday: true,
      wednesday: false,
      thursday: false,
      friday: true,
      saturday: true,
      sunday: false,
    });
    expect(west?.days).toEqual({
      monday: true,
      tuesday: false,
      wednesday: true,
      thursday: false,
      friday: false,
      saturday: true,
      sunday: false,
    });
  });
});

describe("T-P07: 寛容性 — arrival_time/departure_time列自体の削除", () => {
  it("列を丸ごと削除したCSVでも例外を投げず、時間窓方式として正規化される", () => {
    // arrival_time/departure_time列を持つ合成CSVから、両列を完全に削除した改変版を作る
    // （4.1節の逸脱1「列そのものが未定義」を模す）
    const withoutTimeColumns = [
      "trip_id,location_group_id,stop_sequence,start_pickup_drop_off_window,end_pickup_drop_off_window,pickup_type,drop_off_type",
      "t1,g1,1,09:00:00,17:00:00,2,1",
      "t1,g1,2,09:00:00,17:00:00,1,2",
    ].join("\n");

    const files: FlexFeedFiles = { ...loadMizuhoFiles(), "stop_times.txt": withoutTimeColumns };
    let feed!: ReturnType<typeof parseFlexFeed>;
    expect(() => {
      feed = parseFlexFeed(files);
    }).not.toThrow();

    const rows = feed.normalized.stopTimes.filter((st) => st.tripId === "t1");
    expect(rows).toHaveLength(2);
    for (const st of rows) {
      expect(st.arrivalTime).toBeUndefined();
      expect(st.departureTime).toBeUndefined();
      expect(st.pickupWindow).toEqual({ start: 9 * HOUR, end: 17 * HOUR });
    }
  });
});

describe("T-P08: 寛容性 — UTF-8 BOM付きファイル", () => {
  it("先頭にBOM（EF BB BF）を付加しても1列目のヘッダー名が正しく認識される", () => {
    const original = new Uint8Array(readFileSync(path.join(fixtureDir, "stop_times.txt")));
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    const withBom = new Uint8Array(bom.length + original.length);
    withBom.set(bom, 0);
    withBom.set(original, bom.length);

    const files: FlexFeedFiles = { ...loadMizuhoFiles(), "stop_times.txt": withBom };
    const feed = parseFlexFeed(files);

    // BOMが列名先頭に混入していれば trip_id が読めず全行破棄されるため、これで検証できる
    expect(feed.normalized.stopTimes).toHaveLength(4);
    expect(feed.normalized.stopTimes[0]?.tripId).toBe("east_trip");
  });
});

describe("T-P10: 寛容性 — 列順の違い（docs/10 4.2節、番号は既存体系T-P*の追番）", () => {
  it("列順を入れ替えたCSVでもヘッダー名で正しく解釈される", () => {
    // 瑞穂町のstop_times.txtと同内容・列順のみシャッフルした改変版
    const reordered = [
      "timepoint,drop_off_type,pickup_type,end_pickup_drop_off_window,start_pickup_drop_off_window,stop_sequence,location_group_id,trip_id,pickup_booking_rule_id,drop_off_booking_rule_id",
      "1,1,2,17:00:00,09:00:00,1,mizuhomachi_group,east_trip,general,",
      "1,2,1,17:00:00,09:00:00,2,mizuhomachi_group,east_trip,,general",
    ].join("\n");
    const files: FlexFeedFiles = { ...loadMizuhoFiles(), "stop_times.txt": reordered };
    const feed = parseFlexFeed(files);

    expect(feed.normalized.stopTimes).toHaveLength(2);
    const seq1 = feed.normalized.stopTimes.find((st) => st.stopSequence === 1);
    expect(seq1?.tripId).toBe("east_trip");
    expect(seq1?.pickupType).toBe(2);
    expect(seq1?.dropOffType).toBe(1);
    expect(seq1?.pickupWindow).toEqual({ start: 9 * HOUR, end: 17 * HOUR });
    expect(seq1?.pickupBookingRuleId).toBe("general");
  });
});

describe("T-P11: 寛容性 — CRLF改行（docs/10 4.2節、番号は既存体系T-P*の追番）", () => {
  it("LFをCRLFに変換したファイルでも同一の結果になる", () => {
    const crlf = loadMizuhoText("stop_times.txt").replace(/\n/g, "\r\n");
    const files: FlexFeedFiles = { ...loadMizuhoFiles(), "stop_times.txt": crlf };
    const feed = parseFlexFeed(files);

    expect(feed.normalized.stopTimes).toHaveLength(4);
    for (const st of feed.normalized.stopTimes) {
      expect(st.pickupWindow).toEqual({ start: 9 * HOUR, end: 17 * HOUR });
    }
    expect(feed.warnings).toEqual([]);
  });
});

describe("T-P09: 寛容性 — booking_rules.txtがヘッダー行のみ（データ0行）", () => {
  it("外部キー不整合を警告に記録しつつ、パース自体は継続する", () => {
    const headerOnly = loadMizuhoText("booking_rules.txt").split("\n")[0]!;
    const files: FlexFeedFiles = { ...loadMizuhoFiles(), "booking_rules.txt": headerOnly };

    let feed!: ReturnType<typeof parseFlexFeed>;
    expect(() => {
      feed = parseFlexFeed(files);
    }).not.toThrow();

    // stop_timesの4行はgeneralを参照するが、参照先が無い → 警告＋予約制約なしとして継続
    expect(feed.normalized.bookingRules.size).toBe(0);
    expect(feed.normalized.stopTimes).toHaveLength(4);
    const fkWarnings = feed.warnings.filter((w) => w.code === "foreign_key_mismatch");
    expect(fkWarnings.length).toBeGreaterThan(0);
    expect(fkWarnings[0]?.file).toBe("stop_times.txt");
    for (const st of feed.normalized.stopTimes) {
      expect(st.pickupBookingRuleId).toBeUndefined();
      expect(st.dropOffBookingRuleId).toBeUndefined();
    }
  });
});
