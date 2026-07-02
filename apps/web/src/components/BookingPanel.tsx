// S5: 予約案内パネル（docs/15 3.5節・4.3節・4.5節）。
// - 締切は具体値と相対値を必ず併記（4.3節「文言設計の要点」）
// - booking_rules.messageの自由文はそのまま提示（言い換え・要約をしない、docs/14 3.4節）
// - 末尾の「※ この画面から予約は完了しません…」は必須文言（確定判断11）。省略・弱める言い換え禁止
import { forwardRef } from "react";
import type { FlexLeg } from "@norishiro/router";
import { deadlineDisplay } from "../lib/booking-display.js";
import { bookingScript, serviceDateLabel } from "../lib/booking-script.js";
import { formatClock } from "../lib/format.js";
import { formatPhoneDisplay, telHref } from "../lib/phone.js";
import type { SearchNow } from "../lib/time.js";

export interface BookingPanelProps {
  leg: FlexLeg;
  fromName: string;
  toName: string;
  serviceDate: number;
  now: SearchNow;
}

export const BookingPanel = forwardRef<HTMLElement, BookingPanelProps>(function BookingPanel(
  { leg, fromName, toName, serviceDate, now },
  ref,
) {
  const { booking } = leg;
  const deadline = deadlineDisplay(booking.deadline, serviceDate, now);

  return (
    <section className="booking-panel" aria-label="予約のご案内" ref={ref} tabIndex={-1}>
      <h2 className="booking-title">🚐 デマンド交通（要予約）</h2>

      <p className="booking-route">
        {fromName} → {toName}
      </p>
      <p className="booking-departure">
        希望発車: {serviceDateLabel(serviceDate)} {formatClock(leg.departureTime)}
      </p>

      <p className={`booking-deadline deadline-${deadline.variant}`}>{deadline.text}</p>

      {booking.message !== undefined && booking.message !== "" && (
        /* 事業者の案内文原文。締切計算結果と並記して両方見せる（docs/15 4.3節） */
        <p className="booking-message">{booking.message}</p>
      )}

      {booking.phoneNumber !== undefined && booking.phoneNumber !== "" ? (
        <>
          <a className="btn btn-primary" href={telHref(booking.phoneNumber)}>
            📞 {formatPhoneDisplay(booking.phoneNumber)} に電話する
          </a>
          <p className="booking-script-lead">電話をかけたら、こう伝えてください：</p>
          <p className="booking-script">
            「{bookingScript(fromName, toName, serviceDate, leg.departureTime)}」
          </p>
        </>
      ) : (
        <p>予約方法は運行事業者の案内をご確認ください。</p>
      )}

      {/* booking_urlが空の場合はオンライン予約ボタンを出さない（docs/15 4.5節） */}
      {booking.bookingUrl !== undefined && booking.bookingUrl !== "" && (
        <a className="btn" href={booking.bookingUrl} target="_blank" rel="noreferrer">
          オンライン予約ページを開く
        </a>
      )}
      {booking.infoUrl !== undefined && booking.infoUrl !== "" && (
        <a className="btn" href={booking.infoUrl} target="_blank" rel="noreferrer">
          運行事業者の案内ページを開く
        </a>
      )}

      <p className="booking-caution">
        ※ この画面から予約は完了しません。電話（または案内先サイト）で直接お申し込みください。
      </p>
    </section>
  );
});
