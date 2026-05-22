import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";

// Router basename — env-driven so the same bundle can ship to lum.id
// (no prefix, default) AND xp.io/go/ (prefix=/go) without duplicating
// route declarations. Set at build time via
// VITE_ROUTER_BASE_PATH=/go (see /proj/infra/compose/lumid_ui_go/).
const ROUTER_BASE = (import.meta.env.VITE_ROUTER_BASE_PATH || "").replace(/\/$/, "");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={ROUTER_BASE || undefined}>
      <App />
      <Toaster richColors position="top-right" />
    </BrowserRouter>
  </StrictMode>
);
