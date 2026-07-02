// 予約締切の表示文言生成（docs/15 4.2節のコピー文言例に準拠）。
// 具体値（09:30まで）と相対値（あと30分）は必ず併記する（docs/15 4.3節「文言設計の要点」）。
import { formatClock, formatDurationMin } from "./format.js";

export type DeadlineVariant = "ok" | "soon" | "passed" | "unknown" | "other-day";

export interface DeadlineDisplay {
  variant: DeadlineVariant;
  text: string;
}

/** 「締切が近い」の閾値（docs/15 4.2節の「残り10分未満」例に合わせる） */
const SOON_THRESHOLD_SEC = 10 * 60;

export function deadlineDisplay(
  deadlineSec: number | undefined,
  searchServiceDate: number,
  now: { serviceDate: number; nowSec: number },
): DeadlineDisplay {
  if (deadlineSec === undefined) {
    return { variant: "unknown", text: "要予約（締切は予約先にご確認ください）" };
  }

  if (searchServiceDate !== now.serviceDate) {
    // 当日以外の探索: routerは締切情報のみ付与するため、カウントダウンせず絶対時刻で示す
    const month = Math.floor((searchServiceDate % 10000) / 100);
    const day = searchServiceDate % 100;
    return {
      variant: "other-day",
      text: `予約締切 ${month}/${day} ${formatClock(deadlineSec)} まで`,
    };
  }

  const remaining = deadlineSec - now.nowSec;
  if (remaining <= 0) {
    return { variant: "passed", text: "この便は予約締切を過ぎています" };
  }
  if (remaining < 60) {
    return {
      variant: "soon",
      text: `予約締切 ${formatClock(deadlineSec)} まで（まもなく予約締切です）`,
    };
  }
  // 残り時間は切り捨て分表示（実際より長く見せない）
  const relative = `あと${formatDurationMin(Math.floor(remaining / 60) * 60)}`;
  return {
    variant: remaining < SOON_THRESHOLD_SEC ? "soon" : "ok",
    text: `予約締切 ${formatClock(deadlineSec)} まで（${relative}）`,
  };
}
