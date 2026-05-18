import { ExternalLink } from 'lucide-react';

/**
 * Embedded marketplace — proxies the xp.io SPA inside an iframe so the
 * user stays in the lum.id shell while browsing community skills.
 *
 * Opens in a new tab for any action (install, detail, new loop) so the
 * user can multi-task without losing lum.id context.
 */
export default function MarketplacePage() {
  return (
    <div className="flex flex-col h-full" style={{ minHeight: 'calc(100vh - 120px)' }}>
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Skill Marketplace</h1>
          <p className="mt-1 text-sm text-slate-600">
            Community skills and apps from xp.io — install any skill into your loops.
          </p>
        </div>
        <a
          href="https://xp.io"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline"
        >
          Open xp.io <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </header>

      <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <iframe
          src="https://xp.io/skills"
          title="xp.io skill marketplace"
          className="w-full h-full"
          style={{ minHeight: 'calc(100vh - 200px)' }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation-by-user-activation"
        />
      </div>
    </div>
  );
}
