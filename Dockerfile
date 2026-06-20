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
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi
COPY . .
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
