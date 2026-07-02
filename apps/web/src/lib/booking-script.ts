// 「電話をかけたら、こう伝えてください」例文生成（docs/15 4.3節）。
// ①高齢者本人が電話口で用件を言い忘れる、②家族が本人に電話のかけ方を伝える、両場面を助ける。

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"] as const;

function dayIndex(serviceDate: number): number {
  const y = Math.floor(serviceDate / 10000);
  const m = Math.floor((serviceDate % 10000) / 100);
  const d = serviceDate % 100;
  return new Date(y, m - 1, d).getDay();
}

/** 「7/7（火）」形式の日付ラベル（S5パネルの希望発車表示用） */
export function serviceDateLabel(serviceDate: number): string {
  const m = Math.floor((serviceDate % 10000) / 100);
  const d = serviceDate % 100;
  return `${m}/${d}（${DAY_NAMES[dayIndex(serviceDate)]!}）`;
}

function timeSlotLabel(hour: number): string {
  if (hour >= 5 && hour <= 10) return "朝";
  if (hour >= 11 && hour <= 15) return "昼";
  if (hour >= 16 && hour <= 18) return "夕方";
  if (hour >= 19 && hour <= 23) return "夜";
  return "早朝";
}

export function bookingScript(
  fromName: string,
  toName: string,
  serviceDate: number,
  departureSec: number,
): string {
  const hour = Math.floor(departureSec / 3600) % 24;
  const minute = Math.floor((departureSec % 3600) / 60);
  const time = minute === 0 ? `${hour}時` : `${hour}時${minute}分`;
  return `${DAY_NAMES[dayIndex(serviceDate)]!}曜日の${timeSlotLabel(hour)}${time}に、${fromName}から${toName}まで乗りたいです`;
}
