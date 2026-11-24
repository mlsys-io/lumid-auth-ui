// AppSwitcher — the app-identity label in the workspace header. Shows the
// current app (icon + name) once. It no longer carries a dropdown list of
// installed apps: that nav list duplicated the left sidebar (which already
// lists every app and switches on click), so it was redundant.

import { useAppNav } from '@/components/useAppNav';
import { StrandAvatar } from '@/components/illustrations/StrandAvatar';
import { appTitle } from '@/components/workflow/AppCard';

export default function AppSwitcher({ app }: { app: string }) {
	const appNav = useAppNav();
	const items = appNav.flatMap((s) => s.items.map((it) => ({ ...it, section: s.section })));
	const current = items.find((it) => it.app === app);

	return (
		<div className="inline-flex min-w-0 items-center gap-2 px-2 py-1.5 max-w-[280px]">
			{/* Lumen: the app's StrandAvatar — the same glyph it wears in the rail,
			    its Recent threads and its Library card. */}
			<StrandAvatar slug={app} size={28} />
			<span className="font-semibold text-body text-ink-900 truncate">{current?.label || appTitle(app)}</span>
		</div>
	);
}
