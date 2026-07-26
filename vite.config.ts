import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

// This app mounts under lum.id/auth/ so every asset needs the /auth/
// prefix when served by nginx. The BASE env var lets dev + CI run it
// at root without a rebuild.
export default defineConfig({
  base: process.env.BASE_PATH || "/auth/",
  // Build provenance baked into the bundle so the super-admin dashboard can
  // show what commit is actually running (code↔running-binary drift gap).
  // GIT_SHA is passed as a --build-arg by CD; falls back to 'dev' locally.
  define: {
    __BUILD_COMMIT__: JSON.stringify(process.env.GIT_SHA || "dev"),
    __BUILD_TIME__: JSON.stringify(process.env.BUILD_TIME || "dev"),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  plugins: [react()],
  build: {
    outDir: "dist",
    sourcemap: true,
    // Split heavy vendor deps out of the main app chunk so the initial load
    // fetches them in parallel + caches them across deploys (the app chunk
    // changes far more often than react/markdown/charts). Also clears the
    // >500kB single-chunk warning.
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Peel the HEAVY, route-specific LEAF libs out of the shared vendor
        // chunk so they load only with the lazy routes that use them — the
        // /studio/apps index pulls none of these, so its first paint no longer
        // drags the whole 2 MB monolith over the wire. We split only
        // self-contained leaves (no app imports, no cross-cycle with the React
        // core), which is what keeps this safe where a finer react/* split
        // previously caused init-order cycles. Everything else (react, router,
        // radix, tanstack, lucide, date-fns, axios) stays in `vendor`.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](@xyflow|reactflow)[\\/]/.test(id)) return "vendor-flow";
          if (/[\\/]node_modules[\\/](recharts|chart\.js|react-chartjs-2|d3-[^\\/]+|internmap|victory-[^\\/]+)[\\/]/.test(id)) return "vendor-charts";
          if (/[\\/]node_modules[\\/](@monaco-editor|monaco-editor)[\\/]/.test(id)) return "vendor-editor";
          if (/[\\/]node_modules[\\/]@emoji-mart[\\/]/.test(id)) return "vendor-emoji";
          if (/[\\/]node_modules[\\/](react-markdown|remark-[^\\/]+|rehype-[^\\/]+|micromark[^\\/]*|mdast-[^\\/]+|hast-[^\\/]+|hastscript|unist-[^\\/]+|unified|vfile[^\\/]*|property-information|github-markdown-css|katex)[\\/]/.test(id)) return "vendor-markdown";
          // @tanstack (react-query) is runmesh-only — peel it so Studio routes
          // don't carry it in the shared vendor chunk.
          if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return "vendor-tanstack";
          // framer-motion is used only by the chat transcript, which is itself
          // lazy-loaded. Left in the shared vendor chunk it added ~42 kB gzip to
          // EVERY page's initial load, including ones with no animation at all.
          if (/[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/.test(id)) return "vendor-motion";
          return "vendor";
        },
      },
    },
  },
  server: {
    port: 5174,
  },
});
