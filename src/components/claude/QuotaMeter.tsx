// QuotaMeter — the caller's own Claude pool consumption, shown in the
// chatbox whenever a claude-code-* model is selected. Compact 5h pill;
// click for the 7d window + per-model 7d cost. Data: GET /api/v1/me/claude-usage
// (identity ≥ id-72e1ec7). Polls every 2 min + on stream completion
// (refreshKey bump from the parent).

import { useEffect, useRef, useState } from 'react';

type ModelUsage = { tokens_7d: number; cost_cents_7d: number };
type MeUsage = {
	five_hour_tokens: number;
	seven_day_tokens: number;
	five_hour_pct: number;
	seven_day_pct: number;
	five_hour_reset: string;
	seven_day_reset: string;
	cost_cents_7d: number;
	requests_7d: number;
	models: Record<string, ModelUsage>;
	cap_5h: number;
	cap_7d: number;
};

const REFRESH_MS = 2 * 60 * 1000;

function fmtTokens(n: number): string {
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
	if (n >= 1_000) return Math.round(n / 1_000) + 'k';
	return String(n);
}

function fmtReset(iso: string): string {
	const t = new Date(iso).getTime();
	if (!iso || isNaN(t)) return '';
	const s = Math.max(0, Math.round((t - Date.now()) / 1000));
	if (s <= 0) return 'now';
	const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
	return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function barColor(pct: number): string {
	if (pct >= 100) return 'bg-rose-500';
	if (pct >= 85) return 'bg-amber-500';
	return 'bg-emerald-500';
}

function Bar({ pct }: { pct: number }) {
	return (
		<span className="inline-block w-16 h-1.5 rounded-full bg-muted overflow-hidden align-middle">
			<span
				className={['block h-full rounded-full', barColor(pct)].join(' ')}
				style={{ width: Math.min(100, Math.max(2, pct)) + '%' }}
			/>
		</span>
	);
}

export function QuotaMeter({ refreshKey }: { refreshKey?: number }) {
	const [usage, setUsage] = useState<MeUsage | null>(null);
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const r = await fetch('/api/v1/me/claude-usage', { credentials: 'include' });
				if (!r.ok) return;
				const j = await r.json();
				if (!cancelled && j?.data) setUsage(j.data as MeUsage);
			} catch { /* ignore */ }
		};
		load();
		timer.current = setInterval(load, REFRESH_MS);
		return () => {
			cancelled = true;
			if (timer.current) clearInterval(timer.current);
		};
	}, [refreshKey]);

	if (!usage) return null;
	const pct5 = usage.five_hour_pct || 0;

	return (
		<div className="relative">
			<button
				onClick={() => setOpen(!open)}
				title="Your Claude pool quota (5-hour window) — click for details"
				className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full border border-border bg-popover hover:bg-muted/60 transition-colors"
			>
				<span className="text-muted-foreground">pool</span>
				<Bar pct={pct5} />
				<span className="tabular-nums text-muted-foreground">{Math.round(pct5)}%</span>
			</button>
			{open && (
				<div className="absolute right-0 top-7 z-30 w-64 p-3 rounded-lg border border-border bg-popover shadow-lg text-[11px] flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="font-medium">5-hour window</span>
						<span className="text-muted-foreground tabular-nums">
							{fmtTokens(usage.five_hour_tokens)} / {fmtTokens(usage.cap_5h)}
							{usage.five_hour_tokens > 0 && ` · resets ${fmtReset(usage.five_hour_reset)}`}
						</span>
					</div>
					<Bar pct={pct5} />
					<div className="flex items-center justify-between">
						<span className="font-medium">7-day window</span>
						<span className="text-muted-foreground tabular-nums">
							{fmtTokens(usage.seven_day_tokens)} / {fmtTokens(usage.cap_7d)}
							{usage.seven_day_tokens > 0 && ` · resets ${fmtReset(usage.seven_day_reset)}`}
						</span>
					</div>
					<Bar pct={usage.seven_day_pct || 0} />
					{Object.keys(usage.models).length > 0 && (
						<div className="pt-1 border-t border-border flex flex-col gap-0.5">
							{Object.entries(usage.models)
								.sort((a, b) => b[1].tokens_7d - a[1].tokens_7d)
								.slice(0, 6)
								.map(([m, u]) => (
									<div key={m} className="flex items-center justify-between text-muted-foreground">
										<span className="font-mono truncate max-w-[140px]">{m}</span>
										<span className="tabular-nums">
											{fmtTokens(u.tokens_7d)}
											{u.cost_cents_7d > 0 && ` · $${(u.cost_cents_7d / 100).toFixed(2)}`}
										</span>
									</div>
								))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
