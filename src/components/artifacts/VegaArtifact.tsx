// VegaArtifact — renders a Vega-Lite spec with vega-embed.
//
// Why Vega-Lite alongside the recharts `chart` kind: the recharts spec
// ({type,xKey,data,series}) only expresses line/bar/area over one x axis, which
// is not enough for real financial exploration — no layering, faceting, binning,
// dual axis, heatmaps or scatter. Vega-Lite covers all of those AND is a public
// grammar the model already knows, so nothing has to be taught a bespoke schema.
//
// vega-embed also gives interaction for free: the hover actions menu exports
// PNG/SVG and reveals the source spec, and Vega-Lite `params`/`selection` bring
// tooltips, pan/zoom and brushing declaratively.
//
// Loaded ONLY through React.lazy from ArtifactView (the vega runtime is ~3.7 MB
// unpacked), so opening a non-vega artifact never pays for it. See the
// `vendor-vega` entry in vite.config.ts.

import { useEffect, useRef, useState } from 'react';

// Match the recharts palette in ArtifactView so the two chart kinds look like
// one design system rather than two libraries bolted together.
const CHART_COLORS = ['#2f6feb', '#e8912d', '#2fa36b', '#a05de8', '#e0518a', '#12a3b4'];

const VEGA_CONFIG = {
	background: 'transparent',
	font: 'inherit',
	axis: {
		labelColor: '#475569', titleColor: '#334155',
		labelFontSize: 11, titleFontSize: 11, titleFontWeight: 500 as const,
		gridColor: '#e5e7eb', domainColor: '#cbd5e1', tickColor: '#cbd5e1',
	},
	legend: {
		labelColor: '#475569', titleColor: '#334155',
		labelFontSize: 11, titleFontSize: 11, titleFontWeight: 500 as const,
	},
	title: { color: '#1e293b', fontSize: 12.5, fontWeight: 600 as const, anchor: 'start' as const },
	view: { stroke: 'transparent' },
	range: { category: CHART_COLORS },
	line: { strokeWidth: 2 },
	point: { filled: true, size: 42 },
	bar: { cornerRadiusEnd: 2 },
};

// `width: "container"` is only valid on a single-view spec — a faceted or
// concatenated spec must size its own sub-views, and forcing it there makes
// vega-lite throw rather than degrade.
const MULTIVIEW_KEYS = ['facet', 'concat', 'hconcat', 'vconcat', 'repeat'];

export default function VegaArtifact({ spec }: { spec: string }) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [error, setError] = useState('');

	useEffect(() => {
		let cancelled = false;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let view: any;

		(async () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			let parsed: any;
			try {
				parsed = JSON.parse(spec);
			} catch {
				setError('Invalid Vega-Lite spec — not JSON.');
				return;
			}
			if (!parsed || typeof parsed !== 'object') {
				setError('Invalid Vega-Lite spec — expected a JSON object.');
				return;
			}

			// Fill in the boilerplate the model is allowed to omit.
			if (!parsed.$schema) parsed.$schema = 'https://vega.github.io/schema/vega-lite/v6.json';
			const isMultiView = MULTIVIEW_KEYS.some((k) => k in parsed);
			if (!isMultiView) {
				if (parsed.width === undefined) parsed.width = 'container';
				if (parsed.height === undefined) parsed.height = 280;
				if (parsed.autosize === undefined) parsed.autosize = { type: 'fit-x', contains: 'padding' };
			}

			try {
				const embed = (await import('vega-embed')).default;
				if (cancelled || !hostRef.current) return;
				const result = await embed(hostRef.current, parsed, {
					// The actions menu IS the interaction affordance — keep export +
					// source, drop the editor link (it would post data to an external site).
					actions: { export: true, source: true, compiled: false, editor: false },
					renderer: 'canvas',
					config: VEGA_CONFIG,
					tooltip: { theme: 'light' },
				});
				if (cancelled) { result.view?.finalize(); return; }
				view = result.view;
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			}
		})();

		return () => {
			cancelled = true;
			try { view?.finalize(); } catch { /* view already torn down */ }
		};
	}, [spec]);

	if (error) {
		return (
			<div className="text-rose-600 text-[11.5px] whitespace-pre-wrap break-words">
				{error}
			</div>
		);
	}
	return <div ref={hostRef} className="w-full vega-artifact" />;
}
