// vite.live.config.ts — the LOCAL source rendered against LIVE data.
//
//   VITE_API_BASE_URL=http://localhost:5200 VITE_ME_API_BASE=http://localhost:5200 BASE_PATH=/ \
//     npx vite --config vite.live.config.ts --port 5200
//   LUMID_PAT=... node e2e/studio-visual.mjs --base http://localhost:5200
//
// Every API path the SPA calls is proxied to LIVE_TARGET (default lum.id), so
// a visual change can be checked pixel-by-pixel on real data BEFORE it ships
// to nightly. Auth rides along: Playwright's extraHTTPHeaders put the PAT on
// every request to localhost and the proxy forwards it. Dev-only; not a build
// input. Read-only browsing: the harness never clicks into threads (that
// re-saves them).
import { defineConfig, mergeConfig } from "vite";
import base from "./vite.config";

const target = process.env.LIVE_TARGET || "https://lum.id";
const to = { target, changeOrigin: true, secure: true };

export default mergeConfig(
  base,
  defineConfig({
    server: {
      proxy: {
        "/api": to,
        "/inbox-api": to,
        "/oauth": to,
        "/.well-known": to,
        "/findata-cloud": to,
        "/dataapp-proxy": to,
        "/market": to,
        "/docs": to,
        // Static brand assets the code references by their prod path.
        "^/auth/.*\\.(png|svg|ico|md)$": to,
      },
    },
  }),
);
