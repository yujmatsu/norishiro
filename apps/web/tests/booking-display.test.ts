// 予約締切表示のテスト（docs/15 4.2節のコピー文言、4.3節「具体値と相対値の併記」要件）
import { describe, expect, it } from "vitest";
import { deadlineDisplay } from "../src/lib/booking-display.js";

// 瑞穂町の実データ値: 探索基準9:00、締切9:30（docs/13 10.1節）
const NOW_0900 = { serviceDate: 20260707, nowSec: 32400 };

describe("deadlineDisplay（当日探索）", () => {
  it("余裕がある場合: 具体値と相対値を併記する（あと30分）", () => {
    const d = deadlineDisplay(34200, 20260707, NOW_0900);
    expect(d.variant).toBe("ok");
    expect(d.text).toBe("予約締切 09:30 まで（あと30分）");
  });

  it("残り10分未満はsoon（警戒表示、docs/15 4.2節の閾値例）", () => {
    const d = deadlineDisplay(32880, 20260707, NOW_0900); // 9:08締切、残り8分
    expect(d.variant).toBe("soon");
    expect(d.text).toBe("予約締切 09:08 まで（あと8分）");
  });

  it("残り1分未満は「まもなく」表示", () => {
    const d = deadlineDisplay(32430, 20260707, NOW_0900); // 残り30秒
    expect(d.variant).toBe("soon");
    expect(d.text).toContain("まもなく");
  });

  it("締切超過はpassed（docs/15 4.2節の打ち切り文言）", () => {
    const d = deadlineDisplay(32100, 20260707, NOW_0900); // 8:55締切
    expect(d.variant).toBe("passed");
    expect(d.text).toBe("この便は予約締切を過ぎています");
  });
});

describe("deadlineDisplay（当日以外・締切不明）", () => {
  it("未来日の探索は絶対時刻のみ表示（カウントダウンしない）", () => {
    const d = deadlineDisplay(34200, 20260714, NOW_0900);
    expect(d.variant).toBe("other-day");
    expect(d.text).toBe("予約締切 7/14 09:30 まで");
  });

  it("締切不明（deadline未定義）は予約必要のみ伝える", () => {
    const d = deadlineDisplay(undefined, 20260707, NOW_0900);
    expect(d.variant).toBe("unknown");
    expect(d.text).toBe("要予約（締切は予約先にご確認ください）");
  });
});
