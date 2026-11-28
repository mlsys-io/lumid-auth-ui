// StudioNotFound — the catch-all under /studio. An unknown Studio path used to
// fall through to the root "*" route, whose RoleHome redirected to /studio, so
// a mistyped or retired link silently showed the home chat ("Good afternoon")
// as if it were the page you asked for. Now it says there is no page here and
// offers the two places people usually meant.

import { Link, useLocation } from "react-router-dom";
import { EmptyState } from "@/components/ui/empty-state";
import { NotFound } from "@/components/illustrations/scenes";

export default function StudioNotFound() {
	const { pathname } = useLocation();
	return (
		<div className="pt-10" data-testid="studio-not-found">
			<EmptyState
				art={<NotFound />}
				title="No page here"
				body={
					<>
						Nothing in Studio lives at <span className="font-mono text-ink-800 break-all">{pathname}</span>.
						The link may be old or mistyped. Go to Studio home, or see{" "}
						<Link to="/studio/runs" className="font-medium text-gold-700 hover:text-gold-800">Activity</Link>{" "}
						for your runs.
					</>
				}
				actionLabel="Studio home"
				to="/studio"
			/>
		</div>
	);
}
