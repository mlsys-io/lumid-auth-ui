// Native surface "app-workflows" — the app's workflow/autoresearch machinery
// (loop list, run sparklines, cycle inspector) embedded as a TAB of the app's
// configured UI. Apps with loops declare it in xpcloud.yaml:
//
//   ui:
//     surfaces: { workflows: "ui/workflows.md" }   # md containing lumid:native key: app-workflows
//     nav:      [ ..., { surface: workflows, label: Workflows } ]
//
// so the app's face (config surfaces) and its machinery (cycle observability)
// live on one page — no separate route a fresh user has to discover.

import { useParams } from "react-router-dom";
import { AppOverview } from "@/pages/studio/apps";

export default function AppWorkflowsSurface() {
	const { app = "" } = useParams<{ app: string }>();
	if (!app) return null;
	return <AppOverview app={app} embedded />;
}
