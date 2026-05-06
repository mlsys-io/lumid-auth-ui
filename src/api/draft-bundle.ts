/**
 * draft-bundle — generate one-shot CLI commands for the A4/A5 forms.
 *
 * Pattern matches the PAT precedent: the web UI's job is to produce
 * a copy-pasteable command; the CLI is what actually writes to the
 * user's local ~/.xp/apps/<app>/.drafts/ (skills) or
 * ~/.xp/kg/agents/<id>/.drafts/ (memory).
 *
 * Why no server-side draft endpoint: drafts live on the user's local
 * machine where the AI auto-loop, mbb-ai cycles, and CLI all read
 * them. Sync would mean cross-machine state replication for an
 * inherently local artifact. PATs were the right model to copy.
 */

export type SkillKind = 'prompt' | 'python' | 'skill_md';

export interface SkillDraftInput {
	app: string;
	role: string;
	skill_id: string;
	triggers: string[];
	prompt_body: string;
	target_loops: string[];
	kind: SkillKind;
	notes?: string;
	confidence?: number;
}

export interface MemoryDraftInput {
	app: string;
	role: string;
	content: string;
	type: string;
	tags: string[];
	notes?: string;
	confidence?: number;
}

const QUOTE_SAFE = /^[A-Za-z0-9_\-./@:+,%=]+$/;

/** Quote a value for inclusion in a bash one-liner. Round-trips
 *  through `'…'` with embedded single quotes escaped via `'\''`. */
function shq(v: string): string {
	if (v === '') return "''";
	if (QUOTE_SAFE.test(v)) return v;
	return "'" + v.replaceAll("'", "'\\''") + "'";
}

/** Serialize a list arg as comma-separated for `--triggers` /
 *  `--tags` / `--target-loops`. The CLI's parser splits these. */
function listArg(values: string[]): string {
	return shq(values.join(','));
}

/** Generate the `lumid skill_draft` one-liner. Writes to
 *  ~/.xp/apps/<app>/.drafts/<draft_id>/ when the user runs it.
 *  prompt_body is heredoc'd to preserve newlines and avoid any
 *  shell-escaping of markdown special characters. */
export function generateSkillDraftCommand(d: SkillDraftInput): string {
	const flags: string[] = [
		`--app ${shq(d.app)}`,
		`--role ${shq(d.role)}`,
		`--skill-id ${shq(d.skill_id)}`,
		`--kind ${shq(d.kind)}`,
	];
	if (d.triggers.length) flags.push(`--triggers ${listArg(d.triggers)}`);
	if (d.target_loops.length) flags.push(`--target-loops ${listArg(d.target_loops)}`);
	if (d.confidence !== undefined) flags.push(`--confidence ${d.confidence}`);
	if (d.notes) flags.push(`--notes ${shq(d.notes)}`);

	const head = `lumid skill_draft \\\n  ${flags.join(' \\\n  ')}`;

	if (!d.prompt_body) return head;

	// Heredoc carries the prompt body verbatim — the CLI reads
	// stdin into the draft's prompt file when --prompt-stdin is set.
	return (
		head +
		` \\\n  --prompt-stdin <<'LUMID_EOF'\n` +
		d.prompt_body +
		(d.prompt_body.endsWith('\n') ? '' : '\n') +
		`LUMID_EOF`
	);
}

/** Generate the `lumid memory_draft` one-liner. */
export function generateMemoryDraftCommand(d: MemoryDraftInput): string {
	const flags: string[] = [
		`--app ${shq(d.app)}`,
		`--role ${shq(d.role)}`,
		`--type ${shq(d.type)}`,
	];
	if (d.tags.length) flags.push(`--tags ${listArg(d.tags)}`);
	if (d.confidence !== undefined) flags.push(`--confidence ${d.confidence}`);
	if (d.notes) flags.push(`--notes ${shq(d.notes)}`);

	if (!d.content) {
		return `lumid memory_draft \\\n  ${flags.join(' \\\n  ')}`;
	}
	return (
		`lumid memory_draft \\\n  ${flags.join(' \\\n  ')} \\\n` +
		`  --content-stdin <<'LUMID_EOF'\n` +
		d.content +
		(d.content.endsWith('\n') ? '' : '\n') +
		`LUMID_EOF`
	);
}

/** Inbox helper — turn an app + optional agent into the CLI commands
 *  that list staged AI-loop drafts. Used by the inbox page since the
 *  web UI can't read the user's local ~/.xp directly. */
export function generateInboxCommands(opts: {
	app?: string;
	agent?: string;
}): { skillsCmd: string; memoryCmd: string } {
	const app = opts.app || '<APP>';
	const agent = opts.agent || '<AGENT>';
	return {
		skillsCmd: `lumid skill_drafts --app ${shq(app)}`,
		memoryCmd: `lumid memory_drafts --agent ${shq(agent)}`,
	};
}

/** Snake-case validator matching the A0 engine's expectation. */
export function isValidSkillId(s: string): boolean {
	return /^[a-z][a-z0-9_]{1,63}$/.test(s);
}

/** App-slug validator (a-z, 0-9, hyphen, no leading hyphen). */
export function isValidAppSlug(s: string): boolean {
	return /^[a-z][a-z0-9-]{1,63}$/.test(s);
}
