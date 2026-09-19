// doc.ts — the document, which is the source of truth.
//
// THE INVARIANT, enforced by a fixture test:
//
//     serialize(parse(text)) === text
//
// byte for byte, for any document nobody has edited. That one line kills the
// whole "the canvas reformatted my YAML / dropped my comments / reordered my
// keys" bug class — which is the thing that makes visual editors untrusted by
// exactly the people whose files matter most. xpio loops are hand-authored
// YAML living in git; regenerating one from a graph is not a lossy round-trip
// so much as vandalism of somebody's file.
//
// It is held by making the TEXT authoritative, not the AST. An unedited
// document hands back the exact bytes it was given, and undo restores an exact
// earlier string, because both are stored rather than re-emitted. This matters
// because `yaml`'s own stringifier is NOT byte-faithful: measured on 2.9.0, it
// collapses comment alignment (`name: x          # pad` -> `name: x # pad`) and,
// without `flowCollectionPadding: false`, pads flow collections
// (`{k: v}` -> `{ k: v }`). Asserting the invariant against String(doc) would
// have shipped a canvas that silently reformats every file it opens.
//
// The residual, stated plainly: once a document HAS been edited, re-emission
// normalises comment alignment padding throughout. Flow-collection spacing,
// key order, comments, blank lines, quoting style and block scalars all
// survive. That is a real cost and it is confined to files the user chose to
// change, which is the only place it is defensible.
//
// Mechanically: `yaml.parseDocument()` keeps the CST, and every mutation goes
// through setIn / deleteIn / addIn at a path the graph already carries on each
// node. There is deliberately NO code path anywhere that rebuilds a document
// from a WorkflowGraph.
//
// ANCHORS ARE A TRAP, BUT A LOCAL ONE. `setIn` through an alias mutates the
// shared anchor, so an edit in one place silently rewrites another. This
// started as a whole-document lock, which was safe and far too blunt: FIVE OF
// THIRTEEN real apps use anchors in their .xpcloud.yaml (mbb-ai has
// `skills: &id001` with `skills_invoked: *id001`), so a whole-file lock would
// refuse to edit 38% of them — including loops that never touch the anchor.
//
// The guard is now per-path, and refuses exactly two things:
//   - writing AT or UNDER an alias, which would follow it to the anchor;
//   - writing at or under an anchor whose alias is used OUTSIDE the path, which
//     would change that other place too.
// An anchor elsewhere in the file is somebody else's business.
//
// A multi-document stream is still a whole-file lock: there is no way to write
// one back without dropping everything after the first `---`.

import { Document, isAlias, isCollection, parseAllDocuments, parseDocument } from "yaml";

export interface DocIssue {
	level: "error" | "warning";
	message: string;
}

/** Why a document cannot be edited structurally, when it cannot. */
export type DocLock = null | { reason: string; detail: string };

const UNDO_DEPTH = 20;

/**
 * Emission options chosen to minimise diff noise on an edited file.
 * `flowCollectionPadding: false` keeps `{k: v}` from becoming `{ k: v }`;
 * `lineWidth: 0` stops long values being re-wrapped into folded scalars.
 */
const EMIT = { flowCollectionPadding: false, lineWidth: 0 } as const;

/**
 * Compare a value already in the document against one the UI is proposing.
 * Deliberately shallow-ish: scalars by ===, everything else by JSON, which is
 * enough for the inspector's field values and avoids pulling in a deep-equal.
 */
function sameScalarish(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (a == null || b == null) return false;
	if (typeof a === "object" || typeof b === "object") {
		try {
			return JSON.stringify(a) === JSON.stringify(b);
		} catch {
			return false;
		}
	}
	return false;
}

/**
 * A parsed document plus its undo history.
 *
 * Undo is a ring of TEXT snapshots rather than inverse commands. Strings are
 * cheap at this size, and a snapshot ring is provably correct in ~30 lines
 * where a command-inverse system is ~300 and subtly wrong — the inverse of
 * "remove a node" has to restore its comments and its position among siblings,
 * which is exactly the knowledge the CST holds and a command object does not.
 */
export class WorkflowDoc {
	private doc: Document;
	/**
	 * The authoritative text. Seeded from the source so an untouched document
	 * is byte-exact, and re-emitted only after an edit actually changes
	 * something.
	 */
	private text: string;
	private past: string[] = [];
	private future: string[] = [];
	readonly lock: DocLock;
	readonly issues: DocIssue[] = [];

