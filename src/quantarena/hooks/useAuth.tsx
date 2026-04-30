// In the lumid.market source tree this module owns its own AuthContext
// (cookie-less, localStorage-backed). In lumid_ui we have a single
// AuthProvider wrapping the dashboard tree (src/hooks/useAuth.tsx) —
// session-cookie based and already populated by the time any quant
// page mounts. Rather than nesting a second provider (which would
// duplicate the /api/v1/user round-trip and confuse logout), we
// delegate `useAuth` and `AuthProvider` to the host's hook. Ported QA
// pages (`ranking`, `strategy`, `competition`, …) keep their existing
// `import { useAuth } from '../../hooks/useAuth'` and everything just
// works.
export { useAuth, AuthProvider } from '../../hooks/useAuth';
