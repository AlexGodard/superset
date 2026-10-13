import { describe, expect, test } from "bun:test";
import { getHostSectionState } from "./getHostSectionState";

describe("getHostSectionState", () => {
	test("an offline host is offline once presence has answered", () => {
		expect(
			getHostSectionState({
				isOnline: false,
				presencePending: false,
				lastSeenAt: 1_000,
				hasRows: false,
				status: undefined,
			}),
		).toBe("offline");
	});

	test("a failed presence check is not an offline answer", () => {
		expect(
			getHostSectionState({
				isOnline: false,
				presencePending: false,
				lastSeenAt: undefined,
				hasRows: false,
				status: undefined,
			}),
		).toBe("unknown");
	});

	test("an unanswered presence check is not offline yet", () => {
		expect(
			getHostSectionState({
				isOnline: false,
				presencePending: true,
				lastSeenAt: undefined,
				hasRows: false,
				status: undefined,
			}),
		).toBe("loading");
	});

	test("rows win over a failed refetch", () => {
		expect(
			getHostSectionState({
				isOnline: true,
				presencePending: false,
				lastSeenAt: 1_000,
				hasRows: true,
				status: "error",
			}),
		).toBe("ready");
	});

	test("says why an online host shows nothing", () => {
		const state = (status: "loading" | "ready" | "error") =>
			getHostSectionState({
				isOnline: true,
				presencePending: false,
				lastSeenAt: 1_000,
				hasRows: false,
				status,
			});
		expect(state("loading")).toBe("loading");
		expect(state("ready")).toBe("empty");
		expect(state("error")).toBe("error");
	});
});