	private constructor(doc: Document, text: string, lock: DocLock, issues: DocIssue[]) {
		this.doc = doc;
		this.text = text;
		this.lock = lock;
		this.issues = issues;
	}

	static parse(text: string): WorkflowDoc {
		const issues: DocIssue[] = [];
		let lock: DocLock = null;

		// A multi-document stream cannot be represented by a single graph, and
		// writing one back would silently drop everything after the first ---.
		const all = parseAllDocuments(text);
		if (all.length > 1) {
			lock = {
				reason: "multiple documents",
				detail: `This file holds ${all.length} YAML documents. The canvas can show the first, but editing it here would drop the rest.`,
			};
		}

		const doc = parseDocument(text, { keepSourceTokens: true });
		for (const e of doc.errors) issues.push({ level: "error", message: e.message });
		for (const w of doc.warnings) issues.push({ level: "warning", message: w.message });

		return new WorkflowDoc(doc, text, lock, issues);
	}

	/** The document's current text. Byte-identical to the input until edited. */
	toString(): string {
		return this.text;
	}

	/** The plain JS projection an adapter reads to build a graph. */
	toJS<T = unknown>(): T {
		return this.doc.toJS() as T;
	}

	get editable(): boolean {
		return this.lock === null;
	}

	get canUndo(): boolean {
		return this.past.length > 0;
	}
	get canRedo(): boolean {
		return this.future.length > 0;
	}

	/**
	 * Run a mutation, snapshotting first so it can be undone. Returns false and
	 * changes nothing when the document is structurally locked, so callers can
	 * surface a refusal rather than appearing to work.
	 */
	mutate(fn: (doc: Document) => void): boolean {
		if (!this.editable) return false;
		const before = this.text;
		fn(this.doc);
		const after = this.doc.toString(EMIT);
		if (after === before) return true;
		this.past.push(before);
		if (this.past.length > UNDO_DEPTH) this.past.shift();
		this.future = [];
		this.text = after;
		return true;
	}

	undo(): boolean {
		const prev = this.past.pop();
		if (prev === undefined) return false;
		this.future.push(this.text);
		// Restoring the stored STRING, not a re-emission of an AST, is what makes
		// undo byte-exact — including all the way back to the pristine source.
		this.text = prev;
		this.doc = parseDocument(prev, { keepSourceTokens: true });
		return true;
	}

	redo(): boolean {
		const next = this.future.pop();
		if (next === undefined) return false;
		this.past.push(this.text);
		this.text = next;
		this.doc = parseDocument(next, { keepSourceTokens: true });
		return true;
	}

	// --- path helpers ------------------------------------------------------
	// Thin wrappers so adapters never import `yaml` directly and every write
	// funnels through mutate()'s snapshot.

	getIn(path: (string | number)[]): unknown {
		return this.doc.getIn(path, true);
	}

	/**
	 * Why writing at `path` would be unsafe, or null when it is fine.
	 *
	 * Two distinct hazards, and both are about the SAME value existing in two
	 * places at once — an alias we would follow into somebody else's data, or an
	 * anchor somebody else is reading out of ours.
	 */
	aliasRiskAt(path: (string | number)[]): string | null {
		// ANCESTORS MATTER AS MUCH AS DESCENDANTS. Writing to `skills[0]` is as
		// dangerous as writing to `skills` when the anchor sits on `skills` — the
		// shared node is the one being mutated either way. So every prefix of the
		// path is checked, not just its endpoint.
		for (let i = 0; i <= path.length; i++) {
			const prefix = path.slice(0, i);
			let node: unknown;
			try {
				node = prefix.length ? this.doc.getIn(prefix, true) : this.doc.contents;
			} catch {
				// getIn throws when the path runs INTO a scalar or an alias — which
				// is itself the signal that something on the way is not a collection.
				return "That path runs through a YAML alias or a scalar, so it cannot be edited safely here.";
			}
			if (node == null) continue;

			if (isAlias(node)) {
				return "This value is a YAML alias (*x). Editing it would rewrite the anchor it points at, and every other place that anchor is used.";
			}
			const anchor = (node as { anchor?: string }).anchor;
			if (anchor && aliasNamesOutside(this.doc.contents, node).has(anchor)) {
				return `This value carries the anchor &${anchor}, which is referenced elsewhere in the file (*${anchor}). Editing it would change that other place too.`;
			}
		}

		// And an alias anywhere UNDER the path: writing there would follow it.
		let target: unknown;
		try {
			target = path.length ? this.doc.getIn(path, true) : this.doc.contents;
		} catch {
			return null;
		}
		if (target != null && containsAlias(target)) {
			return "This value contains a YAML alias (*x). Editing it would rewrite the anchor it points at.";
		}
		const defined = anchorsIn(target);
		if (defined.size) {
			const used = aliasNamesOutside(this.doc.contents, target);
			for (const name of defined) {
				if (used.has(name)) {
					return `This value carries the anchor &${name}, which is referenced elsewhere in the file (*${name}). Editing it would change that other place too.`;
				}
			}
		}
		return null;
	}

