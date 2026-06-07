# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Webespoke AI Script Flow Builder — production container for AWS
#
# Two-stage build:
#   1) builder  — installs all deps and runs `vite build`
#   2) runner   — slim image with only prod deps + built output
#
# IMPORTANT: the VITE_* values are baked into the client JS bundle at BUILD
# time. They are public (the same anon key the browser uses) and MUST be
# passed as --build-arg, not just at runtime. All server-only secrets
# (service role key, Retell key, etc.) are passed at RUNTIME only.
# ---------------------------------------------------------------------------

FROM node:22-slim AS builder
WORKDIR /app

# Build-time public config (safe to embed in the client bundle).
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_PAYMENTS_CLIENT_TOKEN
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_PAYMENTS_CLIENT_TOKEN=$VITE_PAYMENTS_CLIENT_TOKEN

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

# Only production dependencies in the final image.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Built SSR server + static client assets.
COPY --from=builder /app/dist ./dist

# srvx reads PORT; bind to all interfaces so a load balancer can reach it.
ENV PORT=8080
EXPOSE 8080

CMD ["npm", "run", "start:aws"]
