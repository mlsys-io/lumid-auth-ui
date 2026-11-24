// codemod-studio-tokens.mjs — move Studio source onto the Lumen scales.
//
//   node scripts/codemod-studio-tokens.mjs [--dry] [--files a.tsx,b.tsx]
//
// IDEMPOTENT: it only rewrites classes from families Lumen replaced, so a
// second run is a no-op. Other branches can run it after rebasing instead of
// hand-resolving class conflicts. Scope = scripts/studio-scope.mjs minus SKIP.
//
// Rules (lumid_ui/CLAUDE.md § Design system):
//   slate/gray/zinc/neutral/stone -> ink      (same step)
//   indigo/violet/purple/fuchsia/pink -> plum
//   sky/blue/cyan/teal -> lagoon              (running / info)
//   emerald/green/lime -> gold                (ok is gold by design, cdaece6)
//   rose/red -> brick                         (failing)
//   amber/yellow/orange -> ember              (attention)
//   bg-white -> bg-card                       (alpha-safe since P1)
//   text-[Npx] -> the type scale; text-base/lg/xl/2xl/3xl -> read/title/h3/h2/h1
// TEXT colour is bumped to the family's minimum legible step (ink 600, gold
// 700, others 600) — scripts/check-contrast.mjs holds those at >= 4.5:1 on
// paper and muted. slate-400 text was ~2.5:1. Placeholders floor at ink-500.
//
// Translucent TEXT tokens (text-foreground/60, text-muted-foreground/50 …)
// become solid ink steps (alphaText below). They were inert until P1 fixed
// token opacity, so they had always rendered at full strength; revived, the
// /50 timestamps measured 2.0:1. Solid steps keep the hierarchy legibly.
// `--alpha-text-only` runs just that rule (it is safe repo-wide).
//
// Lines containing `palette-ok` are left alone (chart/data colours).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { studioScope } from "./studio-scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Files with an open PR against them — swept in a follow-up once they merge,
// so this change doesn't force a conflict on someone else's branch.
export const SKIP = new Set([
	"src/admin/fm/fleet-tab.tsx", // #196
	"src/workflow/inspector/FieldRow.tsx", // #180
]);

const FAM = {
	slate: "ink", gray: "ink", zinc: "ink", neutral: "ink", stone: "ink",
	indigo: "plum", violet: "plum", purple: "plum", fuchsia: "plum", pink: "plum",
	sky: "lagoon", blue: "lagoon", cyan: "lagoon", teal: "lagoon",
	emerald: "gold", green: "gold", lime: "gold",
	rose: "brick", red: "brick",
	amber: "ember", yellow: "ember", orange: "ember",
};
const TEXT_MIN = { ink: 600, gold: 700, ember: 600, brick: 600, lagoon: 600, plum: 600 };
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

const UTIL = "bg|text|border|border-[trblxy]|ring|ring-offset|from|via|to|fill|stroke|divide|outline|shadow|decoration|accent|caret";
const CLASS = new RegExp(
	`(?<![\\w-])((?:[a-z0-9-]+:|\\[[^\\]\\s]+\\]:)*)(${UTIL})-(${Object.keys(FAM).join("|")})-(\\d{2,3})((?:\\/\\d+)?)(?![\\w-])`,
	"g",
);

function mapStep(target, step, util, variants) {
	let s = Number(step);
	if (s === 950 && target !== "ink") s = 900;
	if (!STEPS.includes(s) && !(target === "ink" && s === 950)) s = STEPS.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
	if (util === "text") {
		const min = variants.includes("placeholder:") ? 500 : TEXT_MIN[target];
		// Only bump DARK-on-light text. Light steps (50-200) on a dark fill are
		// inverted text and keep their step.
		if (s >= 300 && s < min) s = min;
	}
	return s;
}

const PX_TO_SCALE = (px) => {
	const n = Number(px);
	if (n <= 10) return "nano";
	if (n <= 11) return "micro";
	if (n <= 12) return "caption";
	if (n <= 13.5) return "meta";
	if (n <= 14) return "body";
	if (n <= 16) return "read";
	if (n <= 18) return "title";
	if (n <= 21) return "h3";
	if (n <= 27) return "h2";
	return "h1";
};
const NAMED = { base: "read", lg: "title", xl: "h3", "2xl": "h2", "3xl": "h1", "4xl": "h1" };

// text-<token>/NN -> a solid ink step that clears 4.5:1 on paper, muted and
// the sidebar (scripts/check-contrast.mjs). Icons share the rule; ink-600 is
// fine for them too.
const ALPHA_TEXT = /(?<![\w-])((?:[a-z0-9-]+:)*)text-(foreground|card-foreground|popover-foreground|sidebar-foreground|muted-foreground)\/(\d+)(?![\w-])/g;
function alphaStep(token, pct) {
	if (token === "muted-foreground") return 600;
	const n = Number(pct);
	if (n >= 85) return 900;
	if (n >= 65) return 800;
	if (n >= 50) return 700;
	return 600;
}
export function alphaText(line) {
	let n = 0;
	const out = line.replace(ALPHA_TEXT, (_m, v, token, pct) => {
		n++;
		return `${v}text-ink-${alphaStep(token, pct)}`;
	});
	return { out, n };
}

