// 経路カード（docs/15 3.3節）。所要・乗換数・徒歩量の3指標を常に同じ位置・順序で表示し、
// Flexレッグを含む経路は要予約バッジ＋締切をカード表面から見せる（docs/15 4.1節・4.2節）。
import type { ReactElement } from "react";
import type { FlexLeg, Itinerary } from "@norishiro/router";
import { deadlineDisplay } from "../lib/booking-display.js";
import { formatClock, formatDurationMin, totalWalkMeters, walkAmountLabel } from "../lib/format.js";
import type { SearchNow } from "../lib/time.js";

export interface ItineraryCardProps {
  itinerary: Itinerary;
  /** 探索対象のサービス日（締切カウントダウンの当日判定に使う） */
  serviceDate: number;
  /** カウントダウン表示の基準時刻（親が周期更新する） */
  now: SearchNow;
  /** 締切超過時の代替候補として強調表示するか（docs/15 4.4節） */
  suggested?: boolean;
}

export function ItineraryCard({
  itinerary,
  serviceDate,
  now,
  suggested = false,
}: ItineraryCardProps): ReactElement {
  const { summary, legs } = itinerary;
  const flexLeg = legs.find((leg): leg is FlexLeg => leg.kind === "flex");
  const deadline =
    flexLeg === undefined ? null : deadlineDisplay(flexLeg.booking.deadline, serviceDate, now);

  return (
    <li className={suggested ? "card card-suggested" : "card"}>
      <p className="indicators">
        <span>所要 {formatDurationMin(summary.durationSec)}</span>
        <span>乗換 {summary.transferCount}回</span>
        <span>徒歩 {walkAmountLabel(totalWalkMeters(legs))}</span>
      </p>
      <p className="times">
        {formatClock(summary.departureTime)}発 → {formatClock(summary.arrivalTime)}着
        {/* Flexの所要はHaversine推定のため目安表記（docs/13 8章 FlexLeg.arrivalTime） */}
        {summary.requiresBooking && "（目安）"}
      </p>
      {deadline !== null ? (
        <p className={`badge badge-flex deadline-${deadline.variant}`}>
          🚐 要予約{"　"}
          {deadline.text}
        </p>
      ) : (
        <p className="badge badge-fixed">🚌 固定路線のみ</p>
      )}
    </li>
  );
}
