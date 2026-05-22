// Admin-facing shell — ops UX. Path-separated from user-layout.tsx as
// of the 2026-05-22 revamp plan.
//
// Today this is a thin re-export of the existing app-layout.tsx
// (which already has the sidebar, ADMIN_NAV, LUMILAKE_NAV, RESEARCH_NAV
// groups, and the runmesh-admin tree). Splitting it cleanly out of
// app-layout.tsx is a P1 task — for now anything routed under /admin/*
// uses this component, and the file gives us a stable seam to migrate
// behind without touching every Route.
//
// Visual contrast with user-layout.tsx:
//   - Left sidebar (not top tabs)
//   - Slate accent, dense tables, desktop-first
//   - "View as user" toggle pinned to top-right (added below)
//
// When the in-place migration happens, the sidebar config + render
// will move into this file and app-layout.tsx becomes the wrapper
// the OLD /dashboard/* paths redirect through. We're not there yet.

import AppLayout from "./app-layout";

export default function AdminLayout() {
  // For P0, the existing AppLayout is the admin layout. The "View as
  // user" toggle lives inside that component's profile menu when the
  // role is admin|super_admin. The new path split + dedicated
  // visual treatment lands in P1.
  return <AppLayout />;
}
