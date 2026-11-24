import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Lumen surface scoping. html[data-surface="studio"] turns on the Studio-only
// layer in globals.css (Inter, the 0.625rem radius, brick destructive, the
// keyboard focus ring). index.html stamps it before first paint from the URL;
// this keeps it right as the SPA navigates between Studio and non-Studio
// trees (LQT, QuantArena, the ported admin pages). The /auth pages (login,
// register, reset) are the front door to Studio, so they wear it too.
//
// Keep STUDIO_PREFIX in step with the inline script in index.html.
export const STUDIO_PREFIX = /^\/(studio|code|claude-sessions|explore|auth)(\/|$)/;

export function isStudioPath(pathname: string): boolean {
	return STUDIO_PREFIX.test(pathname);
}

/** Mount once near the router root. */
export function useStudioSurface(): void {
	const { pathname } = useLocation();
	useEffect(() => {
		const el = document.documentElement;
		if (isStudioPath(pathname)) el.setAttribute("data-surface", "studio");
		else el.removeAttribute("data-surface");
	}, [pathname]);
}
