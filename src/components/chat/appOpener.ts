// appOpener — derive the agent-led, progressive opener for an app: a compact
// LIVE-state summary (passed into the grounded turn so the agent's one-liner is
// real, no tool round-trip) + 2–3 deterministic next-step chips. Keeps the
// "open an app" experience conversational + hierarchical instead of dumping the
// whole surface.

import type { MeWorkflowRow } from '@/api/me';
import { appTitle } from '@/components/workflow/AppCard';
import { loopLabel } from '@/lib/workflow-names';

export interface AppState {
	failing?: string[];
	running?: string[];
	lastRunRel?: string;
	loopCount?: number;
}

function loopOf(w: MeWorkflowRow): string {
	const app = w.app || '';
	if (app && w.slug.startsWith(app + ':')) return w.slug.slice(app.length + 1);
	const i = w.slug.indexOf(':');
	return i >= 0 ? w.slug.slice(i + 1) : w.slug;
}

function rel(tsSec?: number): string {
	if (!tsSec) return '';
	const s = Date.now() / 1000 - tsSec;
	if (s < 60) return 'just now';
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

/** Compact live-state summary for the grounded opener turn. */
export function summarizeAppState(app: string, rows: MeWorkflowRow[]): AppState {
	const mine = rows.filter((w) => w.app === app);
	const failing = mine.filter((w) => w.enabled !== false && w.last_run_ok === false).map((w) => loopLabel(w.name, loopOf(w)));
	const running = mine.filter((w) => w.running).map((w) => loopLabel(w.name, loopOf(w)));
	const lastTs = mine.reduce((m, w) => Math.max(m, w.last_run_ts || 0), 0);
	return {
		failing: failing.length ? failing : undefined,
		running: running.length ? running : undefined,
		lastRunRel: lastTs ? rel(lastTs) : undefined,
		loopCount: mine.length,
	};
}

export interface OpenerChip { label: string; prompt: string; context?: { app: string; loop?: string } }

/** Top-level drill-down chips (cap 3). Deeper levels come from the agent's
 *  per-answer follow-ups (progressive disclosure). */
export function chipsForApp(app: string, rows: MeWorkflowRow[]): OpenerChip[] {
	const mine = rows.filter((w) => w.app === app);
	const label = appTitle(app);
	const out: OpenerChip[] = [];
	const failing = mine.find((w) => w.enabled !== false && w.last_run_ok === false);
	if (failing) {
		const loop = loopOf(failing);
		out.push({ label: 'diagnose the failure', prompt: `Diagnose the most recent failed run of the ${loopLabel(failing.name, loop)} workflow and tell me the fix.`, context: { app, loop } });
	}
	if (mine.length > 0) {
		out.push({ label: 'run a workflow', prompt: `Which workflow should I run now, and why?`, context: { app } });
	}
	if (mine.some((w) => (w.memory_agents || []).length > 0)) {
		out.push({ label: 'what it learned', prompt: `What has ${label} learned recently?`, context: { app } });
	}
	if (out.length === 0) {
		out.push({ label: 'what can this do?', prompt: `What can ${label} do, and what should I do first?`, context: { app } });
	}
	return out.slice(0, 3);
}

/** A deterministic, INSTANT one-line opener from live state — no LLM round-trip
 *  and no fake user turn. The conversation goes LLM-driven the moment the user
 *  clicks a chip or types (progressive disclosure). */
export function openerLine(app: string, st: AppState): string {
	const label = appTitle(app);
	if (st.failing?.length) {
		return `⚠ **${label}** — ${st.failing.join(', ')} ${st.failing.length > 1 ? 'are' : 'is'} failing${st.lastRunRel ? ` (last run ${st.lastRunRel})` : ''}. Want me to diagnose it?`;
	}
	if (st.running?.length) {
		return `**${label}** — ${st.running.join(', ')} ${st.running.length > 1 ? 'are' : 'is'} running right now. I can walk you through it.`;
	}
	if (!st.loopCount) {
		return `Here's **${label}**. What would you like to do?`;
	}
	return `**${label}** looks healthy — ${st.loopCount} workflow${st.loopCount === 1 ? '' : 's'}${st.lastRunRel ? `, last run ${st.lastRunRel}` : ''}. What next?`;
}
