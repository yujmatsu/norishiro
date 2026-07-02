// CSV読み込み（docs/10 4.2節・4.4節の寛容パーサ要件）
// - RFC4180準拠のパースはpapaparseに委譲する（独自のsplit(",")は禁止）
// - BOM付きUTF-8を許容し、列名先頭へのBOM混入を防ぐ
// - UTF-8でデコードできない場合はShift_JIS(CP932)として再デコードを試みる
// - 列順に依存せず、ヘッダー行の列名で解釈する
import Papa from "papaparse";
import type { ParseWarning, RawRow } from "@norishiro/types";

export function decodeBytes(bytes: Uint8Array, file: string, warnings: ParseWarning[]): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    warnings.push({
      code: "encoding_fallback",
      file,
      message: "UTF-8としてデコードできないため、Shift_JISとして再デコードした",
    });
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * CSVテキスト/バイト列をRaw層の行配列に変換する。
 * 空文字列・ヘッダーのみの入力は0行として正常に扱う（例外を投げない）。
 */
export function parseCsv(
  content: string | Uint8Array,
  file: string,
  warnings: ParseWarning[],
): RawRow[] {
  const text = stripBom(
    typeof content === "string" ? content : decodeBytes(content, file, warnings),
  );
  if (text.trim() === "") {
    return [];
  }

  const result = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => stripBom(h).trim(),
  });

  for (const err of result.errors) {
    warnings.push({
      code: "invalid_value",
      file,
      message: `CSV構文の逸脱を検出した: ${err.code} (${err.message})`,
      row: typeof err.row === "number" ? err.row + 1 : undefined,
    });
  }
  return result.data;
}
