// StudioRepo — read-only repo browser (Files + Pull Requests), the Studio
// replacement for the retired xp_ui repo page. Anonymous-capable: it reads the
// same-origin /api/v1/repos proxy, so it works logged-out (public repos) and
// signed-in (private repos you own). Mounted at /studio/r/:owner/:name (authed)
// and /explore/r/:owner/:name (public).
import { useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { FileText, Folder, GitPullRequest, ChevronRight, Star, Download, Boxes } from "lucide-react";
import {
	getRepo, listBranches, getTree, getBlob, listPulls, getPullDiff, getProvenance,
	type Repo, type TreeEntry, type Blob, type PR, type PRDiff,
} from "@/api/repos";
import { LumidMarkdown } from "@/components/app-surface/LumidMarkdown";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { NotFound } from "@/components/illustrations/scenes";

export default function StudioRepo() {
	const { owner = "", name = "" } = useParams();
	const location = useLocation();
	const [repo, setRepo] = useState<Repo | null>(null);
	const [prov, setProv] = useState<{ verified?: boolean | null; fork_of?: string } | null>(null);
	const [ref, setRef] = useState("main");
	const [tab, setTab] = useState<"files" | "pulls">("files");
	const [notFound, setNotFound] = useState(false);

	useEffect(() => {
		let live = true;
		setNotFound(false);
		getRepo(owner, name).then((r) => { if (!live) return; if (!r) { setNotFound(true); return; } setRepo(r); setRef(r.head_ref || "main"); });
		getProvenance(owner, name).then((p) => { if (live && p?.is_fork) setProv(p); }).catch(() => {});
		return () => { live = false; };
	}, [owner, name]);

	if (notFound) return (
		<div className="max-w-[920px] mx-auto px-4 py-10">
			<EmptyState
				art={<NotFound />}
				title="This repo isn't here"
				body={<><span className="font-mono text-ink-800">{owner}/{name}</span> doesn't exist, or it's private to its owner.</>}
				actionLabel="Browse the marketplace"
				to={location.pathname.startsWith('/explore') ? '/explore' : '/studio/library/marketplace'}
			/>
		</div>
	);
	if (!repo) return (
		<div className="max-w-[920px] mx-auto px-4 py-8 space-y-4" role="status" aria-label="Loading repository">
			<Skeleton className="h-8 w-64 rounded-lg" />
			<Skeleton className="h-4 w-96 rounded-full" />
			<Skeleton className="h-72 rounded-xl" />
		</div>
	);

	return (
		<div className="max-w-[920px] mx-auto w-full px-4 py-6">
			{/* Header */}
			<div className="flex items-start gap-3 mb-4">
				<Boxes className="w-5 h-5 mt-1 text-gold-500 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 flex-wrap">
						<h1 className="font-display text-h2 font-medium tracking-tight text-foreground truncate">{repo.display_name || repo.name}</h1>
						{repo.kind && <span className="text-nano uppercase tracking-wide px-1.5 py-0.5 rounded border border-ink-200 bg-ink-50 text-ink-600">{repo.kind}</span>}
						{repo.version && <span className="text-micro text-muted-foreground font-mono">v{repo.version}</span>}
					</div>
					{repo.summary && <p className="text-meta text-muted-foreground mt-1">{repo.summary}</p>}
					<div className="flex items-center gap-3 mt-1.5 text-micro text-muted-foreground">
						<span className="font-mono">{owner.slice(0, 8)}/{name}</span>
						{(repo.stars ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><Star className="w-3 h-3" />{repo.stars}</span>}
						{(repo.downloads ?? 0) > 0 && <span className="inline-flex items-center gap-0.5"><Download className="w-3 h-3" />{repo.downloads}</span>}
						{prov?.fork_of && <span title={`fork provenance: ${prov.verified ? "git-verified" : "unverified"}`}>fork of <span className="font-mono">{prov.fork_of.split("/")[1]}</span> {prov.verified ? "✓" : "(unverified)"}</span>}
					</div>
					<div className="mt-2 text-micro text-muted-foreground">
						Clone: <code className="font-mono bg-muted px-1 py-0.5 rounded">git clone https://xp.io/{owner}/{name}.git</code>
					</div>
				</div>
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-1.5 border-b border-border mb-3">
				{(["files", "pulls"] as const).map((t) => (
					<button key={t} onClick={() => setTab(t)}
						className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 text-meta font-medium border-b-2 -mb-px transition-colors",
							tab === t ? "border-gold-400 text-gold-900" : "border-transparent text-ink-600 hover:text-ink-800")}>
						{t === "files" ? <FileText className="w-3.5 h-3.5" /> : <GitPullRequest className="w-3.5 h-3.5" />}
						{t === "files" ? "Files" : "Pull requests"}
					</button>
				))}
			</div>

			{tab === "files"
				? <FilesTab owner={owner} name={name} refName={ref} />
				: <PullsTab owner={owner} name={name} />}
		</div>
	);
}

