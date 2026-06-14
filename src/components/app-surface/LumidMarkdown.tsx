// Renders an app surface's Markdown with Lumid directive widgets.
//
// Plain Markdown (GFM) renders normally; fenced blocks tagged
// `lumid:<type>` are intercepted in the `code` override and rendered as
// live widgets (see directives.tsx). Docs-page typography (a touch larger
// than the chat bubble renderer).

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Link } from "react-router-dom";
import { isLumidDirective, LumidDirective, SurfaceParams } from "./directives";

const components: Components = {
  h1: ({ children }) => <h1 className="text-2xl font-semibold mt-6 first:mt-0 mb-3 text-slate-900">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold mt-6 first:mt-0 mb-2 text-slate-900">{children}</h2>,
  h3: ({ children }) => <h3 className="text-[15px] font-semibold mt-4 first:mt-0 mb-1.5 text-slate-800">{children}</h3>,
  p: ({ children }) => <p className="leading-relaxed mb-3 text-[14px] text-slate-700">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 my-3 space-y-1 text-[14px] text-slate-700">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-3 space-y-1 text-[14px] text-slate-700">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => {
    const cls = "text-amber-700 underline decoration-amber-300 hover:decoration-amber-600 underline-offset-2";
    if (href && href.startsWith("/") && !href.startsWith("//")) {
      return <Link to={href} className={cls}>{children}</Link>;
    }
    return <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className={cls}>{children}</a>;
  },
  blockquote: ({ children }) => (
    <blockquote className="my-3 pl-3 border-l-2 border-amber-300 text-slate-600 text-[13px] italic">{children}</blockquote>
  ),
  hr: () => <hr className="my-5 border-slate-200" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200"><table className="min-w-full text-[13px] border-collapse">{children}</table></div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50 border-b border-slate-200">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-slate-100 last:border-b-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 text-left font-semibold text-slate-700">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 text-slate-700 align-top">{children}</td>,
  pre: ({ children }) => <>{children}</>, // `code` override owns block rendering
  code: ({ className, children, ...rest }) => {
    const text = String(children ?? "");
    if (isLumidDirective(className)) {
      return <LumidDirective className={className} raw={text.replace(/\n$/, "")} />;
    }
    const isBlock = /\n/.test(text) || (className && className.startsWith("language-"));
    if (isBlock) {
      return (
        <pre className="my-3 px-3 py-2.5 rounded-lg bg-slate-900 text-slate-100 text-[12px] leading-relaxed overflow-x-auto">
          <code className={className} {...rest}>{children}</code>
        </pre>
      );
    }
    return <code className="px-1.5 py-0.5 rounded text-[12px] font-mono bg-slate-100 text-slate-800 border border-slate-200/60">{children}</code>;
  },
};

export function LumidMarkdown({
  source,
  params,
  appConfig,
  wide,
}: {
  source: string;
  /** URL params (e.g. competitionId) injected into directive `{token}`s. */
  params?: Record<string, string>;
  /** The app's xpcloud `config:` map — defaults for native widget embeds. */
  appConfig?: Record<string, unknown>;
  /** App surfaces render wider than chat/docs to fit tables + charts. */
  wide?: boolean;
}) {
  // Interpolate route params (e.g. {symbol}, {competitionId}) into the raw
  // markdown — so they resolve in PROSE (headings, links) too, not just inside
  // directive bodies. Only keys present in params are replaced; per-row tokens
  // like {url}/{id} aren't params, so they're left intact for the directive's
  // own per-row interpolation.
  const rendered = params
    ? source.replace(/\{([\w.]+)\}/g, (m, k) => (k in params ? params[k] : m))
    : source;
  return (
    <SurfaceParams params={params ?? {}} appConfig={appConfig}>
      <div className={wide ? "lumid-md max-w-6xl" : "lumid-md max-w-3xl"}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{rendered}</ReactMarkdown>
      </div>
    </SurfaceParams>
  );
}

export default LumidMarkdown;
