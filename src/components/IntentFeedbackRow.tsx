// IntentFeedbackRow — the 👍/✏️/👎 row that lives next to each
// intent-specific output (a drafted reply, a benchmarked variant, a
// resolved conflict). One row, three buttons; POSTs to /me/feedback
// which writes the improvement-ledger event (axis=examples, verb=
// good|edit|wrong).
//
// Common-user UX rules:
//   • Always one-click — no confirmation dialog
//   • Edit opens a tiny inline textarea inline so the user can quote
//     themselves; submit on Cmd+Enter or blur
//   • Tone after click → muted "thanks" pill, never a toast (toasts
//     break flow when the user is rapid-triaging)

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Pencil, Check, X } from 'lucide-react';

type FbState = 'idle' | 'sending' | 'good' | 'wrong' | 'edited' | 'editing';

export function IntentFeedbackRow({
	app,
	loop,
	cycleTs,
	outputId,
	dense = false,
}: {
	app: string;
	/** Optional — loop the output came from. */
	loop?: string;
	/** Optional — cycle timestamp dir (YYYYMMDDTHHMMSSZ). */
	cycleTs?: string;
	/** Optional — opaque identifier so the ledger can link back. */
	outputId?: string;
	/** Compact spacing for tight contexts (table rows etc). */
	dense?: boolean;
}) {
	const [state, setState] = useState<FbState>('idle');
	const [note, setNote] = useState('');

	const send = async (kind: 'good' | 'edit' | 'wrong', noteText?: string) => {
		setState('sending');
		try {
			const res = await fetch('/api/v1/me/feedback', {
				method: 'POST',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					app,
					loop,
					cycle_ts: cycleTs,
					output_id: outputId,
					kind,
					note: noteText,
				}),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			setState(kind === 'good' ? 'good' : kind === 'wrong' ? 'wrong' : 'edited');
		} catch {
			// Quietly fall back to idle — improvement ledger is best-effort
			// at the UI layer; failures shouldn't block the user.
			setState('idle');
		}
	};

	// ── Settled states ───────────────────────────────────────────
	if (state === 'good' || state === 'wrong' || state === 'edited') {
		const label =
			state === 'good'   ? 'thanks · learned' :
			state === 'wrong'  ? 'noted · adjusting' :
			                     'noted';
		const tone =
			state === 'good'  ? 'text-amber-700 bg-amber-50 border-amber-100' :
			state === 'wrong' ? 'text-rose-700    bg-rose-50    border-rose-100'    :
			                    'text-slate-600   bg-slate-50   border-slate-200';
		return (
			<span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] ${tone}`}>
				<Check className="w-3 h-3" />
				{label}
			</span>
		);
	}

	// ── Edit (note) state ────────────────────────────────────────
	if (state === 'editing') {
		return (
			<div className="flex items-center gap-1">
				<input
					value={note}
					onChange={(e) => setNote(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							send('edit', note);
						}
						if (e.key === 'Escape') {
							setState('idle');
							setNote('');
						}
					}}
					placeholder="What would you change?"
					className="px-2 py-1 text-[12px] rounded-md border border-slate-200 focus:border-amber-300 focus:ring-1 focus:ring-amber-200 outline-none w-[200px]"
					autoFocus
				/>
				<button
					onClick={() => send('edit', note)}
					className="p-1 rounded-md hover:bg-amber-50 text-amber-700"
					title="Save"
				>
					<Check className="w-3.5 h-3.5" />
				</button>
				<button
					onClick={() => { setState('idle'); setNote(''); }}
					className="p-1 rounded-md hover:bg-slate-100 text-slate-500"
					title="Cancel"
				>
					<X className="w-3.5 h-3.5" />
				</button>
			</div>
		);
	}

	// ── Idle / sending — the default three-button row ────────────
	const btn = dense
		? 'p-1 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-40'
		: 'p-1.5 rounded-md hover:bg-slate-100 text-slate-400 hover:text-slate-700 disabled:opacity-40';
	const sending = state === 'sending';
	return (
		<div className="inline-flex items-center gap-0.5">
			<button onClick={() => send('good')}        disabled={sending} className={btn} title="That worked — keep doing this">
				<ThumbsUp   className="w-3.5 h-3.5" />
			</button>
			<button onClick={() => setState('editing')} disabled={sending} className={btn} title="Edit / explain">
				<Pencil     className="w-3.5 h-3.5" />
			</button>
			<button onClick={() => send('wrong')}       disabled={sending} className={btn} title="Wrong — don't do this again">
				<ThumbsDown className="w-3.5 h-3.5" />
			</button>
		</div>
	);
}
