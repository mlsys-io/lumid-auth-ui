// Role-aware entry points for the Compute section.
//
// /studio/compute sits OUTSIDE <AdminGuard> on purpose — the home fleet is
// readable by any signed-in user — so the tabs that are partly public need to
// know the caller's role to decide WHICH sites to ask for. Keeping that decision
// here means fleet-tab/ssh-tab stay presentational and testable with a boolean.

import { useAuth } from "../../hooks/useAuth";
import FleetTab from "./fleet-tab";
import JobsTab from "./jobs-tab";

function useIsAdmin(): boolean {
	const { user } = useAuth();
	return user?.role === "admin" || user?.role === "super_admin";
}

export function FleetRoute() {
	return <FleetTab isAdmin={useIsAdmin()} />;
}

export function JobsRoute() {
	return <JobsTab isAdmin={useIsAdmin()} />;
}

// SshRoute is gone: SSH is a view inside Jobs now, not a route. jobs-tab renders
// <SshTab isAdmin embedded /> — hardcoded true because Jobs is itself admin-only,
// so there is no non-admin caller to scope down for.
