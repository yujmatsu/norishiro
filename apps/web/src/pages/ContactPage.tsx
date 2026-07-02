// S10: 問い合わせ先（docs/15 3.9節・2.3節）。応募規約「作品内に問い合わせ先を明記
// （データ提供者へ問い合わせが行かないように）」に対応する必須ページ。
// 正式な連絡手段（メールアドレス公開の可否）はdocs/17 U-08で確定させる。それまでGitHub Issuesを窓口とする。
import type { ReactElement } from "react";
import { useNavigate } from "react-router-dom";

export function ContactPage(): ReactElement {
  const navigate = useNavigate();
  return (
    <main className="app-main">
      <header className="screen-header">
        <button type="button" className="btn btn-back" onClick={() => void navigate(-1)}>
          ‹ 戻る
        </button>
        <h1 className="heading">お問い合わせ</h1>
      </header>

      <section>
        <h2>本サービスに関するお問い合わせ</h2>
        <p>不具合のご報告・ご意見・ご要望は、開発者まで以下の窓口からお寄せください。</p>
        <p>
          <a
            className="btn"
            href="https://github.com/yujmatsu/norishiro/issues"
            target="_blank"
            rel="noreferrer"
          >
            GitHub Issues で報告する
          </a>
        </p>
      </section>

      <section>
        <h2>大切なお願い</h2>
        <p>
          本サービスの内容・不具合について、データ提供元（瑞穂町などの自治体、交通事業者、公共交通オープンデータセンター、GTFSデータリポジトリ運営者）へお問い合わせいただくことは
          <strong>ご遠慮ください</strong>。お問い合わせは必ず上記の窓口までお願いします。
        </p>
        <p>
          デマンド交通の<strong>予約・運行に関するお問い合わせ</strong>
          は、各経路の予約案内に表示される運行事業者の電話番号へお願いします。
        </p>
      </section>
    </main>
  );
}
