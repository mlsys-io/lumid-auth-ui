import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import 'github-markdown-css/github-markdown-light.css';

// /docs/claude — AUTH-REQUIRED (org-internal; using the pool needs an
// account + PAT anyway, matching /docs/lqt-strategies).
//
// Renders the Claude account-pool guide fetched from /docs/claude_pool.md.
// Companion to the live quota dashboard at /quota and the claude-proxy
// service (deploy_infra k8s-lift/claude-proxy).

export default function ClaudePoolDoc() {
	const [markdown, setMarkdown] = useState<string>('');
	const [error, setError] = useState<string>('');

	useEffect(() => {
		fetch('/docs/claude_pool.md')
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
						moment. The quota dashboard at <Link to="/quota" className="text-indigo-600 hover:underline">/quota</Link>{' '}
						carries a short version of the setup snippet.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-4xl mx-auto p-6">
			<div className="text-xs text-muted-foreground mb-4 flex items-center justify-between">
				<span>Lumid · Claude account pool · user guide</span>
				<span className="flex items-center gap-3">
					<Link to="/quota" className="text-indigo-600 hover:underline">
						Quota dashboard →
					</Link>
					<a
						href="/docs/claude_pool.md"
						className="text-indigo-600 hover:underline"
						download
					>
						Download .md →
					</a>
				</span>
			</div>
			<article className="markdown-body" style={{ background: 'transparent' }}>
				<ReactMarkdown>{markdown}</ReactMarkdown>
			</article>
		</div>
	);
}
