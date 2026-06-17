// PublicShell — minimal chrome for anonymous (logged-out) surfaces: the public
// marketplace browse (/explore) + read-only repo pages (/explore/r/:o/:n) that
// replace the retired xp.io SPA. Deliberately tiny: no /me fetch, no app-nav,
// no auth store — so it renders for anonymous visitors. Signed-in users get the
// full /studio shell instead.
import { Link, Outlet } from "react-router-dom";

export default function PublicShell() {
	return (
		<div className="min-h-screen flex flex-col bg-background">
			<header className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
				<Link to="/" className="font-display text-[15px] font-semibold text-foreground">Lumid</Link>
				<div className="flex items-center gap-2">
					<Link to="/explore" className="text-[13px] text-muted-foreground hover:text-foreground">Marketplace</Link>
					<Link to="/auth/login" className="text-[13px] px-3 py-1.5 rounded-lg bg-gold-500 text-white hover:bg-gold-600 transition-colors">Sign in</Link>
				</div>
			</header>
			<main className="flex-1 min-h-0 overflow-y-auto">
				<Outlet />
			</main>
		</div>
	);
}
