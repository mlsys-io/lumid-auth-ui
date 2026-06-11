// Native surface "app-experiments" — the app's experiments observability
// (hypothesis × variants × dataset/casebook × metric) as a tab of the
// configured UI. Declare in xpcloud.yaml:
//   ui:
//     surfaces: { experiments: "ui/experiments.md" }   # md containing lumid:native key: app-experiments
//     nav: [..., {label: Experiments, surface: experiments}]
import { useParams } from "react-router-dom";
import ExperimentsPanel from "@/components/experiments/ExperimentsPanel";

export default function AppExperimentsSurface() {
	const { app } = useParams<{ app: string }>();
	if (!app) return null;
	return <ExperimentsPanel app={app} />;
}
