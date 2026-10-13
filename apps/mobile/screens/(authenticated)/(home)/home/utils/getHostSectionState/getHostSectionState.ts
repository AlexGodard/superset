import type { HostWorkspacesStatus } from "@/hooks/useHostWorkspaces";
import type { HostSectionState } from "../../components/HostSectionHeader";

export function getHostSectionState({
	isOnline,
	presencePending,
	lastSeenAt,
	hasRows,
	status,
}: {
	isOnline: boolean;
	presencePending: boolean;
	/** Absent when the presence check failed: not an offline answer. */
	lastSeenAt: number | null | undefined;
	hasRows: boolean;
	status: HostWorkspacesStatus | undefined;
}): HostSectionState {
	if (!isOnline) {
		if (presencePending) return "loading";
		return lastSeenAt === undefined ? "unknown" : "offline";
	}
	if (hasRows) return "ready";
	if (status === "error") return "error";
	if (status === "ready") return "empty";
	return "loading";
}
