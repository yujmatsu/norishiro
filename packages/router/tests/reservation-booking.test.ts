// T-RAPTOR-11〜15 / T-API-06〜07: 予約制の定時便への締切・連絡先の添付
// （docs/20 §5.1、docs/17 C-24。シャード契約はdocs/12 4章 schemaVersion 2）
//
// 背景: T-26で pickup_type=2 のフラグは出せるようになったが、「何時までに、どこへ電話すれば
// よいか」が出せなかった。高知6件（香南市・南国市・四万十市・四万十町・土佐清水市・
// 高知県航空利用促進協議会）は location_groups を持たない停留所ベースの予約制定時便であり、
// Flexレッグ（FlexLeg.booking）の経路には載らない（docs/17 C-24）。
import { describe, expect, it } from "vitest";
import { loadShard, plan } from "../src/index.js";
import { RouterInputError } from "../src/errors.js";
import { buildShard, type BookingRuleSpec } from "./helpers/build-shard.js";

const DATE = 20260707; // DEFAULT_DATE(2026-07-07)のYYYYMMDD表現
const OTHER_DATE = 20260708;

// 座標は徒歩圏（800m）に入らない程度に離す（緯度0.05度≒5.5km）
const S = (id: string, i: number) => ({ id, lat: 35.0 + i * 0.05, lon: 139.0 });

/** 当日・乗車30分前まで（四万十町型: booking_type=1 + prior_notice_duration_min） */
const SAME_DAY_RULE: BookingRuleSpec = {
  bookingRuleId: "rule_same_day",
  bookingType: 1,
  priorNoticeDurationMin: 30,
  message: "ご利用の30分前までに予約が必要です。",
  phoneNumber: "0880-22-1131",
  infoUrl: "https://example.invalid/booking",
};

/** 前日17:00まで（土佐清水市・香南市型: booking_type=2 + last_day/last_time） */
const PRIOR_DAY_RULE: BookingRuleSpec = {
  bookingRuleId: "rule_prior_day",
  bookingType: 2,
  priorNoticeLastDay: 1,
  priorNoticeLastTime: "17:00:00",
  message: "前日17時までにお電話ください。",
  phoneNumber: "070-4800-9461",
};

/** 締切・連絡先を提供していないルール（実データの20フィード相当、docs/20 §2.3） */
const NO_DEADLINE_RULE: BookingRuleSpec = {
  bookingRuleId: "rule_no_deadline",
  bookingType: 1,
  priorNoticeDurationMin: null,
  phoneNumber: null,
};

/**
 * A(10:00) → B(10:10) → C(10:20) の1便。
 * 既定で乗車地Aに pickup_type=2 を付ける（高知の実データと同じ形）。
 */
function lineShard(opts: {
  rules?: BookingRuleSpec[];
  pickupBookingRuleIdx?: (number | null)[];
  dropOffBookingRuleIdx?: (number | null)[];
  pickupTypes?: number[];
  dropOffTypes?: number[];
}) {
  return buildShard({
    stops: [S("A", 0), S("B", 1), S("C", 2)],
    ...(opts.rules ? { bookingRules: opts.rules } : {}),
    trips: [
      {
        tripId: "t1",
        routeId: "r1",
        stops: ["A", "B", "C"],
        times: [36000, 36600, 37200],
        pickupTypes: opts.pickupTypes ?? [2, 0, 0],
        ...(opts.dropOffTypes ? { dropOffTypes: opts.dropOffTypes } : {}),
        ...(opts.pickupBookingRuleIdx ? { pickupBookingRuleIdx: opts.pickupBookingRuleIdx } : {}),
        ...(opts.dropOffBookingRuleIdx
          ? { dropOffBookingRuleIdx: opts.dropOffBookingRuleIdx }
          : {}),
      },
    ],
  });
}

