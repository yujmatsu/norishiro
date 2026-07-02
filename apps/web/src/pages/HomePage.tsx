// S1: ホーム画面（docs/15 3.1節）。迷わず「経路をさがす」に入れることが目的。
// 履歴から再検索（S6）・到達圏マップ（S7）・フッター3リンク（S8〜S10）・文字サイズ切替は
// Phase C/D/Eで追加する（docs/15 2.2節の画面一覧、log.mdのフェーズ計画参照）。
import type { ReactElement } from "react";
import { Link } from "react-router-dom";

export function HomePage(): ReactElement {
  return (
    <main className="app-main">
      <h1 className="app-title">ノリシロ</h1>
      <p className="app-tagline">その町、クルマがなくても行けます</p>
      <nav aria-label="メインメニュー">
        <Link to="/search" className="btn btn-primary">
          経路をさがす
        </Link>
      </nav>
    </main>
  );
}
