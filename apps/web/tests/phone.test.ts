// 電話番号の表示整形とtel:リンクのテスト（docs/15 4.5節:
// phone_numberの値をそのまま保持しつつ表示時にハイフン区切りへ整形。発信はtel:スキームでOS標準に委ねる）
import { describe, expect, it } from "vitest";
import { formatPhoneDisplay, telHref } from "../src/lib/phone.js";

describe("formatPhoneDisplay", () => {
  it("既にハイフン付きの実データ値はそのまま表示する（瑞穂町: 050-2030-2630）", () => {
    expect(formatPhoneDisplay("050-2030-2630")).toBe("050-2030-2630");
  });

  it("数字のみ11桁は3-4-4で整形する", () => {
    expect(formatPhoneDisplay("05020302630")).toBe("050-2030-2630");
  });

  it("数字のみ10桁は3-3-4で整形する", () => {
    expect(formatPhoneDisplay("0421234567")).toBe("042-123-4567");
  });

  it("判断できない形式は原文のまま返す（言い換えない）", () => {
    expect(formatPhoneDisplay("+81 50 2030 2630")).toBe("+81 50 2030 2630");
    expect(formatPhoneDisplay("12345")).toBe("12345");
  });
});

describe("telHref", () => {
  it("ハイフン・空白を除いたtel:リンクを生成する", () => {
    expect(telHref("050-2030-2630")).toBe("tel:05020302630");
    expect(telHref("+81 50 2030 2630")).toBe("tel:+815020302630");
  });
});
