# syntax=docker/dockerfile:1
# apps/mcp のCloud Run用イメージ（docs/14 7章）。
# ビルドコンテキストはリポジトリルート（norishiro/）を指定すること:
#   docker build -f apps/mcp/Dockerfile -t norishiro-mcp .

# --- ビルドステージ: モノレポからesbuildで単一ファイルへバンドル ---
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter "@norishiro/mcp..." \
  && pnpm --filter @norishiro/mcp run build

# --- 実行ステージ: バンドル済みJSのみ（node_modules不要、512MBインスタンス前提 docs/14 7.1節） ---
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/mcp/dist/index.cjs ./index.cjs
USER node
# PORTはCloud Runが注入する。NORISHIRO_ASSET_BASE_URL（シャード配信元）はデプロイ時に指定する
CMD ["node", "index.cjs"]
