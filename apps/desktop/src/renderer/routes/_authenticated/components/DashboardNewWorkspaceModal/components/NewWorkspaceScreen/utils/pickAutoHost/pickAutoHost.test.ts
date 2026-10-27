import { describe, expect, test } from "bun:test";
import {
	type HostProjectState,
	hostProjectState,
	pickAutoHost,
} from "./pickAutoHost";

const ranked = [
	{ machineId: "mini", reason: "16 idle cores" },
	{ machineId: "gaming", reason: "30 idle cores" },
	{ machineId: "mac", reason: "busy" },
];

function pick(online: string[], states: Record<string, HostProjectState>) {
	return pickAutoHost({
		ranked,
		isOnline: (id) => online.includes(id),
		projectState: (id) => states[id] ?? "absent",
	});
}

describe("pickAutoHost", () => {
	test("picks the best-ranked host that has the project", () => {
		expect(
			pick(["mini", "gaming", "mac"], { mini: "present", gaming: "present" }),
		).toEqual({
			status: "picked",
			machineId: "mini",
			reason: "16 idle cores",
			skipped: [],
		});
	});

	test("skips offline hosts and hosts without the project, and says so", () => {
		expect(
			pick(["gaming", "mac"], {
				mini: "present",
				gaming: "absent",
				mac: "present",
			}),
		).toEqual({
			status: "picked",
			machineId: "mac",
			reason: "busy",
			skipped: [
				{ machineId: "mini", why: "offline" },
				{ machineId: "gaming", why: "no-project" },
			],
		});
	});

	test("skips a host whose project list couldn't be read as unreachable", () => {
		expect(
			pick(["mini", "gaming", "mac"], {
				mini: "unreachable",
				gaming: "present",
			}),
		).toEqual({
			status: "picked",
			machineId: "gaming",
			reason: "30 idle cores",
			skipped: [{ machineId: "mini", why: "unreachable" }],
		});
	});

	test("waits while a better online host's projects are loading", () => {
		expect(
			pick(["mini", "gaming"], { mini: "pending", gaming: "present" }),
		).toEqual({ status: "pending" });
	});

	test("ignores a loading host that is offline", () => {
		expect(pick(["gaming"], { mini: "pending", gaming: "present" })).toEqual({
			status: "picked",
			machineId: "gaming",
			reason: "30 idle cores",
			skipped: [{ machineId: "mini", why: "offline" }],
		});
	});

	test("reports none, with every host's reason, when no ranked host fits", () => {
		expect(pick(["mini", "gaming"], { gaming: "unreachable" })).toEqual({
			status: "none",
			skipped: [
				{ machineId: "mini", why: "no-project" },
				{ machineId: "gaming", why: "unreachable" },
				{ machineId: "mac", why: "offline" },
			],
		});
	});
});

describe("hostProjectState", () => {
	const ids = new Set(["terminal"]);
	const base = { failed: false, timedOut: false, projectId: "terminal" };

	test("reads presence from a loaded list", () => {
		expect(hostProjectState({ ...base, projectIds: ids })).toBe("present");
		expect(
			hostProjectState({ ...base, projectIds: ids, projectId: "personal" }),
		).toBe("absent");
	});

	test("a failed list is unreachable, not absent", () => {
		expect(
			hostProjectState({ ...base, projectIds: undefined, failed: true }),
		).toBe("unreachable");
	});

	test("a list still loading waits until the deadline, then is unreachable", () => {
		expect(hostProjectState({ ...base, projectIds: undefined })).toBe(
			"pending",
		);
		expect(
			hostProjectState({ ...base, projectIds: undefined, timedOut: true }),
		).toBe("unreachable");
	});

	test("a list that arrives after the deadline still counts", () => {
		expect(hostProjectState({ ...base, projectIds: ids, timedOut: true })).toBe(
			"present",
		);
	});
});