function FilesTab({ owner, name, refName }: { owner: string; name: string; refName: string }) {
	const [path, setPath] = useState("");
	const [entries, setEntries] = useState<TreeEntry[] | null>(null);
	const [blob, setBlob] = useState<Blob | null>(null);
	const [blobPath, setBlobPath] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		setBlob(null); setBlobPath(null); setEntries(null);
		getTree(owner, name, refName, path).then((e) => { if (live) setEntries(e); }).catch(() => { if (live) setEntries([]); });
		return () => { live = false; };
	}, [owner, name, refName, path]);

	const crumbs = useMemo(() => path ? path.split("/") : [], [path]);
	const openFile = (entryName: string) => {
		const fp = path ? `${path}/${entryName}` : entryName;
		setBlobPath(fp);
		getBlob(owner, name, refName, fp).then(setBlob).catch(() => setBlob(null));
	};
	const sorted = useMemo(() => [...(entries || [])].sort((a, b) =>
		(a.type === b.type ? a.name.localeCompare(b.name) : a.type === "tree" ? -1 : 1)), [entries]);

	return (
		<div>
			{/* Breadcrumb */}
			<div className="flex items-center gap-1 text-caption mb-2 flex-wrap">
				<button onClick={() => { setPath(""); setBlob(null); setBlobPath(null); }} className="text-gold-700 hover:underline">{name}</button>
				{crumbs.map((c, i) => (
					<span key={i} className="flex items-center gap-1">
						<ChevronRight className="w-3 h-3 text-muted-foreground" />
						<button onClick={() => { setPath(crumbs.slice(0, i + 1).join("/")); setBlob(null); setBlobPath(null); }} className="text-gold-700 hover:underline">{c}</button>
					</span>
				))}
				{blobPath && <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3 text-muted-foreground" /><span className="text-foreground">{blobPath.split("/").pop()}</span></span>}
			</div>

			{blob ? (
				blobPath?.toLowerCase().endsWith(".md")
					? <div className="border border-border rounded-lg p-4 bg-card"><LumidMarkdown source={blob.content} /></div>
					: <pre className="border border-border rounded-lg p-3 bg-muted/40 overflow-x-auto text-caption font-mono leading-relaxed whitespace-pre">{blob.content}</pre>
			) : (
				<div className="border border-border rounded-lg divide-y divide-border/60">
					{entries === null && <div className="space-y-1.5 p-3" role="status" aria-label="Loading files">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-5 rounded-md" />)}</div>}
					{entries?.length === 0 && <div className="px-3 py-6 text-center text-caption text-muted-foreground">Empty.</div>}
					{sorted.map((e) => (
						<button key={e.name} onClick={() => e.type === "tree" ? setPath(path ? `${path}/${e.name}` : e.name) : openFile(e.name)}
							className="w-full flex items-center gap-2 px-3 py-2 text-meta hover:bg-muted transition-colors text-left">
							{e.type === "tree" ? <Folder className="w-4 h-4 text-gold-500 shrink-0" /> : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
							<span className="truncate">{e.name}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function PullsTab({ owner, name }: { owner: string; name: string }) {
	const [pulls, setPulls] = useState<PR[] | null>(null);
	const [sel, setSel] = useState<number | null>(null);
	const [diff, setDiff] = useState<PRDiff | null>(null);

	useEffect(() => { listPulls(owner, name, "all").then(setPulls).catch(() => setPulls([])); }, [owner, name]);
	useEffect(() => {
		if (sel == null) { setDiff(null); return; }
		let live = true; setDiff(null);
		getPullDiff(owner, name, sel).then((d) => { if (live) setDiff(d); }).catch(() => {});
		return () => { live = false; };
	}, [owner, name, sel]);

	const tone = (s: PR["state"]) => s === "merged" ? "text-plum-700" : s === "closed" ? "text-ink-600" : "text-gold-700";

	if (pulls === null) return <div className="space-y-2 p-3" role="status" aria-label="Loading pull requests">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>;
	if (pulls.length === 0) return <div className="px-3 py-6 text-center text-caption text-muted-foreground">No pull requests.</div>;
	return (
		<div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-3">
			<div className="border border-border rounded-lg divide-y divide-border/60 h-fit">
				{pulls.map((p) => (
					<button key={p.number} onClick={() => setSel(p.number)}
						className={cn("w-full text-left px-3 py-2 hover:bg-muted transition-colors", sel === p.number && "bg-muted")}>
						<div className="flex items-center gap-2"><span className="text-caption font-mono text-muted-foreground">#{p.number}</span><span className={cn("text-nano uppercase", tone(p.state))}>{p.state}</span></div>
						<div className="text-meta truncate">{p.title}</div>
					</button>
				))}
			</div>
			<div>
				{sel == null ? <div className="px-3 py-6 text-caption text-muted-foreground">Select a pull request.</div>
					: diff === null ? <div className="px-3 py-6 text-caption text-muted-foreground">Loading diff…</div>
						: (
							<div>
								<div className="text-micro text-muted-foreground mb-2">{diff.files.length} file(s) · <span className="font-mono">{diff.base_sha.slice(0, 7)}…{diff.head_sha.slice(0, 7)}</span></div>
								<pre className="border border-border rounded-lg p-3 bg-muted/40 overflow-x-auto text-caption font-mono leading-relaxed whitespace-pre">{diff.unified_diff || "(no textual diff)"}</pre>
							</div>
						)}
			</div>
		</div>
	);
}
