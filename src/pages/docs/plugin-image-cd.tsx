import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import 'github-markdown-css/github-markdown-light.css';

// /docs/plugin-image-cd — AUTH-REQUIRED (internal infra runbook).
//
// Renders the plugin-baked image CD runbook (Lumilake + FlowMesh) fetched from
// /docs/plugin-image-cd.md. The MD asset lives at
// /proj/lumid_ui/public/docs/plugin-image-cd.md and is copied from the
// source-of-truth at
// /proj/deploy_infra/k8s-lift/PLUGIN-IMAGE-CD.md.
//
// Unlike /docs/xpio-autoresearch (public), this is internal operations
// documentation (GHCR repos, deploy topology, secret names) — the route is
// wrapped in <AuthGuard requireAuth> in App.tsx so it never renders to anon.

export default function PluginImageCdDoc() {
	const [markdown, setMarkdown] = useState<string>('');
	const [error, setError] = useState<string>('');

	useEffect(() => {
		fetch('/docs/plugin-image-cd.md')
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.text();
			})
			.then(setMarkdown)
			.catch((e) => setError(String(e)));
	}, []);

	if (error) {
		return (
			<div className="max-w-4xl mx-auto p-6">
				<div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
					<div className="font-medium mb-1">Doc unavailable</div>
					<div className="text-xs">
						This documentation is temporarily unavailable. Please try again in a
						moment. The source lives in the <code>deploy_infra</code> repo at{' '}
						<code>k8s-lift/PLUGIN-IMAGE-CD.md</code>.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-4xl mx-auto p-6">
			<div className="text-xs text-muted-foreground mb-4 flex items-center justify-between">
				<span>Lumid · CD · plugin-baked image release (internal)</span>
				<a
					href="/docs/plugin-image-cd.md"
					className="text-indigo-600 hover:underline"
					download
				>
					Download .md →
				</a>
			</div>
			<article className="markdown-body" style={{ background: 'transparent' }}>
				<ReactMarkdown>{markdown}</ReactMarkdown>
			</article>
		</div>
	);
}
