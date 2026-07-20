/**
 * Public entry point for `lumid_ui/src/lqt/`.
 *
 * `App.tsx` and `Sidebar.tsx` import from `@/lqt`. Internal modules
 * inside this tree should import from each other directly (e.g.
 * `import { KindBadge } from '../components/KindBadge'`) to keep
 * the bundle graph clean.
 */

// Pages — registered as React Router routes in App.tsx.
export { TraderPage } from './pages/trader';
export { AuditorPage } from './pages/auditor';
export { ResearcherPage } from './pages/researcher';
export { OperatorPage } from './pages/operator';
export { SloPage } from './pages/slo';
export { AccountantPage } from './pages/accountant';
export { AdminPage } from './pages/admin';

// Shared components — exported for cross-app reuse (e.g. lum.id's
// existing super-admin tile might want to embed `ServiceStatusGrid`).
export { AuditRowTable } from './components/AuditRowTable';
export { KindBadge } from './components/KindBadge';
export { IcLineChart } from './components/IcLineChart';
export { ServiceStatusGrid } from './components/ServiceStatusGrid';
export { TreasuryLedgerTable } from './components/TreasuryLedgerTable';
export { KillSwitchIndicator } from './components/KillSwitchIndicator';
export { TenantSwitcher } from './components/TenantSwitcher';
export { HopsBreadcrumb } from './components/HopsBreadcrumb';

// Utilities — typed gateway client + SSE hook.
export {
  lqtAxios,
  getJson,
  postJson,
  LqtGatewayError,
  lqtGatewayBaseUrl,
  invalidateBearerCache,
} from './utils/axios';
export { useLqtSse } from './utils/sse';
export type { SseStatus, UseLqtSseOptions, UseLqtSseReturn } from './utils/sse';

// Shared types — gateway wire shapes mirrored from
// `services/lqt-api-gateway/src/handlers/*.rs`.
export type * from './types';
