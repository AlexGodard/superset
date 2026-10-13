import type { HostWorkspacesStatus } from "@/hooks/useHostWorkspaces";
import type { HostSectionState } from "../../components/HostSectionHeader";

export function getHostSectionState({
	isOnline,
	presencePending,
	hasRows,
	status,
}: {
	isOnline: boolean;
	presencePending: boolean;
	hasRows: boolean;
	status: HostWorkspacesStatus | undefined;
}): HostSectionState {
	if (!isOnline) return presencePending ? "loading" : "offline";
	if (hasRows) return "ready";
	if (status === "error") return "error";
	if (status === "ready") return "empty";
	return "loading";
}
