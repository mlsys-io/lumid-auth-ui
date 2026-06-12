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
import type { ViewingContext } from '@/components/StudioContext';

interface Props {
	prompts: string[];
	/** Optional eyebrow text. Defaults to "Try asking:". */
	label?: string;
	/** Structured grounding forwarded with every chip (e.g. the page's
	 *  active filter window or app), merged over the derived context. */
	context?: Partial<ViewingContext>;
}

export function PageHints({ prompts, label, context }: Props) {
	if (!prompts || prompts.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-2 mb-5 text-xs">
			<span className="text-slate-500 inline-flex items-center gap-1.5 mr-0.5">
				<Sparkles className="w-3.5 h-3.5 text-emerald-500" />
				<span className="font-medium">{label || 'Try asking'}</span>
			</span>
			{prompts.map((p) => (
				<button
					key={p}
					onClick={() =>
						window.dispatchEvent(new CustomEvent('studio:ask', {
							detail: { prompt: p, autosend: true, context },
						}))
					}
					className="group px-3 py-1.5 rounded-full border border-emerald-200/70 bg-white hover:bg-gradient-to-r hover:from-emerald-50 hover:to-white text-emerald-800 hover:text-emerald-900 hover:border-emerald-300 hover:shadow-sm hover:shadow-emerald-100 transition-all active:scale-[0.98]"
				>
					<span className="opacity-60 group-hover:opacity-100 transition-opacity mr-0.5">›</span>
					{p}
				</button>
			))}
		</div>
	);
}

export default PageHints;
