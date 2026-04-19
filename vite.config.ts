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
  },
  server: {
    port: 5174,
  },
});
