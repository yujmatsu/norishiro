// 現在時刻・日付入力の変換ヘルパー（Date依存はこのモジュールに集約する）

export interface SearchNow {
  serviceDate: number;
  nowSec: number;
}

export function serviceDateOf(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

export function secOfDayOf(date: Date): number {
  return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
}

/** 探索基準時刻としての「今」（docs/13 8章 PlanRequest.searchTime） */
export function currentNow(date: Date = new Date()): SearchNow {
  return { serviceDate: serviceDateOf(date), nowSec: secOfDayOf(date) };
}

/** input[type=date]の値（YYYY-MM-DD）→ サービス日整数（YYYYMMDD）。不正はnull */
export function parseDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return null;
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
}

/** input[type=time]の値（HH:MM）→ サービス日の秒。不正はnull */
export function parseTimeInput(value: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(value);
  if (m === null) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60;
}

export function toDateInputValue(serviceDate: number): string {
  const y = Math.floor(serviceDate / 10000);
  const mo = Math.floor((serviceDate % 10000) / 100);
  const d = serviceDate % 100;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function toTimeInputValue(sec: number): string {
  const h = Math.floor(sec / 3600) % 24;
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
