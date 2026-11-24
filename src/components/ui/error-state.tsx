// ErrorState — what a failed load looks like (Lumen).
//
// Replaces raw boxes like "Request failed with status code 401". Rules:
//  - Say what didn't load, in words, with a Retry.
//  - The raw message is available behind "Details", never the headline.
//  - A 401/403 is NOT automatically "your session expired": many Studio
//    panels call other services (/inbox-api -> xpcloud, FlowMesh, …) that can
//    refuse while the lum.id session is perfectly fine. So we probe the app's
//    own session check (/api/v1/user, same as api/client.ts) and only offer
//    "sign in again" when THAT fails too.

import { useEffect, useState } from "react";
import { ChevronRight, LogIn, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

/** Best-effort HTTP status from axios errors, MeApiError, fetch wrappers, or messages. */
export function errorStatus(e: unknown): number | undefined {
	const any = e as { response?: { status?: number }; status?: number; message?: string } | undefined;
	const s = any?.response?.status ?? any?.status;
	if (typeof s === "number") return s;
	const m = String(any?.message ?? e ?? "").match(/status code (\d{3})|\b(40[13])\b/);
	return m ? Number(m[1] ?? m[2]) : undefined;
}

type Session = "unknown" | "ok" | "expired";

function useSessionProbe(enabled: boolean): Session {
	const [s, setS] = useState<Session>("unknown");
	useEffect(() => {
		if (!enabled) return;
		let live = true;
		fetch("/api/v1/user", { credentials: "include" })
			.then((r) => live && setS(r.status === 401 ? "expired" : "ok"))
			.catch(() => live && setS("unknown"));
		return () => {
			live = false;
		};
	}, [enabled]);
	return s;
}

export function ErrorState({
	error, what = "this", onRetry, art, hint, size = "md", className,
}: {
	error: unknown;
	/** Noun phrase for what failed: "your inbox", "runs", "the catalog". */
	what?: string;
	onRetry?: () => void;
	/** Optional Strands scene (ErrorFrayed). */
	art?: React.ReactNode;
	/** Extra teaching line (e.g. "Apps post here once inbox_publish is on"). */
	hint?: React.ReactNode;
	size?: "sm" | "md";
	className?: string;
}) {
	const status = errorStatus(error);
	const authish = status === 401 || status === 403;
	const session = useSessionProbe(authish);
	const [open, setOpen] = useState(false);
	const raw = String((error as { message?: string })?.message ?? error ?? "");

	let title = `Couldn't load ${what}`;
	let body: React.ReactNode = "Something went wrong on our side. Try again in a moment.";
	if (authish && session === "expired") {
		title = "Your session has ended";
		body = "Sign in again to pick up where you left off.";
	} else if (authish) {
		title = `${what.charAt(0).toUpperCase()}${what.slice(1)} isn't available to you right now`;
		body = "The service behind this panel declined the request. Your sign-in is fine — this is on our side, or a permission this account doesn't have.";
	} else if (status === 404) {
		body = "It may have been moved or deleted.";
	} else if (status && status >= 500) {
		body = "The service behind this panel is having trouble. Try again in a moment.";
	}

	const btn =
		"lumen-press inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 h-8 text-meta font-medium text-ink-800 shadow-e1 transition-colors duration-120 hover:border-ink-300 hover:bg-ink-50";
	return (
		<div
			role="alert"
			className={cn(
				"animate-lumen-rise rounded-xl border border-brick-200/70 bg-card text-center shadow-e1",
				size === "md" ? "px-6 py-8" : "px-5 py-5",
				className,
			)}
		>
			{art && <div className={cn("mx-auto text-ink-300", size === "md" ? "mb-4 w-36" : "mb-3 w-24")}>{art}</div>}
			<div className={cn("font-medium text-ink-900", size === "md" ? "text-title" : "text-body")}>{title}</div>
			<p className="mx-auto mt-1.5 max-w-md text-meta text-ink-600 text-pretty">{body}</p>
			{hint && <p className="mx-auto mt-1 max-w-md text-meta text-ink-600 text-pretty">{hint}</p>}
			<div className="mt-4 flex items-center justify-center gap-2">
				{authish && session === "expired" ? (
					<a
						href={`/auth/login?return_to=${encodeURIComponent(location.pathname + location.search)}`}
						className={cn(btn, "border-transparent bg-primary text-primary-foreground hover:bg-ink-800 hover:border-transparent")}
					>
						<LogIn className="w-3.5 h-3.5" /> Sign in
					</a>
				) : (
					onRetry && (
						<button type="button" onClick={onRetry} className={btn}>
							<RotateCw className="w-3.5 h-3.5 text-ink-500" /> Try again
						</button>
					)
				)}
			</div>
			{raw && (
				<div className="mt-3">
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="inline-flex items-center gap-1 text-caption text-ink-600 hover:text-ink-900"
						aria-expanded={open}
					>
						<ChevronRight className={cn("w-3 h-3 transition-transform duration-180", open && "rotate-90")} />
						Details
					</button>
					{open && (
						<pre className="mx-auto mt-2 max-w-md whitespace-pre-wrap break-words rounded-md bg-card/80 px-3 py-2 text-left font-mono text-caption text-ink-700 border border-border">
							{status ? `HTTP ${status} — ` : ""}
							{raw}
						</pre>
					)}
				</div>
			)}
		</div>
	);
}
