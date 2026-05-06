import { useClusterCtx } from "./context";
import ServersTab from "./servers-tab";
import NodesTab from "./nodes-tab";
import WorkersTab from "./workers-tab";
import CommercialTab from "./commercial-tab";
import SubmitTab from "./submit-tab";

// Thin wrappers that read the cluster outlet context and forward to
// each tab's existing prop signature. Lets the tab components stay
// reusable while routes drive which one is shown.

export function ServersRoute() {
	const c = useClusterCtx();
	return (
		<ServersTab clusterId={c.id} servers={c.servers} onChange={c.refresh} />
	);
}

export function NodesRoute() {
	const c = useClusterCtx();
	return <NodesTab clusterId={c.id} nodes={c.nodes} onChange={c.refresh} />;
}

export function WorkersRoute() {
	const c = useClusterCtx();
	return <WorkersTab workers={c.workers} nodes={c.nodes} onChange={c.refresh} />;
}

export function CommercialRoute() {
	const c = useClusterCtx();
	return <CommercialTab clusterId={c.id} />;
}

export function SubmitRoute() {
	const c = useClusterCtx();
	return <SubmitTab clusterId={c.id} />;
}
