import { describe, expect, test } from "bun:test";
import { fallsBackToThisMachine } from "./fallsBackToThisMachine";

const workspaceHost = { unreachable: false, onThisMachine: false };

describe("fallsBackToThisMachine", () => {
	test("a workspace host with no simulator hands over to this machine", () => {
		expect(fallsBackToThisMachine({ ...workspaceHost, backend: "none" })).toBe(
			true,
		);
	});

	test("so does a workspace host that cannot be asked", () => {
		expect(
			fallsBackToThisMachine({
				...workspaceHost,
				backend: undefined,
				unreachable: true,
			}),
		).toBe(true);
	});

	test("a workspace host with its own simulators keeps the pane", () => {
		for (const backend of ["local-ios", "local-android", "eas"]) {
			expect(fallsBackToThisMachine({ ...workspaceHost, backend })).toBe(false);
		}
	});

	test("it waits for the workspace host's answer", () => {
		expect(
			fallsBackToThisMachine({ ...workspaceHost, backend: undefined }),
		).toBe(false);
	});

	test("this machine never hands over again", () => {
		expect(
			fallsBackToThisMachine({
				backend: "none",
				unreachable: false,
				onThisMachine: true,
			}),
		).toBe(false);
		expect(
			fallsBackToThisMachine({
				backend: undefined,
				unreachable: true,
				onThisMachine: true,
			}),
		).toBe(false);
	});
});
