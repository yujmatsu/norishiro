// Phase A 動作確認ページ: シャード読み込み〜Worker内plan()のエンドツーエンド疎通を確認する。
// Phase BでS1（ホーム画面）に置き換える。
import { useEffect, useState, type ReactElement } from "react";
import type { Itinerary } from "@norishiro/router";
import { getRouterClient, type ShardInfo } from "../worker/client.js";

function todayYyyymmdd(): number {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function nowSec(): number {
  const now = new Date();
  return now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function DevCheckPage(): ReactElement {
  const [shard, setShard] = useState<ShardInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [itineraries, setItineraries] = useState<Itinerary[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    getRouterClient()
      .ready()
      .then(setShard)
      .catch((e: Error) => setError(e.message));
  }, []);

  const runTestSearch = async (): Promise<void> => {
    setSearching(true);
    setItineraries(null);
    setError(null);
    try {
      const serviceDate = todayYyyymmdd();
      const result = await getRouterClient().plan({
        origin: { kind: "stopId", stopId: "1" },
        destination: { kind: "stopId", stopId: "37" },
        departureTime: nowSec() + 3600, // 1時間後に出発
        serviceDate,
        searchTime: { serviceDate, nowSec: nowSec() },
      });
      setItineraries(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto", padding: 16 }}>
      <h1>ノリシロ</h1>
      <p>その町、クルマがなくても行けます</p>

      <section aria-label="開発用: 動作確認">
        <h2 style={{ fontSize: "1rem" }}>Phase A 動作確認（Phase Bでホーム画面に置き換え）</h2>
        <p>
          シャード:{" "}
          {shard
            ? `${shard.shardId}（${shard.calendarWindow.from} 〜 ${shard.calendarWindow.to}）読み込み済み`
            : error
              ? "読み込み失敗"
              : "読み込み中…"}
        </p>
        <button
          type="button"
          onClick={() => void runTestSearch()}
          disabled={!shard || searching}
          style={{ minHeight: 44, minWidth: 200, fontSize: "1rem" }}
        >
          {searching ? "検索中…" : "殿ケ谷会館 → みずほ病院 を検索（1時間後出発）"}
        </button>

        {error !== null && <p role="alert">エラー: {error}</p>}

        {itineraries !== null && itineraries.length === 0 && (
          <p>
            この条件では経路が見つかりませんでした（運行日・時間窓・予約締切をご確認ください）。
          </p>
        )}
        {itineraries !== null &&
          itineraries.map((itinerary, i) => (
            <div key={i} style={{ border: "1px solid #ccc", padding: 12, marginTop: 12 }}>
              <p>
                所要 {Math.round(itinerary.summary.durationSec / 60)}分 ／ 乗換{" "}
                {itinerary.summary.transferCount}回
                {itinerary.summary.requiresBooking && " ／ 🚐 要予約"}
              </p>
              <ul>
                {itinerary.legs.map((leg, j) => (
                  <li key={j}>
                    {leg.kind === "flex" &&
                      `🚐 デマンド交通 ${leg.fromStopId}→${leg.toStopId} ` +
                        `${formatTime(leg.departureTime)}発 ${formatTime(leg.arrivalTime)}着（目安）` +
                        (leg.booking.deadline !== undefined
                          ? ` 予約締切 ${formatTime(leg.booking.deadline)}`
                          : "")}
                    {leg.kind === "transit" &&
                      `🚌 ${leg.routeId} ${leg.fromStopId}→${leg.toStopId}`}
                    {leg.kind === "walk" && `🚶 徒歩 約${Math.round(leg.distanceMeters)}m`}
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </section>
    </main>
  );
}
