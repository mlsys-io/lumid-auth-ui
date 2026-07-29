// ArtifactView — shared renderer for a saved artifact's body, used by both the
// header popover (StudioChat) and the side canvas (StudioArtifactPanel) so rich
// output kinds render identically everywhere.
//
// Kinds: markdown | code | json | text | image | audio | chart | pdf
//   - chart: a JSON spec { type, data, xKey, series } rendered with recharts.
//     The catalog→query→plot loop (WS7) feeds data_query rows straight into `data`.
//   - pdf: previews inline via native <embed> (no react-pdf dependency).

import {
	ResponsiveContainer, LineChart, BarChart, AreaChart,
	Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { FileText, FileJson, Code2, Image as ImageIcon, AudioLines, BarChart3, FileType2 } from 'lucide-react';
import { ChatMarkdown } from './ChatMarkdown';

export type ArtifactKind =
	| 'markdown' | 'code' | 'json' | 'text' | 'image' | 'audio' | 'chart' | 'pdf';

export function ArtifactView({ kind, content, title, language }: {
	kind: ArtifactKind;
	content: string;
	title?: string;
	language?: string;
}) {
	switch (kind) {
		case 'markdown':
			return <ChatMarkdown>{content}</ChatMarkdown>;
		case 'code':
			return (
				<pre className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11.5px] overflow-x-auto">
					<code>{content}</code>
				</pre>
			);
		case 'json':
			return (
				<pre className="bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11.5px] overflow-x-auto">
					<code>{prettyJson(content)}</code>
				</pre>
			);
		case 'image':
			return (
				<a href={content} target="_blank" rel="noreferrer">
					<img src={content} alt={title || 'image'} className="max-w-full rounded-lg border border-slate-200" />
				</a>
			);
		case 'audio':
			return (
				<audio controls src={content} className="w-full">
					Your browser does not support audio playback.
				</audio>
			);
		case 'chart':
			return <ChartArtifact spec={content} />;
		case 'pdf':
			return (
				<embed src={content} type="application/pdf"
					className="w-full rounded-lg border border-slate-200" style={{ height: '70vh' }} />
			);
		default:
			return <div className="whitespace-pre-wrap break-words text-slate-700">{content}</div>;
	}
}

export function ArtifactKindIcon({ kind }: { kind: ArtifactKind }) {
	switch (kind) {
		case 'markdown': return <FileText className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />;
		case 'code':     return <Code2 className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />;
		case 'json':     return <FileJson className="w-3.5 h-3.5 text-gold-600 flex-shrink-0" />;
		case 'image':    return <ImageIcon className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />;
		case 'audio':    return <AudioLines className="w-3.5 h-3.5 text-violet-600 flex-shrink-0" />;
		case 'chart':    return <BarChart3 className="w-3.5 h-3.5 text-sky-600 flex-shrink-0" />;
		case 'pdf':      return <FileType2 className="w-3.5 h-3.5 text-rose-600 flex-shrink-0" />;
		default:         return <FileText className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />;
	}
}

// artifactDownload triggers a browser download for an artifact, round-tripping
// data: URLs (image/audio/pdf) verbatim so bytes aren't corrupted by a text blob.
export function artifactDownload(kind: ArtifactKind, content: string, title: string, id: string) {
	const safeTitle = title.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60) || id;
	const a = document.createElement('a');
	if ((kind === 'image' || kind === 'audio' || kind === 'pdf') && content.startsWith('data:')) {
		const mime = content.slice(5, content.indexOf(';'));
		const ext = mime.split('/')[1] || (kind === 'image' ? 'png' : kind === 'pdf' ? 'pdf' : 'mp3');
		a.href = content;
		a.download = `${safeTitle}.${ext}`;
		document.body.appendChild(a);
		a.click();
		setTimeout(() => document.body.removeChild(a), 100);
		return;
	}
	const ext = kind === 'markdown' ? 'md' : kind === 'json' || kind === 'chart' ? 'json' : kind === 'code' ? 'txt' : 'txt';
	const blob = new Blob([content], { type: 'text/plain' });
	a.href = URL.createObjectURL(blob);
	a.download = `${safeTitle}.${ext}`;
	document.body.appendChild(a);
	a.click();
	setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 100);
}

const CHART_COLORS = ['#2f6feb', '#e8912d', '#2fa36b', '#a05de8', '#e0518a', '#12a3b4'];

function ChartArtifact({ spec }: { spec: string }) {
	let parsed: {
		type?: string;
		data?: Array<Record<string, unknown>>;
		xKey?: string;
		series?: Array<{ key: string; color?: string; name?: string }>;
	};
	try {
		parsed = JSON.parse(spec);
	} catch {
		return <div className="text-rose-600 text-[11.5px]">Invalid chart spec (not JSON)</div>;
	}
	const data = Array.isArray(parsed.data) ? parsed.data : [];
	const xKey = parsed.xKey || 'name';
	const series: Array<{ key: string; color?: string; name?: string }> =
		(parsed.series && parsed.series.length)
			? parsed.series
			: Object.keys(data[0] || {}).filter((k) => k !== xKey).map((key) => ({ key }));
	if (!data.length || !series.length) {
		return <div className="text-slate-500 text-[11.5px]">No chart data</div>;
	}
	const kind = parsed.type || 'line';
	const color = (i: number, c?: string) => c || CHART_COLORS[i % CHART_COLORS.length];
	const common = (
		<>
			<CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
			<XAxis dataKey={xKey} tick={{ fontSize: 11 }} />
			<YAxis tick={{ fontSize: 11 }} />
			<Tooltip />
			<Legend wrapperStyle={{ fontSize: 11 }} />
		</>
	);
	return (
		<div className="w-full" style={{ height: 280 }}>
			<ResponsiveContainer width="100%" height="100%">
				{kind === 'bar' ? (
					<BarChart data={data}>
						{common}
						{series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name || s.key} fill={color(i, s.color)} />)}
					</BarChart>
				) : kind === 'area' ? (
					<AreaChart data={data}>
						{common}
						{series.map((s, i) => <Area key={s.key} dataKey={s.key} name={s.name || s.key} stroke={color(i, s.color)} fill={color(i, s.color)} fillOpacity={0.2} />)}
					</AreaChart>
				) : (
					<LineChart data={data}>
						{common}
						{series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name || s.key} stroke={color(i, s.color)} dot={false} />)}
					</LineChart>
				)}
			</ResponsiveContainer>
		</div>
	);
}

function prettyJson(s: string): string {
	try { return JSON.stringify(JSON.parse(s), null, 2); }
	catch { return s; }
}
