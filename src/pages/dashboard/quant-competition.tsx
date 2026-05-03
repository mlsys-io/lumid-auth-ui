// Re-exports for the Competition shell + its routed children.
//
// 2026-05-03: replaced the old `Competition` Tabs wrapper with
// `CompetitionShell` (a 2-column sidebar layout) and split the prior
// Lobby + Pathways tabs into sibling routes under the shell. Forward
// Testing (cross-competition simulation roster, formerly inside
// Strategy) now lives at /dashboard/quant/competition/my.
import CompetitionShell from '@/quantarena/pages/competition/competition-shell';
import CompetitionLobby from '@/quantarena/pages/competition/competition-lobby';
import Pathways from '@/quantarena/pages/competition/pathways';
import MyStrategies from '@/quantarena/pages/competition/my-strategies';
import CompetitionDetail from '@/quantarena/pages/competition/detail/detail';
import CompetitionStrategyDetail from '@/quantarena/pages/competition/detail/common-strategy-detail';

export function QuantCompetitionShell() {
	return <CompetitionShell />;
}

export function QuantCompetitionLobby() {
	return <CompetitionLobby />;
}

export function QuantCompetitionMyStrategies() {
	return <MyStrategies />;
}

export function QuantCompetitionPathways() {
	return <Pathways />;
}

export function QuantCompetitionDetailPage() {
	return <CompetitionDetail />;
}

export function QuantCompetitionStrategyDetailPage() {
	return <CompetitionStrategyDetail />;
}
