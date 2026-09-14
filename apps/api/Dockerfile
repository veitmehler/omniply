# syntax=docker/dockerfile:1
# ─── Stage 1: install + build ─────────────────────────────────────────────────
FROM node:20-alpine AS build

RUN npm install -g pnpm@9.15.4

WORKDIR /app

# Copy workspace root files — INCLUDING the lockfile (audit F5: the old
# build never copied it, so every image resolved dependencies fresh).
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY .npmrc ./

# Copy package manifests for ALL workspace packages — a frozen install
# validates the whole workspace against the lockfile's importers, so the
# web manifest must be present even though web source never enters this
# image (it deploys via Vercel).
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install all deps with flat node_modules (required for Docker COPY between stages).
# --frozen-lockfile (audit F5, 2026-09-11): the image must ship EXACTLY the
# dependency tree CI verified — the explicit flag overrides .npmrc's
# frozen-lockfile=false (kept there for local-dev convenience). If this step
# fails, the lockfile is out of sync with a package.json: run `pnpm install`
# locally and commit pnpm-lock.yaml.
RUN pnpm install --frozen-lockfile --shamefully-hoist

# Copy source files
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Generate the Prisma client first (shared imports @prisma/client, whose types
# only exist after generate), then build the shared package, then the API.
RUN cd apps/api && npx prisma generate && cd /app && pnpm --filter @omniply/shared build && cd apps/api && npx tsc

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

# postgresql18-client for pg_dump (DB backup handler) — must match the managed
# server major version (18.x); pg_dump refuses to dump a newer server. (B3)
# Article pipeline: Chromium + Mermaid CLI
RUN apk add --no-cache chromium nss freetype fontconfig harfbuzz ca-certificates ttf-freefont font-liberation postgresql18-client ffmpeg
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    CHROME_BIN=/usr/bin/chromium-browser

# Bundle Helvetica Neue (Thin/Light/Regular/Medium/Bold) for social compositors
# and register it with fontconfig so librsvg/sharp can resolve it.
COPY apps/api/fonts/ /usr/share/fonts/helvetica-neue/
RUN fc-cache -f

RUN npm install -g @mermaid-js/mermaid-cli

# GIT_SHA for Sentry release tagging
ARG GIT_SHA=unknown
ENV GIT_SHA=${GIT_SHA}

WORKDIR /app

# Copy compiled output and all node_modules from build stage
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api/puppeteer-config.json ./puppeteer-config.json
COPY --from=build /app/apps/api/mermaid-config.json ./mermaid-config.json
# Static social-compositor assets (carousel continuation-arrow glyphs)
COPY --from=build /app/apps/api/assets ./assets

# Non-root user for security
RUN addgroup -S socioply && adduser -S socioply -G socioply
USER socioply

EXPOSE 3001

CMD ["node", "dist/index.js"]
