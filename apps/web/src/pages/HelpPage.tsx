// S8: 使い方（docs/15 3.8節）。初回利用者（高齢者本人・観光客）向けのオンボーディング。
// テキストとアイコン＋短文中心（動画は必須要件としない）。
// 音声入力・文字サイズ切替の案内は、それぞれの機能実装（I-8・Phase E）にあわせて追記する。
import type { ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";

export function HelpPage(): ReactElement {
  const navigate = useNavigate();
  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        <h1 className="heading">使い方</h1>
      </header>

      <section>
        <h2>経路をさがす（3ステップ）</h2>
        <ol>
          <li>
            「どこから」— 出発する場所を選びます。「現在地を使う」を押すと今いる場所になります。
          </li>
          <li>「どこへ」— 行きたい場所の名前を入力して、候補から選びます。</li>
          <li>「いつ」— 「今すぐ」を押すか、日時を指定します。</li>
        </ol>
        <p>結果の一覧から気になる経路を押すと、地図つきの詳しい案内が見られます。</p>
      </section>

      <section>
        <h2>「🚐 要予約」とは？</h2>
        <p>
          デマンド交通（予約して乗る乗り合いの交通）を使う経路には「🚐 要予約」の印がつきます。
          乗るには<strong>事前の予約が必要</strong>で、予約の締切時刻（例:
          乗車の30分前）を過ぎると利用できません。
        </p>
        <p>
          経路の詳しい案内にある「予約について見る」を押すと、電話番号・締切時刻・電話で伝える内容の例が表示されます。
          このアプリから予約が完了することはありません。必ず電話（または案内先サイト）でお申し込みください。
        </p>
      </section>

      <section>
        <h2>到達圏マップ</h2>
        <p>
          選んだ地点から、決まった時間内に公共交通で行ける範囲を地図に表示します。 「デマンド交通:
          あり/なし」を切り替えると、デマンド交通によって行動範囲がどれだけ広がるかを見比べられます。
        </p>
      </section>

      <section>
        <h2>プライバシーについて</h2>
        {/* docs/15 8章の計測方針の掲示（S8またはS9付近に平易な一文で明示する、と規定） */}
        <p>
          このアプリは、あなたの検索内容や現在地を外部に送信しません。検索履歴はお使いの端末の中にだけ保存されます。
        </p>
      </section>

      <p>
        <Link to="/search" className="btn btn-primary">
          経路をさがす
        </Link>
      </p>
    </main>
  );
}