/** nowSec を明示して当日/別日の分岐を決定的にする（既定は当日の8:00） */
function planAtoC(opts?: { serviceDate?: number; nowSec?: number }) {
  const serviceDate = opts?.serviceDate ?? DATE;
  return plan({
    origin: { kind: "stopId", stopId: "A" },
    destination: { kind: "stopId", stopId: "C" },
    departureTime: 35000,
    serviceDate,
    searchTime: { serviceDate: DATE, nowSec: opts?.nowSec ?? 28800 },
  });
}

function transitLegAtoC(opts?: { serviceDate?: number; nowSec?: number }) {
  const r = planAtoC(opts);
  expect(r).toHaveLength(1);
  const leg = r[0]!.legs.find((l) => l.kind === "transit");
  if (leg?.kind !== "transit") throw new Error("transit legが無い");
  return leg;
}

describe("T-RAPTOR-11: 乗車側の予約ルールが締切・連絡先としてtransitレッグに載る", () => {
  it("booking_type=1 は 出発時刻 - prior_notice_duration_min 分 が締切になる", () => {
    loadShard(lineShard({ rules: [SAME_DAY_RULE], pickupBookingRuleIdx: [0, null, null] }));
    const leg = transitLegAtoC();
    // A発は10:00(36000秒)。30分前 = 09:30 = 34200秒
    expect(leg.booking?.deadline).toBe(34200);
    expect(leg.booking?.phoneNumber).toBe("0880-22-1131");
    expect(leg.booking?.infoUrl).toBe("https://example.invalid/booking");
    // 自由文は言い換え・要約せずそのまま載せる（docs/14 3.4節）
    expect(leg.booking?.message).toBe("ご利用の30分前までに予約が必要です。");
  });

  it("boardingRequirement と booking は同時に立つ（フラグと詳細の両方を出す）", () => {
    loadShard(lineShard({ rules: [SAME_DAY_RULE], pickupBookingRuleIdx: [0, null, null] }));
    const leg = transitLegAtoC();
    expect(leg.boardingRequirement).toBe("phone_agency");
    expect(planAtoC()[0]!.summary.requiresBooking).toBe(true);
  });
});

describe("T-RAPTOR-12: booking_type=2（前日以前）の締切", () => {
  it("prior_notice_last_day/last_time からサービス日基準の相対秒で締切が出る", () => {
    loadShard(lineShard({ rules: [PRIOR_DAY_RULE], pickupBookingRuleIdx: [0, null, null] }));
    const leg = transitLegAtoC();
    // 前日(1日前)の17:00 → サービス日0時基準で 61200 - 86400 = -25200秒
    expect(leg.booking?.deadline).toBe(-25200);
    expect(leg.booking?.phoneNumber).toBe("070-4800-9461");
  });
});

describe("T-RAPTOR-13: 予約ルール参照が無ければ booking は付かない", () => {
  it("pickup_type=2 でも参照が無ければ booking は未定義（締切情報を提供しないフィード）", () => {
    // 実データの20フィード相当。「予約が必要」とだけ表明し締切・連絡先が無い（docs/20 §2.3）
    loadShard(lineShard({}));
    const leg = transitLegAtoC();
    expect(leg.boardingRequirement).toBe("phone_agency");
    expect(leg.booking).toBeUndefined();
  });

  it("予約ルール表が存在しても参照が無い行には booking が付かない", () => {
    loadShard(lineShard({ rules: [SAME_DAY_RULE] }));
    expect(transitLegAtoC().booking).toBeUndefined();
  });

  it("通常の便（pickup_type=0）には boardingRequirement も booking も付かない", () => {
    loadShard(lineShard({ pickupTypes: [0, 0, 0] }));
    const leg = transitLegAtoC();
    expect(leg.boardingRequirement).toBeUndefined();
    expect(leg.booking).toBeUndefined();
  });

  it("締切列が欠損したルールでは deadline のみ未定義になる（寛容フォールバック）", () => {
    loadShard(lineShard({ rules: [NO_DEADLINE_RULE], pickupBookingRuleIdx: [0, null, null] }));
    const leg = transitLegAtoC();
    expect(leg.booking).toBeDefined();
    expect(leg.booking?.deadline).toBeUndefined();
    expect(leg.booking?.phoneNumber).toBeUndefined();
  });
});

