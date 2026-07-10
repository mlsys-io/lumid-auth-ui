FROM --platform=linux/amd64 node:22-alpine AS builder
WORKDIR /app
# Build args control where the SPA serves from. Defaults match the
# lum.id deploy (assets under /auth/, no router basename). The xp.io/go
# deploy overrides both to /go via lumid_ui_go/docker-compose.yml.
ARG BASE_PATH=/auth/
ARG VITE_ROUTER_BASE_PATH=
ENV BASE_PATH=$BASE_PATH
ENV VITE_ROUTER_BASE_PATH=$VITE_ROUTER_BASE_PATH
# Build provenance baked into the bundle (vite `define` reads these).
ARG GIT_SHA
ARG BUILD_TIME
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME
# Origin the bundle points its API clients at when served OFF lum.id (xp.io/go
# cross-origin, covered by lumid-identity's CORS allowlist) — on any *.lum.id
# host the bundle resolves the identity origin at RUNTIME instead
# (src/config/identity-origin.ts), so prod and nightly work from the SAME image
# (the nightly lane only re-tags the CI build and can't change build args).
# Written to .env.production.local, which Vite loads at HIGHER precedence than
# .env.production; with the default value the two are identical (prod unchanged).
ARG VITE_API_ORIGIN=https://lum.id
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi
COPY . .
RUN printf 'VITE_API_BASE_URL=%s\nVITE_ME_API_BASE=%s\n' "$VITE_API_ORIGIN" "$VITE_API_ORIGIN" > .env.production.local
RUN npm run build
# Precompress every static asset at MAX brotli (q11) + max gzip (-9), so nginx
# serves the precompressed file with zero per-request CPU. Brotli is ~20%
# smaller than gzip — the main lever for the cold first-load over the FRP tunnel.
RUN apk add --no-cache brotli && \
    find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \) \
      -exec sh -c 'gzip -9 -c "$1" > "$1.gz"; brotli -q 11 -c "$1" > "$1.br"' _ {} \;

# Brotli-enabled nginx (ngx_brotli built in) so brotli_static can serve the .br
# files; falls back to gzip_static, then on-the-fly. Same /usr/share/nginx/html
# + conf.d layout as the stock image.
FROM --platform=linux/amd64 fholzer/nginx-brotli:v1.26.2
ARG BASE_PATH=/auth/
ENV BASE_PATH=$BASE_PATH
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
