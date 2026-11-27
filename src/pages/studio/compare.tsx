// /studio/apps/:app/compare?runs=…|versions=… — the Compare page (round 9).
// A thin route over components/research/CompareRuns; inside the studio shell
// like the run page, so the app switcher stays in the top strip.
import { useParams } from "react-router-dom";
import CompareRuns from "@/components/research/CompareRuns";

export default function StudioCompare() {
	const { app = "" } = useParams();
	return <CompareRuns app={app} />;
}
