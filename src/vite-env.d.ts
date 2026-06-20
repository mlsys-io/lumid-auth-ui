/// <reference types="vite/client" />

// Build provenance, injected by vite `define` at build time (see vite.config.ts).
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
