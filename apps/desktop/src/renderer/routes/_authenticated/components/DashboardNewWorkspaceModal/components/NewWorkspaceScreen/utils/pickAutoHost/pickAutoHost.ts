export type HostProjectState = "present" | "absent" | "pending";

export type AutoHostPick =
	| { status: "pending" }
	| { status: "picked"; machineId: string; reason: string }
	| { status: "none" };

/**
 * The first ranked host that is online and has the project. Waits while a
 * better-ranked online host's project list is still loading.
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
	for (const host of ranked) {
		if (!isOnline(host.machineId)) continue;
		const state = projectState(host.machineId);
		if (state === "pending") return { status: "pending" };
		if (state === "present") {
			return {
				status: "picked",
				machineId: host.machineId,
				reason: host.reason,
			};
		}
	}
	return { status: "none" };
}
