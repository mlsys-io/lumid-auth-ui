import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

// Embeds a Grafana panel (or dashboard) from lum.id/grafana. Browser
// already holds the lm_session cookie, oauth2-proxy in front of
// Grafana federates against lumid_identity, so the iframe loads as
// the signed-in admin without a separate login.
//
// On load failure (Grafana down, oauth2-proxy 503) we show a fallback
// link instead of a broken iframe.

interface Props {
	/**
	 * Grafana dashboard UID + slug or full panel embed URL.
	 * Examples:
	 *   "/d/lumid-overview/lumid-overview"
	 *   "/d-solo/lumid-overview/lumid-overview?panelId=2"
	 */
	src: string;
	title: string;
	height?: number;
}

export function GrafanaEmbed({ src, title, height = 320 }: Props) {
	const [errored, setErrored] = useState(false);
	const fullSrc = src.startsWith('http')
		? src
		: `/grafana${src.startsWith('/') ? src : '/' + src}`;

	if (errored) {
		return (
			<div className="rounded border border-gold-300 bg-gold-50 p-4 text-sm text-gold-900">
				<div className="font-medium mb-1">{title} — embed unavailable</div>
				<div className="text-xs mb-2">
					Grafana not reachable. Click through to view in a new tab once it's
					back up.
				</div>
				<a
					href={fullSrc}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-gold-800 hover:underline"
				>
					Open Grafana <ExternalLink className="w-3 h-3" />
				</a>
			</div>
		);
	}

	return (
		<div className="rounded border border-gray-200 bg-white overflow-hidden">
			<div className="flex items-center justify-between px-3 py-1.5 border-b text-xs text-muted-foreground">
				<span className="font-medium text-gray-700">{title}</span>
				<a
					href={fullSrc}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-900"
				>
					Open <ExternalLink className="w-3 h-3" />
				</a>
			</div>
			<iframe
				src={fullSrc}
				title={title}
				style={{ width: '100%', height, border: 0 }}
				onError={() => setErrored(true)}
				sandbox="allow-same-origin allow-scripts allow-forms"
			/>
		</div>
	);
}
