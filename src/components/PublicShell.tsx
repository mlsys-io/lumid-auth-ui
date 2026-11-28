// PublicShell — minimal chrome for the public surfaces: the marketplace browse
// (/explore) + read-only repo pages (/explore/r/:o/:n) that replace the retired
// xp.io SPA. No app-nav and no /me fetch of its own, so it renders for
// anonymous visitors. It does read the auth context the app already holds:
// a signed-in visitor was offered "Sign in" next to "Added · Open"
// (2026-11-28 sweep, #13), so they get "Open Studio" instead.
import { useContext } from "react";
import { Link, Outlet } from "react-router-dom";
import { AuthContext } from "@/hooks/useAuth";

export default function PublicShell() {
	// Read defensively: the shell must still render outside an AuthProvider.
	const auth = useContext(AuthContext);
	const signedIn = !!auth?.user;
	const checking = !!auth?.isLoading;
	return (
		<div className="min-h-screen flex flex-col bg-background">
			<header className="flex items-center justify-between px-4 sm:px-8 h-12 border-b border-border shrink-0">
				<Link to="/" className="font-display text-read font-semibold text-foreground">Lumid</Link>
				<div className="flex items-center gap-3">
					<Link to="/explore" className="text-meta text-muted-foreground hover:text-foreground">Marketplace</Link>
					{checking ? null : signedIn ? (
						<Link to="/studio" className="text-meta px-3 py-1.5 rounded-lg bg-ink-900 text-white hover:bg-ink-700 transition-colors">Open Studio</Link>
					) : (
						<Link to="/auth/login?return_to=%2Fexplore" className="text-meta px-3 py-1.5 rounded-lg bg-gold-700 text-white hover:bg-gold-800 transition-colors">Sign in</Link>
					)}
				</div>
			</header>
			<main className="flex-1 min-h-0 overflow-y-auto">
				<Outlet />
			</main>
		</div>
	);
}
