// Renders chat bubble content as Markdown.
//
// Why a dedicated component (vs inline in StudioChat): we override the
// renderer for every element type to fit a chat-bubble context (tight
// spacing, scrollable tables, code blocks with proper backgrounds). The
// MessageBubble wrapper sets the user/assistant color and corner; this
// component only handles the inner formatting.
//
// GFM (GitHub-flavored markdown via remark-gfm) gives us tables,
// strikethrough, task lists, and autolinks — all useful when the agent
// is showing something the user wants to scan.
//
// Streaming-safe: react-markdown parses partial input gracefully (an
// unclosed `**` or a half-written table just renders as plain text
// until the closing marker arrives in a later chunk).

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { Link } from 'react-router-dom';

const components: Components = {
	// Headings — chat is conversational, so we deflate visual weight
	// vs a docs page. h1 stays prominent but smaller than block-text;
	// h2/h3 read as section labels inside the bubble.
	h1: ({ children }) => <h1 className="text-[15px] font-semibold mt-3 first:mt-0 mb-1 text-slate-900">{children}</h1>,
	h2: ({ children }) => <h2 className="text-[14px] font-semibold mt-2.5 first:mt-0 mb-1 text-slate-900">{children}</h2>,
	h3: ({ children }) => <h3 className="text-[13.5px] font-semibold mt-2 first:mt-0 mb-0.5 text-slate-800">{children}</h3>,
	h4: ({ children }) => <h4 className="text-[13px] font-semibold mt-2 first:mt-0 mb-0.5 text-slate-700">{children}</h4>,

	p: ({ children }) => <p className="leading-relaxed mb-2 last:mb-0">{children}</p>,

	// Lists — tighter than the default browser margins; the bubble is narrow.
	ul: ({ children }) => <ul className="list-disc pl-5 my-2 first:mt-0 last:mb-0 space-y-1">{children}</ul>,
	ol: ({ children }) => <ol className="list-decimal pl-5 my-2 first:mt-0 last:mb-0 space-y-1">{children}</ol>,
	li: ({ children }) => <li className="leading-relaxed">{children}</li>,

	// Inline + block code. The `inline` prop check used to work in v8;
	// in v9 we read the `node` position instead — anything inside a
	// `pre` is block-level, everything else inline.
	code: ({ node, className, children, ...rest }) => {
		// react-markdown v9: parent is on `node.parent` only when the
		// component is rendered inside a tree walk; we infer block vs
		// inline by checking if the node has the typical `language-*`
		// className or if there's a newline in the content.
		const text = String(children).replace(/\n$/, '');
		const isBlock = /\n/.test(text) || (className && className.startsWith('language-'));
		if (isBlock) {
			return (
				<pre className="my-2 first:mt-0 last:mb-0 -mx-1 px-3 py-2.5 rounded-lg bg-slate-900 text-slate-100 text-[12px] leading-relaxed overflow-x-auto">
					<code className={className} {...rest}>{children}</code>
				</pre>
			);
		}
		// Inline code — subtle gray pill so it's distinct from surrounding text.
		return (
			<code className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-slate-100 text-slate-800 border border-slate-200/60">
				{children}
			</code>
		);
	},

	pre: ({ children }) => <>{children}</>, // Let the `code` block override above own the rendering.

	// Tables — GFM. Wrap in a scrollable container so wide tables
	// don't bust the bubble width.
	table: ({ children }) => (
		<div className="my-2 first:mt-0 last:mb-0 -mx-1 overflow-x-auto rounded-lg border border-slate-200">
			<table className="min-w-full text-[12px] border-collapse">{children}</table>
		</div>
	),
	thead: ({ children }) => <thead className="bg-slate-50 border-b border-slate-200">{children}</thead>,
	tbody: ({ children }) => <tbody>{children}</tbody>,
	tr: ({ children }) => <tr className="border-b border-slate-100 last:border-b-0">{children}</tr>,
	th: ({ children }) => <th className="px-2.5 py-1.5 text-left font-semibold text-slate-700">{children}</th>,
	td: ({ children }) => <td className="px-2.5 py-1.5 text-slate-700 align-top">{children}</td>,

	// Blockquote — subtle left-bar treatment, mirrors the agent's
	// "quoting back" voice.
	blockquote: ({ children }) => (
		<blockquote className="my-2 first:mt-0 last:mb-0 pl-3 border-l-2 border-emerald-300 text-slate-600 italic">
			{children}
		</blockquote>
	),

	// Links — emerald + underline-on-hover. INTERNAL links (/studio/…,
	// /dashboard/…) navigate in-app via react-router — the chat lives
	// alongside the workspace, so "open the run" should move the
	// workspace pane, not spawn a tab. External links keep new-tab.
	a: ({ href, children }) => {
		const h = String(href || "");
		const cls = "text-emerald-700 underline decoration-emerald-300 hover:decoration-emerald-600 underline-offset-2 break-words";
		if (h.startsWith("/studio") || h.startsWith("/dashboard")) {
			return <Link to={h} className={cls}>{children}</Link>;
		}
		return (
			<a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
				{children}
			</a>
		);
	},

	// Images — let them go full bubble-width but cap height so a tall
	// chart doesn't flood the panel.
	img: ({ src, alt }) => (
		<img
			src={src}
			alt={alt}
			loading="lazy"
			className="my-2 first:mt-0 last:mb-0 max-w-full max-h-80 rounded-lg border border-slate-200 object-contain bg-white"
		/>
	),

	// HR — visible separator inside a bubble.
	hr: () => <hr className="my-3 border-slate-200" />,

	// Emphasis colors that read on white (assistant) — user bubble
	// (dark background) inherits white text via the wrapper, so we
	// avoid setting an absolute color here.
	strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
	em: ({ children }) => <em className="italic">{children}</em>,
	del: ({ children }) => <del className="opacity-60">{children}</del>,
};

