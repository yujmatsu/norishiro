// IPベースの簡易レート制限（docs/14 2.3節: 60リクエスト/分/IP、超過はHTTP 429）。
// 方式は固定ウィンドウ・インスタンスローカル（docs/14 9.2節U-1の実装確定: 外部状態ストアは
// 持たない。複数インスタンス時は「インスタンスあたり60req/分/IP」となるが、max-instances上限
// （docs/14 7.1節）と併せて全体の計算資源上限は固定されるため許容する）。

export interface RateLimitDecision {
  allowed: boolean;
  /** 拒否時、次ウィンドウまでの秒数（Retry-Afterヘッダ用） */
  retryAfterSec: number;
}

const MAX_TRACKED_KEYS = 10000; // メモリ肥大防止の上限（超過時は全ウィンドウをリセット）

export class FixedWindowRateLimiter {
  private windowStartMs = 0;
  private counts = new Map<string, number>();

  constructor(
    private readonly limit: number = 60,
    private readonly windowMs: number = 60000,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  check(key: string): RateLimitDecision {
    const now = this.nowMs();
    if (now - this.windowStartMs >= this.windowMs) {
      this.windowStartMs = now - (now % this.windowMs);
      this.counts.clear();
    }
    if (this.counts.size >= MAX_TRACKED_KEYS && !this.counts.has(key)) {
      this.counts.clear();
    }
    const count = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, count);
    if (count <= this.limit) return { allowed: true, retryAfterSec: 0 };
    const retryAfterSec = Math.max(1, Math.ceil((this.windowStartMs + this.windowMs - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
}
