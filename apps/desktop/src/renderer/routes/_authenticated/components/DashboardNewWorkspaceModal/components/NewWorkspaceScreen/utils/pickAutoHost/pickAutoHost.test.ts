import { describe, expect, test } from "bun:test";
import { type HostProjectState, pickAutoHost } from "./pickAutoHost";

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
		).toEqual({ status: "picked", machineId: "mini", reason: "16 idle cores" });
	});

	test("skips offline hosts and hosts without the project", () => {
		expect(
			pick(["gaming", "mac"], {
				mini: "present",
				gaming: "absent",
				mac: "present",
			}),
		).toEqual({ status: "picked", machineId: "mac", reason: "busy" });
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
		});
	});

	test("reports none when no ranked host fits", () => {
		expect(pick(["mini"], {})).toEqual({ status: "none" });
	});
});
