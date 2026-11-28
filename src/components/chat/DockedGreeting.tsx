// DockedGreeting — what an empty docked chat shows before the first message
// (2026-11-28 sweep, #9: the rail opened blank). The words come from
// chatGreeting(); each example is a `studio:ask`, so a click pre-fills the
// composer and the person presses send — nothing is sent from here.

import { MessageSquare, Zap } from 'lucide-react';
import { chatGreeting } from '@/lib/chat-greeting';

export function DockedGreeting({ scope, title }: { scope: string; title: string }) {
	const g = chatGreeting(scope, title);
	const prefill = (prompt: string) => {
		window.dispatchEvent(new CustomEvent('studio:ask', { detail: { prompt } }));
		// Put the cursor where the next press is.
		requestAnimationFrame(() => (document.querySelector('textarea[aria-label="Message the assistant"]') as HTMLTextAreaElement | null)?.focus());
	};
	return (
		<div className="space-y-3" data-chat-greeting>
			<p className="text-body text-ink-700">{g.line}</p>
			<div className="space-y-1.5">
				<div className="eyebrow">Try asking</div>
				{g.examples.map((ex) => (
					<button
						key={ex}
						type="button"
						onClick={() => prefill(ex)}
						className="w-full flex items-start gap-2 text-left px-3 py-2 rounded-lg border border-border bg-card text-meta text-ink-700 hover:border-ink-300 hover:text-ink-900 transition-colors"
					>
						<MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0 text-ink-500" aria-hidden />
						<span>{ex}</span>
					</button>
				))}
			</div>
			{g.spendNote && (
				<p className="flex items-start gap-1.5 text-caption text-ink-600">
					<Zap className="w-3.5 h-3.5 mt-px shrink-0 text-ember-700" aria-hidden />
					<span>{g.spendNote}</span>
				</p>
			)}
		</div>
	);
}
