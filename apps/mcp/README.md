# @norishiro/mcp

ノリシロのMCPサーバー（[docs/14_MCPサーバーAPI仕様.md](../../docs/14_MCPサーバーAPI仕様.md)）。
`packages/router`をNode環境で実行し、経路検索・到達圏算出をMCPツールとして世界中のLLMエージェントへ公開する。LLM推論は一切行わない（推論コストは接続元のLLM契約側で発生する）。

## 提供ツール（6種、tools-only）

| ツール | 概要 |
|---|---|
| `plan_journey` | 固定路線＋GTFS-Flex統合の経路検索。Flexレッグには予約情報（電話番号・締切・案内文）を必ず含む |
| `search_stops` | 停留所の名称部分一致／座標＋半径検索（半径上限5000m、超過は切り詰め） |
| `list_flex_services` | 都道府県・市区町村単位のデマンド交通サービス一覧（運行曜日・時間窓・予約概要） |
| `get_booking_rules` | 予約方法の詳細。`spokenGuidance`はそのまま利用者に提示する完成済み案内文 |
| `get_isochrone` | 到達圏GeoJSON（cutoff最大5要素・各180分、応答2000座標点超は段階的簡略化） |
| `list_data_sources` | データ出典・ライセンス・クレジット一覧（`credits.json`） |

- トランスポート: Streamable HTTP（`POST /mcp`）、ステートレス運用
- 認証: なし（意図的な公開設計）。防御はレート制限60req/分/IP（固定ウィンドウ、超過はHTTP 429＋Retry-After）と入力ガード
- エラー: `INVALID_INPUT` / `DATA_NOT_AVAILABLE` / `SHARD_FETCH_FAILED` / `RATE_LIMITED` を`isError: true`のツール応答に統一

## 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `NORISHIRO_ASSET_BASE_URL` | ✅ | シャード・`credits.json`の配信元（Firebase Hosting等）。`{base}/shards/{shardId}.json`・`{base}/credits.json`を参照する |
| `PORT` | — | リッスンポート（既定8080。Cloud Runが注入） |

## 開発

```bash
pnpm --filter @norishiro/mcp run typecheck
pnpm --filter @norishiro/mcp run test    # T-MCP-01〜17（瑞穂町実データで検証）
pnpm --filter @norishiro/mcp run build   # esbuildで dist/index.cjs へバンドル
pnpm --filter @norishiro/mcp run start
```

ローカルで完全動作させるには、シャード配信元が必要。`apps/web`のdevサーバーが`public/`を配信するため、以下で足りる:

```bash
pnpm run dev &   # Vite (http://localhost:5173) が /shards/13-mizuho.json と /credits.json を配信
NORISHIRO_ASSET_BASE_URL=http://localhost:5173 pnpm --filter @norishiro/mcp run start
```

注意: 本リポジトリの標準開発環境（WSL上の`ODPT2026/norishiro`）では、親ディレクトリの環境マスク（docs/17 U-07）によりesbuildの祖先探索が失敗し`run build`がエラーになることがある。CI・Docker内では発生しない。

## デプロイ（Cloud Run）

- イメージ: `apps/mcp/Dockerfile`（ビルドコンテキストはリポジトリルート）
- CD: `.github/workflows/deploy-mcp.yml`（現状は手動トリガー。GCP初期設定完了後にpush連動化）
- Cloud Run設定のv1初期値: メモリ512Mi・1vCPU・min-instances=0・**max-instances=3（必須）**・concurrency=80・timeout=60s
- デプロイ後の疎通確認は`list_data_sources`（引数なし）で行う（専用ヘルスチェックはv1では持たない）

## クライアント接続例（Claude Desktop）

```json
{
  "mcpServers": {
    "norishiro-transit": {
      "url": "https://<cloud-run-service-url>/mcp",
      "transport": "http"
    }
  }
}
```
