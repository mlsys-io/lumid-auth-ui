// Re-exports for the routed children of /dashboard/quant/competition/*.
//
// 2026-05-03: the inner CompetitionShell wrapper was deleted in
// favour of a single LQA shell (pages/dashboard/quant-layout.tsx).
// All routed pages here render directly inside that shell's Outlet,
// so this file is now just a leaf-component aggregator with no
// shell of its own.
import CompetitionLobby from '@/quantarena/pages/competition/competition-lobby';
import Pathways from '@/quantarena/pages/competition/pathways';
import MyStrategies from '@/quantarena/pages/competition/my-strategies';
import CompetitionDetail from '@/quantarena/pages/competition/detail/detail';
import CompetitionStrategyDetail from '@/quantarena/pages/competition/detail/common-strategy-detail';

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
