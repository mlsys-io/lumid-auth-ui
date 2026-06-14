// AppSwitcher — the single app-identity control in the workspace header for an
// app page. Shows the current app (icon + name) and, on click, a menu of the
// user's installed apps to jump straight to another one's workspace. Replaces
// the old "‹ My Apps" breadcrumb + duplicate big header, so the app name is
// shown exactly once.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Check, LayoutGrid } from 'lucide-react';
import { useAppNav, iconFor } from '@/components/useAppNav';
import { appTitle } from '@/components/workflow/AppCard';

export default function AppSwitcher({ app }: { app: string }) {
	const navigate = useNavigate();
	const appNav = useAppNav();
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
		document.addEventListener('mousedown', onClick);
		return () => document.removeEventListener('mousedown', onClick);
	}, []);

	const items = appNav.flatMap((s) => s.items.map((it) => ({ ...it, section: s.section })));
	const current = items.find((it) => it.app === app);
	const CurIcon = iconFor(current?.icon);

	const pick = (a: string) => {
		setOpen(false);
		if (a !== app) navigate(`/studio/apps/${encodeURIComponent(a)}`);
	};

	return (
		<div ref={ref} className="relative">
			<button
				onClick={() => setOpen((v) => !v)}
				className="inline-flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-muted transition-colors max-w-[280px]"
				title="Switch app"
			>
				<span className="w-7 h-7 rounded-lg bg-gold-50 text-gold-600 flex items-center justify-center flex-shrink-0">
					<CurIcon className="w-4 h-4" />
				</span>
				<span className="font-semibold text-[15px] text-foreground truncate">{current?.label || appTitle(app)}</span>
				<ChevronDown className={['w-4 h-4 text-muted-foreground transition-transform shrink-0', open ? 'rotate-180' : ''].join(' ')} />
			</button>

			{open && (
				<div className="absolute left-0 top-full mt-1 z-40 w-64 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover shadow-lg py-1">
					{appNav.map((sec) => (
						<div key={sec.section}>
							<div className="px-3 pt-2 pb-0.5 text-[9.5px] uppercase tracking-wider text-muted-foreground">{sec.section}</div>
							{sec.items.map((it) => {
								const Icon = iconFor(it.icon);
								const active = it.app === app;
								return (
									<button key={it.app} onClick={() => pick(it.app)}
										className={['w-full flex items-center gap-2.5 px-3 py-1.5 text-[13px] text-left transition-colors', active ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted'].join(' ')}>
										<Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
										<span className="flex-1 min-w-0 truncate">{it.label}</span>
										{active && <Check className="w-3.5 h-3.5 shrink-0 text-gold-600" />}
									</button>
								);
							})}
						</div>
					))}
					<button onClick={() => { setOpen(false); navigate('/studio/apps/all'); }}
						className="w-full flex items-center gap-2.5 px-3 py-2 mt-1 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground border-t border-border/60 transition-colors">
						<LayoutGrid className="w-3.5 h-3.5 shrink-0" /> Manage all apps
					</button>
				</div>
			)}
		</div>
	);
}
