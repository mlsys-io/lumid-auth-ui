import Strategy from '@/quantarena/pages/strategy/strategy';

// Thin wrapper — the actual page is the QA Strategy component, ported
// verbatim. lumid_ui's AppLayout already wraps everything in
// AuthGuard; the QA component reads its data via the session-bearer-
// authed quantarena/api/client.ts.

export default function QuantStrategyPage() {
	return <Strategy />;
}
