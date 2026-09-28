import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import 'github-markdown-css/github-markdown-light.css';

// /docs/quant-quickstart — PUBLIC, no auth required (like /docs/xpio-autoresearch).
//
// The logged-out landing at `/` links here so a visitor can read what Quant
// Research asks of them before signing up. The raw /docs/quant-quickstart.md
// is public too, but nginx serves .md as application/octet-stream, so a
// browser downloads it instead of showing it. The same file is rendered for
// signed-in users at /studio/docs/quant-quickstart (studio/docs.tsx); this
// route adds no copy of its own.

export default function QuantQuickstartDoc() {
	const [markdown, setMarkdown] = useState<string>('');
	const [error, setError] = useState<string>('');

	useEffect(() => {
		document.title = 'Quant Research Quickstart · Lumid';
		fetch('/docs/quant-quickstart.md')
			.then((r) => {
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				return r.text();
			})
			.then(setMarkdown)
			.catch((e) => setError(String(e)));
	}, []);

	return (
		<div className="max-w-4xl mx-auto p-6">
			<div className="text-xs text-muted-foreground mb-4 flex items-center justify-between gap-4">
				<Link to="/" className="text-indigo-600 hover:underline">
					← Lumid
				</Link>
				<Link to="/auth/signup" className="text-indigo-600 hover:underline">
					Sign up to try it →
				</Link>
			</div>
			{error ? (
				<div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
					<div className="font-medium mb-1">Doc unavailable</div>
					<div className="text-xs">
						This documentation is temporarily unavailable. Please try again in a moment.
					</div>
				</div>
			) : (
				<article className="markdown-body" style={{ background: 'transparent' }}>
					<ReactMarkdown>{markdown}</ReactMarkdown>
				</article>
			)}
		</div>
	);
}
