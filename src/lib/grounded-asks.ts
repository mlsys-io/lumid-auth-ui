// grounded-asks — the default conversational prompt for each entity type.
//
// Every Studio index row terminates in the chat. These builders produce the
// prompt + ViewingContext that gets fired (via IndexList.fireAsk) when a row
// is opened with the 'ask' landing preference — and the pre-filled text when
// 'type'. They mirror the page-aware samples in chat/ChatEmptyState so the
// index and the empty chat speak the same language.

import type { IndexAsk } from '@/components/studio/IndexList';
import { appTitle } from '@/components/workflow/AppCard';
import { loopLabel } from '@/lib/workflow-names';

export function askApp(app: string): IndexAsk {
	const name = appTitle(app);
	return {
		prompt: `How is ${name} doing — health, recent runs, and anything I should act on?`,
		context: { app },
		selection: { kind: 'app', id: app, label: name },
	};
}

export function askRun(run: { run_id: string; app?: string; loop?: string; name?: string; workflow_slug?: string }): IndexAsk {
	const loop = run.loop || (run.app && run.workflow_slug?.startsWith(run.app + ':')
		? run.workflow_slug.slice(run.app.length + 1)
		: run.workflow_slug);
	const label = loopLabel(run.name, loop || run.run_id);
	return {
		prompt: `Walk me through this ${label} run — what it did, what it learned, and anything that went wrong.`,
		context: { app: run.app, loop, run_id: run.run_id },
		selection: { kind: 'cycle', id: run.run_id, label },
	};
}

export function askSkill(repo: string, name: string): IndexAsk {
	return {
		prompt: `How is the ${name} skill doing — its health, which apps use it, and whether there's an update worth pulling?`,
		selection: { kind: 'skill', id: repo, label: name },
	};
}

export function askExperiment(app: string, id: string, label: string): IndexAsk {
	return {
		prompt: `Summarize the ${label} experiment in ${appTitle(app)} — is there a winning variant I should adopt?`,
		context: { app },
		selection: { kind: 'experiment', id, label },
	};
}

export function askMarketplaceItem(title: string, slug: string, kind?: string): IndexAsk {
	const what = kind === 'skill' ? 'skill' : kind === 'dataset' ? 'dataset' : 'agent';
	return {
		prompt: `What is the ${title} ${what} and would it help me, given my installed agents and how I use them? If it's a good fit, install it.`,
		selection: { kind: 'app', id: slug, label: title },
	};
}
