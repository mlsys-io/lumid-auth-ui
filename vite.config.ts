import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { resolve } from "node:path";

// This app mounts under lum.id/auth/ so every asset needs the /auth/
// prefix when served by nginx. The BASE env var lets dev + CI run it
// at root without a rebuild.
export default defineConfig({
  base: process.env.BASE_PATH || "/auth/",
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
        // Single vendor chunk — separates node_modules (stable across deploys,
        // cached) from app code (changes often) WITHOUT cross-chunk cycles.
        // A finer split (react/markdown/charts) created circular chunks that
        // risk init-order runtime errors, so we keep it simple + safe.
        manualChunks(id: string) {
          return id.includes("node_modules") ? "vendor" : undefined;
        },
      },
    },
  },
  server: {
    port: 5174,
  },
});
