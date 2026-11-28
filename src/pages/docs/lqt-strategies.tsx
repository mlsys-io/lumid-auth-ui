import { useEffect, useState } from 'react';
import { APP_DOCS, appDocHref, fetchAppDoc } from '@/lib/app-docs';
import ReactMarkdown from 'react-markdown';
import 'github-markdown-css/github-markdown-light.css';

// /docs/lqt-strategies — AUTH REQUIRED (matches /docs/plugin-image-cd), since
// writing + submitting a strategy needs a signed-in lum.id account and a PAT.
//
// Renders the end-user "Write & Submit an LQT Strategy" guide. It lives in the
// Quant Research app (ui/guide/strategies.md, its Guide tab) since 2026-11-28;
// this route reads the app's published copy (src/lib/app-docs.ts).

export default function LqtStrategiesDoc() {
	const [markdown, setMarkdown] = useState<string>('');
	const [error, setError] = useState<string>('');

	useEffect(() => {
		fetchAppDoc(APP_DOCS['lqt-strategies'])
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
						moment.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-4xl mx-auto p-6">
			<div className="text-xs text-muted-foreground mb-4 flex items-center justify-between">
				<span>LQT · strategies · write &amp; submit</span>
				<a
					href={appDocHref(APP_DOCS['lqt-strategies'])}
					className="text-indigo-600 hover:underline"
				>
					Open in Quant Research →
				</a>
			</div>
			<article className="markdown-body" style={{ background: 'transparent' }}>
				<ReactMarkdown>{markdown}</ReactMarkdown>
			</article>
		</div>
	);
}