describe("T-RAPTOR-14: 降車側の予約ルールへのフォールバック", () => {
  it("乗車側に参照が無く降車側にある場合、降車側ルールから解決する", () => {
    loadShard(
      lineShard({
        rules: [SAME_DAY_RULE],
        pickupTypes: [0, 0, 0],
        dropOffTypes: [0, 0, 2],
        dropOffBookingRuleIdx: [null, null, 0],
      }),
    );
    const leg = transitLegAtoC();
    expect(leg.alightingRequirement).toBe("phone_agency");
    // 締切の基準時刻は降車側ルールでも乗車時刻（利用者が行動する時点）
    expect(leg.booking?.deadline).toBe(34200);
    expect(leg.booking?.phoneNumber).toBe("0880-22-1131");
  });

  it("両側に参照がある場合は乗車側ルールを優先する", () => {
    loadShard(
      lineShard({
        rules: [SAME_DAY_RULE, PRIOR_DAY_RULE],
        dropOffTypes: [0, 0, 2],
        pickupBookingRuleIdx: [0, null, null],
        dropOffBookingRuleIdx: [null, null, 1],
      }),
    );
    const leg = transitLegAtoC();
    expect(leg.booking?.deadline).toBe(34200); // 乗車側=SAME_DAY_RULE
    expect(leg.booking?.phoneNumber).toBe("0880-22-1131");
  });
});

describe("T-RAPTOR-15: 締切超過でもtransitレッグは枝刈りしない（Flexとの非対称性）", () => {
  it("当日・締切を過ぎていても経路は返り、締切情報が添付される", () => {
    loadShard(lineShard({ rules: [SAME_DAY_RULE], pickupBookingRuleIdx: [0, null, null] }));
    // 締切09:30に対して現在09:45。Flexレッグならここで捨てられる（flex.ts の feasible 判定）
    const leg = transitLegAtoC({ nowSec: 35100 });
    expect(leg.booking?.deadline).toBe(34200);
  });

  it("別サービス日の探索でも締切情報は付く（当日判定を発火させない）", () => {
    loadShard(
      lineShard({
        rules: [SAME_DAY_RULE],
        pickupBookingRuleIdx: [0, null, null],
      }),
    );
    // 探索対象はDATEのまま（便の運行日）で、基準日だけ別日にすると当日判定が外れる
    const r = plan({
      origin: { kind: "stopId", stopId: "A" },
      destination: { kind: "stopId", stopId: "C" },
      departureTime: 35000,
      serviceDate: DATE,
      searchTime: { serviceDate: OTHER_DATE, nowSec: 0 },
    });
    const leg = r[0]!.legs.find((l) => l.kind === "transit");
    if (leg?.kind !== "transit") throw new Error("transit legが無い");
    expect(leg.booking?.deadline).toBe(34200);
  });
});

describe("T-API-06: 予約ルールはflexの有無に関わらずトップレベルから解決する", () => {
  it("flex=null のシャード（高知型）でも予約ルールが読める", () => {
    const shard = lineShard({ rules: [SAME_DAY_RULE], pickupBookingRuleIdx: [0, null, null] });
    expect(shard.flex).toBeNull();
    expect(shard.bookingRules).not.toBeNull();
    loadShard(shard);
    expect(transitLegAtoC().booking?.phoneNumber).toBe("0880-22-1131");
  });

  it("予約ルールが1件も無ければ bookingRules は null になる", () => {
    expect(lineShard({}).bookingRules).toBeNull();
  });
});

describe("T-API-07: 未知のschemaVersionはロードを拒否する", () => {
  it("schemaVersion 1 のシャードは読み込めない（docs/12 4.6節）", () => {
    const shard = lineShard({});
    // 契約の破壊的変更を検出できることの確認。型上は2固定なのでキャストで旧版を作る
    const legacy = {
      ...shard,
      meta: { ...shard.meta, schemaVersion: 1 as unknown as 2 },
    };
    expect(() => loadShard(legacy)).toThrow(RouterInputError);
  });
});
