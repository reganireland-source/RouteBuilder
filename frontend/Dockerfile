# ─────────────────────────────────────────────────────────────────────────────
# Frontend container image (multi-stage: node build → nginx static serve).
#
# DEPLOYMENT NOTE: the production frontend runs on Vercel, which builds from
# source and does NOT use this Dockerfile. It is kept for self-hosting and for
# `docker compose up` parity, and is still scanned by CI, so it is hardened.
#
# ON VITE_* VARIABLES (SonarQube docker:S6472 "secret in ARG/ENV"):
# Vite inlines every VITE_*-prefixed variable into the client JS bundle at build
# time, so these values are PUBLIC BY DESIGN — they ship to every browser that
# loads the app and cannot be secret whatever mechanism supplies them here.
# They are passed as build ARGs only, with no ENV, because:
#   - ARG values are already visible to RUN instructions as environment
#     variables, which made the previous `ENV VITE_...=$VITE_...` lines purely
#     redundant; and
#   - ENV values persist in the final image's metadata (readable with
#     `docker inspect`), whereas ARGs in a discarded build stage do not.
# VITE_APP_PASSWORD is a client-side access gate — obfuscation, not an
# authentication boundary (see SECURITY_REVIEW.md R1). Real authorization is
# server-side via ADMIN_KEY.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

# Copy only what the build needs. A recursive `COPY . .` (docker:S6470) can pull
# in .env files, local certificates or other secrets that happen to sit in the
# working tree; being explicit is the fix, .dockerignore is only a backstop.
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src

# Public build-time configuration — see the note above on ARG vs ENV.
ARG VITE_API_URL
ARG VITE_APP_PASSWORD
ARG VITE_ENABLE_NLP=false
ARG VITE_MAPS_PROVIDER=osm
ARG VITE_GMAPS_API_KEY
RUN npm run build

FROM nginx:alpine

# SPA fallback: send all unmatched paths back to index.html for client routing.
# Listens on 8080, not 80: ports below 1024 need CAP_NET_BIND_SERVICE, which
# would defeat running unprivileged. docker-compose maps host 80 → container
# 8080, so the URL you browse is unchanged.
RUN printf 'server {\n  listen 8080;\n  root /usr/share/nginx/html;\n  location / { try_files $uri $uri/ /index.html; }\n}\n' > /etc/nginx/conf.d/default.conf

COPY --from=build /app/dist /usr/share/nginx/html

# Run unprivileged (docker:S6471 — the nginx base image defaults to root). The
# stock image already ships an `nginx` user; it needs ownership of the pid file
# and the temp/cache directories nginx writes to at runtime.
RUN touch /var/run/nginx.pid \
    && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /usr/share/nginx/html /etc/nginx/conf.d
USER nginx

EXPOSE 8080