// The agent sometimes emits LaTeX math (e.g. "$\rightarrow$") but the chat
// renderer has no KaTeX, so it shows the raw source. Convert the common macros
// to Unicode. Safe around money: only "$word$" (a macro wrapper) is touched —
// "$0.0033" stays intact (a digit follows the $, not a letter-run + closing $).
const TEX: Record<string, string> = {
	rightarrow: "→", to: "→", longrightarrow: "→", Rightarrow: "⇒", implies: "⇒",
	leftarrow: "←", leftrightarrow: "↔", uparrow: "↑", downarrow: "↓", mapsto: "↦",
	Delta: "Δ", delta: "δ", times: "×", cdot: "·", approx: "≈", sim: "∼",
	geq: "≥", ge: "≥", leq: "≤", le: "≤", neq: "≠", ne: "≠", pm: "±",
	alpha: "α", beta: "β", gamma: "γ", sigma: "σ", mu: "μ", lambda: "λ",
};
function sanitizeMath(s: string): string {
	return s
		// $\macro$ or $macro$ (inline-math wrapping one macro) → Unicode
		.replace(/\$\s*\\?([a-zA-Z]+)\s*\$/g, (m, name) => TEX[name] ?? m)
		// bare \macro anywhere → Unicode (only known macros; \n \t etc. untouched)
		.replace(/\\([a-zA-Z]+)/g, (m, name) => TEX[name] ?? m)
		// stray \( \) \[ \] inline/display math delimiters → drop
		.replace(/\\[()[\]]/g, "");
}

interface Props {
	children: string;
	/** When true, applies the dark-bubble color overrides (used for the user message bubble). */
	dark?: boolean;
}

export function ChatMarkdown({ children, dark }: Props) {
	const clean = typeof children === "string" ? sanitizeMath(children) : children;
	return (
		<div className={[
			'chat-md',
			// The dark variant flips code/table backgrounds so they stay
			// legible on the user-bubble dark background.
			dark ? '[&_code]:bg-slate-800 [&_code]:text-slate-100 [&_code]:border-slate-700 [&_blockquote]:text-slate-200 [&_blockquote]:border-emerald-400 [&_a]:text-emerald-300 [&_a]:decoration-emerald-500/60 [&_hr]:border-slate-700 [&_table]:border-slate-700 [&_thead]:bg-slate-800 [&_thead]:border-slate-700 [&_tr]:border-slate-800 [&_th]:text-slate-200 [&_td]:text-slate-200' : '',
		].join(' ')}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
				{clean}
			</ReactMarkdown>
		</div>
	);
}

export default ChatMarkdown;
