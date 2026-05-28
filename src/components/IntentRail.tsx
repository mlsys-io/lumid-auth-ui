// IntentRail — the "what you asked your AI to pursue" strip at the top
// of the Intents view. Each card is a standing intent in plain English
// with a live dot, the skills assembled into its workflow (T12 chips),
// progress bar, and latest outcome. Demo content is hardcoded by the
// parent (today.tsx) and passed in. Matches the LumidOS design spec
// (sentence-case section labels, weights 400/500).

import type { ReactNode } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface Intent {
	id: string;
	persona: string; // e.g. "common person · week 2"
	text: string; // the intent in plain English
	progress: number; // 0–100
	latest: string; // outcome chip text, rendered as "latest · <latest>"
	live?: boolean; // green live dot; defaults true
	chips?: string[]; // T12 — skills assembled into this intent's workflow
	href?: string; // if set, the card is a Link to this route (T13)
}

// Starter prompt fired by "+ New intent" — the chat agent picks up the
// studio:ask event, opens the sidebar, and auto-sends.
const NEW_INTENT_PROMPT =
	'I want to set up a new intent. Walk me through what you want your AI to handle and what "done" looks like — propose the goal in one sentence, pick the skills it needs, and confirm with me before installing.';

function openNewIntentChat() {
	window.dispatchEvent(new CustomEvent('studio:ask', {
		detail: { prompt: NEW_INTENT_PROMPT, autosend: true },
	}));
}

export function IntentRail({ intents }: { intents: Intent[] }) {
	const cols = intents.length >= 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2';
	return (
		<section>
			<div className="flex items-center justify-between gap-3 mb-2">
				<div className="text-[11px] tracking-[0.06em] text-slate-400">Active intents</div>
				<button
					onClick={openNewIntentChat}
					className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-800 hover:underline transition-colors"
					title="Compose a new intent with the chat agent"
				>
					<Plus className="w-3 h-3" /> New intent
				</button>
			</div>
			{intents.length === 0 ? (
				<button
					onClick={openNewIntentChat}
					className="w-full rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500 hover:border-emerald-200 hover:text-emerald-700 hover:bg-emerald-50/30 transition-all"
				>
					+ Set up your first intent — describe it to the chat on the right.
				</button>
			) : (
				<div className={`grid grid-cols-1 ${cols} gap-3`}>
					{intents.slice(0, 3).map((it) => (
						<IntentCard key={it.id} intent={it} />
					))}
				</div>
			)}
		</section>
	);
}

function IntentCard({ intent }: { intent: Intent }) {
	const pct = Math.max(0, Math.min(100, intent.progress));
	const live = intent.live ?? true;
	const clickable = !!intent.href;
	const cardClass = [
		'rounded-xl border border-slate-200/80 bg-white px-4 py-3.5 flex flex-col gap-2.5 transition-all',
		clickable ? 'cursor-pointer hover:border-emerald-200 hover:shadow-sm no-underline text-inherit block' : '',
	].join(' ');
	const Wrapper = clickable
		? (props: { children: ReactNode; className: string }) => (
			<Link to={intent.href!} className={props.className}>{props.children}</Link>
		)
		: (props: { children: ReactNode; className: string }) => (
			<div className={props.className}>{props.children}</div>
		);
	return (
		<Wrapper className={cardClass}>
			<div className="flex items-center justify-between gap-2">
				<div className="text-[11px] text-slate-400">{intent.persona}</div>
				{live && (
					<div className="flex items-center gap-1.5">
						<span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
						<span className="text-[11px] text-slate-400">live</span>
					</div>
				)}
			</div>
			<div className="text-sm font-medium text-slate-900 leading-snug">{intent.text}</div>
			{intent.chips && intent.chips.length > 0 && (
				<div className="flex items-center gap-1 flex-wrap text-[10px]">
					{intent.chips.map((c, i) => (
						<span key={c} className="inline-flex items-center gap-1">
							<span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-emerald-50/60 border border-emerald-100 text-emerald-800/90 font-medium">
								{c}
							</span>
							{i < intent.chips!.length - 1 && (
								<ChevronRight className="w-2.5 h-2.5 text-slate-300 flex-shrink-0" />
							)}
						</span>
					))}
				</div>
			)}
			<div className="mt-auto space-y-1.5">
				<div className="h-[3px] w-full rounded-full bg-slate-100 overflow-hidden">
					<div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
				</div>
				<div className="text-[11px] text-slate-400">latest · {intent.latest}</div>
			</div>
		</Wrapper>
	);
}

