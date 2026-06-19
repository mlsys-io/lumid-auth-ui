// Re-exports for the routed children of /dashboard/quant/competition/*.
//
// 2026-05-03: Browse + My strategies merged behind a Competitions
// shell (sub-tab strip). Pathways and per-competition detail pages
// stay as direct routes — they don't share the list-view tab strip.
import Competitions from '@/quantarena/pages/competition/competitions';
import CompetitionLobby from '@/quantarena/pages/competition/competition-lobby';
import Pathways from '@/quantarena/pages/competition/pathways';
import MyStrategies from '@/quantarena/pages/competition/my-strategies';
import CompetitionDetail from '@/quantarena/pages/competition/detail/detail';
import CompetitionStrategyDetail from '@/quantarena/pages/competition/detail/common-strategy-detail';

export function QuantCompetitions() {
	return <Competitions />;
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
