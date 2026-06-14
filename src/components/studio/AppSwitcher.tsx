// AppSwitcher — the app-identity label in the workspace header. Shows the
// current app (icon + name) once. It no longer carries a dropdown list of
// installed apps: that nav list duplicated the left sidebar (which already
// lists every app and switches on click), so it was redundant.

import { useAppNav, iconFor } from '@/components/useAppNav';
import { appTitle } from '@/components/workflow/AppCard';

export default function AppSwitcher({ app }: { app: string }) {
	const appNav = useAppNav();
	const items = appNav.flatMap((s) => s.items.map((it) => ({ ...it, section: s.section })));
	const current = items.find((it) => it.app === app);
	const CurIcon = iconFor(current?.icon);

	return (
		<div className="inline-flex items-center gap-2 px-2 py-1.5 max-w-[280px]">
			<span className="w-7 h-7 rounded-lg bg-gold-50 text-gold-600 flex items-center justify-center flex-shrink-0">
				<CurIcon className="w-4 h-4" />
			</span>
			<span className="font-semibold text-[15px] text-foreground truncate">{current?.label || appTitle(app)}</span>
		</div>
	);
}
