// PublishToLibrary — modal to publish refined skills to your allowlist.
// Used by the Knowledge view's publish callout and by individual
// rejected decision items. Pick which skills + which contacts; publish
// POSTs (mock) and reports back. Sharing stays local for everyone off
// the allowlist (the privacy contract).

import { useState } from 'react';
import { toast } from 'sonner';
import { X, Check } from 'lucide-react';
import { publishToLibrary } from '@/lib/demo-actions';

interface SkillOption {
	id: string;
	label: string;
}

const DEFAULT_SKILLS: SkillOption[] = [
	{ id: 'family-voice', label: 'Family voice — casual register' },
	{ id: 'latency-first-sql', label: 'Latency-first NL-to-SQL config' },
	{ id: 'vendor-quote-guard', label: 'Vendor-quote guardrail' },
];

const ALLOWLIST_CONTACTS = ['partner (home)', 'lab team', 'care circle'];

export function PublishToLibrary({
	open,
	onClose,
	onPublished,
	skills = DEFAULT_SKILLS,
	title = 'Publish to your Library',
}: {
	open: boolean;
	onClose: () => void;
	onPublished?: (count: number) => void;
	skills?: SkillOption[];
	title?: string;
}) {
	const [checked, setChecked] = useState<Record<string, boolean>>(
		Object.fromEntries(skills.map((s) => [s.id, true])),
	);
	const [allow, setAllow] = useState<Record<string, boolean>>(
		Object.fromEntries(ALLOWLIST_CONTACTS.map((c) => [c, true])),
	);
	const [busy, setBusy] = useState(false);

	if (!open) return null;

	const selectedSkills = skills.filter((s) => checked[s.id]).map((s) => s.id);
	const selectedAllow = ALLOWLIST_CONTACTS.filter((c) => allow[c]);

	const publish = async () => {
		if (selectedSkills.length === 0) {
			toast.error('Select at least one skill to publish.');
			return;
		}
		setBusy(true);
		try {
			const r = await publishToLibrary(selectedSkills, selectedAllow);
			toast.success('Published. Your allowlist can fork these now.');
			onPublished?.(r.published);
		} catch {
			toast.error('Publish failed — try again.');
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
			onClick={onClose}
		>
			<div
				className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
					<div className="text-sm font-semibold text-slate-900">{title}</div>
					<button onClick={onClose} className="text-slate-400 hover:text-slate-700">
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="px-4 py-3 space-y-4">
					<div>
						<div className="text-[11px] uppercase tracking-[0.06em] text-slate-400 font-semibold mb-1.5">
							Skills to publish
						</div>
						<div className="space-y-1.5">
							{skills.map((s) => (
								<label key={s.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
									<input
										type="checkbox"
										checked={!!checked[s.id]}
										onChange={(e) => setChecked((m) => ({ ...m, [s.id]: e.target.checked }))}
										className="accent-gold-500"
									/>
									{s.label}
								</label>
							))}
						</div>
					</div>

					<div>
						<div className="text-[11px] uppercase tracking-[0.06em] text-slate-400 font-semibold mb-1.5">
							Share with (allowlist)
						</div>
						<div className="flex flex-wrap gap-1.5">
							{ALLOWLIST_CONTACTS.map((c) => {
								const on = allow[c];
								return (
									<button
										key={c}
										onClick={() => setAllow((m) => ({ ...m, [c]: !m[c] }))}
										className={[
											'inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors',
											on
												? 'bg-gold-50 border-gold-200 text-gold-700'
												: 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50',
										].join(' ')}
									>
										{on && <Check className="w-3 h-3" />} {c}
									</button>
								);
							})}
						</div>
						<div className="text-[11px] text-slate-400 mt-1.5">
							Stays local for everyone off this list · revoke anytime.
						</div>
					</div>
				</div>

				<div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100">
					<button
						onClick={onClose}
						className="px-3 py-1.5 text-sm rounded-lg border border-slate-200 hover:bg-slate-50"
					>
						Cancel
					</button>
					<button
						onClick={publish}
						disabled={busy}
						className="px-3.5 py-1.5 text-sm rounded-lg bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50"
					>
						{busy ? 'Publishing…' : 'Publish to allowlist'}
					</button>
				</div>
			</div>
		</div>
	);
}
