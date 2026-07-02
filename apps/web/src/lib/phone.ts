// 電話番号の表示整形とtel:リンク生成（docs/15 4.5節）。
// phone_numberの値は構造化データとしてそのまま保持し、表示時のみ整形する。
// 判断できない形式は言い換えず原文のまま出す（寛容方針）。

export function formatPhoneDisplay(raw: string): string {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed; // 既にハイフン付き・国際表記等は原文のまま
  if (trimmed.length === 11) {
    return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 7)}-${trimmed.slice(7)}`;
  }
  if (trimmed.length === 10) {
    return `${trimmed.slice(0, 3)}-${trimmed.slice(3, 6)}-${trimmed.slice(6)}`;
  }
  return trimmed;
}

/** tel:スキームのリンク先。発信はOS標準の電話アプリに委ねる（アプリ内で発信を代行しない） */
export function telHref(raw: string): string {
  return `tel:${raw.replace(/[^\d+]/g, "")}`;
}