	setIn(path: (string | number)[], value: unknown): boolean {
		// No-op detection compares VALUES, not text. Text comparison cannot work
		// here: on a still-pristine document the re-emitted form differs from the
		// source by comment alignment alone, so retyping an identical value would
		// look like a change and bury the user's real last edit under a
		// formatting-only undo entry.
		if (!this.editable) return false;
		if (this.aliasRiskAt(path)) return false;
		const current = this.doc.getIn(path);
		if (sameScalarish(current, value)) return true;
		return this.mutate((d) => {
			d.setIn(path, value === undefined ? null : d.createNode(value));
		});
	}

	deleteIn(path: (string | number)[]): boolean {
		if (this.aliasRiskAt(path)) return false;
		return this.mutate((d) => {
			d.deleteIn(path);
		});
	}

	addIn(path: (string | number)[], value: unknown): boolean {
		if (this.aliasRiskAt(path)) return false;
		return this.mutate((d) => {
			d.addIn(path, d.createNode(value));
		});
	}

	/** Move an item within a sequence, preserving every other entry's node. */
	reorderIn(path: (string | number)[], from: number, to: number): boolean {
		if (this.aliasRiskAt(path)) return false;
		return this.mutate((d) => {
			const seq = d.getIn(path, true);
			if (!isCollection(seq) || !Array.isArray((seq as { items?: unknown[] }).items)) return;
			const items = (seq as unknown as { items: unknown[] }).items;
			if (from < 0 || from >= items.length) return;
			const clamped = Math.max(0, Math.min(items.length - 1, to));
			const [moved] = items.splice(from, 1);
			items.splice(clamped, 0, moved);
		});
	}
}

/**
 * Walk a node tree. `visit` from `yaml` would be tidier but is typed awkwardly
 * across versions; an explicit walk keeps this dependency-version-proof. Map
 * entries are {key, value} pairs rather than nodes, hence the second branch.
 */
function walkNodes(node: unknown, fn: (n: unknown) => void): void {
	if (node == null || typeof node !== "object") return;
	fn(node);
	const items = (node as { items?: unknown[] }).items;
	if (!Array.isArray(items)) return;
	for (const it of items) {
		const pair = it as { key?: unknown; value?: unknown };
		if (pair && typeof pair === "object" && ("key" in pair || "value" in pair)) {
			walkNodes(pair.key, fn);
			walkNodes(pair.value, fn);
		} else {
			walkNodes(it, fn);
		}
	}
}

/** Is there an alias at or under this node? */
function containsAlias(node: unknown): boolean {
	let found = false;
	walkNodes(node, (n) => { if (isAlias(n)) found = true; });
	return found;
}

/** Anchor names defined at or under this node. */
function anchorsIn(node: unknown): Set<string> {
	const out = new Set<string>();
	walkNodes(node, (n) => {
		const a = (n as { anchor?: string }).anchor;
		if (a) out.add(a);
	});
	return out;
}

/** Alias names used anywhere in `root` that is NOT inside `subtree`. */
function aliasNamesOutside(root: unknown, subtree: unknown): Set<string> {
	const inside = new Set<unknown>();
	walkNodes(subtree, (n) => inside.add(n));
	const out = new Set<string>();
	walkNodes(root, (n) => {
		if (inside.has(n)) return;
		if (isAlias(n)) {
			const src = (n as { source?: string }).source;
			if (src) out.add(src);
		}
	});
	return out;
}
