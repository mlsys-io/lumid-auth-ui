import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FlaskConical, LineChart, ShieldCheck } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';

// Logged-out landing at lum.id/ (GOALS.md §6.14, persona stage J1).
//
// Until 2026-09-28 a logged-out visit to `/` was 302'd straight to
// /auth/login — a bare "Welcome Back" form that never said what Lumid is, so
// a first-time visitor had nothing to decide on. Logged-in visitors never see
// this page: RoleHome still sends them to Studio before it renders.
//
// Styling deliberately mirrors the auth pages (same gradient, same Card) so
// Sign up / Sign in feel like the next step of this page, not another site.
// No external assets: the spiral is the one BrandLoader already ships.

const CAN_DO = [
	{
		icon: FlaskConical,
		title: 'Describe a strategy in plain words',
		body: 'The AI writes the code with you, and you can read and edit every line.',
	},
	{
		icon: LineChart,
		title: 'Backtest it on real market history',
		body: 'See whether it would have made money, and whether the data behind that answer was real.',
	},
	{
		icon: ShieldCheck,
		title: 'Paper-trade it live, then stop it',
		body: 'Watch it run against today’s markets with no real money, and keep improving it.',
	},
];

export default function Landing() {
	useEffect(() => {
		document.title = 'Lumid · Auto Research for anything';
	}, []);

	return (
		<div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 px-4 py-10">
			<main className="w-full max-w-3xl">
				<Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
					<CardContent className="p-6 sm:p-10 space-y-8">
						<header className="text-center space-y-4">
							<img
								src="/auth/spiral.png"
								alt=""
								aria-hidden="true"
								className="mx-auto h-12 w-auto select-none"
								draggable={false}
							/>
							<h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
								Lumid: Auto Research for X
							</h1>
							<p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
								Lumid gives one person the research compute, analytics and knowledge of a
								whole team. Pick a field, and Lumid runs the research for you on a
								schedule, learning from every run.
							</p>
						</header>

						<section
							aria-labelledby="landing-example"
							className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-4 sm:p-5"
						>
							<h2 id="landing-example" className="text-sm font-semibold text-indigo-900">
								Example: Quant Research
							</h2>
							<p className="mt-1 text-sm sm:text-base text-indigo-950/80">
								Write, backtest and paper-trade prediction-market strategies with an AI that
								writes them with you. Paper trading only: no real money is involved.
							</p>
						</section>

						<section aria-labelledby="landing-can-do">
							<h2 id="landing-can-do" className="sr-only">
								What you can do
							</h2>
							<ul className="grid gap-4 sm:grid-cols-3">
								{CAN_DO.map(({ icon: Icon, title, body }) => (
									<li key={title} className="flex gap-3 sm:flex-col sm:gap-2">
										<Icon className="h-5 w-5 shrink-0 text-indigo-600 mt-0.5" aria-hidden="true" />
										<div>
											<p className="font-medium leading-snug">{title}</p>
											<p className="text-sm text-muted-foreground">{body}</p>
										</div>
									</li>
								))}
							</ul>
						</section>

						<div className="space-y-3">
							<div className="flex flex-col sm:flex-row gap-3 sm:justify-center">
								<Button asChild className="h-12 sm:w-44">
									<Link to="/auth/signup">Sign up</Link>
								</Button>
								<Button asChild variant="outline" className="h-12 sm:w-44">
									<Link to="/auth/login">Sign in</Link>
								</Button>
							</div>
							<p className="text-center text-xs text-muted-foreground">
								Sign-up needs an invitation code.
							</p>
						</div>

						<p className="text-center text-sm">
							<Link
								to="/docs/quant-quickstart"
								className="inline-flex items-center gap-1.5 text-indigo-600 hover:underline"
							>
								<BookOpen className="h-4 w-4" aria-hidden="true" />
								Read the Quant Research Quickstart
							</Link>
							<span className="text-muted-foreground"> (15 minutes, no account needed to read)</span>
						</p>
					</CardContent>
				</Card>
			</main>
		</div>
	);
}
