FROM --platform=linux/amd64 node:20-alpine AS builder
WORKDIR /app
# Build args control where the SPA serves from. Defaults match the
# lum.id deploy (assets under /auth/, no router basename). The xp.io/go
# deploy overrides both to /go via lumid_ui_go/docker-compose.yml.
ARG BASE_PATH=/auth/
ARG VITE_ROUTER_BASE_PATH=
ENV BASE_PATH=$BASE_PATH
ENV VITE_ROUTER_BASE_PATH=$VITE_ROUTER_BASE_PATH
COPY package*.json ./
RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps; else npm install --legacy-peer-deps; fi
COPY . .
RUN npm run build

FROM --platform=linux/amd64 nginx:alpine
ARG BASE_PATH=/auth/
ENV BASE_PATH=$BASE_PATH
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
