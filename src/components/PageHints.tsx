// Phase S6d — per-workspace prompt hints.
//
// Each Studio page can mount <PageHints prompts={[...]} /> at the top
// of its content area. The hints render as a row of clickable chips;
// clicking one fires a `studio:ask` window event that StudioChat
// catches — it opens the sidebar (if collapsed), drops the prompt in,
// and auto-sends.
//
// This is the visible affordance for the "chat-first, forms-as-
// precision" stance: every workspace shows examples of what the user
// can ask, in their own language. The webforms remain in place as
// the precision channel.

import { Sparkles } from 'lucide-react';

interface Props {
	prompts: string[];
	/** Optional eyebrow text. Defaults to "Try asking:". */
	label?: string;
}

export function PageHints({ prompts, label }: Props) {
	if (!prompts || prompts.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
			<span className="text-slate-500 inline-flex items-center gap-1.5 mr-1">
				<Sparkles className="w-3.5 h-3.5 text-emerald-500" />
				{label || 'Try asking:'}
			</span>
			{prompts.map((p) => (
				<button
					key={p}
					onClick={() =>
						window.dispatchEvent(new CustomEvent('studio:ask', {
							detail: { prompt: p, autosend: true },
						}))
					}
					className="px-2.5 py-1 rounded-full border border-emerald-200 bg-emerald-50/50 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-300 transition-colors"
				>
					{p}
				</button>
			))}
		</div>
	);
}

export default PageHints;
