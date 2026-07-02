// 「電話をかけたら、こう伝えてください」例文生成のテスト（docs/15 4.3節のコピー文言例）。
// ①高齢者本人が電話口で用件を言い忘れる、②家族が電話のかけ方を伝える、両場面を助ける要件。
import { describe, expect, it } from "vitest";
import { bookingScript } from "../src/lib/booking-script.js";

describe("bookingScript", () => {
  it("docs/15 4.3節の例文と同型: 火曜の朝10時・殿ケ谷会館→みずほ病院", () => {
    // 2026-07-07は火曜日
    expect(bookingScript("殿ケ谷会館", "みずほ病院", 20260707, 36000)).toBe(
      "火曜日の朝10時に、殿ケ谷会館からみずほ病院まで乗りたいです",
    );
  });

  it("分がある時刻は「10時30分」と読む", () => {
    expect(bookingScript("A", "B", 20260707, 37800)).toBe(
      "火曜日の朝10時30分に、AからBまで乗りたいです",
    );
  });

  it("時間帯ラベル: 昼・夕方・夜", () => {
    expect(bookingScript("A", "B", 20260708, 43200)).toContain("水曜日の昼12時に");
    expect(bookingScript("A", "B", 20260709, 61200)).toContain("木曜日の夕方17時に");
    expect(bookingScript("A", "B", 20260710, 68400)).toContain("金曜日の夜19時に");
  });
});
