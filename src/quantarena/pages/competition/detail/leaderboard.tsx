import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { CardContent } from '../../../components/ui/card';
import LeaderboardUser from './leaderboard-user';
import { useParams } from 'react-router-dom';
import EquityChart from '../../dashboard/equity-chart';

const Leaderboard = ({
	status,
	onRefreshMyStrategies,
}: {
	status?: 'Upcoming' | 'Ongoing' | 'Completed';
	onRefreshMyStrategies?: () => void;
}) => {
	const { competitionId } = useParams();
	return (
		<div className="p-4">
			<Card className="mb-4">
				<CardHeader>
					<CardTitle className="text-base font-semibold text-foreground">Competition Leaderboard</CardTitle>
					<CardDescription className="text-xs text-muted-foreground">
						Real-time Rankings, Updated Every 5 Minute
					</CardDescription>
				</CardHeader>
				<CardContent>
					<LeaderboardUser
						competitionId={Number(competitionId)}
						onRefreshMyStrategies={onRefreshMyStrategies || (() => {})}
						status={status}
					/>
				</CardContent>
			</Card>
			<EquityChart competitionId={Number(competitionId)} from="competition" status={status} />
		</div>
	);
};

export default Leaderboard;
