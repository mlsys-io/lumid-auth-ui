// /studio/workflows/:slug — kept as a redirect for back-compat. The
// canonical detail surface now lives inline on /studio/workflows as a
// right-side master-detail panel (see WorkflowDetailPanel). This keeps
// the list visible while drilling in, preserves the chat sidebar, and
// matches direct-link behaviour ("share me this workflow").

import { Navigate, useParams } from "react-router-dom";

export default function StudioWorkflowDetail() {
	const { slug = "" } = useParams<{ slug: string }>();
	return (
		<Navigate
			to={`/studio/workflows?selected=${encodeURIComponent(slug)}`}
			replace
		/>
	);
}
