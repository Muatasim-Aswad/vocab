# syntax=docker/dockerfile:1
# API image that also serves the built web app. Build from the repository root:
#   docker compose build api   (or: docker build -t vocab-api:local .)

# Same Node version as mise.toml; the digest pins the multi-arch index
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6

FROM ${NODE_IMAGE} AS build
# Toolchain for better-sqlite3 when no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# pnpm version comes from package.json `packageManager`
RUN corepack enable
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm_config_store_dir=/pnpm/store
WORKDIR /repo

# Manifests first, so the dependency layer is cached across source changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
COPY packages/contracts/package.json packages/contracts/
COPY packages/api-client/package.json packages/api-client/
RUN --mount=type=cache,id=vocab-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile

COPY . .
# The commit the web app reports; srvr passes them because the context has no .git
ARG APP_REVISION APP_COMMIT_TIME APP_BUILD_TIME
RUN --mount=type=cache,id=vocab-pnpm-store,target=/pnpm/store \
  pnpm exec vp run -r build \
  # Self-contained API: its `files` plus production dependencies only
  && pnpm --filter @vocab/api deploy --prod --legacy /out/api \
  && cp -r apps/web/dist /out/web

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
  VOCAB_BIND=0.0.0.0 \
  VOCAB_PORT=3000 \
  VOCAB_DATABASE_PATH=/data/vocab.db \
  VOCAB_WEB_ROOT=/app/web
WORKDIR /app
# Application files stay root-owned (read-only to the runtime user); /data is the only writable path
COPY --from=build /out/api ./
COPY --from=build /out/web ./web
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY apps/web/src/assets/fonts/OFL.txt ./third-party/source-sans-3/OFL.txt
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
# Loopback hosts are always allowed for the image health check.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/ready').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
STOPSIGNAL SIGTERM
CMD ["node", "dist/main.js"]
# Explicit tools in the image: `node dist/migrate.js` and `node dist/import-study-history.js`.
# No tool runs on API startup.
