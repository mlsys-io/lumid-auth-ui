import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import 'github-markdown-css/github-markdown-light.css';

// /docs/xpio-autoresearch — public, no auth required.
//
// Renders the canonical xpio autoresearch loop reference fetched from
// /docs/xpio_autoresearch_canonical.md. The MD asset lives at
// /proj/lumid_ui/public/docs/xpio_autoresearch_canonical.md and is
// copied from the source-of-truth at
// /proj/LumidOS/LumidOS/docs/architecture/xpio_autoresearch_canonical.md
// via a manual `cp` step (a `make docs-sync` target is the follow-up).
//
// THE MANUAL STEP DRIFTS — it did, for ~2 months. Re-synced 2026-08-21 after
// the mirror was found 82 lines behind, missing two whole sections the source
// had gained (`## Unified vocabulary (U1, the run axis)` and `## Optimization
// loop … observe → decide → steer`). Nothing enforces the copy, and nothing
// warned: this route kept serving a stale contract to anonymous forkers, who
// are exactly the readers least able to notice.
//
// Before editing this MD, diff it — and edit the SOURCE, never this copy:
//   diff public/docs/xpio_autoresearch_canonical.md \
//        /proj/LumidOS/LumidOS/docs/architecture/xpio_autoresearch_canonical.md
//   cp   /proj/LumidOS/LumidOS/docs/architecture/xpio_autoresearch_canonical.md \
//        public/docs/xpio_autoresearch_canonical.md
// The source is the strict superset by design; if that diff ever shows lines
// unique to THIS copy, someone edited the mirror and their edit is about to be
// lost — reconcile into the source first.
//
// Anyone browsing xp.io app repos before forking should land here; the
// xp_ui frontend has a footer link pointing at this route.

export default function XpioAutoresearchDoc() {
	const [markdown, setMarkdown] = useState<string>('');
	const [error, setError] = useState<string>('');

	useEffect(() => {
		fetch('/docs/xpio_autoresearch_canonical.md')
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
						moment. You can also read it on{' '}
						<a
							href="https://github.com/mlsys-io/LumidOS/blob/dev/docs/architecture/xpio_autoresearch_canonical.md"
							className="text-indigo-600 hover:underline"
							target="_blank"
							rel="noreferrer"
						>
							GitHub
						</a>.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="max-w-4xl mx-auto p-6">
			<div className="text-xs text-muted-foreground mb-4 flex items-center justify-between">
				<span>
					XP.io · architecture · canonical reference
				</span>
				<a
					href="/docs/xpio_autoresearch_canonical.md"
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
