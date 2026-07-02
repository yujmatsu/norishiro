# ノリシロ

鉄道・バスの固定路線データとGTFS-Flex（デマンド交通）を統合し、「予約が必要な移動手段」を予約締切の逆算表示つきで案内する経路検索サービス。[公共交通オープンデータチャレンジ2026](https://challenge2026.odpt.org/)への応募作品です。

交通空白地域の高齢者・その家族・観光客が、乗換アプリに出てこないデマンド交通を発見できるようにすることを目的としています。

## 構成

pnpmモノレポ。詳細は `docs/11_アーキテクチャ設計.md` を参照。

| ディレクトリ | 責務 |
|---|---|
| `packages/types` | 共有型定義 |
| `packages/gtfs` | GTFS / GTFS-Flexパーサ |
| `packages/router` | RAPTOR＋Flex拡張の経路探索コア（ブラウザ・Node両対応） |
| `apps/web` | Webアプリ（Vite + React + MapLibre GL JS） |
| `apps/mcp` | MCPサーバー（Cloud Run） |
| `apps/pipeline` | データ取り込み・シャード生成（GitHub Actions） |

## 開発

Node.js 22 と pnpm（corepack経由）を使用します。

```bash
corepack enable
pnpm install
pnpm run typecheck   # 型チェック
pnpm run lint        # ESLint
pnpm run test        # vitest
```

## データ出典

- テストフィクスチャ: 瑞穂町「チョイソコみずほまち」GTFS-Flexデータ（[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.ja)）。詳細は `packages/gtfs/tests/fixtures/mizuho/README.md` を参照。

## ライセンス

ソースコードはMITライセンス（`LICENSE`参照）。データのライセンスは各出典元の条件に従います。
