// S2（検索ウィザード）→S3（結果一覧）間の検索条件のURLクエリ表現。
// URLに全条件を持たせることで、リロード・共有（docs/15 1.2節シナリオA-1のLINE共有）に耐える。
import type { PlaceSelection, WhenSelection } from "./history.js";

export interface ResultQuery {
  from: PlaceSelection;
  to: PlaceSelection;
  when: WhenSelection;
}

function placeToParam(p: PlaceSelection): string {
  return p.kind === "stop" ? `stop:${p.stopId}` : `coord:${p.lat.toFixed(5)},${p.lon.toFixed(5)}`;
}

function labelOf(p: PlaceSelection): string {
  return p.kind === "stop" ? p.name : p.label;
}

function whenToParam(w: WhenSelection): string {
  if (w.type === "now") return "now";
  const h = String(Math.floor(w.timeSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((w.timeSec % 3600) / 60)).padStart(2, "0");
  return `${w.serviceDate}-${h}${m}`;
}

export function buildResultSearch(
  from: PlaceSelection,
  to: PlaceSelection,
  when: WhenSelection,
): string {
  const params = new URLSearchParams();
  params.set("from", placeToParam(from));
  params.set("fromLabel", labelOf(from));
  params.set("to", placeToParam(to));
  params.set("toLabel", labelOf(to));
  params.set("when", whenToParam(when));
  return `?${params.toString()}`;
}

function parsePlace(param: string | null, label: string | null): PlaceSelection | null {
  if (param === null) return null;
  if (param.startsWith("stop:")) {
    const stopId = param.slice("stop:".length);
    if (stopId === "") return null;
    return { kind: "stop", stopId, name: label ?? stopId };
  }
  if (param.startsWith("coord:")) {
    const m = /^coord:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(param);
    if (m === null) return null;
    return { kind: "coord", lat: Number(m[1]), lon: Number(m[2]), label: label ?? "指定地点" };
  }
  return null;
}

function parseWhen(param: string | null): WhenSelection | null {
  if (param === null) return null;
  if (param === "now") return { type: "now" };
  const m = /^(\d{8})-(\d{2})(\d{2})$/.exec(param);
  if (m === null) return null;
  return {
    type: "datetime",
    serviceDate: Number(m[1]),
    timeSec: Number(m[2]) * 3600 + Number(m[3]) * 60,
  };
}

/** 不正・欠損があればnull（S3側で「条件が不正」表示に落とす） */
export function parseResultQuery(params: URLSearchParams): ResultQuery | null {
  const from = parsePlace(params.get("from"), params.get("fromLabel"));
  const to = parsePlace(params.get("to"), params.get("toLabel"));
  const when = parseWhen(params.get("when"));
  if (from === null || to === null || when === null) return null;
  return { from, to, when };
}
