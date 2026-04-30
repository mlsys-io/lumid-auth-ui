import Competition from '@/quantarena/pages/competition/competition';
import CompetitionDetail from '@/quantarena/pages/competition/detail/detail';
import CompetitionStrategyDetail from '@/quantarena/pages/competition/detail/common-strategy-detail';

export function QuantCompetitionPage() {
	return <Competition />;
}

export function QuantCompetitionDetailPage() {
	return <CompetitionDetail />;
}

export function QuantCompetitionStrategyDetailPage() {
	return <CompetitionStrategyDetail />;
}
