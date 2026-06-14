// MetaChips — compact bordered metadata chips (kind / version / stars / …).
// From the pre-migration marketplace card. Pass a list of {label, tone};
// or use the AppMetaChips convenience wrapper for the common app shape.

import { cn } from "@/lib/utils";

type Tone = "slate" | "amber" | "emerald" | "indigo";

const TONE: Record<Tone, string> = {
	slate: "border-slate-200 bg-slate-50 text-slate-600",
	amber: "border-gold-200 bg-gold-50 text-gold-700",
	emerald: "border-gold-200 bg-gold-50 text-gold-700",
	indigo: "border-indigo-200 bg-indigo-50 text-indigo-700",
};

export interface Chip {
	label: string;
	tone?: Tone;
	mono?: boolean;
	uppercase?: boolean;
	title?: string;
}

export function MetaChips({ chips, className }: { chips: Chip[]; className?: string }) {
	if (chips.length === 0) return null;
	return (
		<div className={cn("flex items-center gap-1.5 flex-wrap text-[10px]", className)}>
			{chips.map((c, i) => (
				<span key={i} title={c.title} className={cn(
					"px-1.5 py-0.5 rounded border",
					TONE[c.tone ?? "slate"],
					c.mono && "font-mono",
					c.uppercase && "uppercase tracking-wide",
				)}>
					{c.label}
				</span>
			))}
		</div>
	);
}

// Plain-language kind labels + one-line tooltips for fresh users — the raw
// repo kinds are developer vocabulary, so the card face translates them.
const KIND_CHIP: Record<string, { label: string; title: string }> = {
	app:          { label: "App",       title: "installs into My Apps and runs for you" },
	autoresearch: { label: "App",       title: "installs into My Apps and runs for you" },
	skill:        { label: "Skill",     title: "a capability that plugs into apps you own" },
	agent:        { label: "Knowledge", title: "a knowledge base you can subscribe to" },
	dataset:      { label: "Dataset",   title: "data an app can mount" },
	strategy:     { label: "Strategy",  title: "a trading strategy for Lumid Market" },
	workflow:     { label: "Workflow",  title: "a workflow recipe that runs inside apps" },
};

// AppMetaChips — the common kind/stars pair (version is intentionally hidden
// on the card face; it still shows in the detail drawer header).
export function AppMetaChips({ kind, stars }: { kind?: string; version?: string; stars?: number }) {
	const kc = KIND_CHIP[kind ?? "app"] ?? KIND_CHIP.app;
	const chips: Chip[] = [{ label: kc.label, uppercase: true, title: kc.title }];
	if ((stars ?? 0) > 0) chips.push({ label: `★ ${stars}`, tone: "amber" });
	return <MetaChips chips={chips} />;
}
