// S9: データ出典・クレジット一覧（docs/15 3.9節）。フィードごとの提供元・ライセンス・取得元を明示する。
// 現在は瑞穂町フィードのみの静的記載。I-6（データパイプライン全国化）でfeeds.yaml→credits.jsonの
// 自動生成（docs/12のクレジット生成ステージ）に置き換える。
// このページを削除・非表示にしないこと（CLAUDE.md絶対制約3）。
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

export function CreditsPage(): ReactElement {
  const navigate = useNavigate();
  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        <h1 className="heading">データ出典・クレジット</h1>
      </header>

      <section>
        <h2>交通データ</h2>
        <ul>
          <li>
            <strong>瑞穂町「チョイソコみずほまち」GTFS-Flexデータ</strong>
            （東京都西多摩郡瑞穂町）
            <br />
            ライセンス:{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/deed.ja"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            <br />
            取得元:{" "}
            <a href="https://gtfs-data.jp/" target="_blank" rel="noreferrer">
              GTFSデータリポジトリ（gtfs-data.jp）
            </a>
          </li>
        </ul>
      </section>

      <section>
        <h2>地図</h2>
        <ul>
          <li>
            <strong>地理院タイル（淡色地図）</strong>（出典: 国土地理院）
            <br />
            <a
              href="https://maps.gsi.go.jp/development/ichiran.html"
              target="_blank"
              rel="noreferrer"
            >
              地理院タイル一覧
            </a>
          </li>
        </ul>
      </section>

      <section>
        <h2>データの取り扱い</h2>
        <p>
          本サービスは上記データを経路検索・案内表示の目的にのみ使用しています。対応地域のデータを追加した際は、このページに出典を追記します。
        </p>
        <p>このアプリは、あなたの検索内容や現在地を外部に送信しません。</p>
      </section>
    </main>
  );
}
