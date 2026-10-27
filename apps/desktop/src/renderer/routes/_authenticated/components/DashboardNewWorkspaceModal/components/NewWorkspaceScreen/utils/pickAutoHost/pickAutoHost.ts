export type HostProjectState = "present" | "absent" | "pending" | "unreachable";

/** Why Auto passed over a better-ranked host. */
export type SkipReason = "offline" | "no-project" | "unreachable";

export interface SkippedHost {
	machineId: string;
	why: SkipReason;
}

export type AutoHostPick =
	| { status: "pending" }
	| {
			status: "picked";
			machineId: string;
			reason: string;
			skipped: SkippedHost[];
	  }
	| { status: "none"; skipped: SkippedHost[] };

/**
 * The first ranked host that is online and has the project. Waits while a
 * better-ranked online host's project list is still loading, and says which
 * hosts it passed over and why.
 */
export function pickAutoHost({
	ranked,
	isOnline,
	projectState,
}: {
	ranked: ReadonlyArray<{ machineId: string; reason: string }>;
	isOnline: (machineId: string) => boolean;
	projectState: (machineId: string) => HostProjectState;
}): AutoHostPick {
	const skipped: SkippedHost[] = [];
	for (const host of ranked) {
		if (!isOnline(host.machineId)) {
			skipped.push({ machineId: host.machineId, why: "offline" });
			continue;
		}
		const state = projectState(host.machineId);
		if (state === "pending") return { status: "pending" };
		if (state === "present") {
			return {
				status: "picked",
				machineId: host.machineId,
				reason: host.reason,
				skipped,
			};
		}
		skipped.push({
			machineId: host.machineId,
			why: state === "absent" ? "no-project" : "unreachable",
		});
	}
	return { status: "none", skipped };
}

/**
 * A host's project state from its project-list query. A list that failed is
 * unreachable, not absent: the host may well have the project. One still
 * loading past the deadline counts as unreachable too, so a hung request
 * can't hold up the pick.
 */
export function hostProjectState({
	projectIds,
	failed,
	timedOut,
	projectId,
}: {
	projectIds: ReadonlySet<string> | undefined;
	failed: boolean;
	timedOut: boolean;
	projectId: string;
}): HostProjectState {
	if (projectIds) return projectIds.has(projectId) ? "present" : "absent";
	return failed || timedOut ? "unreachable" : "pending";
}
