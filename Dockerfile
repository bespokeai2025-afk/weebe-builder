# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# WEBEE — production container
#
# Two-stage build:
#   1) builder  — installs all deps and runs `vite build`
#   2) runner   — slim image with only prod deps + built output
#
# VITE_* values are PUBLIC (same anon key the browser uses) and MUST be
# passed as --build-arg so they get baked into the client JS bundle.
# All server-only secrets (service role key, Retell key, etc.) are
# passed at RUNTIME only — never as build args.
#
# Build:
#   docker build \
#     --build-arg VITE_SUPABASE_URL=... \
#     --build-arg VITE_SUPABASE_PUBLISHABLE_KEY=... \
#     -t webee:latest .
#
# Run locally:
#   docker run --rm -p 8080:8080 --env-file .env.production webee:latest
# ---------------------------------------------------------------------------

FROM node:22-slim AS builder
WORKDIR /app

# Public build-time config — safe to bake into the client bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_PAYMENTS_CLIENT_TOKEN

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_PAYMENTS_CLIENT_TOKEN=$VITE_PAYMENTS_CLIENT_TOKEN

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Production deps only — no devDeps, no source code.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built SSR server + static client assets from the builder stage.
COPY --from=builder /app/dist ./dist

# App Runner / ECS inject PORT; default to 8080.
ENV PORT=8080
EXPOSE 8080

# start:aws binds 0.0.0.0 (required for containers — loopback is not enough).
CMD ["npm", "run", "start:aws"]