// Gold is the brand bronze, but gold-600 TEXT is 3.9:1 and white on a
// gold-500/600 fill is 3.1-3.9:1. In a class string that is clearly text
// (carries a size token), gold text steps up to 700; a solid gold fill under
// white text steps up to 700 (hover -> 800). Icons (no size token) keep 600.
const SIZE_TOKEN = /(?<![\w-])text-(?:nano|micro|caption|meta|body|read|title|xs|sm)(?![\w-])/;
function goldText(line) {
	let n = 0;
	const out = line.replace(/(["'`])([^"'`]*)\1/g, (whole, q, cls) => {
		let c = cls;
		if (SIZE_TOKEN.test(c)) c = c.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)text-gold-(?:400|500|600)(?![\w-])/g, (_m, v) => (n++, `${v}text-gold-700`));
		if (/(?<![\w-])text-white(?![\w-])/.test(c)) {
			c = c.replace(/(?<![\w-:])bg-gold-(?:400|500|600)(?![\w-])/g, () => (n++, "bg-gold-700"));
			c = c.replace(/(?<![\w-])hover:bg-gold-(?:500|600|700)(?![\w-])/g, () => (n++, "hover:bg-gold-800"));
		}
		return c === cls ? whole : q + c + q;
	});
	return { out, n };
}

// Translucent BLACK / foreground fills and borders (bg-foreground/[0.05],
// bg-black/[0.04], border-foreground/25 …) were inert before P1's token-opacity
// fix for the token ones; alive, they lay a cool grey film over warm paper.
// Map them to warm ink steps; true scrims (black/15+ backgrounds) become a
// warm ink-950 scrim at the same strength.
function alphaFill(line) {
	let n = 0;
	const step = (pct) => (pct <= 6 ? "ink-100/60" : pct <= 12 ? "ink-100" : pct <= 22 ? "ink-200" : "ink-300");
	const pctOf = (raw) => (raw.startsWith("[") ? Math.round(parseFloat(raw.slice(1, -1)) * 100) : Number(raw));
	let out = line.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)bg-(foreground|primary)\/(\[[0-9.]+\]|[0-9]+)(?![\w-])/g, (m, v, t, raw) => {
		if (t === "primary" && /^hover:$/.test(v)) return (n++, `${v}bg-ink-800`);
		return (n++, `${v}bg-${step(pctOf(raw))}`);
	});
	out = out.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)bg-black\/(\[[0-9.]+\]|[0-9]+)(?![\w-])/g, (m, v, raw) => {
		const p = pctOf(raw);
		return (n++, p >= 15 ? `${v}bg-ink-950/${p}` : `${v}bg-${step(p)}`);
	});
	out = out.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)border-foreground\/(\[[0-9.]+\]|[0-9]+)(?![\w-])/g, (m, v, raw) => (n++, `${v}border-${pctOf(raw) >= 30 ? "ink-400" : "ink-300"}`));
	out = out.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)ring-black\/(\d+)(?![\w-])/g, (m, v, a) => (n++, `${v}ring-ink-900/${a}`));
	return { out, n };
}

export function transform(src, { alphaOnly = false } = {}) {
	let changed = 0;
	const out = src.split("\n").map((line) => {
		if (line.includes("palette-ok")) return line;
		const a = alphaText(line);
		changed += a.n;
		if (alphaOnly) return a.out;
		const f = alphaFill(a.out);
		changed += f.n;
		const g = goldText(f.out);
		changed += g.n;
		let l = g.out.replace(CLASS, (_m, variants, util, fam, step, alpha) => {
			changed++;
			const t = FAM[fam];
			return `${variants}${util}-${t}-${mapStep(t, step, util, variants)}${alpha}`;
		});
		l = l.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)bg-white((?:\/\d+)?)(?![\w-])/g, (_m, v, a) => {
			changed++;
			return `${v}bg-card${a}`;
		});
		l = l.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)text-\[(\d+(?:\.\d+)?)px\](?![\w-])/g, (_m, v, px) => {
			changed++;
			return `${v}text-${PX_TO_SCALE(px)}`;
		});
		// Only inside class-ish strings: require a className/cn/clsx context or
		// a quoted class list on the line, to avoid touching prose.
		if (/className|cn\(|clsx|class=|cva\(|["'`][^"'`]*\btext-(?:base|lg|xl|2xl|3xl|4xl)\b/.test(l)) {
			l = l.replace(/(?<![\w-])((?:[a-z0-9-]+:)*)text-(base|lg|xl|2xl|3xl|4xl)(?![\w-])/g, (_m, v, k) => {
				changed++;
				return `${v}text-${NAMED[k]}`;
			});
		}
		return l;
	});
	return { text: out.join("\n"), changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const dry = process.argv.includes("--dry");
	const alphaOnly = process.argv.includes("--alpha-text-only");
	const fi = process.argv.indexOf("--files");
	const files = fi > 0 ? process.argv[fi + 1].split(",") : (await studioScope()).filter((f) => !SKIP.has(f));
	let total = 0;
	let nfiles = 0;
	for (const f of files) {
		const p = join(root, f);
		const src = await readFile(p, "utf8");
		const { text, changed } = transform(src, { alphaOnly });
		if (changed && text !== src) {
			total += changed;
			nfiles++;
			if (!dry) await writeFile(p, text);
			console.log(`${String(changed).padStart(5)}  ${f}`);
		}
	}
	console.log(`\n${dry ? "[dry] " : ""}${total} rewrites in ${nfiles} files (skipped: ${[...SKIP].join(", ")})`);
}
