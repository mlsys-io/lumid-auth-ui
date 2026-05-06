import { useOutletContext } from "react-router-dom";
import type { Cluster, ClusterServer, Node, Worker } from "@/api/cluster";

export type ClusterCtx = {
	id: string;
	cluster: Cluster;
	servers: ClusterServer[];
	nodes: Node[];
	workers: Worker[];
	refresh: () => Promise<void>;
};

export function useClusterCtx() {
	return useOutletContext<ClusterCtx>();
}
