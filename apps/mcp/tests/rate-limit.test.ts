// レート制限のテスト（T-MCP-13）。docs/14 2.3節: 固定ウィンドウ・IP単位・超過拒否と
// ウィンドウ経過後の回復を検証する（時刻は注入クロックで制御）。

import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "../src/rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("T-MCP-13: 上限内は許可、超過は拒否（Retry-After付き）、次ウィンドウで回復する", () => {
    let now = 0;
    const limiter = new FixedWindowRateLimiter(3, 60000, () => now);

    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-a").allowed).toBe(true);
    expect(limiter.check("ip-a").allowed).toBe(true);
    const denied = limiter.check("ip-a");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThanOrEqual(1);

    // 別IPは独立してカウントされる
    expect(limiter.check("ip-b").allowed).toBe(true);

    // ウィンドウ経過後は回復する
    now = 60001;
    expect(limiter.check("ip-a").allowed).toBe(true);
  });
});
